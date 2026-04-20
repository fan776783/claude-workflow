---
name: workflow-execute
description: "workflow-execute 入口。完整行动指南：状态读取 → 治理决策 → 任务执行 → 后置管线 → 循环控制。"
---

<PATH-CONVENTION>
所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。
该路径在 `npm install` 后始终存在，所有 agent 共享，无需动态解析。
</PATH-CONVENTION>

# workflow-execute

> 本 skill 是 `workflow-execute` 的完整行动指南。

<HARD-GATE>
六条不可违反的规则：
1. **状态优先**：先读 workflow-state.json，不得通过仓库代码猜测运行时状态
2. **验证铁律**：没有新鲜验证证据，不得标记任务为 completed
3. **TDD 铁律**：满足 TDD 条件时，没有失败测试，不得编写生产代码
4. **逐任务更新**：完成一个 task 立即更新 plan.md + state.json，禁止批量回写
5. **完成推进铁律**：最后一个 task 完成后，必须将状态设为 `review_pending` 并提示用户执行 `/workflow-review`，不得直接标记工作流 completed
6. **预算确认铁律**：最后一个 task 执行前，必须至少调用一次 ContextGovernor `decide`，确认 budget 和治理状态允许继续
</HARD-GATE>

## Checklist（按序执行）

1. ☐ 解析执行模式
2. ☐ 读取工作流状态（state-first）
3. ☐ 治理信号评估（ContextGovernor）
4. ☐ 提取当前任务 + 显示上下文
5. ☐ 执行任务动作
6. ☐ Post-Execution Pipeline（5 步管线）
7. ☐ ContextGovernor 决定下一步
8. ☐ 实施报告 + 状态推进（所有 task 完成时）

---

## Step 1: 解析执行模式

解析命令参数和自然语言意图，确定执行模式。

**显式命令**：

| 命令 | 模式 |
|------|------|
| `workflow-execute` | 连续模式（默认） |
| `workflow-execute --phase` | 阶段模式 |
| `workflow-execute --retry` | 重试模式 |
| `workflow-execute --skip` | 跳过模式 |

**自然语言映射**：`继续/连续` → continuous、`下一阶段/单阶段` → phase、`重试` → retry、`跳过` → skip。

**裸"继续"解析**：仅在存在活动工作流（`running`/`paused`/`failed`/`blocked`）且当前对话仍在该工作流上时恢复。`planned`/`planning` 不适用，必须显式使用 `workflow-execute`。

**优先级**：`显式模式` > `自然语言意图` > `state.execution_mode` > `continuous`

调用 CLI 获取入口决策：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute [意图]
# 或带模式参数
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute --mode phase
```

CLI 返回 `entry_action`、`resolved_mode`、`state_status`、`can_resume` 等完整信息。若返回 `entry_action: 'none'`，按 `message` 字段提示用户。

**自愈后 upgrade_required 检测**：当 Step 2 中 `cmdInit` 自愈创建状态后，检查返回的 `upgrade_required` 字段。若为 `true`（plan 来自 `/quick-plan`，无独立 spec），提示用户：
- 当前 plan 来自 `/quick-plan`，无独立 spec 和完整状态机
- 建议方案：① `/workflow-plan` 升级为完整工作流  ② 直接手动执行  ③ `--force` 强制继续（spec 审批标记为 skipped）

---

## Step 2: 读取工作流状态（state-first）

**铁律：在确认 state.status / state.current_tasks 之前，不得读取 plan.md、源码或展开 Patterns to Mirror。**

调用 CLI 读取状态：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js next
```

**状态预检查**：
- `planned` → 转换为 `running`（首次执行）
- `failed` → 提示使用 `--retry` 或 `--skip`
- `blocked` → 提示使用 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dep>`
- 渐进式工作流：检查是否所有任务都被阻塞

**Git 分支检测（建议性）**：检测是否在 main/master 上，建议创建 feature branch。不阻塞执行。

### 状态文件自愈

如果 `workflow-state.json` 不存在，调用 CLI 自动创建：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js init
```
CLI 自动从 plan.md 推导首个未完成任务并创建最小状态文件。

**自愈失败 → fail-fast**：若创建失败（权限不足、磁盘满、plan.md 不存在），终止执行并提示用户检查后重试。不得静默继续。

### 自愈审批状态

自愈重建状态文件时，`user_spec_review` 根据 spec 文件存在性差异化处理：

- `spec_file` 存在 → `user_spec_review` 恢复为 `approved`（reviewer: `system-recovery`）
- `spec_file` 不存在（如来自 `/quick-plan`） → `user_spec_review` 标记为 `skipped`
- 自愈后首次执行时，应在 Step 4 显示 `⚠️ 状态已自愈恢复，spec 审批标记为 system-recovery` 提醒

### 路径安全校验

使用 `resolveUnder` 函数校验 `plan_file`、`spec_file` 等路径在允许范围内。参见 `../../specs/workflow-runtime/shared-utils.md`。

---

## Step 3: ContextGovernor 治理决策

在确定当前任务后、执行前，调用 ContextGovernor 评估是否应继续：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js decide <state-path> \
  --execution-mode continuous \
  [--next-task-json '{"id":"T3","actions":["create_file"],...}'] \
  [--pause-before-commit] \
  [--has-parallel-boundary]
```

**决策顺序**（由 CLI 内部自动执行）：
1. 硬停止条件（failed / blocked / retry hard stop / 缺少验证证据）
2. 下一任务的独立性与上下文污染风险
3. 治理语义边界（quality gate / before commit / phase boundary）
4. budget backstop（仅在 danger / hard handoff 时触发）

**决策输出**：

| action | 含义 |
|--------|------|
| `continue-direct` | 直接继续顺序执行 |
| `continue-parallel-boundaries` | 按边界并行分派 |
| `pause-budget` | 因预算压力暂停 |
| `pause-governance` | 因治理 phase 边界暂停 |
| `pause-quality-gate` | 在质量关卡前暂停 |
| `pause-before-commit` | 在提交任务前暂停 |
| `handoff-required` | 达到硬水位，生成 continuation artifact 并建议新会话恢复 |

**决策通知分级**：

| 决策类型 | 通知方式 | 示例 action |
|----------|----------|-------------|
| 正常暂停 | 简短提示（一句话） | `pause-quality-gate`、`pause-before-commit`、`pause-governance`、`continue-parallel-boundaries` |
| 覆盖性暂停 | 完整 3 要素解释 | `pause-budget`、`handoff-required` |

覆盖性暂停必须包含：① 覆盖原因（含具体数据，如 projected 82% > danger 80%）② 原模式保留（`state.execution_mode` 不变，恢复后自动继续）③ 建议动作（新会话恢复 or 等待预算释放）。

非 `continue-*` 决策时，调用 CLI 写入 continuation 状态：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js apply-decision <state-path> \
  --decision-json '{"action":"pause-budget","reason":"context-danger",...}'
```

---

## Step 4: 提取当前任务 + 显示上下文

仅在 Step 2 已确认 `state.current_tasks` 后，从 `plan.md` 提取当前任务详情：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/task_parser.js parse --task-id T3 <plan-path>
```

命令会返回该 task 的单条 JSON 详情；未传 `--task-id` 时仍返回整份任务列表。

**按需显示**（当前 task 级别，不用于判定运行时状态）：
- 任务 ID、名称、阶段、文件
- 验收项、依赖
- **Patterns to Mirror**：先读取源文件中的模式实现，再编写当前任务代码
- **Mandatory Reading**：P0 必读文件列表，在执行前先读取

---

## Step 5: 执行任务动作

根据任务的 `actions` 字段执行动作：`create_file` / `edit_file` / `run_tests` / `quality_review` / `git_commit`。

### TDD 执行纪律（条件触发）

**全部满足才触发 TDD**：
1. 任务 `phase` 为 `implement` / `ui-*`
2. 项目存在 Spec + 可执行的测试命令
3. actions 含 `create_file` / `edit_file`
4. 文件类型非豁免（配置、文档、迁移、声明、桶文件）

**触发后执行 Red-Green-Refactor**：
1. **RED**：先写失败测试。测试直接通过 → 修正使其失败。语法错误 → 修复后重来
2. **GREEN**：编写最小实现让测试通过。失败 → 修复实现（不改测试）
3. **REFACTOR**：清理代码后运行全部关联测试。失败 → 撤销重构

每个模板最多 3 次重试。全部模板均未完成 Red→Green 循环 → 标记 TDD 执行失败。

**不满足 TDD 条件**：直接执行，不强制 TDD。

### 并行执行

仅在平台支持且能证明同阶段任务彼此独立时启用。核心门槛：

- `batch_orchestrator.js config` 返回 `enabled: false` 或 `maxConcurrency <= 1` → 跳过并行
- 含 `git_commit` 或 `quality_review` action 的任务**禁止**编入并行批次（写共享状态会产生真正竞争）
- 分派层面复用 `dispatching-parallel-agents` skill；只读批次不 provision worktree，写文件批次串行 provision 后再并行启动 subagent

批次判定、只读 / 写文件两种分派路径的详细 CLI 与返回字段，见 [`references/parallel-dispatch.md`](references/parallel-dispatch.md)。分派内部的平台检测、结果回收、冲突降级由 `../dispatching-parallel-agents/SKILL.md` 负责。

---

## Step 6: Post-Execution Pipeline（5 步管线）

每个 task 完成后，必须依次完成以下 5 步。**权威 checklist 参见 [`references/execution-checklist.md`](references/execution-checklist.md)。**

**管线完整性规则**：步骤 ①→④ 为强制项，不得跳过或合并。步骤 ② 的检查内容是建议性的，但**输出证据是强制的**。连续执行多个 task 时，每个 task 独立走完管线后才进入下一个，不得攒到最后批量执行。

| 步骤 | 名称 | 关键规则 |
|------|------|----------|
| ① | **验证** | 运行验证命令，读取输出，确认通过。失败 → 标记 `failed`，后续跳过 |
| ② | **自审查（强制输出）** | 检查内容参见 [`references/self-review-checklist.md`](references/self-review-checklist.md)。检查本身建议性不阻塞，但**必须输出一行证据**（复制下方模板）。静默省略即为管线违规 |
| ③ | **更新 plan.md** | 逐 task 立即更新，禁止批量回写。更新后**必须输出 checkpoint 行** |
| ④ | **更新 state.json（HARD-GATE #4）** | 更新 `progress.completed` + `current_tasks` + `updated_at`。更新后**必须输出 checkpoint 行** |
| ⑤ | **Journal（条件）** | 暂停/完成时调用 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal add` |

### ① 验证

调用 CLI 查询当前 action 对应的验证方式：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/verification.js info create_file edit_file
```

执行验证命令后，调用 CLI 创建验证证据：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/verification.js create \
  --cmd "npm test" --exit-code 0 --output "PASS" --passed
```

CLI 会同时返回证据对象和 `validation` 结果；只有 `validation.valid === true` 时，才能进入后续 checkpoint。

> `SessionStart` / `PreToolUse(Task)` hooks 只读取 CLI/runtime 结果并决定提示或阻断，不负责写入主状态或生成验证 evidence。

### ② 自审查输出模板

每个 task 完成后，必须输出以下格式之一（直接复制并填充）：
```
自审查：X/Y 项通过
```
或
```
自审查：已跳过（{原因}）
```

### ③→④ Checkpoint 输出模板

`plan.md`（③）和 `state.json`（④）视为一个逻辑 checkpoint。③ 成功但 ④ 失败时 → 回滚 plan.md 中该 task 的状态标记。恢复启动时以 `state.json` 为权威源。

每个 task 的 ③④ 完成后，**必须输出一行 checkpoint 行**（直接复制并填充）：
```
✅ {TaskId} checkpoint：plan.md ✓ state.json ✓（completed: [{已完成列表}], current: [{当前列表}]）
```

示例：`✅ T2 checkpoint：plan.md ✓ state.json ✓（completed: [T1,T2], current: [T3]）`

Checkpoint 行是更新动作的证据，遗漏即视为未完成 ③④。

### ⑤ Journal 记录

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal add \
  --title "完成 T1-T3" \
  --tasks-completed "T1,T2,T3" \
  --summary "实现了用户认证模块" \
  --decisions "选择 JWT 方案" \
  --next-steps "T4 需要等待后端接口"
```

---

## Step 7: ContextGovernor 决定下一步

完成 Post-Execution Pipeline 后，再次调用 ContextGovernor（同 Step 3）判断是否继续。

> **最小化要求（HARD-GATE #6）**：连续模式下不要求每个 task 前都调用 ContextGovernor，但**至少在最后一个 task 前**必须执行一次 `decide` 调用。
>
> **Governor checkpoint 输出模板**（调用 `decide` 后必须输出）：
> ```
> 🔍 Governor: action={action}, budget={level}, backstop={triggered}
> ```
> 若 action 为 `continue-direct`，继续执行。若为暂停/交接类 action，按 Step 3 决策处理。
> 静默省略此行即为 HARD-GATE #6 违规。

### 连续模式行为

- 跨越 phase 边界连续执行，遇到质量关卡后暂停展示审查结果
- 质量关卡暂停后提供选项：审查通过继续 / 需要修复问题 / 查看详细报告
- 遇到 `git_commit` 且 `pause_before_commit=true` 时暂停

### 阶段模式行为

- 连续执行同一 phase 内任务，phase 边界变化时暂停
- 遇到质量关卡同样暂停

---

## 特殊模式

### 重试模式（`--retry`）

调用 CLI 准备重试：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js retry <state-path> <task-id>
```

CLI 自动管理重试计数和 hard stop。返回 `retryable: false` 且 `reason: 'hard-stop'` 时（连续 3 次失败），质疑架构并与用户讨论。

**结构化调试协议**（四阶段顺序执行）：
1. **根因调查** — 读完整错误信息，复现问题，检查最近变更（`git diff HEAD~3 -- <file>`），从错误点向上追溯数据流
2. **模式分析** — 找正常工作的类似代码，对比差异，列出每一个差异（无论多小）
3. **假设验证** — 形成单一假设："我认为 X 是根因，因为 Y"，做最小变更验证，一次只测一个变量
4. **实施修复** — 先写失败测试，实施针对根因的单一修复，确认无回归

**升级阈值**：第 1 次 → 执行完整四阶段；第 2 次 → 加强 Phase 2（扩大模式搜索范围）；第 3 次 → Hard Stop，质疑架构。

**调试红旗**（出现任何一条 → 停下来，回到 Phase 1）：
- "先快速修一下，回头再调查"
- "试试改这个看看行不行"
- "同时改几个地方，跑一下测试"
- 没有追踪数据流就提出修复方案
- 已失败 2 次以上仍然"再试一次"

重试成功后调用 CLI 重置计数：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js retry-reset <state-path> <task-id>
```

### 跳过模式（`--skip`）

调用 CLI 执行跳过：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js skip <state-path> <plan-path> <task-id>
```

CLI 自动标记 `skipped` + 更新 plan.md + state.json + 找下一任务。

> Skip 是例外路径，不执行验证、自审查或完整完成管线。

---

## 渐进式工作流

当 `mode: progressive` 时：
- 自动跳过被阻塞的任务（`blocked_by` 依赖未解除）
- 只执行可执行的任务
- 所有任务被阻塞 → 转为 `blocked` 状态
- 用户使用 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dep>` 解除后继续

---

## Step 8: 工作流完成 & 实施报告

当所有 task 标记为 `completed`（或 `skipped`），执行以下步骤：

1. 生成实施报告（模板参见 [`references/implementation-report.md`](references/implementation-report.md)），输出到 `.claude/reports/{task-name}-report.md`
2. 将状态设为 `review_pending`，将报告路径写入 `state.report_path`
3. 输出提示：
```
🛑 执行完成。状态已设为 review_pending。
请执行 /workflow-review 进行全量完成审查。
审查通过后工作流将自动标记为 completed。
```

### 实施报告 checkpoint

生成报告后，**必须输出以下行**：
```
📊 Report: .claude/reports/{task-name}-report.md（{N} 行）
```

> ⚠️ 报告生成是 Step 8 的一部分，不是可选项。跳过实施报告 = Checklist 不完整。
> 报告数据来自 `workflow-state.json`（progress, quality_gates）、`plan.md`（原始任务）、`git diff`（变更统计），不需要额外的 CLI 支持。

> ⚠️ 不得绕过 `review_pending` 直接标记 `completed`。这是 HARD-GATE #5。

## 产物路径速查

| 产物 | 路径 |
|------|------|
| 状态文件 | `~/.claude/workflows/{projectId}/workflow-state.json` |
| Plan 文档 | `.claude/plans/{task-name}.md` |
| Spec 文档 | `.claude/specs/{task-name}.md` |
| 实施报告 | `.claude/reports/{task-name}-report.md` |

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-review` | 全量完成审查（execute 完成后独立执行） | [`../workflow-review/SKILL.md`](../workflow-review/SKILL.md) |
| `dispatching-parallel-agents` | 并行子 Agent 分派 | [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md) |

> CLI 入口：`~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js`（统一）、`~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js`（执行治理）
>
> 运行时资源参见 [`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
