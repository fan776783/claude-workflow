# AIPE vs. 主流 AI Coding Harness 框架对比审查

> 审查日期：2026-05-08
> 对比对象：AIPE 1.0.0.73、Superpowers v5.1、Trellis v0.5.6、Everything Claude Code (ECC)、agent-workflow v6.0.9
> 方法论基线：Harness Engineering（Martin Fowler、Addy Osmani、Anthropic Engineering、agentskills.io）
> 数据来源说明：AIPE 部分基于 DMG 静态解包与 Mach-O 字符串/符号分析（未运行应用），辅以用户手册和 Claude Code 源码抽样比对

---

## 1. Harness Engineering 核心原则

Harness Engineering 的基本等式：**Agent = Model + Harness**。Harness 是模型之外的一切——系统提示、工具、上下文管理、记忆、权限、反馈回路、Hook、沙箱、编排逻辑和验证机制。

> "A decent model with a great harness beats a great model with a bad harness." — Addy Osmani

### 1.1 六大设计原则

| 原则 | 含义 | 来源 |
|------|------|------|
| **Feedforward + Feedback** | 行动前引导（guides/specs）+ 行动后传感（tests/linters） | Martin Fowler |
| **Computational > Inferential** | 能确定性检查的绝不用 AI 推断；同样结果出两次就应该自动化 | talkthinkdo.com |
| **Progressive Disclosure** | 分层加载上下文：metadata（~100 token）→ 指令（<5000）→ 资源（按需） | agentskills.io |
| **Ratcheting from Failures** | 每条规则可追溯到一次具体失败；系统从错误中"棘轮式"收紧 | Addy Osmani |
| **Generator-Evaluator Separation** | 做事的 agent 和评审的 agent 必须分离，避免自评偏见 | Anthropic |
| **Prose → Automation** | 文本规则的终态是成为确定性检查或代码生成器 | talkthinkdo.com |

### 1.2 五类结构性失败模式

| 失败模式 | 表现 |
|----------|------|
| **Context Starvation** | Agent 缺少做正确决策所需的信息 |
| **Constraint Absence** | 无护栏阻止破坏性或偏离轨道的行为 |
| **Feedback Vacuum** | Agent 无法观察自身行为的后果 |
| **Memory Loss** | 一个会话学到的经验在下个会话消失 |
| **Context Anxiety** | 上下文填满时模型草率收尾（Anthropic 发现） |

---

## 2. 五方框架定位

| 维度 | AIPE | Superpowers | Trellis | ECC | agent-workflow |
|------|------|-------------|---------|-----|----------------|
| 定位 | 内部研发协作桌面 Agent Harness（C++/Qt 自研） | 方法论驱动的质量系统 | 团队 AI 协作 wiki 层 | Hook 驱动的性能系统 | 状态机驱动的工程工作流 |
| 核心哲学 | 端到端研发协作 + 内部系统深度集成 | "没有测试就没有代码" | "上下文注入取代记忆" | "Agent-First + 持续学习" | "代码主权 + 审批门禁" |
| 目标用户 | 内部研发团队全角色（研发/测试/PM） | 追求质量的个人开发者 | 多人团队 | 多语言全栈开发者 | 中高级全栈开发者 |
| 平台支持 | 1（自身 macOS 桌面 App） | 8 | 14 | 5（Claude Code/Codex/Cursor/OpenCode/Gemini） | 9 |
| 状态机 | 自研 AgentScheduler：submitPlan → schedule → pause/resume/stepNext → cascadeFail/rerun/cancel | 无（git-as-state） | 3 态 | 无（Hook 生命周期驱动） | 7 态 |
| 质量约束 | 有 build verification + LSP review + AI code review + auto-fix 闭环；但门禁是否硬阻断不明 | 铁律（不可违反） | required·once 标记 | Hook 硬拦截（exit 2 阻断） | HARD-GATE + 铁律 |
| 规模 | 7 个场景 Agent + 多内置工具 + MCP + Skills + RAG | 14 skills | 6 skills | 182 skills + 48 agents + 68 commands | 30+ skills |
| 独特机制 | 自研调度引擎（依赖推断 + 并发 + build/LSP/review/auto-fix 反馈闭环）、多模型 tool calling 协议适配、SkillExtractor/SkillAuditor 自动提取 | TDD 应用于方法论本身 | per-turn breadcrumb 注入 | 持续学习（自动从会话提取 skill） | Codex 双模型协作 |

---

## 3. AIPE 与 Harness Engineering 原则的对比分析

以下基于 DMG 静态解包的源码分析，逐原则评估 AIPE 现状。每项给出"已具备 / 局限 / 对标框架差异"三层判断。

| 原则 | AIPE 已具备 | 局限 | 对标差异 |
|------|------------|------|----------|
| **Feedforward + Feedback** | Skills 三级注入 + build/LSP/AI review/auto-fix 多层反馈链 | 门禁是硬阻断还是软建议不透明（内嵌二进制） | ECC/agent-workflow 用 Hook exit code 硬拦截；Superpowers 有铁律不可违反 |
| **Computational > Inferential** | build verification、LSP diagnostics、路径逃逸拒绝、`isDangerousCommand` 拦截 | 确定性检查的触发/阻断策略不可外部配置 | ECC 的 PreToolUse hook 可声明式配置；agent-workflow CLI 做确定性状态转换 |
| **Progressive Disclosure** | RAG 按需检索 + ToolRouter 按任务选工具 + ContextCompactor 压缩 | 无声明式上下文配置（jsonl manifest / 环境变量控 token） | Trellis 用 jsonl manifest；ECC 用 modular profiles + 环境变量限 token |
| **Ratcheting from Failures** | SkillExtractorAgent + SkillAuditorAgent + session reflection + MemoryManager 三级记忆 | 是否从失败案例自动编入约束不明 | Superpowers 每条规则追溯到具体失败；ECC continuous-learning 自动 ratchet |
| **Generator-Evaluator Separation** | CodeAgent(生成) + AI review + LSP review + TestAgent 多层分离；多模型可分配 | evaluator 是否用不同模型实例/上下文不透明 | ECC 48 专用 reviewer agent + 模型分级；agent-workflow 主模型 + Codex 独立审查 |
| **State Management** | SQLite 持久化（代码索引/会话/skills/MCP/RAG）；AgentScheduler 管理 pause/resume/rerun | checkpoint/rewind 语义不明；跨设备同步未见证据 | agent-workflow 7 态状态机 + JSON resume；ECC SQLite + hook 三阶段恢复 |
| **跨工具可移植性** | MCP 标准协议可迁；Skills 格式与 agentskills.io 相似 | GUI 绑定，runtime/RAG/调度/业务集成均不可独立使用 | ECC/Superpowers/agent-workflow 跨 5-14 平台；skill 定义可移植 |
| **Permission & Safety** | 目录授权 + 路径穿越拒绝 + 危险命令拦截 + tool approval | 运行时逻辑，非声明式策略；无 OS 级 sandbox | Claude Code 有 allow/ask/deny DSL + Seatbelt sandbox |
| **Observability** | `toolCallStarted/Finished`、`tokenUsageReported`、build/review 事件信号 | 无 OpenTelemetry 标准导出；UI 日志级别，非生产审计 trace | Claude Code OTel；OpenAI Agents SDK tracing 一等公民 |

---

## 4. AIPE 技术架构与特有优势

### 4.1 架构概览

静态分析揭示 AIPE 是完整的自研 Agent Harness（非 LangChain / LangGraph / AutoGen 等框架封装）：

```text
Qt/QML GUI
  -> AIServer（中央编排：模型切换、工具刷新、MCP 路由、token 统计）
    -> Model Adapters
       -> 受管模型服务 / 账号型模型服务 / embedding 服务 / local proxy
    -> Agent Runtime
       -> AgentManager / AgentScheduler / AgentSession
       -> DeveloperAgent / CodeAgent / RequirementAgent / SolutionAgent / TestAgent / FigmaAgent / SkillAgent
    -> Tool Runtime
       -> AIToolHandler / BuiltinToolExecutor / ToolRouter
       -> read_file / write_file / bash_exec / GitLab / MCP / RAG / Build / LSP
    -> State
       -> SQLite: files/classes/functions/function_calls/chat/skills/mcp_configs/kb_chunks/kb_embeddings
```

### 4.2 与 Claude Code 的关系

基于 Claude Code 源码抽样比对，AIPE 很可能参考了 Claude Code / Claude Agent SDK 的 coding harness 范式（agent loop、tool permission、subagent、context compaction 等设计思想），但未见源码级仿制证据。更合理的判断是：**基于 Claude Code 类产品经验做了 C++/Qt 内部平台化重实现**。

| 对比点 | Claude Code | AIPE |
|--------|-------------|------|
| 技术栈 | TypeScript / React / CLI / SDK | C++ / Qt / QML / SQLite / 桌面 App |
| 主循环 | `query()` / `queryLoop()` 递归处理 tool result | `AIServer` + `AgentSession` + `AgentScheduler` |
| 工具命名 | `Read`、`Write`、`Edit`、`Bash`、`Agent` | `read_file`、`write_file`、`bash_exec`、业务/MCP/RAG 工具 |
| 权限 | 声明式 allow/ask/deny + `Tool(specifier)` | 运行时目录授权 + 路径逃逸拒绝 + 危险命令拦截 |
| 上下文 | compaction + sidechain + CLAUDE.md 裁剪 | `ContextCompactor` + history trim + session reflection |
| 能力覆盖 | 核心 agent 能力 ~100% | ~50-65%（agent 内核强；治理/生态/SDK 弱） |

### 4.3 特有优势

| 优势 | 说明 |
|------|------|
| **零配置上手** | GUI 按钮操作，无需理解 YAML/markdown/CLI |
| **自研调度引擎** | AgentScheduler 具备依赖推断、并发控制、暂停/单步/重跑/级联失败、build/LSP/review/auto-fix 闭环 |
| **多模型 tool calling 适配** | 自研跨模型协议归一化（OpenAI-style、Claude-style、XML 风格、文本标签风格） |
| **深度内部系统集成** | GitLab 远程代码读取、蓝鲸/Bkrepo/PMS、钉钉、Figma 原生集成 |
| **Skills 生态** | SkillExtractorAgent 从会话自动提取 skill + SkillAuditorAgent 审计更新 |
| **需求到代码全链路** | /requirement 指令 + RequirementAgent + SolutionAgent 提供端到端流程 |
| **RAG + 代码索引** | 本地向量化 + 函数调用图 + 类/文件索引，增强上下文精度 |
| **组织级部署** | 作为平台产品，可统一推送给全团队 |

这些优势体现了 AIPE 在**端到端研发场景覆盖和内部系统集成深度**上的投入。它不是简单的 AI 聊天壳，而是有实质工程能力的 coding agent harness。

---

## 5. 工作流能力深度对比

工作流是 Harness Engineering 中最能体现"状态管理 + 质量门禁 + 失败恢复"综合能力的维度。五个框架在"需求 → 规划 → 执行 → 验证 → 交付"链路上的设计差异最为显著。

### 5.1 工作流生命周期模型

| 维度 | AIPE | Superpowers | Trellis | ECC | agent-workflow |
|------|------|-------------|---------|-----|----------------|
| **生命周期表示** | 内部 C++ 对象 + SQLite 任务列表 | 无显式生命周期（git commit = 状态） | 3 态：pending → active → done | Hook 生命周期（SessionStart → PreToolUse → PostToolUse → Stop） | 7 态状态机：spec_drafting → spec_approved → planned → running → paused → review_pending → completed |
| **状态持久化** | SQLite + AgentScheduler 内部状态 | git repo 本身 | `.trellis/tasks/` JSON 文件 | Hook 事件 + SQLite + `~/.claude/skills/` | `workflow-state.json` + artifact 文件 |
| **跨会话恢复** | 有 pause/resume 信号，但完整语义不明 | 无（每次会话从 git 状态重新推断） | workspace journal 支持恢复 | Stop hook 保存上下文；下次 SessionStart 恢复 | CLI `workflow-execute` 从任意中断点恢复；state.json 记录精确进度 |
| **失败处理** | `cascadeFail` + `resetFailedDependencies` + `rerunTask` | 人工判断后重跑 | escape hatch 允许跳过 | 无显式失败恢复（靠 human-in-loop） | `paused` 态 + 失败原因记录 + 人工确认后恢复 |
| **并发控制** | `setMaxConcurrency` + `inferImplicitDependencies` | 无（顺序执行） | 无 | 无显式并发（单 agent loop） | `dispatching-parallel-agents` skill 管理独立任务域并行 |

### 5.2 规划阶段对比

| 维度 | AIPE | Superpowers | Trellis | ECC | agent-workflow |
|------|------|-------------|---------|-----|----------------|
| **规划入口** | `/plan` 指令 + `startPlanning` + `WaitingPlanConfirm` | spec 文档（手写 markdown） | task.json 声明 | 无显式规划（直接执行） | `/workflow-spec`（需求规格）→ `/workflow-plan`（实施计划） |
| **规划审批** | 有 `WaitingPlanConfirm` / `EditingPlan` 信号 | 人工 review spec | 无显式审批 | 无 | **Hard Stop 审批门**：spec 必须人工确认后才能进入 plan；plan 必须确认后才能 execute |
| **规划粒度** | 任务级（`submitPlan` 提交任务列表） | 文件级（spec 描述要改哪些文件） | 任务级（task.json） | 无 | 双层：spec（需求规格 + 影响分析）+ plan（task 拆分 + 依赖图 + 验收标准） |
| **需求到任务** | RequirementAgent → SolutionAgent → 任务拆分 | 人工 | 人工 | 无 | `/workflow-spec` 自动分析需求 → 生成 spec → 审批 → `/workflow-plan` 生成 task 列表 |
| **变更管理** | 未见增量变更机制 | 修改 spec 后重跑 | 编辑 task.json | 无 | `/workflow-delta` 对已有 workflow 做增量影响分析并入 |

### 5.3 执行阶段对比

| 维度 | AIPE | Superpowers | Trellis | ECC | agent-workflow |
|------|------|-------------|---------|-----|----------------|
| **执行单元** | AgentScheduler 调度的 task（绑定场景 agent） | 单个 agent 按 spec 执行 | sub-agent 按 task.json 执行 | 单个 agent loop 执行到完成 | task（由 workflow-execute skill 驱动，可分派到 subagent） |
| **任务依赖** | `inferImplicitDependencies`（隐式推断） | 无（顺序） | 无（顺序或手动分组） | 无 | plan 中显式声明依赖；executor 按依赖图排序 |
| **执行反馈** | build → LSP → AI review → auto-fix 闭环 | 必须跑测试 + lint（铁律） | trellis-check sub-agent | PostToolUse hook 跑 typecheck/prettier | 验证铁律 + TDD 铁律 + diff-review |
| **中断/恢复** | pause / resume / stepNext（单步调试） | 无（一次性执行） | 无 | 无显式中断 | `paused` 态 + CLI resume + 精确到 task 的恢复点 |
| **回滚** | `undoFileChange` / `undoDocEdit` 信号 | git revert | 无 | 无 | `/git-rollback` skill（reset/revert 模式） |
| **并行分派** | setMaxConcurrency 控制并发数 | 无 | 无 | 无 | `/dispatching-parallel-agents` 识别独立任务域 → 多 worktree 并行执行 |

### 5.4 质量门禁对比

| 维度 | AIPE | Superpowers | Trellis | ECC | agent-workflow |
|------|------|-------------|---------|-----|----------------|
| **门禁类型** | build verification + LSP review + AI code review + auto-fix | 铁律（必须验证才能声称完成） | `required·once` 标记 | Hook exit 2 硬拦截 | HARD-GATE（状态转换阻断）+ 铁律（行为约束） |
| **确定性 vs 推理** | build/LSP 确定性；AI review 推理性 | 全确定性（测试/lint 必须通过） | 混合 | 全确定性（hook 只看 exit code） | 混合：CLI 状态转换确定性 + Codex review 推理性 |
| **门禁可配置性** | 内嵌二进制，外部不可配置 | 硬编码在 skill 中 | 标记在 task.json | Hook 脚本可自定义 | 状态机内置 + 铁律可扩展 |
| **自动修复** | `startAutoFix`（AI 自动修复 review 问题） | 无（人工修） | 无 | 无 | 无自动修复（修复必须经人工确认） |
| **Review 独立性** | AI review 是否独立模型不明 | implementer ≠ reviewer（子 agent 分离） | check sub-agent 独立 | 48 个专用 reviewer agent | Codex 独立审查（不同模型） |

### 5.5 端到端流程完整度

```text
需求分析 → 规格审批 → 计划拆分 → 执行 → 验证 → 审查 → 交付 → 归档

AIPE:        ████████   ██████     ████████   ████████  ████████  ██████    ░░░░    ░░░░
             Requirement  WaitPlan   Scheduler  Build/LSP AI Review  ？      ？       ？
             Agent        Confirm    dispatch   AutoFix

Superpowers: ░░░░░░░░   ████████   ░░░░░░░░   ████████  ████████  ████████  ████████ ░░░░
             (手动)      spec 文档   (无拆分)    铁律验证   subagent  subagent  git      (无)

Trellis:     ░░░░░░░░   ░░░░░░░░   ████████   ████████  ██████    ██████    ████████ ░░░░
             (手动)      (无)        task.json  sub-agent check     check     journal  (无)

ECC:         ░░░░░░░░   ░░░░░░░░   ░░░░░░░░   ████████  ████████  ████████  ████████ ░░░░
             (无)        (无)        (无)       Hook 验证  Hook 验证 reviewer  git      (无)

agent-wf:    ████████   ████████   ████████   ████████  ████████  ████████  ████████ ████████
             /spec       Hard Stop  /plan      /execute  铁律+TDD  /review   git+PR   /archive
```

### 5.6 关键差异总结

**AIPE 的工作流优势**：
- 唯一具备**自动依赖推断 + 并发控制 + 级联失败**的内置调度引擎
- 唯一将 **build → LSP → AI review → auto-fix** 做成自动闭环的框架
- RequirementAgent / SolutionAgent 提供需求到代码的端到端通道
- 单步调试（stepNext）能力独一无二

**AIPE 的工作流短板**：
- **状态机不透明**：AgentScheduler 的状态转换规则隐藏在 C++ 实现中，外部无法审计、测试或版本化
- **审批门禁语义弱**：有 `WaitingPlanConfirm` 但不是 agent-workflow 那种 Hard Stop（必须人工确认才能状态转换）
- **无增量变更管理**：没有 `/workflow-delta` 式的"已有计划遇到需求变化时做影响分析并入"
- **无归档**：任务完成后状态如何清理、经验如何沉淀不明
- **checkpoint 粒度不明**：有 undo 但不是每个用户提示点的完整快照

**agent-workflow 的工作流优势**（作为最完整的对照）：
- 7 态显式状态机，每个转换有明确的前置条件和 Hard Stop
- spec → plan 双层审批，确保不会在需求不明时就开始编码
- `/workflow-delta` 支持计划中途变更的增量并入
- `/workflow-archive` 完成后归档经验
- 跨会话精确恢复到中断的具体 task
- `/dispatching-parallel-agents` 对独立任务域做 worktree 级隔离并行

**ECC 的工作流特点**（不同路线）：
- 不走显式状态机，而是通过 Hook 生命周期 + 持续学习实现隐式工作流
- 182 个 skills 按需触发 = "微工作流"组合
- 优势是灵活、零配置；劣势是大型任务缺乏全局视图和恢复点

---

## 6. 结论

源码级静态分析表明 AIPE 不是普通的 AI 聊天壳或开源框架封装，而是一个**具备完整 agent 内核的 C++/Qt 自研 coding harness**，其核心架构最接近 Claude Code / Claude Agent SDK 范式。

与四个主流框架相比：

```
Harness 成熟度：ECC > agent-workflow ≈ Superpowers > Trellis > AIPE

              Prompt Template → AI Assistant → Agent Harness (内核) → Full Harness (可治理)
                    │                │                │                       │
                    │                │                │                       ├─ ECC
                    │                │                │                       ├─ agent-workflow
                    │                │                │                       ├─ Superpowers
                    │                │                │                       └─ Trellis
                    │                │                │
                    │                │                └─ AIPE（当前位置：内核成熟，治理外化不足）
                    │                │
                    │                └─ 基础 AI 编程助手
                    │
                    └─ 原始 ChatGPT/Copilot 补全
```

**各框架的核心差异化**：

| 框架 | 核心竞争力 | 弱项 |
|------|-----------|------|
| **ECC** | 规模（182 skills）+ Hook 自动化 + 持续学习 + 多语言 12 生态 | 无显式状态机；skill 数量庞大可能导致 token 压力 |
| **Superpowers** | 方法论纯度（铁律不可违反）+ 零依赖 + TDD 极致 | 无持久化状态机；无持续学习；跨会话靠人工判断 |
| **Trellis** | 团队协作（workspace journal）+ per-turn breadcrumb + 14 平台 | 质量约束可跳过（escape hatch）；skill 数量少 |
| **agent-workflow** | 7 态状态机 + 双模型协作 + 业务系统集成（钉钉/蓝鲸） | 学习曲线高；依赖 CLI 基础设施 |
| **AIPE** | 自研 agent 调度引擎 + 多模型 tool calling 适配 + 内部系统深度集成 + build/LSP/review/auto-fix 反馈闭环 | 治理不外化（声明式权限、标准 trace、checkpoint、sandbox 缺失）；平台锁定；无跨工具移植 |

**关键判断**：

1. **AIPE 的差距不是"功能少"**——它的 agent 内核、工具系统、调度器、状态持久化实际上相当成熟
2. **真正差距是"治理外化"**——安全策略、trace、权限模型、checkpoint 隐藏在二进制内部，外部无法审计和配置
3. **工作流维度**：AIPE 的调度引擎（依赖推断 + 并发 + auto-fix 闭环）比其他框架都更"产品化"，但缺乏显式状态机、Hard Stop 审批门禁和增量变更管理
4. **引入策略**：不应当作"不成熟的 AI 助手"拒绝，而应当作"内部 agent 平台"审计——要求团队证明权限、trace、数据流、失败恢复的工程基线
5. **与 Claude Code 的关系**：高概率参考其 coding harness 范式设计思想，但未见源码级派生证据

Harness Engineering 的本质洞见是：AI 编程的可靠性不来自更强的模型，而来自更好的约束系统。AIPE 已经具备约束系统的内核实现，接下来的挑战是让这些机制**可审计、可配置、可证明**。

---

## 7. 参考资料

- Martin Fowler, "Harness Engineering for Coding Agents" — martinfowler.com/articles/harness-engineering.html
- Addy Osmani, "Agent Harness Engineering" — addyosmani.com/blog/agent-harness-engineering/
- Anthropic Engineering, "Harness Design for Long-Running Apps" — anthropic.com/engineering/harness-design-long-running-apps
- agentskills.io Specification — agentskills.io/specification
- Jesse Vincent, Superpowers v5.1 — github.com/obra/superpowers
- Mindfold, Trellis v0.5.6 — github.com/mindfold-ai/trellis
- Affaan Mustafa, Everything Claude Code — github.com/anthropics/courses (ECC)
- claudecode-lab.com, "Claude Code Harness Engineering" — claudecode-lab.com/en/blog/claude-code-harness-engineering/
- talkthinkdo.com, "Harness Engineering for Coding Agents" — talkthinkdo.com/guides/harness-engineering-coding-agents/
- OpenAI, "Harness Engineering" — openai.com/ms-BN/index/harness-engineering/
- LangGraph Docs, "Durable execution" — docs.langchain.com/oss/python/langgraph/durable-execution
- Claude Code Docs, "Tools reference / Subagents / Agent teams / Skills / Hooks / MCP / Checkpointing" — code.claude.com/docs/
- OpenAI Agents SDK, "Tracing / Guardrails" — openai.github.io/openai-agents-python/
