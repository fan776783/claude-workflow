#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
子 Agent 调度运行器。

为每个并行任务启动子 Agent 进程，管理其生命周期。

用法:
    python3 dispatch_runner.py dispatch --task-ids T3,T4 --group-id batch1
    python3 dispatch_runner.py run-single --task-id T3
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Import sibling modules
sys.path.insert(0, os.path.dirname(__file__))
from agent_registry import register_agent, update_agent_status, get_group_status
from worktree_manager import create_worktree, get_repo_root


# =============================================================================
# Context Building
# =============================================================================


def build_minimal_context(
    task: Dict[str, Any],
    project_root: str,
    spec_content: str = "",
) -> str:
    """Build minimal context payload for a sub-agent.

    Following SKILL.md Step 6: each sub-agent only receives minimum necessary context.
    """
    parts = []

    # Task definition
    parts.append(f"# 任务: {task.get('id', '?')} - {task.get('name', '')}")
    parts.append("")

    # Steps
    steps = task.get("steps", [])
    if steps:
        parts.append("## 执行步骤")
        for step in steps:
            sid = step.get("id", "")
            desc = step.get("description", "")
            expected = step.get("expected", "")
            parts.append(f"- {sid}: {desc} → {expected}")
        parts.append("")

    # Files
    files = task.get("files", {})
    if files:
        parts.append("## 目标文件")
        for ftype in ("create", "modify", "test"):
            file_list = files.get(ftype, [])
            if file_list:
                parts.append(f"- {ftype}: {', '.join(file_list)}")
        parts.append("")

    # Constraints
    constraints = task.get("critical_constraints", [])
    if constraints:
        parts.append("## 关键约束（不可违反）")
        for c in constraints:
            parts.append(f"- {c}")
        parts.append("")

    # Acceptance criteria
    criteria = task.get("acceptance_criteria", [])
    if criteria:
        parts.append("## 验收项")
        for c in criteria:
            parts.append(f"- {c}")
        parts.append("")

    # Spec reference
    if spec_content:
        parts.append("## 相关规范")
        parts.append(spec_content[:2000])
        parts.append("")

    # Verification
    verification = task.get("verification", {})
    if verification:
        cmds = verification.get("commands", [])
        if cmds:
            parts.append("## 验证命令")
            for cmd in cmds:
                parts.append(f"```bash\n{cmd}\n```")
            parts.append("")

    # Output contract
    parts.append("## 输出要求")
    parts.append("完成后请提供:")
    parts.append("1. 每个步骤的执行结果")
    parts.append("2. 验证命令的输出和 exit code")
    parts.append("3. 如果失败，说明失败原因和已尝试的修复")
    parts.append("")

    return "\n".join(parts)


# =============================================================================
# Dispatch
# =============================================================================


def dispatch_group(
    tasks: List[Dict[str, Any]],
    group_id: Optional[str] = None,
    platform: str = "claude-code",
    use_worktree: bool = False,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Dispatch a group of tasks to parallel sub-agents.

    This function orchestrates the dispatch process:
    1. Create worktrees (if enabled)
    2. Register agents
    3. Build minimal context
    4. Store dispatch manifests

    The actual agent launching is platform-specific and handled by
    the AI orchestrator using the manifests this function produces.
    """
    root = project_root or os.getcwd()
    gid = group_id or f"group-{uuid.uuid4().hex[:8]}"

    manifests = []

    for task in tasks:
        tid = task.get("id", "unknown")
        branch = f"workflow/{tid.lower()}"

        # Create worktree if requested
        worktree_path = None
        if use_worktree:
            wt_result = create_worktree(branch, tid, cwd=root)
            if wt_result.get("created") or wt_result.get("exists"):
                worktree_path = wt_result.get("path")

        # Register agent
        agent = register_agent(
            task_id=tid,
            worktree_path=worktree_path,
            boundary=task.get("boundary", "auto"),
            platform=platform,
            group_id=gid,
            project_root=root,
        )

        # Build context
        context = build_minimal_context(task, root)

        manifest = {
            "agent_id": agent["agent_id"],
            "task_id": tid,
            "task_name": task.get("name", ""),
            "group_id": gid,
            "platform": platform,
            "worktree_path": worktree_path,
            "context": context,
            "context_length": len(context),
        }
        manifests.append(manifest)

    return {
        "group_id": gid,
        "dispatched": len(manifests),
        "manifests": manifests,
        "platform": platform,
        "use_worktree": use_worktree,
        "created_at": datetime.now().isoformat(),
    }


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description="子 Agent 调度运行器")
    sub = parser.add_subparsers(dest="command")

    # dispatch
    p_dispatch = sub.add_parser("dispatch", help="分派任务组")
    p_dispatch.add_argument("--tasks-json", required=True, help="任务 JSON 文件")
    p_dispatch.add_argument("--task-ids", help="任务 ID 列表（逗号分隔）")
    p_dispatch.add_argument("--group-id", help="分组 ID")
    p_dispatch.add_argument("--platform", default="claude-code")
    p_dispatch.add_argument("--use-worktree", action="store_true")

    # build-context
    p_ctx = sub.add_parser("build-context", help="构建最小上下文")
    p_ctx.add_argument("--tasks-json", required=True, help="任务 JSON 文件")
    p_ctx.add_argument("--task-id", required=True, help="任务 ID")

    args = parser.parse_args()

    if args.command == "dispatch":
        with open(args.tasks_json, "r", encoding="utf-8") as f:
            all_tasks = json.load(f)

        # Filter by task IDs if specified
        if args.task_ids:
            ids = {x.strip() for x in args.task_ids.split(",")}
            tasks = [t for t in all_tasks if t.get("id") in ids]
        else:
            tasks = all_tasks

        result = dispatch_group(
            tasks, args.group_id, args.platform, args.use_worktree,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif args.command == "build-context":
        with open(args.tasks_json, "r", encoding="utf-8") as f:
            all_tasks = json.load(f)

        task = next((t for t in all_tasks if t.get("id") == args.task_id), None)
        if not task:
            print(json.dumps({"error": f"Task {args.task_id} not found"}))
            return 1

        context = build_minimal_context(task, os.getcwd())
        print(context)

    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
