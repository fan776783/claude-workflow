#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent 注册表管理器。

借鉴 Trellis common/registry.py，跟踪并行子 Agent 的生命周期。

用法:
    python3 agent_registry.py register --agent-id <id> --task-id T3 --worktree <path>
    python3 agent_registry.py status [--agent-id <id>]
    python3 agent_registry.py update --agent-id <id> --status completed
    python3 agent_registry.py list
    python3 agent_registry.py remove --agent-id <id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


# =============================================================================
# Registry Storage
# =============================================================================

REGISTRY_FILENAME = "agent-registry.json"


def _get_registry_path(project_root: Optional[str] = None) -> str:
    """Get the registry file path."""
    root = project_root or os.getcwd()
    return os.path.join(root, ".claude", "config", REGISTRY_FILENAME)


def read_registry(project_root: Optional[str] = None) -> Dict[str, Any]:
    """Read the agent registry."""
    path = _get_registry_path(project_root)
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"version": "1.0", "agents": {}, "groups": {}}


def write_registry(registry: Dict[str, Any], project_root: Optional[str] = None) -> None:
    """Write the agent registry."""
    path = _get_registry_path(project_root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    registry["updated_at"] = datetime.now().isoformat()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)


# =============================================================================
# Agent Operations
# =============================================================================


def register_agent(
    task_id: str,
    worktree_path: Optional[str] = None,
    boundary: str = "auto",
    platform: str = "claude-code",
    group_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Register a new agent."""
    registry = read_registry(project_root)
    aid = agent_id or f"agent-{uuid.uuid4().hex[:8]}"

    entry = {
        "agent_id": aid,
        "task_id": task_id,
        "boundary": boundary,
        "platform": platform,
        "worktree_path": worktree_path,
        "group_id": group_id,
        "status": "registered",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "exit_code": None,
        "output_summary": None,
    }

    registry["agents"][aid] = entry

    # Add to group if specified
    if group_id:
        groups = registry.setdefault("groups", {})
        group = groups.setdefault(group_id, {
            "group_id": group_id,
            "agent_ids": [],
            "status": "running",
            "created_at": datetime.now().isoformat(),
            "conflict_detected": False,
        })
        if aid not in group["agent_ids"]:
            group["agent_ids"].append(aid)

    write_registry(registry, project_root)
    return entry


def update_agent_status(
    agent_id: str,
    status: str,
    exit_code: Optional[int] = None,
    output_summary: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Update an agent's status."""
    registry = read_registry(project_root)
    agent = registry.get("agents", {}).get(agent_id)
    if not agent:
        return {"error": f"Agent {agent_id} not found"}

    agent["status"] = status
    agent["updated_at"] = datetime.now().isoformat()
    if exit_code is not None:
        agent["exit_code"] = exit_code
    if output_summary is not None:
        agent["output_summary"] = output_summary[:500]

    # Auto-update group status
    group_id = agent.get("group_id")
    if group_id and group_id in registry.get("groups", {}):
        group = registry["groups"][group_id]
        all_agents = [registry["agents"].get(aid) for aid in group["agent_ids"]]
        all_agents = [a for a in all_agents if a]

        if all(a["status"] in ("completed", "failed") for a in all_agents):
            has_failure = any(a["status"] == "failed" for a in all_agents)
            group["status"] = "failed" if has_failure else "completed"

    write_registry(registry, project_root)
    return agent


def list_agents(
    status_filter: Optional[str] = None,
    group_filter: Optional[str] = None,
    project_root: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List all agents, optionally filtered."""
    registry = read_registry(project_root)
    agents = list(registry.get("agents", {}).values())

    if status_filter:
        agents = [a for a in agents if a["status"] == status_filter]
    if group_filter:
        agents = [a for a in agents if a.get("group_id") == group_filter]

    return agents


def get_agent(agent_id: str, project_root: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get a specific agent's info."""
    registry = read_registry(project_root)
    return registry.get("agents", {}).get(agent_id)


def remove_agent(agent_id: str, project_root: Optional[str] = None) -> Dict[str, Any]:
    """Remove an agent from the registry."""
    registry = read_registry(project_root)
    agent = registry.get("agents", {}).pop(agent_id, None)
    if not agent:
        return {"error": f"Agent {agent_id} not found"}

    # Remove from group
    group_id = agent.get("group_id")
    if group_id and group_id in registry.get("groups", {}):
        group = registry["groups"][group_id]
        if agent_id in group["agent_ids"]:
            group["agent_ids"].remove(agent_id)
        if not group["agent_ids"]:
            del registry["groups"][group_id]

    write_registry(registry, project_root)
    return {"removed": True, "agent_id": agent_id}


def get_group_status(group_id: str, project_root: Optional[str] = None) -> Dict[str, Any]:
    """Get the status of a dispatch group."""
    registry = read_registry(project_root)
    group = registry.get("groups", {}).get(group_id)
    if not group:
        return {"error": f"Group {group_id} not found"}

    agents = [
        registry["agents"].get(aid)
        for aid in group["agent_ids"]
        if aid in registry.get("agents", {})
    ]

    return {
        **group,
        "agents": agents,
        "completed_count": sum(1 for a in agents if a and a["status"] == "completed"),
        "failed_count": sum(1 for a in agents if a and a["status"] == "failed"),
        "running_count": sum(1 for a in agents if a and a["status"] == "running"),
    }


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description="Agent 注册表管理器")
    sub = parser.add_subparsers(dest="command")

    # register
    p_reg = sub.add_parser("register", help="注册 Agent")
    p_reg.add_argument("--task-id", required=True)
    p_reg.add_argument("--agent-id", help="Agent ID（不指定则自动生成）")
    p_reg.add_argument("--worktree", help="Worktree 路径")
    p_reg.add_argument("--boundary", default="auto", help="上下文边界")
    p_reg.add_argument("--platform", default="claude-code")
    p_reg.add_argument("--group-id", help="分组 ID")

    # update
    p_update = sub.add_parser("update", help="更新 Agent 状态")
    p_update.add_argument("--agent-id", required=True)
    p_update.add_argument("--status", required=True, choices=["running", "completed", "failed"])
    p_update.add_argument("--exit-code", type=int)
    p_update.add_argument("--output", help="输出摘要")

    # list
    p_list = sub.add_parser("list", help="列出所有 Agent")
    p_list.add_argument("--status", help="按状态过滤")
    p_list.add_argument("--group", help="按分组过滤")

    # status
    p_status = sub.add_parser("status", help="查看 Agent 状态")
    p_status.add_argument("--agent-id", help="Agent ID")
    p_status.add_argument("--group-id", help="Group ID")

    # remove
    p_remove = sub.add_parser("remove", help="删除 Agent")
    p_remove.add_argument("--agent-id", required=True)

    args = parser.parse_args()

    if args.command == "register":
        result = register_agent(
            args.task_id, args.worktree, args.boundary,
            args.platform, args.group_id, args.agent_id,
        )
    elif args.command == "update":
        result = update_agent_status(
            args.agent_id, args.status, args.exit_code, args.output,
        )
    elif args.command == "list":
        agents = list_agents(args.status, args.group)
        result = {"agents": agents, "count": len(agents)}
    elif args.command == "status":
        if getattr(args, "group_id", None):
            result = get_group_status(args.group_id)
        elif getattr(args, "agent_id", None):
            agent = get_agent(args.agent_id)
            result = agent or {"error": f"Agent {args.agent_id} not found"}
        else:
            # Show summary
            agents = list_agents()
            result = {
                "total": len(agents),
                "running": sum(1 for a in agents if a["status"] == "running"),
                "completed": sum(1 for a in agents if a["status"] == "completed"),
                "failed": sum(1 for a in agents if a["status"] == "failed"),
            }
    elif args.command == "remove":
        result = remove_agent(args.agent_id)
    else:
        parser.print_help()
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
