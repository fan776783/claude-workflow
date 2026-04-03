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

from path_utils import (
    assert_canonical_workflow_state_path,
    detect_project_id_from_root,
    get_workflow_state_path,
)
from status_utils import add_unique
from workflow_types import ensure_state_defaults, get_review_result, next_change_id, build_user_spec_review


# =============================================================================
# State I/O
# =============================================================================


def resolve_state_path(project_id: str) -> str:
    """通过项目 ID 解析 canonical state 路径。"""
    state_path = get_workflow_state_path(project_id)
    if not state_path:
        raise ValueError(f"invalid project id: {project_id}")
    return assert_canonical_workflow_state_path(state_path, project_id)


def resolve_cli_state_path(path_or_project: str) -> str:
    try:
        return assert_canonical_workflow_state_path(path_or_project)
    except ValueError:
        return resolve_state_path(path_or_project)


def read_state(state_path: str, project_id: Optional[str] = None) -> Dict[str, Any]:
    """读取 workflow-state.json。

    Args:
        state_path: 状态文件路径

    Returns:
        解析后的状态字典

    Raises:
        FileNotFoundError: 文件不存在
        json.JSONDecodeError: JSON 格式错误
    """
    resolved_path = assert_canonical_workflow_state_path(state_path, project_id)
    with open(resolved_path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_state(state_path: str, state: Dict[str, Any], project_id: Optional[str] = None) -> None:
    """原子写入 workflow-state.json。

    使用临时文件 + rename 确保写入不会导致文件损坏。
    """
    resolved_path = assert_canonical_workflow_state_path(state_path, project_id or str(state.get("project_id") or ""))
    state = normalize_for_write(state)
    state["updated_at"] = datetime.now().isoformat()

    dir_path = os.path.dirname(resolved_path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_path, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
        # Atomic rename (on same filesystem)
        os.replace(tmp_path, resolved_path)
    except Exception:
        # Clean up temp file on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def read_state_from_project(project_id: str) -> Optional[Dict[str, Any]]:
    """通过项目 ID 读取状态文件。"""
    try:
        state_path = resolve_state_path(project_id)
    except ValueError:
        return None
    if not os.path.isfile(state_path):
        return None
    return read_state(state_path, project_id)


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
    suggested_execution_path: str = "direct",
    primary_signals: Optional[Dict[str, Any]] = None,
    budget_backstop_triggered: bool = False,
    budget_level: str = "safe",
    decision_notes: Optional[List[str]] = None,
) -> None:
    """更新 continuation governance 状态。"""
    state["continuation"] = {
        "strategy": "context-first",
        "last_decision": {
            "action": action,
            "reason": reason,
            "severity": severity,
            "nextTaskIds": next_task_ids or [],
            "suggestedExecutionPath": suggested_execution_path,
            "primarySignals": primary_signals or {},
            "budgetBackstopTriggered": budget_backstop_triggered,
            "budgetLevel": budget_level,
            "decisionNotes": decision_notes or [],
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


def resolve_cli_project_id(args: Any) -> Optional[str]:
    project_id = getattr(args, "project_id", None)
    if project_id:
        return project_id
    project_root = getattr(args, "project_root", None)
    return detect_project_id_from_root(project_root)


# =============================================================================
# CLI Entry
# =============================================================================


def state_file_exists(state_path: str) -> bool:
    return os.path.isfile(state_path)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="工作流状态管理器")
    parser.add_argument("--project-id", help="项目 ID（不指定则自动检测）")
    parser.add_argument("--project-root", help="项目根目录（用于自动检测项目 ID）")
    sub = parser.add_subparsers(dest="command")

    # read
    p_read = sub.add_parser("read", help="读取状态文件")
    p_read.add_argument("path", nargs="?")

    # complete
    p_complete = sub.add_parser("complete", help="标记工作流完成")
    p_complete.add_argument("path", nargs="?")
    p_complete.add_argument("--total-tasks", type=int, required=True, help="任务总数")

    # error
    p_error = sub.add_parser("error", help="记录任务错误")
    p_error.add_argument("path", nargs="?")
    p_error.add_argument("--task-id", required=True, help="任务 ID")
    p_error.add_argument("--task-name", required=True, help="任务名称")
    p_error.add_argument("--message", required=True, help="错误信息")

    # progress
    p_progress = sub.add_parser("progress", help="计算进度")
    p_progress.add_argument("path", nargs="?")

    # review-result
    p_review = sub.add_parser("review-result", help="读取任务审查结果（兼容 quality_gates / execution_reviews）")
    p_review.add_argument("path", nargs="?")
    p_review.add_argument("--task-id", required=True, help="任务 ID")

    args = parser.parse_args()
    state_path_arg = getattr(args, "path", None)
    if state_path_arg:
        try:
            state_path = resolve_cli_state_path(state_path_arg)
            project_id = None
        except ValueError as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False))
            return 1
    else:
        project_id = resolve_cli_project_id(args)
        if not project_id:
            print(json.dumps({"error": "无法检测项目 ID，请使用 --project-id 或 --project-root 指定"}, ensure_ascii=False))
            return 1

        try:
            state_path = resolve_state_path(project_id)
        except ValueError as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False))
            return 1

    if args.command == "read":
        if not state_file_exists(state_path):
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = read_state(state_path, project_id)
        print(json.dumps(state, indent=2, ensure_ascii=False))

    elif args.command == "complete":
        if not state_file_exists(state_path):
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = read_state(state_path, project_id)
        stats = complete_workflow(state, state_path, args.total_tasks)
        print(json.dumps(stats, ensure_ascii=False))

    elif args.command == "error":
        if not state_file_exists(state_path):
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = read_state(state_path, project_id)
        handle_task_error(state, state_path, args.task_id, args.task_name, args.message)
        print(json.dumps({"recorded": True}))

    elif args.command == "progress":
        if not state_file_exists(state_path):
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = read_state(state_path, project_id)
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

    elif args.command == "review-result":
        if not state_file_exists(state_path):
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = read_state(state_path, project_id)
        result = get_review_result(state, args.task_id)
        if result is None:
            print(json.dumps({"found": False, "task_id": args.task_id}, ensure_ascii=False))
        else:
            print(json.dumps({"found": True, "task_id": args.task_id, "result": result}, ensure_ascii=False, indent=2))

    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
