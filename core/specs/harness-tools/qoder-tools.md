# Qoder Tool Mapping

> Qoder（VS Code 内核）通过 installer-mount 分发。custom agent 独立 context window / tool 权限 / system prompt，subagents mount 到 `~/.qoder/agents`，Chat panel + Quest 均可调用。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | subagent（`~/.qoder/agents`） | custom agent 独立 context/权限/system prompt；`/agent-name` 或自动调用，Chat panel + Quest 均可（精确 tool 名见 docs.qoder.com `/cli/using-cli#subagent`） |

## Subagent 支持

- ✅ implementer subagent（fresh per task，custom agent 独立 context）
- ✅ reviewer subagent（单 subagent、AC+质量两 phase）
- ✅ final reviewer subagent（inline 整 branch 终审）

## 分发路径

- skills → `~/.qoder/skills`
- commands → `~/.qoder/commands`（顶层 `.md`）
- subagents → `~/.qoder/agents`
- hooks → `~/.qoder/settings.json`（Claude 同 schema，merge-safe 注入）

## 备注

- `.qoder-plugin`/`installed_plugins` **插件分发**机制仅 Quest agents-window 生效，故 skills/commands 走 installer-mount 而非 Plugin 分发；但 **custom agent/subagent 调用**在 Chat panel + Quest 均可用（与分发机制无关）
- 不走 `qodercli plugins install`（v6 早期曾误用，该命令不存在）

## Instructions File

- `.qoder/config` 或项目级配置
