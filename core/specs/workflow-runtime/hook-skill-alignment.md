# Hook / Skill Alignment

## 对齐原则

- `skills` 定义阶段语义、状态机与命令contract
- `core/utils/workflow/*` 是唯一 runtime / evidence 写入层
- `core/hooks/*` 只做上下文注入、前置阻断、质量quality-gate与并发安全
- hooks 不得改写 workflow 主状态，也不得形成第二套状态机

## 对照表

| Surface | 运行时角色 | 对应 hooks |
|---------|------------|-----------| 
| `workflow-plan` | 规划workflow与人工 gate | 无专属 hook；仅在执行前由 `PreToolUse(Task)` 间接保护 |
| `workflow-execute` | 恢复执行器、推进任务、触发验证与review | `SessionStart`、`PreToolUse(Task)` |
| `workflow-review` | 两阶段review与 `quality_gates.*` 写入 | 无专属 hook；质量关卡由 skill 指令驱动 |
| `workflow-delta` | delta 分析与 apply | 无专属 hook |
| `workflow-status` | `status` 运行时状态查看 | 无专属 hook |
| `workflow-archive` | `archive` workflow | 无专属 hook |
| `dispatching-parallel-agents` | 并行执行规则来源 | 无专属 hook |
| `/team` 命令 | Claude Code 原生 Agent Teams | `TeammateIdle` / `TaskCreated` / `TaskCompleted` 由 `team-idle.js` / `team-task-guard.js` 守门 |

## Hook 列表

- `SessionStart` → `session-start.js`
- `PreToolUse(Task)` → `pre-execute-inject.js`
- `TeammateIdle` → `team-idle.js`
- `TaskCreated` / `TaskCompleted` → `team-task-guard.js`

职责：
- workflow hooks：显示 workflow 状态、阻断非法 `Task`、注入当前 task / spec / quality gate 摘要
- team hooks：守门任务板粒度、守门完成证据、任务板清空时让队友通知 Lead 去执行 `clean up team`
