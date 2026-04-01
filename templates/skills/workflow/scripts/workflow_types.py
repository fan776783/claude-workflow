#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow 共享数据类型与状态契约 helper。

集中定义 state / traceability / quality gate 的稳定结构，
供 start / execute / review / delta 等后续模块复用。
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


# =============================================================================
# Constants
# =============================================================================

MINIMUM_PROGRESS = {
    "completed": [],
    "blocked": [],
    "failed": [],
    "skipped": [],
}

MINIMUM_DELTA_TRACKING = {
    "enabled": True,
    "changes_dir": "changes/",
    "current_change": None,
    "applied_changes": [],
    "change_counter": 0,
}

MINIMUM_API_CONTEXT = {
    "interfaces": [],
    "lastSync": None,
    "source": None,
    "version": None,
}

MINIMUM_GIT_STATUS = {
    "initialized": False,
    "subagent_available": False,
    "user_acknowledged_degradation": False,
}

MINIMUM_SESSIONS = {
    "platform": "claude-code",
    "executor": None,
}

MINIMUM_STATE_STATUSES = {
    "idle",
    "spec_review",
    "planning",
    "planned",
    "running",
    "paused",
    "blocked",
    "failed",
    "completed",
    "archived",
}


# =============================================================================
# Dataclasses
# =============================================================================


@dataclass
class RequirementRecord:
    id: str
    summary: str
    scope_status: str = "in_scope"
    constraints: List[str] = field(default_factory=list)
    owner: str = "shared"
    exclusion_reason: Optional[str] = None


@dataclass
class ReviewStageResult:
    passed: bool = False
    attempts: int = 0
    completed_at: Optional[str] = None
    issues_found: int = 0
    assessment: Optional[str] = None
    critical_count: int = 0
    important_count: int = 0
    minor_count: int = 0


@dataclass
class QualityGateRecord:
    gate_task_id: str
    review_mode: str = "machine_loop"
    last_decision: str = "revise"
    stage1: Dict[str, Any] = field(default_factory=dict)
    stage2: Dict[str, Any] = field(default_factory=dict)
    overall_passed: bool = False
    reviewed_at: Optional[str] = None


@dataclass
class DiscussionRecord:
    completed: bool = False
    artifact_path: Optional[str] = None
    clarification_count: int = 0


@dataclass
class UserSpecReviewRecord:
    status: str = "pending"
    review_mode: str = "human_gate"
    reviewed_at: Optional[str] = None
    reviewer: str = "user"
    next_action: Optional[str] = None


@dataclass
class UXDesignRecord:
    completed: bool = False
    artifact_path: Optional[str] = None
    flowchart_scenarios: int = 0
    page_count: int = 0
    approved_at: Optional[str] = None


@dataclass
class ContinuationDecision:
    action: str
    reason: str
    severity: str = "info"
    nextTaskIds: List[str] = field(default_factory=list)
    suggestedExecutionPath: str = "direct"


@dataclass
class ContinuationRecord:
    strategy: str = "budget-first"
    last_decision: Optional[ContinuationDecision] = None
    handoff_required: bool = False
    artifact_path: Optional[str] = None


# =============================================================================
# State helpers
# =============================================================================


def iso_now() -> str:
    return datetime.now().isoformat()


def copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def build_minimum_state(
    project_id: str,
    plan_file: str,
    spec_file: str,
    current_tasks: Optional[List[str]] = None,
    status: str = "running",
) -> Dict[str, Any]:
    if status not in MINIMUM_STATE_STATUSES:
        raise ValueError(f"invalid workflow status: {status}")

    now = iso_now()
    return {
        "project_id": project_id,
        "status": status,
        "current_tasks": current_tasks or [],
        "plan_file": plan_file,
        "spec_file": spec_file,
        "progress": copy_json(MINIMUM_PROGRESS),
        "created_at": now,
        "updated_at": now,
    }


def ensure_state_defaults(state: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(state)
    if not normalized.get("project_id") and normalized.get("projectId"):
        normalized["project_id"] = normalized["projectId"]
    normalized.setdefault("status", "idle")
    normalized.setdefault("current_tasks", [])
    normalized.setdefault("progress", {})

    progress = normalized["progress"]
    for key, default in MINIMUM_PROGRESS.items():
        progress.setdefault(key, list(default))

    normalized.setdefault("quality_gates", {})
    normalized.setdefault("unblocked", [])
    normalized.setdefault("sessions", copy_json(MINIMUM_SESSIONS))
    normalized.setdefault("delta_tracking", copy_json(MINIMUM_DELTA_TRACKING))
    normalized.setdefault("git_status", copy_json(MINIMUM_GIT_STATUS))
    normalized.setdefault("review_status", {})
    normalized.setdefault("api_context", copy_json(MINIMUM_API_CONTEXT))
    normalized.setdefault("discussion", to_dict(DiscussionRecord()))
    normalized.setdefault("ux_design", to_dict(UXDesignRecord()))
    review_status = normalized["review_status"]
    review_status.setdefault("user_spec_review", to_dict(UserSpecReviewRecord()))
    normalized.setdefault("failure_reason", None)
    normalized.setdefault("created_at", normalized.get("updated_at") or iso_now())
    normalized.setdefault("updated_at", iso_now())
    return normalized


def normalize_quality_gate_record(task_id: str, record: Dict[str, Any]) -> Dict[str, Any]:
    normalized = {
        "gate_task_id": record.get("gate_task_id") or task_id,
        "review_mode": record.get("review_mode") or "machine_loop",
        "last_decision": record.get("last_decision") or "revise",
        "stage1": record.get("stage1") or {},
        "stage2": record.get("stage2") or {},
        "overall_passed": bool(record.get("overall_passed", False)),
        "reviewed_at": record.get("reviewed_at"),
    }
    return normalized


def get_review_result(state: Dict[str, Any], task_id: str) -> Optional[Dict[str, Any]]:
    quality_gates = state.get("quality_gates") or {}
    if task_id in quality_gates:
        return normalize_quality_gate_record(task_id, quality_gates[task_id])

    execution_reviews = state.get("execution_reviews") or {}
    legacy = execution_reviews.get(task_id)
    if not legacy:
        return None

    stage1 = legacy.get("spec_compliance") or legacy.get("stage1") or {}
    stage2 = legacy.get("code_quality") or legacy.get("stage2") or {}
    overall = legacy.get("overall_passed")
    if overall is None:
        overall = bool(stage1.get("passed")) and bool(stage2.get("passed"))

    return normalize_quality_gate_record(
        task_id,
        {
            "gate_task_id": task_id,
            "review_mode": legacy.get("review_mode") or "machine_loop",
            "last_decision": legacy.get("last_decision") or "revise",
            "stage1": stage1,
            "stage2": stage2,
            "overall_passed": overall,
            "reviewed_at": legacy.get("reviewed_at"),
        },
    )


def summarize_progress(state: Dict[str, Any]) -> Dict[str, int]:
    progress = ensure_state_defaults(state).get("progress", {})
    return {
        "completed": len(progress.get("completed", [])),
        "blocked": len(progress.get("blocked", [])),
        "failed": len(progress.get("failed", [])),
        "skipped": len(progress.get("skipped", [])),
    }


def build_user_spec_review(
    status: str,
    next_action: Optional[str],
    reviewer: str = "user",
    review_mode: str = "human_gate",
) -> Dict[str, Any]:
    return to_dict(
        UserSpecReviewRecord(
            status=status,
            review_mode=review_mode,
            reviewed_at=iso_now(),
            reviewer=reviewer,
            next_action=next_action,
        )
    )


def next_change_id(delta_tracking: Optional[Dict[str, Any]]) -> str:
    tracking = delta_tracking or {}
    counter = int(tracking.get("change_counter") or 0) + 1
    return f"CHG-{counter:03d}"


# =============================================================================
# Serialization
# =============================================================================


def to_dict(value: Any) -> Dict[str, Any]:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    raise TypeError("value must be a dataclass instance")


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="workflow 共享类型与状态契约工具")
    sub = parser.add_subparsers(dest="command")

    p_min = sub.add_parser("minimum-state", help="生成最小状态结构")
    p_min.add_argument("project_id")
    p_min.add_argument("plan_file")
    p_min.add_argument("spec_file")
    p_min.add_argument("--status", default="running")
    p_min.add_argument("--current-tasks", default="")

    p_norm = sub.add_parser("normalize-state", help="标准化状态 JSON")
    p_norm.add_argument("file", help="state json file")

    p_review = sub.add_parser("review-result", help="读取任务审查结果（含 legacy fallback）")
    p_review.add_argument("file", help="state json file")
    p_review.add_argument("task_id")

    args = parser.parse_args()

    if args.command == "minimum-state":
        current_tasks = [x.strip() for x in args.current_tasks.split(",") if x.strip()]
        result = build_minimum_state(
            args.project_id,
            args.plan_file,
            args.spec_file,
            current_tasks=current_tasks,
            status=args.status,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "normalize-state":
        with open(args.file, "r", encoding="utf-8") as f:
            state = json.load(f)
        print(json.dumps(ensure_state_defaults(state), indent=2, ensure_ascii=False))
        return 0

    if args.command == "review-result":
        with open(args.file, "r", encoding="utf-8") as f:
            state = json.load(f)
        print(json.dumps({"review": get_review_result(state, args.task_id)}, indent=2, ensure_ascii=False))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
