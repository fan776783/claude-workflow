---
name: workflow-delta
description: "workflow 增量变更入口 - 对应 /workflow delta。承接 requirement / PRD / API 变更的影响分析与同步处理。delta 概览与 specs 已迁移到本 skill；共享状态机、外部依赖语义与 CLI 改为复用 shared workflow runtime。"
---

# workflow-delta

> 本 skill 是 `/workflow delta` 的专项入口。delta 概览与 specs 已迁移到本 skill；状态机、外部依赖语义、共享工具与 CLI 改为复用 shared workflow runtime。

## 范围

- requirement 变更
- PRD 文档更新
- API 变更与同步
- impact analysis 与变更应用

## 先读

- 概览：[`references/delta-overview.md`](references/delta-overview.md)
- 外部依赖语义：[`../../specs/workflow-runtime/external-deps.md`](../../specs/workflow-runtime/external-deps.md)
- 状态机：[`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
- 共享工具：[`../../specs/workflow-runtime/shared-utils.md`](../../specs/workflow-runtime/shared-utils.md)

## 增量变更规格

- [`specs/delta/impact-analysis.md`](specs/delta/impact-analysis.md)
- [`specs/delta/api-sync.md`](specs/delta/api-sync.md)

## 共享运行时资源

- CLI：`../../utils/workflow/workflow_cli.py`
- Command 入口：[`../../commands/workflow.md`](../../commands/workflow.md)
