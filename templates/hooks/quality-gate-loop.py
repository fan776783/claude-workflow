#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Quality Gate Loop Hook — 质量关卡验证循环。

借鉴 Trellis ralph-loop.py，在子 Agent 尝试停止时自动验证
任务的 verification.commands 是否全部通过。

配置方法（.claude/settings.json）:
    {
      "hooks": {
        "SubagentStop": [
          {
            "type": "command",
            "command": "python3 .agents/agent-workflow/hooks/quality-gate-loop.py"
          }
        ]
      }
    }

行为：
  - 读取当前任务的 verification.commands
  - 逐个运行验证命令
  - 全部通过 → 允许停止 ({"decision": "allow"})
  - 有失败 → 阻止停止 ({"decision": "block", "message": "..."})
  - 最大重试 5 次后放行
  - 超时 30 分钟后放行

状态持久化到 ~/.claude/workflows/{projectId}/.quality-loop-state.json
"""

import warnings
warnings.filterwarnings("ignore")

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "skills" / "workflow" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from path_utils import detect_project_id_from_root, get_workflows_dir

if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(
            sys.stdout.detach(), encoding="utf-8", errors="replace"
        )

MAX_ITERATIONS = 5
STATE_TIMEOUT_MINUTES = 30


def find_workflow_state() -> tuple[dict | None, str]:
    """Find active workflow state. Returns (state, state_dir)."""
    project_id = detect_project_id_from_root(str(Path.cwd()))
    if not project_id:
        return None, ""

    workflow_dir = get_workflows_dir(project_id)
    if not workflow_dir:
        return None, ""

    state_dir = str(Path(workflow_dir))
    state_path = os.path.join(state_dir, "workflow-state.json")

    if not os.path.isfile(state_path):
        return None, state_dir

    try:
        with open(state_path, "r", encoding="utf-8") as f:
            return json.load(f), state_dir
    except (json.JSONDecodeError, OSError):
        return None, state_dir


def get_current_task_verification(state: dict, state_dir: str) -> list[str]:
    """Get verification commands for the current task."""
    current_tasks = state.get("current_tasks", [])
    if not current_tasks:
        return []

    task_id = current_tasks[0]
    tasks_file = state.get("tasks_file", "")
    if not tasks_file:
        return []

    tasks_path = os.path.join(state_dir, tasks_file)
    if not os.path.isfile(tasks_path):
        return []

    try:
        import re
        with open(tasks_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Extract task block
        pattern = re.compile(
            rf"##+\s+{re.escape(task_id)}:[\s\S]*?(?=\n##+\s+T\d+:|$)",
            re.MULTILINE,
        )
        match = pattern.search(content)
        if not match:
            return []

        block = match.group(0)

        # Extract verification commands
        cmd_match = re.search(
            r"\*\*验证命令\*\*\s*:\s*(.+?)$", block, re.MULTILINE
        )
        if not cmd_match:
            return []

        return [c.strip() for c in cmd_match.group(1).split(",") if c.strip()]

    except (OSError, re.error):
        return []


def read_loop_state(state_dir: str) -> dict:
    """Read quality loop state."""
    path = os.path.join(state_dir, ".quality-loop-state.json")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"iteration": 0, "started_at": None, "last_results": []}


def write_loop_state(state_dir: str, loop_state: dict) -> None:
    """Write quality loop state."""
    path = os.path.join(state_dir, ".quality-loop-state.json")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(loop_state, f, indent=2, ensure_ascii=False)
    except OSError:
        pass


def run_verification(command: str, timeout: int = 60) -> dict:
    """Run a single verification command."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=str(Path.cwd()),
        )
        return {
            "command": command,
            "exit_code": result.returncode,
            "passed": result.returncode == 0,
            "output": (result.stdout or result.stderr or "")[:500],
        }
    except subprocess.TimeoutExpired:
        return {
            "command": command,
            "exit_code": -1,
            "passed": False,
            "output": f"Timeout after {timeout}s",
        }
    except OSError as e:
        return {
            "command": command,
            "exit_code": -1,
            "passed": False,
            "output": str(e),
        }


def main() -> int:
    # Read hook input
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, EOFError):
        hook_input = {}

    state, state_dir = find_workflow_state()

    # No active workflow or not running → allow stop
    if not state or state.get("status") not in ("running",):
        print(json.dumps({"decision": "allow"}))
        return 0

    # Get verification commands
    commands = get_current_task_verification(state, state_dir)
    if not commands:
        # No verification commands defined → allow stop
        print(json.dumps({"decision": "allow"}))
        return 0

    # Read loop state
    loop_state = read_loop_state(state_dir)

    # Check timeout
    if loop_state.get("started_at"):
        started = datetime.fromisoformat(loop_state["started_at"])
        elapsed = (datetime.now() - started).total_seconds() / 60
        if elapsed >= STATE_TIMEOUT_MINUTES:
            # Timeout → reset and allow
            loop_state = {"iteration": 0, "started_at": None, "last_results": []}
            write_loop_state(state_dir, loop_state)
            print(json.dumps({
                "decision": "allow",
                "message": f"[quality-loop] 验证超时 ({STATE_TIMEOUT_MINUTES}min)，自动放行。",
            }))
            return 0

    # Check max iterations
    if loop_state["iteration"] >= MAX_ITERATIONS:
        loop_state = {"iteration": 0, "started_at": None, "last_results": []}
        write_loop_state(state_dir, loop_state)
        print(json.dumps({
            "decision": "allow",
            "message": f"[quality-loop] 已达最大重试次数 ({MAX_ITERATIONS})，自动放行。",
        }))
        return 0

    # Initialize start time
    if not loop_state.get("started_at"):
        loop_state["started_at"] = datetime.now().isoformat()

    # Run verification commands
    results = [run_verification(cmd) for cmd in commands]
    all_passed = all(r["passed"] for r in results)

    loop_state["iteration"] += 1
    loop_state["last_results"] = results
    write_loop_state(state_dir, loop_state)

    if all_passed:
        # Reset and allow
        loop_state = {"iteration": 0, "started_at": None, "last_results": []}
        write_loop_state(state_dir, loop_state)
        print(json.dumps({
            "decision": "allow",
            "message": "[quality-loop] 所有验证命令通过 ✅",
        }))
    else:
        # Block with failure details
        failed = [r for r in results if not r["passed"]]
        failure_msg = "\n".join(
            f"  ❌ `{r['command']}` (exit={r['exit_code']}): {r['output'][:200]}"
            for r in failed
        )
        task_id = state.get("current_tasks", ["?"])[0]
        print(json.dumps({
            "decision": "block",
            "message": (
                f"[quality-loop] 验证失败 (迭代 {loop_state['iteration']}/{MAX_ITERATIONS})\n"
                f"任务: {task_id}\n"
                f"失败的验证:\n{failure_msg}\n"
                f"请修复后重试。"
            ),
        }, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
