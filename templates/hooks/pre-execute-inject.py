#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pre-Execute Inject Hook — 子 Agent 执行任务前自动注入上下文。

借鉴 Trellis inject-subagent-context.py，在 Task 工具调用前
自动注入当前任务的 spec_ref / plan_ref / acceptance_criteria。

配置方法（.claude/settings.json）:
    {
      "hooks": {
        "PreToolUse": [
          {
            "type": "command",
            "command": "python3 .agents/agent-workflow/hooks/pre-execute-inject.py",
            "matcher": "Task"
          }
        ]
      }
    }

输入：从 stdin 读取 JSON（Claude Code hook 协议）
输出：JSON 到 stdout。除了 `decision/message` 外，会尽力返回
修改后的 `tool_input`，供支持输入重写的平台直接消费。
"""

import warnings
warnings.filterwarnings("ignore")

import json
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(
            sys.stdout.detach(), encoding="utf-8", errors="replace"
        )


def read_file(path: str, fallback: str = "") -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, OSError):
        return fallback


def extract_section(content: str, heading: str, max_chars: int = 2000) -> str:
    """Extract a section from markdown content by heading."""
    import re
    pattern = re.compile(
        rf"^(#{1,4})\s+{re.escape(heading)}\b[^\n]*\n([\s\S]*?)(?=\n\1\s|\Z)",
        re.MULTILINE,
    )
    match = pattern.search(content)
    if not match:
        return ""
    section = match.group(2).strip()
    return section[:max_chars] if len(section) > max_chars else section


def find_workflow_state() -> dict | None:
    """Find active workflow state."""
    config_path = Path.cwd() / ".claude" / "config" / "project-config.json"
    if not config_path.is_file():
        return None

    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    project = config.get("project") or {}
    project_id = project.get("id") or config.get("projectId", "")
    if not project_id:
        return None

    state_path = Path.home() / ".claude" / "workflows" / project_id / "workflow-state.json"
    if not state_path.is_file():
        return None

    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def build_task_context(state: dict) -> str:
    """Build context injection for the current task."""
    parts = []
    project_root = Path.cwd()

    current_tasks = state.get("current_tasks", [])
    task_id = current_tasks[0] if current_tasks else None

    if not task_id:
        return ""

    # 1. Load tasks file and extract current task block
    project_id = state.get("projectId") or state.get("project_id", "")
    tasks_file = state.get("tasks_file", "")
    if tasks_file:
        wf_dir = Path.home() / ".claude" / "workflows" / project_id
        tasks_content = read_file(str(wf_dir / tasks_file))
        if tasks_content:
            # Extract task block
            import re
            pattern = re.compile(
                rf"##+\s+{re.escape(task_id)}:[\s\S]*?(?=\n##+\s+T\d+:|$)",
                re.MULTILINE,
            )
            match = pattern.search(tasks_content)
            if match:
                parts.append(f"<current-task>\n{match.group(0)[:3000]}\n</current-task>")

    # 2. Load spec_ref section
    spec_file = state.get("spec_file", "")
    if spec_file:
        spec_content = read_file(str(project_root / spec_file))
        if spec_content:
            # Try to extract the most relevant section
            brief = spec_content[:2000]
            parts.append(f"<spec-context>\n{brief}\n</spec-context>")

    # 3. Load critical constraints from requirement baseline
    baseline = state.get("requirement_baseline", {})
    baseline_path = baseline.get("path", "")
    if baseline_path:
        baseline_content = read_file(str(project_root / baseline_path))
        constraints_section = extract_section(baseline_content, "Critical Constraints")
        if not constraints_section:
            constraints_section = extract_section(baseline_content, "关键约束")
        if constraints_section:
            parts.append(
                f"<critical-constraints>\n{constraints_section[:1000]}\n</critical-constraints>"
            )

    # 4. Thinking guides reminder
    guides_dir = project_root / ".claude" / "specs" / "guides"
    if guides_dir.is_dir():
        parts.append(
            "<reminder>修改代码前请参考 .claude/specs/guides/ 中的思维指南。</reminder>"
        )

    return "\n\n".join(parts)


def build_allow_result(
    message: str | None = None,
    patched_tool_input: dict | None = None,
) -> dict:
    """Build a best-effort allow response for hook consumers.

    Some hook runners only read `decision/message`, while others can consume
    a patched `tool_input`. We return both to maximize compatibility.
    """
    result = {"decision": "allow"}
    if message:
        result["message"] = message
    if patched_tool_input is not None:
        result["tool_input"] = patched_tool_input
        result["patched_tool_input"] = patched_tool_input
        result["hookSpecificOutput"] = {
            "tool_input": patched_tool_input,
        }
    return result


def main() -> int:
    # Read hook input from stdin
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, EOFError):
        hook_input = {}

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Only inject for Task tool
    if tool_name != "Task":
        print(json.dumps(build_allow_result()))
        return 0

    state = find_workflow_state()
    if not state or state.get("status") not in ("running", "paused"):
        print(json.dumps(build_allow_result()))
        return 0

    # Build context
    task_description = tool_input.get("description", "")
    context = build_task_context(state)

    if context:
        # Prepend context to the task description
        enhanced = f"{context}\n\n---\n\n{task_description}"
        patched_tool_input = dict(tool_input) if isinstance(tool_input, dict) else {}
        patched_tool_input["description"] = enhanced
        result = build_allow_result(
            message=f"[workflow-hook] 已注入任务上下文 ({len(context)} 字符)",
            patched_tool_input=patched_tool_input,
        )
    else:
        result = build_allow_result()

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
