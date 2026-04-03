#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
planning-side gates helper。

沉淀 discussion / UX / spec review 的确定性触发规则与 artifact 校验。
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

UI_KEYWORDS_REGEX = re.compile(
    r"页面|界面|表单|列表|面板|弹窗|导航|路由|仪表盘|编辑器|sidebar|tab|modal|dashboard|GUI|桌面|desktop|窗口|window",
    re.IGNORECASE,
)
UI_BROAD_KEYWORDS_REGEX = re.compile(
    r"UI|界面|页面|组件|布局|样式|交互|显示|渲染|视图|前端",
    re.IGNORECASE,
)
WORKSPACE_KEYWORDS_REGEX = re.compile(r"同步|sync|agent|workspace|工作区|目录", re.IGNORECASE)


def should_run_discussion(
    requirement_content: str,
    requirement_source: str,
    no_discuss: bool = False,
    gap_count: int = 0,
) -> bool:
    if no_discuss:
        return False
    if requirement_source == "inline" and len((requirement_content or "").strip()) <= 100 and gap_count == 0:
        return False
    return True


def estimate_gap_count(requirement_content: str, requirement_source: str) -> int:
    content = (requirement_content or "").strip()
    if requirement_source == "inline" and len(content) <= 100:
        return 0
    return 1 if content else 0


def build_discussion_artifact(
    requirement_source: str,
    clarifications: Optional[List[Dict[str, Any]]] = None,
    selected_approach: Optional[Dict[str, Any]] = None,
    unresolved_dependencies: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "requirementSource": requirement_source,
        "clarifications": clarifications or [],
        "selectedApproach": selected_approach,
        "unresolvedDependencies": unresolved_dependencies or [],
    }


def should_run_ux_design_gate(
    requirement_content: str,
    analysis_patterns: Optional[List[Dict[str, Any]]] = None,
    discussion_artifact: Optional[Dict[str, Any]] = None,
) -> bool:
    content = requirement_content or ""
    if UI_KEYWORDS_REGEX.search(content):
        return True

    patterns = analysis_patterns or []
    has_frontend = any(
        re.search(r"react|vue|angular|svelte|tauri|electron|next\.?js|nuxt|vite", str((pattern or {}).get("name", "")), re.IGNORECASE)
        for pattern in patterns
    )
    if has_frontend and UI_BROAD_KEYWORDS_REGEX.search(content):
        return True

    clarifications = (discussion_artifact or {}).get("clarifications") or []
    return any(
        clarification.get("dimension") in {"behavior", "edge-case"}
        for clarification in clarifications
    )


def needs_workspace_detection(requirement_content: str) -> bool:
    return bool(WORKSPACE_KEYWORDS_REGEX.search(requirement_content or ""))


def detect_agent_workspaces(home_dir: Optional[str] = None) -> List[Dict[str, Any]]:
    home = Path(home_dir or Path.home())
    cursor_candidates = [
        home / ".cursor",
        home / ".config" / "Cursor",
        home / "AppData" / "Roaming" / "Cursor",
    ]
    cursor_path = next((candidate for candidate in cursor_candidates if candidate.exists()), cursor_candidates[0])
    return [
        {
            "agent": "claude-code",
            "path": str(home / ".claude"),
            "detected": (home / ".claude").exists(),
        },
        {
            "agent": "cursor",
            "path": str(cursor_path),
            "detected": cursor_path.exists(),
        },
        {
            "agent": "codex",
            "path": str(home / ".codex"),
            "detected": (home / ".codex").exists(),
        },
    ]


def validate_ux_artifact(artifact: Dict[str, Any]) -> Dict[str, Any]:
    flowchart = artifact.get("flowchart") or {}
    scenarios = flowchart.get("scenarios") or []
    pages = ((artifact.get("pageHierarchy") or {}).get("pages") or [])
    missing = []

    if len(scenarios) < 3:
        missing.append("flowchart_scenarios")

    l0_count = sum(1 for page in pages if page.get("level") == "L0")
    if l0_count > 4:
        missing.append("l0_overflow")

    return {
        "ok": not missing,
        "missing": missing,
        "scenario_count": len(scenarios),
        "page_count": len(pages),
    }


def build_spec_review_summary(spec_content: str) -> str:
    sections: List[str] = []
    for heading in ("## 2. Scope", "## 3. Constraints", "## 7. Acceptance Criteria"):
        pattern = re.compile(rf"^{re.escape(heading)}\s*$([\s\S]*?)(?=^##\s+|\Z)", re.MULTILINE)
        match = pattern.search(spec_content or "")
        if match:
            sections.append(match.group(0).strip())
    return "\n\n".join(sections)


def map_spec_review_choice(choice: str) -> Dict[str, Any]:
    mapping = {
        "Spec 正确，继续": {
            "status": "approved",
            "next_action": "continue_to_plan_generation",
            "workflow_status": "planning",
        },
        "需要修改 Spec": {
            "status": "revise_required",
            "next_action": "return_to_phase_1_spec_generation",
            "workflow_status": "spec_review",
        },
        "页面分层需要调整": {
            "status": "revise_required",
            "next_action": "return_to_phase_0_3_ux_design_gate",
            "workflow_status": "spec_review",
        },
        "缺少用户流程": {
            "status": "revise_required",
            "next_action": "return_to_phase_0_3_ux_design_gate",
            "workflow_status": "spec_review",
        },
        "需要拆分范围": {
            "status": "rejected",
            "next_action": "split_scope",
            "workflow_status": "spec_review",
        },
    }
    return mapping.get(choice, {
        "status": "pending",
        "next_action": None,
        "workflow_status": "spec_review",
    })


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="planning-side gates helper")
    sub = parser.add_subparsers(dest="command")

    p_discuss = sub.add_parser("discussion", help="判断是否需要 discussion")
    p_discuss.add_argument("content")
    p_discuss.add_argument("--source", default="inline")
    p_discuss.add_argument("--no-discuss", action="store_true")
    p_discuss.add_argument("--gap-count", type=int, default=0)

    p_ux = sub.add_parser("ux-gate", help="判断是否需要 UX gate")
    p_ux.add_argument("content")
    p_ux.add_argument("--patterns-json", default="[]")
    p_ux.add_argument("--discussion-json", default="{}")

    p_workspaces = sub.add_parser("workspaces", help="探测 agent 工作目录")
    p_workspaces.add_argument("--home")

    p_review = sub.add_parser("spec-review-choice", help="映射 spec review 选择")
    p_review.add_argument("choice")

    args = parser.parse_args()

    if args.command == "discussion":
        print(json.dumps({
            "run": should_run_discussion(
                args.content,
                args.source,
                no_discuss=args.no_discuss,
                gap_count=args.gap_count,
            )
        }, ensure_ascii=False))
        return 0

    if args.command == "ux-gate":
        patterns = json.loads(args.patterns_json)
        discussion = json.loads(args.discussion_json)
        print(json.dumps({
            "run": should_run_ux_design_gate(args.content, patterns, discussion)
        }, ensure_ascii=False))
        return 0

    if args.command == "workspaces":
        print(json.dumps({"workspaces": detect_agent_workspaces(args.home)}, ensure_ascii=False))
        return 0

    if args.command == "spec-review-choice":
        print(json.dumps(map_spec_review_choice(args.choice), ensure_ascii=False))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
