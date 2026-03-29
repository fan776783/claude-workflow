#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow 统一入口 CLI。

目标：
- 为 workflow skill 提供显式的 execute/continue 共享解析入口
- 收敛 `/workflow execute`、`/workflow execute 继续` 与裸自然语言“继续”的解释逻辑
- 复用现有 state/task helper，而不是重复实现状态探测
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

sys.path.insert(0, str(Path(__file__).parent))

from path_utils import validate_project_id  # type: ignore
from state_manager import read_state  # type: ignore
from task_manager import detect_project_id  # type: ignore


ACTIVE_STATUSES = {"running", "paused", "failed", "blocked"}
EXECUTION_MODE_ALIASES = {
    "继续": "continuous",
    "连续": "continuous",
    "next": "phase",
    "下一阶段": "phase",
    "单阶段": "phase",
    "phase": "phase",
    "重试": "retry",
    "retry": "retry",
    "跳过": "skip",
    "skip": "skip",
}


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
    if not project_id or not validate_project_id(project_id):
        return None
    return project_id



def load_state(project_id: str) -> Optional[Dict[str, Any]]:
    state_path = Path.home() / ".claude" / "workflows" / project_id / "workflow-state.json"
    if not state_path.is_file():
        return None
    try:
        return read_state(str(state_path))
    except Exception:
        return None



def resolve_execute_mode(
    intent: Optional[str],
    explicit_mode: Optional[str],
    preferred_mode: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    if explicit_mode:
        return explicit_mode, None
    if intent:
        resolved = EXECUTION_MODE_ALIASES.get(intent)
        if resolved:
            return resolved, None
        return preferred_mode or "continuous", f"unrecognized_intent:{intent}"
    if preferred_mode:
        return preferred_mode, None
    return "continuous", None



def resolve_entry(
    command: str,
    intent: Optional[str],
    explicit_mode: Optional[str],
    project_root: Path,
) -> Dict[str, Any]:
    config = load_project_config(project_root)
    project_id = extract_project_id(config) or detect_project_id()
    state = load_state(project_id) if project_id else None

    if command == "execute":
        mode, warning = resolve_execute_mode(intent, explicit_mode)
        result = {
            "entry_action": "execute",
            "resolved_mode": mode,
            "project_id": project_id,
            "state_status": state.get("status") if state else None,
            "can_resume": bool(state),
            "reason": "explicit_execute",
        }
        if warning:
            result["warning"] = warning
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
        if status not in ACTIVE_STATUSES:
            return {
                "entry_action": "none",
                "project_id": project_id,
                "state_status": status,
                "can_resume": False,
                "reason": "status_not_resumable",
                "message": f"当前状态 {status} 不支持直接用“继续”恢复，请使用 /workflow status 查看详情。",
            }

        continuation = state.get("continuation") or {}
        preferred_mode = state.get("execution_mode") or "continuous"
        last_decision = continuation.get("last_decision") or {}
        resolved_mode, warning = resolve_execute_mode(intent, explicit_mode, preferred_mode)

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
        if warning:
            result["warning"] = warning
        return result

    return {
        "entry_action": "none",
        "project_id": project_id,
        "state_status": state.get("status") if state else None,
        "can_resume": False,
        "reason": "unknown_command",
    }



def main() -> int:
    parser = argparse.ArgumentParser(description="workflow 统一入口 CLI")
    parser.add_argument("command", choices=["execute", "continue"], help="入口命令")
    parser.add_argument("intent", nargs="?", help="自然语言意图，如 继续/下一阶段/重试")
    parser.add_argument(
        "--mode",
        choices=["continuous", "phase", "retry", "skip"],
        help="显式执行模式，优先级高于自然语言意图",
    )
    parser.add_argument("--project-root", help="项目根目录，默认当前目录")

    args = parser.parse_args()
    project_root = Path(args.project_root) if args.project_root else Path.cwd()

    result = resolve_entry(args.command, args.intent, args.mode, project_root)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
