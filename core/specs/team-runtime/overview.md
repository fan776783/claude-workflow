# Team Runtime 概览

`/team` 为本仓库提供**独立且显式**的团队编排模式。

它不是对 `/workflow-execute` 的自动升级，也不是 `dispatching-parallel-agents` 的别名；而是在现有 workflow planning / executing / reviewing / runtime helpers 之上，增加一层 team orchestration。

## 显式入口约束

- 只有用户明确输入 `/team ...` 时，才允许进入 team runtime
- active team runtime 不是 session-global context；普通 session、workflow hooks 与 ordinary agent launch 都不会自动继承 `team_id` / `team_name`
- `/workflow`、`/quick-plan`、Broad Request Detection、自然语言模糊请求都不会自动切换到 `/team`
- 普通 workflow / session hook 只读取 `workflow-state.json` 与 workflow 规划工件，不得读取、继承或注入 `team-state.json`、`team_id`、`team_name`、`worker_roster`、`dispatch_batches`、`team_review` 等 team context
- `dispatching-parallel-agents` 只用于 team 内部复用其独立性检查 / 边界分组 / 冲突降级规则，不直接作为 team 编排器

## Runtime 路径

```text
~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json
```

相关的团队任务板会与 state 一起保存在同一 runtime 目录下：

```text
~/.claude/workflows/{projectId}/teams/{teamId}/team-task-board.json
```

## 设计原则

- **文件独立**：team runtime 不污染普通 `workflow-state.json`
- **Node.js runtime**：team 脚本独立收敛在 `core/utils/team/*.js`，便于单独演进
- **schema 继承**：尽量复用 workflow 现有字段与 deterministic helpers 的思想，而不是脚本级强依赖
- **phase 明确**：支持 `team-plan`、`team-exec`、`team-verify`、`team-fix`
- **双阶段收尾**：先 `archive` 退出 active runtime，再按需 `cleanup` 物理删除 runtime 目录
- **修复回流**：verify 失败时只重投失败边界，不重跑整个团队
- **最小默认角色**：默认只围绕 `orchestrator`、`implementer`、`reviewer` 运作；`planner` 只在 team-plan 使用
- **profile 复用**：安全、架构等 specialist 继续复用 workflow role-profiles，不单独复制 team prompt
- **谨慎使用 team**：只有需要共享任务板、直接队友沟通、自主认领时才进入 `/team`；独立分析或单次并行继续走普通 Agent / 并行分派
- **默认规模克制**：team 默认从 3–5 个 worker 规划，不鼓励固定铺满角色

## 关联文档

- `./state-machine.md`
- `./execute-entry.md`
- `./status.md`
- `./archive.md`
