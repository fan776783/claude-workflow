#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow 文档契约检查 helper。

集中实现文档与脚本之间的轻量一致性规则，
供 validate.js 或后续 Python 校验脚本复用。
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any, Dict, Iterable, List, Sequence

from traceability import find_placeholders


CLI_COMMAND_REGEX = re.compile(r"sub\.add_parser\(\s*\"([a-z0-9_-]+)\"", re.IGNORECASE)
WORKFLOW_COMMAND_DOC_REGEX = re.compile(r"/workflow\s+([a-z0-9_-]+)", re.IGNORECASE)
PYTHON_SCRIPT_REGEX = re.compile(r"`scripts/([a-zA-Z0-9_./-]+\.py)`")


REQUIRED_PLAN_TEMPLATE_MARKERS = [
    "{{task_name}}",
    "{{spec_file}}",
    "{{tasks}}",
    "## Tasks",
    "## Self-Review Checklist",
]

REQUIRED_TASK_FIELD_MARKERS = [
    "阶段",
    "Spec 参考",
    "Plan 参考",
    "actions",
    "步骤",
]

IGNORED_DOC_COMMANDS = {"action"}
IGNORED_PLACEHOLDER_LINE_HINTS = (
    "placeholder",
    "no placeholders",
    "no tbd",
    "搜索 tbd/todo",
    "禁止 tbd/todo",
    "替换为实际内容",
    "占位符",
    "similar to task",
    "implement later",
    "fill in details",
    "write tests for",
    "add appropriate",
    "plan failure",
)


def unique(items: Iterable[str]) -> List[str]:
    result: List[str] = []
    for item in items:
        if item not in result:
            result.append(item)
    return result


def extract_cli_commands(cli_content: str) -> List[str]:
    return unique(match.group(1) for match in CLI_COMMAND_REGEX.finditer(cli_content or ""))


def extract_documented_workflow_commands(doc_content: str) -> List[str]:
    commands = (match.group(1) for match in WORKFLOW_COMMAND_DOC_REGEX.finditer(doc_content or ""))
    return [command for command in unique(commands) if command not in IGNORED_DOC_COMMANDS]


def extract_python_script_refs(doc_content: str) -> List[str]:
    return unique(match.group(1) for match in PYTHON_SCRIPT_REGEX.finditer(doc_content or ""))


def validate_plan_template(plan_template_content: str) -> Dict[str, Any]:
    missing_markers = [marker for marker in REQUIRED_PLAN_TEMPLATE_MARKERS if marker not in (plan_template_content or "")]
    missing_task_fields = [marker for marker in REQUIRED_TASK_FIELD_MARKERS if marker not in (plan_template_content or "")]
    placeholders = find_non_instructional_placeholders(plan_template_content)

    return {
        "ok": not (missing_markers or missing_task_fields or placeholders),
        "missing_markers": missing_markers,
        "missing_task_fields": missing_task_fields,
        "placeholders": placeholders,
    }


def validate_command_contract(
    cli_content: str,
    documented_commands: Sequence[str],
) -> Dict[str, Any]:
    implemented = extract_cli_commands(cli_content)
    documented = unique(documented_commands)
    missing = [command for command in documented if command not in implemented]

    return {
        "ok": not missing,
        "implemented_commands": implemented,
        "documented_commands": documented,
        "missing_commands": missing,
    }


def validate_script_references(
    doc_contents: Sequence[str],
    existing_script_names: Sequence[str],
) -> Dict[str, Any]:
    references: List[str] = []
    for content in doc_contents:
        references.extend(extract_python_script_refs(content))

    referenced = unique(references)
    existing = set(existing_script_names)
    missing = [ref for ref in referenced if ref not in existing]

    return {
        "ok": not missing,
        "referenced_scripts": referenced,
        "missing_scripts": missing,
    }


def find_non_instructional_placeholders(content: str) -> List[str]:
    placeholders: List[str] = []
    for line in (content or "").splitlines():
        lowered = line.lower()
        if any(hint in lowered for hint in IGNORED_PLACEHOLDER_LINE_HINTS):
            continue
        placeholders.extend(find_placeholders(line))
    return sorted(set(placeholders))


def validate_workflow_doc_contracts(
    cli_content: str,
    overview_doc_content: str,
    plan_template_content: str,
    other_doc_contents: Sequence[str],
    existing_script_names: Sequence[str],
) -> Dict[str, Any]:
    command_docs = [overview_doc_content, *other_doc_contents]
    documented_commands = unique(
        command
        for content in command_docs
        for command in extract_documented_workflow_commands(content)
    )
    command_contract = validate_command_contract(cli_content, documented_commands)
    template_contract = validate_plan_template(plan_template_content)
    script_refs = validate_script_references(command_docs, existing_script_names)

    doc_placeholders: List[str] = []
    for content in [*command_docs, plan_template_content]:
        doc_placeholders.extend(find_non_instructional_placeholders(content))

    return {
        "ok": command_contract["ok"] and template_contract["ok"] and script_refs["ok"] and not doc_placeholders,
        "command_contract": command_contract,
        "plan_template_contract": template_contract,
        "script_reference_contract": script_refs,
        "doc_placeholders": sorted(set(doc_placeholders)),
    }


def read_text(file_path: str) -> str:
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="workflow 文档契约检查工具")
    sub = parser.add_subparsers(dest="command")

    p_cli = sub.add_parser("cli-commands", help="提取 workflow cli commands")
    p_cli.add_argument("file")

    p_doc = sub.add_parser("doc-commands", help="提取文档中的 workflow commands")
    p_doc.add_argument("file")

    p_plan = sub.add_parser("plan-template", help="校验 plan template 契约")
    p_plan.add_argument("file")

    p_contracts = sub.add_parser("workflow-contracts", help="校验 workflow 文档契约")
    p_contracts.add_argument("--cli", required=True, dest="cli_file")
    p_contracts.add_argument("--overview", required=True, dest="overview_file")
    p_contracts.add_argument("--plan-template", required=True, dest="plan_template_file")
    p_contracts.add_argument("--doc", action="append", default=[], dest="other_docs")
    p_contracts.add_argument("--script", action="append", default=[], dest="scripts")

    args = parser.parse_args()

    if args.command == "cli-commands":
        content = read_text(args.file)
        print(json.dumps({"commands": extract_cli_commands(content)}, ensure_ascii=False))
        return 0

    if args.command == "doc-commands":
        content = read_text(args.file)
        print(json.dumps({"commands": extract_documented_workflow_commands(content)}, ensure_ascii=False))
        return 0

    if args.command == "plan-template":
        content = read_text(args.file)
        print(json.dumps(validate_plan_template(content), ensure_ascii=False))
        return 0

    if args.command == "workflow-contracts":
        cli_content = read_text(args.cli_file)
        overview_doc_content = read_text(args.overview_file)
        plan_template_content = read_text(args.plan_template_file)
        other_doc_contents = [read_text(file_path) for file_path in args.other_docs]
        print(
            json.dumps(
                validate_workflow_doc_contracts(
                    cli_content,
                    overview_doc_content,
                    plan_template_content,
                    other_doc_contents,
                    args.scripts,
                ),
                ensure_ascii=False,
            )
        )
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
