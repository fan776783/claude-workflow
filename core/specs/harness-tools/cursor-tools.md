# Cursor Tool Mapping

> Cursor 通过 installer-mount 分发。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | `Task` | 派发 fresh subagent（同 Claude Code） |
| Subagent 输出 | `TaskOutput` | subagent 返回结果（自动） |

## Subagent 支持

- ✅ implementer subagent
- ✅ reviewer subagent
- ✅ final reviewer subagent

## Hook 机制

- 与 Claude Code 同 schema（`hooks.json`）
- `PreToolUse(Task)` 支持 `pre-execute-inject`

## Instructions File

- `.cursorrules` 或项目级配置

## 备注

- Cursor manifest 已移除 `agents` 和 `commands` 条目（这些目录已不存在）
- 行为与 Claude Code 基本一致（同属 `Task` dispatch 工具族）
