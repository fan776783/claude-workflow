#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
结果回收与冲突检测器。

并行子 Agent 完成后，回收结果、检测冲突、决定是否需要顺序降级。

用法:
    python3 result_collector.py collect --group-id batch1
    python3 result_collector.py check-conflicts --group-id batch1
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(__file__))
from agent_registry import read_registry, write_registry, get_group_status


# =============================================================================
# Conflict Detection
# =============================================================================


def _detect_branch_for_agent(agent: Dict[str, Any]) -> Optional[str]:
    """Resolve the agent branch from its worktree instead of assuming a name."""
    worktree_path = agent.get("worktree_path")
    if not worktree_path:
        return None

    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=worktree_path,
    )
    if result.returncode != 0:
        return None

    branch = result.stdout.strip()
    if not branch or branch == "HEAD":
        return None
    return branch


def _check_merge_compatibility(root: str, branch: str) -> Dict[str, Any]:
    """Check merge compatibility using commit graph state only.

    `git merge-tree --write-tree` merges the named commits without touching the
    caller's working tree, so unrelated local modifications cannot trigger
    false conflicts.
    """
    merge_result = subprocess.run(
        ["git", "merge-tree", "--write-tree", "--quiet", "HEAD", branch],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=root,
    )
    return {
        "ok": merge_result.returncode == 0,
        "stderr": merge_result.stderr.strip(),
        "stdout": merge_result.stdout.strip(),
    }


def detect_merge_conflicts(
    group_id: str,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Detect merge conflicts between worktree branches in a group.

    For each completed agent in the group, checks if its branch
    can be merged without conflicts.
    """
    root = project_root or os.getcwd()
    registry = read_registry(root)
    group = registry.get("groups", {}).get(group_id)

    if not group:
        return {"error": f"Group {group_id} not found"}

    agents = [
        registry["agents"].get(aid)
        for aid in group["agent_ids"]
        if aid in registry.get("agents", {})
    ]

    conflicts = []
    clean_merges = []

    for agent in agents:
        if not agent or agent["status"] != "completed":
            continue

        branch = _detect_branch_for_agent(agent)
        if not branch:
            clean_merges.append(agent["task_id"])
            continue

        result = _check_merge_compatibility(root, branch)

        if not result["ok"]:
            conflicts.append({
                "task_id": agent["task_id"],
                "agent_id": agent["agent_id"],
                "branch": branch,
                "error": (result.get("stderr") or result.get("error") or "")[:300],
            })
        else:
            clean_merges.append(agent["task_id"])

    has_conflicts = len(conflicts) > 0

    # Update group status
    if has_conflicts:
        group["conflict_detected"] = True
        write_registry(registry, root)

    return {
        "group_id": group_id,
        "has_conflicts": has_conflicts,
        "conflicts": conflicts,
        "clean_merges": clean_merges,
        "recommendation": "sequential_fallback" if has_conflicts else "merge_all",
    }


def run_aggregate_verification(
    commands: List[str],
    cwd: Optional[str] = None,
    timeout: int = 120,
) -> List[Dict[str, Any]]:
    """Run aggregate verification after parallel completion."""
    results = []
    for cmd in commands:
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True,
                text=True, encoding="utf-8", errors="replace",
                timeout=timeout, cwd=cwd or os.getcwd(),
            )
            results.append({
                "command": cmd,
                "exit_code": result.returncode,
                "passed": result.returncode == 0,
                "output": (result.stdout or result.stderr or "")[:500],
            })
        except subprocess.TimeoutExpired:
            results.append({
                "command": cmd,
                "exit_code": -1,
                "passed": False,
                "output": f"Timeout after {timeout}s",
            })

    return results


# =============================================================================
# Result Collection
# =============================================================================


def collect_group_results(
    group_id: str,
    verification_commands: Optional[List[str]] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    """Collect results from all agents in a group.

    Implements SKILL.md Step 7 (Result Recovery) and Step 8 (Conflict Detection).
    """
    root = project_root or os.getcwd()
    group_status = get_group_status(group_id, root)

    if "error" in group_status:
        return group_status

    agents = group_status.get("agents", [])

    # Categorize results
    completed = [a for a in agents if a and a.get("status") == "completed"]
    failed = [a for a in agents if a and a.get("status") == "failed"]
    still_running = [a for a in agents if a and a.get("status") == "running"]

    result: Dict[str, Any] = {
        "group_id": group_id,
        "total_agents": len(agents),
        "completed": len(completed),
        "failed": len(failed),
        "still_running": len(still_running),
        "completed_tasks": [a["task_id"] for a in completed if a],
        "failed_tasks": [
            {"task_id": a["task_id"], "output": a.get("output_summary", "")}
            for a in failed if a
        ],
    }

    # If still running, return partial result
    if still_running:
        result["status"] = "partial"
        result["waiting_for"] = [a["task_id"] for a in still_running if a]
        return result

    # All done → check conflicts
    conflict_result = detect_merge_conflicts(group_id, root)
    result["conflicts"] = conflict_result

    # Run aggregate verification if provided
    if verification_commands:
        verification = run_aggregate_verification(verification_commands, root)
        result["verification"] = verification
        result["all_verified"] = all(v["passed"] for v in verification)
    else:
        result["all_verified"] = True

    # Determine overall status
    if conflict_result.get("has_conflicts"):
        result["status"] = "conflict"
        result["recommendation"] = "sequential_fallback"
    elif failed:
        result["status"] = "partial_failure"
        result["recommendation"] = "continue_with_failures"
    else:
        result["status"] = "success"
        result["recommendation"] = "merge_all"

    result["collected_at"] = datetime.now().isoformat()
    return result


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description="结果回收与冲突检测")
    sub = parser.add_subparsers(dest="command")

    # collect
    p_collect = sub.add_parser("collect", help="回收分组结果")
    p_collect.add_argument("--group-id", required=True)
    p_collect.add_argument("--verify", nargs="*", help="聚合验证命令")

    # check-conflicts
    p_conflict = sub.add_parser("check-conflicts", help="检测合并冲突")
    p_conflict.add_argument("--group-id", required=True)

    args = parser.parse_args()

    if args.command == "collect":
        result = collect_group_results(
            args.group_id,
            verification_commands=args.verify,
        )
    elif args.command == "check-conflicts":
        result = detect_merge_conflicts(args.group_id)
    else:
        parser.print_help()
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
