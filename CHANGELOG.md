# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Added
- **二进制安装验证**：安装后运行 `--version` 验证 `codeagent-wrapper` 可执行
- **PATH 自动配置**：
  - macOS/Linux：询问用户是否自动配置 PATH，自动追加到 `~/.zshrc` 或 `~/.bashrc`
  - Windows：提供详细的图形界面步骤 + PowerShell 命令
  - 检测是否已配置，避免重复添加
- **安装状态跟踪**：`meta.json` 记录完整安装状态（模板、二进制、错误信息）
- **模板目录补全**：`TEMPLATE_DIRS` 增加 `specs` 和 `project` 目录

### Changed
- 优化配置文件创建顺序，确保即使安装失败也能记录状态
- 模板安装和二进制安装分别 try-catch，互不影响

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
