# AIPE vs. 主流 Agent / Harness 框架技术评审

> 审查日期：2026-05-08  
> 审查对象：`AIPE-1.0.0.73-Darwin.dmg`，内部研发协作智能工作平台  
> 对比对象：LangChain、LangGraph、Claude Agent SDK / Claude Code SDK、OpenAI SDK / OpenAI Agents SDK  
> 方法论基线：Harness Engineering，即通过工具、上下文、权限、反馈、验证和状态管理来提高 agent 可靠性  
> 数据来源：DMG 静态解包与 Mach-O 字符串/符号分析，未运行应用；用户手册信息和 `/Users/ws/dev/claude-code-source` 源码抽样比对作为辅助背景

---

## 1. 执行摘要

AIPE 不是普通的 AI 聊天壳，也不是 LangChain / LangGraph / AutoGen / CrewAI 等开源框架的简单封装。静态分析显示，它是一个 **C++/Qt 自研桌面 Agent Harness**：

- 前端/客户端：Qt/QML 原生 macOS App，主程序 `AIPE`，辅助 MCP 服务程序 `AIPEMCP`
- 模型层：多模型适配、外部模型服务、embedding 服务、本地代理等多类通道
- 编排层：自研 `AIServer`、`AgentScheduler`、`AgentSession`、`AgentManager`、`AIToolHandler`、`ToolRouter`
- 场景 Agent：`DeveloperAgent`、`CodeAgent`、`RequirementAgent`、`SolutionAgent`、`TestAgent`、`FigmaAgent`、`SkillAgent`
- 工程工具：本地文件读写、`bash_exec`、GitLab 远程代码读取、MCP、RAG、构建验证、LSP diagnostics、AI review、auto-fix
- 状态层：SQLite 保存代码索引、会话、skills、MCP 配置、RAG chunk/embedding、函数调用图等

结论：AIPE 的方向符合 Harness Engineering，但成熟度不能按“开源标准框架”来默认信任。它更像内部团队自研的 Claude Code 风格 coding-agent harness，并叠加了 LangGraph 式任务调度思路；优势是深度贴合公司内网研发系统，风险是关键安全边界、调度语义、trace、checkpoint 和数据流透明度都需要内部团队证明。

---

## 2. 静态解包证据

### 2.1 包结构

DMG 解包后主要内容：

- `AIPE.app/Contents/MacOS/AIPE`：主 GUI 程序，Mach-O universal binary，约 21MB
- `AIPE.app/Contents/MacOS/AIPEMCP`：本地 MCP 服务程序，Mach-O universal binary，约 784KB
- `AIPE.app/Contents/Frameworks/*`：Qt 5.15.2 相关框架
- `AIPE.app/Contents/PlugIns/*`：Qt QML、SQLite、WebView、imageformats 等插件

`Info.plist` 关键信息：

- Bundle ID：`com.wondershare.filmoraagent`
- Version：`1.0.0.73`
- `NSAllowsArbitraryLoads = true`
- Developer ID：`Wondershare Technology Group Co.,LTD (YZC2T44ZDX)`

注意：本次为离线解包，未通过系统原生挂载保留 HFS+ 全部元数据；正式引入前应在干净机器上原生挂载后重新做 notarization、codesign、Gatekeeper 校验。

### 2.2 技术栈判断

AIPE 不是 Electron / Node / Python agent app，而是 Qt/C++ 原生实现：

- 依赖：`QtQuickControls2`、`QtSql`、`QtConcurrent`、`QtWebSockets`、`QtWebView`、`QtNetwork`、`WebKit`
- 本地数据库：SQLite
- UI：Qt/QML
- 代码编辑/语法相关：可见 Scintilla 相关符号
- LSP：可见 `LSPClient`、`LSPServerManager`、`publishDiagnostics`、`textDocument/publishDiagnostics`

---

## 3. 模型接入形态

### 3.1 多模型服务接入

AIPE 内置多模型适配能力，可同时支持 OpenAI-compatible、Claude-compatible、Gemini/Grok/MiniMax 类模型、Copilot 类模型通道，以及本地代理通道。

从架构角度看，它并不内置大模型，而是把用户请求、上下文、工具结果和可能的文件内容发送给外部模型服务。引入评审不需要依赖具体 endpoint，而应关注：

- 哪些模型通道默认启用
- 是否所有请求都经过公司受控网关
- 文件上传何时触发、上传范围是什么
- 模型请求日志如何脱敏和保留
- 第三方模型服务是否会接触公司代码、需求、测试数据或日志
- 是否支持按项目/团队禁用特定模型通道

判断：模型接入层是 AIPE 的关键治理边界。平台方应提供数据流图、模型路由策略和文件上传策略，而不是只给用户操作说明。

### 3.2 Copilot 类账号通道

用户手册提到需要登录 Copilot 类服务。静态分析显示，这不是纯 UI 登录，而是可作为模型推理通道使用。

这类通道的核心风险不在具体登录 URL，而在账号和数据边界：

- 使用个人账号还是组织受管账号
- 公司代码、prompt、工具结果是否会进入该服务
- token 如何存储、刷新和撤销
- 是否能按项目禁用
- 是否有组织级审计和合规确认

风险点：如果使用员工个人账号处理公司代码，代码片段、prompt、工具结果可能进入非公司统一治理的模型服务通道。引入前必须明确账号归属、组织策略、审计日志、数据保护条款和允许使用范围。

### 3.3 Embedding / RAG 通道

AIPE 有本地 RAG 组件：

- `EmbeddingService`
- `RAGIndexer`
- `RAGRetriever`
- `RAGManager`
- `kb_chunks`
- `kb_embeddings`

静态证据显示 AIPE 支持外部 embedding 服务和内部/本地 embedding API 形态。评审重点是：

- 哪些内容会被切 chunk
- embedding 请求是否走公司受控服务
- 向量库是否加密
- 是否支持项目级清理和重建
- 是否会把需求、skills、历史会话、代码片段混在同一索引里

判断：AIPE 会把部分项目资料、skills、需求、会话文件等切 chunk 后向量化。需要确认 embedding 数据流、索引隔离和 DB 加密策略。

### 3.4 本地代理通道

AIPE 支持把模型请求发给本地 proxy。这对内网治理有价值，但也增加了配置漂移风险。应要求平台方提供受管控的 proxy 配置、证书/鉴权策略和禁用策略。

---

## 4. Agent 技术架构

### 4.1 总体架构

AIPE 的架构可概括为：

```text
Qt/QML GUI
  -> AIServer
    -> Model Adapters
       -> managed model services / account-based model services / embedding services / local proxy
    -> Agent Runtime
       -> AgentManager / AgentScheduler / AgentSession
       -> DeveloperAgent / CodeAgent / RequirementAgent / SolutionAgent / TestAgent / FigmaAgent
    -> Tool Runtime
       -> AIToolHandler / BuiltinToolExecutor / ToolRouter
       -> read_file / write_file / bash_exec / GitLab / MCP / RAG / Build / LSP
    -> State
       -> SQLite: files/classes/functions/function_calls/chat/skills/mcp_configs/kb_chunks/kb_embeddings
```

### 4.2 编排层

关键自研类：

- `AIServer`：中央模型与工具编排，负责模型切换、工具刷新、MCP 路由、token 统计、账号通道状态、代码保存、build/review 流程
- `AgentScheduler`：计划提交、任务调度、依赖推断、并发控制、暂停/恢复/单步、重跑/取消、build verification、LSP review、AI code review、auto-fix
- `AgentSession`：单任务会话、tool loop、message compaction、tool result continuation、build project tool
- `AgentManager`：agent 注册、创建动态 agent、任务分派、状态查询
- `CoderAgentPool`：按 workspace 管理开发 agent
- `ToolRouter`：根据任务与 MCP service 选择工具集合
- `AIToolHandler`：工具定义、tool call 解析、执行队列、缓存、MCP tool 注入、skill tool 执行

这是一套完整自研 runtime，而不是对某个开源 agent framework 的薄封装。

### 4.3 场景 Agent

可见场景 agent：

- `DeveloperAgent`：开发会话、文件修改记录、bash 执行、会话反思、skill 提取
- `CodeAgent`：代码生成、构建验证、LSP 检查、代码审查、auto-fix
- `RequirementAgent`：需求文档、Figma URL、流程图解析、需求到任务
- `SolutionAgent`：方案生成、方案细化、代码生成联动
- `TestAgent`：测试分析、测试用例生成
- `FigmaAgent`：Figma design-to-code、多文件代码提取、任务拆分
- `SkillAgent`：执行 skill 指令
- `SkillExtractorAgent` / `SkillAuditorAgent`：从会话提取 skill、审计并更新 skill

### 4.4 工具能力与权限

可见内置工具：

- `read_file`
- `list_directory`
- `search_files`
- `search_file_content`
- `write_file`
- `bash_exec`
- GitLab tools：`git_read_file`、`git_list_directory`、`git_search_files`
- MCP tools：`tools/list`、`tools/call`
- RAG tools：`rag_search`、`rag_list_documents`、`rag_get_document_chunks`、`rag_rebuild_index`
- Build/LSP：构建脚本探测、`compile_commands.json`、diagnostics、code review、auto-fix

可见安全措施：

- 目录授权：`projectDirectoriesNeedAuthorization`
- 非授权路径拒绝：`path is not within any authorized project directory`
- 写入项目外拒绝：`Access denied: path is outside project directory`
- 绝对路径/路径穿越拒绝：`rejecting absolute path`、`rejecting path traversal`
- 危险命令识别：`isDangerousCommand`
- 阻断 `curl|bash`、`wget|sh` 形式的高风险命令
- 二进制文件读取拒绝

风险点：`write_file` 和 `bash_exec` 是高权限能力，即使有授权和过滤，也必须有可审计日志、默认拒绝、项目级 allowlist、命令 sandbox、回滚机制和组织策略。

---

## 5. 是否使用主流开源 Agent 框架

静态分析结论：未发现使用 LangChain、LangGraph、AutoGen、CrewAI、Semantic Kernel、LlamaIndex、Dify 等主流框架的明显证据。

证据：

- 没有出现 `langchain`、`langgraph`、`autogen`、`crewai`、`semantic kernel`、`llamaindex` 等字符串
- 主程序是 C++/Qt Mach-O，不是 Python/Node 包分发
- Agent runtime 核心类均为本地 C++ 符号，且覆盖 model adapter、session、scheduler、tool handler、router、agent pool、state DB
- 模型适配层也是自研 C++ 类，覆盖 OpenAI-compatible、Claude-compatible、Copilot-like、Gemini/Grok/MiniMax 类模型通道

判断：AIPE 是 **纯自研 agent 调度与工具执行框架**，最多借鉴了 Claude Code / OpenAI tool calling / MCP / LangGraph 式 durable workflow 的设计思想。

---

## 6. 与主流框架对比

| 维度 | AIPE | LangChain | LangGraph | Claude Agent SDK / Claude Code SDK | OpenAI SDK / Agents SDK |
|------|------|-----------|-----------|------------------------------------|--------------------------|
| 核心定位 | 内部研发协作桌面 harness | 高层 LLM app/agent 集成框架 | 有状态、多步骤 agent 编排 runtime | Claude Code 风格 agent harness SDK | OpenAI SDK 是 API client；Agents SDK 是 agent 框架 |
| 技术栈 | C++/Qt + SQLite | Python / JS | Python / JS | Python / TypeScript | Python / TypeScript |
| Agent loop | 自研 | 框架预置 agent 抽象 | 图状态机 | SDK 内置 coding-agent loop | Agents SDK 内置 agent、handoff、guardrail |
| 状态管理 | SQLite，本地会话/索引/skills/RAG | 可接 memory/store | 强项，checkpoint/durable execution | session/context 管理 | tracing/session 支持，工作流持久化需自行设计 |
| 工具系统 | 自研工具 + MCP + GitLab + RAG + 本地命令 | Tool abstraction 丰富 | 节点/agent 接工具 | 文件、命令、MCP、权限 | function tools、内置工具、handoff |
| 模型支持 | 受管模型服务 + 账号型模型服务 + embedding + local proxy | 多模型生态 | 通常复用 LangChain 模型生态 | 主要 Claude | 主要 OpenAI，可扩展 |
| 人类审批 | 有目录授权、tool approval 痕迹 | 由应用自行实现 | human-in-the-loop 是核心能力 | 权限模型成熟 | guardrail/handoff/tracing 完整 |
| 可观测性 | 有日志/token 统计；trace 产品化不明 | LangSmith | LangSmith / Studio | monitoring/session | Agents SDK tracing |
| 可移植性 | 低，绑定 AIPE GUI 和内部系统 | 高 | 高 | 中高，绑定 Claude 生态 | 中高，绑定 OpenAI 生态 |
| 内部系统集成 | 强：GitLab、蓝鲸、Bkrepo、PMS、钉钉、Figma | 需自行接入 | 需自行接入 | 需自行接入 | 需自行接入 |
| 可审计性 | 取决于内部源码/文档开放程度 | 开源可审计 | 开源可审计 | SDK 可审计，产品能力依赖 Claude | SDK / Agents SDK 文档清晰 |

### 6.1 对比 LangChain

LangChain 的优势是模型与工具生态成熟，适合快速搭建 agent 应用。它本身更像应用框架/集成层，不负责把公司研发流程、构建、LSP、需求、PMS 全部打包成一个桌面平台。

AIPE 相比 LangChain：

- 优势：更贴近内部研发场景，已经把 GitLab、需求、构建、LSP、RAG、MCP、Figma 等整合进一体化 UI
- 劣势：生态不可移植，框架不可复用，社区验证不足，升级与维护完全依赖内部团队

### 6.2 对比 LangGraph

LangGraph 是更接近 AIPE 架构目标的参照物：多步骤、有状态、可中断、可恢复、human-in-loop 的 agent runtime。

AIPE 与 LangGraph 的相似点：

- 有任务调度
- 有依赖推断
- 有 step/pause/resume/rerun/cancel
- 有 tool loop
- 有构建与 review feedback
- 有本地状态库

关键差异：

- LangGraph 的状态图、checkpoint、durable execution 是显式抽象
- AIPE 的 `AgentScheduler` / `AgentSession` 是内部实现，外部看不到形式化状态机和 checkpoint 语义
- LangGraph 工作流可测试、可版本化、可迁移；AIPE 工作流绑定 GUI 和内部数据模型

评估建议：要求 AIPE 团队提供状态机图、任务 schema、失败恢复语义、并发调度策略和 replay/checkpoint 说明。

### 6.3 对比 Claude Agent SDK / Claude Code SDK

Claude SDK 是最接近 AIPE 的参照。二者都围绕 coding agent harness：上下文管理、文件工具、命令执行、MCP、权限、会话、工程验证。

AIPE 相比 Claude SDK：

- 优势：接入公司内部系统更深，覆盖需求、测试、Figma、蓝鲸、Bkrepo、PMS、钉钉等协作场景
- 劣势：Claude SDK 背靠 Claude Code 的产品化经验，权限、session、monitoring、MCP 与工具协议更标准；AIPE 是内部自研，需要额外证明安全性和稳定性

如果 AIPE 要成为公司级平台，应至少达到 Claude Code 类工具的基线：

- 明确工具权限模型
- 每次工具调用可审计
- 高风险命令需要显式确认
- 文件修改有 diff、回滚、review
- 上下文压缩可解释
- MCP server/client 配置可管控

### 6.4 与 Claude Code 源码的相似性判断

结合 `/Users/ws/dev/claude-code-source` 的源码抽样，AIPE 的产品形态和能力组合确实最接近 Claude Code。更细分地看，当前证据支持三层判断：

1. **参考 Claude Code 的产品/架构范式：可能性较高。** AIPE 同时具备本地文件工具、shell、MCP、权限确认、上下文压缩、skills/subagent、任务执行闭环、build/LSP/review/auto-fix。这组能力不是普通聊天应用会自然长出来的功能集合，更像是围绕 Claude Code 类 coding harness 目标做的内部平台化实现。
2. **参考 Claude Code 源码中的设计思想：有一定可能。** AIPE 的 `AgentSession` / `AIServer` 工具结果续跑、`ContextCompactor`、`ToolLoopDetector`、场景 agent、任务调度和权限护栏，与 Claude Code 源码里的 query loop、tool permission、subagent、context compaction 等问题域高度重合。这不等于复制源码，但说明设计者很可能熟悉同类实现。
3. **直接仿照源码实现或源码级派生：证据不足。** 如果是按 Claude Code 源码翻译或改写，通常会留下更明显的模块名、工具名、类型名、prompt 文案或状态名重合；当前静态字符串和符号比对没有看到这类强信号。

因此，本报告采用的结论是：AIPE 很可能参考了 Claude Code / Claude Agent SDK 的 coding harness 范式，甚至可能参考过其公开源码中的 agent loop、tool permission、subagent、context compaction 等设计思想；但当前证据不支持源码级仿制或直接派生。更合理的判断是：AIPE 基于 Claude Code 类产品经验做了 C++/Qt 内部平台化重实现。

Claude Code 源码的关键结构是：

- TypeScript 实现，核心循环在 `query()` / `queryLoop()`，由消息流、tool result、attachment、context compaction 驱动下一轮模型调用
- 工具体系由 `Tool<Input, Output>`、`buildTool()`、`inputSchema`、`isConcurrencySafe`、`isReadOnly`、`isDestructive`、`checkPermissions` 等显式类型字段构成
- 子代理通过 `AgentTool`、`runAgent()`、`forkSubagent()`、`resumeAgent()`、`loadAgentsDir()` 管理，agent 定义来自内置定义和 markdown agent 文件
- 内置工具名包括 `Read`、`Write`、`Edit`、`Bash`、`Agent`、`ToolSearch`、`TodoWrite`、`TaskCreate`、`TaskList`、`TaskOutput`、`TaskUpdate`、`TaskStop`、MCP 相关工具等
- 权限模型围绕 `canUseTool`、`ToolUseContext`、`PermissionContext`、tool permission rules、危险命令检查、只读/破坏性工具分类展开
- 上下文管理包含 compaction、sidechain transcript、subagent context、session metadata、`CLAUDE.md` 上下文裁剪等机制

AIPE 的静态证据则呈现另一套实现语言和命名体系：

- C++/Qt 实现，核心类包括 `AIServer`、`AgentScheduler`、`AgentSession`、`AgentManager`、`AgentBase`
- 工具执行由 `AIToolHandler`、`BuiltinToolExecutor`、`ToolRouter`、`MCPClientManager` 等类承载
- 场景 agent 以 `DeveloperAgent`、`CodeAgent`、`RequirementAgent`、`SolutionAgent`、`TestAgent`、`FigmaAgent`、`SkillAgent` 为主
- 调度器直接暴露 `submitPlan`、`startPlanning`、`pause/resume/stepNext`、`rerunTask/cancelTask`、`runBuildVerification`、`startLSPReview`、`startCodeReview`、`startAutoFix` 等研发工作流动作
- 上下文与会话可见 `AgentSession::trimMessageHistory`、`ContextCompactor::shouldCompact`、`ToolLoopDetector`、SQLite 会话/skills/RAG/索引表等信号

| 对比点 | Claude Code 源码 | AIPE 静态证据 | 相似性 | 源码级仿照可能性 |
|--------|------------------|---------------|--------|------------------|
| 产品定位 | coding agent harness | 内部研发协作 coding harness | 高 | 不能单独作为证据 |
| 实现技术栈 | TypeScript / React UI / CLI / SDK | C++ / Qt / QML / SQLite / 桌面 App | 低 | 低 |
| 主循环 | `query()` / `queryLoop()` 递归处理 tool result | `AIServer` + `AgentSession` + `AgentScheduler` | 中 | 低 |
| 工具抽象 | `Tool` 类型、`buildTool()`、显式 schema/权限字段 | `AIToolHandler` + 内置工具/MCP/skill/业务工具总线 | 中 | 低 |
| 工具命名 | `Read`、`Write`、`Edit`、`Bash`、`Agent`、`TodoWrite`、`ToolSearch` | `read_file`、`write_file`、`bash_exec`、`list_directory`、业务/MCP/RAG 工具 | 中 | 低 |
| 子代理 | `AgentTool` spawn/fork/resume，markdown agent 定义 | 固定场景 agent + `AgentScheduler` 任务执行 | 中 | 低 |
| 权限模型 | `canUseTool`、permission rules、read-only/destructive 分类 | 目录授权、路径逃逸拒绝、危险命令拦截、tool approval 痕迹 | 中 | 无法从二进制确认 |
| 上下文压缩 | compaction、sidechain transcript、`CLAUDE.md` 裁剪 | `ContextCompactor`、history trim、session reflection | 中 | 低 |
| 工程反馈 | 工具执行后继续循环，另有任务/监控能力 | build/LSP/review/auto-fix 深度内置 | 高 | 更像独立产品化扩展 |
| 特有命名重合 | `TodoWrite`、`ToolSearch`、`AgentTool`、`ToolUseContext` 等 | 未见这些 Claude Code 特有命名 | 低 | 低 |

判断：

- **最贴近的框架/产品范式：Claude Code / Claude Agent SDK。** AIPE 的核心价值不是普通 LLM app，而是“模型 + 本地工具 + 权限 + 会话 + 反馈闭环”的 coding harness。
- **第二接近：LangGraph。** AIPE 的 `AgentScheduler` 有任务依赖、并发、暂停、重跑、失败级联、构建/LSP/review/auto-fix，这些能力在概念上接近有状态 workflow runtime，但 AIPE 没有暴露 LangGraph 那样的显式 graph/checkpoint 抽象。
- **不像 LangChain/OpenAI SDK 的简单封装。** AIPE 已经把桌面 UI、内部系统、RAG、MCP、文件写入、命令执行和调度器打包成产品，不是应用层调用几个 SDK。
- **可能参考过 Claude Code 源码的设计思想，但源码级仿照证据不足。** 如果是直接从 Claude Code 源码派生，通常会看到更明显的 TypeScript 模块名、工具名、permission 类型、prompt 文案或 session 术语重合；当前静态字符串比对没有看到这些强信号。
- **更合理的解释：范式借鉴或同类需求下的收敛设计。** 两者都要解决 coding agent 的核心问题，所以都会出现文件工具、shell、MCP、权限、context compaction、subagent/skills、任务恢复等相似概念；AIPE 看起来是用 C++/Qt 和内部业务系统重新实现了一套。

引入评审时，不应把“像 Claude Code”当成负面结论。真正的问题是：AIPE 是否能达到 Claude Code/Claude Agent SDK 这类成熟 harness 在权限、trace、session、MCP、工具 schema、失败恢复上的工程基线。

### 6.5 与 Claude Code 源码系统提示词对比

为了判断 AIPE 是否不只是功能相似，而是在 prompt 层参考或复用了 Claude Code 源码，本次额外对比了 Claude Code 源码中的主 system prompt、tool prompt、subagent prompt、compaction prompt、skill prompt，与 AIPE Mach-O 字符串中可恢复的 prompt 片段。

Claude Code 源码里的 prompt 结构非常模块化：

- 主 system prompt：`src/constants/prompts.ts`，包含 intro、system reminders、software engineering task guidance、tool usage、tone/style、output efficiency、memory、MCP、language、output style 等分段
- 工具 prompt：`src/tools/*/prompt.ts`，每个工具单独描述，例如 `Read`、`Write`、`Edit`、`Bash`、`Agent`、`ToolSearch`、`TodoWrite`
- subagent prompt：`src/tools/AgentTool/prompt.ts` 和 `src/tools/AgentTool/built-in/*`，描述何时 fork/subagent、如何写 agent prompt、如何避免读子代理中间输出
- memory/rules prompt：`CLAUDE.md`、`.claude/rules`、auto-memory、skills 通过不同模块注入
- compact prompt：`src/services/compact/compact.ts`，把历史消息压缩成摘要并保留近期上下文

AIPE 二进制中可见的 prompt 结构则更偏内部研发流水线：

- 工具提示：`read_file`、`list_directory`、`search_files`、`search_file_content`、`edit_file`、`write_file`、`bash_exec`、`build_project`
- 代码生成约束：要求用 `read_file` 后再 `edit_file`，通过 `old_string/new_string` 精确修改，必要时用 `CODE_CHANGES` / `FILES_MANIFEST` 描述大文件改动
- 构建与 review prompt：LSP review、AI code review、auto-fix，要求输出 `{ "pass": true/false, "issues": [...] }`
- 任务规划 prompt：`task_split_planning`、`agent_planner`、`AgentScheduler`、依赖推断、任务确认、重跑/取消/补修
- 业务场景 prompt：Requirement、Solution、Code、Test、Figma、Skill、RAG、GitLab/MCP/内部系统工具
- skill prompt：`.skill.md` / `SKILL.md`、`system prompt`、`input_schema`、`output_schema`、skill 推荐、skill 提取和审计

| 对比维度 | Claude Code 源码 prompt | AIPE prompt 静态证据 | 判断 |
|----------|--------------------------|----------------------|------|
| 基础身份 | `You are Claude Code...` / `You are an interactive agent...` | 未见等价身份文案；更多是内部 AI agent / 场景 agent 语境 | **未见直接复用** |
| 主 system prompt 分段 | `# System`、`# Language`、`# Output Style`、system reminders、memory、MCP 等 | 有工具 briefing、任务规划、场景 prompt、memory/skill，但分段命名不同 | **结构目标相似，组织方式不同** |
| 工程任务行为 | “读代码后再改”“谨慎处理风险操作”“不要越权扩展需求”等通用 coding agent 约束 | 有 read-before-edit、路径授权、危险命令、构建/LSP/review/auto-fix 约束 | **问题域相同，表达不同** |
| 文件工具 prompt | `Read` / `Write` / `Edit`，强调 absolute path、read before write/edit、exact string replacement | `read_file` / `edit_file` / `write_file`，强调 `old_string/new_string`、`CODE_CHANGES`、manifest、路径安全 | **能力相近，但工具名和格式不同** |
| Bash prompt | `Bash`，含 background、git safety、sandbox、permission 规则 | `bash_exec`，含授权目录、危险命令识别、超时、构建命令 | **部分相似，Claude Code 更强调 sandbox/权限 DSL** |
| Agent/subagent prompt | `Agent`、`subagent_type`、fork、prompt 写法、不要编造 fork 结果 | `DeveloperAgent`、`CodeAgent`、`DynamicAgent`、`AgentMessageBus`、`/agent create/list/stop` | **agent 概念相近，prompt 文案和协议不同** |
| Todo/task prompt | `TodoWrite`、`TaskCreate/List/Update/Stop/Output` | `AgentScheduler` 内部任务、依赖、pause/resume/rerun/cancel | **功能目标相似，接口完全不同** |
| Tool discovery | `ToolSearch`、deferred tools、MCP/skill tool loading | `ToolRouter`、`list_mcp_services`、`list_skills`、`search_skills`、MCP routing | **模式相似，命名不同** |
| Context compaction | “system automatically compress prior messages”、compact summary | `ContextCompactor`、`trimMessageHistory`、`[Context compacted]` | **能力相似，未见直接文案复用** |
| Prompt injection 防护 | 明确 `system-reminder`、外部 tool result 可能含 prompt injection | AIPE 有工具结果截断、路径/命令安全；未见 Claude Code 特有 `system-reminder` 文案 | **Claude Code 更外显** |
| Skills prompt | Agent Skills / `SKILL.md` / allowed tools / frontmatter | `.skill.md`、`SKILL.md`、system prompt、input/output schema、skill 提取/审计 | **高度相似的问题域，但格式可能是内部变体** |

独特短语匹配结果也支持“没有直接复制主 prompt”的判断。AIPE 二进制中未见以下 Claude Code 高识别度文本或术语：

- `You are Claude Code`
- `You are an interactive agent that helps users`
- `<system-reminder>`
- `prompt injection`
- `The system will automatically compress prior messages`
- `ToolSearch`
- `TodoWrite`
- `TaskCreate` / `TaskList` / `TaskOutput` / `TaskUpdate`
- `subagent_type`
- `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`

结论：

```text
prompt 直接复用：证据很弱，未见 Claude Code 主 system prompt 或工具 prompt 的独特文案复用
prompt 设计参考：可能性中高，尤其是 read-before-edit、exact edit、tool briefing、subagent/skill、context compaction、任务规划
AIPE 特征：更重内部研发流水线、Figma/需求/方案/代码生成、CMake/LSP/review/auto-fix、内部业务工具
```

因此，如果只看系统提示词，AIPE 不像是把 Claude Code 的 prompt 文件直接搬进 C++；更像是参考了 Claude Code 类 coding harness 的提示词模式，然后围绕公司内部研发流程重写了一套 prompt。真正需要 AIPE 团队开放评审的不是“是否用了 Claude Code 原文”，而是：prompt 是否版本化、是否有 diff 审计、是否有回归评测、tool schema 与 prompt 是否同步、以及升级时如何防止提示词漂移导致 agent 行为回退。

### 6.6 对照 Claude Code 官方文档能力

Claude Code 官方文档把能力边界定义得比“能读写代码、能跑命令”更宽。它包括：自主 agent loop、内置工具、subagents、agent teams、skills、MCP、CLAUDE.md/自动记忆、hooks、权限模式、sandbox、checkpointing、OpenTelemetry、CI/CD、Desktop/Web/IDE/Slack/Chrome 等多界面和自动化入口。

基于官方文档和 AIPE 静态证据，AIPE 对 Claude Code agent 能力的实现情况如下：

| Claude Code 能力 | 官方文档能力形态 | AIPE 静态证据 | 判断 |
|------------------|------------------|---------------|------|
| 自主 agent loop | 模型评估 -> tool call -> tool result -> 下一轮，直到完成 | `AIServer`、`AgentSession`、tool result continuation、payload error 后 compact/retry | **基本实现** |
| 文件读取/搜索 | `Read`、`Glob`、`Grep` | `read_file`、`list_directory`、`search_files`、`search_file_content` | **基本实现** |
| 文件写入/编辑 | `Write`、`Edit`，带权限和 checkpoint | `write_file`、`CODE_CHANGES`、文件保存、路径拒绝、undo 信号 | **部分实现**：可写文件，但精确 edit/checkpoint 语义不如 Claude Code 外显 |
| Shell 执行 | `Bash` / `PowerShell`，权限规则和 sandbox 可控 | `bash_exec`、危险命令识别、授权目录、执行超时 | **部分实现**：有命令执行和拦截；未见 OS 级 sandbox 和网络隔离 |
| LSP 工具 | `LSP` 用于定义跳转、引用、类型错误、警告 | `LSPClient`、`LSPServerManager`、diagnostics、`startLSPReview` | **基本实现** |
| Build/Test 验证 | 通过 Bash/LSP/hooks/CI 组合完成 | `runBuildVerification`、build timeout、CMake 修复任务、auto-fix | **基本实现且更产品化** |
| MCP | stdio/SSE/HTTP、资源、工具、OAuth、动态工具更新、托管配置 | `AIPEMCP`、`MCPClientManager`、`MCPConfigManager`、`tools/list`、`tools/call`、MCP routing | **基本实现**，但托管策略和安全边界需证明 |
| Skills | `SKILL.md`、按需加载、frontmatter、可共享、可在 subagent 中运行 | `.skill.md`、`SKILL.md`、`SkillsManager`、`SkillAgent`、`SkillExtractorAgent`、`SkillAuditorAgent`、`/skill` 命令 | **高度相似/基本实现**，但是否完全兼容 Agent Skills 标准需验证 |
| CLAUDE.md / 规则 / 自动记忆 | 项目/用户/组织级指令、`.claude/rules`、自动 memory | `MEMORY.md`、`MemoryManager`、Global/Private/Project、session reflection、skills 提取 | **部分实现**：有 memory/反思；未见完整 CLAUDE.md/rules 兼容 |
| Subagents | 独立 context window、自定义 prompt/tool/权限/model、自动委托、resume/fork/background | `DeveloperAgent`、`CodeAgent`、`RequirementAgent`、`SolutionAgent`、`TestAgent`、`FigmaAgent`、`DynamicAgent`、`AgentRegistry`、`AgentMessageBus`、`/agent create/list/stop` | **部分实现且产品化方向相近**：有场景 agent 和动态 agent，但配置/权限/model/frontmatter 语义不如 Claude Code 明确 |
| Agent teams | 多 Claude Code 实例协作、队友通信、任务认领、集中管理 | `AgentMessageBus`、`sendToAgent`、`DynamicAgent`、`AgentManager` | **部分迹象**：有 agent 间消息和动态 agent；未见完整 TeamCreate/SendMessage/多会话 team 语义 |
| Task/Todo 工具 | `TaskCreate/Get/List/Update/Stop`、`TodoWrite` | `AgentScheduler` 任务列表、依赖推断、pause/resume/rerun/cancel、stepNext | **功能上部分覆盖**：AIPE 用调度器实现任务系统，不是 Claude Code 工具协议 |
| Plan Mode | 先读和规划，审批后执行 | `startPlanning`、`WaitingPlanConfirm`、`EditingPlan`、计划确认 | **部分实现** |
| Worktree/Fork | `EnterWorktree`、`ExitWorktree`、fork session | 未见明确 worktree/fork-session 实现 | **未见证据** |
| Checkpointing/Rewind | 每个用户提示 checkpoint，恢复代码/对话/摘要 | `AIOperationExecutor::undo`、`undoFileChange`、`undoDocEdit` | **部分实现**：有 undo，但未见 Claude Code 式持久 checkpoint/rewind |
| Hooks | SessionStart、PreToolUse、PostToolUse、PermissionRequest、Stop、PreCompact、FileChanged 等生命周期 hook | 仅见 `sessionWebhook`、webhook URL、内部事件信号；未见用户可配置 hook 生命周期 | **未见完整实现** |
| 权限模式和规则 | allow/ask/deny、`Tool(specifier)`、default/plan/auto/dontAsk/bypass 等 | 目录授权、approve/reject/always approve、危险命令、路径保护 | **部分实现**：有运行时授权；缺声明式组织策略和权限 DSL |
| Sandboxing | macOS Seatbelt / Linux bubblewrap，文件系统和网络隔离 | 授权目录、命令过滤、危险命令拦截 | **未见 OS 级 sandbox 证据** |
| Monitor / Cron / Loop | 后台命令流式反馈、计划任务、轮询 | 有 background index、AgentScheduler、webhook，但未见 `Monitor`/`Cron*` 等等价工具 | **部分/未明** |
| WebSearch/WebFetch/Chrome/Computer Use | 网络搜索、网页抓取、浏览器/计算机控制 | 有 Qt WebView、UI screenshot/capture、Figma/MCP；未见通用 WebSearch/WebFetch/Chrome tool | **未见完整实现** |
| Notebook/PowerShell | notebook 编辑、PowerShell 工具 | 未见关键证据 | **未见证据** |
| OpenTelemetry / 标准 observability | OTel metrics/logs/traces，工具/API/权限/压缩事件 | `tokenUsageReported`、tool started/finished、build/review 事件、日志信号 | **部分实现**：有事件基础；未见标准 OTel/exporter |
| CLI/SDK/CI/CD | Claude Agent SDK、CLI pipeline、GitHub/GitLab Actions | AIPE 是 Qt 桌面 App + 本地 API/MCP；未见公开 SDK/CLI/Action | **未见完整实现** |
| 多界面连续性 | Terminal/IDE/Desktop/Web/Slack/Remote Control 共享底层引擎 | AIPE 有桌面、DingTalk/session webhook、内部 API 痕迹 | **部分实现**：偏内部集成，不是 Claude Code 式多界面产品体系 |

总体判断：

```text
Claude Code 核心 agent 能力：AIPE 已覆盖约 50%-65%
Claude Code 产品化治理能力：AIPE 覆盖约 25%-40%
Claude Code 生态/SDK/多界面能力：AIPE 覆盖约 15%-30%
```

AIPE 最像 Claude Code 的部分，是“coding agent harness 内核”：本地工具、agent loop、MCP、skills、context compaction、LSP/build/review、任务调度和内部研发系统集成。AIPE 明显弱于 Claude Code 的部分，是“可治理、可扩展、可审计的外部化框架能力”：声明式权限、hooks、checkpoint、sandbox、OTel、SDK、CI/CD、worktree/fork、标准 tool schema 和多界面会话连续性。

因此，AIPE 不是只实现了 Claude Code 的 UI 外观，而是确实实现了不少 Claude Code 风格 agent 能力；但它实现的是内部产品内核，不是 Claude Code 文档中那套完整开放 harness 平台。评估时应要求 AIPE 团队证明三件事：

- 已有能力是否有明确 schema、策略和 trace，而不是只存在于二进制内部
- 缺失能力是否在路线图中，尤其是 hooks、checkpoint、sandbox、OTel 和声明式权限
- 与 Claude Code/Claude Agent SDK 相比，AIPE 的内部系统集成收益是否足以抵消治理和生态成熟度差距

### 6.7 对比 OpenAI SDK / OpenAI Agents SDK

OpenAI SDK 本身主要是 API client；Responses API 和 tool calling 能构建 agentic workflow，但不会自动提供完整研发流程 harness。OpenAI Agents SDK 则提供 agent、handoff、guardrails、tracing 等更完整的 agent 框架能力。

AIPE 相比 OpenAI SDK / Agents SDK：

- 比基础 OpenAI SDK 更重：已经实现工具执行、调度、状态、RAG、构建验证、LSP、代码保存
- 相比 Agents SDK：AIPE 的场景集成更强，但 guardrails、tracing、handoff 语义、标准化可观测性不如官方 SDK 明确

评估建议：如果继续使用 AIPE，自研部分需要对齐 OpenAI Agents SDK 类框架的 trace/guardrail/handoff 术语，便于内部治理和安全评审。

---

## 7. 工具系统与 Agent 调度深度对比

AIPE 与主流框架的关键差异，不在于“有没有工具调用”或“有没有 agent”，而在于工具系统和调度系统的边界在哪里。AIPE 把工具、权限、业务系统、文件修改、命令执行、构建验证和 UI 全部做进同一个桌面产品；主流框架通常把这些能力拆成标准抽象，让应用开发者按需组合。

### 7.1 工具系统：产品内置工具总线 vs. 框架级 tool abstraction

| 维度 | AIPE | LangChain | LangGraph | Claude Agent SDK / Claude Code SDK | OpenAI SDK / Agents SDK |
|------|------|-----------|-----------|------------------------------------|--------------------------|
| 工具定义来源 | C++ 内置工具 + MCP tools + skills + 业务工具 | Python/JS 函数、Tool、Toolkit | 节点/agent 内显式绑定工具 | SDK/CLI 内置文件、命令、MCP、权限工具 | function tools、hosted tools、handoff、guardrails |
| 工具 schema | 二进制内置，外部不可直接审计 | 代码中可见，可测试 | 图节点和工具定义可版本化 | SDK 类型/配置可见 | SDK 类型和 tracing 可见 |
| 工具发现 | `AIToolHandler` 汇总 base/builtin/MCP/skill tools，`ToolRouter` 选择服务 | 应用侧选择工具 | 图结构显式声明可用工具 | CLI/SDK 暴露工具能力 | Agent / Runner 显式配置 |
| 工具路由 | 关键词 + AI route + MCP service routing | 通常由 agent policy 或开发者控制 | 由图边/条件函数/状态控制 | 由 harness 与权限策略控制 | 由 model + runner + handoff/guardrail 控制 |
| 本地文件 | 内置 `read_file`、`write_file`、目录授权 | 需自行封装 | 需自行封装为节点/工具 | 原生强项 | 可通过工具实现，需自行做权限 |
| 命令执行 | 内置 `bash_exec`，有危险命令识别 | 需自行封装 | 需自行封装 | 原生强项，权限模型成熟 | 需自行封装或使用外部环境 |
| 业务系统 | GitLab、蓝鲸、Bkrepo、PMS、钉钉、Figma 深度内置 | 需自行接 | 需自行接 | 需自行接 | 需自行接 |
| 审计能力 | 可见日志信号，但标准 trace 不明 | 可接 LangSmith | LangSmith/Studio 友好 | session/monitoring 体系更成熟 | Agents SDK tracing 一等公民 |

AIPE 的工具系统更像“内置工具总线”：

```text
ToolRouter
  -> AIToolHandler
     -> BuiltinToolExecutor
        -> read_file / list_directory / search_files / write_file / bash_exec
     -> MCPClientManager
        -> mcp_* tools
     -> SkillsManager / SkillAgent
        -> skill_<name>
     -> Business Tools
        -> GitLab / Blueking / Bkrepo / PMS / Bugsplat / DingTalk / Figma
```

这个设计的优势是落地快、内部系统整合强、普通用户不用理解 tool schema。但它的治理难度也明显更高：

- 工具定义和 prompt 大量内嵌在二进制，变更 diff 不容易审查
- 工具权限与 UI 授权绑定，难以像代码框架一样写单元测试
- MCP、skills、业务工具、文件系统工具共享同一执行总线，隔离边界需要额外证明
- `write_file`、`bash_exec`、GitLab token、MCP API key 都是高风险面
- 如果没有标准 trace，每次工具调用后的责任归因会比较困难

主流框架的差异在于：它们通常不直接内置“改你本地代码并跑命令”的完整工具系统，而是提供可组合抽象。LangChain/LangGraph 更偏“由应用开发者声明工具”；Claude SDK 更偏“提供成熟 coding harness”；OpenAI Agents SDK 更偏“提供 agent、handoff、guardrail、tracing 原语”。

### 7.2 Tool calling 协议：多模型兼容适配 vs. 单框架标准语义

AIPE 同时适配多类模型服务。二进制里能看到多种工具调用解析路径：

- OpenAI-style `tool_calls`
- Claude-style `tool_use` / `tool_result`
- XML 风格 `<function_calls>` / `<tool_call>`
- 文本标签风格 `<read_file>`、`<list_directory>`、`<search_files>`
- OpenAI-compatible tool schema 转换

这说明 AIPE 自己实现了跨模型 tool calling normalization。优势是模型选择灵活；代价是协议适配层复杂，容易出现以下问题：

- 不同模型的 tool call JSON/schema 兼容性不一致
- 流式响应、thinking block、tool result continuation 需要分别处理
- prompt 注入可能诱导文本标签工具调用
- schema sanitize、payload too large、tool result truncation 都要自研兜底
- 多模型升级时需要持续维护解析器

对比：

- LangChain 把多 provider 差异包在模型适配层，但复杂 agent 场景仍依赖开发者调试
- LangGraph 不解决 provider 兼容本身，而是把状态、边、重试、checkpoint 变成显式结构
- Claude SDK 避免了大部分跨模型协议差异，换来 Claude 生态绑定
- OpenAI Agents SDK 在 OpenAI tool/trace/guardrail 语义里最清晰，但多 provider 不是核心目标

评估重点：AIPE 团队需要提供 tool calling 兼容矩阵，说明每个模型通道支持哪些能力：streaming、parallel tool calls、image input、file upload、tool result truncation、retry、cancel、handoff。

### 7.3 权限模型：运行时授权 vs. 可声明安全策略

AIPE 已经具备一些关键护栏：

- 项目目录授权
- 路径逃逸拒绝
- 写入项目外拒绝
- 危险命令识别
- 阻断 `curl|bash` / `wget|sh`
- 二进制文件读取拒绝
- 高风险目录/工具调用确认痕迹

这比普通 LangChain 示例强很多，因为 LangChain/LangGraph 本身并不会替应用自动实现本地文件系统安全。但 AIPE 的问题是：安全策略看起来是运行时逻辑和 UI 行为，而不是外部可审计的声明式策略。

更理想的形态应当是：

```yaml
tools:
  read_file:
    default: allow
    roots: [project]
  write_file:
    default: require_approval
    roots: [project]
    deny:
      - "**/.git/**"
      - "**/secrets/**"
  bash_exec:
    default: deny
    allow_commands:
      - npm test
      - npm run lint
      - cmake --build
  mcp:
    default: deny
    allowed_servers:
      - figma
      - internal-gitlab
```

Claude Code / Claude SDK 类工具的优势是权限体验已经产品化；OpenAI Agents SDK 的优势是 guardrails/tracing 概念清楚；LangGraph 的优势是审批可以作为 graph interrupt/checkpoint 显式建模。AIPE 如果继续自研，需要把当前隐式安全逻辑外化为组织可配置策略。

### 7.4 Agent 调度：自研任务调度器 vs. 显式状态图

AIPE 的 `AgentScheduler` 已经覆盖很多高级能力：

- `submitPlan`
- `startPlanning`
- `scheduleNext`
- `inferImplicitDependencies`
- `setMaxConcurrency`
- `pause` / `resume` / `stepNext`
- `rerunTask` / `cancelTask`
- `cascadeFail`
- `resetFailedDependencies`
- `runBuildVerification`
- `startLSPReview`
- `startCodeReview`
- `startAutoFix`
- `reExtractCodeWithAI`
- `checkCMakeConsistency`
- `createCMakeFixTask`

这表明 AIPE 的调度器不是简单 while-loop，而是面向研发任务的工作流引擎。它会处理依赖、并发、构建、review、修复和失败级联。

但与 LangGraph 的核心差异在于：AIPE 的状态机隐藏在 C++ 实现里，外部只能看到行为；LangGraph 把状态、节点、边、checkpoint、interrupt、resume 做成一等抽象。两者差异可以概括为：

| 维度 | AIPE `AgentScheduler` | LangGraph |
|------|------------------------|-----------|
| 工作流表示 | 内部 C++ 对象和任务列表 | 显式 graph/state/schema |
| 依赖推断 | 有 `inferImplicitDependencies` | 通常由图边/状态条件显式定义 |
| 并发 | 有 `setMaxConcurrency` | 由图结构和 runtime 控制 |
| 暂停/单步 | 有 pause/resume/stepNext | interrupt/checkpoint/resume 是核心语义 |
| 失败处理 | 有 cascadeFail/resetFailedDependencies | 可在图中显式建模 retry/fallback |
| 可测试性 | 依赖内部测试，外部难验证 | 图节点和状态 reducer 可单测 |
| 可视化 | 需要 AIPE 自己提供 | 图结构天然可视化 |
| 可移植性 | 绑定 AIPE | 可作为代码运行在多环境 |

AIPE 的优势是把研发专用动作做得更贴业务，例如 CMake 修复任务、LSP review、build verification、auto-fix；LangGraph 的优势是工作流语义清楚，可重放、可测试、可独立部署。

### 7.5 Agent 间协作：固定场景 Agent vs. Handoff/Graph/Subagent

AIPE 有多个场景 agent，但更像产品功能模块：

- `RequirementAgent` 负责需求
- `SolutionAgent` 负责方案
- `CodeAgent` / `DeveloperAgent` 负责代码
- `TestAgent` 负责测试
- `FigmaAgent` 负责设计稿
- `SkillAgent` 负责 skill 执行

主流框架里的 agent 协作通常更抽象：

- LangChain：agent 调工具，multi-agent 需要应用自行设计
- LangGraph：每个 agent 可以是图节点，handoff 是边和状态变化
- Claude SDK：更像一个成熟 coding agent harness，subtask/permission/session 由 SDK/CLI 语义承载
- OpenAI Agents SDK：handoff 是框架原语，agent 间转交和 tracing 更标准

AIPE 的风险是模块边界可能由 UI 和业务代码决定，而不是由清晰的 agent contract 决定。应要求其提供：

- 每类 agent 的输入/输出 schema
- agent 之间如何传递上下文
- 是否共享同一会话历史
- 是否共享同一模型和 system prompt
- evaluator agent 是否独立于 generator agent
- 任务失败时哪个 agent 负责恢复

### 7.6 调度闭环：研发专用 feedback 强，但标准 evaluator 边界不明

AIPE 的一个亮点是它把研发 feedback 做进调度器，而不是停留在“模型调用工具”层：

```text
Plan
  -> Task Dispatch
  -> Tool Execution
  -> File Save / Code Extraction
  -> Build Verification
  -> LSP Review
  -> AI Code Review
  -> Auto Fix
  -> Rerun / Re-extract / Cancel
```

这比 LangChain 常见示例更接近真实工程工作流。问题是 evaluator 边界不够透明：

- LSP review 是确定性反馈，可信度高
- Build verification 是确定性反馈，可信度高
- AI code review 如果和生成使用同一模型/上下文，就可能存在自评偏差
- Auto-fix 如果自动把 review 结果再喂给同一 agent，需要明确终止条件
- Re-extract code with AI 容易掩盖模型输出格式问题，需有失败计数和可审计原因

与主流框架相比：

- LangGraph 可以把 build、LSP、AI review、human approval 作为不同节点，并显式记录状态
- Claude SDK 更强调成熟 coding harness 的权限与会话体验
- OpenAI Agents SDK 更强调 trace、guardrails、handoff
- AIPE 更强调“把研发流程直接做完”，但需要补足“为什么每一步可信”的证明

### 7.7 可观测性：日志信号存在，但缺标准 trace 模型

AIPE 二进制中可见大量事件信号：

- `toolCallStarted`
- `toolCallFinished`
- `tokenUsageReported`
- `buildVerificationStarted`
- `buildVerificationCompleted`
- `codeReviewStarted`
- `codeReviewCompleted`
- `buildFixStarted`
- `buildFixCompleted`
- `agentTaskWaitingForStep`
- `mcpRoutingCompleted`

这些说明它具备做 tracing 的基础。但还需要确认是否能导出标准化 trace：

- 每次模型请求的 provider、model、request id、token、latency
- 每次 tool call 的输入、输出、审批人、耗时、失败原因
- 每次文件修改的 diff、来源 agent、关联 task
- 每次调度状态迁移的 before/after
- 每次 build/LSP/review 的结果和阻断原因

OpenAI Agents SDK 和 LangSmith/LangGraph 在这方面的优势是“trace 是框架概念”；AIPE 如果只是 UI 日志，则不足以支撑生产审计。

### 7.8 小结：AIPE 的差异化与短板

AIPE 的工具系统和调度系统比一般 LangChain 示例更接近生产研发场景，尤其在 GitLab/MCP/RAG/Build/LSP/业务平台集成上更完整。但它的短板也来自同一个选择：一切都是内部自研和产品内置。

| 方面 | AIPE 优势 | AIPE 短板 |
|------|-----------|-----------|
| 工具系统 | 内置丰富，贴合公司研发工具链 | schema、权限、trace 不够外显 |
| 本地执行 | 文件/命令/build/LSP 打通 | `write_file`/`bash_exec` 风险高 |
| 调度 | 有依赖、并发、暂停、重跑、review、auto-fix | 状态机和 checkpoint 不透明 |
| 多模型 | 多 provider 与多协议适配 | tool calling 兼容层复杂 |
| 业务集成 | GitLab、蓝鲸、Bkrepo、PMS、钉钉、Figma | 平台锁定，可移植性低 |
| 治理 | 有授权/拒绝逻辑 | 缺声明式组织策略和标准审计导出 |

引入时应把 AIPE 当作“内部 agent 平台”评审，而不是当作“用了某个成熟开源框架的应用”评审。评审重点应从“功能是否多”转向“工具权限、调度状态、失败恢复、trace、数据流是否可证明”。

---

## 8. Harness Engineering 评估

| 原则 | AIPE 静态证据 | 评分 | 主要风险 |
|------|---------------|------|----------|
| Feedforward + Feedback | 有 system prompt、skills、MCP discovery、build verification、LSP review、AI review、auto-fix | 4/5 | 需要证明失败是否硬阻断，而非仅展示 |
| Computational > Inferential | 有构建、LSP、路径检查、命令拦截、SQLite 索引 | 3/5 | 确定性检查是否强制执行不明 |
| Progressive Disclosure | 有 RAG、工具路由、MCP service routing、context compaction | 3/5 | 工具/schema/prompt 注入边界不透明 |
| Ratcheting from Failures | 有 SkillExtractor、SkillAuditor、session reflection、memory entries | 3/5 | 是否从失败自动沉淀规则不明 |
| Generator-Evaluator Separation | 有 CodeAgent/TestAgent/AI review/LSP review/auto-fix 分层 | 3/5 | 是否同模型同上下文自评不明 |
| State Management | 有 SQLite、chat sessions、skills、mcp_configs、kb、function graph | 4/5 | checkpoint/replay/跨设备/多人协作语义不明 |
| Permission & Safety | 有目录授权、路径逃逸拒绝、危险命令拦截 | 3/5 | `bash_exec`/`write_file` 权限过高，需审计与沙箱 |
| Observability | 有 token 统计、日志、tool started/finished 信号 | 2/5 | 未见标准 trace、span、审计导出 |

总评：**25/40**。方向正确，工程覆盖面较强，但引入前必须补透明度和治理能力。

---

## 9. 关键风险清单

### 9.1 数据与模型通道风险

- 受管模型服务会收到 prompt、代码上下文、工具结果、可能的文件上传
- 账号型模型通道可能通过个人或组织账号发送代码上下文
- embedding 通道可能发送需求、skills、会话文件、项目文档 chunk
- 本地 proxy 通道可能绕过统一治理

必须要求平台方提供：

- 数据流图
- 模型路由策略
- 日志保留策略
- 脱敏策略
- 文件上传白名单
- 是否训练/留存/转发给第三方
- 组织级账号型模型服务使用合规说明

### 9.2 权限与执行风险

- `bash_exec` 可以执行 shell 命令
- `write_file` 可以改代码
- MCP 可接入任意外部 tool server
- GitLab token、MCP API key、OAuth token、DingTalk app secret 等会被本地保存

必须要求：

- 默认只读模式
- 按项目授权
- 高风险工具默认关闭
- 命令 allowlist / denylist
- 每次工具调用 trace
- token 加密存储说明
- 组织策略集中下发

### 9.3 自研框架风险

- 无开源社区审计
- 无标准 LangGraph checkpoint 语义
- 无公开 DSL/schema 保证工作流稳定
- 二进制内嵌大量 prompt 与业务逻辑，版本升级难审查
- 需要内部团队长期维护多模型协议差异

必须要求：

- 架构设计文档
- 任务状态机
- tool schema 文档
- prompt 版本管理
- 回归评测集
- 失败案例库
- 安全审计报告

---

## 10. 引入建议

### 10.1 当前建议

不建议直接全员推广到主仓研发流程。建议作为 **受控试点工具** 引入：

- 选择低敏仓库
- 默认禁用 `bash_exec` 和 `write_file`
- 先启用只读分析、RAG、需求拆分、代码问答
- 开启完整工具调用日志
- 禁止个人账号型模型通道处理公司敏感代码，除非组织合规已确认
- 明确所有模型请求走受管控内部网关

### 10.2 试点评估指标

| 指标 | 目标 |
|------|------|
| 任务成功率 | 是否显著高于直接使用主流 coding agent 或 IDE AI 助手 |
| 误改率 | AIPE 自动写入代码后需要人工回滚的比例 |
| 验证闭环 | 修改后是否自动运行 build/test/lint/LSP |
| 上下文命中率 | RAG/代码索引是否真的减少误解 |
| 工具安全 | 是否发生未预期文件访问、命令执行、外网访问 |
| 数据合规 | 是否能证明代码片段与文件上传路径 |
| 可观测性 | 每次 agent 决策、工具调用、模型请求是否可追溯 |

### 10.3 对 AIPE 团队的必答问题

1. 账号型模型通道使用个人账号还是组织账号？公司代码是否允许进入该通道？
2. 受管模型服务后面实际路由到哪些模型供应商？日志保留多久？
3. 文件上传能力什么时候触发？会上传哪些文件？
4. Embedding 请求是否全部经过公司受控服务？是否可配置为内网 embedding 服务？
5. SQLite DB 存储位置在哪里？是否加密？token 如何加密？
6. `bash_exec` 的 sandbox 是什么？是否能限制网络、目录、环境变量？
7. `write_file` 是否有 diff 审批、回滚、保护分支策略？
8. AgentScheduler 的状态机是什么？失败后如何恢复？
9. 是否有 checkpoint/replay？用户关闭 App 后任务如何恢复？
10. 是否有标准 tracing？能否导出一次任务的完整模型请求、工具调用、文件改动和验证结果？
11. Prompt 和 tool schema 是否版本化？升级后如何回归测试？
12. 是否有红队测试和 prompt injection 防护？

---

## 11. 结论

AIPE 的真实技术实现比用户手册显示的更完整：它已经具备本地 agent runtime、模型适配、多 agent 调度、MCP、RAG、代码索引、构建验证、LSP review、auto-fix、skills 提取与审计等关键 harness 元件。

但它不是主流开源 agent 框架，而是内部 C++ 自研框架。这带来两面性：

- 正面：可以深度适配公司内部研发系统，形成端到端协作平台
- 负面：安全性、可靠性、可观测性、可恢复性、跨工具可移植性都无法借助开源生态背书

最终判断：

```text
技术方向：值得继续评估
架构类型：自研 C++ Agent Harness，不是 LangChain/LangGraph 封装
Claude Code 关系：高概率参考其 coding harness 范式；可能参考设计思想；未见源码级派生证据
模型通道：受管模型服务 + 账号型模型服务 + embedding + local proxy
引入策略：只读低敏试点 -> 安全/合规/trace 过审 -> 再开放写入和命令执行
生产主仓：当前不建议直接全量引入
```

如果 AIPE 团队能补齐架构文档、数据流、权限模型、trace、checkpoint、评测集和安全审计，它有潜力成为内部研发协作的统一 harness；否则，它更适合作为低风险辅助分析工具，而不应成为生产代码修改链路的默认入口。

---

## 12. 参考资料

- OpenAI, "Harness Engineering" — `https://openai.com/ms-BN/index/harness-engineering/`
- LangChain Docs, "Overview" — `https://docs.langchain.com/oss/javascript/langchain/overview`
- LangGraph Docs, "Overview" — `https://docs.langchain.com/oss/python/langgraph/overview`
- LangGraph Docs, "Durable execution" — `https://docs.langchain.com/oss/python/langgraph/durable-execution`
- Anthropic Docs, "Claude Agent SDK overview" — `https://docs.claude.com/en/docs/agent-sdk/overview`
- Claude Code Docs, "Agent SDK TypeScript" — `https://code.claude.com/docs/en/agent-sdk/typescript`
- Claude Code Docs, "Overview" — `https://code.claude.com/docs/zh-CN/overview`
- Claude Code Docs, "Tools reference" — `https://code.claude.com/docs/zh-CN/tools-reference`
- Claude Code Docs, "Subagents" — `https://code.claude.com/docs/zh-CN/sub-agents`
- Claude Code Docs, "Agent teams" — `https://code.claude.com/docs/zh-CN/agent-teams`
- Claude Code Docs, "Skills" — `https://code.claude.com/docs/zh-CN/skills`
- Claude Code Docs, "Hooks" — `https://code.claude.com/docs/zh-CN/hooks`
- Claude Code Docs, "MCP" — `https://code.claude.com/docs/zh-CN/mcp`
- Claude Code Docs, "Memory" — `https://code.claude.com/docs/zh-CN/memory`
- Claude Code Docs, "Checkpointing" — `https://code.claude.com/docs/zh-CN/checkpointing`
- Claude Code Docs, "Agent loop" — `https://code.claude.com/docs/zh-CN/agent-sdk/agent-loop`
- OpenAI Platform Docs, "Responses API" — `https://platform.openai.com/docs/api-reference/responses/create`
- OpenAI Platform Docs, "Agents SDK" — `https://platform.openai.com/docs/guides/agents-sdk/`
- OpenAI Agents SDK, "Tracing" — `https://openai.github.io/openai-agents-python/tracing/`
- OpenAI Agents SDK, "Guardrails" — `https://openai.github.io/openai-agents-python/guardrails/`
