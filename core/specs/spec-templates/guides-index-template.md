# Guides

> 共享思考清单（thinking checklist），记录"写代码前想什么"。不承载"怎么写"——具体实现规则放在 `{package}/{layer}/` 下的 code-spec 文件里。

## Overview

`guides/` 下的内容跨 package / 跨 layer 共享，适合记录：

- 跨层协作时应该注意的事项
- 需要"先想清楚再动手"的场景
- 指向多个 code-spec 的汇总指针

## Thinking Triggers

什么情况下应该先读 guides：

- 本次改动跨多个 layer（前端 + 后端 + DB）
- 涉及跨 package 协作
- 改动触及公共约定（命名 / 目录 / 错误处理风格）
- 新增功能需要做跨领域的设计决策

非触发情形（不强制读）：

- 单文件局部修改
- 纯 bugfix 且不改接口
- 单 layer 内的常规实现

## Pre-Modification Rule

**修改 `guides/` 下任何文件前的强制前置检查**：

1. 确认要写的内容是**思考清单**性质，不是"怎么写"的具体规则
2. 如果本质是规则 → 应该放到 `{package}/{layer}/` 的 code-spec，而不是这里
3. 如果是跨多个 code-spec 的汇总指针 → 在本目录合适，新增前先检查是否已有类似 guide
4. 不要重复 code-spec 里的内容；guides 指向它即可

## Guides Catalog

| Guide | 触发场景 | 摘要 |
|-------|---------|------|
| (To be filled) | | |

## How to Use This Directory

- 不是每次开发都要读 guides；只在 Thinking Triggers 命中时查阅
- 读 guides 后通常会被指引到某个 code-spec，具体规则以 code-spec 为准
- guides 是"想什么"，code-spec 是"怎么写"——两者职责不混淆

## Contributing

什么内容进 `guides/`，什么进 `{package}/{layer}/`：

| 学到的内容 | 应该写到 |
|-----------|---------|
| "写 X 代码时应该想到 Y" | `guides/` |
| "X 的具体写法是 Y"（含代码签名 / 字段名 / 错误矩阵） | `{package}/{layer}/` 下的 code-spec |
| "X 必须匹配 Y 风格" | `{package}/{layer}/` 下的 code-spec |
| "多个 layer 一起想 X 时的思路" | `guides/` |

若不确定，优先放 code-spec；guides 应保持精简。
