# Platform Parity Contract

> `@justinfan/agent-workflow` 是 multi-tool 分发包，必须保证每个支持的 AI 编码工具都能 mount canonical `core/` 下的共享表面。
>
> 本契约定义"共享表面"清单，以及 `lib/agents.js` 和 `lib/installer.js` 之间必须保持的一致性规则。发布门 `scripts/validate.js` 会调用 `core/utils/platform_parity.js::validatePlatformParity()` 做差集检查；任何一条不满足直接 CI fail。

## 共享表面（Shared Surfaces）

每个 agent 都必须能承接以下三类挂载：

| 类别 | canonical 源 | 目标目录（per-agent） |
|------|--------------|---------------------|
| Skills | `core/skills/<skill>/` | `{agentBaseDir}/skills/<skill>/` |
| Commands | `core/commands/*.md` | `{agentBaseDir}/commands/<name>.md` |
| Managed resources | `core/{hooks,specs,utils}/` | `{agentBaseDir}/.agent-workflow/<subdir>/` |

Canonical 源的枚举规则：

- **Skills**：`core/skills/` 下每个直接子目录，且目录中包含 `SKILL.md`。
- **Commands**：`core/commands/` 下每个 `*.md` 文件。
- **Managed resources**：`core/hooks`、`core/specs`、`core/utils` 三个目录的根路径。

## Agents 配置契约

`lib/agents.js` 必须满足：

1. **必须存在的 agents**（至少包含）：
   `antigravity`、`claude-code`、`codex`、`cursor`、`droid`、`gemini-cli`、`github-copilot`、`opencode`、`qoder`
2. **每个 agent 的字段**必须非空：
   - `name`（字符串）
   - `displayName`（字符串）
   - `skillsDir`（相对路径字符串，用于项目级安装）
   - `globalSkillsDir`（绝对路径字符串，用于全局安装）
   - `detectInstalled`（可调用函数）
3. **skillsDir 约定**：必须是 `.<agent-home>/skills` 形式，目的地由 `getAgentBaseDir()` 反推得到。允许 `.agent/skills`、`.claude/skills` 等现有约定；禁止指向 `skills/` 根目录（否则会与 canonical 冲突）。

## Installer 契约

`lib/installer.js` 必须满足：

1. `TEMPLATE_DIRS` 包含 `core/` 下所有实际存在的一级目录（目前：`agents, commands, hooks, skills, specs, utils`）。若 `core/` 新增一级目录但未登记 `TEMPLATE_DIRS`，视为漏挂载。
2. `MANAGED_DIRS` 包含 `hooks, specs, utils`。skills 和 commands 走单独 mount 路径，不在 MANAGED_DIRS 里。
3. `COMMANDS_DIR === 'commands'`、`SKILLS_DIR === 'skills'`、`MANAGED_NAMESPACE_DIR === '.agent-workflow'`。

## CI 失败条件（由 validator 实施）

- `lib/agents.js` 少于 9 个 agent
- 任一 agent 缺少上述 5 个必填字段
- `core/skills/<x>/` 存在但没有 `SKILL.md`
- `core/commands/*.md` 里的命令文件命名与 `core/skills/` 提供的 skill 无法对应（仅警告，不阻塞；对应关系由 command doc 内容声明）
- `core/` 存在未在 `TEMPLATE_DIRS` 登记的一级目录
- `MANAGED_DIRS` / `COMMANDS_DIR` / `SKILLS_DIR` / `MANAGED_NAMESPACE_DIR` 的值与上述约定不符

## 维护注意

- 新增支持的 AI 工具：同时更新 `lib/agents.js` 的 agents map、本文件的"必须存在的 agents"清单、README 的工具列表。
- 新增 canonical 一级目录：同时更新 `TEMPLATE_DIRS`（以及 `MANAGED_DIRS` 如适用）。
- 新增 skill：确保 `core/skills/<skill>/SKILL.md` 存在；validator 会自动发现。
- 新增 command：确保是 `core/commands/<name>.md`，且 `<name>` 与目标 skill 名称匹配。
