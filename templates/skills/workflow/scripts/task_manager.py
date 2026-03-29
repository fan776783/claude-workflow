#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
任务管理 CLI。

借鉴 Trellis task.py，提供结构化的任务查询和状态管理命令。
整合 task_parser / state_manager / dependency_checker / context_budget 的能力。

用法:
    python3 task_manager.py status          # 当前任务状态
    python3 task_manager.py --project-id <id> --project-root <dir> status
    python3 task_manager.py list            # 列出所有任务
    python3 task_manager.py next            # 下一个待执行任务
    python3 task_manager.py complete T3     # 标记完成
    python3 task_manager.py fail T3 "原因"  # 标记失败
    python3 task_manager.py deps T5         # 检查依赖
    python3 task_manager.py parallel        # 查找可并行任务
    python3 task_manager.py progress        # 进度统计
    python3 task_manager.py context-budget  # 上下文预算
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Import sibling modules
sys.path.insert(0, os.path.dirname(__file__))

from context_budget import (
    detect_complexity,
    evaluate_budget_thresholds,
    generate_context_bar,
)
from dependency_checker import check_task_deps, find_parallel_groups
from state_manager import (
    calculate_progress,
    generate_progress_bar,
    read_state,
    write_state,
)
from status_utils import add_unique, get_status_emoji
from task_parser import (
    count_tasks,
    extract_constraints,
    find_next_task,
    parse_tasks_v2,
    task_to_dict,
    update_task_status_in_markdown,
)


# =============================================================================
# State & Tasks Resolution
# =============================================================================


def detect_project_id() -> Optional[str]:
    config_path = Path.cwd() / ".claude" / "config" / "project-config.json"
    if config_path.is_file():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            project = config.get("project") or {}
            return project.get("id") or config.get("projectId")
        except (json.JSONDecodeError, OSError):
            pass
    return None


def detect_project_root(project_root: Optional[str] = None) -> Path:
    if project_root:
        return Path(project_root)

    config_path = Path.cwd() / ".claude" / "config" / "project-config.json"
    if config_path.is_file():
        return config_path.parents[2]
    return Path.cwd()


def resolve_state_and_tasks(
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> tuple[Dict[str, Any] | None, str | None, str | None, str | None]:
    """Resolve state, state_path, task/plan content, artifact path."""
    pid = project_id or detect_project_id()
    if not pid:
        return None, None, None, None

    state_dir = Path.home() / ".claude" / "workflows" / pid
    state_path = state_dir / "workflow-state.json"

    if not state_path.is_file():
        return None, None, None, None

    state = read_state(str(state_path))
    resolved_project_root = detect_project_root(
        project_root or state.get("project_root")
    )
    plan_file = state.get("plan_file", "")
    artifact_path: Optional[Path] = None

    if plan_file:
        candidate = Path(plan_file)
        artifact_path = (
            candidate
            if candidate.is_absolute()
            else (resolved_project_root / candidate)
        )

    if not artifact_path:
        return state, str(state_path), None, None

    if not artifact_path.is_file():
        return state, str(state_path), None, None

    tasks_content = artifact_path.read_text(encoding="utf-8")
    return state, str(state_path), tasks_content, str(artifact_path)


# =============================================================================
# Commands
# =============================================================================


def cmd_status(
    project_id: Optional[str] = None, project_root: Optional[str] = None
) -> Dict[str, Any]:
    """Show current workflow and task status."""
    state, state_path, tasks_content, tasks_path = resolve_state_and_tasks(
        project_id, project_root
    )
    if not state:
        return {"error": "没有活跃的工作流"}

    progress = state.get("progress", {})
    current = state.get("current_tasks", [])
    total = count_tasks(tasks_content) if tasks_content else 0
    pct = calculate_progress(
        total,
        progress.get("completed", []),
        progress.get("skipped", []),
        progress.get("failed", []),
    )

    result = {
        "workflow_status": state.get("status"),
        "current_tasks": current,
        "total_tasks": total,
        "completed": len(progress.get("completed", [])),
        "failed": len(progress.get("failed", [])),
        "skipped": len(progress.get("skipped", [])),
        "progress_percent": pct,
        "progress_bar": generate_progress_bar(pct),
    }

    if state.get("failure_reason"):
        result["failure_reason"] = state["failure_reason"]

    return result


def cmd_list(
    project_id: Optional[str] = None, project_root: Optional[str] = None
) -> Dict[str, Any]:
    """List all tasks with status."""
    state, _, tasks_content, _ = resolve_state_and_tasks(project_id, project_root)
    if not state or not tasks_content:
        return {"error": "没有活跃的工作流或任务"}

    tasks = parse_tasks_v2(tasks_content)
    return {
        "total": len(tasks),
        "tasks": [
            {
                "id": t.id,
                "name": t.name,
                "phase": t.phase,
                "status": t.status,
                "emoji": get_status_emoji(t.status),
                "quality_gate": t.quality_gate,
                "actions": t.actions,
            }
            for t in tasks
        ],
    }


def cmd_next(
    project_id: Optional[str] = None, project_root: Optional[str] = None
) -> Dict[str, Any]:
    """Find the next task to execute."""
    state, _, tasks_content, _ = resolve_state_and_tasks(project_id, project_root)
    if not state or not tasks_content:
        return {"error": "没有活跃的工作流或任务"}

    progress = state.get("progress", {})
    next_id = find_next_task(
        tasks_content,
        completed=progress.get("completed", []),
        skipped=progress.get("skipped", []),
        failed=progress.get("failed", []),
        blocked=progress.get("blocked", []),
    )

    if not next_id:
        return {"next_task": None, "message": "所有任务已完成或被阻塞"}

    tasks = parse_tasks_v2(tasks_content)
    task = next((t for t in tasks if t.id == next_id), None)
    if task:
        return {"next_task": task_to_dict(task)}
    return {"next_task": next_id}


def cmd_complete(
    task_id: str,
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Mark a task as completed."""
    state, state_path, tasks_content, tasks_path = resolve_state_and_tasks(
        project_id, project_root
    )
    if not state or not tasks_content or not tasks_path or not state_path:
        return {"error": "没有活跃的工作流或任务"}

    # Update markdown
    updated = update_task_status_in_markdown(tasks_content, task_id, "completed")
    with open(tasks_path, "w", encoding="utf-8") as f:
        f.write(updated)

    # Update state
    progress = state.setdefault("progress", {})
    completed = progress.setdefault("completed", [])
    add_unique(completed, task_id)

    # Remove from failed if was retried
    if task_id in progress.get("failed", []):
        progress["failed"].remove(task_id)

    write_state(state_path, state)
    return {"completed": True, "task_id": task_id}


def cmd_fail(
    task_id: str,
    reason: str,
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Mark a task as failed."""
    state, state_path, tasks_content, tasks_path = resolve_state_and_tasks(
        project_id, project_root
    )
    if not state or not tasks_content or not tasks_path or not state_path:
        return {"error": "没有活跃的工作流或任务"}

    updated = update_task_status_in_markdown(tasks_content, task_id, "failed")
    with open(tasks_path, "w", encoding="utf-8") as f:
        f.write(updated)

    state["status"] = "failed"
    state["failure_reason"] = reason
    state["current_tasks"] = [task_id]
    progress = state.setdefault("progress", {})
    add_unique(progress.setdefault("failed", []), task_id)
    write_state(state_path, state)

    return {"failed": True, "task_id": task_id, "reason": reason}


def cmd_deps(
    task_id: str,
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Check task dependencies."""
    state, _, tasks_content, _ = resolve_state_and_tasks(project_id, project_root)
    if not state or not tasks_content:
        return {"error": "没有活跃的工作流或任务"}

    tasks = parse_tasks_v2(tasks_content)
    task = next((t for t in tasks if t.id == task_id), None)
    if not task:
        return {"error": f"任务 {task_id} 不存在"}

    progress = state.get("progress", {})
    result = check_task_deps(task.depends, progress.get("completed", []))
    result["task_id"] = task_id
    result["depends"] = task.depends
    result["blocked_by"] = task.blocked_by
    return result


def cmd_parallel(
    project_id: Optional[str] = None, project_root: Optional[str] = None
) -> Dict[str, Any]:
    """Find parallelizable task groups."""
    state, _, tasks_content, _ = resolve_state_and_tasks(project_id, project_root)
    if not state or not tasks_content:
        return {"error": "没有活跃的工作流或任务"}

    tasks = parse_tasks_v2(tasks_content)
    progress = state.get("progress", {})

    # Convert to dicts for dependency_checker
    task_dicts = [task_to_dict(t) for t in tasks]
    groups = find_parallel_groups(
        task_dicts,
        completed=progress.get("completed", []),
        blocked=progress.get("blocked", []),
        skipped=progress.get("skipped", []),
        failed=progress.get("failed", []),
    )

    return {"parallel_groups": groups, "group_count": len(groups)}


def cmd_progress(
    project_id: Optional[str] = None, project_root: Optional[str] = None
) -> Dict[str, Any]:
    """Show progress with visual bar."""
    state, _, tasks_content, _ = resolve_state_and_tasks(project_id, project_root)
    if not state or not tasks_content:
        return {"error": "没有活跃的工作流或任务"}

    progress = state.get("progress", {})
    total = count_tasks(tasks_content)
    pct = calculate_progress(
        total,
        progress.get("completed", []),
        progress.get("skipped", []),
        progress.get("failed", []),
    )

    return {
        "total": total,
        "completed": len(progress.get("completed", [])),
        "skipped": len(progress.get("skipped", [])),
        "failed": len(progress.get("failed", [])),
        "blocked": len(progress.get("blocked", [])),
        "pending": total - len(progress.get("completed", [])) - len(progress.get("skipped", [])) - len(progress.get("failed", [])),
        "percent": pct,
        "bar": generate_progress_bar(pct),
        "constraints": extract_constraints(tasks_content),
    }


def cmd_context_budget(
    project_id: Optional[str] = None, project_root: Optional[str] = None
) -> Dict[str, Any]:
    """Show context budget status."""
    state, _, _, _ = resolve_state_and_tasks(project_id, project_root)
    if not state:
        return {"error": "没有活跃的工作流"}

    metrics = state.get("contextMetrics", {})
    usage = metrics.get("usagePercent", 0)
    projected = metrics.get("projectedUsagePercent", 0)

    budget = evaluate_budget_thresholds(projected)
    budget["current_usage"] = usage
    budget["context_bar"] = generate_context_bar(usage)
    budget["max_consecutive_tasks"] = metrics.get("maxConsecutiveTasks", 5)
    budget["consecutive_count"] = state.get("consecutive_count", 0)

    return budget


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description="任务管理 CLI")
    parser.add_argument("--project-id", help="项目 ID")
    parser.add_argument("--project-root", help="项目根目录（用于解析相对 plan_file）")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("status", help="当前状态")
    sub.add_parser("list", help="列出所有任务")
    sub.add_parser("next", help="下一个任务")

    p_complete = sub.add_parser("complete", help="标记完成")
    p_complete.add_argument("task_id", help="任务 ID")

    p_fail = sub.add_parser("fail", help="标记失败")
    p_fail.add_argument("task_id", help="任务 ID")
    p_fail.add_argument("reason", help="失败原因")

    p_deps = sub.add_parser("deps", help="检查依赖")
    p_deps.add_argument("task_id", help="任务 ID")

    sub.add_parser("parallel", help="查找可并行任务")
    sub.add_parser("progress", help="进度统计")
    sub.add_parser("context-budget", help="上下文预算")

    args = parser.parse_args()
    pid = args.project_id
    project_root = args.project_root

    commands = {
        "status": lambda: cmd_status(pid, project_root),
        "list": lambda: cmd_list(pid, project_root),
        "next": lambda: cmd_next(pid, project_root),
        "complete": lambda: cmd_complete(args.task_id, pid, project_root),
        "fail": lambda: cmd_fail(args.task_id, args.reason, pid, project_root),
        "deps": lambda: cmd_deps(args.task_id, pid, project_root),
        "parallel": lambda: cmd_parallel(pid, project_root),
        "progress": lambda: cmd_progress(pid, project_root),
        "context-budget": lambda: cmd_context_budget(pid, project_root),
    }

    handler = commands.get(args.command)
    if handler:
        result = handler()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
