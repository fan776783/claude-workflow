#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
会话日志管理器。

借鉴 Trellis add_session.py，为 workflow 提供跨会话的日志持久化能力。

用法:
    python3 journal.py add --title "标题" --workflow-id "id" --summary "摘要"
    python3 journal.py list [--project-id <id>]
    python3 journal.py search "关键词" [--project-id <id>]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from path_utils import detect_project_id_from_root, get_workflows_dir


# =============================================================================
# Constants
# =============================================================================

MAX_SESSIONS_PER_INDEX = 100  # 超过后自动归档旧条目


# =============================================================================
# Journal Storage
# =============================================================================


def get_journal_dir(project_id: str) -> Path:
    """Get journal directory for a project."""
    workflows_dir = get_workflows_dir(project_id)
    if not workflows_dir:
        raise ValueError(f"invalid project id: {project_id}")
    return Path(workflows_dir) / "journal"


def read_index(journal_dir: Path) -> Dict[str, Any]:
    """Read or create journal index."""
    index_path = journal_dir / "index.json"
    if index_path.is_file():
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    return {
        "version": "1.0",
        "total_sessions": 0,
        "last_updated": None,
        "sessions": [],
    }


def write_index(journal_dir: Path, index: Dict[str, Any]) -> None:
    """Write journal index."""
    journal_dir.mkdir(parents=True, exist_ok=True)
    index["last_updated"] = datetime.now().isoformat()
    index_path = journal_dir / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)


def write_session(journal_dir: Path, session_id: int, data: Dict[str, Any]) -> str:
    """Write a session file."""
    sessions_dir = journal_dir / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    filename = f"session-{str(session_id).zfill(3)}.json"
    filepath = sessions_dir / filename
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return filename


# =============================================================================
# Commands
# =============================================================================


def cmd_add(
    project_id: str,
    title: str,
    workflow_id: Optional[str] = None,
    tasks_completed: Optional[List[str]] = None,
    summary: Optional[str] = None,
    decisions: Optional[List[str]] = None,
    next_steps: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Add a new session entry."""
    journal_dir = get_journal_dir(project_id)
    index = read_index(journal_dir)

    session_id = index["total_sessions"] + 1

    session_data = {
        "id": session_id,
        "title": title,
        "date": datetime.now().isoformat(),
        "workflow_id": workflow_id,
        "tasks_completed": tasks_completed or [],
        "summary": summary or "",
        "decisions": decisions or [],
        "next_steps": next_steps or [],
    }

    # Write session file
    filename = write_session(journal_dir, session_id, session_data)

    # Update index
    index["total_sessions"] = session_id
    index["sessions"].append({
        "id": session_id,
        "title": title,
        "date": session_data["date"],
        "file": filename,
        "workflow_id": workflow_id,
        "tasks_count": len(tasks_completed or []),
    })

    # Trim index if too large (keep last MAX entries in memory)
    if len(index["sessions"]) > MAX_SESSIONS_PER_INDEX:
        index["sessions"] = index["sessions"][-MAX_SESSIONS_PER_INDEX:]

    write_index(journal_dir, index)

    return {"added": True, "session_id": session_id, "file": filename}


def cmd_list(project_id: str, limit: int = 20) -> Dict[str, Any]:
    """List recent sessions."""
    journal_dir = get_journal_dir(project_id)
    index = read_index(journal_dir)

    sessions = index.get("sessions", [])
    recent = sessions[-limit:]
    recent.reverse()  # newest first

    return {
        "total": index.get("total_sessions", 0),
        "showing": len(recent),
        "sessions": recent,
    }


def cmd_search(project_id: str, keyword: str) -> Dict[str, Any]:
    """Search sessions by keyword."""
    journal_dir = get_journal_dir(project_id)
    sessions_dir = journal_dir / "sessions"

    if not sessions_dir.is_dir():
        return {"matches": [], "count": 0}

    matches = []
    keyword_lower = keyword.lower()

    for session_file in sorted(sessions_dir.glob("session-*.json")):
        try:
            with open(session_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            searchable = json.dumps(data, ensure_ascii=False).lower()
            if keyword_lower in searchable:
                matches.append({
                    "id": data.get("id"),
                    "title": data.get("title"),
                    "date": data.get("date"),
                    "summary": (data.get("summary", ""))[:200],
                })
        except (json.JSONDecodeError, OSError):
            continue

    return {"matches": matches, "count": len(matches), "keyword": keyword}


def cmd_get(project_id: str, session_id: int) -> Dict[str, Any]:
    """Get a specific session by ID."""
    journal_dir = get_journal_dir(project_id)
    filename = f"session-{str(session_id).zfill(3)}.json"
    filepath = journal_dir / "sessions" / filename

    if not filepath.is_file():
        return {"error": f"Session {session_id} not found"}

    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# Project ID Detection
# =============================================================================


def detect_project_id(project_root: Optional[str] = None) -> Optional[str]:
    """Auto-detect project ID from project-config.json."""
    return detect_project_id_from_root(project_root)


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description="会话日志管理器")
    parser.add_argument("--project-id", help="项目 ID（不指定则自动检测）")
    sub = parser.add_subparsers(dest="command")

    # add
    p_add = sub.add_parser("add", help="添加会话记录")
    p_add.add_argument("--title", required=True, help="会话标题")
    p_add.add_argument("--workflow-id", help="工作流 ID")
    p_add.add_argument("--tasks-completed", default="", help="已完成任务 ID（逗号分隔）")
    p_add.add_argument("--summary", help="会话摘要")
    p_add.add_argument("--decisions", default="", help="关键决策（逗号分隔）")
    p_add.add_argument("--next-steps", default="", help="下一步计划（逗号分隔）")

    # list
    p_list = sub.add_parser("list", help="列出最近会话")
    p_list.add_argument("--limit", type=int, default=20, help="显示数量")

    # search
    p_search = sub.add_parser("search", help="搜索会话")
    p_search.add_argument("keyword", help="搜索关键词")

    # get
    p_get = sub.add_parser("get", help="获取特定会话")
    p_get.add_argument("session_id", type=int, help="会话 ID")

    args = parser.parse_args()

    # Resolve project ID
    project_id = args.project_id or detect_project_id()
    if not project_id:
        print(json.dumps({"error": "无法检测项目 ID，请使用 --project-id 指定"}, ensure_ascii=False))
        return 1

    split = lambda s: [x.strip() for x in s.split(",") if x.strip()] if s else []

    if args.command == "add":
        result = cmd_add(
            project_id,
            title=args.title,
            workflow_id=args.workflow_id,
            tasks_completed=split(args.tasks_completed),
            summary=args.summary,
            decisions=split(args.decisions),
            next_steps=split(args.next_steps),
        )
    elif args.command == "list":
        result = cmd_list(project_id, limit=args.limit)
    elif args.command == "search":
        result = cmd_search(project_id, args.keyword)
    elif args.command == "get":
        result = cmd_get(project_id, args.session_id)
    else:
        parser.print_help()
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
