# CodeBuddy Tool Mapping

> CodeBuddy（腾讯云，Claude Code 同源克隆，CLI binary `codebuddy` / `cbc`）通过 installer-mount 分发。subagent mount 到 `~/.codebuddy/agents`，slash command + 子代理调用均支持。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | subagent（`~/.codebuddy/agents`） | custom sub-agent 独立 context/权限/system prompt；`/agent-name` 或自动调用（CLI 文档 `/cli/sub-agents`） |

## Subagent 支持

- ✅ implementer subagent（fresh per task，custom agent 独立 context）
- ✅ reviewer subagent（单 subagent、AC+质量两 phase）
- ✅ final reviewer subagent（inline 整 branch 终审）

## 分发路径

- skills → `~/.codebuddy/skills`
- commands → `~/.codebuddy/commands`（顶层 `.md`）
- subagents → `~/.codebuddy/agents`
- hooks → `~/.codebuddy/settings.json`（Claude 同 schema，merge-safe 注入）
- memory → `~/.codebuddy/CODEBUDDY.md`（CodeBuddy 原生 user memory；源用 canonical `core/AGENTS.md`）

## 备注

- CodeBuddy 有 Claude-Code 同源的插件机制（`.codebuddy-plugin/plugin.json`、应用内 `/plugin install`、dev `codebuddy --plugin-dir`），但**无确认的非交互 CLI 安装命令**，故 skills/commands/hooks 走 installer-mount 而非 Plugin 分发（与 qoder 同样的判断）。
- memory 写 `CODEBUDDY.md`（CLI 文档明确 user memory = `~/.codebuddy/CODEBUDDY.md`）；AGENTS.md 仅是 **project 级** fallback，user 级不保证加载，故不写 `~/.codebuddy/AGENTS.md`。
- `detectInstalled` 探测 `~/.codebuddy/`（CLI 与 IDE 同品牌，若共用该 config home 则一并覆盖；CodeBuddy IDE 的独立配置目录文档未给出，待验证）。

## Instructions File

- `~/.codebuddy/CODEBUDDY.md`（user 级）/ `.codebuddy/CODEBUDDY.md` 或 `./CODEBUDDY.md`（project 级）
