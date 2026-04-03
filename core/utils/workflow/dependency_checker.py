#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
依赖检查工具。

从 helpers.md / state-machine.md 中提取的任务依赖分析逻辑，
包括依赖满足检查、阻塞检查、并行可行性分析和自动分类。
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any, Dict, List, Optional, Set


# =============================================================================
# Dependency Check
# =============================================================================


def check_task_deps(
    depends: List[str],
    completed: List[str],
) -> Dict[str, Any]:
    """检查任务依赖是否满足。

    >>> check_task_deps(["T1", "T2"], ["T1"])
    {'satisfied': False, 'missing': ['T2']}
    >>> check_task_deps([], [])
    {'satisfied': True, 'missing': []}
    """
    if not depends:
        return {"satisfied": True, "missing": []}

    missing = [dep for dep in depends if dep not in completed]
    return {"satisfied": len(missing) == 0, "missing": missing}


def check_blocked_deps(
    blocked_by: List[str],
    unblocked: List[str],
) -> Dict[str, Any]:
    """检查阻塞依赖是否已解除。

    >>> check_blocked_deps(["api_spec"], ["api_spec"])
    {'satisfied': True, 'missing': []}
    >>> check_blocked_deps(["api_spec", "external"], [])
    {'satisfied': False, 'missing': ['api_spec', 'external']}
    """
    if not blocked_by:
        return {"satisfied": True, "missing": []}

    missing = [dep for dep in blocked_by if dep not in unblocked]
    return {"satisfied": len(missing) == 0, "missing": missing}


def reconcile_blocked_tasks(
    tasks: List[Dict[str, Any]],
    unblocked: List[str],
    blocked_progress: Optional[List[str]] = None,
) -> Dict[str, List[str]]:
    """根据 blocked_by 与 unblocked 重新计算 blocked/newly_unblocked。"""
    previous_blocked = set(blocked_progress or [])
    unblocked_set = set(unblocked)
    current_blocked: List[str] = []
    newly_unblocked: List[str] = []

    for task in tasks:
        task_id = task.get("id")
        blocked_by = task.get("blocked_by") or []
        missing = [dep for dep in blocked_by if dep not in unblocked_set]
        if not missing:
            if task_id in previous_blocked:
                newly_unblocked.append(task_id)
        elif task_id:
            current_blocked.append(task_id)

    return {
        "blocked": current_blocked,
        "newly_unblocked": newly_unblocked,
    }


# =============================================================================
# Dependency Auto-Classification
# =============================================================================

# 从 state-machine.md 中 classifyTaskDependencies() 提取
_API_NAME_PATTERN = re.compile(
    r"api|接口|服务层|service|fetch|request|http", re.IGNORECASE
)
_API_FILE_PATTERN = re.compile(r"services/|api/|http/", re.IGNORECASE)
_EXTERNAL_PATTERN = re.compile(
    r"第三方|sdk|外部服务|third.party|payment|sms|oauth|oss", re.IGNORECASE
)


def classify_deps(
    task_name: str,
    file_paths: List[str],
    unresolved_dependencies: Optional[List[Dict[str, str]]] = None,
) -> List[str]:
    """自动分类任务的阻塞依赖类型。

    从 state-machine.md 中 ``classifyTaskDependencies()`` 提取。

    >>> classify_deps("用户认证API接口", ["src/services/auth.ts"])
    ['api_spec']
    >>> classify_deps("集成第三方支付SDK", [])
    ['external']
    >>> classify_deps("添加按钮组件", ["src/components/Button.tsx"])
    []
    """
    deps: List[str] = []
    files_str = " ".join(file_paths).lower()

    # API 依赖检测
    if _API_NAME_PATTERN.search(task_name) or _API_FILE_PATTERN.search(files_str):
        deps.append("api_spec")

    # 外部依赖检测
    if unresolved_dependencies:
        for dep in unresolved_dependencies:
            if dep.get("status") == "not_started" and dep.get("type") not in deps:
                deps.append(dep["type"])
    elif _EXTERNAL_PATTERN.search(task_name):
        if "external" not in deps:
            deps.append("external")

    return deps


# =============================================================================
# Parallel Execution Analysis
# =============================================================================

# 共享状态路径片段
_SHARED_PATHS = ["store", "config", "constants", "types", "shared"]


def can_run_parallel(
    task_a_files: List[str],
    task_a_depends: List[str],
    task_a_intent: str,
    task_a_id: str,
    task_b_files: List[str],
    task_b_depends: List[str],
    task_b_intent: str,
    task_b_id: str,
) -> Dict[str, Any]:
    """检查两个任务是否可以并行执行。

    从 helpers.md 中 ``canRunInParallel()`` 提取（不含传递依赖检查，
    传递依赖需要完整任务图，见 ``find_parallel_groups``）。

    Returns:
        {"parallel": bool, "reason": str}
    """
    # 1. 文件独立检查
    files_a = set(task_a_files)
    files_b = set(task_b_files)
    overlap = files_a & files_b
    if overlap:
        return {"parallel": False, "reason": f"文件冲突: {', '.join(overlap)}"}

    # 2. 直接依赖检查
    if task_b_id in task_a_depends or task_a_id in task_b_depends:
        return {"parallel": False, "reason": "存在直接依赖关系"}

    # 3. 共享状态路径检查
    a_shared = any(
        any(f"/{p}/" in f for p in _SHARED_PATHS) for f in task_a_files
    )
    b_shared = any(
        any(f"/{p}/" in f for p in _SHARED_PATHS) for f in task_b_files
    )
    if a_shared and b_shared:
        return {"parallel": False, "reason": "同时操作共享状态目录"}

    # 4. 语义引用检查
    if any(f in task_b_intent for f in task_a_files if f):
        return {"parallel": False, "reason": "B 的步骤引用了 A 操作的文件"}
    if any(f in task_a_intent for f in task_b_files if f):
        return {"parallel": False, "reason": "A 的步骤引用了 B 操作的文件"}

    return {"parallel": True, "reason": "通过所有独立性检查"}


def _has_transitive_dep(
    task_id: str,
    target_id: str,
    deps_map: Dict[str, List[str]],
    visited: Optional[Set[str]] = None,
) -> bool:
    """检查传递依赖（内部递归）。"""
    if visited is None:
        visited = set()
    if task_id in visited:
        return False
    visited.add(task_id)

    for dep_id in deps_map.get(task_id, []):
        if dep_id == target_id:
            return True
        if _has_transitive_dep(dep_id, target_id, deps_map, visited):
            return True

    return False


def find_parallel_groups(
    tasks: List[Dict[str, Any]],
    completed: List[str],
    blocked: List[str],
    skipped: List[str],
    failed: List[str],
) -> List[List[str]]:
    """从当前治理 phase 的 pending 任务中找出可并行执行的任务组。

    从 helpers.md 中 ``findParallelGroup()`` 提取。

    Args:
        tasks: 任务列表，每个任务需包含 id, phase, files, depends, steps 等字段
        completed/blocked/skipped/failed: 各状态的任务 ID 列表

    Returns:
        并行组列表，如 [["T3", "T4"], ["T6", "T7"]]
    """
    excluded = set(completed + blocked + skipped + failed)

    # 筛选 pending 任务
    pending = [t for t in tasks if t["id"] not in excluded]
    if len(pending) < 2:
        return []

    # 按阶段分组
    current_phase = pending[0].get("phase", "")
    same_phase = [t for t in pending if t.get("phase") == current_phase]
    if len(same_phase) < 2:
        return []

    # 构建依赖图（用于传递依赖检查）
    deps_map: Dict[str, List[str]] = {}
    for t in tasks:
        deps_map[t["id"]] = t.get("depends", [])

    # 辅助函数：获取任务元数据
    def _files(t: Dict) -> List[str]:
        f = t.get("files", {})
        return (f.get("create", []) or []) + (f.get("modify", []) or []) + (f.get("test", []) or [])

    def _intent(t: Dict) -> str:
        return " ".join(
            f"{s.get('id', '')} {s.get('description', '')} {s.get('expected', '')}"
            for s in t.get("steps", [])
        )

    # 贪心分组
    groups: List[List[str]] = []
    assigned: Set[str] = set()

    for i, task_i in enumerate(same_phase):
        if task_i["id"] in assigned:
            continue

        group = [task_i["id"]]
        assigned.add(task_i["id"])

        for j in range(i + 1, len(same_phase)):
            task_j = same_phase[j]
            if task_j["id"] in assigned:
                continue

            # 检查与组内所有任务的并行性
            all_ok = True
            for g_id in group:
                g_task = next(t for t in tasks if t["id"] == g_id)

                # 传递依赖检查
                if _has_transitive_dep(g_id, task_j["id"], deps_map):
                    all_ok = False
                    break
                if _has_transitive_dep(task_j["id"], g_id, deps_map):
                    all_ok = False
                    break

                result = can_run_parallel(
                    _files(g_task), g_task.get("depends", []), _intent(g_task), g_id,
                    _files(task_j), task_j.get("depends", []), _intent(task_j), task_j["id"],
                )
                if not result["parallel"]:
                    all_ok = False
                    break

            if all_ok:
                group.append(task_j["id"])
                assigned.add(task_j["id"])

        if len(group) > 1:
            groups.append(group)

    return groups


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="依赖检查工具")
    sub = parser.add_subparsers(dest="command")

    # check-deps
    p_deps = sub.add_parser("check-deps", help="检查任务依赖")
    p_deps.add_argument("--depends", default="", help="依赖 ID 列表（逗号分隔）")
    p_deps.add_argument("--completed", default="", help="已完成 ID 列表")

    # check-blocked
    p_blocked = sub.add_parser("check-blocked", help="检查阻塞依赖")
    p_blocked.add_argument("--blocked-by", default="", help="阻塞依赖列表")
    p_blocked.add_argument("--unblocked", default="", help="已解除列表")

    # classify
    p_classify = sub.add_parser("classify", help="自动分类依赖类型")
    p_classify.add_argument("--name", required=True, help="任务名称")
    p_classify.add_argument("--files", default="", help="文件路径列表（逗号分隔）")

    # parallel
    p_par = sub.add_parser("parallel", help="查找并行组")
    p_par.add_argument("--file", dest="file", help="任务 JSON 文件路径")
    p_par.add_argument("--tasks-file", dest="file", help=argparse.SUPPRESS)
    p_par.add_argument("--completed", default="", help="已完成 ID 列表")
    p_par.add_argument("--blocked", default="", help="已阻塞 ID 列表")

    args = parser.parse_args()
    split = lambda s: [x.strip() for x in s.split(",") if x.strip()]

    if args.command == "check-deps":
        result = check_task_deps(split(args.depends), split(args.completed))
        print(json.dumps(result))

    elif args.command == "check-blocked":
        result = check_blocked_deps(split(args.blocked_by), split(args.unblocked))
        print(json.dumps(result))

    elif args.command == "classify":
        result = classify_deps(args.name, split(args.files))
        print(json.dumps({"dependencies": result}))

    elif args.command == "parallel":
        if not args.file:
            parser.error("parallel 需要提供 --file")
        with open(args.file, "r", encoding="utf-8") as f:
            tasks = json.load(f)
        groups = find_parallel_groups(
            tasks,
            completed=split(args.completed),
            blocked=split(args.blocked),
            skipped=[],
            failed=[],
        )
        print(json.dumps({"parallel_groups": groups}))

    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
