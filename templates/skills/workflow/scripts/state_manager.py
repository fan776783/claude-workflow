#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
工作流状态文件管理器。

从 helpers.md / execution-modes.md 中提取的状态读写、字段更新逻辑。
JSON 读写和字段更新是确定性操作，AI 可能忘记更新某个字段。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from path_utils import get_workflows_dir
from status_utils import add_unique
from workflow_types import ensure_state_defaults, next_change_id, build_user_spec_review


# =============================================================================
# State I/O
# =============================================================================


def read_state(state_path: str) -> Dict[str, Any]:
    """读取 workflow-state.json。

    Args:
        state_path: 状态文件路径

    Returns:
        解析后的状态字典

    Raises:
        FileNotFoundError: 文件不存在
        json.JSONDecodeError: JSON 格式错误
    """
    with open(state_path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_state(state_path: str, state: Dict[str, Any]) -> None:
    """原子写入 workflow-state.json。

    使用临时文件 + rename 确保写入不会导致文件损坏。
    """
    state = normalize_for_write(state)
    state["updated_at"] = datetime.now().isoformat()

    dir_path = os.path.dirname(state_path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_path, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
        # Atomic rename (on same filesystem)
        os.replace(tmp_path, state_path)
    except Exception:
        # Clean up temp file on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def read_state_from_project(project_id: str) -> Optional[Dict[str, Any]]:
    """通过项目 ID 读取状态文件。"""
    wdir = get_workflows_dir(project_id)
    if not wdir:
        return None
    state_path = os.path.join(wdir, "workflow-state.json")
    if not os.path.isfile(state_path):
        return None
    return read_state(state_path)


def normalize_for_write(state: Dict[str, Any]) -> Dict[str, Any]:
    """在写入前补齐标准字段。"""
    return ensure_state_defaults(state)


def record_delta_change(
    state: Dict[str, Any],
    change_id: Optional[str] = None,
    mark_applied: bool = True,
) -> str:
    """更新 delta_tracking 并返回 change id。"""
    normalized = ensure_state_defaults(state)
    tracking = normalized.setdefault("delta_tracking", {})
    resolved_change_id = change_id or next_change_id(tracking)
    tracking["current_change"] = resolved_change_id
    tracking["change_counter"] = max(
        int(tracking.get("change_counter") or 0),
        int(resolved_change_id.split("-")[-1]),
    )
    applied_changes = tracking.setdefault("applied_changes", [])
    if mark_applied and resolved_change_id not in applied_changes:
        applied_changes.append(resolved_change_id)
    return resolved_change_id


def update_api_context(
    state: Dict[str, Any],
    interfaces: Optional[List[Dict[str, Any]]] = None,
    source: Optional[str] = None,
    version: Optional[str] = None,
    last_sync: Optional[str] = None,
) -> Dict[str, Any]:
    """更新 API 同步上下文。"""
    normalized = ensure_state_defaults(state)
    api_context = normalized.setdefault("api_context", {})
    if interfaces is not None:
        api_context["interfaces"] = interfaces
    if source is not None:
        api_context["source"] = source
    if version is not None:
        api_context["version"] = version
    api_context["lastSync"] = last_sync or datetime.now().isoformat()
    return api_context


def mark_dependency_unblocked(
    state: Dict[str, Any],
    dependency: str,
    tasks_to_unblock: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """记录依赖已解除，并同步 blocked/running 状态。"""
    normalized = ensure_state_defaults(state)
    unblocked = normalized.setdefault("unblocked", [])
    add_unique(unblocked, dependency)

    if tasks_to_unblock:
        blocked = normalized.setdefault("progress", {}).setdefault("blocked", [])
        normalized["progress"]["blocked"] = [
            task_id for task_id in blocked if task_id not in tasks_to_unblock
        ]

    if normalized.get("status") == "blocked":
        normalized["status"] = "running"
    return normalized


def update_discussion_record(
    state: Dict[str, Any],
    artifact_path: Optional[str],
    clarification_count: int,
    completed: bool = True,
) -> Dict[str, Any]:
    normalized = ensure_state_defaults(state)
    normalized["discussion"] = {
        "completed": completed,
        "artifact_path": artifact_path,
        "clarification_count": clarification_count,
    }
    return normalized["discussion"]


def update_ux_design_record(
    state: Dict[str, Any],
    artifact_path: Optional[str],
    flowchart_scenarios: int = 0,
    page_count: int = 0,
    approved: bool = False,
) -> Dict[str, Any]:
    normalized = ensure_state_defaults(state)
    normalized["ux_design"] = {
        "completed": approved,
        "artifact_path": artifact_path,
        "flowchart_scenarios": flowchart_scenarios,
        "page_count": page_count,
        "approved_at": datetime.now().isoformat() if approved else None,
    }
    return normalized["ux_design"]


def update_user_spec_review(
    state: Dict[str, Any],
    status: str,
    next_action: Optional[str],
    reviewer: str = "user",
) -> Dict[str, Any]:
    normalized = ensure_state_defaults(state)
    review_status = normalized.setdefault("review_status", {})
    review_status["user_spec_review"] = build_user_spec_review(
        status=status,
        next_action=next_action,
        reviewer=reviewer,
    )
    return review_status["user_spec_review"]


# =============================================================================
# State Update Functions
# =============================================================================


def complete_workflow(
    state: Dict[str, Any],
    state_path: str,
    total_tasks: int,
) -> Dict[str, str]:
    """标记工作流为已完成。

    从 helpers.md 中 ``completeWorkflow()`` 提取。

    Returns:
        统计信息字典
    """
    state["status"] = "completed"
    state["current_tasks"] = []
    state["completed_at"] = datetime.now().isoformat()

    write_state(state_path, state)

    progress = state.get("progress", {})
    stats = {
        "total_tasks": total_tasks,
        "completed": len(progress.get("completed", [])),
        "skipped": len(progress.get("skipped", [])),
        "failed": len(progress.get("failed", [])),
    }
    return stats


def handle_task_error(
    state: Dict[str, Any],
    state_path: str,
    task_id: str,
    task_name: str,
    error_message: str,
) -> None:
    """处理任务执行错误。

    从 helpers.md 中 ``handleTaskError()`` 提取。
    """
    state["status"] = "failed"
    state["failure_reason"] = error_message
    state["current_tasks"] = [task_id]

    progress = state.setdefault("progress", {})
    failed_list = progress.setdefault("failed", [])
    add_unique(failed_list, task_id)

    write_state(state_path, state)


def record_context_usage(
    state: Dict[str, Any],
    task_id: str,
    phase: str,
    pre_task_tokens: int,
    post_task_tokens: int,
    execution_path: str = "direct",
    triggered_verification: bool = False,
    triggered_review: bool = False,
) -> None:
    """记录任务执行的上下文使用情况。

    从 helpers.md 中 ``recordContextUsage()`` 提取。
    """
    metrics = state.setdefault("contextMetrics", {
        "maxContextTokens": 0,
        "estimatedTokens": 0,
        "projectedNextTurnTokens": 0,
        "reservedExecutionTokens": 0,
        "reservedVerificationTokens": 0,
        "reservedReviewTokens": 0,
        "reservedSafetyBufferTokens": 0,
        "warningThreshold": 60,
        "dangerThreshold": 80,
        "hardHandoffThreshold": 90,
        "maxConsecutiveTasks": 5,
        "usagePercent": 0,
        "projectedUsagePercent": 0,
        "history": [],
    })

    history = metrics.setdefault("history", [])
    history.append({
        "taskId": task_id,
        "phase": phase,
        "preTaskTokens": pre_task_tokens,
        "postTaskTokens": post_task_tokens,
        "tokenDelta": post_task_tokens - pre_task_tokens,
        "executionPath": execution_path,
        "triggeredVerification": triggered_verification,
        "triggeredReview": triggered_review,
        "timestamp": datetime.now().isoformat(),
    })

    # Keep only last 20 entries
    if len(history) > 20:
        metrics["history"] = history[-20:]


def update_continuation(
    state: Dict[str, Any],
    action: str,
    reason: str,
    severity: str = "info",
    next_task_ids: Optional[List[str]] = None,
    handoff_required: bool = False,
    artifact_path: Optional[str] = None,
) -> None:
    """更新 continuation governance 状态。"""
    state["continuation"] = {
        "strategy": "budget-first",
        "last_decision": {
            "action": action,
            "reason": reason,
            "severity": severity,
            "nextTaskIds": next_task_ids or [],
            "suggestedExecutionPath": "direct",
        },
        "handoff_required": handoff_required,
        "artifact_path": artifact_path,
    }


def increment_consecutive_count(state: Dict[str, Any]) -> int:
    """递增连续执行计数。"""
    count = state.get("consecutive_count", 0) + 1
    state["consecutive_count"] = count
    return count


def reset_consecutive_count(state: Dict[str, Any]) -> None:
    """重置连续执行计数。"""
    state["consecutive_count"] = 0


# =============================================================================
# Progress Helpers
# =============================================================================


def calculate_progress(
    total_tasks: int,
    completed: List[str],
    skipped: List[str],
    failed: List[str],
) -> int:
    """计算工作流进度百分比。

    >>> calculate_progress(10, ["T1", "T2"], ["T3"], [])
    30
    """
    if total_tasks == 0:
        return 0
    finished = len(completed) + len(skipped) + len(failed)
    return round((finished / total_tasks) * 100)


def generate_progress_bar(percent: int) -> str:
    """生成进度条字符串。

    >>> generate_progress_bar(60)
    '[████████████░░░░░░░░] 60%'
    """
    filled = round(percent / 5)
    bar = "█" * filled + "░" * (20 - filled)
    return f"[{bar}] {percent}%"


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="工作流状态管理器")
    sub = parser.add_subparsers(dest="command")

    # read
    p_read = sub.add_parser("read", help="读取状态文件")
    p_read.add_argument("path", help="状态文件路径")

    # complete
    p_complete = sub.add_parser("complete", help="标记工作流完成")
    p_complete.add_argument("path", help="状态文件路径")
    p_complete.add_argument("--total-tasks", type=int, required=True, help="任务总数")

    # error
    p_error = sub.add_parser("error", help="记录任务错误")
    p_error.add_argument("path", help="状态文件路径")
    p_error.add_argument("--task-id", required=True, help="任务 ID")
    p_error.add_argument("--task-name", required=True, help="任务名称")
    p_error.add_argument("--message", required=True, help="错误信息")

    # progress
    p_progress = sub.add_parser("progress", help="计算进度")
    p_progress.add_argument("path", help="状态文件路径")

    args = parser.parse_args()

    if args.command == "read":
        state = read_state(args.path)
        print(json.dumps(state, indent=2, ensure_ascii=False))

    elif args.command == "complete":
        state = read_state(args.path)
        stats = complete_workflow(state, args.path, args.total_tasks)
        print(json.dumps(stats, ensure_ascii=False))

    elif args.command == "error":
        state = read_state(args.path)
        handle_task_error(state, args.path, args.task_id, args.task_name, args.message)
        print(json.dumps({"recorded": True}))

    elif args.command == "progress":
        state = read_state(args.path)
        progress = state.get("progress", {})
        total = state.get("_total_tasks", 0)
        pct = calculate_progress(
            total,
            progress.get("completed", []),
            progress.get("skipped", []),
            progress.get("failed", []),
        )
        bar = generate_progress_bar(pct)
        print(json.dumps({"percent": pct, "bar": bar}))

    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
