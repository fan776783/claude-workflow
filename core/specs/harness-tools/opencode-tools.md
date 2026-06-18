# OpenCode Tool Mapping

> OpenCode 通过 installer-mount 分发。主 agent 经 `Task` tool 派发 subagent（独立 context window + 独立 system prompt，可不同 LLM）。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | `Task` | 主 agent 经 task tool 派发 subagent，独立 context window，可不同 LLM（与 claude-code 同族） |
| 调用方式 | `@mention` / 自动 | hidden agents 仅经 Task tool 程序化调用 |

## Subagent 支持

- ✅ implementer subagent（fresh per task，经 Task tool 派发）
- ✅ reviewer subagent（单 subagent、AC+质量两 phase）
- ✅ final reviewer subagent（inline 整 branch 终审）

## Fallback

若运行环境无 Task tool（旧版本 / 受限配置），自动降级：controller 主会话扮 implementer + 单段 self-review。

## Hook 机制

- 基于 action 的工具映射，跨 plugin、install doc 和 README 一致
- 有 bootstrap-caching 测试

## Instructions File

- 项目级配置文件
