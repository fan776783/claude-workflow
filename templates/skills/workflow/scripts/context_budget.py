#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
上下文预算计算工具。

从 shared-utils.md 中提取的纯数学计算逻辑。
ContextGovernor 的阈值比较在此实现，决策应用保留为伪代码。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional


# =============================================================================
# Token Estimation
# =============================================================================


def estimate_tokens(*contents: Optional[str]) -> int:
    """估算文本内容的 token 数量（字符数 / 4）。

    >>> estimate_tokens("Hello world", "Test")
    4
    >>> estimate_tokens(None, "")
    0
    """
    total_chars = 0
    for content in contents:
        if content:
            total_chars += len(content)
    return round(total_chars / 4)


# =============================================================================
# Task Complexity
# =============================================================================


def detect_complexity(
    actions_count: int,
    file_count: int,
    is_quality_gate: bool,
    has_structured_steps: bool,
) -> str:
    """检测任务复杂度。

    >>> detect_complexity(1, 1, False, False)
    'simple'
    >>> detect_complexity(1, 3, False, True)
    'complex'
    """
    if is_quality_gate or has_structured_steps or file_count > 1:
        return "complex"
    if actions_count > 2:
        return "medium"
    return "simple"


# =============================================================================
# Dynamic Task Limits
# =============================================================================


def calculate_max_tasks(
    complexity: str,
    usage_percent: float,
) -> int:
    """根据复杂度和上下文使用率计算最大连续任务数。

    >>> calculate_max_tasks("simple", 30)
    8
    >>> calculate_max_tasks("medium", 75)
    2
    >>> calculate_max_tasks("complex", 85)
    1
    """
    base_limit = {"simple": 8, "medium": 5, "complex": 3}.get(complexity, 5)

    if usage_percent >= 80:
        return 1
    if usage_percent >= 70:
        return max(2, base_limit - 3)
    if usage_percent >= 50:
        return max(3, base_limit - 1)
    return base_limit


# =============================================================================
# Budget Threshold Evaluation (纯数学比较)
# =============================================================================


def evaluate_budget_thresholds(
    projected_usage_percent: float,
    warning_threshold: float = 60,
    danger_threshold: float = 80,
    hard_handoff_threshold: float = 90,
) -> Dict[str, Any]:
    """评估上下文预算阈值，返回纯数学比较结果。

    注意：此函数只返回阈值状态，不做决策（决策由 AI 的 ContextGovernor 执行）。

    >>> evaluate_budget_thresholds(55)
    {'level': 'safe', 'at_warning': False, 'at_danger': False, 'at_hard_handoff': False, 'projected_usage_percent': 55}
    >>> evaluate_budget_thresholds(85)
    {'level': 'danger', 'at_warning': True, 'at_danger': True, 'at_hard_handoff': False, 'projected_usage_percent': 85}
    """
    at_warning = projected_usage_percent >= warning_threshold
    at_danger = projected_usage_percent >= danger_threshold
    at_hard_handoff = projected_usage_percent >= hard_handoff_threshold

    if at_hard_handoff:
        level = "hard_handoff"
    elif at_danger:
        level = "danger"
    elif at_warning:
        level = "warning"
    else:
        level = "safe"

    return {
        "level": level,
        "at_warning": at_warning,
        "at_danger": at_danger,
        "at_hard_handoff": at_hard_handoff,
        "projected_usage_percent": projected_usage_percent,
    }


def project_next_turn_cost(
    current_tokens: int,
    execution_cost: int = 8000,
    verification_cost: int = 5000,
    review_cost: int = 0,
    safety_buffer: int = 4000,
) -> Dict[str, int]:
    """估算下一执行单元的 projected token 成本。

    >>> project_next_turn_cost(50000)
    {'current': 50000, 'execution': 8000, 'verification': 5000, 'review': 0, 'safety': 4000, 'projected_total': 67000}
    """
    projected_total = (
        current_tokens + execution_cost + verification_cost + review_cost + safety_buffer
    )
    return {
        "current": current_tokens,
        "execution": execution_cost,
        "verification": verification_cost,
        "review": review_cost,
        "safety": safety_buffer,
        "projected_total": projected_total,
    }


# =============================================================================
# Visual Bars
# =============================================================================


def generate_context_bar(
    usage_percent: float,
    warning_threshold: float = 60,
    danger_threshold: float = 80,
) -> str:
    """生成上下文使用率的可视化进度条。

    >>> generate_context_bar(45)
    '[🟩🟩🟩🟩🟩🟩🟩🟩🟩░░░░░░░░░░░] 45%'
    """
    filled = round(usage_percent / 5)
    bar = ""
    for i in range(20):
        if i < filled:
            if i >= danger_threshold / 5:
                bar += "🟥"
            elif i >= warning_threshold / 5:
                bar += "🟨"
            else:
                bar += "🟩"
        else:
            bar += "░"
    return f"[{bar}] {round(usage_percent)}%"


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="上下文预算计算工具")
    sub = parser.add_subparsers(dest="command")

    # estimate
    p_est = sub.add_parser("estimate", help="估算 token 数量")
    p_est.add_argument("files", nargs="+", help="文件路径列表")

    # complexity
    p_cx = sub.add_parser("complexity", help="检测任务复杂度")
    p_cx.add_argument("--actions", type=int, default=1, help="动作数")
    p_cx.add_argument("--files", type=int, default=1, help="文件数")
    p_cx.add_argument("--quality-gate", action="store_true")
    p_cx.add_argument("--structured-steps", action="store_true")

    # max-tasks
    p_mt = sub.add_parser("max-tasks", help="计算最大连续任务数")
    p_mt.add_argument("--complexity", required=True, choices=["simple", "medium", "complex"])
    p_mt.add_argument("--usage", type=float, required=True, help="上下文使用率 (%)")

    # budget
    p_budget = sub.add_parser("budget", help="评估预算阈值")
    p_budget.add_argument("--projected-usage", type=float, required=True, help="预计使用率 (%)")
    p_budget.add_argument("--warning", type=float, default=60)
    p_budget.add_argument("--danger", type=float, default=80)
    p_budget.add_argument("--hard-handoff", type=float, default=90)

    # context-bar
    p_bar = sub.add_parser("context-bar", help="生成上下文进度条")
    p_bar.add_argument("--usage", type=float, required=True, help="使用率 (%)")

    args = parser.parse_args()

    if args.command == "estimate":
        contents = []
        for fp in args.files:
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    contents.append(f.read())
            except (OSError, IOError):
                contents.append(None)
        tokens = estimate_tokens(*contents)
        print(json.dumps({"estimated_tokens": tokens}))

    elif args.command == "complexity":
        result = detect_complexity(args.actions, args.files, args.quality_gate, args.structured_steps)
        print(json.dumps({"complexity": result}))

    elif args.command == "max-tasks":
        result = calculate_max_tasks(args.complexity, args.usage)
        print(json.dumps({"max_consecutive_tasks": result}))

    elif args.command == "budget":
        result = evaluate_budget_thresholds(
            args.projected_usage, args.warning, args.danger, args.hard_handoff
        )
        print(json.dumps(result))

    elif args.command == "context-bar":
        bar = generate_context_bar(args.usage)
        print(json.dumps({"bar": bar}, ensure_ascii=False))

    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
