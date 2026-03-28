#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Markdown 任务解析器。

从 helpers.md / shared-utils.md 中提取的 V2 任务模型解析逻辑。
这些正则匹配逻辑如果由 AI 每次重新实现，健壮性无法保证。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from status_utils import (
    STRIP_STATUS_EMOJI_REGEX,
    escape_regexp,
    extract_status_from_title,
    validate_task_id,
)


# =============================================================================
# Data Model (对应 TypeScript interface WorkflowTaskV2)
# =============================================================================


@dataclass
class TaskStep:
    """任务步骤。"""

    id: str
    description: str
    expected: str
    verification: Optional[str] = None


@dataclass
class TaskVerification:
    """任务验证信息。"""

    commands: List[str] = field(default_factory=list)
    expected_output: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


@dataclass
class TaskFiles:
    """任务文件集合。"""

    create: List[str] = field(default_factory=list)
    modify: List[str] = field(default_factory=list)
    test: List[str] = field(default_factory=list)


@dataclass
class WorkflowTaskV2:
    """V2 任务模型（对应 TypeScript WorkflowTaskV2 接口）。"""

    id: str
    name: str
    phase: str = "implement"
    files: TaskFiles = field(default_factory=TaskFiles)
    leverage: List[str] = field(default_factory=list)
    spec_ref: str = "§Unknown"
    plan_ref: str = "P-UNKNOWN"
    requirement_ids: List[str] = field(default_factory=list)
    critical_constraints: List[str] = field(default_factory=list)
    acceptance_criteria: List[str] = field(default_factory=list)
    depends: List[str] = field(default_factory=list)
    blocked_by: List[str] = field(default_factory=list)
    quality_gate: bool = False
    status: str = "pending"
    actions: List[str] = field(default_factory=list)
    steps: List[TaskStep] = field(default_factory=list)
    verification: Optional[TaskVerification] = None

    def all_files(self) -> List[str]:
        """获取所有关联文件。"""
        return [
            f
            for f in (self.files.create + self.files.modify + self.files.test)
            if f
        ]

    def intent_text(self) -> str:
        """获取任务语义文本（用于并行独立性检查）。"""
        return " ".join(
            f"{s.id} {s.description} {s.expected}" for s in self.steps
        )


# =============================================================================
# Field Extraction (from task block text)
# =============================================================================


def extract_field(body: str, field_name: str) -> Optional[str]:
    """从任务内容中提取字段值。

    支持两种 markdown 书写方式:
      - ``- **字段**: 值``
      - ``**字段**: 值``

    >>> extract_field("- **阶段**: `foundation`", "阶段")
    'foundation'
    """
    pattern = re.compile(
        rf"^\s*-?\s*\*\*{re.escape(field_name)}\*\*\s*:\s*(.+?)$",
        re.MULTILINE | re.IGNORECASE,
    )
    match = pattern.search(body)
    if not match:
        return None
    return match.group(1).replace("`", "").strip()


def extract_list_field(body: str, field_name: str) -> List[str]:
    """提取逗号分隔的列表字段。"""
    value = extract_field(body, field_name)
    if not value:
        return []
    return [s.strip() for s in value.split(",") if s.strip()]


def parse_quality_gate(body: str) -> bool:
    """解析任务是否为质量关卡。"""
    value = extract_field(body, "质量关卡")
    if not value:
        return False
    return value.lower() in ("true", "是")


# =============================================================================
# Task Block Extraction
# =============================================================================


def extract_all_task_ids(content: str) -> List[str]:
    """从任务清单中提取所有任务 ID。

    >>> extract_all_task_ids("## T1: 任务1\\n## T2: 任务2\\n")
    ['T1', 'T2']
    """
    return re.findall(r"##+\s+(T\d+):", content)


def extract_task_block(content: str, task_id: str) -> str:
    """提取指定任务 ID 的完整内容块。"""
    if not validate_task_id(task_id):
        return ""
    escaped_id = escape_regexp(task_id)
    pattern = re.compile(
        rf"##+\s+{escaped_id}:[\s\S]*?(?=\n##+\s+T\d+:|$)", re.MULTILINE
    )
    match = pattern.search(content)
    return match.group(0) if match else ""


def extract_steps(content: str, task_id: str) -> List[TaskStep]:
    """提取任务步骤。"""
    task_block = extract_task_block(content, task_id)
    steps_section_match = re.search(
        r"-\s+\*\*步骤\*\*:[\s\S]*$", task_block
    )
    if not steps_section_match:
        return []

    steps_section = steps_section_match.group(0)
    step_pattern = re.compile(
        r"-\s+([A-Z]\d+):\s+(.+?)\s+→\s+(.+?)(?:（验证：(.*?)）)?$",
        re.MULTILINE,
    )
    return [
        TaskStep(
            id=m.group(1),
            description=m.group(2),
            expected=m.group(3),
            verification=m.group(4) or None,
        )
        for m in step_pattern.finditer(steps_section)
    ]


def parse_task_files(body: str) -> TaskFiles:
    """解析任务的文件集合。"""
    return TaskFiles(
        create=extract_list_field(body, "创建文件"),
        modify=extract_list_field(body, "修改文件"),
        test=extract_list_field(body, "测试文件"),
    )


def parse_task_verification(body: str) -> Optional[TaskVerification]:
    """解析任务验证信息。"""
    commands = extract_list_field(body, "验证命令")
    expected = extract_list_field(body, "验证期望")
    notes = extract_list_field(body, "验证备注")
    if not (commands or expected or notes):
        return None
    return TaskVerification(commands=commands, expected_output=expected, notes=notes)


# =============================================================================
# Full Parser
# =============================================================================


def parse_tasks_v2(content: str) -> List[WorkflowTaskV2]:
    """解析 Markdown 任务清单为 V2 任务模型列表。

    这是从 shared-utils.md 中 ``parseWorkflowTasksV2FromMarkdown()``
    完整提取的确定性解析逻辑。
    """
    task_ids = extract_all_task_ids(content)
    tasks: List[WorkflowTaskV2] = []

    for task_id in task_ids:
        body = extract_task_block(content, task_id)
        if not body:
            continue

        # 标题解析
        title_match = re.match(
            r"##+\s+T\d+:\s*(.+?)\s*\n", body, re.MULTILINE
        )
        raw_title = title_match.group(1) if title_match else task_id
        title_status = extract_status_from_title(raw_title)
        name = STRIP_STATUS_EMOJI_REGEX.sub("", raw_title).strip()

        task = WorkflowTaskV2(
            id=task_id,
            name=name,
            phase=extract_field(body, "阶段") or "implement",
            files=parse_task_files(body),
            leverage=extract_list_field(body, "复用"),
            spec_ref=extract_field(body, "Spec 参考") or "§Unknown",
            plan_ref=extract_field(body, "Plan 参考") or "P-UNKNOWN",
            requirement_ids=extract_list_field(body, "需求 ID"),
            critical_constraints=extract_list_field(body, "关键约束"),
            acceptance_criteria=extract_list_field(body, "验收项"),
            depends=extract_list_field(body, "依赖"),
            blocked_by=extract_list_field(body, "阻塞依赖"),
            quality_gate=parse_quality_gate(body),
            status=(
                title_status
                or extract_field(body, "状态")
                or "pending"
            ),
            actions=extract_list_field(body, "actions"),
            steps=extract_steps(content, task_id),
            verification=parse_task_verification(body),
        )
        tasks.append(task)

    return tasks


# =============================================================================
# Query Functions
# =============================================================================


def find_next_task(
    content: str,
    completed: List[str],
    skipped: List[str],
    failed: List[str],
    blocked: Optional[List[str]] = None,
) -> Optional[str]:
    """查找下一个待执行的任务 ID。"""
    blocked = blocked or []
    excluded = set(completed + skipped + failed)

    for task_id in extract_all_task_ids(content):
        if task_id not in excluded and task_id not in blocked:
            return task_id

    return None


def count_tasks(content: str) -> int:
    """统计任务总数。"""
    return len(extract_all_task_ids(content))


def extract_constraints(content: str) -> List[str]:
    """从任务清单中提取全局约束。"""
    match = re.search(
        r"##\s*约束[^\n]*\n([\s\S]*?)(?=\n##|$)", content, re.IGNORECASE
    )
    if not match:
        return []
    return [
        line.strip()[2:].strip()
        for line in match.group(1).split("\n")
        if line.strip().startswith("- ")
    ]


# =============================================================================
# Markdown Status Update
# =============================================================================


def update_task_status_in_markdown(
    content: str, task_id: str, new_status: str
) -> str:
    """更新任务清单中的任务状态（修改标题中的 emoji）。

    从 helpers.md 中 ``updateTaskStatusInMarkdown()`` 提取。
    """
    from status_utils import get_status_emoji

    if not validate_task_id(task_id):
        return content

    escaped_id = escape_regexp(task_id)
    emoji = get_status_emoji(new_status)

    # 匹配任务标题行
    pattern = re.compile(
        rf"(##+\s+{escaped_id}:\s*)(.+?)(\s*\n)", re.MULTILINE
    )

    def replacer(match: re.Match) -> str:
        prefix = match.group(1)
        title = match.group(2)
        suffix = match.group(3)
        clean_title = STRIP_STATUS_EMOJI_REGEX.sub("", title).strip()
        return f"{prefix}{clean_title} {emoji}{suffix}"

    return pattern.sub(replacer, content, count=1)


# =============================================================================
# Serialization Helper
# =============================================================================


def task_to_dict(task: WorkflowTaskV2) -> Dict[str, Any]:
    """将 WorkflowTaskV2 序列化为字典（用于 JSON 输出）。"""
    d = asdict(task)
    # 移除 None 值
    if d.get("verification") is None:
        del d["verification"]
    return d


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Markdown 任务解析器")
    sub = parser.add_subparsers(dest="command")

    # parse
    p_parse = sub.add_parser("parse", help="解析任务清单")
    p_parse.add_argument("file", help="任务清单文件路径")

    # find-next
    p_next = sub.add_parser("find-next", help="查找下一个待执行任务")
    p_next.add_argument("--tasks-file", required=True, help="任务清单文件路径")
    p_next.add_argument("--completed", default="", help="已完成任务 ID 列表（逗号分隔）")
    p_next.add_argument("--skipped", default="", help="已跳过任务 ID 列表")
    p_next.add_argument("--failed", default="", help="已失败任务 ID 列表")
    p_next.add_argument("--blocked", default="", help="已阻塞任务 ID 列表")

    # count
    p_count = sub.add_parser("count", help="统计任务总数")
    p_count.add_argument("file", help="任务清单文件路径")

    # constraints
    p_constr = sub.add_parser("constraints", help="提取全局约束")
    p_constr.add_argument("file", help="任务清单文件路径")

    # update-status
    p_update = sub.add_parser("update-status", help="更新任务状态")
    p_update.add_argument("file", help="任务清单文件路径")
    p_update.add_argument("task_id", help="任务 ID")
    p_update.add_argument("status", help="新状态")
    p_update.add_argument("--dry-run", action="store_true", help="仅输出结果不写入")

    args = parser.parse_args()

    if args.command == "parse":
        with open(args.file, "r", encoding="utf-8") as f:
            content = f.read()
        tasks = parse_tasks_v2(content)
        print(json.dumps([task_to_dict(t) for t in tasks], indent=2, ensure_ascii=False))

    elif args.command == "find-next":
        with open(args.tasks_file, "r", encoding="utf-8") as f:
            content = f.read()
        split = lambda s: [x.strip() for x in s.split(",") if x.strip()]
        result = find_next_task(
            content,
            completed=split(args.completed),
            skipped=split(args.skipped),
            failed=split(args.failed),
            blocked=split(args.blocked),
        )
        print(json.dumps({"next_task": result}))

    elif args.command == "count":
        with open(args.file, "r", encoding="utf-8") as f:
            content = f.read()
        print(json.dumps({"count": count_tasks(content)}))

    elif args.command == "constraints":
        with open(args.file, "r", encoding="utf-8") as f:
            content = f.read()
        print(json.dumps({"constraints": extract_constraints(content)}, ensure_ascii=False))

    elif args.command == "update-status":
        with open(args.file, "r", encoding="utf-8") as f:
            content = f.read()
        updated = update_task_status_in_markdown(content, args.task_id, args.status)
        if args.dry_run:
            print(updated)
        else:
            with open(args.file, "w", encoding="utf-8") as f:
                f.write(updated)
            print(json.dumps({"updated": True, "task_id": args.task_id, "status": args.status}))

    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
