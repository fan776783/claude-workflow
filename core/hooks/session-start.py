#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Session Start Hook — 会话启动时自动注入工作流上下文。

借鉴 Trellis session-start.py，在 Claude Code 会话启动时将项目配置、
活跃工作流状态和项目规范注入 AI 上下文。

配置方法（.claude/settings.json）:
    {
      "hooks": {
        "SessionStart": [
          {
            "type": "command",
            "command": "python3 .agents/agent-workflow/hooks/session-start.py"
          }
        ]
      }
    }

输出格式：直接输出文本到 stdout，Claude Code 会将其注入为系统消息。
"""

# Suppress warnings before any other imports
import warnings
warnings.filterwarnings("ignore")

import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "utils" / "workflow"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from path_utils import get_workflow_state_path

# Windows UTF-8 fix (from Trellis)
if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(
            sys.stdout.detach(), encoding="utf-8", errors="replace"
        )


def should_skip() -> bool:
    """Skip injection in non-interactive mode."""
    return os.environ.get("CLAUDE_NON_INTERACTIVE") == "1"


def read_file(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, OSError):
        return fallback


def find_project_config(start: Path) -> dict | None:
    """Find and read .claude/config/project-config.json."""
    config_path = start / ".claude" / "config" / "project-config.json"
    if config_path.is_file():
        try:
            return json.loads(config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def find_workflow_state(project_id: str) -> dict | None:
    """Find workflow-state.json for the given project."""
    state_path_raw = get_workflow_state_path(project_id)
    if not state_path_raw:
        return None
    state_path = Path(state_path_raw)
    if state_path.is_file():
        try:
            return json.loads(state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def collect_spec_indices(project_root: Path) -> str:
    """Collect all spec/index.md files."""
    specs_dir = project_root / ".claude" / "specs"
    if not specs_dir.is_dir():
        return ""

    indices = []
    for index_file in sorted(specs_dir.rglob("index.md")):
        rel = index_file.relative_to(project_root)
        content = read_file(index_file)
        if content.strip():
            indices.append(f"### {rel}\n{content[:500]}")

    return "\n\n".join(indices) if indices else ""


def determine_next_action(state: dict | None) -> str:
    """Determine suggested next action based on workflow state."""
    if not state:
        return "没有活跃的工作流。使用 `/workflow start` 开始新任务。"

    status = state.get("status", "idle")
    current_tasks = state.get("current_tasks", [])
    progress = state.get("progress", {})
    completed = progress.get("completed", [])
    failed = progress.get("failed", [])

    if status == "idle":
        return "使用 `/workflow start` 开始新的工作流。"
    elif status == "planned":
        return "规划已完成。使用 `/workflow execute` 开始执行。"
    elif status == "spec_review":
        return "Spec 等待确认。请审查 Spec 文档后确认继续。"
    elif status == "running":
        task_id = current_tasks[0] if current_tasks else "?"
        return f"工作流执行中，当前任务: {task_id}。使用 `/workflow execute` 继续。"
    elif status == "paused":
        return "工作流已暂停。使用 `/workflow execute` 恢复执行。"
    elif status == "failed":
        task_id = current_tasks[0] if current_tasks else "?"
        reason = state.get("failure_reason", "未知")
        return f"任务 {task_id} 失败: {reason}。使用 `/workflow execute --retry` 重试。"
    elif status == "blocked":
        return "工作流被阻塞。使用 `/workflow unblock <dep>` 解除依赖。"
    elif status == "completed":
        return f"工作流已完成 ({len(completed)} 任务)。使用 `/workflow archive` 归档。"
    elif status == "archived":
        return "工作流已归档。使用 `/workflow start` 开始新任务。"
    else:
        return f"当前状态: {status}。使用 `/workflow status` 查看详情。"


def main() -> int:
    if should_skip():
        return 0

    project_root = Path.cwd()

    # 1. Find project config
    config = find_project_config(project_root)
    if not config:
        # No project config — skip injection silently
        return 0

    project = config.get("project") or {}
    project_id = project.get("id") or config.get("projectId", "")
    project_name = project.get("name") or config.get("projectName", project_root.name)

    # 2. Find active workflow state
    state = find_workflow_state(project_id) if project_id else None

    # 3. Collect project specs
    specs = collect_spec_indices(project_root)

    # 4. Build output
    output_parts = []

    output_parts.append(f"<workflow-context>")

    # Project info
    output_parts.append(f"<project-info>")
    output_parts.append(f"项目: {project_name}")
    output_parts.append(f"项目 ID: {project_id}")
    tech = config.get("frameworks", [])
    if tech:
        tech_str = ", ".join(t if isinstance(t, str) else t.get("name", "") for t in tech[:5])
        output_parts.append(f"技术栈: {tech_str}")
    output_parts.append(f"</project-info>")

    # Workflow state
    if state:
        output_parts.append(f"<active-workflow>")
        output_parts.append(f"状态: {state.get('status', 'unknown')}")
        progress = state.get("progress", {})
        completed = progress.get("completed", [])
        total_hint = ""
        tasks_file = state.get("tasks_file", "")
        if tasks_file:
            total_hint = f" (任务文件: {tasks_file})"
        output_parts.append(f"已完成: {len(completed)} 任务{total_hint}")

        current = state.get("current_tasks", [])
        if current:
            output_parts.append(f"当前任务: {', '.join(current)}")

        # Context budget
        metrics = state.get("contextMetrics", {})
        usage = metrics.get("usagePercent", 0)
        if usage > 0:
            output_parts.append(f"上下文使用率: {usage}%")

        output_parts.append(f"</active-workflow>")

    # Next action
    output_parts.append(f"<next-action>")
    output_parts.append(determine_next_action(state))
    output_parts.append(f"</next-action>")

    # Project specs
    if specs:
        output_parts.append(f"<project-specs>")
        output_parts.append(specs)
        output_parts.append(f"</project-specs>")

    # Thinking guides reference
    guides_dir = project_root / ".claude" / "specs" / "guides"
    if guides_dir.is_dir():
        output_parts.append(f"<thinking-guides>")
        output_parts.append("项目包含思维指南，修改代码前请参考:")
        for guide in sorted(guides_dir.glob("*.md")):
            if guide.name != "index.md":
                output_parts.append(f"  - .claude/specs/guides/{guide.name}")
        output_parts.append(f"</thinking-guides>")

    output_parts.append(f"</workflow-context>")

    print("\n".join(output_parts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
