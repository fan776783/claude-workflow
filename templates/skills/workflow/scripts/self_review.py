#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow self-review helper。

聚合 spec / plan 自检与文档契约检查，复用 traceability 与 doc_contracts。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional

from doc_contracts import validate_workflow_doc_contracts
from task_parser import parse_tasks_v2
from traceability import (
    RequirementTrace,
    validate_plan_traceability,
    validate_spec_traceability,
)


def build_requirements(items: Optional[List[Dict[str, Any]]]) -> List[RequirementTrace]:
    return [
        RequirementTrace(
            id=item.get("id", ""),
            summary=item.get("summary", ""),
            scope_status=item.get("scope_status", "in_scope"),
            constraints=item.get("constraints") or [],
            owner=item.get("owner", "shared"),
            exclusion_reason=item.get("exclusion_reason"),
        )
        for item in (items or [])
        if item.get("id")
    ]


def run_spec_self_review(
    requirements: List[Dict[str, Any]],
    spec_content: str,
    ux_artifact: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    requirement_records = build_requirements(requirements)
    result = validate_spec_traceability(requirement_records, spec_content)

    ux_checks = {
        "flowchart_present": bool((ux_artifact or {}).get("flowchart")),
        "page_hierarchy_present": bool((ux_artifact or {}).get("pageHierarchy")),
    }
    result["ux_checks"] = ux_checks
    result["ok"] = result["ok"] and all(ux_checks.values()) if ux_artifact else result["ok"]
    return result


def run_plan_self_review(
    requirements: List[Dict[str, Any]],
    plan_content: str,
) -> Dict[str, Any]:
    requirement_records = build_requirements(requirements)
    tasks = parse_tasks_v2(plan_content)
    result = validate_plan_traceability(requirement_records, tasks)
    tasks_missing_verification = [task.id for task in tasks if not task.verification or not task.verification.commands]
    result["tasks_missing_verification"] = tasks_missing_verification
    result["ok"] = result["ok"] and not tasks_missing_verification
    return result


def run_doc_contract_review(
    cli_content: str,
    overview_doc_content: str,
    plan_template_content: str,
    other_doc_contents: List[str],
    existing_script_names: List[str],
) -> Dict[str, Any]:
    return validate_workflow_doc_contracts(
        cli_content,
        overview_doc_content,
        plan_template_content,
        other_doc_contents,
        existing_script_names,
    )


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="workflow self-review helper")
    sub = parser.add_subparsers(dest="command")

    p_spec = sub.add_parser("spec", help="运行 spec self-review")
    p_spec.add_argument("requirements_json")
    p_spec.add_argument("spec_file")
    p_spec.add_argument("--ux-json", default="{}")

    p_plan = sub.add_parser("plan", help="运行 plan self-review")
    p_plan.add_argument("requirements_json")
    p_plan.add_argument("plan_file")

    args = parser.parse_args()

    if args.command == "spec":
        with open(args.requirements_json, "r", encoding="utf-8") as f:
            requirements = json.load(f)
        with open(args.spec_file, "r", encoding="utf-8") as f:
            spec_content = f.read()
        print(json.dumps(run_spec_self_review(requirements, spec_content, json.loads(args.ux_json)), ensure_ascii=False))
        return 0

    if args.command == "plan":
        with open(args.requirements_json, "r", encoding="utf-8") as f:
            requirements = json.load(f)
        with open(args.plan_file, "r", encoding="utf-8") as f:
            plan_content = f.read()
        print(json.dumps(run_plan_self_review(requirements, plan_content), ensure_ascii=False))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
