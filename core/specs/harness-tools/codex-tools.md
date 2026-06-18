# Codex Tool Mapping

> Codex 通过 installer-mount 分发。codex review 默认关闭（FR-6 降级），需显式开启。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | `spawn_agent` | 派发 subagent |
| 等待完成 | `wait` | 等待 subagent 返回 |
| 关闭 agent | `close_agent` | 清理 subagent |

## Subagent 支持

- ✅ implementer subagent
- ✅ reviewer subagent
- ✅ final reviewer subagent

## Codex 特殊路径

- **codex implementer 路径**：implementer 走 codex 时，execute 末跑 `triage --result <job-id>` 做文件级越界识别
- **codex oracle review**：implementer↔reviewer loop=2 stuck 时，controller 调 `--oracle-review` 拿只读第二意见回灌第 3 次重派
- **codex spec/plan review**：spec/plan 审批时默认不自动 spawn codex job；`project-config.json` 设 `workflow.review.codex = true` 开启

## Instructions File

- `AGENTS.md`

## Hook 机制

- Codex 有独立 SessionStart hook（`hooks/session-start-codex`）
- `hooks/hooks-codex.json`

## 环境变量

- `CODEX_HOME` — codex 配置目录（默认 `~/.codex`）
