#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow 需求追溯 helper。

提供 spec → plan → execution 三层间的基础校验逻辑，
避免后续 start / review / validation 各自复制 requirement 映射规则。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from task_parser import WorkflowTaskV2


REQUIREMENT_ID_REGEX = re.compile(r"R-\d{3}")
PLACEHOLDER_REGEX = re.compile(r"\b(?:TBD|TODO|待补充|待确认|similar to Task)\b", re.IGNORECASE)


@dataclass
class RequirementTrace:
    id: str
    summary: str
    scope_status: str = "in_scope"
    constraints: List[str] = field(default_factory=list)
    owner: str = "shared"
    exclusion_reason: Optional[str] = None


@dataclass
class PlanTaskTrace:
    id: str
    name: str
    spec_ref: str
    requirement_ids: List[str] = field(default_factory=list)
    files: List[str] = field(default_factory=list)
    step_count: int = 0


def extract_requirement_ids(text: str) -> List[str]:
    seen = []
    for requirement_id in REQUIREMENT_ID_REGEX.findall(text or ""):
        if requirement_id not in seen:
            seen.append(requirement_id)
    return seen


def find_placeholders(text: str) -> List[str]:
    return sorted({match.group(0) for match in PLACEHOLDER_REGEX.finditer(text or "")})


def tasks_to_trace(tasks: Sequence[WorkflowTaskV2]) -> List[PlanTaskTrace]:
    traces: List[PlanTaskTrace] = []
    for task in tasks:
        traces.append(
            PlanTaskTrace(
                id=task.id,
                name=task.name,
                spec_ref=task.spec_ref,
                requirement_ids=list(task.requirement_ids),
                files=task.all_files(),
                step_count=len(task.steps),
            )
        )
    return traces


def validate_plan_traceability(
    requirements: Sequence[RequirementTrace],
    tasks: Sequence[WorkflowTaskV2],
) -> Dict[str, Any]:
    in_scope_ids = [req.id for req in requirements if req.scope_status == "in_scope"]
    traces = tasks_to_trace(tasks)

    covered = set()
    tasks_missing_spec_ref: List[str] = []
    tasks_missing_requirements: List[str] = []
    tasks_with_placeholders: List[str] = []

    for task in tasks:
        if not task.spec_ref or task.spec_ref == "§Unknown":
            tasks_missing_spec_ref.append(task.id)
        if not task.requirement_ids:
            tasks_missing_requirements.append(task.id)
        covered.update(task.requirement_ids)
        if find_placeholders(task.name) or any(
            find_placeholders(step.description) or find_placeholders(step.expected)
            for step in task.steps
        ):
            tasks_with_placeholders.append(task.id)

    missing_requirement_ids = [rid for rid in in_scope_ids if rid not in covered]

    return {
        "ok": not (
            missing_requirement_ids
            or tasks_missing_spec_ref
            or tasks_missing_requirements
            or tasks_with_placeholders
        ),
        "in_scope_requirement_ids": in_scope_ids,
        "covered_requirement_ids": sorted(covered),
        "missing_requirement_ids": missing_requirement_ids,
        "tasks_missing_spec_ref": tasks_missing_spec_ref,
        "tasks_missing_requirement_ids": tasks_missing_requirements,
        "tasks_with_placeholders": tasks_with_placeholders,
        "task_traces": [asdict(trace) for trace in traces],
    }


def extract_section(content: str, heading: str) -> str:
    pattern = re.compile(
        rf"^##+\s+{re.escape(heading)}\s*$([\s\S]*?)(?=^##+\s+|\Z)",
        re.MULTILINE,
    )
    match = pattern.search(content or "")
    if not match:
        return ""
    return match.group(1).strip()


def validate_spec_traceability(
    requirements: Sequence[RequirementTrace],
    spec_content: str,
) -> Dict[str, Any]:
    constraints_section = extract_section(spec_content, "Constraints")
    architecture_section = extract_section(spec_content, "Architecture and Module Design")
    acceptance_section = extract_section(spec_content, "Acceptance Criteria")

    missing_architecture_refs: List[str] = []
    missing_acceptance_refs: List[str] = []
    missing_constraints: List[Dict[str, Any]] = []
    missing_exclusion_reason: List[str] = []

    for req in requirements:
        if req.scope_status == "in_scope":
            if req.id not in architecture_section:
                missing_architecture_refs.append(req.id)
            if req.id not in acceptance_section:
                missing_acceptance_refs.append(req.id)
        else:
            if not req.exclusion_reason:
                missing_exclusion_reason.append(req.id)

        absent = [constraint for constraint in req.constraints if constraint and constraint not in constraints_section]
        if absent:
            missing_constraints.append({"requirement_id": req.id, "constraints": absent})

    return {
        "ok": not (
            missing_architecture_refs
            or missing_acceptance_refs
            or missing_constraints
            or missing_exclusion_reason
        ),
        "missing_architecture_refs": missing_architecture_refs,
        "missing_acceptance_refs": missing_acceptance_refs,
        "missing_constraints": missing_constraints,
        "missing_exclusion_reason": missing_exclusion_reason,
        "placeholders": find_placeholders(spec_content),
    }


def summarize_execution_coverage(
    requirements: Sequence[RequirementTrace],
    completed_task_ids: Sequence[str],
    tasks: Sequence[WorkflowTaskV2],
) -> Dict[str, Any]:
    completed = set(completed_task_ids)
    covered = set()
    by_requirement: Dict[str, List[str]] = {}

    for task in tasks:
        if task.id not in completed:
            continue
        for requirement_id in task.requirement_ids:
            covered.add(requirement_id)
            by_requirement.setdefault(requirement_id, []).append(task.id)

    in_scope_ids = [req.id for req in requirements if req.scope_status == "in_scope"]
    missing = [req_id for req_id in in_scope_ids if req_id not in covered]

    return {
        "ok": not missing,
        "completed_task_ids": list(completed_task_ids),
        "covered_requirement_ids": sorted(covered),
        "missing_requirement_ids": missing,
        "coverage_map": by_requirement,
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="workflow 需求追溯工具")
    sub = parser.add_subparsers(dest="command")

    p_req = sub.add_parser("extract-ids", help="从文本中提取 requirement ids")
    p_req.add_argument("file")

    p_placeholders = sub.add_parser("placeholders", help="扫描 placeholder")
    p_placeholders.add_argument("file")

    args = parser.parse_args()

    if args.command == "extract-ids":
        with open(args.file, "r", encoding="utf-8") as f:
            content = f.read()
        print(json.dumps({"requirement_ids": extract_requirement_ids(content)}, ensure_ascii=False))
        return 0

    if args.command == "placeholders":
        with open(args.file, "r", encoding="utf-8") as f:
            content = f.read()
        print(json.dumps({"placeholders": find_placeholders(content)}, ensure_ascii=False))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
