---
name: team
description: "团队模式入口 - 仅在用户显式调用 /team start|execute|status|archive 时使用；负责显式入口契约、适用边界与路由，不承接重型 team runtime contract。"
---

# team

> 本 skill 只负责 `/team` 的显式入口语义。team 的 phase/state contract、status/archive 语义与共享运行时资源统一下沉到 [`../team-workflow/SKILL.md`](../team-workflow/SKILL.md)。

## 用法

```bash
/team "需求描述 | path/to/requirement.md"
/team start "需求描述 | path/to/requirement.md"
/team execute
/team status
/team archive
```

## 入口契约

- `/team` 是**显式模式**，只有用户明确输入 `/team ...` 时才允许进入
- `/team <自然语言需求>` 视为 `/team start <需求>` 的简写，但只在 `/team` 命令内部生效，不构成自动触发
- `/workflow` 保持现有语义，不自动升级为 team mode
- `/quick-plan` 只生成轻量 `plan.md`，不会切换到 team mode
- `dispatching-parallel-agents` 只是 `team-exec` 内部可复用的并行规则来源，不负责 team 生命周期

## Action 路由

### `start`

显式进入 team bootstrap / planning 入口。

阅读：
- [`../team-workflow/SKILL.md`](../team-workflow/SKILL.md)
- [`../workflow-planning/SKILL.md`](../workflow-planning/SKILL.md)

### `execute`

进入 team runtime 执行循环。

阅读：
- [`../team-workflow/SKILL.md`](../team-workflow/SKILL.md)

### `status`

查看 team runtime 聚合状态。

阅读：
- [`../team-workflow/SKILL.md`](../team-workflow/SKILL.md)

### `archive`

归档当前 team runtime 与相关编排工件。

阅读：
- [`../team-workflow/SKILL.md`](../team-workflow/SKILL.md)

## 边界

- `team` skill 持有 `/team` 的显式入口与路由关系
- `team-workflow` 持有 `start|execute|status|archive` 的 runtime 语义与 phase/state contract
- team runtime 继续复用 `core/specs/team-runtime/*` 与 `core/utils/team/*.js`
- 不改动公开 `/team start|execute|status|archive` 命令面
