# {{layer_name}}

> Node.js + Express 后端规范入口。

---

## Overview

本 layer 覆盖 Express 路由、中间件、错误处理、DB 访问等后端代码的约定。

- 目录范围：`src/modules/**` + `src/middleware/**` + `src/server.ts`
- 职责边界：controller / service / repository 三层清晰
- 与其它 layer 协作：统一错误响应；统一日志入口

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | 后端目录组织、module/route 层次 | Draft |
| [Error Handling](./error-handling.md) | 错误类型、异常路径、响应格式 | Draft |

---

## Pre-Development Checklist

- 写路由或中间件前 → [error-handling.md](./error-handling.md)
- 决定新文件放哪里 → [directory-structure.md](./directory-structure.md)
- 跨层思考 → `../../guides/index.md`（bootstrap 后生成）

---

## Task Profiles

按任务类型收窄预读范围。`/spec-before-dev --change-type <slug-or-alias>` 命中后只展开"必读 + 可选"主题。

### Profile: 新增接口

- slug: add-api
- aliases: new-api, add-route, 新增接口, 新增功能, add-feature
- 必读: directory-structure, error-handling
- 可选: -

### Profile: Bug 修复

- slug: bug-fix
- aliases: bugfix, fix, hotfix, Bug 修复
- 必读: error-handling
- 可选: directory-structure

### Profile: 重构

- slug: refactor
- aliases: cleanup, 重构
- 必读: directory-structure
- 可选: error-handling

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
