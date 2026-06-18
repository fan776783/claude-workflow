# Droid Tool Mapping

> Droid（Factory CLI）通过 installer-mount 分发。custom droids（`.factory/droids/` 或 `~/.factory/droids/`）作为 `Task` tool 的 `subagent_type` 目标，主 assistant 可 mid-session spawn。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | `Task` | custom droids 作为 `subagent_type` 目标派发，独立 context（与 claude-code 同族） |
| 多 agent 模式 | Mission Mode（`--mission` / `/missions`） | worker + validator 拆分执行（可选，非 workflow 主路径） |

## Subagent 支持

- ✅ implementer subagent（fresh per task，经 Task tool 派发）
- ✅ reviewer subagent（单 subagent、AC+质量两 phase）
- ✅ final reviewer subagent（inline 整 branch 终审）

## Fallback

若运行环境无 Task tool（旧版本 / 受限配置），自动降级：controller 主会话扮 implementer + 单段 self-review。

## Instructions File

- 项目级配置文件
