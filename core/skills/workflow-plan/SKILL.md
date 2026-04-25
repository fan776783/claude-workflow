---
name: workflow-plan
description: "/workflow-plan 入口。代码分析 → 需求讨论 → UX 设计 → Spec 生成 → 用户审批 → Plan 生成。"
---

<PATH-CONVENTION>
所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。
该路径在 `npm install` 后始终存在，所有 agent 共享，无需动态解析。
</PATH-CONVENTION>

<CLI-CONTRACT>
**workflow_cli.js 是 planning 状态机的唯一写入口**。绕过 CLI 手写 spec / plan / 工件会让 `workflow-state.json` 缺失，下一会话 `/workflow-execute` 无法恢复。

Step → 必调命令映射：

| Step | 必调子命令 | 作用 |
|------|----------|------|
| Step 1 | `plan "<需求>"` | 创建 workflow-state.json（status=`spec_review`）+ spec.md 骨架 + discussion / prd-spec-coverage / role-context 骨架（ux-design 骨架按需） |
| Step 5 开始前 | `status` | 健康检查：`spec_file` 就绪、`status=spec_review` |
| Step 6 | `spec-review --choice "<canonical>"` | 推进状态机；approve 分支会生成 plan.md 骨架并推到 `planned` |
| Step 7 开始前 | `status` | 健康检查：`plan_file` 就绪、`status=planned`、`current_tasks` 非空 |

`spec-review` 的 `--choice` 只接受下面 7 个 canonical 字符串之一（精确匹配，来自 `planning_gates.js:142`）。**禁止把用户原话直接塞给 `--choice`，必须先归一化**：

| canonical 字符串 | 分支含义 |
|---|---|
| `Spec 正确，生成 Plan` | approve，继续 Plan 生成 |
| `Spec 正确，继续` | approve，继续流程 |
| `需要修改 Spec` | 回到 Phase 1 Spec 生成 |
| `页面分层需要调整` | 回到 Phase 0.3 UX 审批 |
| `缺少用户流程` | 回到 Phase 0.3 UX 审批 |
| `缺少需求细节` | 回到 Phase 1，保留需求细节 |
| `需要拆分范围` | 拒绝，状态回 idle |

⚠️ `init` 子命令是**执行期**状态丢失时的自愈入口，**规划期禁用**。规划期应通过 `plan` 建立 state，`init` 在发现多个历史 plan 时会直接报错。
</CLI-CONTRACT>

# workflow-plan

> 本 skill 是 `/workflow-plan` 的完整行动指南。

<HARD-GATE>
四条不可违反的规则：
1. Spec 未经用户确认，不得进入 Plan 扩写
2. 讨论/UX 设计产物必须持久化为 JSON 文件，不得仅在对话中存在
3. Plan 中不允许任何 TBD/TODO/占位符
4. **Step 1 必须先调 `workflow_cli.js plan` 建立 state 与骨架文件，后续 Step 只能在骨架上 Edit 扩写，禁止 Write 全量覆盖 spec.md / plan.md**
</HARD-GATE>

> 🔧 **自愈例外**：会话丢失重建 state 时，CLI `init` 按 spec 文件存在性推断审批状态（`system-recovery` 标记，非用户主权审批）。详见 `workflow-execute` SKILL.md Step 2。此例外仅限执行期，规划期不得触发。

## Checklist（按序执行）

1. ☐ 解析参数 + 基础设施预检
2. ☐ 代码库分析（强制）
3. ☐ 需求讨论（条件）
4. ☐ UX 设计审批（条件 HARD-GATE）
5. ☐ Spec 扩写（在 CLI 骨架上）+ Self-Review
5.5. ☐ Codex Spec Review（条件，advisory）
6. ☐ 🛑 用户审批 Spec
7. ☐ Plan 扩写（在 CLI 骨架上）+ Self-Review
7.5. ☐ Codex Plan Review（条件，bounded-autofix）
8. ☐ 🛑 规划完成（Hard Stop）

---

## Step 1: 解析参数 + 预检

**参数格式**：

- 内联需求：`/workflow-plan "实现用户认证功能"`
- 文件需求：`/workflow-plan docs/prd.md`（自动检测 `.md` 文件是否存在）
- 强制覆盖：`/workflow-plan -f "需求描述"`
- 跳过讨论：`/workflow-plan --no-discuss "需求描述"`

**参数解析后立即执行预检**（详见 [`../../specs/workflow-runtime/preflight.md`](../../specs/workflow-runtime/preflight.md)）：

1. **Git 状态检查** — 确认 git 仓库已初始化且有初始提交。无 git 时用户显式选择降级或暂停。
2. **项目配置检查** — `project-config.json` 不存在或 `project.id` 无效时报错并引导用户先跑 `/scan`（空项目使用 `/scan --init`）。不再自动生成最小配置。
3. **工作流状态检测** — 检查是否存在未归档的工作流。存在时根据状态（running/paused/failed/completed）提示用户恢复、覆盖或归档。
4. **projectId 获取** — 直接读 `project-config.json` 的 `project.id`，**不要**在此处或任何下游入口调用 `stableProjectId()` 重新计算（只有 `/scan` 初始化 / 迁移时才允许）。禁止 shell 手动哈希。

### 预检通过后：强制调用 `workflow_cli.js plan`

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" \
  plan "<原始需求原文或 PRD 文件路径>"
```

**CLI 此刻会落盘**：

- `workflow-state.json`（status=`spec_review`）
- `spec.md` 骨架（带模板 front matter）—— 注意 plan.md **不在此时生成**
- `discussion-artifact.json` / `prd-spec-coverage.json` / `role-context.json` 骨架
- `ux-design-artifact.json` 骨架（仅当 `ux_gate_required=true` 时，由 CLI 按需求关键词与代码分析结果判断）

**何时生成 plan.md**：Step 6 调用 `spec-review --choice "Spec 正确，生成 Plan"` 时，CLI 读取已扩写好的 spec.md，调用 `buildRequirementCoverageFromSpec` + `buildPlanTasks` 首次生成 plan.md 骨架，并把状态推进到 `planned`。

**后续 Step 的契约**：

- Step 2-4 不是"从零写 JSON 工件"，而是**读取骨架按 canonical schema 填值**。若 `ux_gate_required=false` 跳过了 ux 骨架创建，Step 4 触发时再判断是否需要手动补一份最小骨架。
- Step 5 在 spec.md 骨架上 Edit 扩写；Step 7 在 spec-review approve 后生成的 plan.md 骨架上 Edit 扩写。**禁止 Write 全量覆盖**，禁止删除或重命名 front matter 字段（`version` / `requirement_source` / `created_at` / `spec_file` / `status` / `role` / `role_profile` / `context_profile` / `prd_coverage`），禁止变更 CLI 已生成的 task ID，尤其首个 task ID。

**错误处理**：

- CLI 返回 `已存在未归档工作流` → 回到预检 Step 3 让用户选择归档 / 恢复 / `--force` 覆盖。**不得改用 `init` 子命令**——`init` 是执行期自愈入口，规划期调用会因多历史 plan 报错。
- CLI 返回其他错误 → 直接展示给用户，不自行推进。

---

## Step 1.5: Code Specs 读取（advisory）

**目的**：将 `.claude/code-specs/` 作为 Constraints 参考输入，供 Step 4 Spec 生成使用。

**行为**：

1. 若 `.claude/code-specs/` 目录存在：通过 `getCodeSpecsContextScoped()`（`core/utils/workflow/task_runtime.js`）按当前 plan 推断的 package 读取子树内容——根 `index.md`、`{pkg}/{layer}/index.md`、已填充规范文件 + 共享 `guides/`，汇总成 Constraints 摘要。Package 推断走 `inferTaskPackage`（单包→`project.name` / `package.json#name` / 仓库目录名；monorepo→`monorepo.defaultPackage` → `monorepo.packages[0]`）；若仍无可用 package 或对应目录不存在，再回退全树视角（plan-phase 一次性编译，不同于 runtime hook 的 scope 注入策略）。
2. 若目录不存在且 `project-config.json` 中 `codeSpecs.bootstrapStatus !== 'skipped'`：输出 advisory 提示：
   ```
   💡 未检测到项目 code-specs，建议执行 /spec-bootstrap 建立骨架并用 /spec-update 沉淀规范。
   ```
3. 不阻塞流程，不修改任何文件。

> Bootstrap 与 code-specs 填充已迁移至 `/scan` Part 5 与 `/spec-bootstrap` / `/spec-update` 命令链。

---

## Step 2: 代码库分析（强制）

**目的**：在设计前理解代码库，复用现有实现。

**宣告**：`📊 Phase 0: 代码分析`

使用代码检索能力分析与需求相关的代码，提取：

1. **相关文件** — 可复用或需修改的现有实现
2. **可复用组件** — 可继承的基类、工具类
3. **架构模式** — 相似功能的实现参考（如 Repository Pattern、Error Boundary）
4. **技术约束** — 数据库、框架、规范、错误处理模式
5. **依赖关系** — 内部和外部依赖

**持久化**：分析结果写入 `~/.claude/workflows/{projectId}/analysis-result.json`。此工件由 AI 全权产出（非 CLI 管理），可直接 Write。后续阶段优先从文件加载，避免重复分析。

> 工件结构参见 [`references/artifact-schemas.md`](references/artifact-schemas.md) § analysis-result.json

### Code Specs Freshness Check（条件）

当 `.claude/code-specs/` 存在时，在代码分析结尾执行过期检测：

1. 根据当前需求确定涉及的层（frontend / backend / guides）
2. 仅对涉及层的 Filled 状态文件，用 `git log -1 --format=%ct` 检查最后修改时间
3. 若文件超过 30 天未更新：输出 `⚠️ code-specs/{layer}/{file} 已 {N} 天未更新，建议 review 后更新`
4. 不阻塞流程，仅 advisory；不涉及的层不检查

> 选 30 天为阈值，是为了覆盖一个常见迭代节奏——比这更短容易对稳定模块频繁告警，更长则容易让 plan 参考已经过时的约定。检查仅限需求涉及到的层，避免每次规划都扫全库制造噪声。

---

## Step 3: 需求讨论（条件）

**目的**：通过交互式对话发现需求中的模糊点、缺失项和隐含假设。

**宣告**：`💬 Phase 0.2: 需求分析讨论`

**跳过条件**：用户指定 `--no-discuss`，或内联需求 ≤100 字符且预分析无待澄清项。

**讨论流程**：

1. **需求预分析** — 基于代码分析结果，识别待澄清事项。检查维度：
   - 范围边界（模糊范围词如"等功能"、"相关"）
   - 行为定义（导入导出、通知、审批、搜索的细节）
   - 边界场景（空状态、删除策略、失败处理）
   - 权限与角色
   - 非功能性需求（性能、数据量级）
   - 技术约束冲突
   - 外部依赖就绪度
   - UX 导航结构与首次使用

2. **逐个澄清** — 按优先级排序，每次只问一个问题。优先使用选择题。每轮最多 5 题，用户可随时「跳过此问题」或「结束讨论」。

3. **方案探索（条件）** — 仅在存在互斥实现路径或显著技术 tradeoff 时触发。展示 2-3 个方案，含优劣分析和推荐。

4. **技术决策反写** — 讨论中确认的技术选型（框架、包管理器等）反写到 `project-config.json`。

**持久化**：`discussion-artifact.json` 已由 Step 1 的 CLI `plan` 调用创建骨架，本 Step 读取该骨架后**按 canonical schema 填充业务内容**，不改顶层 key。

canonical schema 顶层字段（来自 `planning_gates.js` `buildDiscussionArtifact`）：

```json
{
  "requirementSource": "...",
  "clarifications": [ /* 澄清问答条目 */ ],
  "selectedApproach": { /* 方案探索命中时填 */ },
  "unresolvedDependencies": [ /* 未就绪的外部依赖 */ ]
}
```

> ⚠️ 不得仅依赖对话上下文记忆。Phase 1 Spec 扩写会读取此文件。即使无待澄清项，骨架也必须保留，只在各字段填空或 `[]`。
>
> 工件结构参见 [`references/artifact-schemas.md`](references/artifact-schemas.md) § discussion-artifact.json

---

## Step 4: UX 设计审批（条件 HARD-GATE）

**目的**：Spec 生成前完成用户操作流程图和页面分层设计。

**宣告**：`🎨 Phase 0.3: UX 设计审批`

**触发条件**：需求涉及页面/界面/交互/GUI/桌面应用关键词，或代码分析检测到前端框架，或讨论中涉及交互行为/边界场景。纯后端/CLI 项目自动跳过。

**设计流程**：

1. **生成用户操作流程图** — Mermaid 格式，必须覆盖至少 3 个场景：
   - **首次使用**：新用户的引导路径
   - **核心操作**：从入口到完成核心功能
   - **异常/边界**：操作失败、数据为空、权限不足
   - 返回/取消路径

2. **页面分层设计** — 明确每个功能放在哪个层级：
   - **L0 首页**：用户打开应用的第一个页面（≤ 4 个功能模块）
   - **L1 功能页**：需要导航切换的独立页面
   - **L2 辅助面板**：内嵌在 L1 中的辅助区域

3. **HARD-GATE 用户审批** — 展示流程图和分层设计后，调用 `AskUserQuestion` 收集决策，`question` 写"UX 设计是否可进入 Spec 生成？"，`options` 给 4 条：

   - `approve` — 设计合理，进入 Spec 生成
   - `revise_flow` — 需要调整流程，用户描述修改后重新生成流程图
   - `revise_hierarchy` — 需要调整分层，修改信息架构后重审
   - `add_scenarios` — 需要补充场景，添加遗漏场景后重审

   用户选择 `revise_*` / `add_scenarios` 时，按对应路径重做设计再发起一次 AskUserQuestion。

**持久化**：`ux-design-artifact.json` 已由 Step 1 的 CLI `plan` 调用创建骨架，本 Step 读取该骨架后**按 canonical schema 填充业务内容**，不改顶层 key。

canonical schema 顶层字段（来自 `lifecycle_cmds.js cmdPlan` ux 分支）：

```json
{
  "flowchart": { "mermaidCode": "...", "scenarios": [ /* 至少 3 个场景 */ ] },
  "pageHierarchy": { "pages": [ /* L0/L1/L2 分层 */ ], "navigation": { ... } },
  "detectedWorkspaces": [ /* 工作区检测结果，无则 [] */ ]
}
```

> ⚠️ 设计审批通过但骨架未被填值 = 执行违规。Phase 1 Spec 扩写会读取此文件。
>
> 工件结构参见 [`references/artifact-schemas.md`](references/artifact-schemas.md) § ux-design-artifact.json

---

## Step 5: Spec 扩写（在 CLI 骨架上）+ Self-Review

**目的**：在 Step 1 CLI 创建的 `spec.md` 骨架上扩写业务内容，完成需求范围判定、架构设计、验收标准和关键约束。

**宣告**：`📘 Phase 1: Spec 扩写`

**健康检查**（开始扩写前执行）：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" status
```

确认返回结果中 `spec_file` 字段已就绪、`status=spec_review`（Step 5 发生在 Step 6 approve 之前，此阶段状态只能是 `spec_review`；若见到 `planned` 说明流程已越过 Step 6，应改走 Step 7）。若异常，回到 Step 1 调 `plan` 重建骨架——**禁止直接读 `workflow-state.json` 或用 `cat | jq` 判断**，状态路径与 legacy 兼容统一由 CLI 处理。

**扩写硬约束**：

- 用 Edit 逐节扩写骨架内容，**禁止 Write 全量覆盖 spec.md**
- 不得删除或重命名 YAML front matter 字段（`version` / `requirement_source` / `created_at` / `spec_file` / `status` / `role` / `prd_coverage` 等）
- 不得改动模板章节标题或锚点；只在正文内扩展

**输入**：
- 需求内容（PRD 或内联）
- `analysis-result.json`（代码分析结果）
- `discussion-artifact.json`（已在 Step 3 按 schema 填值）
- `ux-design-artifact.json`（已在 Step 4 按 schema 填值）
- `.claude/code-specs/` 下与当前需求相关的规范文件（如有，作为 Constraints 参考输入）

**输出**：在既有 `.claude/specs/{task-name}.md` 骨架上 Edit 扩写（路径由 CLI 生成，不得手动改名）

**Spec 核心章节**：

1. **Context** — 背景和目标
2. **Scope** — in-scope / out-of-scope / blocked 需求判定
3. **Constraints** — 不可协商的硬约束 + 讨论澄清结果摘要 + UX 工作区约束
4. **User-facing Behavior** — 正常/异常/边界行为 + UX 流程图（如有）
5. **Architecture and Module Design** — 模块划分 + 技术选型 + 页面分层（如有）
6. **File Structure** — 新建/修改/测试文件
7. **Acceptance Criteria** — 按模块的验收条件
8. **Implementation Slices** — 渐进交付切片
9. **Open Questions** — 待确认问题

**Spec 是 Plan 的唯一权威上游**。

**Self-Review**：生成后立即执行。详见 [`references/spec-self-review.md`](references/spec-self-review.md)。必须输出执行摘要：覆盖率（`X/Y 段覆盖`）+ placeholder 扫描（`0 个` / `N 个已修复`）+ 一致性结果。不得仅标记完成而无实际检查输出。

**覆盖率报告持久化**：`prd-spec-coverage.json`，供 User Spec Review 展示。

> 工件结构参见 [`references/artifact-schemas.md`](references/artifact-schemas.md) § prd-spec-coverage.json

---

## Step 5.5: Codex Spec Review（条件，advisory-to-human）

**目的**：引入 Codex 作为独立审查视角，在用户审批前发现架构盲区和技术可行性问题。

**Phase 编号**：1.2.5（conditional `machine_loop`）

**治理模式**：`advisory-to-human` — Codex 发现不自动修复 Spec，作为 Step 6 Human Gate 的参考输入展示给用户。

**触发条件**：从 `workflow-state.json` 的 `context_injection.planning.codex_spec_review.triggered` 读取。触发逻辑由 `planning_gates.js shouldRunCodexSpecReview()` 在 CLI 生成阶段预计算，基于结构化信号（security / backend_heavy / data）+ 补充关键词匹配。

**未触发时**：输出 `⏭️ Codex Spec Review: skipped`，直接进入 Step 6。

**执行流程**：详见 [`references/codex-spec-review.md`](references/codex-spec-review.md)。

**摘要输出**：
```
🔍 Codex Spec Review: {n} issues found (critical: {x}, important: {y})
```

**与 Step 6 的衔接**：Step 6 Human Gate 展示时增加一栏 "Codex 审查发现"，用户可选择"采纳 Codex 建议并修改 Spec"回到 Step 5。

---

## Step 6: 🛑 User Spec Review（Hard Stop）

**目的**：让用户确认 Spec 的范围、架构和验收标准。

**治理模式**：`human_gate` — 用户主权确认，不参与机器自动修文。

**展示内容**：
1. Spec 关键章节摘要（Scope、Constraints、Acceptance Criteria）
2. PRD 覆盖率报告（若有 partial/uncovered 段落，列出需关注项）
3. Codex 审查发现（若 Step 5.5 已执行且有 verified issues，列出 critical/important 条目及建议修订）

**审查时必须将 spec.md 与需求原文逐段对照**，不能只依据摘要判断。

**用户回复归一化 → CLI 调用**：

展示完 Spec 摘要 / 覆盖率 / Codex 审查后，调用 `AskUserQuestion` 收集决策，`question` 写"Spec 审批结果？"，`options` 给 4 条常用分支，每个 `description` 写结果：

- `approve_generate_plan` → canonical `Spec 正确，生成 Plan`，进入 Step 7
- `revise_spec` → canonical `需要修改 Spec`，回到 Step 5
- `revise_ux` → UX 需要调整（流程 / 分层），进入第二轮 AskUserQuestion 拆分为 `缺少用户流程` / `页面分层需要调整`
- `other` — 其他情况（保留需求细节 / 继续流程不重渲染 / 拆分范围）

选 `other` 时用 AskUserQuestion 二次询问或让用户自然语言描述，再按下表映射表归一化。映射由本 skill 维护，禁止把用户自由文本直接塞给 `--choice`：

| 用户意图 | 快捷回复样例 | canonical choice（精确字符串） | 结果 |
|---|---|---|---|
| 通过，生成 Plan | `ok` / `通过` / `LGTM` / `approve` | `Spec 正确，生成 Plan` | 进入 Step 7 Plan 扩写 |
| 通过，继续流程 | `继续` / `行` | `Spec 正确，继续` | 继续流程（不重渲染 plan） |
| Spec 内容要改 | 以 `修改 spec` / `改内容` 开头 | `需要修改 Spec` | 回到 Step 5 |
| UX 分层要调 | `分层不对` / `改分层` | `页面分层需要调整` | 回到 Step 4 UX 审批 |
| 缺用户流程 | `流程补下` / `漏了 xx 场景` | `缺少用户流程` | 回到 Step 4 UX 审批 |
| 缺需求细节 | `需求不全` / `细节再说` | `缺少需求细节` | 回到 Step 5，保留细节 |
| 范围要拆 | `拆分` / `太大` / `范围太广` | `需要拆分范围` | 状态回 idle，缩小范围后重启 |

无法匹配时重新 AskUserQuestion，不要猜。

**必调 CLI**：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" \
  spec-review --choice "<上表中的 canonical 字符串>"
```

approve 分支 CLI 会**重新读取 spec.md 并刷新 plan.md 骨架**（调用 `buildRequirementCoverageFromSpec` + `buildPlanTasks`），状态推进到 `planned`。后续 Step 7 的工作是在这份刷新后的骨架上 Edit 扩写。

revise 分支 CLI 只改 state，不动 spec.md / plan.md；修完后**再次调 `spec-review`** 才能推进。

未调 `spec-review` CLI = skill 违规，状态机不会推进。

---

## Step 7: Plan 扩写（在 CLI 骨架上）+ Self-Review

**目的**：在 Step 6 approve 分支 CLI 刷新后的 `plan.md` 骨架上扩写详细实施计划。

**宣告**：`📋 Phase 2: Plan 扩写`

**前置状态**：Step 6 审批通过，CLI 已刷新 plan.md 骨架与 `current_tasks`。

**健康检查**（开始扩写前执行）：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" status
```

确认 `status=planned`、`plan_file` 已就绪、`current_tasks` 非空。状态异常时停下，不要硬写 plan.md。

**扩写硬约束**（违反会破坏执行期状态机）：

- 用 Edit 扩写骨架内容，**禁止 Write 全量覆盖 plan.md**
- 禁止修改 YAML front matter（特别是 `spec_file` / `status` / `role_profile` / `context_profile`）
- 禁止修改 `plan_file` 路径或重命名 plan 文件
- 禁止变更 CLI 已生成的 task ID，**尤其是首个 task ID**（`task_manager` / `execution_sequencer` 依赖 `current_tasks[0]` 定位起点）
- 扩写仅限每个 task 内部的步骤、代码块、验证命令、Patterns / Mandatory Reading；新增 task 必须放在现有 task 之后，不得插入或重排

**输入**：
- `spec.md`（**唯一规范输入**）
- `analysis-result.json`（仅作为文件规划与复用提示的辅助上下文）
- `discussion-artifact.json`（仅做一致性校验，不从中生成新任务）
- `prd-spec-coverage.json`（覆盖率 drift check）

**输出**：在 CLI 已生成的 `.claude/plans/{task-name}.md` 骨架上 Edit 扩写（骨架使用 [`plan-template.md`](../../specs/workflow-templates/plan-template.md)，由 Step 6 approve 分支产出，不得手动改名或新建）

### 设计原则

- **Spec-Normative** — spec.md 是唯一规范输入
- **File Structure First** — 先列文件清单，再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟的原子操作
- **Complete Code** — 每步包含完整代码块（不是伪代码或描述）
- **Exact Commands** — 验证命令包含预期输出
- **No Placeholders** — 禁止 TBD / TODO / "类似 Task N" / 模糊描述
- **WorkflowTaskV2 Compatible** — 任务块使用 `## Tn:` 标题和 V2 字段
- **Spec Section Ref** — 每步标注对应的 spec 章节

### No Placeholders 规则

以下内容在 plan 中出现即为 **plan failure**：
- "TBD"、"TODO"、"implement later"
- "Add appropriate error handling" / "add validation"
- "Write tests for the above"（未提供实际测试代码）
- "Similar to Task N"（必须重复代码，读者可能乱序阅读）
- 仅描述"做什么"但不展示"怎么做"的步骤
- 引用未在任何 task 中定义的类型或函数

### 任务结构

每个 task 包含：

- `## Tn: [组件名]` — 标题
- **阶段**: implement / test / config
- **Package**: 任务归属的 package。plan 生成器按以下顺序推断：单包→`project.name` / `package.json#name` / 仓库目录名；monorepo→`monorepo.defaultPackage` / `monorepo.packages[0]`。推断错的场景由写 plan 的人手动覆盖。用于 hook code-specs 注入的 scope 决定。
- **创建/修改/测试文件**: 精确路径
- **Spec 参考**: 对应的 spec 章节编号
- **验收项**: AC-xxx
- **验证命令** + **预期输出**
- **步骤**: S1 写测试 / S2 实现代码 / S3 运行验证

### Pattern Discovery

从代码分析结果提取可复用的代码模式，生成 `Patterns to Mirror` 和 `Mandatory Reading` 区块。引用必须指向真实存在的代码文件和符号。

### Confidence Score

基于覆盖率、模式数量、约束数量、测试策略综合评分（1-10），写入 plan Metadata。

### Discussion Drift Check

若有 `discussion-artifact.json`：
- `selectedApproach` 存在 → 验证 Spec Architecture 章节是否反映该方案。偏差 → **回退 Step 5 修订 Spec**
- `unresolvedDependencies` 存在 → 验证 Spec Scope 对应需求标记为 `blocked`。缺失 → **回退 Step 5**

> ⚠️ Plan 阶段不得基于 discussion-artifact 发明 spec 中不存在的任务。发现偏差一律回退 Spec 修订。

### Self-Review

Plan 生成后立即执行。详见 [`references/plan-self-review.md`](references/plan-self-review.md)。必须输出执行摘要：需求覆盖（spec in_scope 条目 vs task 覆盖数）+ placeholder 扫描（`0 个 TBD/TODO` / `N 个已修复`）+ 跨 task 一致性结果。不得仅标记完成而无实际检查输出。

---

## Step 7.5: Codex Plan Review（条件，bounded-autofix）

**目的**：从技术可行性角度审查 Plan，发现实现顺序问题、缺失步骤和集成风险。

**Phase 编号**：2.5.5（conditional `machine_loop`）

**治理模式**：`bounded-autofix` — Codex 发现经当前模型验证后，可自动修复 Plan 并重跑 Self-Review。Plan 修改成本低于 Spec，允许有限自动修复。

**触发条件**：从 `workflow-state.json` 的 `context_injection.planning.codex_plan_review.triggered` 读取。

**未触发时**：输出 `⏭️ Codex Plan Review: skipped`，直接进入 `planned` 状态。

**执行流程**：详见 [`references/codex-plan-review.md`](references/codex-plan-review.md)。

**预算**：max_attempts = 2（1 次 Codex 审查 + 最多 1 次修复后复审）。Provider 失败立即降级，不消耗 revision 预算。

**摘要输出**：
```
🔍 Codex Plan Review: {n} issues found, {m} fixed
```

---

## Step 8: 🛑 规划完成（Hard Stop）

**状态结果**：

- 走完 approve 分支的默认终态：`status=planned`，`plan_file` / `current_tasks` 就绪
- 用户在 Step 6 选择 revise 分支时停在 `spec_review`，spec 修订完成后再次调 `spec-review` 才能推进
- 用户在 Step 6 选择 `需要拆分范围` 时 `status` 回 `idle`，需缩小范围后重启
- 后续由 `workflow-execute` skill 接管执行

**输出摘要**：展示 Spec 路径、Plan 路径、需求统计、任务数量、Confidence Score。

**下一步提示**：

1. 审查 `spec.md` 和 `plan.md`
2. 使用 `workflow-execute` 开始实施

---

## 产物路径速查

| 产物 | 路径 |
|------|------|
| Spec 文档 | `.claude/specs/{task-name}.md` |
| Plan 文档 | `.claude/plans/{task-name}.md` |
| 状态文件 | `~/.claude/workflows/{projectId}/workflow-state.json` |
| 代码分析 | `~/.claude/workflows/{projectId}/analysis-result.json` |
| 讨论工件 | `~/.claude/workflows/{projectId}/discussion-artifact.json` |
| UX 设计 | `~/.claude/workflows/{projectId}/ux-design-artifact.json` |
| PRD 覆盖率 | `~/.claude/workflows/{projectId}/prd-spec-coverage.json` |

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-execute` | 按 Plan 推进任务执行 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| `workflow-review` | 全量完成审查（execute 完成后独立执行） | [`../workflow-review/SKILL.md`](../workflow-review/SKILL.md) |
| `dispatching-parallel-agents` | 并行子 Agent 分派 | [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md) |

> CLI 入口：`~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js`
>
> 运行时资源参见 [`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)

