# AIPE vs. 主流 AI Coding Harness 框架对比审查

> 审查日期：2026-05-09
> 对比对象：AIPE 1.0.0.73、Claude Code（含 Agent SDK）、Codex CLI、agent-workflow v6.0.9
> 数据来源：DMG 静态解包与 Mach-O 字符串/符号分析（未运行应用），辅以用户手册、Claude Code 源码抽样比对和 Codex 公开文档
> 分析框架：从 **Agent 能力**和**工作流能力**两个维度剖析 AIPE 的定位、差距与演进路径

---

## 1. 背景：AIPE 是什么

AIPE 不是 LangChain / LangGraph / AutoGen 等开源框架的封装，而是一个 **C++/Qt 自研桌面 Agent Harness**：

```text
Qt/QML GUI
  -> AIServer（中央编排）
    -> Model Adapters（受管模型 / 账号型模型 / embedding / local proxy）
    -> Agent Runtime（AgentManager / AgentScheduler / AgentSession）
       -> DeveloperAgent / CodeAgent / RequirementAgent / SolutionAgent / TestAgent / FigmaAgent / SkillAgent
    -> Tool Runtime（AIToolHandler / BuiltinToolExecutor / ToolRouter）
       -> read_file / write_file / bash_exec / GitLab / MCP / RAG / Build / LSP
    -> State（SQLite: 代码索引 / 会话 / skills / MCP / RAG chunks）
```

其产品范式最接近 Claude Code——很可能参考了其 coding harness 设计思想（agent loop、tool permission、subagent、context compaction），但未见源码级仿制证据。更合理的判断是：**基于 Claude Code 类产品经验做了 C++/Qt 内部平台化重实现**。

---

## 2. Agent 能力对比：AIPE vs Claude Code vs Codex

### 2.1 Claude Code 的可扩展性：AIPE 哪些能力可通过 skill/hook/MCP 自行实现

Claude Code 的核心设计哲学是**提供可组合的扩展原语**，而非内置所有功能。其扩展机制包括：

| 扩展机制 | 能力 | 举例 |
|----------|------|------|
| **Skills**（SKILL.md） | 定义完整的多步骤工作流，agent 按需触发 | `collaborating-with-codex`：实现跨模型协作——Claude 执行 + Codex 独立审查 |
| **Hooks**（settings.json） | 在 agent 生命周期注入自定义脚本 | PostToolUse hook 自动跑 typecheck/lint/prettier |
| **MCP Servers** | 接入任意外部系统的标准协议 | 钉钉 MCP、GitLab MCP、Figma MCP |
| **Agent 定义**（.claude/agents/） | 创建专用子代理（独立 prompt/tool/权限） | architecture-reviewer、security-reviewer |
| **Agent Teams** | 多 Claude Code 实例并行协作 | 前端+后端+测试同时工作 |
| **CLAUDE.md / Rules** | 项目级行为约束和上下文注入 | code-specs 体系、铁律、路由规则 |

以 `collaborating-with-codex` 为例：这个 skill 通过一个 bridge 脚本将任务委托给 Codex（不同模型）做独立分析或审查，再由主模型收口重构。它不需要 Claude Code 内置"多模型支持"——**用户通过一个 skill 文件就扩展出了跨模型协作能力**。

基于这个思路，逐项分析 AIPE 的能力哪些可通过上述机制自行实现：

| AIPE 能力 | AIPE 实现方式 | Claude Code 如何通过扩展实现 | 可实现程度 |
|-----------|-------------|------------------------------|-----------|
| **多模型协作** | 协议层归一化，单一 runtime 适配多模型 | **Skill 扩展**：`collaborating-with-codex` 已证明可行——通过 bridge 脚本将任务路由给不同模型（Codex/其他），各模型用各自原生协议，skill 负责任务分发和结果收口。无需协议层适配 | ✅ 已实现 |
| **自动依赖推断 + 并行调度** | `inferImplicitDependencies` + `setMaxConcurrency` | **Skill 扩展**：`dispatching-parallel-agents` 实现文件隔离检测 → 依赖图分析 → 独立域并行分派（worktree 隔离）→ 冲突降级。`workflow-plan` 在规划阶段显式声明依赖图 | ✅ 已实现且更透明（逻辑在文本文件中可审计） |
| **build → LSP → review → auto-fix 闭环** | 调度器内置 4 步自动链路 | **Hook + Skill 组合**：PostToolUse hook 做 build/lint/typecheck 反馈；`workflow-execute` 验证铁律强制 task 完成前跑验证；`tdd` skill 实现 red-green-refactor（失败 3 次 hard stop）；`fix-bug` 4 阶段修复闭环（定位→影响分析→修复→Codex review） | ⚠️ 验证闭环已实现；"自动修复无需人工确认"是 AIPE 独有选择（更激进但有风险） |
| **需求分析 Agent** | RequirementAgent + SolutionAgent 固定角色 | **Skill 扩展**：`workflow-spec` 实现完整需求分析流程——Phase 0 强制代码分析（检索相关文件/组件/模式/约束）→ Phase 0.2 需求澄清（P0/P1/P2 分级）→ Phase 1 规格扩写 + 自审（PRD 覆盖扫描）→ Phase 2 人工审批 | ✅ 已实现且流程可定制 |
| **设计稿到代码** | FigmaAgent 固定角色 | **Skill + MCP 组合**：`figma-ui` skill 通过 Figma MCP 读取设计稿 → 解析组件结构 → 生成代码 | ✅ 已实现 |
| **测试用例生成** | TestAgent 固定角色 | **Skill 扩展**：`tdd` skill 实现垂直切片的 red-green-refactor；`vitest-tester` agent 专注测试编写/调试/覆盖率 | ✅ 已实现 |
| **本地 RAG + 代码索引** | embedding 向量化 + SQLite 函数调用图 | **MCP 扩展**：`codebase-retrieval` MCP 提供智能代码检索；`workflow-spec` Phase 0 做强制代码分析；code-specs 体系提供声明式架构知识。大 monorepo 场景可接入专用 RAG MCP server | ⚠️ 功能等价但实现路线不同：MCP 按需检索 vs AIPE 本地向量索引（后者在超大仓库有延迟优势） |
| **内部系统集成** | GitLab/蓝鲸/钉钉/Figma 直接内嵌 | **MCP 扩展**：每个系统一个 MCP server——`dingtalk-mcp`（钉钉文档/表格）、`bk`（蓝鲸项目管理）、`figma-ui`（Figma）、GitLab MCP。配置一次后等价使用，且可独立升级 | ✅ 已实现（需初始配置，但可跨工具复用） |
| **任务并发 + 单步调试** | `setMaxConcurrency` + `stepNext` | **Agent Teams + Skill**：Agent Teams 并行 + worktree 隔离（比共享目录更安全）；`dispatching-parallel-agents` 做并发控制。**单步调试无等价机制**——Claude Code 用 checkpoint rewind 替代（回溯而非单步前进） | ⚠️ 并发已实现；单步调试是 AIPE 独有 |
| **Skill 自动提取与审计** | SkillExtractorAgent + SkillAuditorAgent 从对话自动生成/更新 skill | **Skill + Memory 组合**：`write-a-skill` skill 辅助创建/优化；memory 系统自动提取 feedback/project 记忆跨会话生效。但无"对话→自动生成 SKILL.md"的完全自动化闭环 | ⚠️ 部分实现：经验沉淀有 memory 覆盖；skill 生成仍需人工触发 |

**核心结论**：AIPE 8 项"独有"能力中，**5 项已通过 Claude Code 扩展机制完整实现**（多模型协作、依赖推断/并行、需求分析、设计稿到代码、内部系统集成），**2 项功能等价但实现路线不同**（验证闭环——是否允许自动修复是哲学选择；RAG——MCP 按需检索 vs 本地向量索引），**1 项真正独有**（单步调试 `stepNext`）。

这说明 Claude Code 的扩展性架构使得大部分"平台内置"能力可以由用户/团队通过 skill + hook + MCP 自行构建，且这些构建产物是可版本化、可审计、可跨团队共享的文本文件——而非锁定在某个平台的二进制中。

### 2.2 Claude Code / Codex 具备、AIPE 不具备的能力

| 能力 | Claude Code / Codex 实现 | AIPE 缺失影响 |
|------|-------------------------|---------------|
| **声明式权限 DSL** | Claude Code: `allow/ask/deny` + `Tool(specifier)` 规则 + 组织策略下发；Codex: sandbox 全隔离 | AIPE 权限是运行时逻辑，无法组织级配置和审计；团队无法声明"这个项目禁止 bash_exec" |
| **OS 级 Sandbox** | Claude Code: macOS Seatbelt / Linux bubblewrap 文件系统+网络隔离；Codex: 云端沙箱容器 | AIPE 仅靠命令字符串匹配拦截危险命令，无法防御 obfuscation 或未知危险命令 |
| **Checkpoint / Rewind** | Claude Code: 每个用户提示点自动创建 checkpoint，可恢复代码+对话+摘要状态 | AIPE 有 `undo` 信号但不是完整快照；用户无法回退到任意历史点 |
| **OpenTelemetry 标准 Trace** | Claude Code: OTel metrics/logs/traces + 外部 exporter；Codex: 任务级审计日志 | AIPE 有事件信号但无标准导出，生产审计和 SLA 追踪困难 |
| **用户可配置 Hook 生命周期** | Claude Code: SessionStart / PreToolUse / PostToolUse / PreCompact / Stop 等 7+ 生命周期 hook | AIPE 仅见 `sessionWebhook`，用户/组织无法注入自定义检查逻辑 |
| **Agent Teams（多实例协作）** | Claude Code: TeamCreate / SendMessage / 任务认领 / 多会话并行 + worktree 隔离 | AIPE 有 `AgentMessageBus` 但不是完整 team 语义；无 worktree 隔离 |
| **Worktree / Fork Session** | Claude Code: `EnterWorktree` 在独立 git worktree 执行，完成后合并或丢弃 | AIPE 未见 worktree 机制；并行任务可能互相污染工作目录 |
| **跨界面连续性** | Claude Code: Terminal / IDE / Desktop / Web / Slack 共享底层引擎和会话 | AIPE 绑定单一 macOS 桌面 App；无 CLI/SDK/Web 入口 |
| **SDK / CLI / CI 集成** | Claude Code: Agent SDK (TS/Python) + CLI pipeline + GitHub Actions；Codex: CLI + `--json` 结构化输出 | AIPE 无公开 SDK/CLI；无法嵌入 CI/CD pipeline |
| **CLAUDE.md / Rules 层级体系** | Claude Code: 项目/用户/组织三级指令 + `.claude/rules/` + 自动记忆 | AIPE 有 `MemoryManager` 但无等价的层级指令体系 |
| **WebSearch / WebFetch / Computer Use** | Claude Code: 网络搜索、网页抓取、浏览器控制工具 | AIPE 有 Qt WebView 但未见通用 web tool |
| **Tool Schema 元数据** | Claude Code: `isReadOnly` / `isDestructive` / `isConcurrencySafe` / `needsPermission` 显式标注 | AIPE 工具 schema 内嵌二进制，外部不可见/不可审计 |

### 2.3 Agent 迭代与评测

| 维度 | AIPE | Claude Code | Codex |
|------|------|-------------|-------|
| **迭代速度** | C++ 编译 → 签名 → DMG 分发；每次更新是完整应用发版 | prompt/skill/hook 变更即生效，无需重新编译；SDK 版本通过 npm 分发 | 云端 sandbox 迭代，用户侧零感知更新 |
| **迭代粒度** | 模型适配、工具、agent 行为、UI 全部耦合在一个二进制 | 分层解耦：模型(API) / 工具(内置+MCP) / 行为(SKILL.md+rules) / UI(CLI/Desktop) | 模型(API) / 执行环境(sandbox) / 工具(内置) 分离 |
| **Prompt 版本管理** | prompt 和 tool schema 内嵌 Mach-O 字符串段；版本升级后 diff 不可见 | SKILL.md / CLAUDE.md / rules 是 git 管理的文本文件；变更有 PR review | 系统 prompt 由 OpenAI 内部管理；用户侧通过 instructions 注入 |
| **评测能力** | 无公开 benchmark 或 eval 框架；内部回归测试不明 | SWE-bench / 内部 eval suite + Agent SDK 支持 programmatic 评测 | SWE-bench 公开成绩；sandbox 天然可复现 |
| **用户侧调优** | 通过 Skills 系统和 MCP 配置间接调优；无法直接修改 agent 行为 | Skills + Rules + Hooks + CLAUDE.md = 完整用户侧调优栈 | instructions + 自定义 sandbox 环境（安装包/配置） |
| **A/B 测试** | 需整包替换，无灰度机制 | 可通过模型选择（Opus/Sonnet/Haiku）+ skill 开关做 A/B | 模型选择 + temperature 调节 |
| **回归测试** | 依赖内部团队提供评测集和失败案例库 | 开源社区 + SWE-bench + 用户反馈 + Agent SDK eval | SWE-bench + OpenAI 内部 eval |
| **能力边界透明度** | 用户不知道 agent 能做什么、不能做什么——能力清单内嵌二进制 | `list-tools` / tool schema / 文档明确暴露能力边界 | 文档 + sandbox 环境限制明确 |

### 2.4 案例：无评测体系下的质量退化风险

2025 年 3-4 月，Anthropic 的 Claude Code 连续遭遇三次质量退化事件：

1. **推理强度降级**（3月4日）：默认推理强度从 high 降为 medium，导致代码生成质量下降。4月7日恢复。
2. **缓存 Bug**（3月26日）：缓存优化引入缺陷，导致旧的推理记录被误删，模型表现出"健忘和重复"。4月10日修复。
3. **系统提示词修改**（4月16日）：新增的"减少冗余"指令意外降低了代码生成质量。4月20日回滚。

Anthropic 能在数天到两周内发现并修复这些问题，依赖的是：**完善的评测基础设施**（SWE-bench + 内部 eval suite）、**分层解耦的架构**（推理参数/缓存/prompt 各自独立，可单独回滚）、以及**社区反馈闭环**（用户报告 → 定位 → 修复 → 补偿）。

**对 AIPE 的风险映射**：

| 退化类型 | Claude Code 如何发现/修复 | AIPE 能否应对 |
|----------|--------------------------|---------------|
| 推理参数变更导致降级 | eval suite 检测到质量下降；参数独立可回滚 | ❌ 模型参数/prompt/工具耦合在同一二进制；无独立 eval 检测质量变化 |
| 缓存/上下文 Bug | 标准 trace + 用户报告 + 精确定位到缓存模块 | ❌ 无标准 trace 导出；上下文管理逻辑内嵌 C++ 无法外部审计 |
| Prompt 修改意外降质 | prompt 是文本文件可 git diff；eval 跑回归即可发现 | ❌ prompt 内嵌 Mach-O 字符串段，版本间不可 diff；无回归评测拦截 |
| 用户侧规避 | 用户可锁定 SDK 版本 / 切换模型 / 调整 skill | ❌ 用户只能等整包更新；无版本锁定/模型切换/行为回退能力 |

**核心问题**：AIPE 在缺乏评测体系的情况下，**无法在发版前发现质量退化，也无法在发现后精确定位和快速回滚**。所有变更（模型参数、prompt、工具行为、上下文策略）耦合在同一个二进制中，"修一个 bug 可能引入另一个退化"的风险无法通过分层测试排除。对于依赖 AIPE 做生产代码交付的团队，这意味着每次平台升级都是一次不可预测的质量赌博。

---

## 3. 工作流能力对比

### 3.1 工作流生命周期模型

| 维度 | AIPE | Claude Code | Codex | agent-workflow |
|------|------|-------------|-------|----------------|
| **生命周期表示** | C++ AgentScheduler 内部对象 + SQLite | 无显式状态机（agent loop 驱动） | 单任务执行（submit → running → completed/failed） | 7 态显式状态机（JSON 持久化） |
| **状态转换规则** | 隐式（二进制实现） | Hook 生命周期驱动（SessionStart→Stop） | 线性（提交 → 执行 → 结束） | 显式前置条件 + Hard Stop 审批门 |
| **跨会话恢复** | pause/resume 信号存在，完整语义不明 | Stop hook 保存 → SessionStart 恢复 | 任务天然持久化（云端） | CLI resume 精确到中断的 task |
| **失败处理** | `cascadeFail` + `resetFailedDependencies` + `rerunTask` | 无内置（靠 human-in-loop） | 失败任务可重提交 | `paused` 态 + 失败原因 + 人工确认恢复 |
| **并发** | `setMaxConcurrency` + 隐式依赖推断 | Agent Teams + worktree 隔离 | 多任务并行（独立 sandbox） | `dispatching-parallel-agents`（worktree 隔离） |

### 3.2 规划与审批

| 维度 | AIPE | Claude Code | Codex | agent-workflow |
|------|------|-------------|-------|----------------|
| **规划机制** | `/plan` + `startPlanning` + `WaitingPlanConfirm` | Plan Mode（先读后规划，审批后执行） | 无（直接执行指令） | 双层：`/workflow-spec`（需求规格）→ `/workflow-plan`（实施计划） |
| **审批门禁** | `WaitingPlanConfirm`（信号存在，强制性不明） | Plan Mode 需用户 approve | 无 | **Hard Stop**：spec 和 plan 各一道人工确认门 |
| **需求分析** | RequirementAgent → SolutionAgent → 任务拆分 | 无内置需求分析（通过 skill 可扩展） | 无 | `/workflow-spec` 自动需求分析 + 影响分析 |
| **变更管理** | 未见增量变更机制 | 无（重新对话） | 无（重新提交） | `/workflow-delta` 增量影响分析并入 |

### 3.3 执行与验证

| 维度 | AIPE | Claude Code | Codex | agent-workflow |
|------|------|-------------|-------|----------------|
| **执行单元** | AgentScheduler task（绑定场景 agent） | agent loop turn / Agent tool spawn | 单个 task（sandbox 内执行） | workflow task（可分派到 subagent） |
| **验证闭环** | build → LSP → AI review → auto-fix（自动） | PostToolUse hook（typecheck/lint/test） | sandbox 内跑测试 | 验证铁律 + TDD + diff-review |
| **自动修复** | `startAutoFix`（内置） | 无（需人工或再次对话） | 无 | 无（修复需经确认） |
| **回滚** | `undoFileChange` / `undoDocEdit` | Checkpoint rewind | 不适用（sandbox 隔离） | `/git-rollback`（reset/revert） |

### 3.4 可定制性对比

| 维度 | AIPE | Claude Code | Codex | agent-workflow |
|------|------|-------------|-------|----------------|
| **工作流定义权** | 平台内置，用户不可修改流程 | 用户通过 SKILL.md + Hook + CLAUDE.md 完全自定义 | 用户通过 instructions + sandbox 环境定制 | 用户通过 skill 文件 + 状态机配置定制 |
| **新增流程步骤** | 需等 AIPE 团队发版 | 写一个 Hook 脚本或 SKILL.md 即可 | 不适用（无流程概念） | 写新 skill + 注册到状态转换表 |
| **质量门禁定制** | 不可配（build/LSP/review 行为固定） | Hook exit code 完全自定义（可接任何 linter/checker） | sandbox 环境预装任意工具 | 铁律可扩展 + 验证命令可配置 |
| **模型路由定制** | 有多模型适配但路由策略内嵌 | 用户可选模型（Opus/Sonnet/Haiku）+ 子代理可指定不同模型 | 用户选 model（o3/o4-mini 等） | 配置文件指定主模型 + 审查模型 |
| **工具集定制** | MCP 可扩展；内置工具不可增删 | MCP + 内置工具均可管理；权限 DSL 控制可用范围 | sandbox 环境安装决定可用工具 | MCP + 内置 + skill 均可扩展 |
| **协作流程定制** | 固定的 agent 角色分工 | Agent Teams + markdown agent 定义 = 任意角色组合 | 不适用（单 agent） | `/team` 命令 + 并行分派 skill |
| **与 CI/CD 集成** | 不可（纯桌面 App） | CLI + SDK + GitHub Actions 原生支持 | CLI + `--json` + CI 友好 | CLI + hook 脚本 |

### 3.5 维护难度对比

| 维度 | AIPE | Claude Code | Codex | agent-workflow |
|------|------|-------------|-------|----------------|
| **升级方式** | 整包 DMG 替换（需签名/notarization） | `npm update` / 自动更新 | 云端自动，用户无感 | `npm update` + `agent-workflow sync` |
| **破坏性变更风险** | 高——prompt/tool/行为全部耦合在二进制，升级后无法 diff 变化 | 低——SKILL.md/Hook/CLAUDE.md 版本化在 git，升级仅影响内置工具 | 低——sandbox 环境独立，模型升级由 OpenAI 管理 | 低——skill 文件版本化，状态机配置可 git diff |
| **定位问题** | 难——无标准 trace，只能看 UI 日志；bug 报告需提供完整上下文给内部团队 | 易——OTel trace + session log + Hook 日志 | 易——任务有完整执行日志 + sandbox 可复现 | 中——workflow-state.json 记录每步 + git history |
| **回滚版本** | DMG 备份或重新安装旧版 | `npm install @specific-version` | 不适用（云端版本） | `npm install @specific-version` + link 刷新 |
| **多人协作一致性** | 平台统一推送（优势）；但个人配置漂移难管理 | CLAUDE.md + settings.json 签入 git（团队共享配置） | instructions 签入 git | CLAUDE.md + skills + settings 全部 git 管理 |
| **prompt 漂移检测** | 不可能——prompt 内嵌二进制 | 可 diff——SKILL.md 和 rules 是文本文件 | 有限——instructions 可 diff，系统 prompt 不可见 | 可 diff——所有 skill/spec/plan 都是文本 |
| **自研 vs 社区维护** | 完全依赖内部团队；bug/feature 请求单一通道 | Anthropic 维护 + 开源社区反馈 + 第三方 skill 生态 | OpenAI 维护 + 社区反馈 | 内部维护但 skill 标准可跨团队共享 |

### 3.6 工作流能力总结

**AIPE 工作流的独特优势**：
- 唯一内置**自动依赖推断 + 并发控制 + 级联失败处理**的调度引擎
- 唯一将 **build → LSP → AI review → auto-fix** 做成内置自动闭环
- 需求到代码的全链路（RequirementAgent → SolutionAgent → CodeAgent）
- 单步调试（`stepNext`）能力独一无二

**AIPE 工作流的核心短板**：
- **黑盒不可定制**：工作流逻辑内嵌 C++ 二进制，用户无法修改流程步骤、门禁条件或验证策略
- **审批门禁弱**：`WaitingPlanConfirm` 不是 Hard Stop——跳过后没有显式状态阻断
- **无增量变更**：计划中途需求变化时没有 delta 分析机制
- **无归档沉淀**：任务完成后经验如何结构化沉淀不明
- **不可集成**：纯桌面 App，无法嵌入 CI/CD 或自动化 pipeline

**Claude Code 的工作流路线**（不同哲学）：
- 不内置工作流状态机，而是提供**原语**（Hook + Agent + Skill + Team + Worktree）让用户组合
- 优势：极致灵活，任何流程都可通过 skill + hook 实现
- 劣势：复杂流程需要用户自行编排（或依赖 agent-workflow 等上层框架）

**agent-workflow 的工作流路线**（最完整对照）：
- 7 态显式状态机 + Hard Stop 审批 + 增量变更 + 归档
- 所有定义是文本文件（可 git diff / code review / 跨团队共享）
- 劣势：学习曲线高，需要理解状态机概念

---

## 4. 综合评价

### 4.1 AIPE 的真实定位

AIPE 不是"功能不足的 AI 助手"，而是一个**内核成熟但治理封闭的内部 Agent 平台**。它的问题不在于"能不能做"，而在于"做了之后能不能被审计、被定制、被信任"。

| 评价维度 | AIPE | Claude Code + 工作流生态 | Codex |
|----------|------|--------------------------|-------|
| Agent 内核成熟度 | 高（调度/并发/闭环/场景 agent 完备） | 高（agent loop + subagent + teams 完备） | 中（单 agent 执行，无编排） |
| 能力可扩展性 | 低（内嵌二进制，等平台发版） | **极高**（skill/hook/MCP/agent 定义/teams 任意组合） | 低（sandbox 环境 + instructions） |
| 治理透明度 | 低（权限/trace/门禁不可外部审计） | 高（声明式权限 + OTel + Hook exit code） | 中（sandbox 隔离但过程不可见） |
| 工作流完整度 | 高（需求→代码→验证→修复内置） | 高（通过 skill 组合覆盖全链路） | 低（单任务执行，无流程） |
| 工作流可定制性 | **极低**（黑盒，不可修改） | 高（skill 文本文件 + 状态机配置） | 不适用 |
| 维护成本 | 高（整包 DMG 发版 + prompt 不可 diff） | 低（npm + git 管理 + 文本文件可 diff） | 极低（云端免运维） |
| 平台锁定风险 | **极高**（能力/流程/数据全绑定单一 App） | 低（skill/rules/MCP 可跨 9+ 平台迁移） | 中（绑定 OpenAI 生态） |

### 4.2 "独有能力"的重新审视

经过 §2.1 的逐项分析，AIPE 声称的 8 项"独有"能力中：

- **5 项**已通过 Claude Code 扩展机制（skill + hook + MCP + agent 定义）完整实现，且实现产物是可版本化、可审计、可跨团队共享的文本文件
- **2 项**功能等价但路线不同（auto-fix 无需人工确认 = 更激进的哲学选择而非技术优势；本地 RAG 向量索引 = 超大仓库场景的局部优势）
- **1 项**真正独有（单步调试 `stepNext`）

这意味着 AIPE 的核心价值不在于"拥有别人没有的能力"，而在于**将这些能力打包为零配置产品**——降低了使用门槛，但代价是牺牲了可定制性和可审计性。

### 4.3 系统提示词与 Claude Code 的关系

通过 Mach-O 字符串段恢复 AIPE 的 prompt 片段，与 Claude Code 源码 prompt 比对后的结论：

AIPE 参考了 Claude Code 类 coding harness 的提示词模式（read-before-edit、exact edit、tool briefing、subagent/skill、context compaction），但围绕内部研发流程重写了一套 prompt，不是直接搬用 Claude Code 原文。二进制中未见 Claude Code 高识别度文本（`You are Claude Code`、`<system-reminder>`、`ToolSearch`、`TodoWrite`、`TaskCreate`、`subagent_type` 等），各维度均为"问题域相同、表达不同"。

### 4.4 AIPE 对 Claude Code 能力的覆盖度

综合源码分析和系统提示词比对：

```text
Claude Code 核心 agent 能力（agent loop/工具/MCP/skills/context）：AIPE 覆盖约 50%-65%
Claude Code 产品化治理能力（权限/hooks/checkpoint/sandbox/OTel）：AIPE 覆盖约 25%-40%
Claude Code 生态/SDK/多界面能力（CLI/SDK/CI/IDE/Web/Slack）：AIPE 覆盖约 15%-30%
```

AIPE 最强的部分是 **coding agent harness 内核**（本地工具、agent loop、MCP、skills、context compaction、LSP/build/review、任务调度）。明显弱于 Claude Code 的部分是**可治理的外部化框架能力**（声明式权限、hooks、checkpoint、sandbox、OTel、SDK、CI/CD、worktree、标准 tool schema、多界面连续性）。

### 4.5 不同团队的适用判断

| 团队特征 | 推荐选择 | 理由 |
|----------|----------|------|
| 低敏项目 + 非技术角色为主 + 追求快速见效 | AIPE（只读模式试点） | 零配置优势明显；内置全链路降低认知负担 |
| 重安全/合规 + 需要审计 trace + 组织级策略 | Claude Code | 声明式权限 + OTel + sandbox 是合规基线 |
| 复杂多模块项目 + 需要流程定制 + CI/CD 集成 | Claude Code + agent-workflow | 状态机 + skill 组合 = 可定制的全链路；CLI 友好 |
| 高并行/高吞吐 + 独立任务为主 | Codex | 云端 sandbox 天然隔离 + 免运维 |
| 已深度绑定内部系统（GitLab/蓝鲸/PMS） | AIPE 或 Claude Code + MCP | AIPE 零配置但锁定；MCP 方案更灵活 |

### 4.6 风险与收益总结

```text
选择 AIPE 的收益：
  + 零配置端到端（需求→代码→验证→修复）
  + 内部系统深度集成无需额外配置
  + 组织统一推送，降低个体差异
  + 调度引擎（并发/依赖/级联）开箱即用

选择 AIPE 的风险：
  - 黑盒不可定制：流程不符合实际时无法调整
  - 平台锁定：能力/流程/数据/经验全绑定单一 App
  - 治理不透明：权限/trace/checkpoint 无法外部审计
  - 迭代受限：任何变更等整包发版，无灰度/A/B 能力
  - 能力天花板：Claude Code 通过 skill 生态持续扩展，AIPE 追赶成本高

选择 Claude Code + 工作流的收益：
  + 扩展性极强：任何 AIPE 有的能力都可通过 skill/hook/MCP 构建
  + 治理透明：权限/trace/门禁 全部可配置可审计
  + 平台无关：同一套 skill 跨 9+ 工具生效
  + 社区驱动：能力持续进化，不依赖单一团队

选择 Claude Code + 工作流的风险：
  - 初始配置成本高于 AIPE（MCP 接入/skill 理解/状态机学习）
  - 需要团队中有人理解 harness engineering 概念
  - "原语组合"模式要求使用者有一定工程判断力
```

---

## 5. 参考资料

- Anthropic, Claude Code Docs — code.claude.com/docs/
- OpenAI, Codex CLI — openai.com/index/introducing-codex/
- OpenAI, "Harness Engineering" — openai.com/ms-BN/index/harness-engineering/
- Martin Fowler, "Harness Engineering for Coding Agents" — martinfowler.com/articles/harness-engineering.html
- Addy Osmani, "Agent Harness Engineering" — addyosmani.com/blog/agent-harness-engineering/
- agentskills.io Specification — agentskills.io/specification
- LangGraph Docs, "Durable execution" — docs.langchain.com/oss/python/langgraph/durable-execution
- OpenAI Agents SDK, "Tracing / Guardrails" — openai.github.io/openai-agents-python/
