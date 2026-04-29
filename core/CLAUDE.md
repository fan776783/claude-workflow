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

走 Codex 时，Phase 2 完成后展示计划（不调用 AskUserQuestion），以一句自然语言收尾："方案可行请回复继续，不行告诉我哪里要改。" 用户回"继续" / "ok" / "go" 进入 Phase 4 编码；反对 / 要修改则回到 Phase 2 重新分析。真决策点的 Hard Stop 模板见 `core/specs/shared/hard-stop-templates.md`，Codex 委托本身不属于真决策点（代码尚未落盘，随时可回头）。

## 并行与 Team

- 执行阶段遇到**同阶段 2+ 独立任务 / 独立问题域**，走 `/dispatching-parallel-agents` skill；单任务 subagent 或单 reviewer 不属于该 skill。
- `/team` 的准入条件、preflight、权限继承和 cleanup 协议由 `core/commands/team.md` 定义。不要因为检测到"多任务 / broad request / `/workflow-execute` / `/quick-plan`"就自动切 team——并行分派继续走 `dispatching-parallel-agents`，独立分析继续走 subagent。

## Code Specs 切换 package/layer

完整协议见 `core/specs/shared/pre-flight.md`（required reads + skip conditions + 与 runtime preflight 的职责分界）。无活跃 workflow 时 SessionStart hook 只注入 code-specs overview，由 pre-flight 协议负责按需跟读具体 `{pkg}/{layer}/index.md`；走 workflow 的任务由 PreToolUse(Task) hook 按 active task 注入 scoped context，不重复处理。

## 输出文风

不堆砌函数名/行号等底层细节；不用"值得注意的是""总而言之"等 AI 套话；完成任务后直接汇报结果，不加"如果你需要我可以继续……"这类收尾句；写文档前先参考同目录已有文档的语气风格。
