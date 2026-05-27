# Subagent-Driven Execution（workflow-execute 视角）

> 本文件聚焦 workflow-execute **如何**默认走 fresh-subagent-per-task 主路径。Prompt 模板见 `../prompts/{implementer,reviewer}.md`。每 task 1 个 reviewer subagent（合并 AC+质量两 phase）。

Worker-level roles and invariants follow [`../../../specs/shared/subagent-worker-contract.md`](../../../specs/shared/subagent-worker-contract.md); this file only defines workflow-execute routing.

## 默认架构

```
controller (主会话)
   │
   ├─ Step 5.1  派发 implementer subagent（fresh，每 task 一个）
   │     ↓
   │   DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
   │     ↓
   ├─ Step 5.2  派发 reviewer subagent（单 subagent、单 context、AC→质量两 phase）
   │     ↓
   │   PASS / REVISE  →（REVISE: 回 implementer 修，≤3 轮）
   │     ↓
   ├─ Step 6      验证命令 + Checkpoint + Journal
   └─ Step 7      Post-execution governance + 循环决策
```

## 平台 fallback 矩阵（canonical）

| Platform | dispatch tool | implementer subagent | reviewer subagent | 行为 |
|---|---|---|---|---|
| claude-code / cursor | `Task` | ✅ | ✅ | 默认全套（fresh implementer + 单 reviewer） |
| codex | `spawn_agent` | ✅ | ✅ | 默认全套 |
| 其他（opencode / antigravity / droid / gemini） | 主会话 direct | ❌ | ❌ | degraded：主会话扮 implementer + 单段 self-review（按 reviewer.md 两 phase 顺序自检） |

不支持 subagent 的平台**自动**降级；不需要 config flag 开关。

> 本表是 fresh-subagent-per-task 平台支持的 single source。`workflow-execute/SKILL.md` 和 `dispatching-parallel-agents/SKILL.md` 都指向此处。

## 决策点

### Implementer 状态分流

| 状态 | controller 处理 |
|---|---|
| `DONE` | 进 Step 5.2 reviewer |
| `DONE_WITH_CONCERNS` | 读取结构化 `concerns[]`；`type=correctness/scope/verification` 或 `severity=blocking` → implementer 修 / 补 context 后再 review；`type=observation` 且 `severity=non_blocking` → 记录 journal 后进 5.2 |
| `NEEDS_CONTEXT` | controller `AskUserQuestion` → 答案塞回 prompt → 重派 |
| `BLOCKED` | 评估根因 → 补 context / 升 model / 拆 task / escalate user |

### Reviewer 状态分流（合并后）

单 reviewer subagent 在一个 context 内顺序执行两 phase：

- **Phase 1 — Acceptance Compliance**：AC 覆盖 / 超额 / 关键约束。`phase1.decision = REVISE` → 直接返回，**不执行 Phase 2**（gate-rule）。
- **Phase 2 — Code Quality**：critical / important / minor 三档。`critical: []` 且 `important: []` 才 PASS。

`decision: REVISE` → controller 把 `revise_instructions` 塞回 implementer prompt → 重派 → 重 review。循环上限 **3 次**（合并 phase1+phase2 共享），超过 → `halted` + `halt_reason: 'review-loop'`。

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
- ❌ 让 implementer 自己读 plan.md / spec.md（controller 必须把 task block 完整粘进 prompt）
- ❌ 让 controller 把整文件正文粘进 reviewer prompt（reviewer 自跑 `git diff <base>..HEAD`）
- ❌ controller 为补 patterns-to-mirror / mandatory-reading 的行号去 Read 源码（行号可选；缺失时给路径 + 意图，让 implementer 自读定位 —— 否则读取成本回灌 controller，是 333k 上下文膨胀的主因）
- ❌ reviewer / implementer 返回散文报告（strict JSON-only，schema 违规重派 1 次后 halt）
- ❌ 在 plan 执行路径里同时派发多个 implementer subagent（plan task 有依赖 / 共享文件，写动作顺序执行）。文件不重叠的独立写任务走 `dispatching-parallel-agents` 的 writable fan-out，不在本主路径并行

## 与其它 skill 的边界

- **TDD**：默认关闭。仅当 `/workflow-execute --tdd` 使入口返回 `tdd_enabled: true` 且任务满足 TDD 条件时,implementer prompt 才在 `<protocols>` 中引用 `../tdd/SKILL.md`（不内联 TDD 全文）。
- **Codex spec-级第二意见**：`workflow-review` 的 codex_enhanced 模式仅用于 spec §1 成功标准 / 跨 task contract 一致性。不驻留 per-task review。
- **dispatching-parallel-agents**：只读 fan-out（debug / research / multi-bug 调查）+ writable fan-out（文件不重叠的独立写任务）。**不参与有依赖的 plan task 执行** —— plan task 走本主路径顺序

## quality_gate 字段语义

详见 ADR `.claude/code-specs/adr/0002-drop-writable-parallel.md`。摘要：字段作为 `git_commit` action 边界 marker（commit gate），仅用于 Step 7 post-execution governance 路由（quality_gate task + budget warning+ → pause-quality-gate 让用户决策）。代码质量 review 由 Step 5.2 reviewer Phase 2 默认覆盖，与本字段解耦。

> ⚠️ 别混淆两个同名概念：① `task.quality_gate`（plan 里的 bool，commit 边界 marker，本节所述）；② `state.quality_gates[taskId]`（per-task review record，由 Step 6 ② reviewer PASS 后经 `quality_review.js pass` 落盘）。后者是 `workflow-review` 的 per-task 审计锚点，落盘是 CLI 写文件、不回灌 controller 上下文，与 ADR 0002 "reviewer 输出不污染 controller" 不冲突。
