#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
quality_review 执行侧 helper。

沉淀 execution side 两阶段审查的稳定数据结构与状态写入逻辑，
供 execute 阶段与后续 execution_sequencer 复用。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

from state_manager import read_state, write_state
from verification import create_evidence
from workflow_types import ensure_state_defaults, get_review_result

GATE_BUDGET = {
    "max_total_loops": 4,
    "max_diff_context_chars": 50000,
    "cache_stage1": True,
}


def iso_now() -> str:
    return datetime.now().isoformat()


def create_review_subject(
    base_commit: str,
    requirement_ids: Optional[List[str]] = None,
    critical_constraints: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "kind": "diff_window",
        "ref": f"{base_commit}..HEAD",
        "requirement_ids": requirement_ids or [],
        "critical_constraints": critical_constraints or [],
    }


def create_diff_window(
    base_commit: str,
    from_task: Optional[str] = None,
    to_task: Optional[str] = None,
    files_changed: int = 0,
) -> Dict[str, Any]:
    return {
        "base_commit": base_commit,
        "from_task": from_task,
        "to_task": to_task,
        "files_changed": files_changed,
    }


def extract_issue_count(result: Optional[Dict[str, Any]]) -> int:
    if not result:
        return 0

    total = 0
    for key in ("missing", "extra", "misunderstandings", "coverage_gaps", "blocking_issues"):
        value = result.get(key)
        if isinstance(value, list):
            total += len(value)

    issues = result.get("issues")
    if isinstance(issues, dict):
        for key in ("critical", "important", "minor"):
            value = issues.get(key)
            if isinstance(value, list):
                total += len(value)

    return total


def collect_blocking_issues(result: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not result:
        return []

    blocking = result.get("blocking_issues")
    if isinstance(blocking, list):
        return blocking

    collected: List[Dict[str, Any]] = []
    for key in ("missing", "extra", "misunderstandings", "coverage_gaps"):
        value = result.get(key)
        if not isinstance(value, list):
            continue
        for item in value:
            if isinstance(item, dict):
                collected.append(item)
            else:
                collected.append({"description": str(item)})

    issues = result.get("issues")
    if isinstance(issues, dict):
        for level in ("critical", "important"):
            value = issues.get(level)
            if not isinstance(value, list):
                continue
            for item in value:
                if isinstance(item, dict):
                    collected.append(item)
                else:
                    collected.append({"description": str(item), "severity": level})

    return collected


def build_pass_gate_result(
    task_id: str,
    base_commit: str,
    current_commit: Optional[str] = None,
    from_task: Optional[str] = None,
    to_task: Optional[str] = None,
    files_changed: int = 0,
    requirement_ids: Optional[List[str]] = None,
    critical_constraints: Optional[List[str]] = None,
    stage1_attempts: int = 1,
    stage2_attempts: int = 1,
    stage1_issues_found: int = 0,
    critical_count: int = 0,
    important_count: int = 0,
    minor_count: int = 0,
    reviewer: str = "subagent",
) -> Dict[str, Any]:
    attempts = stage1_attempts + stage2_attempts
    now = iso_now()
    return {
        "review_type": "quality_review",
        "review_mode": "machine_loop",
        "gate_task_id": task_id,
        "subject": create_review_subject(base_commit, requirement_ids, critical_constraints),
        "max_attempts": GATE_BUDGET["max_total_loops"],
        "attempt": attempts,
        "last_decision": "pass",
        "next_action": "continue_execution",
        "commit_hash": current_commit or base_commit,
        "diff_window": create_diff_window(base_commit, from_task, to_task, files_changed),
        "stage1": {
            "passed": True,
            "attempts": stage1_attempts,
            "issues_found": stage1_issues_found,
            "completed_at": now,
        },
        "stage2": {
            "passed": True,
            "attempts": stage2_attempts,
            "assessment": "approved",
            "critical_count": critical_count,
            "important_count": important_count,
            "minor_count": minor_count,
            "completed_at": now,
        },
        "overall_passed": True,
        "reviewed_at": now,
        "reviewer": reviewer,
    }


def build_failed_gate_result(
    task_id: str,
    failed_stage: str,
    base_commit: str,
    current_commit: Optional[str] = None,
    from_task: Optional[str] = None,
    to_task: Optional[str] = None,
    files_changed: int = 0,
    requirement_ids: Optional[List[str]] = None,
    critical_constraints: Optional[List[str]] = None,
    stage1_attempts: int = 1,
    total_attempts: int = 1,
    last_result: Optional[Dict[str, Any]] = None,
    reviewer: str = "subagent",
) -> Dict[str, Any]:
    budget_exhausted = total_attempts > GATE_BUDGET["max_total_loops"]
    terminal_decision = "rejected" if budget_exhausted or failed_stage == "stage2" else "revise"
    next_action = "mark_task_failed_or_escalate" if terminal_decision == "rejected" else "fix_and_retry_or_escalate"
    now = iso_now()

    result: Dict[str, Any] = {
        "review_type": "quality_review",
        "review_mode": "machine_loop",
        "gate_task_id": task_id,
        "subject": create_review_subject(base_commit, requirement_ids, critical_constraints),
        "max_attempts": GATE_BUDGET["max_total_loops"],
        "attempt": total_attempts,
        "last_decision": terminal_decision,
        "next_action": next_action,
        "blocking_issues": collect_blocking_issues(last_result),
        "reviewed_at": now,
        "reviewer": reviewer,
        "commit_hash": current_commit or base_commit,
        "diff_window": create_diff_window(base_commit, from_task, to_task, files_changed),
        "stage1": {
            "passed": failed_stage != "stage1",
            "attempts": stage1_attempts,
            "issues_found": extract_issue_count(last_result),
            "completed_at": now,
        },
        "overall_passed": False,
    }

    if failed_stage != "stage1":
        issues = last_result.get("issues") if isinstance(last_result, dict) else {}
        result["stage2"] = {
            "passed": False,
            "attempts": max(total_attempts - stage1_attempts, 0),
            "assessment": (last_result or {}).get("assessment", "rejected"),
            "critical_count": len((issues or {}).get("critical", []) or []),
            "important_count": len((issues or {}).get("important", []) or []),
            "minor_count": len((issues or {}).get("minor", []) or []),
            "completed_at": now,
        }

    return result


def write_quality_gate_result(
    state_path: str,
    task_id: str,
    gate_result: Dict[str, Any],
) -> Dict[str, Any]:
    state = ensure_state_defaults(read_state(state_path))
    quality_gates = state.setdefault("quality_gates", {})
    quality_gates[task_id] = gate_result
    write_state(state_path, state)
    return gate_result


def read_quality_gate_result(state_path: str, task_id: str) -> Optional[Dict[str, Any]]:
    state = ensure_state_defaults(read_state(state_path))
    return get_review_result(state, task_id)


def create_quality_review_evidence(task_id: str, gate_result: Dict[str, Any]) -> Dict[str, Any]:
    passed = bool(gate_result.get("overall_passed"))
    stage1 = gate_result.get("stage1") or {}
    stage2 = gate_result.get("stage2") or {}
    output_summary = (
        f"Stage 1 passed={stage1.get('passed', False)} attempts={stage1.get('attempts', 0)}, "
        f"Stage 2 passed={stage2.get('passed', False)} attempts={stage2.get('attempts', 0)}, "
        f"decision={gate_result.get('last_decision')}"
    )
    return create_evidence(
        command="two-stage code review",
        exit_code=0 if passed else 1,
        output_summary=output_summary,
        passed=passed,
        artifact_ref=f"quality_gates.{task_id}",
    )


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="quality_review 执行侧 helper")
    sub = parser.add_subparsers(dest="command")

    p_pass = sub.add_parser("pass", help="生成通过态 quality gate 结果")
    p_pass.add_argument("task_id")
    p_pass.add_argument("--base-commit", required=True)
    p_pass.add_argument("--current-commit")
    p_pass.add_argument("--from-task")
    p_pass.add_argument("--to-task")
    p_pass.add_argument("--files-changed", type=int, default=0)
    p_pass.add_argument("--stage1-attempts", type=int, default=1)
    p_pass.add_argument("--stage2-attempts", type=int, default=1)
    p_pass.add_argument("--stage1-issues-found", type=int, default=0)
    p_pass.add_argument("--critical-count", type=int, default=0)
    p_pass.add_argument("--important-count", type=int, default=0)
    p_pass.add_argument("--minor-count", type=int, default=0)
    p_pass.add_argument("--requirement-ids", default="")
    p_pass.add_argument("--critical-constraints", default="")
    p_pass.add_argument("--reviewer", default="subagent")
    p_pass.add_argument("--state-file")

    p_fail = sub.add_parser("fail", help="生成失败态 quality gate 结果")
    p_fail.add_argument("task_id")
    p_fail.add_argument("--failed-stage", choices=["stage1", "stage2", "stage1_recheck"], required=True)
    p_fail.add_argument("--base-commit", required=True)
    p_fail.add_argument("--current-commit")
    p_fail.add_argument("--from-task")
    p_fail.add_argument("--to-task")
    p_fail.add_argument("--files-changed", type=int, default=0)
    p_fail.add_argument("--stage1-attempts", type=int, default=1)
    p_fail.add_argument("--total-attempts", type=int, default=1)
    p_fail.add_argument("--requirement-ids", default="")
    p_fail.add_argument("--critical-constraints", default="")
    p_fail.add_argument("--reviewer", default="subagent")
    p_fail.add_argument("--last-result-json", default="{}")
    p_fail.add_argument("--state-file")

    p_read = sub.add_parser("read", help="读取 quality gate 结果")
    p_read.add_argument("state_file")
    p_read.add_argument("task_id")

    sub.add_parser("budget", help="读取 quality review 预算")

    args = parser.parse_args()
    split = lambda s: [item.strip() for item in s.split(",") if item.strip()]

    if args.command == "pass":
        gate_result = build_pass_gate_result(
            args.task_id,
            args.base_commit,
            current_commit=args.current_commit,
            from_task=args.from_task,
            to_task=args.to_task,
            files_changed=args.files_changed,
            requirement_ids=split(args.requirement_ids),
            critical_constraints=split(args.critical_constraints),
            stage1_attempts=args.stage1_attempts,
            stage2_attempts=args.stage2_attempts,
            stage1_issues_found=args.stage1_issues_found,
            critical_count=args.critical_count,
            important_count=args.important_count,
            minor_count=args.minor_count,
            reviewer=args.reviewer,
        )
        if args.state_file:
            write_quality_gate_result(args.state_file, args.task_id, gate_result)
        print(json.dumps({"gate_result": gate_result, "evidence": create_quality_review_evidence(args.task_id, gate_result)}, ensure_ascii=False))
        return 0

    if args.command == "fail":
        try:
            last_result = json.loads(args.last_result_json)
        except json.JSONDecodeError as error:
            print(json.dumps({"error": f"invalid last-result-json: {error}"}, ensure_ascii=False))
            return 1
        gate_result = build_failed_gate_result(
            args.task_id,
            args.failed_stage,
            args.base_commit,
            current_commit=args.current_commit,
            from_task=args.from_task,
            to_task=args.to_task,
            files_changed=args.files_changed,
            requirement_ids=split(args.requirement_ids),
            critical_constraints=split(args.critical_constraints),
            stage1_attempts=args.stage1_attempts,
            total_attempts=args.total_attempts,
            last_result=last_result,
            reviewer=args.reviewer,
        )
        if args.state_file:
            write_quality_gate_result(args.state_file, args.task_id, gate_result)
        print(json.dumps({"gate_result": gate_result, "evidence": create_quality_review_evidence(args.task_id, gate_result)}, ensure_ascii=False))
        return 0

    if args.command == "read":
        print(json.dumps({"review": read_quality_gate_result(args.state_file, args.task_id)}, ensure_ascii=False))
        return 0

    if args.command == "budget":
        print(json.dumps(GATE_BUDGET, ensure_ascii=False))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
