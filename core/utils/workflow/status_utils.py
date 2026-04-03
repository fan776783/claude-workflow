#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
状态/Emoji 工具函数。

从 shared-utils.md / helpers.md 中提取的确定性映射逻辑。
"""

from __future__ import annotations

import re
from typing import List, Optional, TypeVar

T = TypeVar("T")

# =============================================================================
# Status Emoji Constants
# =============================================================================

# Regex matching a trailing status emoji (with optional variation selector)
STATUS_EMOJI_REGEX = re.compile(r"(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$", re.UNICODE)

# Regex for stripping status emoji from a title
STRIP_STATUS_EMOJI_REGEX = re.compile(
    r"\s*(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$", re.UNICODE
)

# Emoji → Status mapping
_EMOJI_TO_STATUS = {
    "✅": "completed",
    "⏳": "in_progress",
    "❌": "failed",
    "⏭️": "skipped",
    "⏭\uFE0F": "skipped",
    "⏭": "skipped",
}

# Status → Emoji mapping
_STATUS_TO_EMOJI = {
    "completed": "✅",
    "in_progress": "⏳",
    "failed": "❌",
    "skipped": "⏭️",
}


# =============================================================================
# Public API
# =============================================================================


def get_status_emoji(status: str) -> str:
    """Get the emoji for a given status string.

    >>> get_status_emoji("completed")
    '✅'
    >>> get_status_emoji("unknown")
    ''
    """
    for key, emoji in _STATUS_TO_EMOJI.items():
        if key in status:
            return emoji
    return ""


def extract_status_from_title(title: str) -> Optional[str]:
    """Extract status from a task title's trailing emoji.

    >>> extract_status_from_title("实现登录功能 ✅")
    'completed'
    >>> extract_status_from_title("普通标题")
    """
    match = STATUS_EMOJI_REGEX.search(title)
    if not match:
        return None
    emoji = match.group(0).strip()
    return _EMOJI_TO_STATUS.get(emoji)


def strip_status_emoji(title: str) -> str:
    """Remove trailing status emoji from a title.

    >>> strip_status_emoji("实现登录功能 ✅")
    '实现登录功能'
    """
    return STRIP_STATUS_EMOJI_REGEX.sub("", title).strip()


def add_unique(arr: List[T], item: T) -> None:
    """Add *item* to *arr* only if not already present (in-place).

    >>> lst = ["a", "b"]; add_unique(lst, "b"); lst
    ['a', 'b']
    >>> lst = ["a"]; add_unique(lst, "c"); lst
    ['a', 'c']
    """
    if item not in arr:
        arr.append(item)


def escape_regexp(s: str) -> str:
    """Escape special regex characters in a string.

    >>> escape_regexp("T1.2")
    'T1\\\\.2'
    """
    return re.escape(s)


def validate_task_id(task_id: str) -> bool:
    """Validate that a task ID matches the expected format ``T\\d+``.

    >>> validate_task_id("T1")
    True
    >>> validate_task_id("task-1")
    False
    """
    return bool(re.fullmatch(r"T\d+", task_id))


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    import argparse
    import json
    import sys

    parser = argparse.ArgumentParser(description="Status / Emoji 工具")
    sub = parser.add_subparsers(dest="command")

    # emoji
    p_emoji = sub.add_parser("emoji", help="获取状态对应的 emoji")
    p_emoji.add_argument("status", help="状态名称")

    # extract
    p_extract = sub.add_parser("extract", help="从标题中提取状态")
    p_extract.add_argument("title", help="任务标题")

    # validate
    p_validate = sub.add_parser("validate", help="验证任务 ID 格式")
    p_validate.add_argument("task_id", help="任务 ID")

    args = parser.parse_args()

    if args.command == "emoji":
        result = get_status_emoji(args.status)
        print(json.dumps({"emoji": result}, ensure_ascii=False))
    elif args.command == "extract":
        result = extract_status_from_title(args.title)
        print(json.dumps({"status": result}, ensure_ascii=False))
    elif args.command == "validate":
        result = validate_task_id(args.task_id)
        print(json.dumps({"valid": result}))
    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
