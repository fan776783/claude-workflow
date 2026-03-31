#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow plan delta helper。

集中实现 delta/change tracking 的稳定数据结构与 plan markdown 任务块变换。
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from task_parser import (
    WorkflowTaskV2,
    append_task_blocks,
    remove_tasks_from_markdown,
    replace_task_block,
)


def iso_now() -> str:
    return datetime.now().isoformat()


def create_delta_payload(
    change_id: str,
    trigger: Dict[str, Any],
    parent_change: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "id": change_id,
        "parent_change": parent_change,
        "status": "draft",
        "created_at": iso_now(),
        "trigger": trigger,
        "impact_analysis": {
            "summary": "pending",
            "affected_tasks": [],
            "affected_files": [],
        },
        "spec_deltas": [],
        "task_deltas": [],
    }


def create_review_status_payload(change_id: str, status: str = "draft") -> Dict[str, Any]:
    return {
        "change_id": change_id,
        "status": status,
        "review_mode": "human_gate",
        "reviewed_at": None,
        "reviewer": None,
        "notes": [],
    }


def render_intent_markdown(change_id: str, trigger: Dict[str, Any]) -> str:
    return (
        "\n".join(
            [
                f"# {change_id}",
                "",
                f"- 类型: {trigger['type']}",
                f"- 来源: {trigger.get('source') or 'inline'}",
                f"- 摘要: {trigger['description']}",
                "- 状态: draft",
            ]
        )
        + "\n"
    )


def create_delta_artifacts(
    change_id: str,
    trigger: Dict[str, Any],
    parent_change: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "delta": create_delta_payload(change_id, trigger, parent_change),
        "intent": render_intent_markdown(change_id, trigger),
        "review_status": create_review_status_payload(change_id),
    }


def summarize_task_deltas(task_deltas: Optional[List[Dict[str, Any]]]) -> Dict[str, int]:
    task_deltas = task_deltas or []
    summary = {"add": 0, "modify": 0, "remove": 0}
    for delta in task_deltas:
        action = (delta.get("action") or "").lower()
        if action in summary:
            summary[action] += 1
    return summary


def apply_task_deltas(content: str, task_deltas: List[Dict[str, Any]]) -> str:
    updated = content
    additions: List[str] = []

    for delta in task_deltas:
        action = (delta.get("action") or "").lower()
        if action == "add":
            block = delta.get("task_markdown") or ""
            if block.strip():
                additions.append(block.rstrip() + "\n")
        elif action == "modify":
            task_id = delta.get("task_id") or ""
            block = delta.get("task_markdown") or ""
            if task_id and block.strip():
                updated = replace_task_block(updated, task_id, block)
        elif action == "remove":
            task_id = delta.get("task_id") or ""
            if task_id:
                updated = remove_tasks_from_markdown(updated, [task_id])

    if additions:
        updated = append_task_blocks(updated, additions)
    return updated


def build_task_delta_examples(change_id: str, trigger: Dict[str, Any]) -> List[Dict[str, Any]]:
    description = trigger.get("description") or change_id
    return [
        {
            "action": "add",
            "task_markdown": f"## T99: 响应增量变更 {change_id}\n- **阶段**: implement\n- **Spec 参考**: §1\n- **Plan 参考**: P-delta-{change_id.lower()}\n- **需求 ID**: R-001\n- **状态**: pending\n- **actions**: edit_file\n- **步骤**:\n  - D1: 响应变更 {description} → 完成增量处理\n- **验证命令**: `python3 -m unittest tests/test_workflow_python_helpers.py`\n- **验证期望**: `OK`\n",
        },
        {
            "action": "modify",
            "task_id": "T1",
            "task_markdown": "## T1: 第一个任务（增量调整）\n- **阶段**: implement\n- **Spec 参考**: §1\n- **Plan 参考**: P1\n- **需求 ID**: R-001\n- **状态**: pending\n- **actions**: edit_file\n- **步骤**:\n  - A1: 修改实现并吸收增量变化 → 完成第一个任务\n- **验证命令**: `python3 -m unittest tests/test_workflow_python_helpers.py`\n- **验证期望**: `OK`\n",
        },
        {
            "action": "remove",
            "task_id": "T2",
        },
    ]


def build_sync_audit_payload(
    change_id: str,
    api_diff: Optional[Dict[str, Any]] = None,
    unblocked_tasks: Optional[List[str]] = None,
    status: str = "applied",
) -> Dict[str, Any]:
    api_diff = api_diff or {"added": [], "removed": [], "modified": []}
    return {
        "change_id": change_id,
        "status": status,
        "synced_at": iso_now(),
        "impact": {
            "added": api_diff.get("added", []),
            "removed": api_diff.get("removed", []),
            "modified": api_diff.get("modified", []),
        },
        "unblocked_tasks": unblocked_tasks or [],
    }


def to_pretty_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
