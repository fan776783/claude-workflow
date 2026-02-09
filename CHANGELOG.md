# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

| 旧约束 | 新约束 |
|--------|--------|
| 7 条强制规则 | 4 条关键约束 |
| 严格步骤顺序 | 灵活执行 |
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
- **templates/prompts/claude/**：移除 6 个未使用的角色提示词文件

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
- **templates/prompts/claude/**：移除未使用的 6 个角色提示词文件（analyzer/architect/debugger/optimizer/reviewer/tester）

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
- **交互式菜单**：无参数运行 `claude-workflow` 时显示交互式菜单（TTY 环境）
- **模块索引与扫描统计**：`/scan` 命令新增 `modules` 和 `scanStats` 字段
- **specs 模板目录**：新增 `templates/specs/shared/` 和 `templates/specs/workflow/`
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
- CLI 工具 `claude-workflow`
- 命令：`sync`, `init`, `status`, `doctor`
- 模板目录：`commands`, `agents`, `utils`, `prompts`
- 自动 postinstall 安装
- 版本升级智能合并（3-way merge）
- 用户修改冲突检测（`.new` 文件）
