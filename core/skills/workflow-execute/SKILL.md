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
4. **完成推进铁律**:最后一个 task 完成后,必须 inline 派 final reviewer 跑整 branch diff vs spec;**末尾终审未过不得标记 `completed`**
5. **HITL 确认铁律**:任务 `interaction == 'HITL'` 时,implementer subagent 首次返回前必须经过一次主会话 `AskUserQuestion`(协议:implementer prompt 头部强制 `NEEDS_CONTEXT` → 主会话 `AskUserQuestion` 收集回答 → 答案塞回 prompt 重派);不得跳过人工确认直接执行
6. **Subagent 隔离铁律**:claude-code / cursor / codex 平台下,每 task 必须起 fresh implementer subagent + 单 reviewer subagent(合并 AC+质量两 phase,见 `prompts/reviewer.md`);其他平台降级到主会话 + 单段 self-review。不得在支持 subagent 的平台静默走 degraded 路径
</HARD-GATE>

## Checklist

1. ☐ 解析执行模式 + 一次性持全 task 切片
2. ☐ 读取 workflow 状态(state-first)
3. ☐ 显示当前 task 上下文 + HITL 门槛
4. ☐ 执行任务动作
5. ☐ Post-Execution(验证 + checkpoint + journal)
6. ☐ 完成本 task → 直接取下一 task(controller 内联循环)
7. ☐ 所有 task 完成 → inline 终审 + 状态推进 completed

---

## Step 1: 解析执行模式 + 一次性持全 task 切片

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

### 一次性持全 task 切片(必须)

**task 源 = task-dir**(`~/.claude/workflows/{pid}/tasks/{taskId}/{task.json,task.md,context.jsonl}`),非 plan.md 物理解析。每个 task 的 rich 执行切片(task_text + acceptance + constraints + patterns/mandatory-reading + files + 验证)存于 **task.json v2 结构化字段**,并渲染为人读 **task.md**。确认 state(下方 Step 2)后,controller **一次性**从 task 源(`TaskSource(state).listTasks()`)读全部 task 元数据持于内存。派发 implementer 时,`pre-execute-inject` hook **自动把当前 task 的 task.md 渲染正文注入 `<current-task>`**(源自 task-dir,**非 plan.md、非 task-bundle**)——guardrails(constraints/patterns/mandatory)随之到达 implementer。**不每 task 重读,也不再调 `task-bundle`**(对齐 superpowers controller-持全 范式,见 [`references/subagent-driven.md`](references/subagent-driven.md))。

- 后续每个 task 的 implementer / reviewer prompt **从这份内存切片构造**(衔接 `prompts/implementer.md` / `prompts/reviewer.md`),不回头读盘。
- plan.md 在新模型下退化为**可选人类可读叙述**(front matter + 锚点),非机器 task 源——execute 不依赖它解析 task。
- **legacy 兼容**:存量 plan.md 格式旧 workflow(无 task-dir)由 `LegacyPlanMdSource` 兜底,经 `parseTasksV2` 从 plan.md 读 task 序列(C-7),切片来源等价,执行路径不变。`TaskSource` 工厂按 state 自动选 adapter。

## Step 2: 读取状态(state-first)

**铁律**:在确认 state.status / state.current_tasks 之前,不得读取 task 源、源码或展开 Patterns to Mirror。

**resume 三元组**:resume 锚点 = `current_tasks[0]` + `status` + **task 源**(task-dir,legacy 则 plan.md)三者(C-1)。`/clear` 后从 disk 重建靠这三者:`current_tasks[0]` = task 源 `firstTaskId()`,`status ∈ {planned,running,halted}` 决定可恢复性,task 源给全部 task。`status=planned ⟹ task 源存在` 由 `assertTaskSourcePresent` 单点守门,缺失统一报 `task_source_missing` 阻断 execute 入口。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js next
```

**首次打印 plan 路径(必须)**:确认 state 后,从 `status` 返回的 `plan_file`(绝对路径)向用户打印一行,方便执行期 review plan:

```
📋 Plan: <plan_file 绝对路径>
```

`plan_file` 缺失(自愈失败 / 路径未解析)→ 不打印,按下方"状态文件自愈"处理。

**读 handoff(plan→execute,定向)**:确认 state 后读 plan 阶段决策摘要,定向 task 派发,**禁**整篇读 plan.md / spec.md 全文(全文交 subagent 按路径自读;controller 只持 contract-digest + task 源切片)。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js read-handoff --from plan
```

返回 JSON `{fresh, content?, reason?, fallback?}`。`fresh:true` → 用 handoff 里的 Decisions/Rejected/Risks + contract-digest 指针辅助 Step 3/4 派发;`fresh:false`(stale/missing)→ 不阻断,回退按既有 state-first 路径从 task 源(task-dir)读全 task 切片(Step 1 一次性持全 task 切片);legacy plan.md workflow 经 `LegacyPlanMdSource` 兜底。

> **语义边界(handoff 不重复)**:handoff 装本阶段决策/取舍 + 指针;contract(既有代码复用面,contract-digest.md 经 hook 注入 implementer/reviewer)、spec(需求)、code-specs(项目规范)各有落点,handoff 不复写其正文。

**状态预检查**:
- `planned` → 首次调 `advance` 时 CLI 自动升为 `running`(返回 `status_transition: "planned->running"`),无需手动转换
- `halted` (`halt_reason: 'failure'`) → 提示 `--retry` 或 `--skip`
- `halted` (`halt_reason: 'dependency'`) → 提示 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dep>`
- `halted` (`halt_reason: 'review-loop'`) → 展示 reviewer 累计 issues,等用户介入
- 渐进式 workflow:检查是否所有任务都被阻塞

**Git 分支检测**(建议性):检测是否在 main/master,建议创建 feature branch。不阻塞执行。

### 状态文件自愈

`workflow-state.json` 不存在 → `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js init` 自动从 plan.md 推导首个未完成任务并创建最小状态文件。多个 plan 候选时 CLI 返回错误（`detected_plans` 数组）→ 展示列表让用户选择,不自行猜测。

**自愈失败 → fail-fast**:权限不足、磁盘满、plan.md 不存在时终止执行并提示用户检查后重试。**不得静默继续**。

**自愈审批状态**:重建状态文件时,`user_spec_review` 根据 spec 文件存在性差异化处理:
- `spec_file` 存在 → `user_spec_review` 恢复为 `approved`(reviewer: `system-recovery`)
- `spec_file` 不存在 → `user_spec_review` 标记为 `skipped`
- 自愈后首次执行时,Step 3 显示 `⚠️ 状态已自愈恢复,spec 审批标记为 system-recovery`

**路径安全校验**:用 `resolveUnder` 校验 `plan_file` / `spec_file` 在允许范围内。参见 [`../../specs/workflow-runtime/shared-utils.md`](../../specs/workflow-runtime/shared-utils.md)。

## Step 3: 显示当前 task 上下文 + HITL 门槛

仅在 Step 2 已确认 `state.current_tasks` 后,从 **Step 1 持有的 task 切片**取当前 task(不重读 plan),按需显示(当前 task 级别):任务 ID、名称、阶段、文件、验收项、依赖、**Interaction** 字段(`AFK` 默认 / `HITL` 必走 3.1)、**Patterns to Mirror**、**Mandatory Reading**(P0 必读)。

### 3.1 HITL 任务门槛(条件触发)

**触发条件**:`interaction === 'HITL'`。implementer subagent 首次派发前**必须**完成以下(违反 = HARD-GATE #5):

1. **implementer prompt 头部强制注入** `Before any code change, you MUST emit NEEDS_CONTEXT with the questions the human needs to answer.`
2. Implementer 返回 `NEEDS_CONTEXT` 时，主会话**调用 `AskUserQuestion`** 收集人工答复:
   - question:`任务 {taskId} 标记为 HITL:{任务名}。implementer 反问:{questions}。是否可以继续?`
   - options:`proceed`(把答案塞回 prompt 重派 implementer) / `defer`(任务保留 pending,显式停在当前 Step 等用户回复,不写盘) / `skip`(跳过并标 skipped,需 reason)
3. **按选择分流**:
   - `proceed` → 把 AskUserQuestion 答案补进 implementer prompt 重派
   - `defer` → 任务保留 pending,显式停在 Step 3(不进 Step 4),输出 `HITL deferred: 该 task 待人工决策,回复 proceed/skip 后继续`,等下条用户消息;不推进、不手编 state.json
   - `skip` → `execution_sequencer.js skip <state-path> <plan-path> {taskId}`,reason 写入 journalSummary

**降级**:`AskUserQuestion` 不可用 → 打印 implementer 反问并显式停在 Step 3(不进 Step 4),输出 `HITL wait: 请回复 "proceed/defer/skip {reason}" 后我再继续`,等下条用户消息分流。HARD-GATE #5 无例外。

**Degraded 平台(无 subagent)**：主会话扮演 implementer 时仍需在第一时间输出 `NEEDS_CONTEXT` + 调 `AskUserQuestion`，行为等价。

老 plan 无 `Interaction` 字段 → `task_parser` 默认 `AFK`,行为不变。

## Step 4: 执行任务动作

**默认行为(fresh-subagent-per-task)**：每个 task **必须**起一个 fresh implementer subagent 完成实现，再起**单 reviewer subagent**（合并 AC + 代码质量两 phase，AC→质量顺序，见 [`prompts/reviewer.md`](prompts/reviewer.md)）。controller(主会话) 只做编排，不直接写代码。

> **Controller 上下文纪律(铁律)**:controller 全程**不读业务源码 / plan.md / spec.md 全文**(任何通道,含 `cat/grep/sed/rg` bash),只持 contract-digest + Step 1 task 切片;`workflow_cli status/context`、`git diff/log` 等诊断输出取字段不全量 dump;源码/diff 读取与验证一律下放 subagent。详见 [`references/subagent-driven.md`](references/subagent-driven.md)「不允许的行为」——违反是单会话上下文膨胀主因。

> **机器 review 显式开启(FR-6)**：**codex 自动 review** 默认关闭,需显式开启。降级的是「自动触发」,不是删除能力——开启后完整恢复。
>
> **降级对象(默认关,显式开)**:
> - **codex spec/plan review**(`planning_gates.shouldRunCodex*Review` + `codex_review_runner.triggerCodexReview`):spec/plan 审批时默认**不**自动 spawn codex job;`review_status.codex_spec_review` / `codex_plan_review` / `plan_review` 子对象默认**不**实例化。
> - **codex oracle/enhanced 回灌**(Step 4.2 第 2 次 REVISE 后的 `--oracle-review`、末尾 codex 增强终审):本就声明式 opt-in,保持显式。
>
> **开启方式**(任一即恢复 codex 自动 review):
> - **config 开关**:`project-config.json` 设 `workflow.review.codex = true`(或整体 `workflow.review = true`)。
> - **命令 flag**:`planning_gates.js codex-spec-review/codex-plan-review` 传 `--review-enabled`(供上游命令层透传)。
>
> **不在降级范围(始终保留的核心质量门)**:
> - **per-task reviewer**(Step 4.2 合并 AC+质量单 reviewer subagent)——HARD-GATE,每 task 必跑。
> - **末尾 final reviewer**(Step 7 整 branch 终审)——HARD-GATE #4,进 `completed` 的唯一门。
> - **`user_spec_review`** 人工 gate(C-1)——始终实例化,不受 review flag 影响。
>
> OQ-3 silent-done 补偿:review 默认关后,「execute 末仍可显式触发终审」即为补偿路径(Step 7 final reviewer 本就是无条件 HARD-GATE,不依赖 codex flag),未额外引入 `passes && reviewed` 双字段判定。

平台支持矩阵 + 降级规则 + Implementer 4 状态分流见 [`references/subagent-driven.md`](references/subagent-driven.md)。本节只给最小操作流。

### 4.1 派发 implementer subagent

implementer prompt **从 Step 1 持有的当前 task 切片构造**(`task_text` + controller 策展 context),不再调 `task-bundle` CLI、不回头读 plan.md。按 [`prompts/implementer.md`](prompts/implementer.md) 模板填充:

- **第一行必须**：`Active task: <task_id>`(可选附加 `Spec: <path>` / `Plan: <path>`)
- 注入完整 task text(取自 Step 1 切片)+ 关键约束 + 验收项
- HITL task 头部追加 `"Before any code change, you MUST emit NEEDS_CONTEXT with the questions the human needs to answer."`(HARD-GATE #5)

> 当前 task 在 Step 1 切片中找不到(state/plan 不一致)→ 走 Step 2 状态自愈,不要手工切片绕过。

Implementer 返回 4 种状态（**严格 JSON-only**）:

| 状态 | 处理 |
|------|------|
| `DONE` | 进入 4.2 reviewer（合并） |
| `DONE_WITH_CONCERNS` | 读 concerns;correctness 类先修后再 review;observation 类记录后 review |
| `NEEDS_CONTEXT` | controller 通过 `AskUserQuestion` 收集回答后重派 implementer |
| `BLOCKED` | 评估根因:context 缺失 → 补 context 重派;reasoning 不足 → 升级 model;task 过大 → 拆 task;plan 错 → escalate user |

### 4.2 派发 reviewer subagent（合并 AC + 质量）

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
| `PASS` | 进入 Step 5 post-execution |
| `REVISE` (phase1) | `revise_instructions` 塞回 implementer → 重派 → 重 review |
| `REVISE` (phase2 critical/important 非空) | 同上；phase2.minor 记录入 task journal 不阻塞 |

循环上限 3 次（implementer ↔ reviewer），超过 → `halted` + `halt_reason: 'review-loop'`，等用户介入。

### Stuck 触发 oracle 回灌（loop = 2）

implementer ↔ reviewer loop 进行到 **第 2 次仍 REVISE** 时，controller(主会话) 在 runtime task state 上程序化标 `stuck_or_looping`(随 task 生命周期持有,不入 state.json 持久层),按 `core/specs/shared/codex-routing.md § Decision Table` 调 `collaborating-with-codex` `--oracle-review`（声明式 opt-in）。**只有 controller 触发 codex,不下放给 implementer / reviewer subagent**。

- 调用 contract:见 `codex-routing.md § Invocation Contract`(TASK / CONTEXT / FILES / RISK_SIGNALS / NON_GOALS 必填)
- 输入映射：`TASK` = task acceptance + reviewer 累计 findings；`CONTEXT` = task constraints + spec 摘要；`FILES` = task `files_changed` + 相关 code-specs 路径；`RISK_SIGNALS` = `stuck_or_looping`；`NON_GOALS` = 越界重构 / 无关清理
- 输出：oracle 给的 alternative POV / 根因分析 / 推荐方向（read-only,不写代码）
- 用途：作为 **第 3 次重派的 `revise_instructions` 增强输入**;第 3 次 implementer **仍按 Step 4.1 派发路径**(prompt 从 Step 1 切片构造,supported 平台 fresh implementer subagent / 无 subagent 平台走下方 Degraded mode),实现完成后照常进 Step 4.2 reviewer。oracle 不接管实现
- 预算：codex 调用**不消耗** loop 预算,第 3 次循环按原节奏跑,仍失败 → 上面 halt 不变
- 降级：codex 不可用 → controller 跳过 oracle 回灌直接第 3 次重派,journal 写 `codex-status: codex_degraded` + 降级原因

### 4.3 codex 回归 triage（implementer 走 codex 路径时必须）

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js triage --result <job-id> [--strict]
```

返回 `{ in_scope, out_of_scope, suggested_reverts, reasons }`。对 `suggested_reverts` 内文件统一 `git checkout --` 还原;`in_scope` 进入 4.2 reviewer。

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

## Step 5: Post-Execution（per task）

| 步骤 | 条件 | 说明 |
|------|------|------|
| ① 验证 | **必选** | 运行验证命令，`valid !== true` → mark failed，停止 |
| ② Checkpoint | **必选** | `advance {taskId}` 更新 plan.md + state.json |
| ③ Journal | 暂停/workflow 完成时 | `workflow_cli.js journal add` |

> Step 4.2 reviewer PASS（critical/important 为 0）且 Step 5.① 验证通过后,**内存确认即继续**(不再落 per-task quality_gate 持久化记录,见 ADR 0004),直接 advance。

权威 checklist:[`references/execution-checklist.md`](references/execution-checklist.md)。

### ① 验证

```bash
node ~/.agents/agent-workflow/core/utils/workflow/verification.js create \
  --cmd "{验证命令}" --exit-code 0 --output "{预期}" --passed
```

`validation.valid === true` 才能进入 ② Checkpoint(advance)。

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

触发: workflow 暂停(halt)、最后一个 task 完成时。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal add --title "完成 {tasks}" --tasks-completed "{ids}" --summary "{摘要}"
```

## Step 6: 完成本 task → 直接取下一 task（controller 内联循环）

无 governor CLI。Step 5 advance 完成后,controller **内联**判断:

- 还有未完成 task → 直接取 Step 1 切片里的下一个 task,回到 Step 3。
- 全部 task `completed`/`skipped` → 进 Step 7 末尾终审。

**模式差异(纯 controller 内联,不调 CLI)**:

- **连续模式**:跨 phase 边界连续执行到底。
- **阶段模式**(`--phase`):同 phase 内连续;phase 边界变化时停下,提示用户确认进下一阶段。

### context 压力 banner（§9.4-1 启发式，无 CLI、无落盘）

删 governor 后无可靠 in-session token 计数。用基于 task 数 / `consecutive_count` 的**简单启发**,仅打印一行 banner 提示,**不阻塞、不写盘**:

- **连续完成 ≥ 6 个 task**(参考实测单会话 5–7 task 跑完的上限),或 `consecutive_count ≥ 6` → banner:
  `⚠️ 已连续完成 N 个 task,context 偏满。建议本批结束后 /clear 开新会话,新会话靠 plan + git log + progress.completed 手动定位续跑。`
- **当前 task 与已完成 task 文件域不重叠且后续 task 独立** → 可附一句:`后续 task 相互独立,适合在新会话续跑。`

阈值是经验值(非硬门限),用户可忽略继续。新会话无自动 resume——靠 plan.md + `git log` + `state.progress.completed` 手动定位进度。

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

## Step 7: 所有 task 完成 → inline 末尾终审 + 推进 completed

所有 task `completed`(或 `skipped`)时,controller **inline** 派一个 final reviewer subagent 做整 branch 终审(不再有独立终审阶段、无独立 review 中间态)。**这是进 `completed` 的唯一门**(HARD-GATE #4)。

1. **构造 final reviewer prompt**:复用 [`prompts/reviewer.md`](prompts/reviewer.md) 的「末尾 final-review 形态」段(T6 补,与 per-task 同模板、同 output schema),由 `quality_review.js` 的 `createReviewerPrompt` 渲染(C-001:不引入新机制)。与 per-task 形态的差异:
   - **scope = 整 branch diff vs spec**:reviewer 自跑 `git diff <initial_head_commit>..HEAD` 全量,对照 spec §1 成功标准 + 全部 AC + 跨 task contract 一致性,不限于单个 task 的 `files_changed`。
   - **占位映射**(见 reviewer.md「Prompt 占位 → 数据来源映射」final-review 列):`<task-acceptance-criteria>` 注入 spec 级成功标准 + 全部 AC;`<task-critical-constraints>` 注入 spec 级跨 task 约束;`<commit-sha>` / diff base 用 `state.initial_head_commit`;`<implementer-output>` 段改为已完成 task 清单。
2. **controller 注入纪律**(同 per-task reviewer):
   - 注入 `spec_file` 路径 + diff base commit(`state.initial_head_commit`),reviewer 自跑 `git diff` 取整 branch diff,**不预读整文件正文**。
   - `<code-specs-context>` 按本 branch 触及的 pkg/layer 摘取适用段落;空则降级通用质量启发式。
   - **Degraded 平台(无 subagent)**:opencode / antigravity / droid / gemini 等无 subagent 平台,controller 主会话扮 final reviewer 走单段 self-review(与 per-task 降级一致,C-004),`createReviewerPrompt` 占位映射照样自渲染自执行。
3. **终审结论分流**(reviewer 返回严格 JSON,`decision: PASS | REVISE`,语义同 per-task,PASS 条件 `critical: []` 且 `important: []`):
   - **整体 PASS** → `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js advance` 推进到 `completed`(末尾终审通过是进 `completed` 的唯一门,HARD-GATE #4)。
   - **发现跨 task 集成问题**(contract 不一致 / 重复实现 / task 间接缝遗漏) → **不自动回退、不自动 revert、不擅改 state**;controller 把 issues 清单**展示给用户** + 走**用户决策**:`另起修复回合`(用户拍板后另开 task / `--retry` 路径修)或 `accept`(用户接受残留问题后继续推进 `completed`)。由用户拍板,controller 不替用户决策。
4. **写 handoff(execute→末尾终审输入)**:把执行阶段决策蒸馏成 handoff 作为末尾终审的输入——正文 ≤20 行(CLI 自动拼 5 行 freshness header),建议 `## Decisions`(实现偏离 spec 处+理由)/ `## Rejected`(放弃的实现路径)/ `## Risks`(终审重点核对的跨 task contract)+ contract-digest 指针。走 CLI 落盘:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js write-handoff --from execute --to review --content-file <handoff 正文 .md 绝对路径>
```

> **末尾终审未过不得标记 `completed`**(HARD-GATE #4)。execute 跑完即 `completed`,无独立 review 中间态;branch 级独立单审走 `/diff-review`。

## Red Flags

HARD-GATE 已覆盖的违规不在此重复。下列行为同样违规:
- 多个 task 攒到最后批量回写 plan.md / state.json（每个 task 立即 advance）
- 已失败 ≥ 3 次仍"再试一次"而不走 diagnose 四阶段（CLI hard-stop 在 `retry_count >= 3` 时触发）
- 末尾终审未跑就标 `completed`,或终审发现跨 task 问题却自动回退 / 擅改 state（须展示给用户决策）
- controller 自读业务源码 / plan / spec 全文,或全量 dump diff·CLI 输出回灌上下文(任何通道,含 bash `cat/grep`;见 [`references/subagent-driven.md`](references/subagent-driven.md)「不允许的行为」)

## CLI 参考

- `workflow_cli.js triage --result <job-id> [--strict]` — Step 4.3
- `workflow_cli.js verify-readiness` — TDD red 起不来前的预检(可选;项目 `workflow.readiness` 声明启用 check 时调)
- `verification.js create ... --require-files <csv>` — Step 5 ① 强化
- `workflow_cli.js write-handoff --from execute --to review ...` — Step 7 末尾终审输入 handoff
- `workflow_cli.js advance <task-id> [--full]` — 默认 next_task 仅 `{id, name}`;完整 task 数据已由 Step 1 持全 task 切片提供,无需 per-task task-bundle
