---
name: workflow-execute
description: "Use when 用户调用 /workflow-execute, or 已有 workflow 需要继续推进任务, or 用户说「继续/接着跑/继续执行/下一个 task/resume workflow/把剩下的任务跑完」要恢复已有 workflow 执行。"
disable-model-invocation: true
---

> 路径 convention + CLI 写入 contract 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。

# workflow-execute

<HARD-GATE>
1. **状态优先**:先读 workflow-state.json,不得通过仓库代码猜测运行时状态
2. **验证铁律**:没有新鲜验证证据,不得标记任务为 completed。证据由 **implementer 跑测试产出**(报告文件 `verification` 段:命令+result+output) + **reviewer 裁决回 `verification_review` 三布尔机械门**(command_relevant/result_pass/output_clean,全 true 才 advance,见 Step 5 ①);controller **不在自身 context 重跑测试命令**——只记录证据(诊断例外见 Step 4 纪律门:串行+one-shot)
3. **TDD 手动开启铁律**:只有用户显式传入 `--tdd` 时才进入 TDD 路径;默认不启用 TDD。启用后按 [`../tdd/SKILL.md`](../tdd/SKILL.md) 执行,无失败测试不得编写生产代码
4. **完成推进铁律**:最后一个 task 完成后,必须 inline 派 final reviewer 跑整 branch diff vs spec。注意 `status` 在最后一个 `advance {taskId}` 时已由 CLI 自动落 `completed`——本铁律是其后的 LLM 纪律门:**终审未 PASS 不得对用户宣告完成 / 收尾 / 归档**
5. **HITL 确认铁律**:任务 `interaction == 'HITL'` 时,implementer 首次动手写码前必须经过一次主会话 `AskUserQuestion`(协议:implementer prompt 头部强制 `NEEDS_CONTEXT` → 主会话 `AskUserQuestion` 收集回答 → 答案塞回 prompt 重派);不得跳过人工确认直接执行
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

执行模式只有两个(与 state-machine.md 对齐):**continuous**(默认,跨 phase 连续执行到底)/ **phase**(`--phase`,phase 边界停下确认)。`--retry` / `--skip` 不是执行模式,是 halted 恢复的单条 CLI 调用(见「特殊模式」);`--tdd` 也不是,是 implementer prompt 开关(见「TDD 手动开启条件」)。

**裸"继续"解析**:仅在存在活动 workflow（`running` 或 `halted`）且当前对话仍在该 workflow 上时恢复（对应 `RESUME_ENTRY_STATUSES`）。`planned` 状态需显式 `workflow-execute` 命令启动（对应 `EXECUTE_ENTRY_STATUSES`）;`spec_review` 不适用。

模式解析(显式 flag / 自然语言 / `state.execution_mode` 默认)由 CLI `buildExecuteEntry` 拥有,controller 只消费返回的 `resolved_mode`,不自行解析。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute [意图]
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute --mode phase    # 带模式参数
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js execute --tdd           # 手动开启 TDD
```

CLI 返回 `entry_action` / `resolved_mode` / `tdd_enabled` / `state_status` / `can_resume`。`entry_action: 'none'` 时按 `message` 字段提示用户。`tdd_enabled !== true` 时,即使任务形态适合测试先行,也不得自动引用 TDD skill。

**自愈后 upgrade_required 检测**:`cmdInit` 自愈出 `upgrade_required: true` = 找到 plan 但找不到 spec 文件。优先 `/workflow-spec` 重建 spec 后再执行;确认放弃 spec 审批留痕用 `/workflow-execute --force`。

### 一次性持全 task 切片(必须)

**task 源 = task-dir**(`~/.claude/workflows/{pid}/tasks/{taskId}/{task.json,task.md,context.jsonl}`),非 plan.md 物理解析。每个 task 的 rich 执行切片(task_text + acceptance + constraints + patterns/mandatory-reading + files + 验证)存于 **task.json v2 结构化字段**,并渲染为人读 **task.md**。确认 state(下方 Step 2)后,controller **一次性**从 task 源(`TaskSource(state).listTasks()`)读全部 task 元数据持于内存。派发 implementer 时,`pre-execute-inject` hook **自动把当前 task 的 task.md 渲染正文注入 `<current-task>`**(源自 task-dir,**非 plan.md**)——guardrails(constraints/patterns/mandatory)随之到达 implementer。**不每 task 重读盘**(controller 一次性持全 范式,见 [`references/subagent-driven.md`](references/subagent-driven.md))。

- **task 正文注入单通道 = hook**:implementer 的 task 正文只经 hook 注入到达,controller **不重复粘贴**;内存切片用于编排(HITL 判定 / write-scope 渲染 / 取下一 task)+ reviewer 占位装配(衔接 `prompts/implementer.md` / `prompts/reviewer.md`),不回头读盘。
- plan.md 在新模型下退化为**可选人类可读叙述**(front matter + 锚点),非机器 task 源——execute 不依赖它解析 task。
- **legacy 兼容**:存量 plan.md 格式旧 workflow(无 task-dir)由 `LegacyPlanMdSource` 兜底,经 `parseTasksV2` 从 plan.md 读 task 序列(C-7),切片来源等价,执行路径不变。`TaskSource` 工厂按 state 自动选 adapter。

## Step 1.5: Pre-Flight Plan Review（首次执行时，一次性）

**触发条件**：仅首次从 `planned` 进入 `running` 时执行一次（`status_transition: "planned->running"`）。resume 场景（`running` / `halted`）跳过本步——计划已上过路。

**目的**：在执行 Task 1 之前，一次性扫描 task-dir 中的计划内部冲突，批量提问用户，而非逐 task 执行到一半才发现矛盾。参照 superpowers 6.0 Pre-Flight Plan Review。

**检查项**（controller 从 Step 1 持有的全 task 切片扫描，不调 CLI、不读源码）：

1. **任务间文件冲突**：T2 `depends: [T1]` 但 T1.files 与 T2.files 有交集且无 merge_candidates 信号 → T2 可能在 T1 未完成时改同一文件
2. **依赖缺失**：T2 `depends: [T3]` 但 T3 不在 task 集中（孤儿依赖）
3. **验证命令缺失**：某 task 的 `verification.commands` 为空或非 string[] → execute 期 Step 5 验证会失败
4. **acceptance 空缺**：某 task 的 `acceptance` 为空数组 → reviewer Phase 1 无 AC 可对照
5. **fan-out 风险**：同一 file 被 ≥3 个 task 触及但无收敛 task（`plan-review` 的 `shared_file.fan_out` lint 本应挡，此处二次确认）

**执行方式**：
- 全部检查通过 → 静默继续 Step 2，不打印任何 banner
- 发现冲突 → **一次性** `AskUserQuestion` 列出全部冲突项，options：
  - `proceed`（用户确认接受风险，继续执行）
  - `fix`（用户回 `/workflow-plan` 修计划，execute 暂停在 Step 1.5 不进 Step 2）
  - `skip-check`（跳过 pre-flight，直接执行——降级路径，不推荐）

> 本步是 advisory gate，不阻断执行——用户可选择 proceed 接受风险。目的是把"执行到第 3 个 task 才发现 T2 依赖写错"的延迟反馈提前到执行前。

## Step 2: 读取状态(state-first)

**铁律**:在确认 state.status / state.current_tasks 之前,不得读取 task 源、源码或展开 Patterns to Mirror。

**resume 三元组**:resume 锚点 = `current_tasks[0]` + `status` + **task 源**(task-dir,legacy 则 plan.md)三者(C-1)。`/clear` 后从 disk 重建靠这三者:`current_tasks[0]` = task 源 `firstTaskId()`,`status ∈ {planned,running,halted}` 决定可恢复性,task 源给全部 task。`status=planned ⟹ task 源存在` 由 `assertTaskSourcePresent` 单点守门,缺失统一报 `task_source_missing` 阻断 execute 入口。

**Progress Ledger 恢复（compaction 后）**：`/clear` 后，除了 resume 三元组，还需读 progress ledger 恢复 per-task review 结论与已知问题（Step 7 final-review 的排除清单）：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js progress-ledger read
```

返回 `{ entries: [...] }`，每条含 `task_id` / `status` / `commits` / `review` / `known_issues`。controller 把已记录的 minor + concerns 装配为 Step 7 final-review 的**已知问题排除清单**——清单内条目按原 severity 免重报，只报清单外的新发现（升级例外不变）。文件不存在时返回空数组（行为不变，向后兼容）。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context   # 返回已内嵌 next_task,无需再调 next
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
- `halted` (`halt_reason: 'failure'`，`failure_reason` 记 review-loop 上限) → 展示 reviewer 累计 issues,等用户介入
- 渐进式 workflow:检查是否所有任务都被阻塞

**Git 分支检测**(建议性):检测是否在 main/master,建议创建 feature branch。不阻塞执行。

### 状态文件自愈

`workflow-state.json` 不存在 → `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js init` 自动重建最小状态文件并推导首个未完成任务。**task-dir 优先**:task-dir 有记录时直接从 task-dir 重建(plan.md 已退化为叙述,不参与推导);仅 task-dir 为空时回退解析存量 legacy plan.md。例外:仓库存在 2+ plan.md 候选时 CLI **先于 task-dir 检查**返回错误（`detected_plans` 数组）→ 展示列表让用户选择,不自行猜测。

**自愈失败 → fail-fast**:权限不足、磁盘满、task-dir 与 plan.md 皆无时终止执行并提示用户检查后重试。**不得静默继续**。

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
   - `skip` → `execution_sequencer.js skip <state-path> {taskId}`（状态落 task-dir + state.json）,reason 写入 journalSummary

**降级**:`AskUserQuestion` 不可用 → 打印 implementer 反问并显式停在 Step 3(不进 Step 4),输出 `HITL wait: 请回复 "proceed/defer/skip {reason}" 后我再继续`,等下条用户消息分流。HARD-GATE #5 无例外。

**Degraded 平台(无 subagent)**：主会话扮演 implementer 时仍需在第一时间输出 `NEEDS_CONTEXT` + 调 `AskUserQuestion`，行为等价。

老 plan 无 `Interaction` 字段 → `task_parser` 默认 `AFK`,行为不变。

## Step 4: 执行任务动作

**默认行为(fresh-subagent-per-task)**：每个 task **必须**起一个 fresh implementer subagent 完成实现，再起**单 reviewer subagent**（合并 AC + 代码质量两 phase，AC→质量顺序，见 [`prompts/reviewer.md`](prompts/reviewer.md)）。controller(主会话) 只做编排，不直接写代码。

> **Controller 上下文纪律(铁律)**:controller 全程**不读业务源码 / plan.md / spec.md 全文**(任何通道,含 `cat/grep/sed/rg` bash),只持 contract-digest + Step 1 task 切片;`workflow_cli status/context`、`git diff/log` 等诊断输出取字段不全量 dump;源码/diff 读取与验证一律下放 subagent。**测试运行也下放**(implementer 跑 + 报告,reviewer 裁决);controller 仅在死锁/疑难诊断的 focused 例外下亲自跑命令,此时**串行、one-shot(不 watch)、不并发同一 test runner**,且**先排除自身并发/watch 再下「真 hang/死锁」结论**(实测并发 vitest 污染 vite dep cache + stray 进程 → 制造 4 次假 hang)。详见 [`references/subagent-driven.md`](references/subagent-driven.md)「不允许的行为」——违反是单会话上下文膨胀主因。

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
> - **末尾 final reviewer**(Step 7 整 branch 终审)——HARD-GATE #4,宣告完成前的唯一纪律门。
> - **`user_spec_review`** 人工 gate(C-1)——始终实例化,不受 review flag 影响。
>
> OQ-3 silent-done 补偿:review 默认关后,「execute 末仍可显式触发终审」即为补偿路径(Step 7 final reviewer 本就是无条件 HARD-GATE,不依赖 codex flag),未额外引入 `passes && reviewed` 双字段判定。

平台支持矩阵 + 降级规则 + Implementer 4 状态分流见 [`references/subagent-driven.md`](references/subagent-driven.md)。本节只给最小操作流。

### 模型分级（强制显式指定，参照 superpowers 6.0）

每次派发 subagent **必须显式指定 model**——**省略 = 静默继承会话最贵模型**（opus-class），让 mechanical 任务也跑最贵档,是单 workflow token 浪费的最大未察觉来源。分级（细则在 [`prompts/implementer.md`](prompts/implementer.md) / [`prompts/reviewer.md`](prompts/reviewer.md) 的 `[MODEL]` 段）:

| 角色 / 任务形态 | 档位 |
|---|---|
| 机械实现（1-2 文件、完整规格、转录+测试、纯文案/key 改名） | 廉价（haiku-class） |
| 集成/判断（跨文件、需理解 contract、有边界条件）、per-task reviewer | 标准（sonnet-class，reviewer **下限**——廉价档构造不出有效 failure_scenario，refute-default 形同虚设） |
| 架构/设计（新模块、复杂算法、跨服务 contract）、**末尾 final reviewer** | 最强（opus-class） |

**Turn count beats token price**：廉价模型常需 2-3× 轮次修正反而更贵——implementer 写散文描述/多步推理时至少中档,plan 文本含完整代码（转录+测试）才用最廉价。平台不支持指定 model → 忽略（degraded 平台 controller 主会话即 implementer）。

### 4.1 派发 implementer subagent

按 [`prompts/implementer.md`](prompts/implementer.md) 模板装配 prompt。**task 正文单通道 = hook 注入**:`pre-execute-inject` hook 在派发时自动把当前 task 的 task.md 渲染正文注入 `<current-task>`,controller **不重复粘贴 task 正文**,只装配编排骨架:

- **第一行必须**：`Active task: <task_id>`(可选附加 `Spec: <path>` / `Plan: <path>`)
- **`Report file: <task-dir>/implementer-report.json`**：implementer 把完整结构化报告写该文件(权威通道),transcript 只回 thin 回执;回执丢失/被后台进程 stdout 覆盖 → controller **Read 报告文件**恢复,**禁** SendMessage/resume(O4,见 `prompts/implementer.md`)
- `<write-scope>`:该 task 声明的预期改动文件清单(取自 Step 1 内存切片)
- `<protocols>`:TDD 开关 / 输出协议;HITL task 追加强制反问条款(字面量以 [`prompts/implementer.md`](prompts/implementer.md) 模板为唯一来源,HARD-GATE #5)
- **派发前捕获 diff base**（O5）：`git rev-parse HEAD` 取当前 SHA 存为本 task 的 reviewer diff base（该 task 改动前的 HEAD），随 task runtime 持有；Step 4.2 reviewer 用它、REVISE 轮复用。**禁**用 `state.initial_head_commit`（final-review 整 branch 专用）。
- hook 注入不可用(平台无 PreToolUse hook / `WORKFLOW_HOOKS=0`)→ controller 兜底把 Step 1 切片的 task 正文以 `<current-task>` 块粘进 prompt,内容等价

> 当前 task 在 Step 1 切片中找不到(state/plan 不一致)→ 走 Step 2 状态自愈,不要手工切片绕过。

Implementer 返回 4 种状态（**报告文件 + thin 回执**，见 [`prompts/implementer.md`](prompts/implementer.md) output-schema；回执丢失 → Read 报告文件，禁 resume）:

| 状态 | 处理 |
|------|------|
| `DONE` | 进入 4.2 reviewer（合并） |
| `DONE_WITH_CONCERNS` | 读 concerns;correctness 类先修后再 review;observation 类记录后 review |
| `NEEDS_CONTEXT` | controller 通过 `AskUserQuestion` 收集回答后重派 implementer |
| `BLOCKED` | 评估根因:context 缺失 → 补 context 重派;reasoning 不足 → 升级 model;task 过大 → 拆 task;plan 错 → escalate user |

### 4.2 派发 reviewer subagent（合并 AC + 质量）

按 [`prompts/reviewer.md`](prompts/reviewer.md) 构造单 subagent prompt，单 context 内顺序执行两 phase。**reviewer dispatch 的 `subagent_type` 名须含 `review`/`reviewer`/`check`**,使 `pre-execute-inject` hook 路由到 `kind='check'`（full-layer code-specs digest）;否则 fall-through `implement`（`<current-task>` 仍注入、AC/constraints 不丢,仅 code-specs 退 scoped digest）:

- **Phase 1 — Acceptance Compliance**：覆盖性 / 超额 / 关键约束。Phase 1 REVISE → 直接返回，不进 Phase 2。**cannot_verify**：AC 要求的行为在 diff 未触碰代码中时，reviewer 标注 `cannot_verify[]`（不等于 REVISE），controller 收到后必须自行 grep/Read 核实或回派 implementer 补实现，不得忽略。**Calibration**：plan-mandated 的缺陷也必须按实际严重度报告，不得因"plan 要求这么写"放行。
- **Phase 2 — Code Quality**：critical / important / minor 三档。critical/important 必修；minor 记录于本 task journal 不阻塞。

Controller 注入约束:
- **AC / constraints / code-specs 走 hook 单通道**（同 implementer，O1）：`pre-execute-inject` hook 在 reviewer dispatch 时注入 `<current-task>`（AC + constraints,task.md HEAD）+ `<project-code-specs>`;controller **不重复粘贴**这三者。hook 不可用平台兜底 + final-review 例外见 [`prompts/reviewer.md`](prompts/reviewer.md)「Controller 责任」。
- **不预读整文件正文**：只注入 `files_changed` 路径 + `diff-base-commit` SHA，reviewer 自跑 `git diff`。
- **allowed-write-scope 仍由 controller 装配**：task.md tail 可能被 hook 截断丢失,此块是 Phase 1 overage 检测的可靠文件清单来源。
- **diff base 锁 prior-commit**（O5）：`diff-base-commit` = Step 4.1 派发前捕获的 `git rev-parse HEAD`,**禁** `state.initial_head_commit`。
- **控制器权力约束**：派发 reviewer 时禁止 ①告诉 reviewer 忽略某项发现 ②预判严重度 ③粘贴累积历史摘要 ④自行放行 plan-mandated 缺陷。详见 [`prompts/reviewer.md`](prompts/reviewer.md)「控制器权力约束」+ [`references/subagent-driven.md`](references/subagent-driven.md)「审阅器只读 + 控制器权力约束」。

Reviewer 返回**严格 JSON-only**。schema 非法 → controller 重派 1 次；仍失败 → halt + `halt_reason: 'failure'`（`failure_reason`: reviewer-schema-failure）。

判定:

| `decision` | controller 动作 |
|------|---------|
| `PASS` | 进入 Step 5 post-execution |
| `REVISE` (phase1) | `revise_instructions` 塞回 implementer → **fresh 重派 implementer + fresh reviewer**（禁 SendMessage/transcript-resume）→ 重 review；trivial 机械修复（i18n key / 删重复 key / 删残留 tag）走 controller 自验例外,不重派 reviewer |
| `REVISE` (phase2 critical/important 非空) | 同上；phase2.minor 记录入 task journal 不阻塞 |

循环上限 3 轮（implementer ↔ reviewer）：第 3 轮重派（含 oracle 增强）仍 REVISE → `halted` + `halt_reason: 'failure'`（`failure_reason`: review-loop），等用户介入。

> **3 轮是安全网,非升级时机**：thrashing（连续 2 轮 reviewer findings 冒出上轮未标的新 `file:line` 且原 issue 未收敛——controller 可机械算的近似启发式,非因果断言）应**前置升级**到设计简化 `AskUserQuestion`,不等撞硬上限——判据 + 动作见 [`references/subagent-driven.md`](references/subagent-driven.md) § Reviewer 状态分流「Thrashing 早升级」。

### Stuck 触发 oracle 回灌（loop = 2）

implementer ↔ reviewer loop 进行到 **第 2 次仍 REVISE** 时，controller(主会话) 在 runtime task state 上程序化标 `stuck_or_looping`(随 task 生命周期持有,不入 state.json 持久层),按 `core/specs/shared/codex-routing.md` § Decision Table + § Invocation Contract 调 `collaborating-with-codex` `--oracle-review`（声明式 opt-in,`risk_signals: stuck_or_looping`,字段填法以该 contract 为准、此处不复写映射）。**只有 controller 触发 codex,不下放给 implementer / reviewer subagent**。

- 输出（alternative POV / 根因分析 / 推荐方向,read-only）作 **第 3 次重派的 `revise_instructions` 增强输入**;第 3 次 implementer **仍按 Step 4.1 派发路径**,实现完成后照常进 Step 4.2 reviewer。oracle 不接管实现
- 预算：codex 调用**不消耗** loop 预算,第 3 次循环按原节奏跑,仍失败 → 上面 halt 不变
- 降级：codex 不可用 → controller 跳过 oracle 回灌直接第 3 次重派,journal 写 `codex-status: codex_degraded` + 降级原因
- **oracle-skip 判据收敛**（codex-routing.md step 5）：loop=2 **不得仅因「根因已知」跳 oracle**——根因已知 ≠ 修复收敛。症状若是 **thrashing**（连续 2 轮 findings 冒新 `file:line`、原 issue 未收敛）→ oracle 的 alternative-design POV 正是所需,或直接走设计简化 `AskUserQuestion`（前置于 3 轮上限）。仅 localized 单根因 correctness 补丁、根因+修复路径已锁定才可标 degraded-by-choice 跳过

### TDD 手动开启条件

默认不走 TDD 路径。仅当入口返回 `tdd_enabled: true`(用户显式 `/workflow-execute --tdd`) 且以下条件全部满足时,才触发 → implementer prompt 中引用 [`../tdd/SKILL.md`](../tdd/SKILL.md) 红绿蓝循环:
1. 任务 `phase` 为 `implement` / `ui-*`
2. 项目存在 Spec + 可执行的测试命令
3. actions 含 `create_file` / `edit_file`
4. 文件类型非豁免(配置、文档、迁移、声明、桶文件)

未传 `--tdd` 或条件不满足 → implementer 直接实现,不引用 TDD skill,不强制先写失败测试。

### Degraded mode(无 subagent 平台)

无 subagent 派发能力的平台(如 github-copilot,或受限环境/`WORKFLOW_HOOKS=0`) → controller 主会话直接执行 implementer 角色,完成后走单段 self-review(按 `prompts/reviewer.md` 两 phase 顺序 self-check,不起 reviewer subagent)。**质量上限低于支持 subagent 的平台。**（opencode / droid / antigravity / qoder 均支持 subagent,走默认全套,不降级——见 `references/subagent-driven.md` 平台矩阵）

## Step 5: Post-Execution（per task）

| 步骤 | 条件 | 说明 |
|------|------|------|
| ① 验证 | **必选** | 记录 implementer 报告的验证证据(reviewer 已确认) → `verification.js create`；controller **不重跑测试命令**。`valid !== true` → mark failed，停止 |
| ② Checkpoint | **必选** | `advance {taskId}` 更新 task-dir(task.json) + state.json |
| ③ Journal | 暂停/workflow 完成时 | `workflow_cli.js journal add` |

> Step 4.2 reviewer PASS（critical/important 为 0）且 Step 5.① 验证通过后,**内存确认即继续**(不再落 per-task quality_gate 持久化记录,见 ADR 0004),直接 advance。本表即权威 checklist,顺序不可换:验证必须在 advance 之前。

### ① 验证

验证命令由 **implementer 跑**(证据在报告文件 `verification` 段:命令 + result + output_summary)，**reviewer 已对照 diff 裁决并回 `verification_review` 三布尔门**(command_relevant / result_pass / output_clean;test 输出有 warning/noise → output_clean=false)。controller 据此**记录**证据,**不重跑测试命令**:

**门(F2,取代 controller 自跑的 anti-fabrication 职能)**:reviewer 的 `verification_review` 三布尔须**全 true** 才记录 `--passed` + advance;任一 false = reviewer 判 implementer 报告的验证不可信 → 按 REVISE 回 implementer(**不 advance**),不得仅凭报告里的 `result:pass` 放行。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/verification.js create \
  --cmd "{implementer 报告的验证命令}" --exit-code 0 --output "{implementer 报告的关键输出}" --passed
```

`validation.valid === true` 才能进入 ② Checkpoint(advance)。

> **为何不 controller 自跑**:在 controller 自身 context 跑测试 = 把 test runner 请进主会话 → 诱发并发/缓存自伤(实测并发 vitest 污染 vite dep cache + stray 进程 → 4 次假 hang)。trust-but-verify 的"verify"放在 **reviewer subagent**(隔离 context、对照 diff、有疑点跑 focused 单测),不在 controller。

若 task 验收项要求某些产物文件必须存在,append `--require-files <csv>`(纯文件存在检查,廉价、确定、不跑测试):

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

### ④ Progress Ledger（per task，必选）

每 task reviewer PASS + 验证通过后，追加一行到 progress ledger（参照 superpowers 6.0）。`/clear` 后 controller 读此文件恢复 per-task review 结论与已知问题（known-issues 排除清单），避免从零重建。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js progress-ledger append \
  --task-id T1 --status completed \
  --commits "<base7>..<head7>" \
  --review clean \
  --known-issues "minor:file.ts:42 unused import,minor:utils.ts:10 magic number"
```

- `--commits`：该 task 改动的 commit range（Step 4.1 捕获的 diff base 到 HEAD）
- `--review`：`clean`（无 critical/important）或 `issues`（有 minor 记录）
- `--known-issues`：逗号分隔的 per-task review 已记录的 minor + concerns（Step 7 final-review 的排除清单数据源）。**单项描述内勿含逗号**——CLI 按逗号切项，描述含逗号会被误切成多条
- 文件落点：`~/.claude/workflows/{pid}/progress.md`（追加写，每行一个 JSON）
- **不替代** resume 三元组（`current_tasks[0]` + `status` + task 源），补充其缺失的 per-task review 上下文

## Step 6: 完成本 task → 直接取下一 task（controller 内联循环）

无 governor CLI。Step 5 advance 完成后,controller **内联**判断:

- 还有未完成 task → 直接取 Step 1 切片里的下一个 task,回到 Step 3。
- 全部 task `completed`/`skipped` → 进 Step 7 末尾终审。

**模式差异(纯 controller 内联,不调 CLI)**:

- **连续模式**:跨 phase 边界连续执行到底。
- **阶段模式**(`--phase`):同 phase 内连续;phase 边界变化时停下,提示用户确认进下一阶段。

### context 压力 checkpoint（task 边界计数，无 CLI、无落盘）

无可靠 in-session token 计数 → 改用 **task 边界计数**（确定性触发,替代"感知偏满"自判,后者实测不可靠）：controller 记本会话已 advance 的 task 数,每 **N（默认 5）** 个 task 边界（**Step 6 取下一 task 处,非** REVISE 循环中途）打一行 banner,建议用户本批结束后 `/clear` 开新会话续跑,附精确 resume 命令(`/workflow-execute` 或裸"继续")。resume 三元组(state + task-dir)重建无损(见 Step 2);计数在 `/clear` 后归零(刚 clear,无需跨会话记忆)。唯一损失:per-task Known-issues 排除清单只存会话内存,`/clear` 后为空属预期(见 Step 7,phase2 全量上报由分流去重兜底)。**不阻塞、不写盘**,用户可忽略。

> O1（reviewer prompt 去双重注入）+ O2a（compact PASS 返回）落地后,per-task controller 每轮上下文增长已大降,本 checkpoint 退为安全网而非主力。复用现有 `clear`/`compact` SessionStart hook（`hooks.json`,workflow-context 无损重注入）,无需新 hook。

## 特殊模式（条件路径——默认 fresh-subagent 主路径不触发，按命中场景查阅）

### codex 回归 triage（仅 implementer 走 codex 路径时）

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js triage --result <job-id> [--strict]
```

返回 `{ in_scope, out_of_scope, suggested_reverts, reasons }`。对 `suggested_reverts` 内文件统一 `git checkout --` 还原;`in_scope` 进入 4.2 reviewer。

`--strict` 模式可作 CI / hook 守门(`out_of_scope` 非空 → exit 1)。

triage 不替代 git diff 内容检查,但替代了文件级越界识别。

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
node ~/.agents/agent-workflow/core/utils/workflow/execution_sequencer.js skip <state-path> <task-id>
```

CLI 自动标记 `skipped` + 更新 task-dir(task.json) + state.json + 找下一任务（不改写 plan.md;仅 legacy plan.md workflow 由 CLI 回写）。

> Skip 是例外路径,不执行验证、自 review 或完整完成管线。

## 渐进式 workflow

`mode: progressive` 时:自动跳过被阻塞任务(`blocked_by` 依赖未解除)→ 只执行可执行任务 → 所有任务被阻塞时转为 `halted`（`halt_reason: 'dependency'`）→ 用户 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dep>` 解除后继续。

## Step 7: 所有 task 完成 → inline 末尾终审 + 推进 completed

所有 task `completed`(或 `skipped`)时,controller **inline** 派一个 final reviewer subagent 做整 branch 终审(不再有独立终审阶段、无独立 review 中间态)。**这是进 `completed` 的唯一门**(HARD-GATE #4)。

1. **构造 final reviewer prompt**:复用 [`prompts/reviewer.md`](prompts/reviewer.md) 的「末尾 final-review 形态」段(与 per-task 同模板、同 output schema),由 controller 按该模板的「Prompt 占位 → 数据来源映射」final-review 列自行装配(C-001:不引入新机制)。scope / phase 语义、占位映射、refute 框架、排除清单与升级规则**均以 reviewer.md 该段为唯一权威,此处不复写**。execute 侧唯一自有职责:
   - **执行决策蒸馏**(构造 prompt 前,controller 从本会话内存蒸馏):`## Decisions`(实现偏离 spec 处+理由)/ `## Rejected`(放弃的实现路径)/ `## Risks`(终审重点核对的跨 task contract)三段合计 ≤20 行(超出时按重要性裁剪:优先保留影响跨 task contract 的条目,丢低优先 Rejected 路径;与 Known-issues 不同,这三段可安全截断,不影响 phase2 排除逻辑);`## Known-issues`(per-task review 已记录的 minor + concerns,作 phase2 排除清单)**不占该预算,每条一行,不截断**——排除清单只有完整才有效,截断会让 final reviewer 把已知项当新发现重报。该清单仅存会话内存(journal 不落 per-task review 结论),/clear 后 resume 时为空属预期,phase2 全量上报由分流去重。四段随已完成 task 清单一并注入 `<implementer-output>` 段。final reviewer 与 controller 同会话 inline 派发,蒸馏直接进 prompt,**不走 handoff 文件中转**(跨会话 handoff 仅存在于 spec→plan / plan→execute 两段,execute 无下游读者)。
2. **controller 注入纪律**(同 per-task reviewer):
   - 注入 `spec_file` 路径 + diff base commit(`state.initial_head_commit`),reviewer 自跑 `git diff` 取整 branch diff,**不预读整文件正文**。
   - `<code-specs-context>` 按本 branch 触及的 pkg/layer 摘取适用段落;空则降级通用质量启发式。
   - **Degraded 平台(无 subagent)**:无 subagent 派发能力的平台(如 github-copilot / 受限环境),controller 主会话扮 final reviewer 走单段 self-review(与 per-task 降级一致,C-004),reviewer.md 占位映射照样自渲染自执行。
3. **终审结论分流**(reviewer 返回严格 JSON,`decision: REVISE | PASS`,语义同 per-task,PASS 条件 `critical: []` 且 `important: []`):
   - **整体 PASS** → 宣告 workflow 完成,进入收尾(**无需再调 CLI**:最后一个 task 的 `advance {taskId}` 已自动把 status 落 `completed`;HARD-GATE #4 是终审 PASS 前不得宣告/收尾的 LLM 纪律门)。
   - **发现跨 task 集成问题**(contract 不一致 / 重复实现 / task 间接缝遗漏) → **不自动回退、不自动 revert、不擅改 state**;controller 把 issues 清单**展示给用户** + 走**用户决策**:`另起修复回合`(用户拍板后另开 task / `--retry` 路径修)或 `accept`(用户接受残留问题后继续推进 `completed`)。由用户拍板,controller 不替用户决策。
   - **`accept` 分支落审计**(T8 偏离决策闭环):用户显式接受残留问题后,controller 把每条被接受的偏离调 CLI 写入 `deviation_log`,然后照常宣告完成(status 已是 `completed`):

     ```bash
     node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js accept-deviation \
       --original-intent "<spec 原意图>" --accepted-impl "<实际接受的实现>" \
       [--spec-section "<§x.x>"] --confirmed
     ```

     返回的 `next_action` 提示用 `/spec-update` 把 accepted_implementation 回写 spec 对应 section(不需要回写时传 `--no-spec-review`)。**不传 `--confirmed` CLI 会 hard-stop 拒绝**——确认动作必须来自用户拍板,controller 不得代答。

> **末尾终审未 PASS 不得宣告完成**(HARD-GATE #4)。execute 跑完即 `completed`(status 由最后一个 advance 自动落,无独立 review 中间态),终审是宣告/收尾前的 LLM 纪律门;branch 级独立单审走 `/diff-review`。

## Red Flags

HARD-GATE 已覆盖的违规不在此重复。下列行为同样违规:
- 多个 task 攒到最后批量回写 task-dir / state.json（每个 task 立即 advance）
- 手动编辑 plan.md / state.json 推进任务状态（状态推进只走 `advance` CLI;仅 legacy plan.md workflow 由 CLI 回写 plan.md）
- 发现 projectId 不匹配时覆写其他 workflow 的 `workflow-state.json`
- 已失败 ≥ 3 次仍"再试一次"而不走 diagnose 四阶段（CLI hard-stop 在 `retry_count >= 3` 时触发）
- 末尾终审未跑就标 `completed`,或终审发现跨 task 问题却自动回退 / 擅改 state（须展示给用户决策）
- controller 自读业务源码 / plan / spec 全文,或全量 dump diff·CLI 输出回灌上下文(任何通道,含 bash `cat/grep`;见 [`references/subagent-driven.md`](references/subagent-driven.md)「不允许的行为」)
- REVISE recheck **或 implementer 回执丢失**时用 `SendMessage` / transcript-resume 复用既有 subagent（应 fresh 重派 / Read 报告文件恢复——resume 重放整段历史 ≈2× input，实测一次 ≈315k；见 4.1 / 4.2 / O4）
- per-task reviewer 用 `state.initial_head_commit` 作 diff base（应取 implementer 派发前捕获的 prior-commit；`initial_head_commit` 仅 final-review 整 branch 用；见 4.1 / O5）
- controller 为 per-task reviewer 重复粘贴 AC / constraints / code-specs（hook `kind='check'` 已注入 `<current-task>` + `<project-code-specs>`；只在 hook 不可用平台兜底；见 4.2 / O1）

## CLI 参考

- `workflow_cli.js progress-ledger append --task-id <id> --status <status> --commits <range> --review <clean|issues> --known-issues <csv>` — Progress Ledger 追写（Step 5 ④）
- `workflow_cli.js progress-ledger read` — Progress Ledger 读取（Step 2 compaction 恢复）
- `workflow_cli.js triage --result <job-id> [--strict]` — 特殊模式 codex 回归 triage（仅 codex implementer 路径）
- `workflow_cli.js verify-readiness` — TDD red 起不来前的预检(可选;项目 `workflow.readiness` 声明启用 check 时调)
- `verification.js create ... --require-files <csv>` — Step 5 ① 强化
- `workflow_cli.js advance <task-id> [--full]` — 默认 next_task 仅 `{id, name}`;完整 task 数据已由 Step 1 持全 task 切片提供,无需 per-task 回查
