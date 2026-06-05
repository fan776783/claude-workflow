# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- **`workflow-execute` 收敛 lean + review 加固**（commit 17ca8c1）：task 源统一到 task-dir，`plan.md` 降为可选人类叙述；退役 `ContextGovernor`（`context_budget.js`）、`task_bundle.js`、`traceability.js` 及死引用，净 -1900+ 行。随收敛修 review 链路若干问题：plan-review 加 `spec_placeholder` 复检（approve 后 spec 被编辑引入占位时挡 ready）、`cmdSpecReview` 在 `firstTaskId` 为 null 时 fail-fast（不带空锚点推进 `planned`）、`task-write` 同 id 续写承接 `requirement_ids`（防整集替换静默丢 R-ID 链）、journal search 经 `diff_summary` 渲染 evidence summary（不再 `[object Object]`）。新增 6 回归用例。

### Fixed

- **release commit 纳入 `core/plugin.json`**（commit 3b59aea）：`sync-plugin-version.js` 同时写 `core/.claude-plugin/plugin.json` 与 `core/plugin.json`，但 `release.sh` 此前只 stage 前者，导致 `core/plugin.json` 的版本号漏提交。

## [6.6.5] - 2026-06-04

### Changed

- **`halt_reason` 收敛为单一 `failure`**（commit 1e7e4f7）：review-loop 上限、reviewer schema 非法等失败场景统一落 `halt_reason: 'failure'`，具体成因写入 `failure_reason`，不再单列独立 `halt_reason` 值；`state-machine.md` / `reviewer.md` / SKILL.md 同步，CLI 命令描述澄清 task 执行与恢复路径。
- **orphaned / completed task 锚点防护**（commit 2a5adc5）：`pre-execute-inject` 处理孤儿与已完成 task 锚点，避免 task 执行期静默失败；plan-review 增加 orphaned anchor 与空 `current_tasks` 检查，提升工作流管理鲁棒性。`CLAUDE.md` 补齐 prepublish 多测试套件说明。

## [6.6.4] - 2026-06-03

### Removed

- **移除 Gemini CLI 支持（支持工具数 9 → 8）**（commit 5b06707）：Gemini CLI 于 2026-06-18 停服并入 Antigravity CLI（`agy`），原 `gemini-cli` agent 移除。

### Changed

- **Antigravity 改为 Plugin-managed**（commit 5b06707）：走 `agy plugin install` 原生 Plugin 机制，与 Claude Code / Qoder 同属 **Plugin-managed**；installer-mount 类工具收缩为 5 个（Cursor / Codex / GitHub Copilot / OpenCode / Droid）。agent memory 分发同时落 `AGENTS.md` 与 `GEMINI.md`（后者作 Antigravity 的 memory 文件）。

### Added

- **执行前 task 源存在性校验**（commit 4244253）：新增 `assertExecutableTaskSourcePresent`，执行前校验 task 源存在，task-dir 缺失 / 非法时给出明确错误；pre-execute hook 阻断 v1 task-dir 并提示全量重 plan；`buildTaskContext` 的 task block 上限 3000 → 6000 字符以容纳更大 task 描述。

## [6.6.3] - 2026-06-03

### Added

- **`guard-engine-source.js` hook + task schema lint**（commit 28ba914）：新增 command hook 强化 task 执行控制；plan-review 增加 task schema 完整性 lint（校验合法 task ID、禁止空 task 源）；CLI 补齐写 task 与 curate context 的子命令。

### Changed

- **controller 禁止整篇读 `plan.md` / `spec.md`**（commit 28ba914）：SKILL.md 与 subagent-driven 文档明确 controller 不得 full-read `plan.md` / `spec.md`（改从 task-dir 读 task 切片），收紧 controller 对源码的访问约束。

## [6.6.2] - 2026-06-02

### Changed

- **`project-config.json` 位置契约**（commit 3964195）：明确项目配置文件必须位于 `<project-root>/.claude/config/project-config.json`（而非仓库根）；配置缺失 / 非法时 pre-check 给出正确引导，并提供一条 Bash 命令供用户一次性自检项目配置。

## [6.6.1] - 2026-06-02

### Added

- **`agent-workflow update` 命令**（commit 5142430）：全局安装场景一键 `npm i -g <pkg>@latest` + 重新 `sync` 重新分发到全部已检测工具；安装过程记住 npm registry 供后续 `update` 复用，免重复 `--registry`，并补齐安装 / 同步的错误处理。

## [6.6.0] - 2026-06-02

### Changed

- **机器 task 源迁移到 task-dir**（commit fcf9c5d）：机器可读 task 源由 `plan.md` 改为 **task-dir**（`tasks/{taskId}/` 下 `task.json` + `context.jsonl`），execute 期直接从 task-dir 读 task，不再解析 `plan.md` 抠 task block，提升性能并降低对 `plan.md` 的解析依赖；`plan.md` 退化为可选的人类可读叙述。

### Added

- **`halted` 状态 + `halt_reason`**（commit fcf9c5d）：状态机新增 `halted` 中断态，由 `halt_reason` 区分任务失败与依赖阻塞，旧的 `paused` / `blocked` / `failed` 收敛于此，简化错误处理与恢复流程。

## [6.5.1] - 2026-06-01

### Added

- **Qoder 工具支持（第 9 个 AI 编码工具，原生 Plugin 机制）**（commit ca5a22d + 73b21d4）：从 main 分支择优移植 Qoder 支持，走 `qodercli plugins install` 原生 Plugin，与 Claude Code 同属 **Plugin-managed**（非 installer 逐 skill mount），其余 7 个工具（Cursor / Codex / Gemini CLI / GitHub Copilot / OpenCode / Antigravity / Droid）继续走 installer。
  - 新增 `lib/qoder-plugin.js`（Qoder Plugin 安装/检测逻辑）与 `scripts/qoder-cli.js`（`qodercli` 命令封装）。
  - `lib/agents.js` 注册 `qoder` agent，标记 `managedViaPlugin`。
  - `bin/agent-workflow.js`：`sync` / `link` / `status` / `doctor` 四条命令接入 Qoder Plugin 分支。
  - 开发调试：`qodercli --plugin-dir <repo>/core`（对齐 Claude Code 的 `claude --plugin-dir`）。

### Changed

- **`managedViaPlugin` 通用化**（commit ca5a22d + 73b21d4）：原先散落在 `lib/installer.js` / `scripts/postinstall.js` / `lib/interactive-installer.js` 里对 `claude-code` 的特判改为统一按 `managedViaPlugin` 标记分叉，Claude Code 与 Qoder 共用同一条 Plugin 安装路径。
  - `lib/installer.js`：`linkToAgents` 跳过条件 `claude-code` → `managedViaPlugin` 通用化。
  - `scripts/postinstall.js`：`npm install` 时 Qoder 与 Claude Code 一致**不自动 mount**（避免落入 installer `success:false`），需用户显式 `sync` 触发 Plugin 安装。
  - `lib/interactive-installer.js`：新增 `qoderTargets` 分叉走 `ensureQoderPluginInstalled` + 结果展示块，对齐 `ccTargets`；修复交互式选 Qoder 显示 ✗ 失败、postinstall 永远装不上 Qoder 的问题。

## [6.5.0] - 2026-05-28

### Changed

- **`workflow-execute` 折叠为单一 lean 路径**（commit e319e7f / ADR 0004）：删 governor 决策（`decideGovernanceAction` / `decidePostExecutionAction` / `applyGovernanceDecision` / continuation）、删 per-task `quality_gates` 持久化、删 `review_pending` 中间态、删 `context_injection` runtime 重复块。每 task 模型面 CLI 往返 ~7 → ~2；落盘 `workflow-state.json` 从 ~22KB（`quality_gates` 主导）瘦到 ~3KB。reviewer PASS 仅内存确认，不再写 `state.quality_gates`。
- **末尾终审折叠进 execute Step 7（inline）**：controller 在所有 task `completed`/`skipped` 后**内联派 final reviewer subagent** 跑整 branch diff vs spec；末尾终审通过是进 `completed` 的**唯一门**（HARD-GATE #4）。跨 task 集成问题不自动回退 / 不擅改 state，issues 清单展示给用户后由用户决策 `另起修复回合` 或 `accept`。branch 级独立单审继续走 `/diff-review`。
- **状态机收缩到 `idle → spec_review → planned → running → completed`**：删 `review_pending`；execute 跑完即 `completed`，`halt_reason` 删 `governance`、保留 `failure` / `dependency` / `review-loop`。CLI（`workflow_cli.js status` / `context` / `advance` / `set-report-path` 退役）、hooks（`pre-execute-inject.js` 的 `halted+governance` 放行分支简化为 `status==='running'`）、`/workflow-status` / `/workflow-archive` 全量适配。
- **state schema 兼容（读时丢弃，不写 migration）**：老 `workflow-state.json` 含 `quality_gates` / `continuation` / `review_report_path` / `contextMetrics` 字段，`ensureStateDefaults` read-side normalize 时静默 `delete`，第一次读老 state 后写回即字段消失（与 ADR 0002 删 `parallel_groups` / `parallel_execution` 同手法）。
- **write-scope 软化**：implementer prompt prose 写明该 task 预期改动文件（取自 plan task `files`），越界自报 `DONE_WITH_CONCERNS` + reviewer 复核；删机器 hard-block（`allowed_write_paths` / `forbidden_actions` 强制）。
- **plan 上下文一次性读**：controller 进入 execute 后**一次性** Read 整篇 plan.md，内存里持有所有 task 切片（task block + acceptance + constraints + patterns + files），后续 per-task implementer / reviewer prompt 从内存切片构造，不再每 task 重读 plan 或调 `task-bundle` / `task_parser`（对齐 superpowers controller-持全-plan 范式）。
- **`dispatching-parallel-agents` 放宽到 writable fan-out**（commit 0016589 / ADR 0003）：原 ADR 0002 钉为「只读 only」的 dispatching skill 现允许多个 subagent 并行写——**硬前提是写文件集两两不相交 + 无共享状态**，零运行时基建（无 worktree-per-task、无 `merge_strategist`、无自动依赖图）。主会话回收后**必须** ① 用各 agent `files_changed` 做 conflict check（交集 = 误判 → 回退顺序重做）② 跑全量验证 ③ 统一 commit（subagent 不自行 commit，守代码主权）。subagent prompt 契约扩展 `allowed_write_paths` + 「禁止编辑其他 agent 文件」+ `files_changed` / `verification` 输出。**plan 执行仍顺序**（workflow-execute 主路径不接管 writable fan-out）。详见 `.claude/code-specs/adr/0003-relax-dispatching-to-writable-fan-out.md`。
- **`figma-data` 后台慢命令读取规则**（commit 00a7b2b）：补三条规则到 SKILL.md（Step 3 + Core Rules + Red Flags）——看到 `Command running in background with ID: … .output` 不是空结果，等完成通知后再 Read 那个 `.output`（或一开始就 `run_in_background: true`）；禁止 `sleep; wc -c` 轮询（会被 Blocked）、禁止重定向到 `/tmp` 或拆分并行；不改/不截断 URL。cmdDesign 实测 `await get_design_context → setTimeout(3000) → 才写 stdout`，过早 Read 会读到空。

### Removed

- **`/workflow-review` skill 整目录删除**（commit e319e7f / ADR 0004）：`core/skills/workflow-review/` 全部移除（含 `SKILL.md` + `references/cross-layer-checklist.md` / `depth-heuristics.md` / `review-feedback-protocol.md` / `scope-routing.md` / `stage1-code-specs-check.md` / `codex-spec-augmentation-checklist.md`）。`skill-routing-table.json` 移除该条目，glossary `review` 词条 See 改指 execute SKILL Step 7 末尾终审 / `/diff-review`。**移除 7 → 现 6 个 workflow 主线 skill**（`workflow-spec` / `workflow-plan` / `workflow-execute` / `workflow-delta` / `workflow-status` / `workflow-archive`）。
- **`execution_sequencer.js` governor 决策导出**：`decideGovernanceAction` / `decidePostExecutionAction` / `applyGovernanceDecision` 及 continuation 字段退役；`task_parser` / skip / retry 路径保留。
- **`quality_review.js` 持久化路径**：`pass` / `fail` 写 `state.quality_gates` 的逻辑退役（reviewer prompt 构造若被末尾终审复用则保留该部分）。
- **`workflow_cli.js set-report-path` 命令**：随 `review_report_path` 字段一起退役。
- **`workflow-execute references/implementation-report.md`** 与多份废 review reference：随 lean-execute 折叠一并删除。

## [6.4.10] - 2026-05-26

### Changed

- **`workflow-execute` implementer prompt patterns/mandatory reading 行号要求改为可选**（commit 79aa085）：`prompts/implementer.md` / `references/subagent-driven.md` / `workflow-plan` `plan-self-review.md` 明确行号为可选，允许 implementer 在缺行号时自主定位代码；`plan_composer.js` 的 `lintMandatoryReading` 改为「只在提供时校验格式」，空行号视为合规。配套 `tests/test_plan_composer.js` 新增空行号合规用例。
- **`core/specs/shared/glossary.md` Forbidden synonyms 收紧**（commit 4e82100）：`workflow` / `module` / `convention` / `delta` / `archive` 五个词条的 forbidden synonyms 重写并补 explanatory notes，区分专有术语与日常自然语言的同形词，避免误伤普通中英文用语；保留 `drift-check` lint 在 normative 文档上的强制扫描。

### Added

- **阶段交接 handoff 功能扩写**（commit b612371）：`workflow_cli.js` 的 `write-handoff` / `read-handoff` 子命令补齐场景覆盖，`plan_composer.js` 在 plan→execute 出口处自动写 handoff；`workflow-plan/references/no-placeholders.md` / `plan-self-review.md` 同步提示扩写 handoff 的检查点。`tests/test_workflow_cli.js` 扩 handoff 读写用例 35 行。

## [6.4.9] - 2026-05-25

### Added

- **工作流阶段交接（phase handoff）**：新增 `write-handoff` / `read-handoff` 两个 CLI 子命令（`core/utils/workflow/workflow_cli.js` + `path_utils.js` `getHandoffPath` + `task_runtime.js`），把 `spec→plan→execute` 相邻阶段的关键决策蒸馏成 `handoff/{from-phase}.md`（5 行 freshness header + ≤20 行正文，覆盖式写，**不入 state schema**）。写侧（`workflow-spec` approve 分支末尾、`workflow-plan` plan→execute）落 `## Decisions` / `## Rejected` / `## Risks` + 一行 contract-digest 指针；读侧（`workflow-plan` 上下文加载前）比对 header 与当前 state → 返回 `{fresh,content}` 或 `{fresh:false,reason:stale|missing,fallback:read-full}`，stale/missing **不阻断**、回退读全文 spec.md。语义边界：handoff 只装本阶段决策 / 取舍指针，不复写 spec.md 或 contract-digest.md 正文，读侧按指针回溯。
- **`buildTaskContext` 条件注入 `<task-contract>`**（`core/hooks/pre-execute-inject.js` + `task_runtime.js`）：按 task 类型与 contract-digest 可用性决定是否注入 `<task-contract>` 块，无契约任务不再被塞空块。
- **内部参考文档**（`docs/internal/`）：新增 `aipe-cargo-cult-coding.md` / `aipe-comparison-tables.md`，扩写 `aipe-vs-coding-harness-frameworks.md`，并补一份工作流重设计笔记。
- **测试**：`tests/test_workflow_cli.js` 扩 handoff 读写用例；新增 `tests/test_task_aware_injection.js` 覆盖 task-aware 上下文注入。

### Removed

- **`system-design` skill**（commit a625132）：删除 `core/skills/system-design/SKILL.md` 与 `core/specs/workflow-templates/spec-template.md` 的系统设计段落，并清理 `skill-routing-table.json` / `ux-elaboration` / `workflow-spec` / `workflow-plan` / `workflow-review` / `CLAUDE.md` / README / 中文指南中的引用。前端设计深化统一路由到 `ux-elaboration`（§4.4 Layout Anchors），后端 / 全栈不再走独立 system-design 阶段。

## [6.4.8] - 2026-05-25

### Changed

- 维护性版本号 bump（`core/.claude-plugin/plugin.json` + spec-template manifest 同步），无功能或行为变更。

## [6.4.7] - 2026-05-25

### Added

- **项目级三阶段研发流程·阶段一 & 阶段三**：新增 `design-plan` 与 `plan-archive` 两个 skill，独立于 workflow 状态机、手动触发，典型用户为技术主管 / 资深研发；阶段二各模块编码仍走 `/workflow-spec` `/workflow-execute`。
  - **`design-plan`**（`/design-plan <需求>`）：跨服务复杂需求 → 读项目级 docs（架构 / 术语 / 接口契约 / 硬约束）→ 起草 8 章节技术方案（接口 / 数据库 / 时序图 / 微服务变更清单 / 风险 / Hard Coding Rules 自检 / ADR 草稿）→ Hard Stop 评审 → 落盘 `docs/designs/{slug}-{YYYYMMDD}.md`。附 `references/design-plan-template.md` + `references/hard-coding-rules-checklist.md`。
  - **`plan-archive`**（`/plan-archive --design <path> --since <commit>`）：实施完成后跨服务跑 git log/diff → 对照 `AGENTS.md § Project Doc Update Triggers` 生成回写计划 → Hard Stop 预览每文件 diff + budget 自检 → 逐一写入 `docs/architecture/*` / `docs/contracts/*` / `docs/engineering/rules.md` / 项目总架构文档，必要时新建 ADR。附 `references/archive-checklist.md`。
  - `core/hooks/skill-routing-table.json` 注册两条 skill 入口。

### Changed

- **`scripts/validate.js` markdown 相对链接校验**：跳过 fenced code block 内的链接，并忽略含 `{` / `<` 占位符的目标路径，避免模板示例里的 `{slug}` / `{YYYYMMDD}` 等占位被误判为失效相对链接。

## [6.4.6] - 2026-05-25

### Changed

- **`scan` 技术栈探测**（`core/skills/scan/SKILL.md` + `scripts/detect-tech-stack.sh`）：`project-config.json` 结构按实际消费精简——删除未使用字段、明确生成约束；`ui-config.json` 适配 Tailwind v4 的版本与配置入口；`detect-tech-stack.sh` 准确识别 Tailwind 版本与配置（含 v4 结构变化）。
- **`scan/references/context-template.md` 结构化内容写作准则**：强调高密度 reference card，区分结构性事实与操作性内容，推动精简文档、避免冗余。

## [6.4.5] - 2026-05-23

### Added

- **多工具 hook 适配模板**（`core/hooks/agent-templates/`）：新增 `codex.hooks.json` / `copilot.hooks.json` / `cursor.hooks.json` 三套子模板，分别按 Codex / GitHub Copilot / Cursor 原生 hook schema 与事件名（`userPromptSubmitted` / `sessionStart` / `preToolUse` / `beforeShellExecution`）落地。`{{HOOKS_DIR}}` 占位由 installer 解析为各工具的 `.agent-workflow/hooks/` 绝对路径，模板侧不再写死 `$HOME`。
- **轻量化注入入口 `inject-workflow-state.js` / `inject-shell-session-context.js`**：从 `session-start.js` / `pre-execute-inject.js` 拆出，承担 Codex（UserPromptSubmit）与 Cursor（beforeShellExecution）的轻量化工作流状态 / shell session context 注入。原 Claude Code Plugin 走 `core/hooks/hooks.json` 不变，新模板专门覆盖非 Plugin 平台的 hook schema。
- **Hook 跳过 env 开关**（`core/hooks/_skip.js`）：`WORKFLOW_HOOKS=0` / `AGENT_WORKFLOW_DISABLE_HOOKS=1` / `CLAUDE_NON_INTERACTIVE=1` 任一命中 → 跳过 context 注入；**治理 gate 仍跑**（spec_review_gate、状态阻断等）。
- **`AGENT_WORKFLOW_FIRST_REPLY_NOTICE=1`**（`core/hooks/session-start.js`）：SessionStart 输出末尾追加 `<first-reply-notice>` 块，要求首轮回复用中文一句话宣告 hook 已注入。默认 OFF：strict-output 交互场景（首轮 JSON / patch / commit message）下避免污染输出。
- **Windows UTF-8 兼容**（`core/hooks/_utf8.js`）：hook 脚本统一 `require('./_utf8')`，把 stdin / stdout / stderr 流强制切到 UTF-8，消除中文 hook 输出在 Windows cmd / PowerShell 下的乱码与状态阻断。
- **`core/utils/workflow/workflow_types.js`**：新增 `getStatusMessages()` 统一各 hook 状态消息渲染来源；`task_runtime.js` / `path_utils.js` 同步补 helper，hook 不再各自重写 status text。
- **Installer schema migration**（`lib/installer.js` + `lib/__tests__/schema-migration.test.mjs` / `legacy-migrator.test.mjs`）：旧版 hook 配置（包含已废弃的 `notify.js` / `notify-backends.js` 引用）在 `sync` 时自动迁移；新增 lib 单测覆盖迁移路径，并在 `prepublishOnly` 接入 `npm run test:lib`。
- **HTML report reference**（`core/skills/improve-architecture/references/HTML-REPORT.md`）：补 improve-architecture HTML 输出格式约束，要求 candidate 列表给明确推荐而非模糊罗列。

### Changed

- **`session-start.js` 轻量化**（93 → 减半左右）：把 status 渲染、shell session context 注入下沉到 `inject-shell-session-context.js` / `workflow_types.js`，SessionStart 主体仅做项目识别 + 状态注入，降低频繁触发时的开销。
- **`pre-execute-inject.js` 调用栈精简**：复用 `inject-workflow-state.js` 同一份 task context 构造逻辑，避免 Plugin / 非 Plugin 平台之间漂移。
- **Skill 文档润色**（commit 78764a4）：
  - `handoff/SKILL.md`：新增交接文档敏感信息处理 guideline
  - `improve-architecture/SKILL.md`：candidate 评估准则收紧，必须给明确推荐
  - `quick-plan/references/plan-template.md` / `spec-lite-template.md`：去掉模糊风险表述，强调具体实现决策
  - `system-design/SKILL.md`：数据流图必须用项目术语，禁止通用占位
  - `core/specs/spec-templates/code-spec-template.md` / `guide-template.md`：删冗余 section、强调真实示例 + 清晰 trigger

### Removed

- **`notify.js` / `notify-backends.js` / `notify.config.default.json`** 与 `Stop` / `Notification` hook 注册：会话停止与 Notification 桌面 / IM / 自定义后端推送整套自 v6.4.5 起从 `core/hooks/` 移除，hook 数量从 6 → 5。安装侧 `legacy-migrator` 自动清理旧 settings 中的相关条目。
- **`scripts/postinstall.js` 22 行废弃逻辑**：随 hook 重构一并删除，sync 走统一路径。

## [6.4.4] - 2026-05-22

### Added

- **`workflow-execute` Step 5 review loop stuck → oracle 回灌**（SKILL.md 新增小节）：implementer ↔ reviewer 第 2 次仍 REVISE 时 controller(主会话) 程序化标 `stuck_or_looping`，按 `core/specs/shared/codex-routing.md § Decision Table` 调 `collaborating-with-codex` `--oracle-review` 拿 alternative POV，作为**第 3 次重派的 `revise_instructions` 增强输入**，不接管实现也不消耗 loop 预算；第 3 次按原派发路径走 implementer subagent，仍失败则维持 `halt_reason: 'review-loop'`。codex 不可用时 journal 写 `codex-status: codex_degraded` 直接跳过回灌。仅 controller 触发，不下放 implementer / reviewer。
- **`diagnose` Phase 3 stuck 触发 oracle 二次意见**：假设证伪迭代到第 2 轮仍不收敛 → 标 `stuck_or_looping`，由主会话调 `--oracle-review` 拿 alternative POV 回 Phase 3 重排假设。Phase 5 输出 schema 扩 `oracle_consulted` / `oracle_status` / `oracle_insight` 三字段记录 oracle 状态；codex 不可用 → 主会话兜底重排并写 `codex_degraded`。
- **`tdd` 红绿死锁条款**：同一 RED test 经 3 次 GREEN 尝试仍未通过、或一次改动让 ≥ 2 个绿 test 变红后 2 次修正仍未恢复 → 标 `stuck_or_looping`。`/workflow-execute --tdd` 路径下 implementer **不得自起 codex**，由 controller 统一调 `--oracle-review` 拿 interface / test / refactor 建议后回灌实现者；主会话直接驱动时由主会话调。
- **`bug-batch` `risk_signals` 字段**：每个 issue 输出新增 `risk_signals`，取自 codex-routing 的 6 个枚举；Phase 4 FixUnit 聚合 = 单元内全部 issue signals 并集，Phase 6 单元级 review 按聚合 signals 路由（high-risk → controller 调 `--oracle-review`；仅 `direct_verification` → 主会话直审写 `codex-status: skipped`；codex 不可用 → 标 `codex_degraded`）。

### Changed

- **`diagnose` Anti-pattern 清单新增第 4 条**：「证伪 2 轮全错还在自己原 list 里凑新假设」明确为闭门循环反模式，应调 oracle 拿 alternative POV。

## [6.4.3] - 2026-05-21

### Added

- **`collaborating-with-codex` Oracle Review 模式**：codex-bridge 新增 `--oracle-review` 高风险只读分析模式（Amp Oracle 风格 advisor），调用方需显式提供 `--prompt` / `--context` / `--files` / `--risk-signals` / `--non-goals`；bridge 渲染 `prompts/oracle-review.md` 后返回 Codex 原始消息字符串，**不**解析 JSON、不自动把 findings 转 blocker，由 parent agent 走 Result Triage。Mode boundaries 表区分 `--oracle-review` / `--adversarial-review` / `--review` / `task --read-only` / `task` 五档语义。SKILL.md 新增 Effort policy 表（routine/sanity/security/stuck → `medium`/`low`/`high`/`xhigh`），默认立场改为「Codex 作只读 oracle 优先，workspace-write 仅在显式委托或多次实现失败时启用」。
- **`core/specs/shared/codex-routing.md` 重写为 risk-signal 路由**：原「前端 / 后端 / 全栈」决策表替换为 6 个显式风险信号（`security_boundary` / `data_safety` / `concurrency_ordering` / `cross_task_contract` / `stuck_or_looping` / `direct_verification`），命中高风险信号 → Codex 只读 oracle review；仅有 `direct_verification` → 当前模型直接 review。Invocation Contract 指向 `--oracle-review` 模式，附旧版 bridge 的 `task --read-only` fallback。
- **`core/specs/shared/subagent-worker-contract.md`**：新建 worker-level role 与 invariant 契约文档，被 `collaborating-with-codex` 与 `codex-routing.md` 共用引用。

### Changed

- **`workflow-execute` / `workflow-review` / `diff-review` / `fix-bug` review 路由统一引用新表**：相关 SKILL.md 切到 risk-signal 表述；`prompts/implementer.md` / `prompts/reviewer.md` 与 `references/subagent-driven.md` 同步只读约束。
- **`core/utils/workflow/task_bundle.js`**：调整 task bundle 渲染以承接 risk-signal / oracle review 元数据。
- **`core/agents/review-*.md`** review subagent 描述微调，明确各 reviewer 的只读边界。

## [6.4.2] - 2026-05-21

### Added

- **`workflow-execute --tdd` 手动开启 TDD**（**breaking 行为变更**）：默认不再自动进入 TDD 路径，只有用户显式传入 `--tdd` 时才启用，启用后再叠加原有 4 项触发条件（phase 为 `implement` / `ui-*`、项目存在 Spec + 测试命令、actions 含 `create_file`/`edit_file`、文件类型非豁免）。CLI 返回新增 `tdd_enabled` 字段；`tdd_enabled !== true` 时即使任务形态适合测试先行，implementer 也不得引用 `/tdd` skill 或要求先写失败测试。落地点：`execution_sequencer.js`、`workflow_cli.js`、`prompts/implementer.md`、`references/subagent-driven.md`、`core/specs/workflow-runtime/execute-entry.md`、中文指南 §3.7.5。
- **`tests/test_workflow_helpers.js`**：新增用例验证仅在 `--tdd` flag + 条件全满足时启用 TDD。

### Changed

- **`workflow-execute` HARD-GATE 第 3 条**：从"TDD 铁律：满足条件即触发"改为"TDD 手动开启铁律：仅 `--tdd` 时进入"。

## [6.4.1] - 2026-05-21

### Fixed

- **`bug-batch` / `fix-bug` commit message 格式**（39ae66c）：缺陷号统一保留为无中括号 + 空格分隔形式，两个 skill 的 SKILL.md commit template 同步，避免不同 workflow 在 issue tracker 关联时格式漂移。

## [6.4.0] - 2026-05-21

### Added

- **`workflow-plan` Plan 骨架扩写校验增强**：新增 `references/no-placeholders.md`，并扩写 `plan-self-review.md`。Plan 扩写完成后统一走 `workflow_cli.js plan-review`，由 CLI 输出 ready / confidence / coverage / lint 摘要，避免人工扫 plan body。
- **`workflow-plan` 锚点级编辑能力**：`plan_composer.js` 大幅扩展，支持 v2 plan 锚点 section 级替换与更严格的 task / coverage / placeholder / atomicity 校验；`workflow_cli.js` 暴露 `plan-edit` / `plan-review` 相关能力，配套新增 `tests/test_plan_composer.js`。
- **`ux-elaboration` wireframe / 时序图规范**：§4.4 输出新增 ASCII wireframe 的“形状 + 比例”约束；复杂前端交互可追加 Mermaid `sequenceDiagram`，Page Hierarchy 增加「关键交互」列，帮助 plan 阶段识别非主路径交互。

### Changed

- **`workflow-spec` / `workflow-plan` 文件处理增强**：改进 spec / plan 路径推导与项目初始化辅助逻辑，降低从已批准 spec 生成 plan 骨架时的路径漂移风险。
- **文档同步到 v6.4.0 执行模型**：README 与内部工作流指南更新为 fresh-subagent-per-task、单 reviewer、只读 fan-out 的当前语义，清理已删除 writable parallel execution / `batch_orchestrator.js` / `merge_strategist.js` 相关描述。

### Removed

- **移除过渡期 reviewer alignment spec**：删除已被 `workflow-execute` reviewer 合并模型吸收的 `workflow-execution-review-alignment-spec.md`，避免旧双 reviewer / writable parallel 语义继续漂移。

## [6.3.4] - 2026-05-20

### Changed

- **`workflow-execute` reviewer 合并**：取消 spec-reviewer + code-quality-reviewer 双 subagent，合并为单一 `reviewer` 子角色，一次性评估 acceptance criteria 与代码质量，串行紧跟在 implementer 之后。`prompts/spec-reviewer.md` / `prompts/code-quality-reviewer.md` 删除，新增 `prompts/reviewer.md`；governance 逻辑按 review 结论决定 post-execution 路径。引用：`core/specs/workflow-runtime/workflow-execution-review-alignment-spec.md`。
- **`workflow-execute` Fresh-Subagent-Per-Task 模型**：每个 task 起一个全新 implementer subagent，串行交给 reviewer 复核；废弃 writable parallel execution 子系统（使用率低 + 维护成本高），并入只读 fan-out 立场。新增 ADR `core/skills/code-specs/adr/0002-drop-writable-parallel.md`。`dispatching-parallel-agents` SKILL.md 精简为只读 fan-out 单一定位。
- **清理 parallel dispatch 残留脚本**：删除 `agent_registry.js` / `dispatch_runner.js` / `result_collector.js` / `worktree_manager.js` / `batch_orchestrator.js` / `merge_strategist.js` 及对应 `.claude/config/agent-registry.json` 配置和 `references/parallel-dispatch.md` 文档（共 -1911 行）。
- **`workflow-execute` upgrade_required 检测 + self-healing**：refine SKILL.md 中 review 状态自愈协议与升级判定描述。
- **`handoff` 输出格式微调**：SKILL.md 改善交接文档结构与格式。
- **`bug-batch` Phase 表述澄清**：SKILL.md 与 `status-and-reporting.md` 同步 phase 边界与状态流转语义。

## [6.3.3] - 2026-05-19

### Changed

- **CLI 简化：`sync` / `link` 取消 `-a/--agent` 参数**（**breaking**）：两个命令自动作用于所有检测到的工具，不再支持指定单个 agent；`sync` 同时移除已失效的 `--legacy` 模式（依赖 `-a` + 含未定义 `homeDir`）。Interactive installer 取消 agent 多选，安装时一律 install-to-all。测试切换为 touch 假目录检测代替 `-a` 注入。
- **移除 Qoder 支持**：`lib/agents.js` 删除 qoder 注册项，`core/specs/platform-parity.md` / `core/utils/platform_parity.js` / README / CLAUDE.md / 中文体系指南同步清理。
- **`collaborating-with-codex` Code Task `--model` / `--effort` 文档化**：SKILL.md 明确 `spark` alias、effort 旋钮取值、与 `workflow-execute` `--backend codex` 的互动关系，引用 user CLAUDE.md "代码主权" 协议。
- **`workflow-execute` SKILL.md self-review 步骤 + task naming conventions**：新增 self-review checklist；task name 引入显式命名约定（meaningful file names）+ override 支持；`workflow-plan` `plan_composer` 适配 name override；`workflow-status` 拆出 `references/next-action.md` + `references/output-format.md`。
- **`ux-elaboration` 设计一致性 self-review**：新增 checklist 段；resolved inconsistencies 独立列章，与 checklist 区分。

## [6.3.2] - 2026-05-19

### Fixed

- **Plan / spec 文件路径处理**（91e400c）：spec/plan 路径统一存为 forward-slash 形式跨 OS 兼容；active package validation 显式 reject 畸形名称防止 scope 注入；role context bundle signal/profile 管理修正；测试改验绝对路径。
- **Explicit scope 缺包不再 fallback 全树**（582ddc1）：`pre-execute-inject.js` 与 `task_runtime.js` task context 构造引入显式 role 分类；当 explicit scope 指向不存在的 package 目录时直接报错，不再静默 fallback 到 full-tree 暴露完整 code-specs。新增 `tests/test_task_aware_injection.js` 校验 explicit scope 不泄露。

### Changed

- **`workflow-review` 结构整理**：SKILL.md 与 `references/cross-layer-checklist.md` 重排，明确各 phase 输入输出与 reviewer 角色契约。

## [6.3.1] - 2026-05-18

### Added

- **Task Atomicity Rule**：plan 阶段对包含 5+ parallel items 的 task 强制拆为 sub-task，每个 sub-task 独立 acceptance criteria，可追溯到具体执行单元。`workflow_types.js` / `plan_composer.js` / `scripts/validate.js` 同步落地约束。
- **Deviation Acceptance Process**：retry 阶段新增 `cmdAcceptDeviation`——用户显式承认实施偏离已审批 spec，记入 journal 并触发 spec-update 流程。配套 `journal.js` evidence summary 结构化校验（reject 自由文本，强制 schema 化）。
- **Codex Review Runner**：新增 `core/utils/workflow/codex_review_runner.js` 作为 quality_review 链路中 Codex 后端的执行单元；`collaborating-with-codex` SKILL.md 同步说明何时切到 Codex backend。
- **Doc Contracts 扩展**：`doc_contracts.js` / `workflow_types.js` / `delta_archive_cmds.js` 增加跨阶段 doc 契约校验位点。

## [6.3.0] - 2026-05-18

### Added

- **`collaborating-with-codex` 观察性 Phase 1**：codex-bridge.mjs 拆为 `scripts/codex-bridge.mjs` + `scripts/lib/{state,gc,capture,result}.mjs` 模块化布局。新增 per-job log 文件（单行事件流 ≤200 字符 / ISO timestamp / 完整 body 入 `<id>.json`），适配 Claude Code `Monitor "tail -F <logFile>"` push 观察；非 Claude 工具走 `--status <id> --wait --tick N` 阻塞 fallback 或自定义轮询 brief snapshot。新增 `--result <id>` 终态结果聚合（agentMessages / touchedFiles / fileChanges / commandExecutions / reasoningSummary / turnId / error），中间态拒绝。Job id 支持 bucket 内 prefix 匹配。GC 自动按 count=20 + age=14d 删终态文件。状态目录从 `<workspace>/.claude/tmp/codex-jobs/` 迁到 `~/.claude/tmp/codex-jobs/<basename>-<sha8(realpath(cwd))>/`，**不再污染工作区 git status**（旧路径数据不迁移，可手动 `rm -rf <workspace>/.claude/tmp/codex-jobs`）。
- **`collaborating-with-codex` Code Tasks 一等模式**：bridge 新增 `--model <name>`（含 `spark` → `gpt-5.3-codex-spark` alias）与 `--effort <none|minimal|low|medium|high|xhigh>` 旋钮，透传 `turn/start`。SKILL.md 新增 `## Code Tasks` 章节（when to delegate / sandbox 选择 / multi-turn diff-resume 模式 / Code Task Triage 平行于现有 Result Triage，引用 user CLAUDE.md "代码主权"协议而非重复）。`--result` 默认暴露 `touchedFiles[]` 供 parent agent 精确 diff 审查。
- **`collaborating-with-codex` capture 增强**：移植 codex-plugin-cc（Apache-2.0）的 reasoning 去重合并、`fileChanges[]` / `touchedFiles[]` / `commandExecutions[]` 完整捕获、子 agent 命名（thread/name/updated + agentNickname/agentRole）、webSearch / mcpToolCall 描述。Log 每条事件区分主线程 vs `Subagent <name>` 前缀。
- **`npm run test:codex-bridge`**：`node:test` 内置框架，24 个用例覆盖 state 路径稳定性 / GC count + age cap / 并发幂等 / capture 行截断 + 去重 / result brief vs detail / `--result` 终态守卫 / prefix 匹配三态。**不**加入 `prepublishOnly`（不阻塞发版）。
- **`core/skills/collaborating-with-codex/NOTICE`**：Apache-2.0 attribution 记 codex-plugin-cc commit hash + 各 ported 模块对照表。
- **`collaborating-with-codex` SKILL.md Codex Backend Guidelines**：新增「何时委托 Codex」+ 强制 triage 流程章节，明确 `--backend codex` 开关与 TDD 协议互动，强调外部模型输出需经当前模型重构后落盘（呼应 user CLAUDE.md "代码主权"）。

## [6.2.10] - 2026-05-15

### Added

- **MCP wrapper skills drift-resilience（ADR-0001）**：新增 `core/skills/_shared/mcp-baseline.mjs` 跨 skill 共享模块，统一三个 MCP 包装 skill（`bk` / `alidocs` / `figma-data`）的 tool snapshot / shape 解析 / 错误归一化逻辑。三 CLI 接入 `--shape` / `raw` / `diff-tools` / `schema` 等稳定 subcommand，错误归一化为三桶（`tool_not_found`=5 / `enum_invalid`=6 / `auth`=2），stderr 输出 `{kind, hint, originalMessage}` 结构化对象供调用方解析。配 50 个单测 + 三 baseline diff 校验 `has_drift=false`。
- **双层 baseline 策略**：每个 wrapper skill 携带 checkin 权威 baseline（`baseline-schema.json`），本地 cache 由 CLI 调用时透明维护。`diff-tools` 子命令做主动漂移检测，L3 粒度按 tool name + required + 静态 enum 比对。
- **`bk --shape issue-record` 输出契约**：新增 9 字段稳定 `IssueRecord` 形态（issue_number / title / description / priority / state / operator_user / reporter / created_at / screenshots / module_hint），`bug-batch` / `fix-bug` 已切换消费稳定形态而非原始 MCP 响应。
- **Design Package `schemaVersion: "1.0"`**：`figma-data` 产出 Design Package 携带版本号，`figma-ui` Phase A Gate 0 做 schemaVersion assert，不匹配直接 fail-fast。
- **`spec-review` 第 7 类检查「Snapshot 时间戳过期」**：扫描 SKILL.md 中 `<!-- snapshot YYYY-MM-DD -->` 注释，>90d 标 warning / >180d 升 advisory，提示同步动态 enum 快照。
- **`core/skills/_*/` 下划线前缀目录约定**：跨 skill 私有共享模块入口，**非 user-facing skill**。`lib/installer.js` / `core/utils/platform_parity.js` / `scripts/validate.js` 三处按 `_*` 前缀过滤，不会被 mount 为 skill 也不会被 platform-parity 检查统计。
- **AskUserQuestion enum cache refresh**：从 cache 读取 enum 时强制 refresh 一次，避免拿到过期枚举值。
- **Shared protocols 新文档**：`core/specs/shared/` 下新增 `business-glossary.md` / `pre-flight.md` / `hard-stop-templates.md` / `manual-intervention-reasons.md` / `status-readiness.md`，跨 skill 协议引用而非复写；`fix-bug` / `bug-batch` 切换为引用形式。

### Changed

- **`bug-batch` / `fix-bug` 消费稳定 wrapper shape**：从直接解析 bk MCP raw response 切换到 `bk --shape issue-record` 输出的 9 字段 IssueRecord，下游 prompt / 模板对字段访问路径稳定不再依赖 MCP server 字段顺序。
- **`figma-ui` Phase A 接入 Design Package schemaVersion assert**：消费 `figma-data` 产出前先 assert `schemaVersion === "1.0"`，schemaVersion 缺失或不匹配直接 Hard Stop；`figma-data` 在 `get_design_context` tool_not_found 时降级为 `screenshot + get_metadata`，stderr 透出降级原因。
- **`hard-stop-templates` 反馈机制双轨**：按 review volume / feedback dimensions 区分 `AskUserQuestion` 与 pure text 模式；`bug-batch` / `fix-bug` 切换为 pure text 反馈，提供结构化响应格式与归一化路径。
- **Glossary drift 83 → 0**：约定/契约/审查/归档/流程/模块/变更/分层 等术语在 27 个 normative 文件中统一为 canonical English（convention / contract / review / archive / workflow / module / delta / layer）。fenced code block 内的 CLI 示例字符串由 validator 豁免不受影响。
- **Wrapper skills 文档对齐**：`bk` / `alidocs` / `figma-data` troubleshooting 统一记 exit code 表 (0/1/2/3/4/5/6 per ADR-0001) + diff-tools drift detection + promote workflow；内部 guide §5.4 同步 drift-resilience 块。
- **README + CLAUDE.md drift-resilience 落地**：README §5.4 增 drift-resilience block + 3-bucket exit codes；§8.1 指向 `_shared/mcp-baseline.mjs` 与 ADR-0001；CLAUDE.md 目录树补 `_shared/` / `bk/` / `alidocs/` 并描述 `_*/` 前缀约定。
- **Workflow 入口命令文档同步**：文档中 `/workflow-plan` 旧引用调整为 `/workflow-spec`（spec 阶段入口），明确 `workflow-spec` 与 `workflow-plan` 的分工。

## [6.2.9] - 2026-05-14

### Changed

- **`bug-batch` 阶段重排**：Phase 6 改为「Review + 物化 + 流转到处理中」，新增 Phase 7「重建 squash commit（前置，无 Hard Stop）」，Phase 8 合并为「汇总报告 + 全量确认（Hard Stop）+ 流转到待验证」。commit 前置到人工验证之前——经办人在主工作树上实测最终提交态，而非自行拼凑散落的 worktree / stage commit。Phase 7 重建后清理已入 commit 单元的 worktree 及 `fix/<unit_id>` 分支，`[HARD-STOP:CONFIRM-COMMIT]` 只卡「流转到待验证」这一对外副作用。
- **`spec-review` 新增第 7 类检查「冗余检测」（v2.3, advisory）**：定性判断、不设数字阈值，覆盖四类——同文件自重复（intra-file-dup）、包内跨文件重复（intra-package-dup）、跨包重复（cross-package-dup，建议上提 `guides/`）、样板重复（boilerplate-dup，建议收敛到根 `index.md`）。全 advisory 不计入阻塞数，修复走人工 / `/quick-plan`，spec-review 保持只读不自动 dedup。
- **`spec-update` Step 3 增加防冗余检查**：写入前扫描范围扩展到同层 `index.md` + 兄弟 convention 文件，命中即提示——兄弟文件 / index.md 重叠（防 R2）、跨包上提（防 R5）、同文件 Rules/Common Mistakes 比对（R3）、目录树重画比对（R4）。Self-Review 清单同步细化。
- **Code-specs 模板冗余治理**：根 `index-template.md` 取消「更新记录」段（与 `local.md` Changelog 重复），新增 canonical「Quality Check」段；`layer-index-template.md` 与 5 个 stack-template `index.md` 的通用 Quality Check 改为指向根 `index.md` 的指针。新增迁移 manifest `v6.3.0.json`（含 `delete-section` 自动迁移 + breaking 说明）。
- **`scripts/generate-manifest.js`**：`mergeManualManifestEdits` 扩展为 `breaking` / `notes` 字段也走人工手写优先，避免自动生成覆盖人工编写的迁移说明。

## [6.2.8] - 2026-05-14

### Changed

- **`fix-bug` workflow 从 4 Phase 扩为 6 Phase**：拆出 Phase 5「汇总报告 + 修复确认（Hard Stop）」和 Phase 6「Commit + 流转到待验证」，形成两段 Hard Stop——修复前确认方案、提交 + 流转前再确认并要求人工验证。commit 与状态流转从 Phase 3/4 后移到 Phase 6，review 对象明确为未提交的工作区改动。「处理中」为经办人进度状态可自动流转，对外可见的「待验证」流转留到 Hard Stop 之后。
- **`bug-batch` Hard Stop 表述细化**：`[HARD-STOP:CONFIRM-COMMIT]` 无条件触发（含全 completed 批次），不调 `AskUserQuestion` 改为纯文本展示汇总 + 验证提示，经办人回 `ok` 才继续。FixUnit ID 固定格式 `FU-NN`（零填充顺序号），禁止把缺陷标识拼进 ID。

## [6.2.7] - 2026-05-13

### Changed

- **`ux-elaboration` skill 文档重构**：HARD-GATE 明确主会话 vision 只输出 LayoutAnchor 写入 §4.4.3，不解 designContext / 不写其他项目文件；像素级还原归 `/figma-ui`。设计稿策展改为人工一次性贴入构建 DesignSourceMap，新增 `--design <dir>` 入口参数，校验错误信息指引更清晰。`workflow-spec` SKILL.md 同步调整委托表述。
- **`diagnose` skill description 修订**：明确产出根因 + 推荐修复方案，修复交给 `/fix-bug` 消费。`quick-plan` SKILL.md 同步精简。

## [6.2.6] - 2026-05-13

### Added

- **Skill routing hook**：新增 `core/hooks/skill-routing.js`，绑定到 `ToolSearch` 和 `UserPromptSubmit` 两个事件。检测到 Figma URL（`figma.com/(design|file|proto)/`）或 alidocs URL（`alidocs.dingtalk.com` / `mcp-gw.dingtalk.com` / `dentryUuid=` / `nodeId=`）时，按意图关键词路由到对应 skill（`figma-ui` / `figma-data` / `alidocs`），并提示禁止用 WebFetch 走必返 403 的路径。
- **`core/hooks/skill-routing-table.json`**：声明式路由表，集中维护 URL pattern、意图关键词（implement vs data）、skill 映射、hint 文案，以及全量 `project_skill_names` 清单。
- **路由表 fixture 套件**：`core/hooks/__fixtures__/skill-routing/` 含 13 个 input 用例 + `run.sh`，覆盖 Figma 实现/读取/无意图、alidocs、bk 不拦截、ToolSearch 三类匹配（精确名 / fuzzy / 真实工具名）、子串安全、其他工具透传、多 URL 共存、env 变量跳过等场景。
- **`scripts/validate.js` 新增 `validateSkillRoutingTable`**：比对 `skill-routing-table.json` 的 `project_skill_names` 与 `core/skills/` 实际目录，缺项/冗余均报错，防止 skill 增删后路由表漂移。

## [6.2.5] - 2026-05-11

### Changed

- **`figma-data` skill 文档增强**：补充执行路径说明和目录权限错误的 fallback 流程，明确使用场景与执行模式。
- **`figma-data` CLI 错误处理**：`cli/figma.mjs` 增加异常处理改进。
- **`figma-ui` skill description 修订**：细化基于用户意图的触发条件，明确与 `figma-data` 的职责边界。

## [6.2.4] - 2026-05-11

### Changed

- **`figma-data` skill 拆分**：从 `figma-ui` 剥离 MCP 数据获取 + 资源分诊为独立 `figma-data` skill，含 CLI 命令结构和详细使用示例。
- **`figma-ui` skill 精简**：明确依赖 `figma-data` 做设计检索，移除冗余数据获取逻辑。
- **`CLAUDE.md` Figma pipeline 文档同步**：反映 `figma-data` / `figma-ui` 二分架构。
- **Codex 委托协议描述修订**：`core/CLAUDE.md` 统一为"用户主动调用或 skill 内部触发"表述。

## [6.2.3] - 2026-05-11

### Changed

- **`figma-ui` skill 文档全面增强**：补充 CLI 命令用法示例、设计上下文检索流程、资源管理指引。
- **`figma-ui` CLI 脚本新增**：`cli/figma.mjs`（512 行）提供 Figma MCP 操作的命令行封装。
- **`figma-ui` troubleshooting 文档扩充**：覆盖 Desktop / Remote MCP 两种模式的常见连接问题和配置步骤。
- **`ux-elaboration` skill 微调**：同步引用路径。

## [6.2.2] - 2026-05-11

### Changed

- **`bug-batch` skill 精简重写**：SKILL.md 从 438 行简化，工作流步骤结构化重组；缺陷分析视图和关系矩阵模板增加置信度和证据摘要。
- **`bug-batch` references 整合**：删除过时的 `commit-rebuild.md`（133 行）和 `coverage-graph.md`（82 行），相关内容并入现有文档。

## [6.2.1] - 2026-05-11

### Changed

- **`workflow-spec` SKILL.md 流程优化**：设计深化和用户审批步骤表述精简，跳过条件和路由决策逻辑更清晰。

## [6.2.0] - 2026-05-11

### ⚠️ BREAKING CHANGES

**Review 模式从 4 种简化为 2 种**：`role_injection.js` 的 `resolveStage2ReviewMode` 现在只返回 `single_reviewer`（默认）和 `codex_enhanced`（风险信号命中时）。旧的 `dual_reviewer`、`multi_angle`、`quad_review` 传入 `quality_review.js --review-mode` 会触发 fallback warning 并降级为 `single_reviewer`。已在途的 workflow 不受影响（state 中的历史 review_mode 字段为记录用途，不参与逻辑判断）。

### Added

- **`ux-elaboration` skill**：前端设计深化独立 skill，产出 User Flow + Page Hierarchy + Layout Anchors（写入 Spec §4.4）。从 `workflow-spec` 设计深化步骤剥离为原子 skill，可独立触发。
- **`system-design` skill**：后端系统设计独立 skill，覆盖 API Contract + Data Flow + Service Boundaries（写入 Spec §5.6）。
- **`improve-architecture` skill**：架构深化——deletion test、dependency classification、parallel interface design exploration。
- **`prototype` skill**：快速原型验证——Logic（terminal TUI）和 UI（多变体）两种路由。
- **`handoff` skill**：会话交接文档生成，支持跨 session 续作。
- **Out-of-scope protocol**：需求分析阶段自动扫描 `.out-of-scope/` 目录，命中则告知用户曾被拒绝及原因。`grill` / `quick-plan` / `workflow-spec` 均接入。
- **Brief Mode**（`workflow-execute`）：plan ≤3 task 且无 quality_gate/HITL 时自动进入——跳过 ContextGovernor、post-execution 只执行验证 + checkpoint。用户可用 `--full` 覆盖。
- **`quick-plan` → workflow 对接**：文档化轻量执行路径——quick-plan 产出的 plan 可被 `/workflow-execute` 直接消费（brief mode + spec skipped）。
- **`quick-plan` spec-lite 模板**：新增 `references/spec-lite-template.md`。

### Changed

- **Skills 上下文声明从 `<PRE-FLIGHT>` 迁移到 `<CONTEXT>`**：所有 skill 内联声明需要读取的 code-specs / glossary，不再走共享前置门控。`core/specs/shared/pre-flight.md` 标记为 deprecated。
- **`workflow-spec` 设计深化委托**：Step 5 不再内联设计深化逻辑，改为委托 `ux-elaboration` / `system-design` skill。旧 `references/design-elaboration-{frontend,backend}.md` 移除。
- **`workflow-review` Stage 2 简化**：从 4 模式（single/multi_angle/dual/quad）+ 降级矩阵简化为 2 模式（`single_reviewer` / `codex_enhanced`）+ 单降级路径。
- **`workflow-execute` Post-Execution Pipeline**：从 5 步全强制简化为 2 必选（验证 + checkpoint）+ 2 条件（自审查 + journal）。
- **`workflow-spec` 设计深化门槛放宽**：新增跳过条件"spec ≤2 module 且 ≤3 page/endpoint"。
- **`workflow-plan` 设计原则**："Complete Code" 降级为 "Actionable Steps"——代码块仅用于非显然模式。
- **`core/CLAUDE.md`**：Hard Stop 规则从引用模板文件改为内联描述（各 skill 自定义选项）。
- **`role_injection.js`**：`STAGE2_REVIEW_MODES` 从 4 项改为 2 项。
- **`quick-plan` / `research` skill 精简重写**：移除冗余段落，术语对齐 glossary。
- **Workflow 状态机系列 skill 文档微调**：`workflow-archive` / `workflow-delta` / `workflow-execute` / `workflow-plan` / `workflow-review` / `workflow-spec` / `workflow-status` 描述精确化。
- **Release 脚本**：移除 push 前确认提示，简化发布流程。

### Removed

- **`core/specs/workflow/` 目录**（6 文件，1,963 行）：删除漂移的扩展状态机、PBT 属性、review-loop、subagent-routing、quality-gate、task-parser。唯一权威状态机为 `core/specs/workflow-runtime/state-machine.md`。
- **`core/specs/shared/` 4 个低价值 spec**：`context-awareness.md`（559 行）、`status-emoji.md`、`hard-stop-templates.md`、`path-utils.md`。
- **Codex advisory review 步骤**：`workflow-spec` Step 6 (Codex Spec Review) 和 `workflow-plan` Step 3 (Codex Plan Review) 整步移除。Runtime 的 `planning_gates.js` trigger 仍写入 state 但现为 no-op。
- **Review 降级矩阵**：`quad_review` 4 路并行 + 12 条降级路径 + join barrier 变体全部移除。
- **`workflow-spec` 内联设计深化文档**：`references/design-elaboration-frontend.md`、`references/design-elaboration-backend.md` 随职责迁移到独立 skill。

### Moved

- `core/specs/shared/status-readiness.md` → `core/skills/fix-bug/references/status-readiness.md`
- `core/specs/shared/manual-intervention-reasons.md` → `core/skills/fix-bug/references/manual-intervention-reasons.md`

## [6.0.9] - 2026-05-08

### Added

- **`.codex/config.toml` 项目级 Codex 配置**：启用 `features.multi_agent_v2`（`max_concurrent_threads_per_session = 6`，`min_wait_timeout_ms = 480000` = 8 min），约束父 agent 必须 wait 子 thread 终态后再操作，替代 `[agents].max_threads` 的并发模型。Codex 默认 wait 超时 10s 对 review/adversarial-review 太短，新配置给并行 dispatch 留 headroom。文件顶部写明 trust 机制：未被 `~/.codex/config.toml` `[projects]` trust 的项目只会加载 doc fallback，`[features]` 被静默忽略，需配合 `codex-bridge.mjs` 的 wait-timeout fallback 保证 8 min floor。
- **`core/hooks/_skip.js` 共享 skip helper**：`shouldSkipInjection()` 集中判断 `WORKFLOW_HOOKS=0` / `AGENT_WORKFLOW_DISABLE_HOOKS=1` / `CLAUDE_NON_INTERACTIVE=1` 三个环境变量，供 `notify.js` / `pre-execute-inject.js` / `session-start.js` 统一使用；仅控制上下文注入跳过，不影响治理 gate。
- **`core/utils/workflow/path_utils.js::normalizeWindowsShellPath`**：Windows 平台把 `/c/Users/...`（Git Bash / MSYS2）、`/cygdrive/c/Users/...`（Cygwin）、`/mnt/c/Users/...`（WSL 路径泄漏）归一化为 `C:\Users\...`。Node 的 `path.resolve` 在 Windows 看到 `/d/xxx` 会前置当前驱动器（`D:\d\xxx`），导致 hook 找不到 `.claude/config/...`。`detectProjectIdFromRoot` / `getThinkingGuidesDir` / `getCodeSpecsDir` 三处 `process.cwd()` fallback 路径现在统一走 normalize。

### Changed

- **`core/skills/dingtalk-mcp/SKILL.md` description 重写**：明确列举触发场景（钉钉 URL、相关命令示例）和本地 `mcp-gw` 配置的检测 + 服务器 URL 获取流程。
- **`workflow-spec/workflow-plan/dispatching-parallel-agents/collaborating-with-codex/workflow-execute` SKILL 文档微调**：同步引用路径与 skip helper 协议。

## [6.0.8] - 2026-05-06

### ⚠️ BREAKING CHANGES

**Workflow 产物路径从项目目录迁移到 workflowDir**：spec/plan 文件不再写入 `.claude/specs/` / `.claude/plans/`，改为 `~/.claude/workflows/{projectId}/specs/{slug}-{MMDD}.md` 与 `.../plans/{slug}-{MMDD}.md`。`workflow-state.json` 的 `spec_file` / `plan_file` 字段持久化 **OS 展开后的绝对路径**（不写 `~`）。读取侧通过 `path.isAbsolute` 区分新旧格式，旧项目的 `.claude/specs/*.md` 相对路径继续生效。

**影响**：
- 新 workflow 的 spec/plan 不再进入 git（用户级位置），不会污染业务仓库
- 已归档或在途 workflow 的旧相对路径自动走兼容分支，无需手动迁移
- `.claude/specs/` 目录改为纯 code-specs 用途（7-section contract），不再混入 workflow 产物

### Added

- **`workflow-spec` 新 skill**：从 `workflow-plan` 拆出，专注 spec 生成全链路（需求分析 → 澄清 → Codex 评审 → spec 审批）。`core/skills/workflow-spec/SKILL.md` + `references/{codex-spec-review,design-elaboration-backend,design-elaboration-frontend,design-elaboration}.md`。
- **绝对路径支持下游链路**：`plan_composer.js::buildTaskBlock` / `buildPlanTasks` 新增 `specRef` 参数；`inferPlanRelativeFromSpec` 同时处理 `/specs/` → `/plans/` 的绝对路径和 `.claude/specs/` → `.claude/plans/` 的旧路径；`workflow_cli.js::inferSpecRelativeFromPlan` 同步新增绝对路径 candidate；`task_runtime.js::getSpecContent` 用 `path.isAbsolute` 分流。
- **日期后缀生成器 `getDateSuffix()`**：`MMDD` 格式防止同项目多 workflow 文件名冲突。
- **`scripts/claude-cli.js` Windows 二进制解析**：增加 `.cmd` / `.exe` 后缀兜底，解决 Windows 下 `detectClaudeCli` 找不到可执行入口的问题。
- **`workflow-archive/workflow-delta/workflow-execute/workflow-review/workflow-status` 文档整合**：大量裁剪冗余段落，所有 SKILL.md description 归一为 "Use when..." 风格；前置协议迁入 `core/specs/shared/` 共享文件。
- **`core/skills/figma-ui/references/playbook.md`**：从 SKILL.md 抽出 349 行 playbook，SKILL.md 从 517 行瘦身到纯入口职责。

### Changed

- **`workflow-plan` skill 职责收敛**：只负责 plan 生成，不再处理 spec 生成；`workflow-plan/references/` 下 `artifact-schemas.md` / `spec-self-review.md` 随 spec 链路迁走。命令引用从 `/workflow-plan` 改为 `/workflow-spec` 的，在 CLAUDE.md + 多个 SKILL 文档内同步更新。
- **`core/specs/workflow-runtime/state-machine.md` 表格更新**：Spec/Plan 位置改写为 `~/.claude/workflows/{projectId}/specs|plans/{name}-{MMDD}.md`，并在 workflow-state.json 示例块后补充绝对路径说明段。

### Removed

- **`core/skills/workflow-plan/references/artifact-schemas.md`** 与 **`spec-self-review.md`**：并入 `workflow-spec/references/`。

## [6.0.7] - 2026-04-30

### Changed

- **`core/skills/dingtalk-mcp/SKILL.md`**：补充 mcp-gw 服务器 URL 获取指引，明确本地配置缺失时的引导路径。

## [6.0.0] - 2026-04-27

### Fixed (pre-release iteration)

- **`core/.claude-plugin/plugin.json` 移除 `skills` / `commands` / `agents` / `hooks` 四个字段**：这四者都位于 Claude Code Plugin 的约定默认路径（`./skills`、`./commands`、`./agents`、`./hooks/hooks.json`），Plugin loader 自动扫描；显式声明反而触发 `agents: Invalid input` schema 校验失败（应为结构而非字符串路径）以及 `Duplicate hooks file detected` 重复加载错误。只保留元数据字段（name/version/author/...）。
- **manifest 顶层移除 `displayName` / `description`**：`claude plugin validate` 拒绝这两个 plugin.json/marketplace.json 顶层字段；marketplace.json 的 description 移到 `metadata.description`，displayName 完全移除（schema 不支持）。
- **CLAUDE.md 同步（覆盖语义 + 时间戳备份）**：Plugin 安装完成后调用 `claudeCodePlugin.syncClaudeMd`，把 `<canonical>/core/CLAUDE.md` 的内容同步到 `~/.claude/CLAUDE.md`。内容一致跳过；目标存在且内容不同 → 备份到 `~/.claude/CLAUDE.md.bak.<ISO-timestamp-ms>`（毫秒级时间戳，每次覆盖都产生新备份，历史不丢）。所有操作记入 `~/.claude/.claude-workflow/migration.log`。
- **`bin/agent-workflow.js` doctor 不再误报旧版安装**：检测到 Plugin 已装时跳过 `~/.claude/skills` symlink 模式检查（v6.0.0 用户的 skills 由 Plugin cache 承载，不再是 symlink）。
- **`lib/agents.js::getAgentBaseDir` 对 `managedViaPlugin` 返回 null**：避免 `getInstallationStatus` 对 claude-code 执行 `path.dirname(undefined)` 崩溃。`getInstallationStatus` 对 managedViaPlugin 的 agent 写入 `mode: 'plugin'` 占位结构，交由调用方用 `claudeCodePlugin.inspectStatus` 获取真实状态。

### ⚠️ BREAKING CHANGES

v6.0.0 把 Claude Code 的分发路径从 installer 迁移到 **Claude Code Plugin 机制**。
其他 8 个 AI 工具（Cursor / Codex / Antigravity / Droid / Gemini CLI / GitHub Copilot / OpenCode / Qoder）安装路径不变。

**行为变化**：
- Claude Code 不再通过 `agent-workflow sync` 的 installer 路径分发，改走官方 Plugin 机制（`~/.claude/plugins/cache/`）
- `~/.claude/settings.json` 中的 workflow/team/notify hooks 不再由 installer 注入，改由 Plugin 的 `hooks/hooks.json` 声明
- `~/.claude/.agent-workflow/{hooks,utils,specs,agents}` 对 Claude Code 用户不再必需（Plugin 自包含这些资源）
- `~/.claude/CLAUDE.md` 不再由 installer 同步（Plugin 不接管用户 memory 文件）

**升级路径**：
```bash
# 升级后运行一次 sync，会自动：
# 1. 检测 v5.x 残留（settings.json 中 7 个受管 hook、.agent-workflow/ 下 4 个 legacy 目录）
# 2. 清理残留（保留用户自定义 hook 和 ~/.claude/CLAUDE.md）
# 3. 调用 claude CLI 自动安装 Plugin
agent-workflow sync -a claude-code -y
```

如果 `claude` CLI 不在 PATH，sync 会打印手动指引（/plugin marketplace add + /plugin install）。

**CI / 容器环境**：设置 `AGENT_WORKFLOW_SKIP_CC_PLUGIN=1` 跳过 Claude Code Plugin 分支。

### Added

- **Claude Code Plugin 资源文件**：`core/.claude-plugin/plugin.json`（plugin 清单）、`.claude-plugin/marketplace.json`（仓库根 marketplace 清单）、`core/hooks/hooks.json`（7 个 hook 清单，event + matcher + command 三元组）、`core/hooks/notify.config.default.json`（Plugin 自带默认通知配置）
- **`lib/claude-code-plugin.js` 新模块**：导出 `ensurePluginInstalled` / `detectLegacyResidue` / `cleanupLegacyResidue` / `inspectStatus` / `diagnose` / `printGuidance` 六个函数。`cleanupLegacyResidue` 按 5 个受管脚本名精确匹配剔除 settings.json 中的 hook 条目，用户自定义 hook 保留；清理日志写入 `~/.claude/.claude-workflow/migration.log`（JSONL）
- **`scripts/claude-cli.js` CLI 封装**：`detectClaudeCli` / `marketplaceAdd` / `marketplaceUpdate` / `pluginInstall` / `pluginUpdate` / `pluginList`，全部走 execFile + timeout（60s），失败返回 `{ success: false, stderr }` 不抛异常
- **`scripts/sync-plugin-version.js`**：release.sh `[1.5/5]` 调用，把 `package.json` 的版本同步写入 `core/.claude-plugin/plugin.json`
- **`scripts/validate.js` 扩展 plugin manifest 校验**：plugin.json 存在 + version 匹配 package.json、marketplace.json 存在 + 含 agent-workflow 条目、hooks.json 引用的脚本全部存在、notify.config.default.json 存在、installer.js 在 `STEP_4_DONE` 锚标记下不能再 export 已迁移函数
- **`agents['claude-code']` 新增 `managedViaPlugin: true` 标记**：`platform_parity.js` 据此跳过 skillsDir/globalSkillsDir 必填字段校验；CLI / interactive installer 据此分叉路径
- **`AGENT_WORKFLOW_SKIP_CC_PLUGIN` 环境变量**：CI 场景下跳过 Claude Code Plugin 自动安装

### Changed

- **`bin/agent-workflow.js` sync/link/status/doctor 分叉**：所有命令内部按 agent 类型 partition 成 claude-code 和其他 8 个工具两路；claude-code 走 `claude-code-plugin.js`，其他走原 installer。`--legacy` 模式拒绝 claude-code 目标
- **`lib/interactive-installer.js` 同步分叉**：交互模式下 claude-code 的 choice hint 标注 "via Claude Code Plugin"；`initialValues` fallback 从 `['claude-code']` 改为 `[]`；安装阶段按 partition 分别调用；状态视图使用 `claudeCodePlugin.inspectStatus()`
- **`lib/installer.js` 删减约 500 行**：删除 `ensureWorkflowHooks` / `ensureTeamHooks` / `ensureNotifyHooks` / `ensureManagedHooks` / `inspectManagedHooks` / `sweepLegacyNotifyShell` / `loadSettingsJson` / `WORKFLOW_BASE_HOOK_DEFS` / `TEAM_HOOK_DEFS` / `NOTIFY_HOOK_DEFS` / `syncAgentFiles` / `inspectManagedAgentFiles` / `readManagedAgentsManifest` / `writeManagedAgentsManifest` 等函数和常量；`linkToAgents` 加防御性跳过（误传 claude-code 时返回错误而不是继续处理）
- **`lib/installer.js::installToCanonical` 增强**：除复制 `core/` 的 6 个 TEMPLATE_DIRS 外，额外复制 `core/.claude-plugin/plugin.json` 到 canonical 的 `core/.claude-plugin/`、仓库根 `.claude-plugin/marketplace.json` 到 canonical 根的 `.claude-plugin/`，让 canonical 目录本身就是合法的 Claude Code plugin marketplace
- **`core/hooks/notify.js` config 路径三层 fallback**：`~/.claude/notify.config.json`（用户覆盖，新路径）→ `~/.claude/.agent-workflow/notify.config.json`（legacy 路径兼容）→ `${CLAUDE_PLUGIN_ROOT}/hooks/notify.config.default.json`（Plugin 自带默认）
- **`scripts/postinstall.js` 移除 claude-code fallback**：未检测到任何 agent 时不再默认安装 Claude Code；检测到 v5.x 残留时只打印迁移提示，不自动运行 sync（避免 npm install 时未经用户同意改动 ~/.claude/）
- **`scripts/release.sh` `[1.5/5]` 步骤**：在 `npm version` 之后调用 `sync-plugin-version.js`，把 package.json 版本同步到 plugin.json；git add 同步加入 `core/.claude-plugin/plugin.json` 和 `.claude-plugin/marketplace.json`

### Removed

- **installer 中的 Claude Code 特化代码** ~500 行（见上方 Changed 详细列表）
- **agents.js 中的 AGENTS_DIR 常量** 及 claude-code 的 skillsDir/agentsDir/globalSkillsDir/globalAgentsDir 字段（Plugin 自管，无须 installer 知晓）
- **installer.js module.exports 移除**：`ensureWorkflowHooks` / `ensureTeamHooks` / `ensureNotifyHooks` / `syncAgentFiles` / `inspectManagedAgentFiles` / `AGENTS_DIR`

## [5.3.1] - 2026-04-24

### Changed

- **fix-bug 新增 Code Specs Impact 四档强制定档（Phase 4.1）**：审查完成后必须显式输出 `code_specs_impact` ∈ `{spec_violation, spec_gap, contract_misread, spec_unrelated}`，并按档位填充 `code_specs_advisory`。`spec_violation` 需指向 `{pkg}/{layer}/{file}.md § {H3 子标题}`；`spec_gap` 附 Bad/Good 草案 + `/spec-update` 提示；`contract_misread` 指向 contract 的 `§ Validation & Error Matrix` 或 `§ Wrong vs Correct`；`spec_unrelated` 留空 advisory。兜底规则：`.claude/code-specs/` 不存在 → 统一判 `spec_unrelated`（避免虚假 advisory）。
- **fix-bug Phase 1.2 新增 code-spec 定位步**：按 codebase-retrieval 命中的文件路径提取 `{pkg}/{layer}`，读 `.claude/code-specs/{pkg}/{layer}/index.md` 的 Guidelines Index 表，定位相关 convention/contract 文件后读取 Common Mistakes + Rules 段（单文件 200 行预算）。未命中或 `.claude/code-specs/` 不存在时仅记录"未覆盖"，不阻断流程。Phase 1.8 输出、Phase 2 方案表均同步新增 `Code Specs 对照` 段
- **bug-batch 新增跨单元 Code Specs 归纳**：Phase 3 分析阶段为每个 `IssueRecord` 定位 `spec_hint`；Phase 5.5.1 单元级 review 通过后由主会话为每个 FixUnit 附加 `code_specs_impact` 字段（规则与 fix-bug 一致）；Phase 8 汇总时聚合全批次字段输出批量 advisory（同一文件被 2+ 单元标 `spec_gap` → 强建议 `/spec-update`；同一段落被 2+ 单元 `spec_violation` → 建议审视执行机制）。`references/status-and-reporting.md` 报告模板新增 `### Code Specs 归纳` 段
- **spec-before-dev 新增 Step 5.5 Active Common Mistakes**：对 Step 5 读过的每个 convention/contract 文件主动抽取 Common Mistakes 段下的 H3 子标题，按"轮询填充"策略（不按时间排序，spec 文件无 timestamp）分配到各文件，单文件最多 5 条、总量最多 10 条，只输出 `{文件名} § {H3 子标题}` 不复制 Bad/Good 代码。命中 digest 4096 字符预算上限时退化为"文件名 + 条数"
- **fix-bug Phase 4 章节编号调整**：4.1 原"状态流转就绪判断"下沉为 4.2，新的 4.1 承担"Code Specs Impact 定档"；4.2.x 相应重编号为 4.3.x（引用链同步更新）

## [5.3.0] - 2026-04-24

### Added

- **Legacy projectId 自动迁移（/scan Part -1 + CLI `migrate-project-id`）**：v5.2.x 及之前版本的纯 12 位 hex `project.id`（如 `8c5fd4f4930b`）在下次 `/scan` 时检测并提示迁移为新格式 `{name-slug}-{12位 hash}`（如 `claude-workflow-8c5fd4f4930b`）；用户确认后自动改写 `project-config.json` 并把 `~/.claude/workflows/{旧id}/` 重命名为新目录。新 CLI 子命令 `workflow_cli.js migrate-project-id`，默认 dry-run，`--apply` 执行；新 id 目录已存在时报错 `target_state_dir_exists`，不自动合并
- **workflow-review 新增 `multi_angle` 审查模式**：当 Stage 2 信号命中 `large_scope` 或 `refactor`（且未命中 dual_reviewer 前置信号 security / backend_heavy / data）时，分派 Reuse / Quality / Efficiency 三路只读子 Agent 并行审查，dedup 后合并为统一 finding 结构。任一角度 verified Critical/Important → Stage 2 fail；任一 Agent 5 分钟未返回 → 降级为 `single_reviewer (multi_angle degraded)`。三角度合并后只计 1 次 Stage 2 attempt，不突破 4 次共享预算。`role_injection.js` 新增 `resolveStage2ReviewMode(signals)` 统一路由，signals 新增 `refactor` / `large_scope` 标签（`large_scope` 触发：diff 文件 ≥10 或跨 3+ 层）
- **Stage 2 审查模式路由常量化**：`role_injection.js` 导出 `resolveStage2ReviewMode`，调用方直接消费返回值，不再在 SKILL 内做等价判断；`deriveSignalTags` 同步追加 `refactor` / `large_scope` 两个 tag
- **workflow-plan CLI 写入口契约**：SKILL.md 新增 `<CLI-CONTRACT>` 小节明确 `workflow_cli.js plan` 是规划状态机唯一写入口，Step 1 必须先调 CLI 建立 state 与骨架文件（`workflow-state.json` / spec.md / discussion-artifact.json / prd-spec-coverage.json / role-context.json，ux-design-artifact.json 按 `ux_gate_required` 条件创建），Step 5 / 7 只能 Edit 扩写骨架，禁止 Write 全量覆盖 spec.md / plan.md。HARD-GATE 从 3 条扩为 4 条，新增"Step 1 必调 CLI"硬约束
- **spec-review `--choice` canonical 枚举固化**：SKILL.md 显式列出 7 个精确匹配字符串（`Spec 正确，生成 Plan` / `Spec 正确，继续` / `需要修改 Spec` / `页面分层需要调整` / `缺少用户流程` / `缺少需求细节` / `需要拆分范围`），禁止把用户原话直接塞给 `--choice`，必须先归一化
- **Manifest 连续性预发布 gate**：新增 `scripts/check-manifest-continuity.js`，`scripts/release.sh` 在 `npm version` 前调用该脚本校验 npm 上每个已发布版本都有对应 `core/specs/spec-templates/manifests/v*.json`（pre-v5.1.0 的 4.0.0/4.1.0/5.0.0-5.0.3 在 `KNOWN_GAPS` 白名单内）。缺口会阻断 release；紧急情况可用 `SKIP_MANIFEST_CONTINUITY=1` 绕过，会打印黄色告警 banner
- **Validate 新增当前版本 manifest 存在性校验**：`scripts/validate.js` 在 prepublish 尾部检查 `core/specs/spec-templates/manifests/v${package.json.version}.json` 必须存在，防止 `scripts/generate-manifest.js` 静默失败仍走到 publish
- **fix-bug 入参归一化分支（Phase 1.1）**：支持两种入参形态——`issue_number`（按 `references/issue-intake.md` 读项目配置 + `mcp__mcp-router__get_issue`）、自由描述 bug（构造最小 IssueRecord，`status_transition_ready` 恒为 false，摘要标注"无缺陷单可流转"）
- **fix-bug 重复缺陷 best-effort 识别（Phase 1.7）**：仅在入参为 `issue_number` 时扫描同经办人或同模块下未关闭的缺陷（`mcp__mcp-router__list_issues`），候选放入 `included_issues` / `issues_covered_as_duplicates`，由用户决定合并与否。禁止自动合并；不确定时保持空数组
- **bug-batch FixUnit 新增元数据**：`merge_reason`（`primary` / `same_root_cause` / `coupled_with`）标注合并动机；`manual_intervention_reason` 必填于 `execution_status = manual_intervention`；`covered_by_unit` 指向覆盖它的 FixUnit
- **bug-batch `manual_intervention` 原因枚举**：9 档显式原因（`root_cause_mismatch` / `verification_failed` / `out_of_scope` / `review_rejected` / `materialization_failed` / `cross_unit_conflict` / `user_rejected` / `ambiguous_empty_change` / `cover_unit_failed`），覆盖 Phase 5 / 5.5 / 6 / 7 各触发点
- **AskUserQuestion 集成**：`workflow-delta` Step 1（变更类型识别）/ Step 5（应用决策）、`workflow-plan` Step 4（UX 审批）/ Step 6（Spec 审批）、`bug-batch` Phase 4（编排确认）/ 5.5.3（批量 review 方式）/ 5.5.5（BLOCKER 决策）、`fix-bug` 分支选择、`quick-plan` 决策点、`enhance` 改用 AskUserQuestion 取代自然语言自由回复

### Changed

- **projectId 生成规则**：从纯 12 位 hex 切换为 `{name-slug}-{12位 hash}`，slug 取 `path.basename(cwd)` 的 ASCII 字母数字 lowercase、`[^a-z0-9]+` 压为 `-`、截断 32 字符；slug 为空（如全中文目录名）时退回纯 hash 以保证跨平台可用
- **workflow runtime projectId 漂移修复**：`resolveWorkflowRuntime` / `buildExecuteEntry` / `cmdPlan` 不再 fallback 调用 `detectProjectId` / `stableProjectId` 重新计算，统一直读 `project-config.json` 的 `project.id`。CLI 传入的 `--project-id` 与 config 不一致时报 `project_id_mismatch`。根因：worktree / 子目录 / symlink 场景下运行时重算会与 /scan 时的 id 漂移
- **preflight Step 2 由"自愈"改为"硬性检查"**：`project-config.json` 不存在或 `project.id` 无效时直接报错引导用户执行 `/scan`（空项目 `/scan --init`），不再自动生成最小配置。理由：自动生成配置会在 worktree 场景产生新 id 漂移，应由用户显式触发
- **workflow-plan Step 2-4 工件契约反转**：`discussion-artifact.json` / `ux-design-artifact.json` / `prd-spec-coverage.json` 改由 CLI `plan` 创建骨架，AI 只按 canonical schema 填值（顶层 key 不得改名或新增）。`analysis-result.json` 仍由 AI 全权 Write。`prd-spec-coverage.json` 完全由 CLI 管理，AI 只读不写
- **core/CLAUDE.md v4.1 瘦身**：从 v4.0 的 173 行压缩到 34 行，抽取"Global Protocols / 协作路由 / 并行与 Team / 输出文风"四段；`Codex 调用`（sandbox、session、后台执行、review 模式）统一以 `collaborating-with-codex` skill contract 为准，不再在 CLAUDE.md 重复约定。`workflow` / `协作架构` / `动态协作模式` / `输出文风约束` 四大小节移除
- **bug-batch `execution_status` 重排**：旧 8 档（`analysis_pending` / `awaiting_batch_confirmation` / `ready_to_fix` / `fixing` / `awaiting_manual_verification` / `completed` / `manual_intervention` / `blocked`）压缩为 7 档并与 Phase 对齐（`pending` / `blocked` / `in_progress` / `completed` / `no_change_needed` / `covered_by_other` / `manual_intervention`）
- **bug-batch description 改口**：从"批量缺陷修复 — 拉取缺陷清单后，先完成全量诊断、重复/关联关系识别与修复单元编排..."改为更口语化的"批量修缺陷——从蓝鲸项目管理平台一次性拉一批 Bug，先做全量分析找出重复和共享根因再成组修..."
- **fix-bug Phase 1 重排**：1.1 输入归一化 / 1.2 检索上下文 / 1.3 识别问题类型 / 1.4 假设驱动根因追溯 / 1.5 失败与中止处理 / 1.6 红旗清单 / 1.7 重复缺陷识别 / 1.8 Phase 1 输出 / 1.9 manual_intervention 原因表。旧"失败计数器"小节升级为显式的 `manual_intervention` + `verification_failed` 触发路径
- **team.md 启动决策扩为 4 项**：新增"队友命名"（显式指定名字否则系统随机，影响后续 SendMessage 可预测性）；spawn 初始 message 新增 6 条必含项（任务上下文自带 / 直连规则 / 任务板自认领 / 完成交付格式 / 权限申请 / subagent 行为告知）；补充"显示模式由 `~/.claude.json` 的 `teammateMode` 决定"、"官方已知限制"、"故障排除"三段
- **README.md Hook 说明清理**：从"6 个 hook 脚本 / 三类"改为"4 个 hook 脚本 / 两类"，删除 `WorktreeCreate` / `WorktreeRemove` 相关配置示例与故障排查；参考文档移除 `docs/worktree-hooks.md`

### Removed

- **删除 worktree 串行化 hooks**：`core/hooks/worktree-serialize.js` / `core/hooks/worktree-cleanup.js` / `docs/worktree-hooks.md` 整体删除（共 -605 行）。理由：并行批次 provisioning 不再需要内核级串行锁，`merge_strategist.js` + `dispatching-parallel-agents` 已经覆盖并发安全
- **移除 Hook 配置中的 WorktreeCreate / WorktreeRemove 注册**：新装项目 `sync` 不再注入这两类 hook；已有项目本次升级不自动清理 `settings.json`（保留用户历史配置），建议手动删除对应条目
- **execution_sequencer / lifecycle_cmds 移除 projectId fallback**：`buildExecuteEntry` 与 `cmdPlan` 不再走 `detectProjectId(String(projectRoot))` 兜底；缺 config 直接返回 `missing_project_config` + `reason` 字段
- **workflow-plan 预检不再"配置自愈"**：旧 `ensureProjectConfig` 调用链在 `cmdPlan` 中改为 `loadProjectConfig` + 显式校验；`started.config_healed` 字段恒为 `false`

## [5.2.0] - 2026-04-20

### Changed

- **workflow-execute SKILL.md 文档瘦身**：移除与 checklist 重复的 ASCII 流程图与批量化示例，checkpoint 示例合并为单行，Post-Execution Pipeline 顺序编号从 "①–⑥ + ⑤ Journal" 纠正为 "①–⑤"。行为不变，仅文档表述精简
- **workflow-review SKILL.md 审查说明重构**：
  - Stage 1 子检查说明压缩为一行 + 引用 `references/cross-layer-checklist.md` / `stage1-code-specs-check.md`，不在 SKILL 内重复 Probe A–E 触发条件与 advisory 硬约束
  - 统一使用"子 Agent"表述替换历史 `sub-Agent` / `sub Agent` 混写
  - CLI 写入失败的降级路径从"用 `--base-commit HEAD --current-commit HEAD` 绕过"改为"先重试 → 修复 `initial_head_commit` → 只有 CLI 本身不可用才允许标注 `(CLI unavailable)`"；禁止手动编辑 `quality_gates.*`
  - 删除与 checklist 冗余的 "审查结果的写入者始终是 CLI/runtime" 顶栏提示
- **session-review 默认行为反转**：
  - 旧：默认 Step 3 会展示清单并等待用户确认，`--no-confirm` 跳过
  - 新：默认展示清单后直接进入审查；新增 `--confirm` 显式要求暂停等待用户调整清单
  - `--no-confirm` 参数移除，不保留兼容

## [5.1.0] - 2026-04-20

### Changed (目录改名：knowledge → code-specs)

- `.claude/knowledge/` 重命名为 `.claude/code-specs/`；skill/命令名已是 `spec-*`，目录名同步到"code spec"语义，避免与 `/workflow-plan` 写入的 `.claude/specs/` 任务 spec 混淆
- `project-config.json` 中 `knowledge.bootstrapStatus` / `updatedAt` 字段改名为 `codeSpecs.bootstrapStatus` / `codeSpecs.updatedAt`
- Workflow state 字段 `stage1.knowledge_check` 改名为 `stage1.code_specs_check`；相关 CLI 参数 `--knowledge-performed` / `--knowledge-findings` 改名为 `--code-specs-performed` / `--code-specs-findings`
- Hook 注入标签 `<project-knowledge>` 改名为 `<project-code-specs>`
- Spec 模板中 `3.x Project Knowledge Constraints` 小节改名为 `3.x Project Code Specs Constraints`；模板占位符 `{{knowledge_constraints}}` 改名为 `{{code_specs_constraints}}`
- 内部函数：`getKnowledgeDir` → `getCodeSpecsDir`、`getKnowledgeContext*` → `getCodeSpecsContext*`、`resolveActiveKnowledgeScope` → `resolveActiveCodeSpecsScope`、`initKnowledgeSkeleton` → `initCodeSpecsSkeleton`、`countKnowledgeStats` → `countCodeSpecsStats`、`stripProjectKnowledgeSection` → `stripProjectCodeSpecsSection`
- 不保留旧路径/字段兼容（本特性未发版）

### Changed (v6.1 纠偏：Code Specs 行为面重新对齐 Trellis)

> 上一版 `Unreleased` 的 "Knowledge 设计全量对齐 Trellis" 表述被 Codex 联合审查认定为过度声称——schema 层对齐，但行为层（per-change check、infra gate）相比 Trellis 的 `/check` + `/finish-work` 仍是 drift。本次在保持"不复刻 Trellis 运行时（task.json / journaling / ralph-loop）"前提下，把以下行为面补齐：

- **workflow-review Stage 1 新增 Knowledge Spec Check 子步（advisory）**：按 diff 文件反查 `{pkg}/{layer}/` 下的 code-spec，列出缺失 / 偏差 / 建议。诊断不消耗 Stage 1 / Stage 2 的 4 次共享预算，写入 `state.quality_gates[taskId].stage1.knowledge_check`；CLI 新增 `--knowledge-performed` / `--knowledge-findings` 参数。参见 `core/skills/workflow-review/references/stage1-knowledge-check.md`
- **cross-layer-checklist 新增 § E Infra 深度 Gate（阻塞）**：命中 infra / cross-layer 关键路径（`src/api/**`、`src/migrations/**`、`auth/**`、`services/**` 等）且关联 code-spec 存在但 7 段里 `Validation & Error Matrix` / `Good / Base / Bad Cases` / `Tests Required` 任一缺失时，Stage 1 fail。`role_injection.js` 新增 `classifyInfraDepth(files)`；`quality_review.js` 新增 `--cross-layer-depth-gap` / `--cross-layer-files` / `--cross-layer-specs` / `--cross-layer-missing-sections` 参数，阻塞项写入 `stage1.cross_layer_depth_gap` 并合并进 `blocking_issues`
- **task-aware 预注入**：`plan-template.md` 新增可选字段 `Target Layer`；`task_parser.js` 与 `task_runtime.js` 把 `target_layer` 以及任务已声明的变更文件透传到 `resolveActiveKnowledgeScope` → `getKnowledgeContextScoped`，做 layer + file-hint 二次裁剪；`pre-execute-inject.js` 的 `<project-knowledge>` 标签新增 `layer="..."` 与 `hints="N"` 属性
- **平台一致性契约**：新增 `core/specs/platform-parity.md` 与 `core/utils/platform_parity.js`；`scripts/validate.js` 在 prepublish 时校验 `lib/agents.js` 覆盖 9 个 agent、每 agent 字段完整、`lib/installer.js` 的 `TEMPLATE_DIRS` / `MANAGED_DIRS` / `COMMANDS_DIR` / `SKILLS_DIR` / `MANAGED_NAMESPACE_DIR` 与 `core/` 实际结构一致、每个 skill 目录都含 `SKILL.md`
- **契约测试锁定 Trellis 对齐面**：新增 `core/utils/workflow/template_contracts.js`（验证 code-spec 7 段 / layer-index 4 段 / guides-index 6 段的精确标题）、`tests/test_knowledge_contracts.js`、`tests/test_quality_review_stage1.js`、`tests/test_task_aware_injection.js`，并在 `scripts/validate.js` 末尾以 `node --test` 跑一次，prepublish 不通过即 CI fail
- **向后兼容**：旧 plan（无 `Target Layer`、无 `Changed Files`）行为与现状一致；未命中 Probe E 的 PR 走 `/workflow-review` 与现状一致；legacy `quality_gates[taskId].stage1` 缺少 `knowledge_check` 时 `normalizeQualityGateRecord` 会补一个 advisory 占位

> 诚实对齐声明（Codex 建议措辞）：Knowledge schema 与读取链路对齐 Trellis：package/layer 布局、7 段 code-spec、thinking guides、before-dev、session/task 注入遵循 Trellis 模型。**Enforcement 与 runtime 保持 agent-workflow 自己的设计**：本版本未复刻 Trellis 的 `/check` + `/finish-work` gate、task-json 生命周期、journaling、ralph-loop 编排；v6.1 起 per-change knowledge check 以 workflow-review Stage 1 advisory 子步回归，infra / cross-layer 深度 gate 以 Probe E 升级为阻塞。

### Changed (Knowledge 设计全量对齐 Trellis)

- **目录布局**：`.claude/knowledge/` 从顶层 `{frontend, backend, guides}/` 切换为二维 `{pkg}/{layer}/` + 共享 `guides/`，单包项目也走单例 `{project-name}/{layer}/` 布局
- **Code-spec 结构**：统一采用 Trellis 7 段合约（Scope / Trigger · Signatures · Contracts · Validation & Error Matrix · Good-Base-Bad Cases · Tests Required · Wrong vs Correct），每段必填具体文件路径 / API 名 / 字段名 / 测试名，不接受抽象描述
- **模板**：`layer-index-template.md` 升级为 4 段（Overview · Guidelines Index · Pre-Development Checklist · Quality Check）；新增 `guides-index-template.md` 6 段（含 Pre-Modification Rule、How to Use This Directory、Contributing）；`local-template.md` 按 package × layer 重写
- **Skill 行为**：
  - `/spec-bootstrap` 支持 `monorepo.packages` 自动判 package，缺省时自动从 `pnpm-workspace.yaml` / `package.json#workspaces` / `lerna.json` 解析 workspace；新增 `--reset` 破坏性重建；检测到旧顶层布局则报错不自动迁移
  - `/spec-update` 删除 6 类片段交互分支，改为 7 段 code-spec 或 thinking guide 引导
  - `/spec-review` 升级为 7 段完整性 lint + canonical / manifest 对账

### Changed (/team 迁移到 Claude Code 原生 Agent Teams)

- `/team` 命令不再由独立 skill + team-runtime 承接，直接调用 Claude Code 原生 Agent Teams
- 命令行为统一由 `core/commands/team.md` 定义，要求 Claude Code ≥ v2.1.32 且 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`，启动前做 preflight，不满足直接拒绝
- 收尾协议：Lead 收到队友的"任务板已清空"message 后执行 `clean up team`；失败时通过 `AskUserQuestion` 弹出 `retry_cleanup / force_cleanup / keep_team` 三个快捷选项
- 官方硬约束被显式写入命令与 `core/CLAUDE.md`：一会话一个 team、不可嵌套、Lead 固定不可转移、权限 spawn 时继承不可按队友设置
- `/team` 仅在用户显式输入时生效；`/workflow-*` / `/quick-plan` / `dispatching-parallel-agents` / 自然语言宽泛请求都不再路由到 team

### Added

- **`/spec-before-dev` skill + command**：动手写代码前显式读一遍当前 package/layer 的 Pre-Development Checklist。对齐 Trellis `$before-dev`，把 `{pkg}/{layer}/index.md` 展开成一次具体的阅读动作，而不是依赖 hook 的 advisory 摘要。参数解析顺序复用 `resolveActiveKnowledgeScope`（`--package` → active task 的 `Package` 字段 → 项目单包名），未能解析时 soft-fail 不报错。与 `session-start` hook 的 `overview` 注入、`pre-execute` hook 的 `scoped context` 注入形成三层知识入口：overview → scoped → explicit digest
- **Team Hooks**：`core/hooks/team-idle.js`（TeammateIdle）+ `core/hooks/team-task-guard.js`（TaskCreated / TaskCompleted）
  - `team-idle`：仅在 payload 带 `team_name` 时生效；任务板仍有未完成任务 → 退码 2 阻止 idle；任务板清空 → 通过 stderr 指示队友给 Lead 发 message 后放行，Lead 侧收到 message 再执行 `clean up team`，hook 不代行 Lead-only 指令
  - `team-task-guard`：TaskCreated 要求有 `task_subject`；TaskCompleted 要求无 TODO / FIXME / 待验证 / 待补充 字眼并带实际验证证据，否则退码 2 拒绝
  - 安装时自动写入 `~/.claude/settings.json`；项目级安装跳过注入
- **`agent-workflow link` CLI**：新增 `link` 子命令，只刷新受管链接而不重新拷贝 canonical 载荷，便于本地开发把受管目录指回仓库 `core/`
- **发布管线 manifest 生成**：`scripts/release.sh` 将版本 bump 拆为 5 步，新增 `scripts/generate-manifest.js` 生成 spec-template 迁移 manifest 与 docs-site changelog，并把产物一并纳入 release commit

### Removed (激进对齐 Trellis 声明式模型 + /team 原生化)

- `/knowledge-check` 命令与同名 skill 整体删除
- `core/utils/workflow/knowledge_compliance.js` 机读规则引擎删除
- `tests/test_knowledge_compliance.js` 与 `tests/test_knowledge_compliance_gate.js` 删除
- `core/specs/spec-templates/guideline-template.md`（6 类片段风格）删除
- `## Machine-checkable Rules` YAML 块约定废弃
- `workflow-review` Stage 1 不再调用 `/knowledge-check` 硬卡口；改为人工对照 code-spec 审查
- `core/utils/workflow/quality_review.js` 移除 `knowledge_compliance` 引用、`--skip-knowledge-compliance` flag、`knowledge_compliance` gate 字段
- `core/skills/team/` 与 `core/skills/team-workflow/` 两个 skill 整体删除
- `core/specs/team-runtime/`（overview / state-machine / execute-entry / status / archive）与 `core/specs/team-templates/`（plan / spec 模板）整体删除
- `core/utils/team/` 下 team runtime 脚本（`team-cli.js` / `lifecycle.js` / `state-manager.js` / `task-board*.js` / `phase-controller.js` / `governance.js` / `status-renderer.js` / `planning-*.js` / `templates.js` / `doc-contracts.js`）整体删除
- `tests/test_team_cli_commands.js` / `tests/test_phase_controller_enhanced.js` 删除；`tests/test_workflow_helpers.js` 同步移除 team helper 相关断言
- `docs/implementation_plan.md` 历史方案文档删除

### Notes

- 初版 knowledge 体系（6 类片段 + 机读规则硬卡 + `/knowledge-check`）未曾发版，本次变更未保留任何向后兼容，一次性替换为 Trellis 对齐设计（skill 命名已于 5.0.4 后期统一为 `spec-*`）
- 原 `/team` 重型 runtime 同样未稳定发版，直接移除而不提供迁移路径；已有 `team-state.json` 的用户请手动归档或忽略
- `/workflow-plan` Step 1.5 的 advisory knowledge 读取保留；Spec 模板的 `3.x Project Knowledge Constraints` 小节保留
- `/scan` Part 5 引导 `/spec-bootstrap` 的逻辑保留（面向新布局）
- `session-start.js` 注入 `<project-knowledge>` 段与 `pre-execute-inject.js` 的 team 继承隔离校验保留（普通 workflow session 依然不继承 team runtime 脏上下文）

## [5.0.3] - 2026-04-16

### Changed

- **diff-review 审查模式文档细化**：澄清 Quick / Deep 模式的入口门槛、执行流程与报告结构，减少模式路由歧义

### Removed

- **过时的 PR / Quick 审查文档**：删除与当前 impact-aware 管线不再匹配的历史 PR review 与 Quick 模式说明

## [5.0.2] - 2026-04-16

### Changed

- **figma-ui skill 文档增强**：补充详细的使用指南、前置条件与排障步骤，覆盖资源分诊、编码与验证阶段的常见问题

## [5.0.1] - 2026-04-14

### Changed

- **diff-review Deep 模式执行要求澄清**：明确 Deep 模式必须通过 Codex 完成候选问题发现，防止在未实际调用外部模型的情况下提前降级为 Quick 模式

## [5.0.0] - 2026-04-13

### Added

- **并行批次执行与集成 worktree**：新增 `batch_orchestrator.js`（config / select-batch / dispatchReadonlyBatch）与 `merge_strategist.js`（create-integration / merge-integration / discard-integration / finalMergeToMain）
  - 只读批次不 provision worktree，产物落到 `~/.claude/workflows/{projectId}/artifacts/{groupId}/`
  - 写文件批次先串行 provision worktree，再并行启动子 Agent，合流到集成 worktree 中跑 stage2 审查；失败则丢弃集成 worktree，任务回 `pending`
  - 含 `git_commit` / `quality_review` action 的任务被排除出并行批次
  - 状态机扩展 `parallel_execution`、`parallel_groups[]`、`task_runtime.dispatch_mode`、`BatchQualityGateResult`（`scope: 'batch'`）等字段，详见 `core/specs/workflow/state-machine.md`
- **`/session-review` skill**：审查当前会话内本模型产生的改动（基于 Edit/Write/NotebookEdit 记录），压缩 / `/clear` 检测命中即硬停，不回退到 git diff；Codex prompt 显式限定范围；共享 `diff-review` 的 Layer C-H 管线
- **workflow-plan Codex Spec/Plan Review 节点**：Step 5.5 Codex Spec Review（条件，advisory）与 Step 7.5 Codex Plan Review（条件，bounded-autofix）
- **工作流辅助助手**：`core/utils/workflow/` 新增若干辅助函数及 `tests/test_workflow_helpers.js`

### Changed

- **`workflow-execute` 并行判定入口迁至 `batch_orchestrator`**：`dispatching-parallel-agents` 仅负责底层分派；`buildExecuteEntry()` 在活跃批次上下文下返回 `result.batch`，skill 必须以 `dispatching-parallel-agents` 为入口
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
