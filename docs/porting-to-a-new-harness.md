# Porting to a New Harness

> 本指南阐述如何将 `@justinfan/agent-workflow` 适配到一个新的 AI 编码工具（harness）。
> 参照 superpowers 6.0 porting guide 思路，适配本项目的 canonical + managed-links 架构。

## 集成形态

本项目支持两种分发方式：

### Shape A — 原生 Plugin（Plugin-managed）

适用：harness 有原生 plugin 安装机制（如 Claude Code `/plugin install`、Antigravity `agy plugin install`）。

- 实现位置：`lib/<agent>-plugin.js`
- 安装时：`<agent>-plugin.js` 把 `core/` 打包为 plugin 并安装到 harness 的 plugin 目录
- 特点：harness 原生加载 plugin，skills/commands/hooks 全部由 plugin 机制注入
- 字段豁免：`managedViaPlugin: true`，不需要声明 `skillsDir` / `globalSkillsDir`

### Shape B — Installer Mount（逐 skill mount）

适用：harness 无原生 plugin 机制，但有 skills/commands 目录约定（如 Cursor、Codex、Qoder 等）。

- 实现位置：`lib/agents.js` 的 agent 配置
- 安装时：`lib/installer.js` 把 canonical `core/skills/<skill>/` 逐个 mount 到 `{agentBaseDir}/skills/<skill>/`
- 特点：managed links 指向 canonical 源，升级时自动反映
- 字段要求：必须声明 `skillsDir`（相对路径）、`globalSkillsDir`（绝对路径）、`detectInstalled`

## 三件套（每个 harness 必须实现）

1. **Agent 配置**（`lib/agents.js`）：`name` / `displayName` / `detectInstalled` / `skillsDir` / `globalSkillsDir`（Shape B）或 `managedViaPlugin: true`（Shape A）
2. **Plugin 实现**（Shape A）或 **installer 路径**（Shape B）：分发逻辑
3. **工具映射文件**（`core/specs/harness-tools/<agent>-tools.md`）：dispatch tool、subagent 支持、hook 机制、instructions file

## 成败规则

**在 session start 加载 bootstrap**——harness 必须在会话启动时注入 workflow 上下文（通过 hook 或 instructions file）。否则 controller 无从得知当前 workflow 状态，state-first 铁律无法执行。

## Onboarding 清单

新增 harness 时，同步更新以下位置：

| # | 文件 | 更新内容 |
|---|------|----------|
| 1 | `lib/agents.js` | 新增 agent 配置（Shape A 或 B） |
| 2 | `core/specs/platform-parity.md` | "必须存在的 agents"清单新增 |
| 3 | `core/specs/harness-tools/<agent>-tools.md` | 新建工具映射文件 |
| 4 | `core/specs/harness-tools/README.md` | 索引新增条目 |
| 5 | `README.md` §7 | 工具列表新增 |
| 6 | `CLAUDE.md` | Supported Agents 段新增 |
| 7 | `scripts/validate.js` | `requiredWorkflowScripts` 如需调整 |
| 8 | `lib/installer.js` | Shape B：确保 `TEMPLATE_DIRS` 覆盖新 agent 的挂载需求 |

## 验收测试

### 最小验收（所有 harness）

1. `agent-workflow sync` 后，harness 的 skills 目录有全部 managed skills（`ls {agentBaseDir}/skills/` 对账 `core/skills/`）
2. harness 会话启动时注入 workflow 上下文（SessionStart hook 或 instructions file）
3. `/workflow-spec` → `/workflow-plan` → `/workflow-execute` 基本流程可跑通

### Subagent 平台附加验收

4. `Task` / `spawn_agent` dispatch 可派发 fresh implementer subagent
5. `PreToolUse(Task)` hook 注入 `<current-task>` 正常（或 controller 兜底粘贴）
6. per-task reviewer subagent 可返回 strict JSON

### Degraded 平台附加验收

4. 主会话扮 implementer 可完成实现
5. 单段 self-review 按 reviewer.md 两 phase 顺序自检
6. `/clear` 后 resume 三元组 + progress ledger 可恢复

## 端到端验收测试流程

```bash
# 1. 安装
agent-workflow sync -y

# 2. 创建测试项目
mkdir /tmp/harness-test && cd /tmp/harness-test
agent-workflow init

# 3. 跑通基本流程
# 在目标 harness 中执行：
/scan
/workflow-spec "实现一个 todo list 的增删改查"
/workflow-spec spec-review --choice "Spec 正确，生成 Plan"
/workflow-plan
/workflow-execute

# 4. 验证产物
ls ~/.claude/workflows/*/tasks/    # task-dir 存在
cat ~/.claude/workflows/*/progress.md  # progress ledger 有记录
```

## 常见陷阱

- **不要走 `qodercli plugins install`**：该命令不存在（v6 早期误用）。Qoder 走 installer-mount。
- **Gemini CLI 已停服**：不要新增 gemini-cli agent，合并进 Antigravity。
- **`skillsDir` 不得指向 `skills/` 根目录**：会与 canonical 冲突。必须是 `.<agent-home>/skills` 形式。
- **Plugin agent 不声明 skillsDir**：`managedViaPlugin: true` 豁免。
