---
description: 独立 team 命令入口，支持 `/team "需求"` 简写启动以及显式团队化规划、执行、状态查看、归档与清理
argument-hint: [start <requirement> | execute | status | archive | cleanup] | <natural-language requirement>
allowed-tools: Read(*), Grep(*), Glob(*)
examples:
  - /team start "实现用户认证功能"
    显式进入 team 模式，委派 team-workflow 生成 team spec/plan/runtime
  - /team execute
    推进 team-workflow 的 team-exec → team-verify / team-fix 循环
  - /team cleanup --team-id auth-rollout
    清理已归档的 team runtime 目录，保留 repo 内 spec/plan 工件
---

# team

稳定的 `/team <action> [args]` command 入口。

它只负责暴露 **显式 team mode** 的命令面，并把具体运行时语义委派给下层 team skills / runtime 文档。

`/team` 不会由自然语言关键词、Broad Request Detection、`/workflow execute`、`/quick-plan` 或 `dispatching-parallel-agents` 自动触发；只有用户明确输入 `/team ...` 时才启用。

---

## Usage

```bash
/team "需求描述"
/team start "需求描述"
/team start docs/prd.md

/team execute
/team status
/team archive
/team cleanup --team-id auth-rollout
```

---

## Action 路由

### `start`

进入显式 team bootstrap / planning 入口，生成 team 专用 planning/runtime 工件。

阅读：
- `../skills/team/SKILL.md`
- `../skills/team-workflow/SKILL.md`
- `../specs/team-runtime/overview.md`

### `execute`

进入 team runtime 执行循环，按团队边界推进执行、验证与修复。

阅读：
- `../skills/team-workflow/SKILL.md`
- `../specs/team-runtime/execute-entry.md`

### `status`

查看当前 team phase、边界任务状态与下一步建议。

阅读：
- `../skills/team-workflow/SKILL.md`
- `../specs/team-runtime/status.md`

### `archive`

归档当前 team runtime 与相关编排工件。

阅读：
- `../skills/team-workflow/SKILL.md`
- `../specs/team-runtime/archive.md`

### `cleanup`

清理已归档的 team runtime 目录，保留 repo 内 spec/plan 等规划工件。

阅读：
- `../skills/team-workflow/SKILL.md`
- `../specs/team-runtime/archive.md`

---

## Command Contract

- `/team` 是 **command 入口**，不是重型 runtime contract 本身
- `/team <自然语言需求>` 只在用户已经显式输入 `/team` 时，按 `/team start <需求>` 解释
- 只有显式 `/team` command surface 才允许解析、恢复或透传 team context；普通会话不得继承 `team_name` / `team_id`
- `team` skill 负责显式入口契约、适用边界与路由关系
- `team-workflow` 负责 `start|execute|status|archive|cleanup` 的 runtime 语义与 phase/state contract
- team runtime 继续使用 `core/utils/team/*.js` 与 `core/specs/team-runtime/*`
- `dispatching-parallel-agents` 只能作为 `team-exec` 内部的**规则来源**（独立性检查 / 边界分组 / 冲突降级），不能替代 team runtime
- `/workflow`、`/quick-plan`、Broad Request Detection 与自然语言请求都**不会**自动切换到 `/team`
- `/team` 默认按最小角色集运作：`orchestrator`、`implementer`、`reviewer`；`planner` 只在 `team-plan` 按需加入
- 只有在需要共享任务板、直接队友沟通、自主认领时才进入 `/team`；独立分析、单 reviewer、单边界修复继续走普通 Agent 或并行分派
