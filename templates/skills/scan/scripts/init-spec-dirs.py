#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
项目 Spec 目录初始化脚本。

在 `/scan` 完成后调用，根据 project-config.json 中的技术栈信息
自动生成 `.claude/specs/` 目录骨架。

用法:
    python3 init-spec-dirs.py --project-root /path/to/project [--force]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional


# =============================================================================
# Templates
# =============================================================================

INDEX_TEMPLATE = """# {layer} 层规范

## Pre-Development Checklist

在修改 {layer} 层代码前，请确认：

- [ ] 阅读了相关的 [思维指南](../guides/index.md)
- [ ] 了解了项目的错误处理模式
- [ ] 检查了可复用的现有组件

## 规范文件

| 文件 | 说明 |
|------|------|
| *(待补充)* | 随项目演进添加 |

## Quality Check

完成修改后，请确认：

- [ ] 代码风格与项目现有代码一致
- [ ] 错误处理遵循项目约定
- [ ] 有适当的测试覆盖
"""

GUIDES_INDEX_NOTE = """
## 思维指南

本项目的思维指南位于 `guides/` 目录：

- [代码复用检查清单](./guides/code-reuse-checklist.md)
- [跨层检查清单](./guides/cross-layer-checklist.md)
- [AI 审查误报指南](./guides/ai-review-false-positive-guide.md)
"""

ROOT_INDEX_TEMPLATE = """# 项目规范索引

> 此目录包含项目级编码规范和思维指南。
> AI 在执行任务前应阅读相关层的规范文件。

## 层级规范

{layers_table}

{guides_note}

## 维护说明

- 发现新的编码模式时，更新对应层的规范文件
- 使用 `/update-spec` 或手动编辑持久化新规范
- 规范文件应提交到 Git，确保团队共享
"""


# =============================================================================
# Layer Detection
# =============================================================================

# 技术栈 → 推荐层结构
_STACK_LAYERS: Dict[str, List[str]] = {
    "react": ["frontend", "shared"],
    "vue": ["frontend", "shared"],
    "angular": ["frontend", "shared"],
    "next": ["frontend", "backend", "shared"],
    "nuxt": ["frontend", "backend", "shared"],
    "express": ["backend", "shared"],
    "fastapi": ["backend", "shared"],
    "django": ["backend", "shared"],
    "flask": ["backend", "shared"],
    "spring": ["backend", "shared"],
    "nest": ["backend", "shared"],
    "electron": ["frontend", "backend", "shared"],
    "react-native": ["frontend", "shared"],
    "flutter": ["frontend", "shared"],
}


def detect_layers(project_config: Dict) -> List[str]:
    """根据 project-config.json 检测推荐的层结构。"""
    layers = set()

    # 从 frameworks 检测
    frameworks = project_config.get("frameworks", [])
    if isinstance(frameworks, list):
        for fw in frameworks:
            name = fw.lower() if isinstance(fw, str) else fw.get("name", "").lower()
            for key, layer_list in _STACK_LAYERS.items():
                if key in name:
                    layers.update(layer_list)

    # 从 languages 检测
    languages = project_config.get("languages", [])
    if isinstance(languages, list):
        for lang in languages:
            name = lang.lower() if isinstance(lang, str) else lang.get("name", "").lower()
            if name in ("python", "java", "go", "rust", "c#"):
                layers.add("backend")
            if name in ("typescript", "javascript"):
                # Could be either; add both if not yet determined
                if not layers:
                    layers.update(["frontend", "backend", "shared"])

    # Fallback
    if not layers:
        layers = {"backend", "shared"}

    return sorted(layers)


# =============================================================================
# Directory Creation
# =============================================================================


def init_spec_dirs(
    project_root: str,
    layers: Optional[List[str]] = None,
    force: bool = False,
) -> Dict:
    """初始化 .claude/specs/ 目录结构。

    Returns:
        {"created": [...], "skipped": [...], "layers": [...]}
    """
    specs_dir = Path(project_root) / ".claude" / "specs"
    result = {"created": [], "skipped": [], "layers": []}

    # 检测层
    if not layers:
        config_path = Path(project_root) / ".claude" / "config" / "project-config.json"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            layers = detect_layers(config)
        else:
            layers = ["backend", "shared"]

    result["layers"] = layers

    # 创建层级目录
    for layer in layers:
        layer_dir = specs_dir / layer
        index_file = layer_dir / "index.md"

        if index_file.exists() and not force:
            result["skipped"].append(str(index_file.relative_to(project_root)))
            continue

        layer_dir.mkdir(parents=True, exist_ok=True)
        with open(index_file, "w", encoding="utf-8") as f:
            f.write(INDEX_TEMPLATE.format(layer=layer))
        result["created"].append(str(index_file.relative_to(project_root)))

    # 创建根 index.md
    root_index = specs_dir / "index.md"
    if not root_index.exists() or force:
        layers_table = "| 层 | 路径 |\n|---|------|\n"
        for layer in layers:
            layers_table += f"| {layer} | [{layer}/index.md](./{layer}/index.md) |\n"

        specs_dir.mkdir(parents=True, exist_ok=True)
        with open(root_index, "w", encoding="utf-8") as f:
            f.write(
                ROOT_INDEX_TEMPLATE.format(
                    layers_table=layers_table,
                    guides_note=GUIDES_INDEX_NOTE,
                )
            )
        result["created"].append(str(root_index.relative_to(project_root)))

    return result


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(
        description="初始化项目 .claude/specs/ 目录结构"
    )
    parser.add_argument(
        "--project-root",
        required=True,
        help="项目根目录路径",
    )
    parser.add_argument(
        "--layers",
        help="指定层列表（逗号分隔），不指定则自动检测",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制覆盖已有文件",
    )

    args = parser.parse_args()

    layers = None
    if args.layers:
        layers = [l.strip() for l in args.layers.split(",") if l.strip()]

    result = init_spec_dirs(args.project_root, layers, args.force)
    print(json.dumps(result, indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
