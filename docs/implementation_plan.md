# workflow-execute 优化方案

> 基于 `core/docs/skill-optimization-guide.md` 六大原则，对 `core/skills/workflow-execute` 进行系统性优化。

## 现状诊断

### 量化分析

| 指标 | 当前值 | 优化目标 | 差距 |
|------|--------|----------|------|
| 文件数 | **14 个** | ~5 个 | ⚠️ 碎片化严重 |
| 总行数 | **~2,153 行** | ~800 行 | ⚠️ 需削减 ~63% |
| TypeScript 伪代码行数 | **~1,100+ 行** | 0 | 🔴 严重违反原则 1 |
| 行动指令占比 | **~25%** | ≥ 60% | 🔴 核心问题 |
| 条件判断点 | **~15+** | ≤ 6 | ⚠️ 偏多 |
| "先读"前置引用数 | **6 个**（SKILL.md） | 0 | 🔴 违反原则 2 |
| AI 手动构造 JSON 工件数 | **3+**（state 自愈/证据/上下文记录） | 仅限 CLI 不覆盖的场景 | ⚠️ |

### 文件行数清单

| 文件 | 行数 | 主要问题 |
|------|------|----------|
| SKILL.md | 39 | 索引页，无实质行动指令 |
| references/execute-overview.md | 325 | 核心流程文件，但行动指令被伪代码稀释 |
| references/execute-entry.md | 40 | 内容可合并入主文件 |
| references/execution-checklist.md | 64 | ✅ 质量较高，可作为 references 保留 |
| specs/execute/helpers.md | **708** | 🔴 全部是伪代码，已有 CLI 替代 |
| specs/execute/post-execution-pipeline.md | 209 | 🔴 ~150 行伪代码 |
| specs/execute/context-governor.md | 147 | ~50 行伪代码 |
| specs/execute/tdd-enforcement.md | 124 | ~85 行伪代码 |
| specs/execute/continuous-mode.md | 115 | ~100 行伪代码 |
| specs/execute/retry-debugging.md | 146 | ~90 行伪代码 |
| specs/execute/phase-mode.md | 68 | ~55 行伪代码 |
| specs/execute/skip-mode.md | 86 | ~70 行伪代码 |
| specs/execute/execution-modes.md | 34 | 纯索引页，可合并 |
| specs/execute/implementation-report.md | 48 | 模板定义，保留为 references |

---

## 逐项 Checklist 诊断

按 `skill-optimization-guide.md` 的优化 Checklist 逐项检查：

### ✅ 已符合
- **命令语义**：`/workflow execute` 与 skill 职责匹配 ✅

### 🔴 需修复

| # | Checklist 项 | 当前状态 | 问题详情 |
|---|-------------|----------|----------|
| 1 | **伪代码清理** | 🔴 ~1,100 行 TypeScript | `helpers.md` 708 行全部是伪代码，且表头明确标注"已实现于 Node.js 脚本"。其余 8 个 specs 文件合计 ~400 行伪代码 |
| 2 | **前置加载** | 🔴 6 个"先读"引用 | SKILL.md 包含 6 个前置链接（state-machine / status / shared-utils / execute-entry / execute-overview / execution-checklist） |
| 3 | **JSON 构造** | ⚠️ 3+ 处 | 状态文件自愈 JSON（execute-overview L129-138）、VerificationEvidence 结构（post-execution-pipeline）、contextMetrics 结构（helpers.md） |
| 4 | **文件碎片** | 🔴 14 个文件 | execution-modes.md 34 行纯索引、execute-entry.md 40 行可合并、4 个模式文件各 <150 行 |
| 5 | **HARD-GATE 位置** | 🔴 散落多处 | 验证铁律（post-execution-pipeline）、执行入口铁律（execute-overview）、TDD Iron Law（tdd-enforcement）分布在不同文件 |
| 6 | **Self-Review** | ⚠️ 嵌入主流程 | post-execution-pipeline 中 Step 6.6 自审查清单 20+ 行嵌入主流程 |
| 7 | **行动指令占比** | 🔴 ~25% | 大部分篇幅被伪代码和结构定义占据 |
| 8 | **条件判断点** | ⚠️ ~15+ | 执行模式 4 路分支 + 验证类型映射 + 审查触发 3 条件 + TDD 5 条件 + ... |

---

## 优化目标架构

```
workflow-execute/
├── SKILL.md              (~350 行)   ← 合并为完整行动指南
├── references/
│   ├── execution-checklist.md  (~90 行)   ← 保留（已优质）
│   ├── self-review-checklist.md (~40 行)  ← 从 post-execution-pipeline 提取
│   └── implementation-report.md (~50 行)  ← 保留
└── (删除 specs/execute/ 整个目录)
```

**目标指标**：

| 指标 | 优化前 | 优化后 | 变化 |
|------|--------|--------|------|
| 文件数 | 14 | **4** | -71% |
| 总行数 | ~2,153 | **~530** | -75% |
| TypeScript 伪代码 | ~1,100 | **0** | -100% |
| 行动指令占比 | ~25% | **~75%** | 3x 提升 |
| 条件判断点 | ~15+ | **~6** | -60% |
| 前置引用 | 6 | **0** | 渐进式披露 |

---

## 具体变更方案

### 核心理念

仿照 `workflow-plan` 的优化成果：**SKILL.md 不再是索引页，而是完整的行动指南**。所有执行步骤、治理规则、模式路由集中在一个文件内，用自然语言声明行为，伪代码全部删除（对应函数已有 CLI/Node.js 实现）。

---

### 组件 1：SKILL.md 重写

#### [MODIFY] [SKILL.md](file:///d:/code/claude-workflow/core/skills/workflow-execute/SKILL.md)

**从 39 行索引页 → ~350 行完整行动指南**。结构如下：

```markdown
# workflow-execute

> 本 skill 是 `/workflow execute` 的完整行动指南。

<HARD-GATE>
四条不可违反的规则：
1. 状态优先：先读 workflow-state.json，不得通过仓库代码猜测运行时状态
2. 验证铁律：没有新鲜验证证据，不得标记任务为 completed
3. TDD 铁律：满足 TDD 条件时，没有失败测试，不得编写生产代码
4. 逐任务更新：完成一个 task 立即更新 plan.md + state.json，禁止批量回写
</HARD-GATE>

## Checklist（按序执行）

1. ☐ 解析执行模式（连续/阶段/重试/跳过）
2. ☐ 读取工作流状态（state-first）
3. ☐ 治理信号评估（ContextGovernor）
4. ☐ 提取当前任务 + 显示上下文
5. ☐ 执行任务动作
6. ☐ Post-Execution Pipeline（6 步管线）
7. ☐ ContextGovernor 决定下一步

## Step 1: 解析执行模式
（合并 execute-entry.md + execution-modes.md 的核心内容）
...

## Step 2: 读取工作流状态
（合并 execute-overview Step 1 + 1.5 + 2 的行动指令）
（状态自愈：调用 CLI `node utils/workflow/workflow_cli.js init`，不要手动构造 JSON）
...

## Step 3: ContextGovernor 治理决策
（声明式描述决策顺序和输出动作，删除全部 TypeScript）
...

## Step 4: 提取并显示任务上下文
...

## Step 5: 执行任务动作
（含 TDD 触发条件和 Red-Green-Refactor 的自然语言描述）
...

## Step 6: Post-Execution Pipeline
（保持 6 步管线结构，引用 execution-checklist.md 作为唯一权威清单）
（自审查清单提取到 references/self-review-checklist.md）
...

## Step 7: ContextGovernor 决定下一步
...

## 特殊模式

### 重试模式（--retry）
（声明式描述四阶段调试流程）

### 跳过模式（--skip）
（声明式描述跳过流程）

## 产物路径速查
## 协同 Skills
```

**关键合并源**：

| 新 SKILL.md 章节 | 合并来源 | 旧行数 | 新行数 |
|------------------|----------|--------|--------|
| HARD-GATE | 从 4 个文件集中 | 散落 | ~8 |
| Step 1 | execute-entry.md + execution-modes.md | 40+34 | ~25 |
| Step 2 | execute-overview Step 1-2 | ~80 | ~40 |
| Step 3 | context-governor.md | 147 | ~35 |
| Step 5 | tdd-enforcement.md（仅保留触发条件+铁律） | 124 | ~20 |
| Step 6 | post-execution-pipeline.md（引用 checklist） | 209 | ~30 |
| Step 7 | context-governor.md（决策输出） | 合并 | ~20 |
| 重试模式 | retry-debugging.md | 146 | ~30 |
| 跳过模式 | skip-mode.md | 86 | ~15 |
| 连续/阶段模式 | continuous-mode.md + phase-mode.md | 115+68 | ~25 |

---

### 组件 2：提取 Self-Review

#### [NEW] [self-review-checklist.md](file:///d:/code/claude-workflow/core/skills/workflow-execute/references/self-review-checklist.md)

从 `post-execution-pipeline.md` 的 Step 6.6 自审查清单提取（~40 行），遵循原则 6。

---

### 组件 3：保留优质 references

#### [保留] [execution-checklist.md](file:///d:/code/claude-workflow/core/skills/workflow-execute/references/execution-checklist.md)

当前已是高质量独立文档，无需修改。SKILL.md 中引用 `执行自审：阅读 references/execution-checklist.md 并逐项检查。`

#### [保留] [implementation-report.md](file:///d:/code/claude-workflow/core/skills/workflow-execute/references/implementation-report.md)

从 specs/ 移至 references/，纯模板定义，保留原样。

---

### 组件 4：删除文件

#### [DELETE] specs/execute/ 整个目录（10 个文件，~1,685 行）

| 删除文件 | 行数 | 削减原因 |
|----------|------|----------|
| helpers.md | 708 | 全部伪代码，已有 Node.js CLI 实现 |
| post-execution-pipeline.md | 209 | 核心流程合并入 SKILL.md，清单在 execution-checklist.md |
| context-governor.md | 147 | 声明式描述合并入 SKILL.md Step 3/7 |
| retry-debugging.md | 146 | 四阶段调试自然语言描述合并入 SKILL.md |
| tdd-enforcement.md | 124 | 触发条件+铁律合并入 SKILL.md Step 5 |
| continuous-mode.md | 115 | 行为描述合并入 SKILL.md |
| phase-mode.md | 68 | 行为描述合并入 SKILL.md |
| skip-mode.md | 86 | 行为描述合并入 SKILL.md |
| execution-modes.md | 34 | 纯索引页，合并 |
| implementation-report.md | 48 | 移至 references/ |

#### [DELETE] references/execute-entry.md（40 行）
合并入 SKILL.md Step 1。

#### [DELETE] references/execute-overview.md（325 行）
核心行动指令合并入 SKILL.md，其余为伪代码和重复内容。

---

## 伪代码 → 声明式/CLI 转换对照

以下是高频伪代码的转换策略：

| 伪代码函数 | CLI 替代命令 | SKILL.md 描述方式 |
|-----------|-------------|------------------|
| `findNextTask()` | `node workflow_cli.js next` | "调用 CLI `next` 获取下一个待执行任务" |
| `extractCurrentTaskV2()` | `node task_parser.js parse --task-id Tn` | "调用 CLI 解析任务详情" |
| `updateTaskStatus()` | `node task_parser.js update-status --task-id Tn --status completed` | "调用 CLI 更新 plan.md 中的任务状态" |
| `checkTaskDependencies()` | `node dependency_checker.js check-deps --task-id Tn` | "调用 CLI 检查依赖是否满足" |
| `recordContextUsage()` | CLI 自动记录 | 删除，由 CLI 内部处理 |
| `assertEvidenceComplete()` | 声明式检查 | "验证证据必须包含：命令、退出码、输出摘要、时间戳、通过与否" |
| `canRunInParallel()` | `node dependency_checker.js parallel` | "调用 CLI 检测可并行任务" |
| `completeWorkflow()` | `node workflow_cli.js advance --complete` | "调用 CLI 标记工作流完成" |
| `getReviewResult()` | `node state_manager.js review-result --task-id Tn` | "调用 CLI 读取审查结果" |
| 状态文件自愈 JSON | `node workflow_cli.js init` | "调用 CLI 初始化状态文件" |
| `evaluateContinuationDecision()` | `node execution_sequencer.js decide_governance_action` | "调用 CLI 获取治理决策" |

---

## User Review Required

> [!IMPORTANT]
> **架构决策：SKILL.md 作为唯一行动指南**
> 优化后 SKILL.md 从 39 行索引页扩展为 ~350 行完整指南。所有 specs 文件被删除，行动逻辑集中在一处。这与 `workflow-plan` 的优化路径一致。
>
> 请确认此方向是否可接受。

> [!WARNING]
> **helpers.md 整体移除**
> `helpers.md`（708 行）全部是 TypeScript 伪代码，对应函数已有 Node.js 脚本实现（`task_parser.js`, `state_manager.js`, `dependency_checker.js`, `verification.js`, `status_utils.js`）。
> 移除后 AI 将通过 CLI 命令而非伪代码理解操作语义。请确认这些 CLI 工具已足够覆盖 helpers.md 中的所有功能。

> [!IMPORTANT]
> **execute-overview.md 移除**
> 当前 execute-overview.md（325 行）是最核心的流程文件。其中的行动指令会合并入 SKILL.md，但大量细节（如渐进式工作流、上下文感知机制的具体数值）会被精简。请确认是否有需要特别保留的细节。

---

## Open Questions — 代码分析结论

### 问题 1：ContextGovernor 阈值 ✅ 已完全固化到 CLI

**结论：SKILL.md 无需保留任何阈值数值，只需说"调用 CLI 获取治理决策"。**

代码证据：

| 文件 | 行号 | 关键逻辑 |
|------|------|----------|
| [`execution_sequencer.js`](file:///d:/code/claude-workflow/core/utils/workflow/execution_sequencer.js#L272-L319) | L272-319 | `decideGovernanceAction()` 完整实现了决策顺序：硬停止 → quality gate → phase boundary → 独立性+污染 → budget backstop |
| [`context_budget.js`](file:///d:/code/claude-workflow/core/utils/workflow/context_budget.js#L24-L36) | L24-36 | `evaluateBudgetThresholds()` 接受 `warningThreshold=60`, `dangerThreshold=80`, `hardHandoffThreshold=90` 默认参数 |
| [`state_manager.js`](file:///d:/code/claude-workflow/core/utils/workflow/state_manager.js#L194-L224) | L194-210 | `recordContextUsage()` 初始化 `contextMetrics` 时写入默认阈值 `{warningThreshold:60, dangerThreshold:80, hardHandoffThreshold:90}` |
| [`execution_sequencer.js`](file:///d:/code/claude-workflow/core/utils/workflow/execution_sequencer.js#L490-L500) | L490-500 | CLI 命令 `decide` 已暴露：读取 state → 调用 `decideGovernanceAction()` → 输出 JSON 结果 |

**调用方式**：`node execution_sequencer.js decide <state-path> --execution-mode continuous [--next-task-json '{...}'] [--pause-before-commit] [--has-parallel-boundary]`

阈值从 `state.contextMetrics` 读取（有默认值），决策输出包含 `action`、`reason`、`severity`、`budget`、`suggestedExecutionPath`、`primarySignals` 等完整信息。SKILL.md 只需描述决策输出的语义，不需要任何阈值数值或 TypeScript 伪代码。

此外，以下 CLI 命令也已完全实现：
- `apply-decision`：写入 continuation 状态
- `skip`：标记任务 skipped + 更新 plan/state + 找下一任务
- `retry` / `retry-reset`：管理重试计数和 hard stop
- `parallel-fallback`：并行冲突回退到顺序执行

---

### 问题 2：VerificationEvidence 校验 ⚠️ 部分实现，存在差距

**结论：基础校验已实现，但缺少新鲜度校验和一致性校验。SKILL.md 需保留声明式校验规则。**

代码证据：

| 功能 | 文件 | 状态 |
|------|------|------|
| 创建证据 | [`verification.js:createEvidence()`](file:///d:/code/claude-workflow/core/utils/workflow/verification.js#L3-L13) | ✅ 已实现：自动生成 timestamp、截断 output_summary ≤500 字符 |
| 必填字段校验 | [`verification.js:validateEvidence()`](file:///d:/code/claude-workflow/core/utils/workflow/verification.js#L54-L58) | ✅ 已实现：检查 `command`, `exit_code`, `output_summary`, `timestamp`, `passed` 五个必填字段 |
| 验证顺序检查 | [`verification.js:validateVerificationOrder()`](file:///d:/code/claude-workflow/core/utils/workflow/verification.js#L60-L67) | ✅ 已实现：检测是否在验证前就更新了 state/plan |
| Action→验证命令映射 | [`verification.js:getVerificationCommands()`](file:///d:/code/claude-workflow/core/utils/workflow/verification.js#L42-L52) | ✅ 已实现：`create_file→测试/语法检查`, `run_tests→测试输出`, `quality_review→审查结果`, `git_commit→git log` |
| **新鲜度校验** | — | 🔴 **未实现**：伪代码中的 `FRESHNESS_WINDOW_MS = 15 * 60 * 1000` 检查不存在 |
| **一致性校验** | — | 🔴 **未实现**：伪代码中的 `passed && exit_code !== 0` 矛盾检测不存在 |

**优化方案影响**：
- SKILL.md 中可以引用 CLI `node verification.js create` 创建证据和 `node verification.js info` 查询验证命令映射
- 但新鲜度校验和一致性校验需要以**声明式规则**保留在 SKILL.md 中（约 5 行），例如：
  ```markdown
  验证证据必须满足：
  - 五个必填字段均存在（调用 CLI `node verification.js create` 自动保证）
  - 时间戳为本次执行期间（≤15 分钟内）
  - passed=true 时 exit_code 必须为 0（artifact 验证除外）
  ```
- 或者考虑**补充 CLI 实现**：在 `validateEvidence()` 中增加新鲜度和一致性检查，使 SKILL.md 可以完全改为"调用 CLI 校验"

---

### 问题 3：状态文件自愈 🔴 无独立 CLI 命令，需要补充

**结论：没有 `workflow_cli.js init` 命令。状态文件仅由 `cmdPlan` 创建。执行阶段状态缺失时无自愈能力。**

代码证据：

| 方面 | 代码位置 | 现状 |
|------|---------|------|
| 状态创建的唯一入口 | [`lifecycle_cmds.js:cmdPlan()`](file:///d:/code/claude-workflow/core/utils/workflow/lifecycle_cmds.js#L641-L647) | 调用 `buildMinimumState()` 创建状态，仅在 `/workflow plan` 流程中触发 |
| `buildMinimumState()` | [`workflow_types.js:L67-80`](file:///d:/code/claude-workflow/core/utils/workflow/workflow_types.js#L67-L80) | ✅ 已实现，接受 `projectId, planFile, specFile, currentTasks, status` 参数 |
| CLI 暴露 | [`workflow_types.js:main()`](file:///d:/code/claude-workflow/core/utils/workflow/workflow_types.js#L191-L198) | ✅ `minimum-state` 命令已暴露，但不从 plan.md 推导首个任务 |
| 从 plan 推导首任务 | [`task_parser.js:findNextTask()`](file:///d:/code/claude-workflow/core/utils/workflow/task_parser.js) | ✅ 已实现，但需要两步组合调用 |
| `workflow_cli.js` | 整个文件 | 🔴 没有 `init` 子命令 |
| `execution_sequencer.js` | `buildExecuteEntry()` | 状态不存在时返回 `reason: 'no_active_workflow'`，**不自动创建** |

**状态自愈的完整流程需要**：
1. 读取 `project-config.json` 获取 `projectId` ✅（`ensureProjectConfig` 已实现）
2. 读取 `plan.md` 并调用 `findNextTask()` 获取首个未完成任务 ✅（各模块已有）
3. 调用 `buildMinimumState(projectId, planFile, specFile, [firstTaskId], 'running')` ✅（已有）
4. 写入 `workflow-state.json` ✅（`writeState` 已有）

**但没有一个 CLI 命令把这四步串起来。**

**优化方案影响 — 两个选项**：

| 选项 | 描述 | SKILL.md 写法 |
|------|------|---------------|
| **A. 补充 CLI** | 在 `workflow_cli.js` 增加 `init` 子命令，组合上述四步 | "调用 `node workflow_cli.js init` 自愈状态文件" |
| **B. 分步 CLI** | 不新增命令，SKILL.md 描述分步调用 | "1. 调用 `node workflow_types.js minimum-state <args>` 2. 将输出写入状态文件" |

> [!IMPORTANT]
> **推荐选项 A**：新增约 20 行的 `init` 子命令到 `workflow_cli.js`，使 SKILL.md 可以简化为一行 CLI 调用。这与原则 3（CLI 接管状态操作）完全一致，且实现成本极低。

---

## 基于分析的方案调整

| 调整项 | 原方案 | 调整后 |
|--------|--------|--------|
| ContextGovernor 阈值 | 保留还是删除待定 | ✅ 确认删除，CLI 完全覆盖 |
| 验证证据 | 全部交给 CLI 待定 | ⚠️ CLI 负责创建+字段校验，SKILL.md 保留新鲜度+一致性声明式规则（~5 行） |
| 状态自愈 | 改为 `workflow_cli.js init` 待定 | 🔴 需要先补充 CLI `init` 命令（~20 行），然后 SKILL.md 引用 |

### 前置工作（在优化 SKILL.md 之前）

1. **[推荐] 新增 `workflow_cli.js init` 命令**（~20 行）
   - 读取 project-config → 获取 projectId
   - 读取 plan.md → 调用 findNextTask() 获取首个未完成任务
   - 调用 buildMinimumState() → writeState()
   - 输出 JSON 结果

2. **[可选] 增强 `verification.js validateEvidence()`**
   - 增加新鲜度校验（timestamp ≤ 15 分钟）
   - 增加一致性校验（passed 与 exit_code 逻辑一致）
   - 如果实现，SKILL.md 可完全删除验证证据的声明式规则

---

## 验证计划

### 自动化检查

```bash
# 1. 确认优化后文件计数和行数
find core/skills/workflow-execute -type f | wc -l  # 目标: 4
wc -l core/skills/workflow-execute/SKILL.md        # 目标: ≤ 350

# 2. 确认无 TypeScript 伪代码残留
grep -rn "function\|interface\|async\|Promise<\|: void\|: string" core/skills/workflow-execute/SKILL.md
# 目标: 0 匹配

# 3. 确认无"先读"前置加载
grep -n "先读" core/skills/workflow-execute/SKILL.md
# 目标: 0 匹配

# 4. 确认 HARD-GATE 集中
grep -n "HARD-GATE\|铁律\|Iron Law" core/skills/workflow-execute/SKILL.md
# 目标: 仅在文件开头 <HARD-GATE> 块中出现

# 5. 确认 CLI 引用覆盖
grep -cn "workflow_cli.js\|task_parser.js\|state_manager.js\|dependency_checker.js\|verification.js\|execution_sequencer.js" core/skills/workflow-execute/SKILL.md
# 目标: ≥ 10 处引用
```

### 人工验证

- 请审阅优化后的 SKILL.md，确认行动指令清晰、无遗漏关键流程步骤
- 实际执行一次 `/workflow execute`，观察 AI 是否能按 SKILL.md 行动指南正确执行
