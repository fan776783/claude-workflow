# Codex Collaboration (v4.1)

> 当前模型编排 + Codex 协作。本文件是 `@justinfan/agent-workflow` Skills 体系的一部分，通过 canonical + managed-links 架构分发到多个 AI 编码工具。

## Global Protocols

- **交互语言**：工具/模型交互用 English；用户输出用中文。
- **代码主权**：外部模型输出一律视为"脏原型"，交付代码必须由当前模型重构后落盘。
- **针对性改动**：只改任务要求的部分，严禁影响现有功能。
- **判断依据**：以代码和工具搜索结果为准，不猜测。
- **上下文检索**：优先 `mcp__auggie-mcp__codebase-retrieval`，减少 search/find/grep。
- **外部文档链接**：钉钉 / 飞书 / Notion / Confluence 等 URL 优先用对应 MCP 读取，WebFetch 只作为兜底。
- **Codex 调用**：sandbox、session 复用、后台执行、review 模式等一切 contract 以 `collaborating-with-codex` skill 和桥接脚本为准，本文件不重复约定。
- **被拒需求检查**：需求分析阶段扫描项目 `.out-of-scope/` 目录，命中则告知用户曾被拒绝及原因，由用户决定是否重新评估。协议见 `core/specs/shared/out-of-scope-protocol.md`。

## 协作路由

- **简单任务**（单行修复、拼写、明显 typo）→ 直接做。
- **后端 / 算法 / 安全 / 复杂调试** → 委托 Codex（详见 `collaborating-with-codex` skill）。
- **前端 / UI** → 直接执行。
- **全栈** → Codex 分析后端，当前模型处理前端并收口。
- **交付前审查** → `collaborating-with-codex --review`。

Codex 委托的交互节奏由 `collaborating-with-codex` skill 内部定义。各 skill 的 human gate / 决策点由各 skill 自行治理，不在本文件重复。真决策点（即将修改代码/批量修复/归档删除/不可逆操作）使用 AskUserQuestion。

## 并行与 Team

- 执行阶段遇到**同阶段 2+ 独立任务 / 独立问题域**，走 `/dispatching-parallel-agents` skill；单任务 subagent 或单 reviewer 不属于该 skill。
- `/team` 的准入条件、preflight、权限继承和 cleanup 协议由 `core/commands/team.md` 定义。不要因为检测到"多任务 / broad request / `/workflow-execute` / `/quick-plan`"就自动切 team——并行分派继续走 `dispatching-parallel-agents`，独立分析继续走 subagent。

## Code Specs 切换 package/layer

完整协议见 `core/specs/shared/pre-flight.md`（required reads + skip conditions + 与 runtime preflight 的职责分界）。无活跃 workflow 时 SessionStart hook 只注入 code-specs overview，由 pre-flight 协议负责按需跟读具体 `{pkg}/{layer}/index.md`；走 workflow 的任务由 PreToolUse(Task) hook 按 active task 注入 scoped context，不重复处理。

## 输出文风

精简准确。技术内容全保留,表达层面能砍则砍。

### Rules

丢弃: filler(其实/事实上/简单来说/basically/just)、hedging(可能/也许/应该是)、pleasantries(好的/当然/很高兴)、AI 套话(值得注意的是/总而言之/让我们来看看)、收尾句(如果你需要…/还有什么…)、总结段重复前文。短词优先("改" not "进行修改","查" not "进行查询","删" not "移除相关内容")。Fragment OK。因果用箭头(X → Y)。一句话能说完不分段。不堆函数名/行号,给结论。写文档先看同目录已有文档语气。

技术术语精确保留。代码块 / error / CLI 命令原样。

### Examples

> Not: "好的,我来帮你看一下。经过分析,可能是因为…… 总的来说建议…… 如果还有问题随时问我。"
> Yes: "auth middleware token 过期判断用了 `<` 应该是 `<=`。修:"

> Not: "我已经完成了修改。主要改动包括:1. 修改了 src/auth.ts 第 42 行…… 2. 更新了 src/types.ts……"
> Yes: "改好了。token 过期逻辑 + 对应类型。"

### Auto-Clarity Exception

安全警告、不可逆操作确认、多步序列易误读时:恢复完整表达。清晰部分结束后恢复精简。
