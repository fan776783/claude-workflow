---
name: team
description: "团队模式入口 - 仅在用户显式调用 /team start|execute|status|archive 时使用；复用 workflow planning/executing/reviewing/runtime helpers，不会被 /workflow、/quick-plan、dispatching-parallel-agents 或自然语言请求自动触发。"
---

# 团队模式 `/team`

## 用法

```bash
/team start "需求描述 | path/to/requirement.md"
/team execute
/team status
/team archive
```

## 模式契约

- `/team` 是**显式模式**，只有用户明确输入 `/team ...` 时才允许进入
- `/workflow` 保持现有语义，不自动升级为 team mode
- `/quick-plan` 只生成轻量 `plan.md`，不会切换到 team mode
- `dispatching-parallel-agents` 只是 `team-exec` 内部可复用的**并行规则来源**，不负责 team 生命周期，也不是 team runtime 的直接执行器
- team runtime 使用独立状态文件：`~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json`

---

## `start`

`/team start` 复用 workflow planning 的预检、代码分析、需求讨论、UX gate、`spec.md` 与 `plan.md` 生成流程，并额外产出团队编排工件。

必读：
- `../../specs/workflow-runtime/preflight.md`
- `../workflow-planning/references/start-overview.md`
- `../../specs/team-runtime/overview.md`
- `../../specs/team-runtime/state-machine.md`

额外产物：
- team-state
- 边界化 team task list
- worker ownership / dispatch metadata

## `execute`

`/team execute` 读取 team runtime，按 `team_phase` 推进：

```text
team-plan -> team-exec -> team-verify -> team-fix (loop) -> completed | failed | archived
```

执行要求：
- 优先复用 `workflow-executing` 的治理、验证与质量关卡
- team runtime 自己管理多实例与边界任务板；`dispatching-parallel-agents` 只作为可复用规则来源，不作为 team 编排器直接调用
- verify 失败时只回流失败边界到 `team-fix`
- 不得把 `parallel-boundaries` 解释成“自动进入 team mode”

必读：
- `../workflow-executing/SKILL.md`
- `../workflow-reviewing/SKILL.md`
- `../dispatching-parallel-agents/SKILL.md`（仅复用独立性检查 / 边界分组 / 冲突降级规则）
- `../../specs/team-runtime/execute-entry.md`
- `../../specs/team-runtime/status.md`

## `status` / `archive`

- `status`：查看团队阶段、边界任务进度、失败项与下一步建议
- `archive`：归档 team runtime，不改变普通 `/workflow archive` 的现有语义

## 共享运行时工具

- team CLI：`../../utils/team/team-cli.js`
- team lifecycle：`../../utils/team/lifecycle.js`
- team state：`../../utils/team/state-manager.js`
- team task board：`../../utils/team/task-board.js`
- team phase controller：`../../utils/team/phase-controller.js`
- team governance：`../../utils/team/governance.js`
- team status renderer：`../../utils/team/status-renderer.js`

阅读：
- `../../specs/team-runtime/status.md`
- `../../specs/team-runtime/archive.md`
