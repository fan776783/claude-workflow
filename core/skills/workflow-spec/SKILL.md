---
name: workflow-spec
description: "/workflow-spec 入口。代码分析 → 需求讨论 → Spec 生成（含设计深化）→ 用户审批。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行(project-config → repo-context → 受影响的 code-specs → glossary)。只有跳过条件成立时才可跳过。运行时启动检查走 `core/specs/workflow-runtime/preflight.md`(不同文件,不同问题)。
</PRE-FLIGHT>

<PATH-CONVENTION>
所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。
该路径在 `npm install` 后始终存在，所有 agent 共享，无需动态解析。
</PATH-CONVENTION>

<CLI-CONTRACT>
**workflow_cli.js 是 planning 状态机的唯一写入口**。绕过 CLI 手写 spec / plan / 工件会让 `workflow-state.json` 缺失，下一会话 `/workflow-execute` 无法恢复。

Step → 必调命令映射：

| Step | 必调子命令 | 作用 |
|------|----------|------|
| Step 1 | `plan "<需求>"` | 创建 workflow-state.json（status=`spec_review`）+ spec.md 骨架 + role-context 骨架 + `ux_gate_required` 标记按需写入 state |
| Step 4 开始前 | `status` | 健康检查：`spec_file` 就绪、`status=spec_review` |
| Step 5 | `spec-review --choice "<canonical>"` | 推进状态机；approve 分支会生成 plan.md 骨架并推到 `planned` |

`spec-review` 的 `--choice` 只接受下面 5 个 canonical 字符串之一（精确匹配，来自 `planning_gates.js:142`）。**禁止把用户原话直接塞给 `--choice`，必须先归一化**：

| canonical 字符串 | 分支含义 |
|---|---|
| `Spec 正确，生成 Plan` | approve，继续 Plan 生成 |
| `Spec 正确，继续` | approve，继续workflow |
| `需要修改 Spec` | 回到 Step 4 Spec 扩写（含设计修订） |
| `缺少需求细节` | 回到 Step 4，保留需求细节 |
| `需要拆分范围` | 拒绝，状态回 idle |

⚠️ `init` 子命令是**执行期**状态丢失时的自愈入口，**规划期禁用**。
</CLI-CONTRACT>

# workflow-spec

> 本 skill 是 `/workflow-spec` 的完整行动指南。

<HARD-GATE>
三条不可违反的规则：
1. Spec 未经用户确认，不得进入 Plan 扩写
2. 讨论结果必须写入 spec.md § 9 对应章节，不得仅在对话中存在
3. **Step 1 必须先调 `workflow_cli.js plan` 建立 state 与骨架文件，后续 Step 只能在骨架上 Edit 扩写，禁止 Write 全量覆盖 spec.md**
</HARD-GATE>

> 🔧 **自愈例外**：会话丢失重建 state 时，CLI `init` 按 spec 文件存在性推断审批状态（`system-recovery` 标记，非用户主权审批）。详见 `workflow-execute` SKILL.md Step 2。此例外仅限执行期，规划期不得触发。

## Checklist（按序执行）

1. ☐ 解析参数 + 基础设施预检
2. ☐ 代码库分析（强制）
3. ☐ 需求讨论（条件）
4. ☐ Spec 文本扩写（在 CLI 骨架上）+ Self-Review
4.D ☐ 设计深化（条件，前端/后端/全栈分支）
4.5. ☐ Codex Spec Review（条件，advisory）
5. ☐ 🛑 用户审批 Spec + 规划完成

---

## Step 1: 解析参数 + 预检

**参数格式**：

- 内联需求：`/workflow-spec "实现用户认证功能"`
- 文件需求：`/workflow-spec docs/prd.md`（自动检测 `.md` 文件是否存在）
- 强制覆盖：`/workflow-spec -f "需求描述"`
- 跳过讨论：`/workflow-spec --no-discuss "需求描述"`

**参数解析后立即执行预检**（详见 [`../../specs/workflow-runtime/preflight.md`](../../specs/workflow-runtime/preflight.md)）：

1. **Git 状态检查** — 确认 git 仓库已初始化且有初始提交。无 git 时用户显式选择降级或暂停。
2. **项目配置检查** — `project-config.json` 不存在或 `project.id` 无效时报错并引导用户先跑 `/scan`（空项目使用 `/scan --init`）。不再自动生成最小配置。
3. **workflow状态检测** — 检查是否存在未archive的workflow。存在时根据状态（running/paused/failed/completed）提示用户恢复、覆盖或archive。
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
- `role-context.json` 骨架
- `ux_gate_required` 标记写入 workflow-state.json（仅当需求涉及 UI 关键词或检测到前端框架时为 true）

**何时生成 plan.md**：Step 5 调用 `spec-review --choice "Spec 正确，生成 Plan"` 时，CLI 读取已扩写好的 spec.md，调用 `buildRequirementCoverageFromSpec` + `buildPlanTasks` 首次生成 plan.md 骨架，并把状态推进到 `planned`。

**后续 Step 的contract**：

- Step 2-3 不是"从零写 JSON 工件"，而是**读取骨架按 canonical schema 填值**。
- Step 4 在 spec.md 骨架上 Edit 扩写；**禁止 Write 全量覆盖**，禁止删除或重命名 front matter 字段（`version` / `requirement_source` / `created_at` / `spec_file` / `status` / `role` / `role_profile` / `context_profile`）。

**错误处理**：

- CLI 返回 `已存在未归档工作流` → 回到预检 Step 3 让用户选择archive / 恢复 / `--force` 覆盖。**不得改用 `init` 子命令**。
- CLI 返回其他错误 → 直接展示给用户，不自行推进。

---

## Step 1.5: Code Specs 读取（advisory）

**目的**：将 `.claude/code-specs/` 作为 Constraints 参考输入，供 Step 4 Spec 生成使用。

**行为**：

1. 若 `.claude/code-specs/` 目录存在：通过 `getCodeSpecsContextScoped()` 按当前 plan 推断的 package 读取子树内容，汇总成 Constraints 摘要。
2. 若目录不存在且 `project-config.json` 中 `codeSpecs.bootstrapStatus !== 'skipped'`：输出 advisory 提示：
   ```
   💡 未检测到项目 code-specs，建议执行 /spec-bootstrap 建立骨架并用 /spec-update 沉淀规范。
   ```
3. 不阻塞workflow，不修改任何文件。

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
4. 不阻塞workflow，仅 advisory；不涉及的层不检查

---

## Step 3: 需求讨论（条件）

**目的**：通过交互式对话发现需求中的模糊点、缺失项和隐含假设。

**宣告**：`💬 Phase 0.2: 需求分析讨论`

**跳过条件**：用户指定 `--no-discuss`，或内联需求 ≤100 字符且预分析无待澄清项。

**讨论workflow**：

1. **需求预分析** — 基于代码分析结果识别待澄清事项，并按 P0/P1/P2 分层（P0=阻塞 Spec、P1=交互细节、P2=非功能性）。检查维度：范围边界、行为定义、边界场景、权限与角色、非功能性需求、技术约束冲突、外部依赖就绪度、UX 导航结构、文档内部一致性。

2. **探索优先（定向）** — 凡是可通过已有工件回答的问题，不得提问用户。先读 `analysis-result.json`，不足再 Read/Grep 具体文件，不重复全量扫描。

3. **分流澄清** — 按**决策依赖树**排序，先问根节点。P0 逐个 AskUserQuestion（每题必带推荐答案 + why），P1 写入 `clarifications[]` 附 self-recommended，P2 仅在 Spec 风险章节留痕。

4. **方案探索（条件）** — 仅在存在互斥实现路径或显著技术 tradeoff 时触发。

5. **技术决策反写** — 讨论中确认的技术选型反写到 `project-config.json`。

**持久化**：讨论结果写入 spec.md § 9（Open Questions & Dependencies）：
- § 9.1 需求澄清记录、§ 9.2 方案选择、§ 9.3 未解决依赖

> ⚠️ 不得仅依赖对话上下文记忆。讨论结果必须落盘到 spec.md。

---

## Step 4: Spec 文本扩写（在 CLI 骨架上）+ Self-Review

**目的**：在 Step 1 CLI 创建的 `spec.md` 骨架上扩写业务内容，完成需求范围判定、架构设计、验收标准和关键约束。

**宣告**：`📘 Phase 1: Spec 扩写`

**健康检查**（开始扩写前执行）：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" status
```

确认 `spec_file` 已就绪、`status=spec_review`。若异常，回到 Step 1 调 `plan` 重建骨架。

**扩写硬约束**：

- 用 Edit 逐节扩写骨架内容，**禁止 Write 全量覆盖 spec.md**
- 不得删除或重命名 YAML front matter 字段
- 不得改动模板章节标题或锚点；只在正文内扩展
- **§ 4.4 UX & UI Design 和 § 5.6 System Design 不在本 Step 填写**，留给 Step 4.D 设计深化

**输入**：
- 需求内容（PRD 或内联）
- `analysis-result.json`（代码分析结果）
- `.claude/code-specs/` 下与当前需求相关的规范文件（如有）

**输出**：在既有 `.claude/specs/{task-name}.md` 骨架上 Edit 扩写（路径由 CLI 生成）

**Spec 核心章节**（本 Step 覆盖）：

1. **Context** — 背景和目标
2. **Scope** — in-scope / out-of-scope / blocked
3. **Constraints** — 硬约束 + 讨论澄清摘要
4. **User-facing Behavior** — § 4.1-4.3（正常/异常/边界行为，§ 4.4 留给 4.D）
5. **Architecture and Module Design** — § 5.1-5.5（module划分、数据模型、技术选型，§ 5.6 留给 4.D）
6. **File Structure** — 新建/修改/测试文件
7. **Acceptance Criteria** — 按module的验收条件
8. **Implementation Slices** — 渐进交付切片
9. **Open Questions** — 待确认问题

**Self-Review**：生成后立即执行。详见 [`references/spec-self-review.md`](references/spec-self-review.md)。必须输出执行摘要：覆盖率 + placeholder 扫描 + 一致性结果。

---

## Step 4.D: 设计深化（条件，前端/后端/全栈分支）

**目的**：在 Spec 文本扩写完成后，根据项目类型做视觉/结构化设计——前端做页面级设计，后端做系统级设计。

**宣告**：`🎨 Phase 1.5: 设计深化`

**跳过条件**：纯 CLI / 工具类项目（`ux_gate_required=false` 且 § 5.1 无后端服务模块）。

**分支判断**：

| 信号 | 前端分支 | 后端分支 |
|------|---------|---------|
| `ux_gate_required=true` | ✓ | — |
| § 5.1 含 API/Service/DB 层 | — | ✓ |
| 全栈 | ✓ | ✓ |

详细执行指南见 [`references/design-elaboration.md`](references/design-elaboration.md)。

### 前端分支（§ 4.4 UX & UI Design）

1. **§ 4.4.1 User Flow** — 主会话生成 Mermaid 用户操作流程图，≥ 3 场景（首次使用、核心操作、异常/边界）
2. **§ 4.4.2 Page Hierarchy** — 主会话填写页面层级表（L0 ≤ 4 个功能module）
3. **设计稿关联** — 用 AskUserQuestion 收集 DesignSourceMap（逐页或批量）：
   - Figma URL → 记录 fileKey + nodeId
   - 截图/图片路径 → 记录 imagePath
   - 跳过 → 标记 infer（从交互图推断）
4. **§ 4.4.3 Page Layout Summary** — **分派子 Agent**（只读任务，不占主上下文）并行提取布局锚点，主会话回收后 Edit 写入 spec.md

> ⚠️ 布局锚点提取通过子 Agent 执行（Figma MCP 调用 / 截图分析的数据量大）。子 Agent 只输出 LayoutAnchor JSON，不写项目文件。降级：子 Agent 超时/失败 → 改用 infer 路径，不阻塞。

### 后端分支（§ 5.6 System Design）

在**主会话**内完成（纯文本 + Mermaid，上下文增量可控）：

1. **§ 5.6.1 API Contract Summary** — 从 § 4.1 行为推导接口清单
2. **§ 5.6.2 Data Flow** — Mermaid 数据流图
3. **§ 5.6.3 Service Boundaries** — 基于 § 5.1 定义服务边界和通信方式
4. **§ 5.6.4 Data Migration** — 条件填写（涉及 schema 变更时）

### 全栈项目

主会话先完成 § 4.4.1 + § 4.4.2 + 设计稿关联交互，然后**并行**：主会话写 § 5.6，子 Agent 提取 § 4.4.3。

---

## Step 4.5: Codex Spec Review（条件，advisory-to-human）

**目的**：引入 Codex 作为独立review视角，在用户审批前发现架构盲区和技术可行性问题。

**Phase 编号**：1.2.5（conditional `machine_loop`）

**治理模式**：`advisory-to-human` — Codex 发现不自动修复 Spec，作为 Step 5 Human Gate 的参考输入展示给用户。

**触发条件**：从 `workflow-state.json` 的 `context_injection.planning.codex_spec_review.triggered` 读取。

**未触发时**：输出 `⏭️ Codex Spec Review: skipped`，直接进入 Step 5。

**执行workflow**：详见 [`references/codex-spec-review.md`](references/codex-spec-review.md)。

**摘要输出**：
```
🔍 Codex Spec Review: {n} issues found (critical: {x}, important: {y})
```

**与 Step 5 的衔接**：Step 5 展示时增加一栏 "Codex review发现"，用户可选择"采纳 Codex 建议并修改 Spec"回到 Step 4。

---

## Step 5: 🛑 User Spec Review + 规划完成

**目的**：让用户确认 Spec 的范围、架构和验收标准。审批通过后 CLI 自动生成 Plan 骨架，后续由 `/workflow-plan` 接管。

**治理模式**：`human_gate` — 用户主权确认。

**展示内容**：
1. Spec 关键章节摘要（Scope、Constraints、Acceptance Criteria）
2. 设计深化摘要（§ 4.4 UX/UI 或 § 5.6 System Design，如有）
3. PRD 覆盖率（即时计算）
4. Codex review发现（若 Step 4.5 已执行）

**review时必须将 spec.md 与需求原文逐段对照**，不能只依据摘要判断。

**用户回复归一化 → CLI 调用**：

展示完 Spec 摘要后，调用 `AskUserQuestion` 收集决策：

- `approve_generate_plan` → canonical `Spec 正确，生成 Plan`，CLI 生成 plan.md 骨架并推到 `planned`
- `revise_spec` → canonical `需要修改 Spec`，回到 Step 4（含设计修订）
- `other` — 其他情况（保留需求细节 / 继续workflow不重渲染 / 拆分范围）

| 用户意图 | canonical choice | 结果 |
|---|---|---|
| 通过，生成 Plan | `Spec 正确，生成 Plan` | CLI 生成 plan.md 骨架，进入 `planned` |
| 通过，继续 | `Spec 正确，继续` | 继续workflow |
| Spec 要改 | `需要修改 Spec` | 回到 Step 4 |
| 缺需求 | `缺少需求细节` | 回到 Step 4，保留细节 |
| 范围要拆 | `需要拆分范围` | 状态回 idle |

**必调 CLI**：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" \
  spec-review --choice "<canonical 字符串>"
```

approve 分支 CLI 会重新读取 spec.md 并生成 plan.md 骨架，状态推进到 `planned`。

**状态结果**：

- approve → `status=planned`，`plan_file` / `current_tasks` 就绪
- revise → 停在 `spec_review`，修订后再次调 `spec-review`
- 拆分 → `status` 回 `idle`

**输出摘要**：展示 Spec 路径、Plan 路径（如已生成）、需求统计。

**下一步提示**：

1. review `spec.md`
2. 使用 `/workflow-plan` 扩写详细 Plan
3. 使用 `/workflow-execute` 开始实施

---

## 产物路径速查

| 产物 | 路径 |
|------|------|
| Spec 文档 | `.claude/specs/{task-name}.md` |
| Plan 文档（骨架） | `.claude/plans/{task-name}.md` |
| 状态文件 | `~/.claude/workflows/{projectId}/workflow-state.json` |
| 代码分析 | `~/.claude/workflows/{projectId}/analysis-result.json` |

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-plan` | Plan 扩写（在 spec-review 生成的骨架上） | [`../workflow-plan/SKILL.md`](../workflow-plan/SKILL.md) |
| `workflow-execute` | 按 Plan 推进任务执行 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| `workflow-review` | 全量完成review | [`../workflow-review/SKILL.md`](../workflow-review/SKILL.md) |
| `dispatching-parallel-agents` | 并行子 Agent 分派（Step 4.D 布局提取复用） | [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md) |

> CLI 入口：`~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js`
>
> 运行时资源参见 [`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
