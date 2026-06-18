# Subagent-Driven Execution（workflow-execute 视角）

> 本文件聚焦 workflow-execute **如何**默认走 fresh-subagent-per-task 主路径。Prompt 模板见 `../prompts/{implementer,reviewer}.md`。每 task 1 个 reviewer subagent（合并 AC+质量两 phase）。

Worker-level roles and invariants follow [`../../../specs/shared/subagent-worker-contract.md`](../../../specs/shared/subagent-worker-contract.md); this file only defines workflow-execute routing.

## 默认架构

```
controller (主会话)
   │
   ├─ Step 4.1  派发 implementer subagent（fresh，每 task 一个）
   │     ↓
   │   DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
   │     ↓
   ├─ Step 4.2  派发 reviewer subagent（单 subagent、单 context、AC→质量两 phase）
   │     ↓
   │   REVISE / PASS  →（REVISE: 回 implementer 修，≤3 轮）
   │     ↓
   ├─ Step 5      验证命令 + Checkpoint + Journal
   ├─ Step 6      取下一 task（controller 内联循环回 Step 3）
   └─ Step 7      所有 task 完成 → inline 末尾终审 → completed
```

## 平台 fallback 矩阵（canonical）

| Platform | dispatch tool | implementer subagent | reviewer subagent | 行为 |
|---|---|---|---|---|
| claude-code / cursor | `Task` | ✅ | ✅ | 默认全套（fresh implementer + 单 reviewer） |
| codex | `spawn_agent` | ✅ | ✅ | 默认全套 |
| opencode / droid | `Task`（`subagent_type`） | ✅ | ✅ | 默认全套（Task tool 派发，与 claude-code 同族） |
| antigravity | orchestrator 自动派发 / async subagent | ✅ | ✅ | 默认全套（2.0 自动编排 + CLI async subagent；精确 tool 名 + 自动编排语义见 harness-tools） |
| qoder | subagent（`~/.qoder/agents`） | ✅ | ✅ | 默认全套（Chat panel + Quest，`/agent-name` 或自动） |
| 不支持 subagent 的平台 | 主会话 direct | ❌ | ❌ | degraded：主会话扮 implementer + 单段 self-review（按 reviewer.md 两 phase 顺序自检） |

不支持 subagent 的平台**自动**降级；不需要 config flag 开关。

> 本表是 fresh-subagent-per-task 平台支持的 single source。`workflow-execute/SKILL.md` 和 `dispatching-parallel-agents/SKILL.md` 都指向此处。
>
> 各 harness 的详细工具映射（dispatch tool、hook 机制、instructions file 等）见 [`../../../specs/harness-tools/`](../../../specs/harness-tools/) 下每平台一个映射文件。

## 决策点

### Implementer 状态分流

| 状态 | controller 处理 |
|---|---|
| `DONE` | 进 Step 4.2 reviewer |
| `DONE_WITH_CONCERNS` | 读取结构化 `concerns[]`；`type=correctness/scope/verification` 或 `severity=blocking` → implementer 修 / 补 context 后再 review；`type=observation` 且 `severity=non_blocking` → 记录 journal 后进 4.2 |
| `NEEDS_CONTEXT` | controller `AskUserQuestion` → 答案塞回 prompt → 重派 |
| `BLOCKED` | 评估根因 → 补 context / 升 model / 拆 task / escalate user |

### Reviewer 状态分流（合并后）

> reviewer dispatch 的 `subagent_type` 名须含 `review`/`reviewer`/`check`,`pre-execute-inject` hook 才路由 `kind='check'`（full-layer code-specs digest）;否则 fall-through `implement`（`<current-task>` 仍注入、AC/constraints 不丢,仅 code-specs 退 scoped digest）。

单 reviewer subagent 在一个 context 内顺序执行两 phase：

- **Phase 1 — Acceptance Compliance**：AC 覆盖 / 超额 / 关键约束。`phase1.decision = REVISE` → 直接返回，**不执行 Phase 2**（gate-rule）。clean PASS 用 `ac_ids_covered`（AC ID 枚举,不回 evidence 长串）;REVISE/gap 才回完整 `ac_coverage`+evidence（O2a,schema 以 reviewer.md 为权威）。**cannot_verify**：AC 要求的行为在 diff 未触碰代码中时，reviewer 标注 `cannot_verify[]`（不等于 REVISE），controller 收到后必须自行核实或回派 implementer 补实现，不得忽略。
- **Phase 2 — Code Quality**：三档语义与 PASS 条件以 [`../prompts/reviewer.md`](../prompts/reviewer.md) 为唯一权威。**Calibration 纪律**：plan-mandated 的缺陷也必须按实际严重度报告（critical/important），不得因"plan 要求这么写"放行。

`decision: REVISE` → controller 把 `revise_instructions` 塞回 implementer prompt → **fresh 重派 implementer + fresh reviewer subagent**（O4,禁 SendMessage/transcript-resume）→ 重 review。trivial 无逻辑机械修复走 controller 自验例外,不重派 reviewer。循环上限 **3 轮**（合并 phase1+phase2 共享）：第 3 轮重派仍 REVISE → `halted` + `halt_reason: 'failure'`（`failure_reason`: review-loop）。

### HITL × subagent

`interaction === 'HITL'` 的 task：

1. implementer prompt 头部强制注入 `Before any code change, you MUST emit NEEDS_CONTEXT...`
2. implementer 首次返回 `NEEDS_CONTEXT`
3. controller 调 `AskUserQuestion` 收集回答
4. 答案塞回 prompt 重派 → implementer 真正动手

违反任一步 = HARD-GATE #5。

## 不允许的行为

- ❌ 在支持 subagent 的平台静默走 degraded mode
- ❌ Phase 1 REVISE 仍跑 Phase 2（gate-rule 违反）
- ❌ 让 implementer 自己读 plan.md / spec.md（task 正文由 `pre-execute-inject` hook 注入 `<current-task>` 单通道到达；hook 不可用平台由 controller 兜底粘切片）
- ❌ controller 自读业务源码回灌上下文——**不限 Read 工具,`cat/sed/head/tail/grep/rg/awk` 等 bash 通道同禁**。补 patterns-to-mirror / mandatory-reading 时只给路径 + 意图让 implementer 自读定位(行号可选);源码/diff 读取一律 subagent 侧。实测违反此条(Read + bash-cat 双通道 controller 自读 ~129k)是单会话上下文膨胀主因
- ❌ controller 读 plan.md / spec.md **全文**回灌上下文(只持 contract-digest + Step 1 task 源切片;plan/spec 全文交 subagent 按路径自读)
- ❌ 让 controller 把整文件正文粘进 reviewer prompt（reviewer 自跑 `git diff <base>..HEAD`）
- ❌ controller 为 per-task reviewer 重复粘贴 AC / constraints / code-specs（hook `kind='check'` 已注入 `<current-task>` + `<project-code-specs>`；仅 hook 不可用平台兜底；O1）
- ❌ REVISE recheck 用 `SendMessage` / transcript-resume 复用既有 implementer/reviewer subagent（应 fresh 重派——resume 重放整段历史 ≈2× input；O4）
- ❌ per-task reviewer 用 `state.initial_head_commit` 作 diff base（应取 implementer 派发前捕获的 prior-commit；`initial_head_commit` 仅 final-review；O5）
- ❌ controller 全量 dump 诊断输出回灌上下文(`workflow_cli status/context`、`git diff/log/status` 一律 `jq`/`grep`/`--stat` 取字段;原始 diff 验证交 reviewer subagent,不在 controller 跑)
- ❌ reviewer / implementer 返回散文报告,或 **JSON 前后夹带散文/markdown/推理**(strict JSON-only:首字符即 `{`;controller 不做 loose-extract 容忍,夹带散文 = schema 违规,重派 1 次后 halt)
- ❌ 在 plan 执行路径里同时派发多个 implementer subagent（plan task 有依赖 / 共享文件，写动作顺序执行）。文件不重叠的独立写任务走 `dispatching-parallel-agents` 的 writable fan-out，不在本主路径并行

### 审阅器只读 + 控制器权力约束（参照 superpowers 6.0 纪律门）

- ❌ **reviewer 触碰工作树**：reviewer 是只读审阅员，禁止运行 `git checkout` / `git reset` / `git stash` / 任何写操作 / 修改文件。验证需求改用 grep/Read 在调用方定位，不动代码。reviewer 越权改码会导致后续提交孤立
- ❌ **controller 告诉 reviewer 忽略某项发现**："don't flag X" / "skip the Y check"——reviewer 的发现由其专业判断决定，controller 不得事前指示不报。误报由 controller 在 reviewer 返回后裁决
- ❌ **controller 预判严重度**："Minor at most" / "just a nit"——严重度由缺陷的 failure_scenario 决定，事前降级 = 剥夺 reviewer 定级权
- ❌ **controller 粘贴累积历史摘要进 reviewer prompt**：前几轮发现 / implementer excuses / controller 分析不得整段粘贴（实测案例：dispatch 达 42k 字符，99% 是粘贴历史）。历史通过 `cannot_verify` / `revise_instructions` 结构化传递
- ❌ **controller 自行放行 plan-mandated 缺陷**：reviewer 报告 plan 描述本身的缺陷时，controller 不得自行放行——展示给用户决定改 plan 还是改实现

## 与其它 skill 的边界

- **TDD**：默认关闭。仅当 `/workflow-execute --tdd` 使入口返回 `tdd_enabled: true` 且任务满足 TDD 条件时,implementer prompt 才在 `<protocols>` 中引用 `../tdd/SKILL.md`（不内联 TDD 全文）。
- **Codex spec-级第二意见**：execute 末尾终审（Step 7）的 codex_enhanced 模式仅用于 spec §1 成功标准 / 跨 task contract 一致性。不驻留 per-task review。
- **dispatching-parallel-agents**：只读 fan-out（debug / research / multi-bug 调查）+ writable fan-out（文件不重叠的独立写任务）。**不参与有依赖的 plan task 执行** —— plan task 走本主路径顺序

## quality_gate 字段语义

详见 ADR `.claude/code-specs/adr/0002-drop-writable-parallel.md`。摘要：字段作为 `git_commit` action 边界 marker（commit gate），原 post-execution governance 路由（budget warning+ → pause-quality-gate）已随 lean-execute 重构退役（ADR 0004），字段保留仅用于 plan 层标注 commit 边界。代码质量 review 由 Step 4.2 reviewer Phase 2 默认覆盖，与本字段解耦。

> ⚠️ 别混淆两个同名概念：① `task.quality_gate`（plan 里的 bool，commit 边界 marker，本节所述）；② per-task reviewer 的终判结论（Step 4.2 reviewer PASS 后 controller 内存确认放行，per-task gate 落盘已退役，不回灌 controller 上下文，与 ADR 0002 "reviewer 输出不污染 controller" 不冲突）。
