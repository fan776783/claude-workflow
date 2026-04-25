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

## 协作路由

判断当前任务应该走哪条路径：

- **简单任务**（单行修复、拼写、明显 typo）→ 直接做，不调用 Codex。
- **后端 / 算法 / 安全 / 复杂调试** → 委托 Codex 分析，拿到结果后当前模型重构落盘。
- **前端 / UI** → 当前模型直接执行。
- **全栈** → Codex 分析后端，当前模型处理前端并收口。
- **交付前需要独立审查** → 用 `collaborating-with-codex` 的 review 模式，不自己审自己。

走 Codex 时，Phase 2 完成后做一次 **Hard Stop**：展示计划，调用 `AskUserQuestion` 收集决策，`question` 写"是否按此方案进入 Phase 4 编码？"，`options` 给两条：`proceed`（确认方案，当前模型开始重构落盘）、`abort`（拒绝方案，回到 Phase 2 重新分析或终止）。

## 并行与 Team

- 执行阶段遇到**同阶段 2+ 独立任务 / 独立问题域**，走 `/dispatching-parallel-agents` skill；单任务 subagent 或单 reviewer 不属于该 skill。
- `/team` 的准入条件、preflight、权限继承和 cleanup 协议由 `core/commands/team.md` 定义。不要因为检测到"多任务 / broad request / `/workflow-execute` / `/quick-plan`"就自动切 team——并行分派继续走 `dispatching-parallel-agents`，独立分析继续走 subagent。

## Code Specs 切换 package/layer

无活跃 workflow 时，SessionStart hook 只注入 code-specs overview。遇到需要落代码到具体 `{pkg}/{layer}` 的任务时按此规则处理：

- **触发**：无活跃 workflow，且即将用 Edit / Write 改动可以从文件路径反推到某个 `.claude/code-specs/{pkg}/{layer}/` 的场景。走 workflow 的任务由 PreToolUse(Task) hook 自动按 active task 注入 scoped context，**不重复处理**。
- **动作**：本会话尚未读过目标 `{pkg}/{layer}/index.md` 时，先用 Read 读该 index，再按其 `## Pre-Development Checklist` 点名的 code-spec 文件按需跟读；已读过则跳过。直接使用 Read 即可，不需要额外命令。
- **豁免**：单行修复 / typo / 纯研究 / 只做 code review / 目标文件路径无法落到具体 package/layer / `.claude/code-specs/` 不存在 → 跳过。

## 输出文风

不堆砌函数名/行号等底层细节；不用"值得注意的是""总而言之"等 AI 套话；完成任务后直接汇报结果，不加"如果你需要我可以继续……"这类收尾句；写文档前先参考同目录已有文档的语气风格。
