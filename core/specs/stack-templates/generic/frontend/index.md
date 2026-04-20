# {{layer_name}}

> 前端代码规范入口（通用栈，请按项目实际栈补充）。

---

## Overview

本 layer 覆盖前端代码（组件 / 页面 / 状态 / 工具）的约定。未绑定具体框架。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | 前端目录组织 | Draft |

---

## Pre-Development Checklist

- 决定新文件放哪里 → [directory-structure.md](./directory-structure.md)
- 跨层思考 → `../../guides/index.md`（bootstrap 后生成）

---

## Task Profiles

可选段：按任务类型收窄预读范围。项目真实落栈后可按该栈特性细化；默认只给最小集。

### Profile: 新增功能

- slug: add-feature
- aliases: feature, new-feature, 新功能
- 必读: directory-structure
- 可选: -

### Profile: Bug 修复

- slug: bug-fix
- aliases: bugfix, fix, hotfix, Bug 修复
- 必读: directory-structure
- 可选: -

---

## Quality Check

1. `git diff --name-only` 确认改动范围
2. 对照 Guidelines Index 逐条核对
3. 运行 lint / type-check / test

---

**Language**: 项目规范文档一律使用**简体中文**。
