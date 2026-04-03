#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
execution sequencer helper。

收敛 execute 阶段中与模式解析、下一任务推进、skip/retry 状态更新、
以及 ContextGovernor 决策相关的确定性逻辑。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from context_budget import calculate_max_tasks, detect_complexity, evaluate_budget_thresholds
from dependency_checker import summarize_task_independence
from path_utils import assert_canonical_workflow_state_path, detect_project_id_from_root, get_workflow_state_path, validate_project_id
from state_manager import read_state, update_continuation, write_state
from task_manager import detect_project_id, resolve_state_and_tasks
from task_parser import count_tasks, find_next_task, parse_tasks_v2, task_to_dict, update_task_status_in_markdown
from workflow_types import ensure_state_defaults

def load_project_config(project_root: Path) -> Optional[Dict[str, Any]]:
    config_path = project_root / ".claude" / "config" / "project-config.json"
    if not config_path.is_file():
        return None
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def extract_project_id(config: Optional[Dict[str, Any]]) -> Optional[str]:
    if not config:
        return None
    project = config.get("project") or {}
    project_id = project.get("id") or config.get("projectId")
    if not validate_project_id(str(project_id or "")):
        return None
    return str(project_id)


def resolve_state_path_for_project(project_id: str) -> Optional[str]:
    return get_workflow_state_path(project_id) if validate_project_id(project_id) else None


def resolve_cli_state_path(state_or_project: str) -> Optional[str]:
    if validate_project_id(state_or_project):
        return resolve_state_path_for_project(state_or_project)
    try:
        return assert_canonical_workflow_state_path(state_or_project)
    except ValueError:
        return None


def resolve_existing_state_path(state_or_project: str) -> Optional[str]:
    state_path = resolve_cli_state_path(state_or_project)
    if not state_path or not Path(state_path).is_file():
        return None
    return state_path


def build_execute_entry(
    command: str,
    intent: Optional[str],
    explicit_mode: Optional[str],
    project_root: Path,
) -> Dict[str, Any]:
    config = load_project_config(project_root)
    project_id = extract_project_id(config) or detect_project_id(str(project_root))
    context = load_execution_context(project_id=project_id, project_root=str(project_root))
    state = context.get("state") if "error" not in context else None

    if command == "execute":
        preferred_mode = state.get("execution_mode") if state else None
        resolved_mode = resolve_execution_mode(explicit_mode or intent, preferred_mode)
        result = {
            "entry_action": "execute",
            "resolved_mode": resolved_mode,
            "project_id": project_id,
            "state_status": state.get("status") if state else None,
            "can_resume": bool(state),
            "reason": "explicit_execute",
        }
        if intent and not explicit_mode and resolved_mode == (preferred_mode or "continuous") and intent not in VALID_EXECUTION_MODES:
            result["warning"] = f"unrecognized_intent:{intent}"
        return result

    if command == "continue":
        if not state:
            return {
                "entry_action": "none",
                "project_id": project_id,
                "state_status": None,
                "can_resume": False,
                "reason": "no_active_workflow",
                "message": "未发现活动工作流，请先执行 /workflow status 或 /workflow execute。",
            }

        status = state.get("status")
        if status not in {"running", "paused", "failed", "blocked"}:
            return {
                "entry_action": "none",
                "project_id": project_id,
                "state_status": status,
                "can_resume": False,
                "reason": "status_not_resumable",
                "message": f"当前状态 {status} 不支持直接恢复，请使用 /workflow status 查看详情。",
            }

        continuation = state.get("continuation") or {}
        preferred_mode = state.get("execution_mode") or "continuous"
        resolved_mode = resolve_execution_mode(explicit_mode or intent, preferred_mode)
        last_decision = continuation.get("last_decision") or {}
        result = {
            "entry_action": "execute",
            "resolved_mode": resolved_mode,
            "project_id": project_id,
            "state_status": status,
            "can_resume": True,
            "reason": "implicit_continue_resume",
            "continuation_action": last_decision.get("action"),
            "continuation_reason": last_decision.get("reason"),
        }
        if intent and not explicit_mode and resolved_mode == preferred_mode and intent not in VALID_EXECUTION_MODES:
            result["warning"] = f"unrecognized_intent:{intent}"
        return result

    return {
        "entry_action": "none",
        "project_id": project_id,
        "state_status": state.get("status") if state else None,
        "can_resume": False,
        "reason": "unknown_command",
    }
VALID_EXECUTION_MODES = {"continuous", "phase", "retry", "skip"}
HARD_STOP_ACTIONS = {
    "handoff-required",
    "pause-budget",
    "pause-governance",
    "pause-quality-gate",
    "pause-before-commit",
}


def load_execution_context(
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    state, state_path, tasks_content, tasks_path = resolve_state_and_tasks(project_id, project_root)
    if not state or not state_path:
        return {"error": "没有活跃的工作流"}

    normalized_state = ensure_state_defaults(state)
    tasks = parse_tasks_v2(tasks_content) if tasks_content else []
    current_task_id = (normalized_state.get("current_tasks") or [None])[0]
    current_task = next((task for task in tasks if task.id == current_task_id), None)

    if tasks_content:
        normalized_state["_tasks_content"] = tasks_content

    return {
        "state": normalized_state,
        "state_path": state_path,
        "tasks_content": tasks_content,
        "tasks_path": tasks_path,
        "tasks": tasks,
        "current_task": task_to_dict(current_task) if current_task else None,
        "current_task_id": current_task_id,
        "total_tasks": count_tasks(tasks_content) if tasks_content else 0,
    }


def resolve_execution_mode(
    override: Optional[str],
    state_mode: Optional[str],
) -> str:
    if override in VALID_EXECUTION_MODES:
        return override
    if state_mode in VALID_EXECUTION_MODES:
        return state_mode
    return "continuous"


def detect_next_task(
    tasks_content: Optional[str],
    state: Dict[str, Any],
) -> Optional[str]:
    if not tasks_content:
        return None
    progress = ensure_state_defaults(state).get("progress", {})
    return find_next_task(
        tasks_content,
        completed=progress.get("completed", []),
        skipped=progress.get("skipped", []),
        failed=progress.get("failed", []),
        blocked=progress.get("blocked", []),
    )


def assess_context_pollution_risk(
    task: Optional[Dict[str, Any]],
    budget: Dict[str, Any],
) -> Dict[str, Any]:
    """评估下一执行单元对主会话的上下文污染风险。"""
    if not task:
        return {
            "level": "medium",
            "reasons": ["缺少下一任务上下文，按中等污染风险处理"],
            "preferredExecutionPath": "direct",
        }

    actions = task.get("actions") or []
    verification = task.get("verification") or {}
    files = task.get("files") or {}
    steps = task.get("steps") or []
    reasons: List[str] = []

    if any(action in {"run_tests", "quality_review"} for action in actions):
        reasons.append("任务会产出测试或审查输出")
    if verification.get("commands"):
        reasons.append("任务包含显式验证命令")
    if len((files.get("test", []) or [])) > 0:
        reasons.append("任务直接涉及测试文件")
    if len(steps) >= 3:
        reasons.append("任务步骤较多，可能伴随更多中间过程")
    if budget.get("at_warning"):
        reasons.append("预算进入 warning 区，应避免继续污染主会话")

    if any(action == "quality_review" for action in actions):
        level = "high"
        preferred = "single-subagent"
    elif any(action == "run_tests" for action in actions) or len(reasons) >= 3:
        level = "high"
        preferred = "parallel-boundaries"
    elif reasons:
        level = "medium"
        preferred = "direct"
    else:
        level = "low"
        preferred = "direct"
        reasons.append("任务输出预期较聚焦")

    return {
        "level": level,
        "reasons": reasons,
        "preferredExecutionPath": preferred,
    }


def _build_decision(
    action: str,
    reason: str,
    severity: str,
    budget: Dict[str, Any],
    suggested_execution_path: str = "direct",
    primary_signals: Optional[Dict[str, Any]] = None,
    budget_backstop_triggered: bool = False,
    decision_notes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "action": action,
        "reason": reason,
        "severity": severity,
        "budget": budget,
        "suggestedExecutionPath": suggested_execution_path,
        "primarySignals": primary_signals or {},
        "budgetBackstopTriggered": budget_backstop_triggered,
        "budgetLevel": budget.get("level", "safe"),
        "decisionNotes": decision_notes or [],
    }


def decide_governance_action(
    state: Dict[str, Any],
    next_task: Optional[Dict[str, Any]] = None,
    execution_mode: str = "continuous",
    pause_before_commit: bool = False,
    has_parallel_boundary: bool = False,
) -> Dict[str, Any]:
    normalized_state = ensure_state_defaults(state)
    metrics = normalized_state.get("contextMetrics") or {}
    projected_usage = float(metrics.get("projectedUsagePercent", metrics.get("usagePercent", 0)))
    warning = float(metrics.get("warningThreshold", 60))
    danger = float(metrics.get("dangerThreshold", 80))
    hard_handoff = float(metrics.get("hardHandoffThreshold", 90))
    budget = evaluate_budget_thresholds(projected_usage, warning, danger, hard_handoff)
    independence = summarize_task_independence(next_task, has_parallel_boundary=has_parallel_boundary)
    pollution = assess_context_pollution_risk(next_task, budget)
    primary_signals = {
        "taskIndependence": independence,
        "contextPollutionRisk": pollution,
    }

    if normalized_state.get("status") in {"failed", "blocked"}:
        action = "pause-governance"
        return _build_decision(
            action,
            f"status-{normalized_state.get('status')}",
            "warning",
            budget,
            primary_signals=primary_signals,
            decision_notes=["工作流已处于 failed/blocked 状态，优先暂停治理"],
        )

    if budget["at_hard_handoff"]:
        return _build_decision(
            "handoff-required",
            "hard-handoff-threshold",
            "critical",
            budget,
            primary_signals=primary_signals,
            budget_backstop_triggered=True,
            decision_notes=["预算达到硬停止阈值，必须交接"],
        )

    if next_task:
        actions = next_task.get("actions") or []
        if next_task.get("quality_gate") or "quality_review" in actions:
            return _build_decision(
                "pause-quality-gate",
                "quality-gate-boundary",
                "info",
                budget,
                primary_signals=primary_signals,
                decision_notes=["质量关卡优先按既有治理边界暂停"],
            )
        if pause_before_commit and "git_commit" in actions:
            return _build_decision(
                "pause-before-commit",
                "pause-before-commit",
                "info",
                budget,
                primary_signals=primary_signals,
                decision_notes=["提交前仍需人工确认"],
            )

    if execution_mode == "phase" and next_task:
        current_tasks = normalized_state.get("current_tasks") or []
        current_id = current_tasks[0] if current_tasks else None
        tasks_content = normalized_state.get("_tasks_content")
        parsed_tasks = parse_tasks_v2(tasks_content) if tasks_content else []
        current_task = next((task for task in parsed_tasks if task.id == current_id), None)
        current_phase = current_task.phase if current_task else None
        next_phase = next_task.get("phase")
        if current_phase and next_phase and current_phase != next_phase:
            return _build_decision(
                "pause-governance",
                "phase-boundary",
                "info",
                budget,
                primary_signals=primary_signals,
                decision_notes=["phase 模式下跨阶段仍暂停"],
            )

    if independence.get("parallelizable") and pollution.get("level") == "high":
        return _build_decision(
            "continue-parallel-boundaries",
            "independent-high-pollution",
            "info",
            budget,
            suggested_execution_path="parallel-boundaries",
            primary_signals=primary_signals,
            decision_notes=independence.get("reasons", []) + pollution.get("reasons", []),
        )

    if pollution.get("level") == "high" and independence.get("level") == "low":
        action = "pause-budget" if budget["at_danger"] else "pause-governance"
        reason = "context-danger" if budget["at_danger"] else "high-pollution-without-independent-boundary"
        return _build_decision(
            action,
            reason,
            "warning",
            budget,
            suggested_execution_path=pollution.get("preferredExecutionPath", "direct"),
            primary_signals=primary_signals,
            budget_backstop_triggered=budget["at_danger"],
            decision_notes=["高污染任务且缺少独立边界，不应继续扩张主会话"],
        )

    if budget["at_danger"] and pollution.get("preferredExecutionPath") == "direct":
        return _build_decision(
            "pause-budget",
            "context-danger",
            "warning",
            budget,
            primary_signals=primary_signals,
            budget_backstop_triggered=True,
            decision_notes=["预算危险区且建议路径仍会扩张主会话"],
        )

    return _build_decision(
        "continue-direct",
        "governor-allows",
        "info",
        budget,
        suggested_execution_path=pollution.get("preferredExecutionPath", "direct"),
        primary_signals=primary_signals,
        decision_notes=independence.get("reasons", []) + pollution.get("reasons", []),
    )


def apply_governance_decision(
    state: Dict[str, Any],
    decision: Dict[str, Any],
    state_path: Optional[str] = None,
    next_task_ids: Optional[List[str]] = None,
    artifact_path: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_state = ensure_state_defaults(state)
    action = decision.get("action", "continue-direct")
    reason = decision.get("reason", "unknown")
    severity = decision.get("severity", "info")
    handoff_required = action == "handoff-required"

    if action in HARD_STOP_ACTIONS:
        normalized_state["status"] = "paused"
        update_continuation(
            normalized_state,
            action=action,
            reason=reason,
            severity=severity,
            next_task_ids=next_task_ids or [],
            handoff_required=handoff_required,
            artifact_path=artifact_path,
            suggested_execution_path=decision.get("suggestedExecutionPath", "direct"),
            primary_signals=decision.get("primarySignals") or {},
            budget_backstop_triggered=bool(decision.get("budgetBackstopTriggered", False)),
            budget_level=decision.get("budgetLevel", "safe"),
            decision_notes=decision.get("decisionNotes") or [],
        )
        if state_path:
            write_state(state_path, normalized_state)

    return normalized_state


def update_after_task_completion(
    state: Dict[str, Any],
    tasks_content: str,
    completed_task_id: str,
) -> Dict[str, Any]:
    normalized_state = ensure_state_defaults(state)
    next_task_id = detect_next_task(tasks_content, normalized_state)
    if next_task_id:
        normalized_state["current_tasks"] = [next_task_id]
        normalized_state["status"] = "running"
    else:
        normalized_state["current_tasks"] = []
        normalized_state["status"] = "completed"
    return normalized_state


def prepare_parallel_sequential_fallback(
    state: Dict[str, Any],
    group_id: str,
    task_ids: List[str],
) -> Dict[str, Any]:
    normalized_state = ensure_state_defaults(state)
    rerun_task_ids = [task_id for task_id in task_ids if task_id]
    rerun_set = set(rerun_task_ids)

    progress = normalized_state.setdefault("progress", {})
    completed = progress.setdefault("completed", [])
    progress["completed"] = [task_id for task_id in completed if task_id not in rerun_set]

    parallel_groups = normalized_state.setdefault("parallel_groups", [])
    for group in parallel_groups:
        if group.get("id") == group_id:
            group["status"] = "failed"
            group["conflict_detected"] = True
            break

    normalized_state["current_tasks"] = rerun_task_ids
    normalized_state["status"] = "running" if rerun_task_ids else normalized_state.get("status", "running")
    normalized_state["failure_reason"] = None
    update_continuation(
        normalized_state,
        action="continue-direct",
        reason="parallel-conflict-sequential-fallback",
        severity="warning",
        next_task_ids=rerun_task_ids,
        handoff_required=False,
    )

    return {
        "group_id": group_id,
        "rerun_task_ids": rerun_task_ids,
        "workflow_status": normalized_state.get("status"),
        "conflict_detected": True,
        "state": normalized_state,
    }


def mark_task_skipped(
    state_path: str,
    tasks_path: str,
    tasks_content: str,
    task_id: str,
) -> Dict[str, Any]:
    state = ensure_state_defaults(read_state(state_path))
    progress = state.setdefault("progress", {})
    skipped = progress.setdefault("skipped", [])
    if task_id not in skipped:
        skipped.append(task_id)

    updated_content = update_task_status_in_markdown(tasks_content, task_id, "skipped")
    with open(tasks_path, "w", encoding="utf-8") as file:
        file.write(updated_content)

    next_task_id = detect_next_task(updated_content, state)
    if next_task_id:
        state["current_tasks"] = [next_task_id]
        state["status"] = "running"
    else:
        state["current_tasks"] = []
        state["status"] = "completed"

    write_state(state_path, state)
    return {
        "skipped": True,
        "task_id": task_id,
        "next_task_id": next_task_id,
        "workflow_status": state.get("status"),
    }


def prepare_retry(
    state_path: str,
    task_id: str,
    failure_reason: Optional[str] = None,
    failure_stage: str = "execution",
) -> Dict[str, Any]:
    state = ensure_state_defaults(read_state(state_path))
    if state.get("status") != "failed":
        return {
            "retryable": False,
            "reason": f"status-not-failed:{state.get('status')}",
            "task_id": task_id,
        }

    task_runtime = state.setdefault("task_runtime", {})
    runtime = task_runtime.setdefault(
        task_id,
        {
            "retry_count": 0,
            "last_failure_stage": failure_stage,
            "last_failure_reason": failure_reason or state.get("failure_reason") or "",
            "hard_stop_triggered": False,
            "debugging_phases_completed": [],
        },
    )
    runtime["retry_count"] = int(runtime.get("retry_count", 0)) + 1
    runtime["last_failure_stage"] = failure_stage
    runtime["last_failure_reason"] = failure_reason or state.get("failure_reason") or ""

    if runtime["retry_count"] >= 3:
        runtime["hard_stop_triggered"] = True
        write_state(state_path, state)
        return {
            "retryable": False,
            "reason": "hard-stop",
            "task_id": task_id,
            "retry_count": runtime["retry_count"],
        }

    state["status"] = "running"
    state["failure_reason"] = None
    write_state(state_path, state)
    return {
        "retryable": True,
        "task_id": task_id,
        "retry_count": runtime["retry_count"],
        "failure_stage": runtime["last_failure_stage"],
    }


def reset_retry_runtime(state_path: str, task_id: str) -> Dict[str, Any]:
    state = ensure_state_defaults(read_state(state_path))
    task_runtime = state.setdefault("task_runtime", {})
    runtime = task_runtime.setdefault(task_id, {})
    runtime["retry_count"] = 0
    runtime["debugging_phases_completed"] = []
    runtime["hard_stop_triggered"] = False
    write_state(state_path, state)
    return {"reset": True, "task_id": task_id}


def summarize_execution_unit(task: Dict[str, Any]) -> Dict[str, Any]:
    files = task.get("files") or {}
    file_count = len((files.get("create") or []) + (files.get("modify") or []) + (files.get("test") or []))
    actions = task.get("actions") or []
    complexity = detect_complexity(
        actions_count=len(actions),
        file_count=file_count,
        is_quality_gate=bool(task.get("quality_gate")),
        has_structured_steps=bool(task.get("steps")),
    )
    return {
        "task_id": task.get("id"),
        "phase": task.get("phase"),
        "complexity": complexity,
        "max_consecutive_tasks": calculate_max_tasks(complexity, 0),
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="execution sequencer helper")
    sub = parser.add_subparsers(dest="command")

    p_mode = sub.add_parser("resolve-mode", help="解析执行模式")
    p_mode.add_argument("--override")
    p_mode.add_argument("--state-mode")

    p_ctx = sub.add_parser("context", help="读取执行上下文")
    p_ctx.add_argument("--project-id")
    p_ctx.add_argument("--project-root")

    p_skip = sub.add_parser("skip", help="跳过当前任务")
    p_skip.add_argument("state_or_project")
    p_skip.add_argument("tasks_file")
    p_skip.add_argument("task_id")

    p_retry = sub.add_parser("retry", help="准备失败任务重试")
    p_retry.add_argument("state_or_project")
    p_retry.add_argument("task_id")
    p_retry.add_argument("--reason")
    p_retry.add_argument("--failure-stage", default="execution")

    p_retry_reset = sub.add_parser("retry-reset", help="重置任务重试运行时")
    p_retry_reset.add_argument("state_or_project")
    p_retry_reset.add_argument("task_id")

    p_decide = sub.add_parser("decide", help="执行 ContextGovernor 决策")
    p_decide.add_argument("state_or_project")
    p_decide.add_argument("--execution-mode", default="continuous")
    p_decide.add_argument("--pause-before-commit", action="store_true")
    p_decide.add_argument("--has-parallel-boundary", action="store_true")
    p_decide.add_argument("--next-task-json", default="")

    p_apply = sub.add_parser("apply-decision", help="写入 continuation 决策")
    p_apply.add_argument("state_or_project")
    p_apply.add_argument("--decision-json", required=True)
    p_apply.add_argument("--next-task-ids", default="")
    p_apply.add_argument("--artifact-path")

    p_parallel_fallback = sub.add_parser("parallel-fallback", help="准备并行冲突后的顺序降级状态")
    p_parallel_fallback.add_argument("state_or_project")
    p_parallel_fallback.add_argument("group_id")
    p_parallel_fallback.add_argument("--task-ids", required=True)

    args = parser.parse_args()

    if args.command == "resolve-mode":
        print(json.dumps({"execution_mode": resolve_execution_mode(args.override, args.state_mode)}, ensure_ascii=False))
        return 0

    if args.command == "context":
        result = load_execution_context(args.project_id, args.project_root)
        print(json.dumps(result, ensure_ascii=False))
        return 1 if "error" in result else 0

    if args.command == "skip":
        state_path = resolve_existing_state_path(args.state_or_project)
        if not state_path:
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        with open(args.tasks_file, "r", encoding="utf-8") as file:
            tasks_content = file.read()
        print(json.dumps(mark_task_skipped(state_path, args.tasks_file, tasks_content, args.task_id), ensure_ascii=False))
        return 0

    if args.command == "retry":
        state_path = resolve_existing_state_path(args.state_or_project)
        if not state_path:
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        print(json.dumps(prepare_retry(state_path, args.task_id, args.reason, args.failure_stage), ensure_ascii=False))
        return 0

    if args.command == "retry-reset":
        state_path = resolve_existing_state_path(args.state_or_project)
        if not state_path:
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        print(json.dumps(reset_retry_runtime(state_path, args.task_id), ensure_ascii=False))
        return 0

    if args.command == "decide":
        state_path = resolve_existing_state_path(args.state_or_project)
        if not state_path:
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = ensure_state_defaults(read_state(state_path))
        next_task = json.loads(args.next_task_json) if args.next_task_json else None
        print(json.dumps(decide_governance_action(state, next_task, args.execution_mode, args.pause_before_commit, args.has_parallel_boundary), ensure_ascii=False))
        return 0

    if args.command == "apply-decision":
        state_path = resolve_existing_state_path(args.state_or_project)
        if not state_path:
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = ensure_state_defaults(read_state(state_path))
        decision = json.loads(args.decision_json)
        next_task_ids = [item.strip() for item in args.next_task_ids.split(",") if item.strip()]
        updated_state = apply_governance_decision(state, decision, state_path, next_task_ids, args.artifact_path)
        print(json.dumps({"status": updated_state.get("status"), "continuation": updated_state.get("continuation")}, ensure_ascii=False))
        return 0

    if args.command == "parallel-fallback":
        state_path = resolve_existing_state_path(args.state_or_project)
        if not state_path:
            print(json.dumps({"error": "没有活跃的工作流"}, ensure_ascii=False))
            return 1
        state = ensure_state_defaults(read_state(state_path))
        task_ids = [item.strip() for item in args.task_ids.split(",") if item.strip()]
        result = prepare_parallel_sequential_fallback(state, args.group_id, task_ids)
        write_state(state_path, result["state"])
        print(json.dumps({
            "group_id": result["group_id"],
            "rerun_task_ids": result["rerun_task_ids"],
            "workflow_status": result["workflow_status"],
            "conflict_detected": result["conflict_detected"],
            "continuation": result["state"].get("continuation"),
        }, ensure_ascii=False))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
