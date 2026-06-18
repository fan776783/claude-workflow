# GitHub Copilot Tool Mapping

> GitHub Copilot 通过 installer-mount 分发。无 subagent 支持。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| 主会话直接执行 | — | 无 subagent dispatch 工具 |

## Subagent 支持

- ❌ implementer subagent（降级：主会话扮 implementer）
- ❌ reviewer subagent（降级：单段 self-review）
- ❌ final reviewer subagent（降级：主会话 self-review）

## 降级行为

controller 主会话直接执行 implementer 角色，完成后走单段 self-review。质量上限低于 subagent 平台。

## Instructions File

- `.github/copilot-instructions.md`
