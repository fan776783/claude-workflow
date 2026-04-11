# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- **figma-ui 资源分诊前移**：将 figma-ui 的资源处理从“编码后按 `usedAssets` 收口”重构为“编码前 Asset Triage + AssetPlan”
  - `get_design_context` 后新增 `file-list-diff` / `newlyDownloadedFiles` / `assetMapping` 语义，显式限定当前任务下载资源范围
  - 编码阶段只消费 `inline` / `promote` 结果，不再把后置 `usedAssets` 作为唯一资源锚点
  - 复合图形识别前移为编码前强制检查，发现错误粒度子图层时先回退到父节点重导出
  - 明确 `assetsDir/.figma-ui/tmp/<taskId>` 与 `.claude/cache/figma-ui/{nodeId}/design.png` 的职责边界
- **figma-ui / visual-diff 文档契约收敛**：统一截图缓存与视觉门槛的描述
  - `figma-tools.md` 不再把 `get_screenshot` 写成 figma-ui 常规主流程
  - `visual-review.md` 的交付门槛统一为 `visualFidelity ≥ 90`
  - `visual-diff` 明确仅复用设计截图缓存，不继承 figma-ui 任务级临时资源语义
- **diff-review impact-aware 审查升级**：将 `diff-review` 从基础 Quick / Deep 审查重构为 impact-aware review workflow
  - 新增共享审查管线：review subject 解析、candidate finding discovery、finding verification、impact analysis、severity calibration、report synthesis、impact-aware review loop
  - Quick / Deep 模式统一接入 verification + impact analysis，不再直接从 diff 跳到最终 findings
  - Deep 模式改为“Codex / Claude 候选问题发现 → 当前模型统一裁决”，禁止将外部模型意见原样视为最终报告
  - 新增 `core/skills/diff-review/specs/impact-analysis.md` 与 `core/skills/diff-review/specs/report-schema.md`，沉淀影响性分析与报告结构 contract
  - Review Loop 强化为 impact-aware remediation：P0/P1 问题必须附带 `Fix Scope`、`Regression Verification` 与复审重点
- **模板源码布局重构**：将模板主载荷统一迁移到 `core/`
  - 原 `core/{commands,skills,prompts,utils,specs,hooks,docs,project,CLAUDE.md}` 调整为 package root 结构，源码布局与 Agent 落地目录解耦
  - `scripts/validate.js`、测试路径、README、CLAUDE 与模板文档同步切换到新的 package root 路径
- **安装投影策略重构**：停止把通用目录直接挂到外部 Agent 根目录
  - `skills/*` 继续逐项挂载到各 Agent 原生 `skills/`
  - commands 改为挂载到 `commands/agent-workflow/`
  - `prompts/utils/specs/hooks/docs/project` 改为挂载到各 Agent 的 `.agent-workflow/` 命名空间
- **repo-link / canonical 状态兼容升级**：`status`、`doctor` 与安装元数据适配新布局
  - 新增 package-root 级 `sourceRoot` 归一化，兼容旧 repo-link 元数据自动识别到 `core/`
  - `installForAgents()` 与 `linkRepoToAgents()` 统一基于 package root 投影
  - `doctor` 在 repo-link 模式下改为检查 package root，并给出与当前模式一致的恢复建议
- **analyze 合同内聚**：将 `core/prompts/codex/analyzer.md` 迁移到 `core/skills/analyze/references/codex-analyzer.md`，并按当前 `/analyze` 的 `analysis_depth` / `codex_involvement` 契约重写为本地 skill 级分析合同
- **受管内部资源精简**：安装器、校验脚本、交互式安装摘要与文档同步移除 `project` / `prompts` 目录，`.agent-workflow/` 托管资源收敛为 `utils/specs/hooks/docs`
- **workflow-plan 基础设施预检拆分**：将 Git 检查、项目配置自愈、工作流状态检测从 `phase-0-code-analysis.md`（407→~230 行）提取为独立共享模块 `core/specs/workflow-runtime/preflight.md`，`/quick-plan` 等轻量命令可复用
- **workflow-plan Pattern Discovery + Confidence Score**：`phase-2-plan-generation.md` 新增 Step 4.8 Pattern Discovery（从 `analysisResult` 提取 Patterns to Mirror + Mandatory Reading）和 Step 4.9 Confidence Score（1-10 综合评分），Self-Review 增加 Pattern Faithfulness 和 No Prior Knowledge Test 检查项
- **workflow-execute Pattern Mirror 引用**：`execute-overview.md` Step 5（显示任务上下文）新增 Patterns to Mirror 和 Mandatory Reading 展示，执行前先读取源文件中的模式实现确保风格一致
- **workflow-execute Git Branch Detection**：`execute-overview.md` 新增 Step 1.5 Git 分支检测（建议性），在 `main`/`master`/`develop` 上执行时建议创建 feature branch
- **专项技能目录与文档索引收敛**：移除 `/analyze` 后，同步更新 README、CLAUDE 与工作流指南中的技能数量、能力说明与命令示例

### Fixed

- **figma-ui 相关文档漂移**：修正主 skill、reference 与 shared spec 之间对资源目录、截图缓存和验证门槛的表述不一致
- **重复 link 时的已存在目录处理**：`createSymlink()` 现在会正确处理已存在的目录/符号链接，避免重链时因 `pathExists()` 跳过删除而导致挂载失败
- **Claude Code 新布局兼容**：重新执行 `agent-workflow link -a claude-code` 后，`status` 可正确识别 `repo-link` 模式与 14/14 skills 状态
- **历史路径引用清理**：修复模板文档、指南和部分实现说明中的旧 `core/*` 与 legacy workflow 路径，统一指向 `core/*`
- **无效 docs 清理**：移除不再被运行时、README、模板或 CLI 引用的历史分析/方案文档，保留仍有实际安装与排障价值的 `docs/worktree-hooks.md`

### Removed

- **历史遗留目录清理**：删除运行时无活跃消费者的 `core/project/` 与 `core/prompts/` 目录，避免继续分发无效托管资源

## [4.1.0] - 2026-04-02

### Changed

- **workflow 模块化拆分**：原单体 `workflow` skill 拆分为 4 个专项 workflow skills + 共享运行时
  - `workflow-plan`：承接 `/workflow start` 的规划阶段（Phase 0 ~ Phase 2）
  - `workflow-execute`：承接 `/workflow execute` 的执行阶段（治理、验证、审查、状态推进）
  - `workflow-review`：承接两阶段审查协议（Stage 1 Spec 合规 + Stage 2 代码质量），由 execute 内部质量关卡触发
  - `workflow-delta`：承接 `/workflow delta` 的增量变更（需求 / PRD / API 变更影响分析与同步）
  - 共享运行时迁移到 `core/specs/workflow-runtime/`（状态机、共享工具、外部依赖语义）
  - 共享模板迁移到 `core/specs/workflow-templates/`（spec / plan 模板）
  - 统一 CLI 保留在 `core/utils/workflow/workflow_cli.js`
- **workflow command 入口**：`core/commands/workflow.md` 作为稳定路由层，将 start / execute / delta / status / archive 路由到对应的 workflow skills 或共享运行时
- **文档全面更新**：
  - `Claude-Code-工作流体系指南.md` 升级至 v12.0.0，反映模块化拆分架构与 14 个 skill 目录
  - `README.md` 更新 workflow 目录结构可视化、skills 分类（专项 skills / workflow 子 skills / 基础设施 skills）
  - Skills 列表新增 `collaborating-with-codex`（Codex App Server 运行时委派）

### Added

- **`collaborating-with-codex` skill**：通过 Codex App Server 运行时委派编码、调试与代码审查任务，支持多轮会话（`--session-id`）、后台作业（`--background`）、内置审查（`--review`）与对抗式审查（`--adversarial-review`）
- **`agents.md` command 更新**：新增 `bug-batch`、`dispatching-parallel-agents`、`visual-diff` 到快速选择索引

### Technical Details

- Skills 目录从 10 个增长到 14 个（含 4 个 workflow-\* 子 skills）
- 每个 workflow 子 skill 采用 `SKILL.md`（入口）+ `references/`（概览）+ `specs/`（详细规格）的渐进披露结构
- 共享运行时资源通过相对路径引用，避免重复定义

---

## [4.0.0] - 2026-03-25

> 基于 2026-03-25 的仓库提交整理。

### Added

- **workflow 需求追溯体系**：新增 Requirement Baseline（Phase 0.55）、Traceability Review 参考文档与对应模板，强化从需求到 `spec`、`plan`、`tasks` 的可追溯链路
- **workflow 新规划工件与阶段**：新增 `phase-1.2-spec-review.md`、`phase-1.3-spec-generation.md`、`phase-1.4-spec-user-review.md`、`phase-2-plan-generation.md`、`phase-2.5-plan-review.md`、`phase-3-task-compilation.md` 等规划阶段规格文件
- **bug-batch 补充参考文档**：新增分析编排与状态汇报参考文档，并补充 `agents/openai.yaml`
- **新 CLI 入口**：新增 `bin/agent-workflow.js`，统一包级命令入口

### Changed

- **workflow 执行质量关卡升级**：将 `codex-review` 调整为更通用的 `quality-review`，并明确其作为 shared review loop contract 的 execution adapter，同步更新执行总览、执行模式与状态机文档
- **workflow 规划流程重构**：`start` 主线升级为“需求结构化 → Requirement Baseline → Brief → tech-design → Spec / Traceability Review → User Spec Gate → Intent Gate → plan → Plan Review → tasks”的分层流程
- **workflow 治理模型细化**：planning side 显式区分 `machine_loop`、`human_gate` 与 `conditional_human_gate`，execution side 通过 `quality_gates.*` 对齐 shared review loop contract
- **质量关卡术语与状态描述优化**：将部分“评分机制”调整为“判定机制”，细化当前任务、并行组、第三方依赖等状态与约束说明
- **安装与架构文档更新**：README、CLAUDE、工作流指南等文档改为强调 canonical + 受管链接架构、`agent-workflow` 单一源和新的同步方式
- **安装器与同步流程更新**：installer、interactive-installer、postinstall 与 agent 检测逻辑同步新 CLI 名称和受管挂载流程
- **debug / bug-batch 文档增强**：补充执行状态、修复单元、批量分析与流转说明
- **workflow 模板更新**：技术设计、Spec、Plan、Requirement Baseline、Brief、review-loop 与 state-machine 模板统一对齐新的追溯、治理关口和 execution quality gate 结构

### Removed

- **perf-budget skill**：移除 `core/skills/perf-budget/` 下的 skill 文档、脚本与相关资源，精简项目结构

---

## [3.4.1] - 2026-03-10

### Fixed

- **sync 命令增量合并**：修复已存在目录时新增 skill 无法同步的问题

### Changed

- **版本号体系统一**：workflow skill 不再维护独立版本号（原 v3.5.0/v3.4.0），统一跟随包版本
- **工作流体系指南文档更新**：补充 3.4.0 执行纪律强化和需求讨论阶段等新特性说明

---

## [3.4.0] - 2026-03-10

### Added

- **执行纪律强化**：借鉴 Superpowers 项目 8 项核心机制，全面提升执行阶段质量保障
  - **两阶段代码审查**：质量关卡升级为 Stage 1（规格合规，当前模型）+ Stage 2（代码质量，Codex subagent），问题分 Critical/Important/Minor 三级，共享 4 次总预算
  - **结构化调试协议**：任务失败重试前强制四阶段调试（根因调查 → 模式分析 → 假设验证 → 实施修复），连续 3 次失败触发 Hard Stop
  - **TDD 执行纪律**：实现指南存在时，implement 阶段任务强制 Red-Green-Refactor 循环
  - **自审查步骤**（Step 6.6）：`create_file`/`edit_file` 任务在验证通过后执行单次建议性自审查，永不阻塞
  - **审查反馈处理协议**：READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT
  - **验证门控函数**：IDENTIFY → RUN → READ → VERIFY → ONLY THEN claim
- **需求分析讨论阶段**（Phase 0.2）：在代码分析后、需求结构化提取前新增交互式需求讨论
  - 自动识别 Gap：基于代码分析结果检测需求中的模糊点、缺失项和隐含假设
  - 逐个澄清：每次只问一个问题，优先选择题，支持跳过和结束
  - 方案探索：存在互斥实现路径时，提出 2-3 种方案供对比选择
  - 结构化工件：讨论结果持久化为独立 JSON，不修改原始需求
  - 可跳过：`--no-discuss` 标志或简短明确的内联需求自动跳过
- **specs/execute/actions/codex-review.md**（334 行）：两阶段代码审查详细实现规格
- **specs/start/phase-0.2-requirement-discussion.md**（638 行）：需求讨论阶段详细实现规格
- **references/review-feedback-protocol.md**（92 行）：审查反馈处理协议

### Changed

- **state-machine.md**：新增 `TaskRuntime`、`QualityGateResult` 接口定义和 `task_runtime`/`quality_gates`/`discussion` 状态字段
- **execute-overview.md**：`codex_review` action 升级为两阶段审查；新增 Step 6.6 自审查；重试模式增加结构化调试协议
- **execution-modes.md**：重构重试模式实现，集成 per-task runtime state 和 Hard Stop 机制
- **start-overview.md**：新增 Phase 0.2 需求讨论阶段流程
- **SKILL.md**：新增特性说明和 `--no-discuss` 参数
- **phase-1-tech-design.md**：集成讨论工件到技术设计
- **phase-2-task-generation.md**：任务生成考虑讨论结果

---

## [3.3.4] - 2026-02-24

### Changed

- **文档更新**：全面更新项目文档以反映 Skills 体系架构
  - 更新 README.md：强调 Skills 体系、多 Agent 支持、可移植性
  - 更新 CLAUDE.md：详细说明 canonical + managed-links 架构和 10 个可用 Skills
  - 更新 package.json：描述改为"AI 编码工具通用工作流系统"
  - 更新 CLI 帮助文本：移除旧的 commands/agents 引用
  - 更新 core/CLAUDE.md：修正 prompts 路径为 canonical 位置

### Improved

- **架构说明**：清晰展示 Skills 目录结构（workflow, scan, analyze, fix-bug 等 10 个 skills）
- **多工具支持**：文档明确说明支持 Claude Code, Cursor, Codex, Gemini CLI 等 10+ AI 编码工具
- **关键词优化**：添加 skills, multi-agent, code-review, testing, figma 等关键词

### Technical Details

- 移除对旧架构（commands/agents 直接复制到 ~/.claude/）的引用
- 强调新架构：~/.agents/agent-workflow/ 作为 Single Source of Truth
- 所有 AI 工具通过 symlink 共享同一套 Skills

---

## [3.3.3] - 2026-02-24

### Changed

- **workflow skill 文件结构优化**：重构大文件为模块化结构，符合 Progressive Disclosure 原则
  - `start.md` (2492 行) → `start-overview.md` (288 行) + 6 个 specs 文件
  - `execute.md` (2064 行) → `execute-overview.md` (281 行) + 2 个 specs 文件
  - `delta.md` (550 行) → `delta-overview.md` (355 行) + 2 个 specs 文件
  - `SKILL.md` 优化导航结构，提供分层引用（核心流程概览 + 详细实现规格）

### Added

- **specs/start/** 目录：Phase 0-2 详细实现规格
  - `phase-0-code-analysis.md` (202 行) - 代码分析详情
  - `phase-0.5-requirement-extraction.md` (263 行) - 需求结构化提取详情
  - `phase-0.6-acceptance-checklist.md` (437 行) - 验证清单生成详情
  - `phase-1-tech-design.md` (422 行) - 技术方案生成详情
  - `phase-1.5-intent-review.md` (249 行) - 意图审查详情
  - `phase-2-task-generation.md` (512 行) - 任务清单生成详情
- **specs/execute/** 目录：执行流程详细实现规格
  - `execution-modes.md` (448 行) - 执行模式详情（单步/阶段/连续/重试/跳过）
  - `helpers.md` (616 行) - 辅助函数详情
- **specs/delta/** 目录：增量变更详细实现规格
  - `impact-analysis.md` (596 行) - 影响分析详情
  - `api-sync.md` (627 行) - API 同步详情

### Improved

- **文档可读性**：所有 overview 文件 < 400 行，specs 文件 < 700 行
- **导航体验**：清晰的分层结构，用户可从概览快速了解流程，需要时再深入查看详细规格
- **维护性**：每个文件职责单一、聚焦，便于后续更新和扩展

### Technical Details

- 文件数量：3 个大文件 → 14 个聚焦文件
- 最大文件：2492 行 → 627 行
- 平均文件：~1700 行 → ~380 行
- 架构模式：混合方案（overview + specs 分离）

---

## [3.3.2] - 2026-02-24

### Added

- **workflow Phase 0.6 验证清单生成系统**：将结构化需求自动转换为可执行的验收清单
  - 7 类验证项生成：表单字段、角色权限、交互行为、业务规则、边界场景、UI展示、功能流程
  - 任务关联映射：根据 phase/file/requirement 自动匹配验收项
  - 验收标准定义：Must Pass（必须满足）和 Should Pass（建议满足）
  - 生成位置：`.claude/acceptance/{name}-checklist.md`
- **验证清单模板**：`core/docs/acceptance-checklist-template.md`
- **验证清单文档**：
  - `core/skills/workflow/references/acceptance-checklist.md` - 系统说明文档
  - `core/docs/acceptance-checklist-guide.md` - 使用指南（7 种常见场景 + 验收测试模板）

### Changed

- **任务清单增强**：新增 `验收项` 字段，列出关联的验收项 ID（如 `AC-F1.1, AC-P1.2`）
- **技术方案增强**：需求详情章节（1.1-1.9）展示结构化需求的表格化视图
- **规划完成提示**：显示验证清单路径和统计信息
- **workflow SKILL.md**：更新描述，说明 v3.3.2 新增验证清单生成系统

### Technical Details

- 新增核心函数：
  - `generateAcceptanceChecklist()` - 将 RequirementAnalysis 转换为 AcceptanceChecklist
  - `mapTaskToAcceptanceCriteria()` - 任务与验收项智能匹配
  - `renderAcceptanceChecklist()` - 渲染验证清单为 Markdown
- 新增接口定义：
  - `AcceptanceChecklist` - 验证清单数据结构
  - `FormValidation`, `PermissionValidation`, `InteractionValidation` 等 7 个验证项类型
- 代码行数：~1,500 行新增代码

---

## [3.3.1] - 2026-02-24

### Added

- **workflow Phase 0.5 需求结构化提取**：在代码分析与技术方案生成之间新增条件执行阶段
  - 9 维度深度扫描：变更记录、表单字段、角色权限、交互规格、业务规则、边界场景、UI 展示规则、功能流程、数据契约
  - 仅对文件来源且长度 > 500 的需求执行，内联需求/短文本自动跳过（向后兼容）
  - 覆盖率验证：PRD 行数 vs 提取条目数，空维度警告
  - 产物自动注入 tech-design.md 的 `## 1.x 需求详情` 章节
- **Codex reviewer 需求对齐检查**：新增 Requirement Alignment checklist，技术方案审查时验证 PRD 覆盖率（Coverage < 80% 阻断评分）
- **tech-design-template v2**：模板升级，新增 `{{requirement_detail_sections}}` 占位符，表格类占位符从行级改为集合级（`{{related_files_table}}`、`{{implementation_plan}}`、`{{risks}}`）

### Fixed

- **Markdown 表格渲染安全**：新增 `esc()` 辅助函数，对所有 9 维度表格单元格内容转义管道符和换行符，防止 PRD 原文破坏表格结构
- **workflow SKILL.md 描述**：`<action>` 去除尖括号避免 YAML 解析歧义

---

## [3.3.0] - 2026-02-12

### Added

- **bug-batch Skill**：新增批量缺陷修复 Skill，从蓝鲸项目管理平台拉取缺陷清单，按优先级逐个独立修复
  - 支持经办人、状态、优先级筛选
  - 每个缺陷在独立 agent 上下文中使用 debug 流程修复，避免上下文污染
  - 包含 Hard Stop 确认机制和汇总报告
- **scan 蓝鲸项目关联**：`/scan` 新增 Part 1.5 蓝鲸项目关联流程
  - 自动调用 `search_projects` 匹配蓝鲸项目
  - 将 `bkProjectId` 写入 `project-config.json`
- **CLI init bkProjectId**：`agent-workflow init` 生成的配置新增 `workflow.bkProjectId` 字段

### Changed

- **debug Skill 精简重构**：从双模型并行诊断改为当前模型直接修复 + 单模型审查
  - 流程从 5 Phase 简化为 4 Phase（检索分析 → 确认方案 → 修复验证 → 模型审查）
  - 移除 Phase 2 双模型并行诊断，改为当前模型直接分析
  - 审查阶段按问题类型路由到 Codex（后端）或 Gemini（前端）单模型审查
- **skill-creator 目录迁移**：从 `core/skills/` 迁移到 `.claude/skills/`（项目级 skill，不再作为模板分发）
- **工作流体系指南更新至 v7.0.0**：新增 visual-diff、bug-batch 章节，Skills 数量从 7 更新为 10

---

## [3.2.0] - 2026-02-09

### Changed

- **diff-review Deep 模式强制执行**：明确 Deep 模式必须通过 `codeagent-wrapper` 并行调用 Codex 和 Gemini，禁止跳过外部模型调用而由 Claude 单独完成审查
- **figma-ui 上下文优化**：移除主动调用 `get_screenshot` 的逻辑，避免图片大量消耗上下文（20-50k tokens）导致溢出，仅在用户明确要求时才调用截图
- **README 格式规范化**：统一 markdown 表格对齐、列表前空行等格式

---

## [3.1.0] - 2026-02-05

### workflow v3.1 - Delta 统一入口

**核心变更**：用 `/workflow delta` 替代 `/workflow unblock`，统一处理所有外部规格变更。

#### Added

- **delta 命令** (`references/delta.md`)：统一入口处理需求更新、API 变更
  - 无参数：执行 `pnpm ytt` 同步全部 API
  - `.md` 文件：PRD 更新
  - `Api.ts` 文件：API 规格变更，自动解除 `api_spec` 阻塞
  - 其他文本：需求描述
- **external-deps.md**：外部依赖系统文档，明确职责分离原则
- **平台检测** (`execute.md`)：自动检测 Claude Code / Cursor / Windsurf / Augment 平台能力
  - 智能决策是否启用 subagent 模式
  - 支持上下文压力 + 任务数量双重触发条件

#### Changed

- **figma-ui 还原度门控提升**：visualFidelity 阈值从 85 提升到 90
  - 通过：≥90（原 ≥85）
  - 需审查：≥80（原 ≥75）
  - 请求指导：<80（原 <75）
- **figma-ui 复合图形识别**：新增指南，避免误提取叠加图层的子节点
- **workflow 设计理念**：明确职责分离（workflow 功能 → figma-ui 视觉 → visual-diff 验证）

#### Removed

- **unblock 命令** (`references/unblock.md`)：功能合并到 delta 命令

---

## [2.3.0] - 2026-02-04

### figma-ui v3.0 - 轻量化重构

**核心理念转变**：从"过程控制者"转向"质量守门人"

#### Changed

- **SKILL.md 精简重构** (-237 行，从 457 行减至 320 行)
  - 移除 STRICT MODE 强制步骤约束
  - 简化为轻量 3 阶段：设计获取 → 自由编码 → 验证修复
  - 编码阶段给予最大自由度，验证阶段严格把关

#### Removed

- `references/chrome-validation.md` (-231 行) - Chrome 验证流程已内联
- `references/data-structures.md` (-220 行) - 数据结构定义已简化

#### Added

- `references/figma-tools.md` - MCP 工具速查表
- `references/visual-review.md` - 视觉审查维度详解（间距/颜色/字体/布局/可访问性）
- `references/troubleshooting.md` - 故障排查指南

### skill-creator - 新增 Skill

集成 Anthropic 官方 skill-creator，用于创建和管理 Claude Skills。

#### Added

- `skill-creator/SKILL.md` - Skill 创建指南（核心原则、渐进披露、6 步创建流程）
- `skill-creator/scripts/init_skill.py` - 初始化新 Skill 模板
- `skill-creator/scripts/package_skill.py` - 打包 Skill 为 .skill 文件
- `skill-creator/scripts/quick_validate.py` - 快速验证 Skill 结构
- `skill-creator/references/output-patterns.md` - 输出模式设计指南
- `skill-creator/references/workflows.md` - 工作流模式设计指南
- `skill-creator/LICENSE.txt` - Apache 2.0 许可证

#### 关键约束简化

| 旧约束          | 新约束                         |
| --------------- | ------------------------------ |
| 7 条强制规则    | 4 条关键约束                   |
| 严格步骤顺序    | 灵活执行                       |
| 多个 CHECKPOINT | 单一门控 (visualFidelity ≥ 85) |

---

## [2.2.0] - 2026-02-03

### Fixed

- **figma-ui Skill**：修复 A.2.2 步骤因目录不存在导致 Figma MCP 调用失败的问题
  - 新增 `mkdir -p` 确保 `dirForAssetWrites` 目录存在
  - Figma MCP 不会自动创建目录，需显式创建

---

## [2.1.0] - 2026-02-02

### Breaking Changes

- **Commands → Skills 架构迁移**：所有核心命令从 `commands/` 迁移到 `skills/` 目录
  - `/workflow-start` → `/workflow start`
  - `/workflow-execute` → `/workflow execute`
  - `/workflow-status` → `/workflow status`
  - `/workflow-retry-step` → `/workflow execute --retry`
  - `/workflow-skip-step` → `/workflow execute --skip`
  - `/workflow-unblock` → `/workflow unblock`
  - `/workflow-backend-start` → `/workflow start --backend`

### Added

- **Skills 架构**：8 个 Skill 支持 references 渐进加载
  - `workflow/` - 智能工作流（含 6 个 references）
  - `analyze/` - 双模型分析（含场景路由 reference）
  - `debug/` - 多模型调试
  - `diff-review/` - 代码审查
  - `scan/` - 项目扫描
  - `write-tests/` - 测试编写
  - `figma-ui/` - UI 还原（新增 references 目录）
  - `perf-budget/` - 性能预算（新增）
- **渐进披露机制**：Skill 核心 SKILL.md 保持精简，详细实现按需加载 references

### Changed

- **agents.md 精简**：从 289 行精简到 106 行，仅保留 Skill 索引
- **figma-ui 重构**：747 行精简版，新增 references 模块化
- **workflow Skill v3.0**：
  - 统一入口 `/workflow <action> [args]`
  - 新增 `archive` action 归档已完成工作流
  - 自然语言控制（"单步执行"、"继续"、"重试"）

### Removed

- **13 个独立命令文件**：
  - `workflow-start.md`、`workflow-execute.md`、`workflow-status.md`
  - `workflow-retry-step.md`、`workflow-skip-step.md`、`workflow-unblock.md`
  - `workflow-backend-start.md`
  - `analyze.md`、`debug.md`、`diff-review.md`
  - `scan.md`、`write-tests.md`
- **废弃文档**：
  - `workflow-optimization-v4.md`
  - `backend-fasj-spec.md`、`backend-xq-spec.md`
  - `subagent-mode.md`
- **废弃工具模板**：
  - `auto-init-check.md`、`config-loader.md`、`project-detector.md`

---

## [2.0.0] - 2026-01-26

### Breaking Changes

- **Multi-Model Collaboration System v3.0**：架构重大简化
  - 移除 `triple` 协作模式，仅保留 `none`/`single`/`dual` 三种模式
  - 外部模型输出定义为"脏原型"，所有交付代码必须由当前模型重构
  - 新增质量阈值：单模型评分 < 6 拒绝采用

### Added

- **Workflow v2.1**：约束系统 + Zero-Decision 审计 + 渐进披露
- **动态多模型协作**：根据任务类型智能路由（后端→Codex，前端→Gemini，全栈→并行）
- **上下文感知**：自动检测任务复杂度选择协作模式
- **四维评估体系**：正确性、完整性、一致性、可维护性
- **交叉验证流程**：双模型输出独立评估 + 契约一致性检查 + 冲突解决策略
- **specs 模板**：新增 `context-awareness.md`、`pbt-properties.md`、`subagent-routing.md`

### Changed

- **Global Protocols 重构**：从冗长描述改为 8 条简洁系统约束
- **协作架构清晰化**：当前模型作为全栈编排者，Codex（后端权威）+ Gemini（前端高手）并行协作
- **工作流简化**：5 个清晰 Phase（上下文检索 → 协作分析 → 原型获取 → 编码实施 → 审计交付）
- **figma-ui skill v2**：7 阶段 → 5 阶段，双 Subagent 并行，Token-First 策略，Gemini 多模态 QA

### Removed

- **core/prompts/claude/**：移除 6 个未使用的角色提示词文件

---

## [1.2.11] - 2026-01-23

### Changed

- **Multi-Model Collaboration System v3.0**：重大架构简化
  - **协作模式精简**：移除 `triple` mode，专注于 `none`/`single`/`dual` 三种模式
  - **Global Protocols 重构**：从冗长描述改为简洁的系统约束清单（8 条核心约束）
  - **协作架构清晰化**：当前模型作为全栈编排者，Codex（后端权威）+ Gemini（前端高手）并行协作
  - **工作流简化**：5 个清晰 Phase（上下文检索 → 协作分析 → 原型获取 → 编码实施 → 审计交付）
  - **动态路由**：根据任务类型智能选择协作模式（后端→Codex，前端→Gemini，全栈→并行）
  - **评估维度明确化**：新增正确性、完整性、一致性、可维护性四维度评估
  - **质量阈值**：单模型评分 < 6 拒绝采用，契约不一致以 Codex API 为准

### Removed

- **core/prompts/claude/**：移除未使用的 6 个角色提示词文件（analyzer/architect/debugger/optimizer/reviewer/tester）

---

## [1.2.10] - 2026-01-13

### Changed

- **figma-ui skill v2 优化版**：重大架构升级，提升效率与可靠性
  - **阶段合并**：7 阶段 → 5 阶段（Phase 0+1 合并为并行初始化）
  - **并行 Subagent**：Phase 1 使用双 Subagent 并行执行，返回精炼 JSON，上下文节省 ~80%
  - **Token-First 策略**：优先使用 Design Token 而非硬编码值，消除技术债务
  - **任务隔离目录**：`assetsDir/.figma-ui/tmp/<taskId>/` 避免并发任务资源污染
  - **可恢复状态机**：新增 `WorkflowState` 接口 + 检查点保存/恢复机制
  - **Gemini 多模态 QA**：Phase 5 获取 Figma 设计截图进行视觉对比审计
  - **结构化 JSON 输出**：Phase 3/4/5 所有模型输出强制为 JSON Schema
  - **视觉属性补充**：新增 z-index、opacity、backdrop-filter、overflow、object-fit 检查
  - **资源安全清理**：路径前缀验证 + 整目录清理（O(1) 安全操作）
  - **错误处理策略**：单模型失败重试 + 用户选择降级策略

### Fixed

- **文档一致性**：修复阶段编号混乱（6/7 phases）、规则编号重复、三/双模型措辞不一致

---

## [1.2.9] - 2026-01-09

### Changed

- **figma-ui skill 重构**：从三模型协作改为 **Gemini + Claude 双模型协作**
  - 移除 Codex 参与（后端专长不适用于 UI 还原任务）
  - Gemini：UI 样式、视觉还原、响应式设计、可访问性、交互状态
  - Claude：组件 API、类型定义、代码组织、整合、最佳实践
- **新增 6 阶段工作流**：
  - Phase 0: 参数验证与资源路径获取
  - Phase 1: 上下文全量检索（auggie-mcp）
  - Phase 2: 收集设计信息（Figma MCP）
  - Phase 3: 双模型协作分析 + Hard Stop 用户确认
  - Phase 4: 双模型原型获取 + 交叉验证
  - Phase 5: 编码实施
  - Phase 6: 双模型审计与交付
- **新增强制规则**：
  - 上下文检索不可跳过
  - 用户确认不可跳过（"Shall I proceed with this plan? (Y/N)"）
  - 双模型原型生成不可跳过
  - 双模型审计不可跳过

---

## [1.2.8] - 2026-01-08

### Added

- **交互式菜单**：无参数运行 `agent-workflow` 时显示交互式菜单（TTY 环境）
- **模块索引与扫描统计**：`/scan` 命令新增 `modules` 和 `scanStats` 字段
- **specs 模板目录**：新增 `core/specs/shared/` 和 `core/specs/workflow/`
- **Linux ARM64 支持**：新增 `codeagent-wrapper-linux-arm64` 二进制

### Changed

- **diff-review 重构**：合并 `diff-review-deep.md`，默认多模型并行审查，`--quick` 单模型快速审查
- **installer 路径处理**：
  - 新增 `replaceHomePathsInTemplate()` 替换 `~/` 为绝对路径，解决 Windows 多用户环境问题
  - 使用函数式 replacer 避免 `$` 字符触发特殊语义
  - 保留符号链接和文件权限
- **sync -f 备份机制**：强制同步时备份冲突文件到 `backups/force-sync-{timestamp}/`

### Removed

- `diff-review-deep.md`：功能合并到 `diff-review.md`
- `workflow-fix-bug.md`：移除未使用的命令

---

## [1.2.7] - 2026-01-08

### Added

- **figma-ui skill**：重命名自 `workflow-ui-restore`，Figma 设计稿到代码的自动化工作流
  - **资源追踪机制**：使用 `assetMapping` 追踪所有下载的资源（包括重命名失败的）
  - **文件对比**：调用 Figma MCP 前后对比文件列表，精准识别新下载的资源
  - **hash 文件支持**：正确处理 Figma 下载的 hash 格式文件（如 `7f48...svg`）
- **CLAUDE.md Figma 规则**：新增强制调用 `figma-ui` skill 的触发条件
- **debug 命令影响性分析**：新增 Phase 3.5
  - 依赖链分析（使用 codebase-retrieval）
  - 数据流追踪（共享状态检查）
  - 测试覆盖检查
  - 回归风险评估（🔴高/🟡中/🟢低）

### Fixed

- **资源清理遗漏**：修复未重命名的资源文件在清理时被忽略的 bug
- **Glob 模式匹配问题**：改用 `assetMapping` 追踪替代 `${componentName}-*.*` 模式匹配

### Changed

- `workflow-ui-restore` → `figma-ui`：skill 重命名，更直观的命名
- 资源重命名函数接收 `newlyDownloadedFiles` 参数，只处理本次下载的文件

---

## [1.2.6] - 2026-01-07

### Added

- **细粒度阶段定义**：将原有 5 个阶段扩展为 9 个，避免单个 phase 任务过多导致上下文溢出
  - `design`: 接口设计、架构设计、类型定义
  - `infra`: Store、工具函数、指令、守卫
  - `ui-layout`: 页面布局、路由、菜单配置
  - `ui-display`: 展示组件（卡片、表格、列表）
  - `ui-form`: 表单组件（弹窗、输入、选择器）
  - `ui-integrate`: 组件集成、注册、组装
  - `test`/`verify`/`deliver`: 保持不变
- **连续任务数限制**：兜底机制，连续执行超过 5 个任务时强制暂停
- **state.consecutive_count**：追踪当前会话连续执行的任务数

### Changed

- `workflow-start.md` 和 `workflow-execute.md` 的 `determinePhase`/`extractPhaseFromTask` 函数同步更新
- 暂停时提示新开会话避免上下文压缩

---

## [1.2.5] - 2026-01-07

### Fixed

- **P0 路径穿越漏洞**：新增 `resolveUnder()` 统一路径安全函数，防止 `../` 路径穿越攻击
- **P0 正则捕获 emoji 丢失**：修复 `extractCurrentTask()` 正则，正确处理标题中的状态 emoji
- **P0 Subagent 失败处理**：添加 try/catch + JSON 解析，采用 fail-closed 策略
- **P1 phase 定义不一致**：统一阶段语义定义
- **P1 quality_gate 解析硬编码**：使用 `parseQualityGate()` 统一解析
- **P1 emoji 处理硬编码**：使用 `STATUS_EMOJI_REGEX` 统一处理
- **P2 failed.push 无去重**：使用 `addUnique()` 替代直接 push
- **P2 extractSection 正则注入**：使用 `escapeRegExp()` 转义

### Added

- **use_subagent 自动设置**：任务数 > 5 时自动在 workflow-state.json 中设置 `use_subagent: true`
- **共享工具函数**：`resolveUnder`, `escapeRegExp`, `getStatusEmoji`, `parseQualityGate`, `addUnique`

### Changed

- 同步修复到 `workflow-status.md`, `workflow-retry-step.md`, `workflow-skip-step.md`

---

## [1.2.3] - 2026-01-06

### Changed

- **移除 agents 目录**：将 `vitest-tester` 指令内嵌到 `/write-tests` 命令，移除未使用的 `requirements-analyst` 和 `senior-code-architect`
- 简化模板结构，`TEMPLATE_DIRS` 从 7 个减少到 6 个

---

## [1.2.2] - 2026-01-06

### Fixed

- **git_commit 安全加固**：使用临时文件 `git commit -F` 替代 heredoc，避免 shell 注入；新增用户确认对话框
- **run_tests 可配置化**：从 `project-config.json` 读取测试命令，未配置则跳过（不再硬编码 `npm test`）
- **tech_design 路径校验**：新增 `validateTechDesignPath()` 防止路径穿越攻击
- **cwd 引号修复**：`codeagent-wrapper` 调用中 `${process.cwd()}` 添加双引号，支持含空格路径
- **状态数组去重**：新增 `addUnique()` 函数，防止 `completed/failed/skipped` 数组累积重复项
- **$ 替换 token 修复**：`updateTaskStatusInMarkdown()` 使用 replacer 函数，避免状态文本中的 `$` 被误解析
- **任务提取正则宽松化**：允许 `<!-- id: -->` 注释前后有可选空格，提高手动编辑 `tasks.md` 的容错性

### Changed

- 工作流模板 v1 → v2 重构（简化状态管理）

---

## [1.1.2] - 2026-01-05

### Changed

- 同步 ccg-workflow 更新
- 更新 installer 逻辑

---

## [1.1.1] - 2026-01-05

### Changed

- 更新 debug 命令模板
- 同步 ccg 更新

---

## [1.1.0] - 2026-01-05

### Changed

- 同步 ccg 更新
- 更新 review 和 analyze 命令

---

## [1.0.5] - 2025-12-16

### Changed

- **CLAUDE.md 重构**：重新组织工作流阶段和资源矩阵
- 删除过时的 docs 模板文件（7个）
- 从 `TEMPLATE_DIRS` 移除 `docs` 目录

---

## [1.0.4] - 2025-12-10

### Added

- **diff-review 命令**：新增 `diff-review-deep.md` 和 `diff-review-ui.md`
- 增强 workflow 模板结构

### Changed

- 更新 `workflow-start.md` 结构
- 增强 `init-project-config.md` 配置

---

## [1.0.3] - 2025-12-03

### Added

- **上下文管理**：工作流上下文恢复（`/clear` 后自动恢复）
- **内存跟踪**：智能上下文清理检测
- **内存更新助手**：需求、决策、问题的更新函数
- **工作流系统指南**：新增文档

### Changed

- 升级项目配置模板到 v2.0.0：
  - 新增 `domain`, `preferences`, `decisions`, `workflowDefaults` 字段
  - 新增 `ownerTeam` 到项目元数据
- 步骤新增 `context_policy` 和 `context_needs_chat` 字段
- 更新 README 私有仓库安装说明

---

## [1.0.2] - 2025-12-01

### Added

- **后端工作流支持**：`workflow-backend-start.md` 命令
- 初始版本发布

---

## [1.0.0] - 2025-12-01

### Added

- 初始项目结构
- CLI 工具 `agent-workflow`
- 命令：`sync`, `init`, `status`, `doctor`
- 模板目录：`commands`, `agents`, `utils`, `prompts`
- 自动 postinstall 安装
- 版本升级智能合并（3-way merge）
- 用户修改冲突检测（`.new` 文件）
