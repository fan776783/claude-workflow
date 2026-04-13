# Hook / Skill Alignment

## 对齐原则

- `skills` 定义阶段语义、状态机与命令契约
- `core/utils/workflow/*` 是唯一 runtime / evidence 写入层
- `core/hooks/*` 只做上下文注入、前置阻断、质量门禁与并发安全
- hooks 不得改写 workflow 主状态，也不得形成第二套状态机

## 对照表

| Surface | 运行时角色 | 对应 hooks |
|---------|------------|-----------| 
| `workflow-plan` | 规划流程与人工 gate | 无专属 hook；仅在执行前由 `PreToolUse(Task)` 间接保护 |
| `workflow-execute` | 恢复执行器、推进任务、触发验证与审查 | `SessionStart`、`PreToolUse(Task)` |
| `workflow-review` | 两阶段审查与 `quality_gates.*` 写入 | 无专属 hook；质量关卡由 skill 指令驱动 |
| `workflow-delta` | 增量变更分析与 apply | 无专属 hook |
| `workflow-status` | `status` 运行时状态查看 | 无专属 hook |
| `workflow-archive` | `archive` 工作流归档 | 无专属 hook |
| `dispatching-parallel-agents` | 并行执行规则来源 | 间接依赖 `WorktreeCreate` / `WorktreeRemove` |
| `team-workflow` | team runtime | 普通 workflow hooks 必须忽略 team runtime |

## Hook 列表

- `SessionStart` → `session-start.js`
- `PreToolUse(Task)` → `pre-execute-inject.js`

职责：
- 显示 workflow 状态、下一步建议与 guardrail
- 在普通 workflow 会话里阻断非法 `Task`
- 注入当前 task / spec / quality gate 摘要

## Team 隔离

- 普通 workflow hooks 只允许读取 workflow runtime
- 非显式 `/team` 路径必须忽略 `team_id`、`team_name`、`worker_roster`、`dispatch_batches`、`team_review`
- 只有显式 `/team` / `team-workflow` 才允许消费 `team-state.json`
