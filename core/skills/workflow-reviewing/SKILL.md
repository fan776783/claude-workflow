---
name: workflow-reviewing
description: "workflow 两阶段审查入口 - 被 workflow-executing 在质量关卡和审查触发点引用。承接 Spec 合规检查、代码质量检查与审查反馈协议。review 协议文档已迁移到本 skill，执行语义与共享状态机分别复用 workflow-executing 与 shared workflow runtime。"
---

# workflow-reviewing

> 本 skill 聚焦 workflow 的两阶段审查协议。review 协议文档已迁移到本 skill；它仍不新增单独的 `/workflow` action，而是在质量关卡任务或显式审查触发点被 `workflow-executing` 引用。

## 范围

- Stage 1：Spec 合规检查
- Stage 2：代码质量检查
- 审查反馈协议
- 审查触发条件与结果回写

## 先读

- 审查反馈协议：[`references/review-feedback-protocol.md`](references/review-feedback-protocol.md)
- 执行阶段概览：[`../workflow-executing/references/execute-overview.md`](../workflow-executing/references/execute-overview.md)
- 执行检查清单：[`../workflow-executing/references/execution-checklist.md`](../workflow-executing/references/execution-checklist.md)

## 审查阶段规格

- [`specs/execute/subagent-review.md`](specs/execute/subagent-review.md)
- [`specs/execute/actions/quality-review.md`](specs/execute/actions/quality-review.md)
- [`specs/execute/subagent-routing.md`](specs/execute/subagent-routing.md)

## 协同关系

- 执行引擎：[`../workflow-executing/SKILL.md`](../workflow-executing/SKILL.md)
- Command 入口：[`../../commands/workflow.md`](../../commands/workflow.md)
- 统一 CLI：`../../utils/workflow/workflow_cli.js`

## 约束

- 质量门槛的执行语义仍由 `workflow-executing` 持有。
- 本 skill 当前只承接审查协议与反馈面，不复制执行阶段治理规则。
