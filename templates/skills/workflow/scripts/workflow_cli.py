#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow 统一入口 CLI (v2.0)。

整合 task_manager / journal / state_manager 为单一命令行入口，
借鉴 Trellis task.py 的 "查询式状态机" 设计：
AI 只需调一条命令就知道下一步做什么，不依赖 prompt 记忆流程。

子命令：
  execute   恢复/继续执行（原有功能）
  continue  自然语言恢复（原有功能）
  next      查询下一步该做什么（整合 task_manager.next）
  advance   完成当前任务 + 推进到下一个 + 可选 journal 记录
  context   聚合启动上下文（状态 + journal + git）
  status    快速状态概览（整合 task_manager.status）
  journal   管理会话日志（整合 journal.py）

用法:
    python3 workflow_cli.py next
    python3 workflow_cli.py advance T3 --journal "完成认证模块"
    python3 workflow_cli.py context
    python3 workflow_cli.py journal list
    python3 workflow_cli.py execute
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent))

from path_utils import validate_project_id  # type: ignore
from state_manager import read_state, write_state  # type: ignore
from task_manager import (  # type: ignore
    cmd_complete,
    cmd_context_budget,
    cmd_list,
    cmd_next,
    cmd_parallel,
    cmd_progress,
    cmd_status,
    detect_project_id,
    detect_project_root,
    resolve_state_and_tasks,
)

# =============================================================================
# Constants
# =============================================================================

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


# =============================================================================
# Original Execute/Continue Commands
# =============================================================================


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
                "message": f'当前状态 {status} 不支持直接恢复，请使用 /workflow status 查看详情。',
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


# =============================================================================
# New: advance command (complete + auto-next + optional journal)
# =============================================================================


def cmd_advance(
    task_id: str,
    journal_summary: Optional[str] = None,
    decisions: Optional[List[str]] = None,
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """完成当前任务 + 推进到下一个 + 可选 journal 记录。

    借鉴 Trellis task.py advance：一条命令完成状态机推进，
    AI 不需要分别调用 complete → next → journal。
    """
    # Step 1: Complete current task
    complete_result = cmd_complete(task_id, project_id, project_root)
    if "error" in complete_result:
        return complete_result

    # Step 2: Find next task
    next_result = cmd_next(project_id, project_root)
    next_task = next_result.get("next_task")

    # Step 3: Update state's current_tasks
    state, state_path, _, _ = resolve_state_and_tasks(project_id, project_root)
    if state and state_path:
        if next_task and isinstance(next_task, dict):
            state["current_tasks"] = [next_task["id"]]
        elif next_task and isinstance(next_task, str):
            state["current_tasks"] = [next_task]
        else:
            state["current_tasks"] = []
            # Check if all done
            progress = state.get("progress", {})
            completed_count = len(progress.get("completed", []))
            total_msg = next_result.get("message", "")
            if "所有" in total_msg or completed_count > 0:
                state["status"] = "completed"
                state["completed_at"] = datetime.now().isoformat()
        write_state(state_path, state)

    # Step 4: Optional journal record
    journal_result = None
    if journal_summary:
        try:
            from journal import cmd_add  # type: ignore

            pid = project_id or detect_project_id()
            if pid:
                journal_result = cmd_add(
                    pid,
                    title=f"完成 {task_id}" + (f" → {next_task['id']}" if isinstance(next_task, dict) else ""),
                    workflow_id=pid,
                    tasks_completed=[task_id],
                    summary=journal_summary,
                    decisions=decisions or [],
                    next_steps=[f"下一任务: {next_task['id'] if isinstance(next_task, dict) else next_task}"] if next_task else [],
                )
        except ImportError:
            journal_result = {"error": "journal 模块不可用"}

    result: Dict[str, Any] = {
        "advanced": True,
        "completed_task": task_id,
        "next_task": next_task,
        "workflow_status": state.get("status") if state else None,
    }
    if journal_result:
        result["journal"] = journal_result
    return result


# =============================================================================
# New: context command (aggregated startup context)
# =============================================================================


def cmd_context(
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """聚合启动上下文，一条命令恢复所有状态。

    借鉴 Trellis get_context.py：新 Session 启动时，
    AI 调一条命令就能了解当前状态 + 最近进展 + 下一步。
    """
    pid = project_id or detect_project_id()
    if not pid:
        return {"error": "无法检测项目 ID"}

    result: Dict[str, Any] = {"project_id": pid}

    # 1. Workflow status
    status = cmd_status(pid, project_root)
    result["workflow"] = status

    # 2. Next task
    next_info = cmd_next(pid, project_root)
    result["next_task"] = next_info.get("next_task")

    # 3. Context budget
    budget = cmd_context_budget(pid, project_root)
    if "error" not in budget:
        result["budget"] = {
            "level": budget.get("level"),
            "current_usage": budget.get("current_usage"),
            "max_consecutive_tasks": budget.get("max_consecutive_tasks"),
        }

    # 4. Recent journal entries
    try:
        from journal import cmd_list as journal_list  # type: ignore

        journal = journal_list(pid, limit=3)
        if "error" not in journal:
            result["recent_sessions"] = journal.get("sessions", [])

            # Load latest full session for decisions/next_steps
            if journal.get("sessions"):
                from journal import cmd_get as journal_get  # type: ignore

                latest = journal_get(pid, journal["sessions"][0]["id"])
                if "error" not in latest:
                    result["last_session"] = {
                        "title": latest.get("title"),
                        "summary": latest.get("summary"),
                        "decisions": latest.get("decisions", []),
                        "next_steps": latest.get("next_steps", []),
                    }
    except ImportError:
        result["journal_available"] = False

    # 5. Git status (lightweight)
    try:
        root = detect_project_root(project_root)
        git_result = subprocess.run(
            ["git", "status", "--porcelain", "--branch"],
            capture_output=True,
            text=True,
            cwd=str(root),
            timeout=5,
        )
        if git_result.returncode == 0:
            lines = git_result.stdout.strip().split("\n")
            branch_line = lines[0] if lines else ""
            changed_files = len([l for l in lines[1:] if l.strip()])
            result["git"] = {
                "branch": branch_line.replace("## ", ""),
                "changed_files": changed_files,
            }
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass

    return result


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(
        description="workflow 统一入口 CLI (v2.0)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
子命令详情:
  execute       恢复/继续执行工作流
  continue      自然语言恢复执行
  next          查询下一步该做什么
  advance       完成当前任务 + 推进 + 可选 journal
  context       聚合启动上下文（状态 + journal + git）
  status        快速工作流状态
  list          列出所有任务
  progress      进度统计
  parallel      查找可并行任务
  budget        上下文预算评估
  journal       管理会话日志
""",
    )
    parser.add_argument("--project-id", help="项目 ID（不指定则自动检测）")
    parser.add_argument("--project-root", help="项目根目录")
    sub = parser.add_subparsers(dest="command")

    # --- execute ---
    p_exec = sub.add_parser("execute", help="恢复/继续执行")
    p_exec.add_argument("intent", nargs="?", help="自然语言意图")
    p_exec.add_argument(
        "--mode",
        choices=["continuous", "phase", "retry", "skip"],
        help="显式执行模式",
    )

    # --- continue ---
    p_cont = sub.add_parser("continue", help="自然语言恢复执行")
    p_cont.add_argument("intent", nargs="?", help="自然语言意图")
    p_cont.add_argument(
        "--mode",
        choices=["continuous", "phase", "retry", "skip"],
        help="显式执行模式",
    )

    # --- next ---
    sub.add_parser("next", help="查询下一步该做什么")

    # --- advance ---
    p_adv = sub.add_parser("advance", help="完成当前任务 + 推进到下一个")
    p_adv.add_argument("task_id", help="要标记完成的任务 ID")
    p_adv.add_argument("--journal", dest="journal_summary", help="可选的 journal 摘要")
    p_adv.add_argument("--decisions", default="", help="关键决策（逗号分隔）")

    # --- context ---
    sub.add_parser("context", help="聚合启动上下文")

    # --- status ---
    sub.add_parser("status", help="快速工作流状态")

    # --- list ---
    sub.add_parser("list", help="列出所有任务")

    # --- progress ---
    sub.add_parser("progress", help="进度统计")

    # --- parallel ---
    sub.add_parser("parallel", help="查找可并行任务")

    # --- budget ---
    sub.add_parser("budget", help="上下文预算评估")

    # --- journal ---
    p_journal = sub.add_parser("journal", help="管理会话日志")
    journal_sub = p_journal.add_subparsers(dest="journal_command")

    pj_add = journal_sub.add_parser("add", help="添加会话记录")
    pj_add.add_argument("--title", required=True, help="会话标题")
    pj_add.add_argument("--workflow-id", help="工作流 ID")
    pj_add.add_argument("--tasks-completed", default="", help="已完成任务 ID（逗号分隔）")
    pj_add.add_argument("--summary", help="会话摘要")
    pj_add.add_argument("--decisions", default="", help="关键决策（逗号分隔）")
    pj_add.add_argument("--next-steps", default="", help="下一步计划（逗号分隔）")

    pj_list = journal_sub.add_parser("list", help="列出最近会话")
    pj_list.add_argument("--limit", type=int, default=20, help="显示数量")

    pj_search = journal_sub.add_parser("search", help="搜索会话")
    pj_search.add_argument("keyword", help="搜索关键词")

    pj_get = journal_sub.add_parser("get", help="获取特定会话")
    pj_get.add_argument("session_id", type=int, help="会话 ID")

    args = parser.parse_args()
    pid = args.project_id
    project_root = args.project_root

    # Helper for comma-split
    split = lambda s: [x.strip() for x in s.split(",") if x.strip()] if s else []

    # ── Route commands ──

    if args.command in ("execute", "continue"):
        pr = Path(project_root) if project_root else Path.cwd()
        result = resolve_entry(args.command, args.intent, getattr(args, "mode", None), pr)

    elif args.command == "next":
        result = cmd_next(pid, project_root)

    elif args.command == "advance":
        result = cmd_advance(
            args.task_id,
            journal_summary=args.journal_summary,
            decisions=split(args.decisions),
            project_id=pid,
            project_root=project_root,
        )

    elif args.command == "context":
        result = cmd_context(pid, project_root)

    elif args.command == "status":
        result = cmd_status(pid, project_root)

    elif args.command == "list":
        result = cmd_list(pid, project_root)

    elif args.command == "progress":
        result = cmd_progress(pid, project_root)

    elif args.command == "parallel":
        result = cmd_parallel(pid, project_root)

    elif args.command == "budget":
        result = cmd_context_budget(pid, project_root)

    elif args.command == "journal":
        from journal import cmd_add, cmd_get, cmd_list as jl, cmd_search  # type: ignore

        resolved_pid = pid or detect_project_id()
        if not resolved_pid:
            result = {"error": "无法检测项目 ID，请使用 --project-id 指定"}
        elif args.journal_command == "add":
            result = cmd_add(
                resolved_pid,
                title=args.title,
                workflow_id=args.workflow_id,
                tasks_completed=split(args.tasks_completed),
                summary=args.summary,
                decisions=split(args.decisions),
                next_steps=split(getattr(args, "next_steps", "")),
            )
        elif args.journal_command == "list":
            result = jl(resolved_pid, limit=args.limit)
        elif args.journal_command == "search":
            result = cmd_search(resolved_pid, args.keyword)
        elif args.journal_command == "get":
            result = cmd_get(resolved_pid, args.session_id)
        else:
            p_journal.print_help()
            return 1

    else:
        parser.print_help()
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
