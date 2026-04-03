#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证门控工具。

从 execution-modes.md 的 Step 6.5（Verification Iron Law）中提取的
结构化验证证据生成逻辑。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional


# =============================================================================
# Verification Evidence
# =============================================================================


def create_evidence(
    command: str,
    exit_code: int,
    output_summary: str,
    passed: bool,
    artifact_ref: Optional[str] = None,
) -> Dict[str, Any]:
    """创建结构化验证证据。

    对应 TypeScript 接口 ``VerificationEvidence``。

    >>> e = create_evidence("npm test", 0, "All tests passed", True)
    >>> e["passed"]
    True
    >>> "timestamp" in e
    True
    """
    evidence: Dict[str, Any] = {
        "command": command,
        "exit_code": exit_code,
        "output_summary": output_summary[:500],  # 截取 ≤ 500 字符
        "timestamp": datetime.now().isoformat(),
        "passed": passed,
    }
    if artifact_ref:
        evidence["artifact_ref"] = artifact_ref
    return evidence


# =============================================================================
# Verification Command Mapping
# =============================================================================

# 从 execution-modes.md Step 6.5 的验证命令映射表提取
_ACTION_VERIFICATION_MAP = {
    "create_file": {
        "description": "运行相关测试 或 语法检查",
        "pass_condition": "测试通过 或 无语法错误",
    },
    "edit_file": {
        "description": "运行相关测试 或 语法检查",
        "pass_condition": "测试通过 或 无语法错误",
    },
    "run_tests": {
        "description": "读取测试输出",
        "pass_condition": "全部通过，exit_code = 0",
    },
    "quality_review": {
        "description": "读取两阶段审查结果",
        "pass_condition": "quality_gates[taskId].overall_passed === true",
    },
    "git_commit": {
        "description": 'git log -1 --format="%H %s"',
        "pass_condition": "commit hash 存在且消息匹配",
    },
}


def get_verification_info(action: str) -> Optional[Dict[str, str]]:
    """获取 action 类型对应的验证信息。

    >>> get_verification_info("run_tests")
    {'description': '读取测试输出', 'pass_condition': '全部通过，exit_code = 0'}
    >>> get_verification_info("unknown") is None
    True
    """
    return _ACTION_VERIFICATION_MAP.get(action)


def get_verification_commands(actions: List[str]) -> List[Dict[str, str]]:
    """根据任务的 actions 列表获取所有需要执行的验证。

    >>> cmds = get_verification_commands(["create_file", "run_tests"])
    >>> len(cmds)
    2
    """
    result = []
    seen = set()
    for action in actions:
        info = get_verification_info(action)
        if info and info["description"] not in seen:
            result.append({"action": action, **info})
            seen.add(info["description"])
    return result


# =============================================================================
# Evidence Validation
# =============================================================================


def validate_evidence(evidence: Dict[str, Any]) -> Dict[str, Any]:
    """验证证据的完整性。

    >>> validate_evidence({"command": "test", "exit_code": 0, "output_summary": "ok", "timestamp": "t", "passed": True})
    {'valid': True, 'missing_fields': []}
    >>> validate_evidence({"command": "test"})
    {'valid': False, 'missing_fields': ['exit_code', 'output_summary', 'timestamp', 'passed']}
    """
    required = ["command", "exit_code", "output_summary", "timestamp", "passed"]
    missing = [f for f in required if f not in evidence]
    return {"valid": len(missing) == 0, "missing_fields": missing}


def validate_verification_order(
    evidence: Optional[Dict[str, Any]],
    state_updated: bool,
    plan_updated: bool,
    quality_gate_passed: bool = True,
) -> Dict[str, Any]:
    """检查 Verification Iron Law：验证必须先于 plan/state 更新。"""
    result = validate_evidence(evidence or {}) if evidence else {"valid": False, "missing_fields": ["evidence"]}
    violations: List[str] = []
    if not result["valid"]:
        violations.append("missing_or_invalid_evidence")
    if (state_updated or plan_updated) and not result["valid"]:
        violations.append("updated_before_verification")
    if not quality_gate_passed:
        violations.append("quality_gate_not_passed")
    return {
        "valid": not violations,
        "violations": violations,
    }


# =============================================================================
# CLI Entry
# =============================================================================


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="验证门控工具")
    sub = parser.add_subparsers(dest="command")

    # create
    p_create = sub.add_parser("create", help="创建验证证据")
    p_create.add_argument("--cmd", required=True, help="执行的验证命令")
    p_create.add_argument("--exit-code", type=int, required=True, help="退出码")
    p_create.add_argument("--output", required=True, help="输出摘要")
    p_create.add_argument("--passed", action="store_true", help="是否通过")
    p_create.add_argument("--artifact-ref", help="关联产物引用")

    # info
    p_info = sub.add_parser("info", help="获取 action 的验证信息")
    p_info.add_argument("actions", nargs="+", help="action 类型列表")

    args = parser.parse_args()

    if args.command == "create":
        evidence = create_evidence(
            args.cmd, args.exit_code, args.output, args.passed, args.artifact_ref
        )
        print(json.dumps(evidence, ensure_ascii=False))

    elif args.command == "info":
        cmds = get_verification_commands(args.actions)
        print(json.dumps(cmds, ensure_ascii=False))

    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
