---
name: team-workflow
description: "team 重型运行时入口 - 承接 /team start|execute|status|archive 的 phase/state contract，统一复用 core/specs/team-runtime/* 与 core/utils/team/*.js。"
---

# team-workflow

> 本 skill 是 `/team` 的重型 runtime 入口。`team` skill 只保留显式入口契约与路由关系；team 的 phase/state contract、门禁规则、status/archive 语义与共享运行时资源统一由本 skill 承接。

## 范围

- `/team start` 的 team bootstrap / planning contract
- `/team execute` 的 phase 推进、verify / fix loop 与 worker gate
- `/team status` / `/team archive` 的共享运行时语义
- team runtime 文档、状态机与 Node.js helpers 的统一引用

## 先读

- Command 入口：[`../../commands/team.md`](../../commands/team.md)
- 显式入口说明：[`../team/SKILL.md`](../team/SKILL.md)
- runtime 概览：[`../../specs/team-runtime/overview.md`](../../specs/team-runtime/overview.md)
- 状态机：[`../../specs/team-runtime/state-machine.md`](../../specs/team-runtime/state-machine.md)

## Start Contract

`/team start` 当前执行的是 **team-specific bootstrap / planning**：

- 解析 requirement 与 team 标识
- 生成 team 专用 `spec.md` / `plan.md` / team task markdown
- 初始化 `team-state.json` 与 `team-task-board.json`
- 写入 worker ownership / dispatch metadata

它当前**不会自动等价于**完整 `workflow-planning` 生命周期；`workflow-planning` 仍是 `/workflow start` 的权威规划入口。

阅读：
- [`../workflow-planning/SKILL.md`](../workflow-planning/SKILL.md)
- [`../../specs/team-runtime/overview.md`](../../specs/team-runtime/overview.md)
- [`../../specs/team-runtime/state-machine.md`](../../specs/team-runtime/state-machine.md)

强制要求：
- team 专用 `spec.md` 已生成并落盘
- team 专用 `plan.md` 已生成并落盘
- `team-state.json` 已生成且可解析
- `team-task-board.json` 已生成且可解析
- worker ownership / dispatch metadata 已写入 runtime

若任一条件缺失：
- 不得宣告 `/team start` 完成
- 不得建议继续 `/team execute`
- 必须明确报告缺失工件或缺失字段

## Execute Contract

`/team execute` 读取 team runtime，按 `team_phase` 推进：

```text
team-plan -> team-exec -> team-verify -> team-fix (loop) -> completed | failed | archived
```

阅读：
- [`../workflow-executing/SKILL.md`](../workflow-executing/SKILL.md)
- [`../workflow-reviewing/SKILL.md`](../workflow-reviewing/SKILL.md)
- [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md)
- [`../../specs/team-runtime/execute-entry.md`](../../specs/team-runtime/execute-entry.md)
- [`../../specs/team-runtime/status.md`](../../specs/team-runtime/status.md)

执行约束：
- execute 前必须完成 team runtime 工件、关键字段与 board 合法性校验
- planning 阶段允许只读 worker；进入 `team-exec` 时必须至少存在一个可写执行型 worker
- `dispatching-parallel-agents` 只作为独立性检查 / 边界分组 / 冲突降级的规则来源，不替代 team runtime
- verify 失败时只允许回流失败边界到 `team-fix`
- 不得把普通 workflow 的 `parallel-boundaries` 信号解释为 team mode 或 team runtime 合法推进依据

## Status / Archive Contract

- `/team status`：读取 team runtime，展示当前阶段、边界进度、失败项与下一步建议
- `/team archive`：归档当前 team runtime 与相关编排工件，不改变普通 `/workflow archive` 语义

阅读：
- [`../../specs/team-runtime/status.md`](../../specs/team-runtime/status.md)
- [`../../specs/team-runtime/archive.md`](../../specs/team-runtime/archive.md)

## 共享运行时资源

### Runtime 文档

- [`../../specs/team-runtime/overview.md`](../../specs/team-runtime/overview.md)
- [`../../specs/team-runtime/state-machine.md`](../../specs/team-runtime/state-machine.md)
- [`../../specs/team-runtime/execute-entry.md`](../../specs/team-runtime/execute-entry.md)
- [`../../specs/team-runtime/status.md`](../../specs/team-runtime/status.md)
- [`../../specs/team-runtime/archive.md`](../../specs/team-runtime/archive.md)

### Node.js helpers

- `../../utils/team/team-cli.js`
- `../../utils/team/lifecycle.js`
- `../../utils/team/state-manager.js`
- `../../utils/team/task-board.js`
- `../../utils/team/task-board-helpers.js`
- `../../utils/team/phase-controller.js`
- `../../utils/team/governance.js`
- `../../utils/team/planning-support.js`
- `../../utils/team/planning-artifacts.js`
- `../../utils/team/status-renderer.js`
- `../../utils/team/templates.js`
- `../../utils/team/doc-contracts.js`

## 约束

- `/team` 仍是显式入口，不因 `/workflow`、`/quick-plan`、Broad Request Detection、自然语言宽泛请求或 `dispatching-parallel-agents` 自动触发
- 本 skill 持有 team 的重型 runtime contract，但不改动公开 `/team start|execute|status|archive` 命令面
- team runtime 路径继续保持在 `~/.claude/workflows/{projectId}/teams/{teamId}/`
- 运行时实现继续收敛在 `core/specs/team-runtime/*` 与 `core/utils/team/*.js`
