# Claude Code Tool Mapping

> Claude Code（`claude` CLI）通过原生 Plugin 机制分发（`lib/claude-code-plugin.js`）。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | `Task` | 派发 fresh subagent，隔离 context window |
| Subagent 输出 | `TaskOutput` | subagent 返回结果（自动） |
| 用户交互 | `AskUserQuestion` | HITL task 收集人工答复 |

## Subagent 支持

- ✅ implementer subagent（fresh per task）
- ✅ reviewer subagent（单 subagent、AC+质量两 phase）
- ✅ final reviewer subagent（inline 整 branch 终审）

## Hook 机制

| 事件 | 用途 |
|------|------|
| `SessionStart` | 注入 workflow 上下文 + guardrail |
| `PreToolUse(Task)` | `pre-execute-inject.js` 注入 `<current-task>` + `<project-code-specs>` |
| `UserPromptSubmit` | skill 路由 hint |
| `TeammateIdle` | Agent Teams 任务板守门 |
| `TaskCreated/TaskCompleted` | 任务粒度守门 |

## Instructions File

- 项目级：`CLAUDE.md`
- 全局：`~/.claude/CLAUDE.md`

## 开发调试

```bash
claude --plugin-dir <repo>/core    # 链接调试模式
```

## 环境变量

- `WORKFLOW_HOOKS=0` — 跳过 context 注入
- `CLAUDE_NON_INTERACTIVE=1` — 跳过 context 注入
