#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Git Worktree 管理器。

借鉴 Trellis multi_agent/start.py 的 worktree 管理能力，
为 dispatching-parallel-agents 提供执行基础设施。

用法:
    python3 worktree_manager.py create --branch feat/T3 --task-id T3
    python3 worktree_manager.py list
    python3 worktree_manager.py remove --task-id T3
    python3 worktree_manager.py cleanup
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


# =============================================================================
# Git Worktree Operations
# =============================================================================


def _run_git(*args: str, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    """Run a git command and return the result."""
    cmd = ["git"] + list(args)
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd or os.getcwd(),
    )


def get_repo_root(cwd: Optional[str] = None) -> Optional[str]:
    """Get the git repository root."""
    result = _run_git("rev-parse", "--show-toplevel", cwd=cwd)
    if result.returncode == 0:
        return result.stdout.strip()
    return None


def get_worktree_base_dir(repo_root: str) -> str:
    """Get the base directory for worktrees (sibling to repo root)."""
    parent = os.path.dirname(repo_root)
    repo_name = os.path.basename(repo_root)
    return os.path.join(parent, f".{repo_name}-worktrees")


def _normalize_path(path: str) -> str:
    """Normalize a filesystem path for reliable comparisons."""
    return os.path.normcase(os.path.realpath(path))


def _active_worktree_paths(cwd: Optional[str] = None) -> set[str]:
    """Return the normalized path set for currently registered worktrees."""
    return {
        _normalize_path(wt["path"])
        for wt in list_worktrees(cwd)
        if wt.get("path")
    }


def _remove_stale_worktree_dir(worktree_path: str, base_dir: str) -> bool:
    """Remove a stale generated worktree directory under the managed base dir."""
    normalized_path = _normalize_path(worktree_path)
    normalized_base = _normalize_path(base_dir)
    if not (
        normalized_path == normalized_base
        or normalized_path.startswith(normalized_base + os.sep)
    ):
        return False

    if not os.path.isdir(worktree_path):
        return True

    shutil.rmtree(worktree_path)
    return True


def list_worktrees(cwd: Optional[str] = None) -> List[Dict[str, str]]:
    """List all worktrees."""
    result = _run_git("worktree", "list", "--porcelain", cwd=cwd)
    if result.returncode != 0:
        return []

    worktrees = []
    current: Dict[str, str] = {}

    for line in result.stdout.split("\n"):
        line = line.strip()
        if not line:
            if current:
                worktrees.append(current)
                current = {}
            continue
        if line.startswith("worktree "):
            current["path"] = line[9:]
        elif line.startswith("HEAD "):
            current["head"] = line[5:]
        elif line.startswith("branch "):
            current["branch"] = line[7:]
        elif line == "bare":
            current["bare"] = "true"
        elif line == "detached":
            current["detached"] = "true"

    if current:
        worktrees.append(current)

    return worktrees


def create_worktree(
    branch: str,
    task_id: str,
    base_branch: str = "HEAD",
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a new worktree for a task.

    Creates both a new branch and worktree in a sibling directory.
    """
    cwd = cwd or os.getcwd()
    repo_root = get_repo_root(cwd)
    if not repo_root:
        return {"error": "Not in a git repository"}

    base_dir = get_worktree_base_dir(repo_root)
    worktree_path = os.path.join(base_dir, task_id)

    # Check if an active worktree already exists for this path.
    if os.path.isdir(worktree_path):
        active_paths = _active_worktree_paths(cwd)
        if _normalize_path(worktree_path) in active_paths:
            return {
                "exists": True,
                "path": worktree_path,
                "branch": branch,
                "task_id": task_id,
            }

        # Self-heal stale generated directories left by interrupted runs.
        try:
            _remove_stale_worktree_dir(worktree_path, base_dir)
        except OSError as exc:
            return {
                "error": (
                    "Failed to clean stale worktree directory "
                    f"{worktree_path}: {exc}"
                )
            }

    # Create base directory
    os.makedirs(base_dir, exist_ok=True)

    # Create worktree with new branch
    result = _run_git(
        "worktree", "add", "-b", branch, worktree_path, base_branch,
        cwd=cwd,
    )

    if result.returncode != 0:
        # Branch might already exist, try without -b
        result = _run_git(
            "worktree", "add", worktree_path, branch,
            cwd=cwd,
        )
        if result.returncode != 0:
            return {"error": f"Failed to create worktree: {result.stderr.strip()}"}

    return {
        "created": True,
        "path": worktree_path,
        "branch": branch,
        "task_id": task_id,
        "created_at": datetime.now().isoformat(),
    }


def remove_worktree(
    task_id: str,
    force: bool = False,
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    """Remove a worktree by task ID."""
    cwd = cwd or os.getcwd()
    repo_root = get_repo_root(cwd)
    if not repo_root:
        return {"error": "Not in a git repository"}

    base_dir = get_worktree_base_dir(repo_root)
    worktree_path = os.path.join(base_dir, task_id)

    if not os.path.isdir(worktree_path):
        return {"error": f"Worktree for {task_id} not found"}

    args = ["worktree", "remove"]
    if force:
        args.append("--force")
    args.append(worktree_path)

    result = _run_git(*args, cwd=cwd)
    if result.returncode != 0:
        return {"error": f"Failed to remove worktree: {result.stderr.strip()}"}

    return {"removed": True, "task_id": task_id, "path": worktree_path}


def cleanup_worktrees(cwd: Optional[str] = None) -> Dict[str, Any]:
    """Prune stale worktrees."""
    result = _run_git("worktree", "prune", cwd=cwd)
    removed = []
    failed = []

    # Also clean the base directory
    cwd = cwd or os.getcwd()
    repo_root = get_repo_root(cwd)
    if repo_root:
        base_dir = get_worktree_base_dir(repo_root)
        if os.path.isdir(base_dir):
            # List active worktree paths
            active = _active_worktree_paths(cwd)
            for entry in os.listdir(base_dir):
                full = os.path.join(base_dir, entry)
                if (
                    os.path.isdir(full)
                    and _normalize_path(full) not in active
                ):
                    try:
                        _remove_stale_worktree_dir(full, base_dir)
                        removed.append(entry)
                    except OSError as exc:
                        failed.append({
                            "path": full,
                            "error": str(exc),
                        })

    return {
        "pruned": result.returncode == 0,
        "removed_stale_dirs": removed,
        "failed_stale_dirs": failed,
    }


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description="Git Worktree 管理器")
    sub = parser.add_subparsers(dest="command")

    # create
    p_create = sub.add_parser("create", help="创建 worktree")
    p_create.add_argument("--branch", required=True, help="分支名称")
    p_create.add_argument("--task-id", required=True, help="任务 ID")
    p_create.add_argument("--base", default="HEAD", help="基础分支")

    # list
    sub.add_parser("list", help="列出所有 worktrees")

    # remove
    p_remove = sub.add_parser("remove", help="删除 worktree")
    p_remove.add_argument("--task-id", required=True, help="任务 ID")
    p_remove.add_argument("--force", action="store_true")

    # cleanup
    sub.add_parser("cleanup", help="清理过期 worktrees")

    args = parser.parse_args()

    if args.command == "create":
        result = create_worktree(args.branch, args.task_id, args.base)
    elif args.command == "list":
        worktrees = list_worktrees()
        result = {"worktrees": worktrees, "count": len(worktrees)}
    elif args.command == "remove":
        result = remove_worktree(args.task_id, args.force)
    elif args.command == "cleanup":
        result = cleanup_worktrees()
    else:
        parser.print_help()
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
