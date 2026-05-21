# {{layer_name}}

> 后端代码规范入口（通用栈，请按项目实际栈补充）。

---

## Overview

本 layer 覆盖后端代码（路由 / service / 数据访问 / 中间件）的convention。未绑定具体框架。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | 后端目录组织 | Draft |

---

## Pre-Development Checklist

- 决定新文件放哪里 → [directory-structure.md](./directory-structure.md)
- 跨层思考 → `../../guides/index.md`（bootstrap 后生成）

---

## Task Profiles

可选段：按任务类型收窄预读范围。项目真实落栈后可按该栈特性细化；默认只给最小集。

### Profile: 新增接口

- slug: add-api
- aliases: new-api, 新增接口, 新增功能, add-feature, feature
- 必读: directory-structure
- 可选: -

### Profile: Bug 修复

- slug: bug-fix
- aliases: bugfix, fix, hotfix, Bug 修复
- 必读: directory-structure
- 可选: -

---

## Quality Check

完成后自检清单见根 [`index.md` 的 Quality Check 段](../../index.md#quality-check)（全项目单一来源）。本层若有特有检查项，在此追加，不复制通用清单。

---

**Language**: 项目规范文档一律使用**简体中文**。
