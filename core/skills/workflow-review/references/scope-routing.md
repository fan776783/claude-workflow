# Quality Review Scope 路由

> workflow-review SKILL.md 只处理 `scope: workflow`（全量完成 review）。运行时还有一种 scope 走不同入口，本文件记录差异以便排障 / 架构追溯，不影响本 skill 的执行 workflow。

## 两种 scope 对照

| 维度 | scope: workflow（workflow-review skill） | scope: task |
|------|------|------|
| 触发 | 用户手动 `/workflow-review` | 命中 quality gate 的任务完成后（`nextTask.quality_gate` 为真 或 `actions` 含 `quality_review`） |
| 前置状态 | `review_pending` | `running` + 被 gate 任务刚完成 |
| Stage 1 | 全量逐 spec 对照 | 被 gate 单任务逐 spec |
| Stage 2 | 跨所有 task diff | 被 gate 单任务 diff |
| rejected 处理 | 回退 `running` + 重跑 | 被 gate 任务回 pending |
| 覆盖范围 | 整个 workflow 所有 task | 仅显式命中 gate 的 task |
| CLI 底层 | `quality_review.js pass/fail` | 共享 |

## 入口

- **scope: task** — workflow-execute Step 5 由 `nextTask.quality_gate` 或 `actions` 含 `quality_review` 触发

未命中 gate 的普通任务完成后不走 scope: task review；workflow 全部完成时由 scope: workflow 统一覆盖。
