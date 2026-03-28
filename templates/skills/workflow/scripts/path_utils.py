#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
路径安全工具函数。

从 shared-utils.md 中提取的 resolveUnder 等安全关键逻辑。
安全逻辑不应依赖 AI 每次正确实现 — 必须由代码保证。
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional


# =============================================================================
# Public API
# =============================================================================


def resolve_under(base_dir: str, relative_path: str) -> Optional[str]:
    """安全解析相对路径，防止路径遍历攻击。

    返回绝对路径字符串，若路径不安全则返回 None。

    规则:
      - 拒绝空路径
      - 拒绝绝对路径
      - 拒绝包含 '..' 的路径
      - 拒绝包含特殊字符的路径
      - 拒绝解析后逃逸出 base_dir 的路径

    >>> resolve_under("/project", "src/main.py") is not None
    True
    >>> resolve_under("/project", "../etc/passwd") is None
    True
    >>> resolve_under("/project", "/etc/passwd") is None
    True
    """
    if not relative_path:
        return None

    if os.path.isabs(relative_path):
        return None

    if ".." in relative_path:
        return None

    # Only allow safe characters
    if not re.fullmatch(r"[a-zA-Z0-9_\-./]+", relative_path):
        return None

    # Reject leading slash, double slash, trailing whitespace-slash
    if re.search(r"^/|//|/\s*$", relative_path):
        return None

    resolved = os.path.realpath(os.path.join(base_dir, relative_path))
    normalized_base = os.path.realpath(base_dir)

    if resolved != normalized_base and not resolved.startswith(
        normalized_base + os.sep
    ):
        return None

    return resolved


def validate_project_id(project_id: str) -> bool:
    """验证项目 ID 是否安全（防注入）。

    >>> validate_project_id("abc123")
    True
    >>> validate_project_id("abc/../../etc")
    False
    >>> validate_project_id("")
    False
    """
    if not project_id:
        return False
    return bool(re.fullmatch(r"[a-zA-Z0-9_\-]+", project_id))


def get_workflows_dir(project_id: str) -> Optional[str]:
    """获取工作流目录路径。

    返回 ``~/.claude/workflows/{projectId}/`` 的绝对路径。
    若项目 ID 不安全则返回 None。
    """
    if not validate_project_id(project_id):
        return None

    home = Path.home()
    return str(home / ".claude" / "workflows" / project_id)


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    import argparse
    import json
    import sys

    parser = argparse.ArgumentParser(description="路径安全工具")
    sub = parser.add_subparsers(dest="command")

    # resolve
    p_resolve = sub.add_parser("resolve", help="安全解析相对路径")
    p_resolve.add_argument("base_dir", help="基础目录")
    p_resolve.add_argument("relative_path", help="相对路径")

    # validate-id
    p_vid = sub.add_parser("validate-id", help="验证项目 ID")
    p_vid.add_argument("project_id", help="项目 ID")

    # workflows-dir
    p_wdir = sub.add_parser("workflows-dir", help="获取工作流目录路径")
    p_wdir.add_argument("project_id", help="项目 ID")

    args = parser.parse_args()

    if args.command == "resolve":
        result = resolve_under(args.base_dir, args.relative_path)
        print(json.dumps({"resolved": result}))
    elif args.command == "validate-id":
        result = validate_project_id(args.project_id)
        print(json.dumps({"valid": result}))
    elif args.command == "workflows-dir":
        result = get_workflows_dir(args.project_id)
        print(json.dumps({"path": result}))
    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
