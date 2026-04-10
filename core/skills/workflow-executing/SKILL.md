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

## 执行入口铁律（state-first）

- 先读取 `../../specs/workflow-runtime/state-machine.md`，以运行时状态机作为当前 phase / status / current task / progress / quality gate 的唯一真相
- 判断“现在执行到哪里”“是否可以继续”“当前 task 是谁”“哪些 task 已完成/失败/跳过”时，优先读取 `workflow-state.json` 或调用 `../../utils/workflow/workflow_cli.js status|context|next`
- 在完成 Step 1 之前，不得通过读取仓库代码、plan 文字状态、验证输出或文件改动来猜测 workflow 运行时状态
- 只有在状态已确定、当前 task 已锁定后，才按需读取 `plan.md`、Patterns to Mirror、Mandatory Reading 与源码实现细节

## 先读

- 状态机：[`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
- 运行时状态：[`../../specs/workflow-runtime/status.md`](../../specs/workflow-runtime/status.md)
- 共享工具：[`../../specs/workflow-runtime/shared-utils.md`](../../specs/workflow-runtime/shared-utils.md)
- 执行入口：[`references/execute-entry.md`](references/execute-entry.md)
- 执行概览：[`references/execute-overview.md`](references/execute-overview.md)
- 执行检查清单：[`references/execution-checklist.md`](references/execution-checklist.md)

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
- 统一 CLI：`../../utils/workflow/workflow_cli.js`
- Command 入口：[`../../commands/workflow.md`](../../commands/workflow.md)
