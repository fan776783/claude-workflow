---
name: workflow-execute
description: "Use when 用户调用 /workflow-execute, or workflow-state.json 处于 planned/running/paused/failed 需要继续推进任务。"
---

> 路径约定 + CLI 写入契约见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。

# workflow-execute

<HARD-GATE>
1. **状态优先**:先读 workflow-state.json,不得通过仓库代码猜测运行时状态
2. **验证铁律**:没有新鲜验证证据,不得标记任务为 completed
3. **TDD 铁律**:满足 TDD 条件时,无失败测试不得编写生产代码(详见 [`../tdd/SKILL.md`](../tdd/SKILL.md))
4. **完成推进铁律**:最后一个 task 完成后,必须将状态设为 `review_pending` 并提示 `/workflow-review`,不得直接标记 completed
5. **HITL 确认铁律**:任务 `interaction == 'HITL'` 时,Step 5 执行前必须调用 `AskUserQuestion`;不得跳过人工确认直接执行
</HARD-GATE>

## Checklist

1. ☐ 解析执行模式
2. ☐ 读取 workflow 状态(state-first)
3. ☐ 治理信号评估(ContextGovernor)
4. ☐ 提取当前任务 + 显示上下文
5. ☐ 执行任务动作
6. ☐ Post-Execution Pipeline(5 步管线)
7. ☐ ContextGovernor 决定下一步
8. ☐ 实施报告 + 状态推进(所有 task 完成时)

---

## Step 1: 解析执行模式

| 命令 | 模式 |
|------|------|
| `workflow-execute` | 连续模式(默认) |
| `--phase` | 阶段模式 |
| `--retry` | 重试模式 |
| `--skip` | 跳过模式 |

**自然语言映射**:`继续/连续` → continuous、`下一阶段/单阶段` → phase、`重试` → retry、`跳过` → skip。

**裸"继续"解析**:仅在存在活动 workflow(`running`/`paused`/`failed`/`blocked`)且当前对话仍在该 workflow 上时恢复。`planned`/`planning` 不适用,必须显式 `workflow-execute`。

**优先级**:显式模式 > 自然语言 > brief auto-detect > `state.execution_mode` > `continuous`。

### Brief Mode（自动检测，SKILL 层）

| 条件 | 全部满足时自动进入 |
|------|-------------------|
| plan 定义 ≤3 个 task | ✓ |
| 无 `quality_gate` task | ✓ |
| 无 `HITL` task | ✓ |

Brief mode 行为:
- **跳过** Step 3 / Step 7 的 ContextGovernor 调用（直接 continue）
- Post-Execution 只执行 ① 验证 + ② Checkpoint（跳过 ③ 自审查 + ④ Journal）
- 最后一个 task 完成后直接进入 `review_pending`
- 用户可用 `--full` 覆盖强制走完整流程

检测逻辑: SKILL 在 Step 1 解析 plan 时统计 task 数和 gate/HITL 标记，满足条件则设置 `brief=true`，后续步骤据此跳过。无需 runtime 改动。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute [意图]
# 或带模式参数
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute --mode phase
```

CLI 返回 `entry_action` / `resolved_mode` / `state_status` / `can_resume`。`entry_action: 'none'` 时按 `message` 字段提示用户。

**自愈后 upgrade_required 检测**:Step 2 中 `cmdInit` 自愈创建状态后,若 `upgrade_required: true`(plan 来自 `/quick-plan`,无独立 spec)→ 提示用户:① `/workflow-spec` 升级为完整 workflow ② 直接手动执行 ③ `--force` 强制继续(spec 审批标记为 skipped)。

## Step 2: 读取状态(state-first)

**铁律**:在确认 state.status / state.current_tasks 之前,不得读取 plan.md、源码或展开 Patterns to Mirror。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js next
```

**状态预检查**:
- `planned` → 首次调 `advance` 时 CLI 自动升为 `running`(返回 `status_transition: "planned->running"`),无需手动转换
- `failed` → 提示 `--retry` 或 `--skip`
- `blocked` → 提示 `workflow_cli.js unblock <dep>`
- 渐进式 workflow:检查是否所有任务都被阻塞

**Git 分支检测**(建议性):检测是否在 main/master,建议创建 feature branch。不阻塞执行。

### 状态文件自愈

`workflow-state.json` 不存在 → `workflow_cli.js init` 自动从 plan.md 推导首个未完成任务并创建最小状态文件。

**自愈失败 → fail-fast**:权限不足、磁盘满、plan.md 不存在时终止执行并提示用户检查后重试。**不得静默继续**。

**自愈审批状态**:重建状态文件时,`user_spec_review` 根据 spec 文件存在性差异化处理:
- `spec_file` 存在 → `user_spec_review` 恢复为 `approved`(reviewer: `system-recovery`)
- `spec_file` 不存在(如来自 `/quick-plan`) → `user_spec_review` 标记为 `skipped`
- 自愈后首次执行时,Step 4 显示 `⚠️ 状态已自愈恢复,spec 审批标记为 system-recovery`

**路径安全校验**:用 `resolveUnder` 校验 `plan_file` / `spec_file` 在允许范围内。参见 [`../../specs/workflow-runtime/shared-utils.md`](../../specs/workflow-runtime/shared-utils.md)。

## Step 3: ContextGovernor 治理决策

确定当前任务后、执行前调用:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js decide <state-path> \
  --execution-mode continuous \
  [--next-task-json '{"id":"T3","actions":["create_file"],...}'] \
  [--pause-before-commit] \
  [--has-parallel-boundary]
```

**决策顺序**(CLI 内部自动执行):
1. 硬停止条件(failed / blocked / retry hard stop / 缺少验证证据)
2. 下一任务的独立性与上下文污染风险
3. 治理语义边界(quality gate / before commit / phase boundary)
4. budget backstop(仅在 danger / hard handoff 时触发)

| action | 含义 |
|--------|------|
| `continue-direct` | 直接继续顺序执行 |
| `continue-parallel-boundaries` | 按边界并行分派 |
| `pause-budget` | 因预算压力暂停 |
| `pause-governance` | 因治理 phase 边界暂停 |
| `pause-quality-gate` | 在质量关卡前暂停 |
| `pause-before-commit` | 在提交任务前暂停 |
| `handoff-required` | 达到硬水位,生成 continuation artifact 并建议新会话恢复 |

**通知分级**:`pause-quality-gate` / `pause-before-commit` / `pause-governance` / `continue-parallel-boundaries` 简短一句话即可;`pause-budget` / `handoff-required` 必须给完整 3 要素:① 覆盖原因(含具体数据,如 projected 82% > danger 80%) ② 原模式保留 ③ 建议动作。

非 `continue-*` 决策时:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js apply-decision <state-path> \
  --decision-json '{"action":"pause-budget","reason":"context-danger",...}'
```

## Step 4: 提取当前任务 + 显示上下文

仅在 Step 2 已确认 `state.current_tasks` 后:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/task_parser.js parse --task-id T3 <plan-path>
```

按需显示(当前 task 级别):任务 ID、名称、阶段、文件、验收项、依赖、**Interaction** 字段(`AFK` 默认 / `HITL` 必走 4.1)、**Patterns to Mirror**、**Mandatory Reading**(P0 必读)。

### 4.1 HITL 任务门槛(条件触发)

**触发条件**:`interaction === 'HITL'`。Step 5 执行前**必须**完成三步(违反 = HARD-GATE #5):

1. **输出人工动作说明**(粘贴 API 密钥、浏览器手动验证、外部系统操作、设计选择)
2. **调用 `AskUserQuestion`**:
   - question:`任务 {taskId} 标记为 HITL:{任务名}。人工动作:{一句话概述}。是否可以继续?`
   - options:`proceed`(已完成,执行) / `defer`(稍后处理,任务保留 pending,workflow 进入 paused) / `skip`(跳过并标 skipped,需 reason)
3. **按选择分流**:
   - `proceed` → Step 5
   - `defer` → 走 Step 3 已有的非 `continue-*` 分支(`apply-decision ... --decision-json '{"action":"pause-governance","reason":"hitl_deferred",...}'`)
   - `skip` → `execution_sequencer.js skip <state-path> <plan-path> {taskId}`,reason 写入 journalSummary

**降级**:`AskUserQuestion` 不可用 → 打印 HITL 说明并显式停在 Step 4(不进 Step 5),输出 `HITL wait: 请回复 "proceed/defer/skip {reason}" 后我再继续`,等下条用户消息分流。HARD-GATE #5 无例外。

老 plan 无 `Interaction` 字段 → `task_parser` 默认 `AFK`,行为不变。

## Step 5: 执行任务动作

按任务 `actions` 执行:`create_file` / `edit_file` / `run_tests` / `quality_review` / `git_commit`。

### TDD 触发条件

全部满足才触发 → 走 [`../tdd/SKILL.md`](../tdd/SKILL.md) 红绿蓝循环:
1. 任务 `phase` 为 `implement` / `ui-*`
2. 项目存在 Spec + 可执行的测试命令
3. actions 含 `create_file` / `edit_file`
4. 文件类型非豁免(配置、文档、迁移、声明、桶文件)

不满足 → 直接执行,不强制 TDD。

### 并行执行

仅在平台支持且能证明同阶段任务彼此独立时启用。门槛:
- `batch_orchestrator.js config` 返回 `enabled: false` 或 `maxConcurrency <= 1` → 跳过并行
- 含 `git_commit` / `quality_review` 的任务**禁止**编入并行批次(写共享状态会真竞争)
- 分派复用 `dispatching-parallel-agents`;只读批次不 provision worktree,写文件批次 provision 后再启动 subagent

详细 CLI 与返回字段:[`references/parallel-dispatch.md`](references/parallel-dispatch.md)。平台检测、结果回收、冲突降级:[`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md)。

### Sub-agent dispatch prompt 契约

通过 Task / `spawn_agent` 派发任意 sub-agent 时,**dispatch prompt 第一行必须是** `Active task: <task_id>`(可选附加 `Spec:` / `Plan:` 行)。这是 hook 失效场景下 sub-agent 仍能识别 active task 的唯一兜底。详见 [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md) § Dispatch Prompt Contract。`pre-execute-inject.js` 在 hook 端做幂等 normalize,dispatcher 已写则不重复。

## Step 6: Post-Execution（per task）

| 步骤 | 条件 | 说明 |
|------|------|------|
| ① 验证 | **必选** | 运行验证命令，`valid !== true` → mark failed，停止 |
| ② Checkpoint | **必选** | `advance {taskId}` 更新 plan.md + state.json |
| ③ 自审查 | task 涉及 ≥3 文件修改 | 按 [`references/self-review-checklist.md`](references/self-review-checklist.md) 扫描 |
| ④ Journal | 暂停/workflow 完成时 | `workflow_cli.js journal add` |

权威 checklist:[`references/execution-checklist.md`](references/execution-checklist.md)。

### ① 验证

```bash
node ~/.agents/agent-workflow/core/utils/workflow/verification.js create \
  --cmd "{验证命令}" --exit-code 0 --output "{预期}" --passed
```

`validation.valid === true` 才能进入 ② Checkpoint。

### ② Checkpoint

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js advance {taskId}
```

输出:`✅ {TaskId} checkpoint: completed=[...], current=[...]`

`advance`/`complete` 在 planned 状态下自动升级 status 到 running。

### ③ 自审查（条件）

触发: task 修改 ≥3 个文件 OR task phase=implement 且非配置文件。
输出:`自审查: X/Y 项通过` 或 `自审查: 已跳过（{原因}）`

### ④ Journal（条件）

触发: Governor 暂停、workflow 最后一个 task 完成时。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal add \
  --title "完成 {tasks}" --tasks-completed "{ids}" --summary "{摘要}"
```

## Step 7: 循环决策

Post-Execution 完成后回到 Step 3 对下一个 task 执行 ContextGovernor decide。

**跳过条件**: 上次 decide 结果为 `continue-direct` 且距离上次 decide ≤2 个 task → 直接继续，不调用 Governor。Phase 边界、quality gate、`pause_before_commit` 处必须执行 decide。

**连续模式**: 跨 phase 边界连续执行，质量关卡后暂停展示 review 结果。

**阶段模式**: 同 phase 内连续执行，phase 边界变化时暂停。

## 特殊模式

### 重试模式(`--retry`)

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js retry <state-path> <task-id>
```

CLI 自动管理重试计数和 hard stop。返回 `retryable: false` 且 `reason: 'hard-stop'`(连续 3 次失败)→ 质疑架构并与用户讨论。

调试方法论(根因调查 → 模式分析 → 假设验证 → 实施修复)走 [`../diagnose/SKILL.md`](../diagnose/SKILL.md)。第 1 次执行完整四阶段;第 2 次加强模式分析;第 3 次 Hard Stop 质疑架构。

成功后重置:
```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js retry-reset <state-path> <task-id>
```

### 跳过模式(`--skip`)

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js skip <state-path> <plan-path> <task-id>
```

CLI 自动标记 `skipped` + 更新 plan.md + state.json + 找下一任务。

> Skip 是例外路径,不执行验证、自 review 或完整完成管线。

## 渐进式 workflow

`mode: progressive` 时:自动跳过被阻塞任务(`blocked_by` 依赖未解除)→ 只执行可执行任务 → 所有任务被阻塞时转为 `blocked` → 用户 `workflow_cli.js unblock <dep>` 解除后继续。

## Step 8: workflow 完成

所有 task `completed`(或 `skipped`)时:

1. 生成实施报告(模板见 [`references/implementation-report.md`](references/implementation-report.md)),输出到 `~/.claude/workflows/{pid}/reports/{task-name}-report-{MMDD}.md`
2. 状态设为 `review_pending`,报告路径写入 `state.report_path`
3. 输出:
```
🛑 执行完成。状态已设为 review_pending。
请执行 /workflow-review 进行全量完成审查。
审查通过后工作流将自动标记为 completed。
```

**实施报告 checkpoint**(必须输出):
```
📊 Report: ~/.claude/workflows/{pid}/reports/{task-name}-report-{MMDD}.md（{N} 行）
```

> 报告生成是 Step 8 的一部分,不是可选项。报告数据来自 `workflow-state.json`(progress, quality_gates)、`plan.md`(原始任务)、`git diff`(delta 统计)。
>
> 不得绕过 `review_pending` 直接标记 `completed`。这是 HARD-GATE #4。

## Red Flags

出现以下行为即为执行违规:
- 不读 state.json 就开始读 plan.md 或源码
- 没跑验证就标 completed
- 多个 task 攒到最后批量回写 plan.md / state.json
- 满足 TDD 条件但跳过红绿蓝循环
- 任务 `interaction == 'HITL'` 时跳过 AskUserQuestion
- 已失败 ≥ 2 次仍"再试一次"而不走 diagnose 四阶段
- Step 7 最后一个 task 前没跑过 Governor `decide`
- 直接把 status 写成 `completed` 而不经 `review_pending`
