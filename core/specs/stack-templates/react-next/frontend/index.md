# {{layer_name}}

> React + Next.js 前端规范入口。

---

## Overview

本 layer 覆盖 React 组件、Next.js 页面/布局/中间件、hooks、数据获取等前端代码的约定。

- 目录范围：`app/` (App Router) / `pages/` (Pages Router) + `components/` + `hooks/` + `lib/`
- 职责边界：pure 工具函数放 `lib/`，业务逻辑放领域模块
- 与其它 layer 协作：RSC / Route Handler 边界清晰

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Component Guidelines](./component-guidelines.md) | React 组件结构、命名、props 约定 | Draft |
| [Directory Structure](./directory-structure.md) | 前端目录组织、文件放置规则 | Draft |

---

## Pre-Development Checklist

- 新增/修改组件前 → [component-guidelines.md](./component-guidelines.md)
- 决定新文件放哪里 → [directory-structure.md](./directory-structure.md)
- 跨层思考 → `../../guides/index.md`（bootstrap 后生成）

---

## Task Profiles

按任务类型收窄预读范围。当前任务若能识别对应 slug / alias，只展开命中 Profile 的"必读 + 可选"主题；否则全读。

### Profile: 新增功能

- slug: add-feature
- aliases: feature, new-feature, 新功能
- 必读: component-guidelines, directory-structure
- 可选: -

### Profile: Bug 修复

- slug: bug-fix
- aliases: bugfix, fix, hotfix, Bug 修复
- 必读: component-guidelines
- 可选: -

### Profile: 重构

- slug: refactor
- aliases: cleanup, 重构
- 必读: directory-structure, component-guidelines
- 可选: -

---

## Quality Check

1. `git diff --name-only` 确认改动范围
2. 对照 Guidelines Index 逐条核对
3. 运行 lint / type-check / test：
   ```bash
   pnpm lint && pnpm tsc --noEmit
   ```

---

**Language**: 项目规范文档一律使用**简体中文**。
