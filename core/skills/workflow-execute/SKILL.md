---
name: workflow-execute
description: "Use when 用户调用 /workflow-execute, or workflow-state.json 处于 planned/running/halted 需要继续推进任务。"
---

> 路径 convention + CLI 写入 contract 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。

# workflow-execute

<HARD-GATE>
1. **状态优先**:先读 workflow-state.json,不得通过仓库代码猜测运行时状态
2. **验证铁律**:没有新鲜验证证据,不得标记任务为 completed
3. **TDD 手动开启铁律**:只有用户显式传入 `--tdd` 时才进入 TDD 路径;默认不启用 TDD。启用后按 [`../tdd/SKILL.md`](../tdd/SKILL.md) 执行,无失败测试不得编写生产代码
4. **完成推进铁律**:最后一个 task 完成后,必须将状态设为 `review_pending` 并提示 `/workflow-review`,不得直接标记 completed
5. **HITL 确认铁律**:任务 `interaction == 'HITL'` 时,implementer subagent 首次返回前必须经过一次主会话 `AskUserQuestion`(协议:implementer prompt 头部强制 `NEEDS_CONTEXT` → 主会话 `AskUserQuestion` 收集回答 → 答案塞回 prompt 重派);不得跳过人工确认直接执行
6. **Subagent 隔离铁律**:claude-code / cursor / codex 平台下,每 task 必须起 fresh implementer subagent + 单 reviewer subagent(合并 AC+质量两 phase,见 `prompts/reviewer.md`);其他平台降级到主会话 + 单段 self-review。不得在支持 subagent 的平台静默走 degraded 路径
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

### Mode(execution mode)

| 命令 | 模式 |
|------|------|
| `workflow-execute` | 连续模式(默认) |
| `--phase` | 阶段模式 |
| `--retry` | 重试模式 |
| `--skip` | 跳过模式 |
| `--tdd` | 手动开启 TDD 路径(可与上述模式组合) |

**自然语言映射**:`继续/连续` → continuous、`下一阶段/单阶段` → phase、`重试` → retry、`跳过` → skip

**裸"继续"解析**:仅在存在活动 workflow（`running` 或 `halted`）且当前对话仍在该 workflow 上时恢复（对应 `RESUME_ENTRY_STATUSES`）。`planned` 状态需显式 `workflow-execute` 命令启动（对应 `EXECUTE_ENTRY_STATUSES`）;`spec_review` 不适用。

**优先级**:显式模式 > 自然语言 > `state.execution_mode` > `continuous`

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute [意图]
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute --mode phase    # 带模式参数
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute --tdd           # 手动开启 TDD
```

CLI 返回 `entry_action` / `resolved_mode` / `tdd_enabled` / `state_status` / `can_resume`。`entry_action: 'none'` 时按 `message` 字段提示用户。`tdd_enabled !== true` 时,即使任务形态适合测试先行,也不得自动引用 TDD skill。

**自愈后 upgrade_required 检测**:`cmdInit` 自愈出 `upgrade_required: true` = 找到 plan 但找不到 spec 文件。优先 `/workflow-spec` 重建 spec 后再执行;确认放弃 spec 审批留痕用 `/workflow-execute --force`。

## Step 2: 读取状态(state-first)

**铁律**:在确认 state.status / state.current_tasks 之前,不得读取 plan.md、源码或展开 Patterns to Mirror。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js next
```

**状态预检查**:
- `planned` → 首次调 `advance` 时 CLI 自动升为 `running`(返回 `status_transition: "planned->running"`),无需手动转换
- `halted` (`halt_reason: 'failure'`) → 提示 `--retry` 或 `--skip`
- `halted` (`halt_reason: 'dependency'`) → 提示 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dep>`
- `halted` (`halt_reason: 'governance'`) → 显示暂停原因,用户确认后恢复
- 渐进式 workflow:检查是否所有任务都被阻塞

**Git 分支检测**(建议性):检测是否在 main/master,建议创建 feature branch。不阻塞执行。

### 状态文件自愈

`workflow-state.json` 不存在 → `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js init` 自动从 plan.md 推导首个未完成任务并创建最小状态文件。多个 plan 候选时 CLI 返回错误（`detected_plans` 数组）→ 展示列表让用户选择,不自行猜测。

**自愈失败 → fail-fast**:权限不足、磁盘满、plan.md 不存在时终止执行并提示用户检查后重试。**不得静默继续**。

**自愈审批状态**:重建状态文件时,`user_spec_review` 根据 spec 文件存在性差异化处理:
- `spec_file` 存在 → `user_spec_review` 恢复为 `approved`(reviewer: `system-recovery`)
- `spec_file` 不存在 → `user_spec_review` 标记为 `skipped`
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

CLI 返回 `{action, reason, ...}`。非 `continue-*` 决策必须调 `apply-decision` 落盘:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js apply-decision <state-path> --decision-json '<上一步返回的 JSON>'
```

**通知分级**:`pause-before-commit` / `pause-governance` 简短一句话;`pause-budget` / `handoff-required` 必须给 3 要素:① 覆盖原因含具体数据(如 projected 82% > danger 80%) ② 原模式保留 ③ 建议动作。各 action 含义以 CLI `reason` 字段为准;`handoff-required` 时额外提示用户开新会话恢复(state 已写 `continuation.handoff_required=true`)。

> `decide` 不判 quality_gate —— 质量门暂停由 Step 7 post-execution governance 在 task 完成 + reviewer 出结果后处理。

**advisory 软提示**:`continue-direct` 决策可能携带 `advisory: 'consider-handoff-or-split'`(高 context pollution + 独立 task 组合命中时给出)。主会话 banner 一句话提示用户"context pressure 高 + 后续 task 独立,可考虑开新会话或拆分 plan",**不阻塞执行**。

## Step 4: 提取当前任务 + 显示上下文

仅在 Step 2 已确认 `state.current_tasks` 后:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/task_parser.js parse --task-id T3 <plan-path>
```

按需显示(当前 task 级别):任务 ID、名称、阶段、文件、验收项、依赖、**Interaction** 字段(`AFK` 默认 / `HITL` 必走 4.1)、**Patterns to Mirror**、**Mandatory Reading**(P0 必读)。

### 4.1 HITL 任务门槛(条件触发)

**触发条件**:`interaction === 'HITL'`。implementer subagent 首次派发前**必须**完成以下(违反 = HARD-GATE #5):

1. **implementer prompt 头部强制注入** `Before any code change, you MUST emit NEEDS_CONTEXT with the questions the human needs to answer.`
2. Implementer 返回 `NEEDS_CONTEXT` 时，主会话**调用 `AskUserQuestion`** 收集人工答复:
   - question:`任务 {taskId} 标记为 HITL:{任务名}。implementer 反问:{questions}。是否可以继续?`
   - options:`proceed`(把答案塞回 prompt 重派 implementer) / `defer`(任务保留 pending,workflow 进入 paused) / `skip`(跳过并标 skipped,需 reason)
3. **按选择分流**:
   - `proceed` → 把 AskUserQuestion 答案补进 implementer prompt 重派
   - `defer` → 走 Step 3 已有的非 `continue-*` 分支(`apply-decision ... --decision-json '{"action":"pause-governance","reason":"hitl_deferred",...}'`)
   - `skip` → `execution_sequencer.js skip <state-path> <plan-path> {taskId}`,reason 写入 journalSummary

**降级**:`AskUserQuestion` 不可用 → 打印 implementer 反问并显式停在 Step 4(不进 Step 5),输出 `HITL wait: 请回复 "proceed/defer/skip {reason}" 后我再继续`,等下条用户消息分流。HARD-GATE #5 无例外。

**Degraded 平台(无 subagent)**：主会话扮演 implementer 时仍需在第一时间输出 `NEEDS_CONTEXT` + 调 `AskUserQuestion`，行为等价。

老 plan 无 `Interaction` 字段 → `task_parser` 默认 `AFK`,行为不变。

## Step 5: 执行任务动作

**默认行为(fresh-subagent-per-task)**：每个 task **必须**起一个 fresh implementer subagent 完成实现，再起**单 reviewer subagent**（合并 AC + 代码质量两 phase，AC→质量顺序，见 [`prompts/reviewer.md`](prompts/reviewer.md)）。controller(主会话) 只做编排，不直接写代码。

平台支持矩阵 + 降级规则 + Implementer 4 状态分流见 [`references/subagent-driven.md`](references/subagent-driven.md)。本节只给最小操作流。

### 5.1.0 task-bundle 准备（必须）

派发 implementer 前调:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js task-bundle <task-id>
```

返回 JSON 含 `task_text` / `acceptance_criteria` / `critical_constraints` / `patterns_to_mirror` / `mandatory_reading` / `allowed_write_paths` / `forbidden_actions` / `verification`。controller 按 [`prompts/implementer.md`](prompts/implementer.md) 模板的 `${bundle.*}` 占位填充 prompt;不再手工 Read plan.md 切片。

task-bundle 失败(`task_id` not found / state.json 异常)→ 走 Step 2 状态自愈,不要手工切片绕过。

### 5.1 派发 implementer subagent

按 [`prompts/implementer.md`](prompts/implementer.md) 模板构造 dispatch prompt:

- **第一行必须**：`Active task: <task_id>`(可选附加 `Spec: <path>` / `Plan: <path>`)
- 注入完整 task text(从 plan.md 提取)+ 关键约束 + 验收项
- HITL task 头部追加 `"Before any code change, you MUST emit NEEDS_CONTEXT with the questions the human needs to answer."`(HARD-GATE #5)

Implementer 返回 4 种状态（**严格 JSON-only**）:

| 状态 | 处理 |
|------|------|
| `DONE` | 进入 5.2 reviewer（合并） |
| `DONE_WITH_CONCERNS` | 读 concerns;correctness 类先修后再 review;observation 类记录后 review |
| `NEEDS_CONTEXT` | controller 通过 `AskUserQuestion` 收集回答后重派 implementer |
| `BLOCKED` | 评估根因:context 缺失 → 补 context 重派;reasoning 不足 → 升级 model;task 过大 → 拆 task;plan 错 → escalate user |

### 5.2 派发 reviewer subagent（合并 AC + 质量）

按 [`prompts/reviewer.md`](prompts/reviewer.md) 构造单 subagent prompt，单 context 内顺序执行两 phase:

- **Phase 1 — Acceptance Compliance**：覆盖性 / 超额 / 关键约束。Phase 1 REVISE → 直接返回，不进 Phase 2。
- **Phase 2 — Code Quality**：critical / important / minor 三档。critical/important 必修；minor 记录于本 task journal 不阻塞。

Controller 注入约束:
- **不预读整文件正文**：只注入 `files_changed` 路径 + `diff-base-commit` SHA，reviewer 自跑 `git diff`。
- **task acceptance + constraints 完整粘进 prompt**。
- **code-specs context 注入**：把 `.claude/code-specs/{pkg}/{layer}/` 中适用本 task 的段落粘进 `<code-specs-context>`。

Reviewer 返回**严格 JSON-only**。schema 非法 → controller 重派 1 次；仍失败 → halt + `halt_reason: 'reviewer-schema-failure'`。

判定:

| `decision` | controller 动作 |
|------|---------|
| `PASS` | 进入 Step 6 post-execution |
| `REVISE` (phase1) | `revise_instructions` 塞回 implementer → 重派 → 重 review |
| `REVISE` (phase2 critical/important 非空) | 同上；phase2.minor 记录入 task journal 不阻塞 |

循环上限 3 次（implementer ↔ reviewer），超过 → `halted` + `halt_reason: 'review-loop'`，等用户介入。

### Stuck 触发 oracle 回灌（loop = 2）

implementer ↔ reviewer loop 进行到 **第 2 次仍 REVISE** 时，controller(主会话) 在 runtime task state 上程序化标 `stuck_or_looping`(随 task 生命周期持有,不入 state.json 持久层),按 `core/specs/shared/codex-routing.md § Decision Table` 调 `collaborating-with-codex` `--oracle-review`（声明式 opt-in）。**只有 controller 触发 codex,不下放给 implementer / reviewer subagent**。

- 调用 contract:见 `codex-routing.md § Invocation Contract`(TASK / CONTEXT / FILES / RISK_SIGNALS / NON_GOALS 必填)
- 输入映射：`TASK` = task acceptance + reviewer 累计 findings；`CONTEXT` = task constraints + spec 摘要；`FILES` = task `files_changed` + 相关 code-specs 路径；`RISK_SIGNALS` = `stuck_or_looping`；`NON_GOALS` = 越界重构 / 无关清理
- 输出：oracle 给的 alternative POV / 根因分析 / 推荐方向（read-only,不写代码）
- 用途：作为 **第 3 次重派的 `revise_instructions` 增强输入**;第 3 次 implementer **仍按 Step 5.1 派发路径**(task-bundle 见 Step 5.1.0,supported 平台 fresh implementer subagent / 无 subagent 平台走下方 Degraded mode),实现完成后照常进 Step 5.2 reviewer。oracle 不接管实现
- 预算：codex 调用**不消耗** loop 预算,第 3 次循环按原节奏跑,仍失败 → 上面 halt 不变
- 降级：codex 不可用 → controller 跳过 oracle 回灌直接第 3 次重派,journal 写 `codex-status: codex_degraded` + 降级原因

### 5.3 codex 回归 triage（implementer 走 codex 路径时必须）

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js triage --result <job-id> [--strict]
```

返回 `{ in_scope, out_of_scope, suggested_reverts, reasons }`。对 `suggested_reverts` 内文件统一 `git checkout --` 还原;`in_scope` 进入 5.2 reviewer。

`--strict` 模式可作 CI / hook 守门(`out_of_scope` 非空 → exit 1)。

triage 不替代 git diff 内容检查,但替代了文件级越界识别。

### TDD 手动开启条件

默认不走 TDD 路径。仅当入口返回 `tdd_enabled: true`(用户显式 `/workflow-execute --tdd`) 且以下条件全部满足时,才触发 → implementer prompt 中引用 [`../tdd/SKILL.md`](../tdd/SKILL.md) 红绿蓝循环:
1. 任务 `phase` 为 `implement` / `ui-*`
2. 项目存在 Spec + 可执行的测试命令
3. actions 含 `create_file` / `edit_file`
4. 文件类型非豁免(配置、文档、迁移、声明、桶文件)

未传 `--tdd` 或条件不满足 → implementer 直接实现,不引用 TDD skill,不强制先写失败测试。

### Degraded mode(无 subagent 平台)

opencode/antigravity/droid/gemini 等无 subagent 平台 → controller 主会话直接执行 implementer 角色,完成后走单段 self-review(按 `prompts/reviewer.md` 两 phase 顺序 self-check,不起 reviewer subagent)。**质量上限低于 claude-code/cursor/codex 模式。**

## Step 6: Post-Execution（per task）

| 步骤 | 条件 | 说明 |
|------|------|------|
| ① 验证 | **必选** | 运行验证命令，`valid !== true` → mark failed，停止 |
| ② Checkpoint | **必选** | `advance {taskId}` 更新 plan.md + state.json |
| ③ Journal | 暂停/workflow 完成时 | `workflow_cli.js journal add` |

> Step 5.2 reviewer PASS 且 Step 6.① 验证通过后才能 advance。

权威 checklist:[`references/execution-checklist.md`](references/execution-checklist.md)。

### ① 验证

```bash
node ~/.agents/agent-workflow/core/utils/workflow/verification.js create \
  --cmd "{验证命令}" --exit-code 0 --output "{预期}" --passed
```

`validation.valid === true` 才能进入 ② Checkpoint。

若 task 验收项要求某些产物文件必须存在,append `--require-files <csv>`:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/verification.js create \
  --cmd "..." --exit-code 0 --output "..." --passed \
  --require-files apps/.../X.test.ts,apps/.../Y.test.ts
```

缺任一 → `validation.valid: false` + `violations: ["missing_required_files:<file>"]`,advance 拒绝。

### ② Checkpoint

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js advance {taskId}
```

输出:`✅ {TaskId} checkpoint: completed=[...], current=[...]`

`advance`/`complete` 在 planned 状态下自动升级 status 到 running。

### ③ Journal（条件）

触发: Governor 暂停、workflow 最后一个 task 完成时。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal add --title "完成 {tasks}" --tasks-completed "{ids}" --summary "{摘要}"
```

## Step 7: Post-Execution Governance + 循环决策

Step 6 ①②③ 完成后,先调 post-execution governance 看是否要暂停展示 review 结论,通过则回到 Step 3 对下一个 task decide。

### 7.1 Post-Execution Governance

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js decide-post-execution <state-path> \
  --completed-task-json '{"id":"T3","quality_gate":true,"actions":[...]}' \
  --review-result-json '{"passed":true,"decision":"approved"}'
```

CLI 返回 `{action, reason, severity, budget, primarySignals}`。判定矩阵:

| 条件 | action | severity | 处理 |
|------|--------|----------|------|
| `budget.at_hard_handoff` | `handoff-required` | critical | `apply-decision` 落 halted,提示用户开新会话恢复 |
| `reviewResult.passed === false` (终态 reject) | `pause-quality-gate` | warning | `apply-decision` 落 halted,展示 review issues,用户决策 escalate/accept-deviation/手动修复 |
| `completedTask.quality_gate && budget.at_warning/danger` | `pause-quality-gate` | info | 落 halted,展示 review 结论,用户决策是否继续 |
| 其他 | `continue-direct` | info | 继续 Step 7.2 |

> `pause-before-commit` 仅由 pre-execution `decide` 处理（看 next task 的 git_commit action）。post-execution 不再判定该 action —— commit 已执行就 pause 是语义倒置。

非 `continue-*` 决策走:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js apply-decision <state-path> --decision-json '<7.1 返回>'
```

落盘后输出 review 结论摘要 + 暂停原因。用户确认后用 CLI 动词恢复（**禁止手编 state.json**）:

```bash
# 治理 halt 恢复（halt_reason=governance 专用）
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js resume-from-governance-halt
```

### 7.2 下一个 task 的 pre-execution decide（Step 3 循环）

回到 Step 3 对下一个 task 执行 `decide`（预算 / phase 边界 / pause-before-commit）。

**跳过条件**: 上次 decide 结果为 `continue-direct` 且距离上次 decide ≤2 个 task → 直接继续，不调用 Governor。Phase 边界、`pause_before_commit` 处必须执行 decide。质量门已迁 Step 7.1，不在此豁免名单。

**连续模式**: 跨 phase 边界连续执行，质量关卡由 Step 7.1 处理。

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

`mode: progressive` 时:自动跳过被阻塞任务(`blocked_by` 依赖未解除)→ 只执行可执行任务 → 所有任务被阻塞时转为 `halted`（`halt_reason: 'dependency'`）→ 用户 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dep>` 解除后继续。

## Step 8: workflow 完成

所有 task `completed`(或 `skipped`)时:

1. 生成实施报告(模板见 [`references/implementation-report.md`](references/implementation-report.md)),输出到 `~/.claude/workflows/{pid}/reports/{task-name}-report-{MMDD}.md`
2. 状态设为 `review_pending`,报告路径写入 `state.review_report_path`（**禁止手编 state.json**;用 `workflow_cli.js set-report-path <path>`）
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

HARD-GATE 已覆盖的违规不在此重复。下列行为同样违规:
- 多个 task 攒到最后批量回写 plan.md / state.json（每个 task 立即 advance）
- 已失败 ≥ 3 次仍"再试一次"而不走 diagnose 四阶段（CLI hard-stop 在 `retry_count >= 3` 时触发）
- 最后一个 task 完成前没跑过 Governor `decide`

## CLI 参考

- `workflow_cli.js task-bundle <task-id>` — Step 5.1.0
- `workflow_cli.js triage --result <job-id> [--strict]` — Step 5.4
- `workflow_cli.js verify-readiness` — TDD red 起不来前的预检(可选;项目 `workflow.readiness` 声明启用 check 时调)
- `verification.js create ... --require-files <csv>` — Step 6 ① 强化
- `execution_sequencer.js decide-post-execution <state> ...` — Step 7.1 post-execution governance
- `workflow_cli.js resume-from-governance-halt` — Step 7.1 治理 halt 恢复
- `workflow_cli.js set-report-path <path>` — Step 8 落盘报告路径
- `workflow_cli.js advance <task-id> [--full]` — 默认 next_task 仅 `{id, name}`;完整数据走 task-bundle
