# Workflow Hook Guardrails

## 背景

当前项目的 workflow 主流程由 `/workflow` command、专项 skills 和 `workflow-state.json` 驱动。

workflow hooks 的定位不是接管状态机，而是作为 **runtime guardrails**：

- 注入会话级 workflow 上下文
- 在执行型 Task 派发前补齐当前任务上下文
- 阻断非法继续，但不替代 `/workflow execute` 的 shared resolver

## 涉及的 Hook

| Hook | 脚本 | 作用 |
|------|------|------|
| `SessionStart` | `session-start.js` | 注入 active workflow、next action 和 guardrail 提示 |
| `PreToolUse` + `matcher: Task` | `pre-execute-inject.js` | 在 Task 派发前检查 workflow 状态并注入当前 task / verification / constraints |

脚本路径位于：

- `.agent-workflow/hooks/session-start.js`
- `.agent-workflow/hooks/pre-execute-inject.js`

## 职责边界

workflow hooks 只负责：

- 注入 workflow 状态、当前 task、验证命令、关键约束信息
- 在状态非法、上下文不完整时阻断继续
- 为执行器提供 runtime guardrails

workflow hooks **不负责**：

- 决定 planning / execute / delta / archive 的阶段流转
- 替代 `/workflow execute` 的 shared resolver
- 创建第二套状态机
- 直接把失败解释成 retry / skip / archive

## 启用方式

全局 `sync` 会自动注入 workflow hooks（`SessionStart` / `PreToolUse(Task)`）：

```bash
agent-workflow sync -y
```

本地开发 repo-link 模式：

```bash
agent-workflow link -a claude-code
```

### 手动注册

如需手动添加到 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"$HOME/.claude/.agent-workflow/hooks/session-start.js\""
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [{
          "type": "command",
          "command": "node \"$HOME/.claude/.agent-workflow/hooks/pre-execute-inject.js\""
        }]
      }
    ]
  }
}
```

> 路径必须使用 `$HOME` 或绝对路径，不要用 `~`。

## 运行时行为

### `SessionStart`

注入内容包括：

- 项目信息
- active workflow 状态
- next action
- workflow guardrail 提示
- 项目 spec index / thinking guides

### `PreToolUse(Task)`

在 Task 派发前检查：

- 是否存在活动 workflow
- `state.status` 是否为 `running / paused`
- 是否存在 active task
- `spec_file` / `plan_file` 是否齐全

通过后注入：

- 当前 task block
- verification commands
- critical constraints / must-preserve
- 当前 `quality_gates[taskId]` 摘要

## 相关文件

- `core/hooks/session-start.js`
- `core/hooks/pre-execute-inject.js`
- `core/specs/workflow-runtime/execute-entry.md`
- `core/specs/workflow-runtime/shared-utils.md`
- `core/specs/workflow/quality-gate.md`
- `core/specs/workflow/review-loop.md`
