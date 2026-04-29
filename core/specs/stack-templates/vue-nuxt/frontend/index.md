# {{layer_name}}

> Vue 3 + Nuxt 4 前端规范入口。

---

## Overview

本 layer 覆盖 Vue 组件、Nuxt 页面/布局/中间件、Pinia store、composable 等前端代码的convention。

- 目录范围：`apps/{{package_name}}/` 下的 `components/`、`pages/`、`layouts/`、`composables/`、`stores/`、`middleware/`
- 职责边界：不涉及纯工具函数（放 `@repo/utils`）、UI 组件库基础设施（放 `@repo/ui`）
- 与其它 layer 协作：通过 `@repo/httpx` 发请求；通过 `@repo/tracking` 埋点

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Component Guidelines](./component-guidelines.md) | Vue 组件结构、命名、props/emits convention | Draft |
| [Directory Structure](./directory-structure.md) | 前端目录组织、文件放置规则 | Draft |

---

## Pre-Development Checklist

开工前必读清单：

- 读组件convention → [component-guidelines.md](./component-guidelines.md)
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

完成后自检清单：

1. 运行 `git diff --name-only` 确认改动范围
2. 对照 Guidelines Index 中相关 guide 逐条核对
3. 运行 lint / type-check / test：
   ```bash
   pnpm lint && pnpm build
   ```
4. 补齐测试：
   - 新 pure function → unit test
   - bug fix → regression test

---

**Language**: 项目规范文档一律使用**简体中文**，代码示例注释也用中文。
