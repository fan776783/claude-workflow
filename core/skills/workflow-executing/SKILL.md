---
name: workflow-executing
description: "workflow 执行引擎入口 - 对应 /workflow execute。承接执行模式、ContextGovernor、Post-Execution Pipeline、TDD 纪律与和审查/并行分派的衔接。execute 概览、入口与执行 specs 已迁移到本 skill；共享状态机、脚本与运行时文档改为复用 shared workflow runtime。"
---

# workflow-executing

> 本 skill 是 `/workflow execute` 的专项入口。execute 概览、入口与执行 specs 已迁移到本 skill；状态机、共享工具、CLI 与运行时文档改为复用 shared workflow runtime。

## 范围

- 执行模式与恢复解析
- ContextGovernor 与 governance-first continuation governance（任务独立性 + 上下文污染风险优先，budget 兜底）
- Post-Execution Pipeline
- TDD enforcement
- 与两阶段审查、并行子 Agent 分派的衔接

## 先读

- 执行概览：[`references/execute-overview.md`](references/execute-overview.md)
- 执行入口：[`references/execute-entry.md`](references/execute-entry.md)
- 执行检查清单：[`references/execution-checklist.md`](references/execution-checklist.md)
- 状态机：[`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
- 共享工具：[`../../specs/workflow-runtime/shared-utils.md`](../../specs/workflow-runtime/shared-utils.md)

## 执行阶段规格

- [`specs/execute/execution-modes.md`](specs/execute/execution-modes.md)
- [`specs/execute/continuous-mode.md`](specs/execute/continuous-mode.md)
- [`specs/execute/phase-mode.md`](specs/execute/phase-mode.md)
- [`specs/execute/retry-debugging.md`](specs/execute/retry-debugging.md)
- [`specs/execute/skip-mode.md`](specs/execute/skip-mode.md)
- [`specs/execute/context-governor.md`](specs/execute/context-governor.md)
- [`specs/execute/post-execution-pipeline.md`](specs/execute/post-execution-pipeline.md)
- [`specs/execute/tdd-enforcement.md`](specs/execute/tdd-enforcement.md)
- [`specs/execute/helpers.md`](specs/execute/helpers.md)

## 协同入口

- 审查协议：[`../workflow-reviewing/SKILL.md`](../workflow-reviewing/SKILL.md)
- 并行分派：[`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md)
- 统一 CLI：`../../utils/workflow/workflow_cli.py`
- Command 入口：[`../../commands/workflow.md`](../../commands/workflow.md)
