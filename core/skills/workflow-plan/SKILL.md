---
name: workflow-plan
description: "/workflow-plan 入口。代码分析 → 需求讨论 → UX 设计 → Spec 生成 → 用户审批 → Plan 生成。"
---

<PATH-CONVENTION>
所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。
该路径在 `npm install` 后始终存在，所有 agent 共享，无需动态解析。
</PATH-CONVENTION>

# workflow-plan

> 本 skill 是 `/workflow-plan` 的完整行动指南。

<HARD-GATE>
三条不可违反的规则：
1. Spec 未经用户确认，不得生成 Plan
2. 讨论/UX 设计产物必须持久化为 JSON 文件，不得仅在对话中存在
3. Plan 中不允许任何 TBD/TODO/占位符
</HARD-GATE>

> 🔧 **自愈例外**：当 `workflow-state.json` 因会话丢失需要重建时，CLI `init` 命令会根据 spec 文件
> 存在性推断审批状态（有 spec → `approved`，无 spec → `skipped`）。此路径由 `system-recovery`
> reviewer 标记，不等同于用户主权审批。参见 `workflow-execute` SKILL.md Step 2。

## Checklist（按序执行）

1. ☐ 解析参数 + 基础设施预检
2. ☐ 代码库分析（强制）
3. ☐ 需求讨论（条件）
4. ☐ UX 设计审批（条件 HARD-GATE）
5. ☐ 生成 Spec + Self-Review
5.5. ☐ Codex Spec Review（条件，advisory）
6. ☐ 🛑 用户审批 Spec
7. ☐ 生成 Plan + Self-Review
7.5. ☐ Codex Plan Review（条件，bounded-autofix）
8. ☐ 🛑 规划完成（Hard Stop）

```
需求 ──▶ 代码分析 ──▶ 需求讨论 ──▶ UX 设计 ──▶ Spec ──▶ Codex ──▶ 用户审批 ──▶ Plan ──▶ Codex ──▶ 完成
              │           (条件)      (条件)       │     (条件)       🛑           │     (条件)    🛑
         codebase      逐个澄清    流程图+分层   统一规范  advisory              原子步骤  autofix
         retrieval     方案选择    HARD-GATE    验收标准                         完整代码
         + 预检                                                                 No TBD
```

---

## Step 1: 解析参数 + 预检

**参数格式**：

- 内联需求：`/workflow-plan "实现用户认证功能"`
- 文件需求：`/workflow-plan docs/prd.md`（自动检测 `.md` 文件是否存在）
- 强制覆盖：`/workflow-plan -f "需求描述"`
- 跳过讨论：`/workflow-plan --no-discuss "需求描述"`

**参数解析后立即执行预检**（详见 [`../../specs/workflow-runtime/preflight.md`](../../specs/workflow-runtime/preflight.md)）：

1. **Git 状态检查** — 确认 git 仓库已初始化且有初始提交。无 git 时用户显式选择降级或暂停。
2. **项目配置自愈** — 确保 `project-config.json` 存在，缺失时自动生成最小配置。
3. **工作流状态检测** — 检查是否存在未归档的工作流。存在时根据状态（running/paused/failed/completed）提示用户恢复、覆盖或归档。
4. **projectId 获取** — 禁止使用 `echo | md5sum` 等 shell 手动哈希计算 projectId（路径规范化差异会导致不一致）。必须通过以下方式之一获取：
   - 从 `project-config.json` 读取 `project.id` 字段
   - 使用 CLI：`node -e "const p=require('path'),h=require('os').homedir();const {stableProjectId}=require(p.join(h,'.agents/agent-workflow/core/utils/workflow/lifecycle_cmds'));console.log(stableProjectId(process.cwd()))"`

---

## Step 1.5: Knowledge 读取（advisory）

**目的**：将 `.claude/knowledge/` 作为 Constraints 参考输入，供 Step 4 Spec 生成使用。

**行为**：

1. 若 `.claude/knowledge/` 目录存在：通过 `getKnowledgeContext()`（`core/utils/workflow/task_runtime.js`）读取目录下所有可用内容——根 `index.md`、各层 `index.md`、已填充的规范文件——汇总成 Constraints 摘要供后续使用。只要目录存在就生效，不要求根 `index.md` 一定在。
2. 若目录不存在且 `project-config.json` 中 `knowledge.bootstrapStatus !== 'skipped'`：输出 advisory 提示：
   ```
   💡 未检测到项目知识库，建议执行 /knowledge-bootstrap 建立骨架并用 /knowledge-update 沉淀规范。
   ```
3. 不阻塞流程，不修改任何文件。

> Bootstrap 与 knowledge 填充已迁移至 `/scan` Part 5 与 `/knowledge-bootstrap` / `/knowledge-update` 命令链。迁移背景与历史 Step 1.5 流程保留在 [`references/knowledge-bootstrap.md`](references/knowledge-bootstrap.md)。

---

## Step 2: 代码库分析（强制）

**目的**：在设计前充分理解代码库，避免重复造轮子。

**宣告**：`📊 Phase 0: 代码分析`

使用代码检索能力分析与需求相关的代码，提取：

1. **相关文件** — 可复用或需修改的现有实现
2. **可复用组件** — 可继承的基类、工具类
3. **架构模式** — 相似功能的实现参考（如 Repository Pattern、Error Boundary）
4. **技术约束** — 数据库、框架、规范、错误处理模式
5. **依赖关系** — 内部和外部依赖

**持久化**：分析结果写入 `~/.claude/workflows/{projectId}/analysis-result.json`。后续阶段优先从文件加载，避免重复分析。

> 工件结构参见 [`references/artifact-schemas.md`](references/artifact-schemas.md) § analysis-result.json

### Knowledge Freshness Check（条件）

当 `.claude/knowledge/` 存在时，在代码分析结尾执行过期检测：

1. 根据当前需求确定涉及的层（frontend / backend / guides）
2. 仅对涉及层的 Filled 状态文件，用 `git log -1 --format=%ct` 检查最后修改时间
3. 若文件超过 30 天未更新：输出 `⚠️ knowledge/{layer}/{file} 已 {N} 天未更新，建议 review 后更新`
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

**持久化**：讨论结果写入 `~/.claude/workflows/{projectId}/discussion-artifact.json`。即使无待澄清项也必须生成最小工件。

> ⚠️ 不得仅依赖对话上下文记忆。Phase 1 Spec 生成会读取此文件。
>
> 工件结构参见 [`references/artifact-schemas.md`](references/artifact-schemas.md) § discussion-artifact.json

---

## Step 4: UX 设计审批（条件 HARD-GATE）

**目的**：在 Spec 生成前，强制完成用户操作流程图和页面分层设计。

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

3. **HARD-GATE 用户审批** — 展示流程图和分层设计，请用户确认：
   - ✅ 设计合理，继续 → 进入 Spec 生成
   - 🔄 需要调整流程 → 用户描述修改，重新生成
   - 🔄 需要调整分层 → 修改信息架构后重审
   - 🔄 需要补充场景 → 添加遗漏场景后重审

**持久化**：设计工件写入 `~/.claude/workflows/{projectId}/ux-design-artifact.json`。

> ⚠️ 设计审批通过但未持久化 = 执行违规。Phase 1 Spec 生成会读取此文件。
>
> 工件结构参见 [`references/artifact-schemas.md`](references/artifact-schemas.md) § ux-design-artifact.json

---

## Step 5: Spec 生成（强制）+ Self-Review

**目的**：在单一文档中完成需求范围判定、架构设计、验收标准和关键约束。

**宣告**：`📘 Phase 1: Spec 生成`

**输入**：
- 需求内容（PRD 或内联）
- `analysis-result.json`（代码分析结果）
- `discussion-artifact.json`（如有）
- `ux-design-artifact.json`（如有，且必须已审批通过）
- `.claude/knowledge/` 下与当前需求相关的规范文件（如有，作为 Constraints 参考输入）

**输出**：`.claude/specs/{task-name}.md`（使用 [`spec-template.md`](../../specs/workflow-templates/spec-template.md)）

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

**用户选择与展示格式**（必须包含快捷回复指引）：

```
请选择：
  ✅ Spec 正确，生成 Plan — 通过审批，进入 Plan 生成
  🔄 需要修改 Spec — 指出修改点，回到 Spec 生成
  ❌ 需要拆分范围 — 状态回 idle，缩小范围后重启

💡 快捷回复：
  回复 "ok" / "通过" / "LGTM"  → 生成 Plan
  回复修改意见（如 "XX 部分需要改为…"） → 修改 Spec
  回复 "拆分" → 缩小范围后重启
```

**快捷回复解析规则**：
- 用户回复 `ok` / `通过` / `LGTM` / `approve` / `没问题` / `可以` → 视为 **Spec 正确，生成 Plan**
- 用户回复以 `修改` / `改` 开头，或直接描述修改点 → 视为 **需要修改 Spec**，回到 Step 5
- 用户回复 `拆分` / `太大` / `范围太广` → 视为 **需要拆分范围**，状态回 idle
- 无法匹配时，询问用户明确选择

**状态更新**：审批通过后 `workflow-state.json` 的 `review_status.user_spec_review.status` 设为 `approved`。

---

## Step 7: Plan 生成（强制）+ Self-Review

**目的**：从已批准的 `spec.md` 生成可直接执行的实施计划。

**宣告**：`📋 Phase 2: Plan 生成`

**前置状态**：Step 6 审批通过。

> 审批通过后，工作流短暂进入 `planning` 内部状态（由 CLI 自动管理），然后在 Plan 生成完成后
> 转为 `planned`。此中间态对用户不可见，如长时间停留应检查 Plan 生成流程是否异常。

**输入**：
- `spec.md`（**唯一规范输入**）
- `analysis-result.json`（仅作为文件规划与复用提示的辅助上下文）
- `discussion-artifact.json`（仅做一致性校验，不从中生成新任务）
- `prd-spec-coverage.json`（覆盖率 drift check）

**输出**：`.claude/plans/{task-name}.md`（使用 [`plan-template.md`](../../specs/workflow-templates/plan-template.md)）

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

- `workflow-plan` 默认停在 `spec_review` 状态
- Step 6 审批通过后，生成 Plan，状态进入 `planned`
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

