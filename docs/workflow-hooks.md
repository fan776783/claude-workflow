# Workflow Hook Guardrails

## 背景

当前项目的 workflow 主流程由 `/workflow` command、专项 skills 和 `workflow-state.json` 驱动。

workflow hooks 的定位不是接管状态机，而是作为 **runtime guardrails**：

- 注入会话级 workflow 上下文
- 在执行型 Task 派发前补齐当前任务上下文
- 在执行后检查验证命令与质量关卡结果
- 阻断非法继续，但不替代 `/workflow execute` 的 shared resolver

## 涉及的 Hook

| Hook | 脚本 | 作用 |
|------|------|------|
| `SessionStart` | `session-start.js` | 注入 active workflow、next action 和 guardrail 提示 |
| `PreToolUse` + `matcher: Task` | `pre-execute-inject.js` | 在 Task 派发前检查 workflow 状态并注入当前 task / verification / constraints |
| `PostToolUse` | `quality-gate-loop.js` | 在执行后读取验证命令和 `quality_gates[taskId]`，未通过则阻断继续 |

脚本路径位于：

- `.agent-workflow/hooks/session-start.js`
- `.agent-workflow/hooks/pre-execute-inject.js`
- `.agent-workflow/hooks/quality-gate-loop.js`

## 职责边界

workflow hooks 只负责：

- 注入 workflow 状态、当前 task、验证命令、关键约束、质量关卡信息
- 在状态非法、上下文不完整、质量关卡未通过时阻断继续
- 为执行器提供 runtime guardrails

workflow hooks **不负责**：

- 决定 planning / execute / delta / archive 的阶段流转
- 替代 `/workflow execute` 的 shared resolver
- 创建第二套状态机
- 直接把失败解释成 retry / skip / archive

## 启用方式

### 默认注册 + 显式 strict 注册

默认全局 `sync` 会自动注入：

- worktree hooks
- workflow base hooks（`SessionStart` / `PreToolUse(Task)`）

如需额外启用 strict workflow hook（`PostToolUse` 质量关卡）：

```bash
agent-workflow sync --workflow-hooks -y
```

本地开发 repo-link 模式：

```bash
agent-workflow link --workflow-hooks -a claude-code
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
    ],
    "PostToolUse": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"$HOME/.claude/.agent-workflow/hooks/quality-gate-loop.js\""
        }]
      }
    }
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

### `PostToolUse`

在执行后检查：

- task 中的验证命令是否全部通过
- 若当前 task 包含 `quality_review`，则 `state.quality_gates[taskId].overall_passed` 是否为 `true`

> `PostToolUse` 属于 strict hook；验证 evidence 仍由 CLI/runtime 写入，hook 只负责读取并阻断未通过的继续。

若未通过：

- 返回 `continue: false`
- 阻断继续执行
- 输出统一失败原因

## 与 Worktree Hooks 的区别

- `worktree hooks`：处理 `WorktreeCreate` / `WorktreeRemove` 的串行化与清理
- `workflow hooks`：处理 Session / Task / Quality Gate 级别的运行时守门

两者都属于 Claude Code hooks，但目标不同：

- worktree hooks 保护工作区与 Git 运行时安全
- workflow hooks 保护 workflow 执行边界和质量卡点

## 相关文件

- `core/hooks/session-start.js`
- `core/hooks/pre-execute-inject.js`
- `core/hooks/quality-gate-loop.js`
- `core/specs/workflow-runtime/execute-entry.md`
- `core/specs/workflow-runtime/shared-utils.md`
- `core/specs/workflow/quality-gate.md`
- `core/specs/workflow/review-loop.md`
