---
name: workflow-planning
description: "workflow 规划阶段入口 - 对应 /workflow start。承接代码分析、需求讨论、UX 设计审批、Spec 生成、用户审查与 Plan 生成。planning 相关概览与 start specs 已迁移到本 skill；共享状态机、脚本与模板改为复用 shared workflow runtime。"
---

# workflow-planning

> 本 skill 是 `/workflow start` 的专项入口。planning 相关概览与 start specs 已迁移到本 skill；状态机、共享工具、CLI、模板等运行时资源改为复用 shared workflow runtime。

## 范围

- Phase 0：代码分析
- Phase 0.2：需求讨论（条件执行）
- Phase 0.3：UX 设计审批（条件 HARD-GATE）
- Phase 1：Spec 生成
- Phase 1.1：User Spec Review
- Phase 2：Plan 生成

## 先读

- 概览：[`references/start-overview.md`](references/start-overview.md)
- 状态机：[`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
- 共享工具：[`../../specs/workflow-runtime/shared-utils.md`](../../specs/workflow-runtime/shared-utils.md)
- 需求追溯：[`../../specs/workflow-runtime/traceability.md`](../../specs/workflow-runtime/traceability.md)

## 规划阶段规格

- [`specs/start/phase-0-code-analysis.md`](specs/start/phase-0-code-analysis.md)
- [`specs/start/phase-0.2-requirement-discussion.md`](specs/start/phase-0.2-requirement-discussion.md)
- [`specs/start/phase-0.3-ux-design-gate.md`](specs/start/phase-0.3-ux-design-gate.md)
- [`specs/start/phase-1-spec-generation.md`](specs/start/phase-1-spec-generation.md)
- [`specs/start/phase-1.1-spec-user-review.md`](specs/start/phase-1.1-spec-user-review.md)
- [`specs/start/phase-2-plan-generation.md`](specs/start/phase-2-plan-generation.md)

## 共享运行时资源

- 模板：`../../specs/workflow-templates/spec-template.md`、`../../specs/workflow-templates/plan-template.md`
- CLI：`../../utils/workflow/workflow_cli.py`
- Command 入口：[`../../commands/workflow.md`](../../commands/workflow.md)
