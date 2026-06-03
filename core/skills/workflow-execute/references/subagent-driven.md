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
   └─ Step 7      所有 task 完成 → inline 末尾终审 → completed
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
- ❌ controller 自读业务源码回灌上下文——**不限 Read 工具,`cat/sed/head/tail/grep/rg/awk` 等 bash 通道同禁**。补 patterns-to-mirror / mandatory-reading 时只给路径 + 意图让 implementer 自读定位(行号可选);源码/diff 读取一律 subagent 侧。实测违反此条(Read + bash-cat 双通道 controller 自读 ~129k)是单会话上下文膨胀主因
- ❌ controller 读 plan.md / spec.md **全文**回灌上下文(只持 contract-digest + Step 1 task 源切片;plan/spec 全文交 subagent 按路径自读)
- ❌ 让 controller 把整文件正文粘进 reviewer prompt（reviewer 自跑 `git diff <base>..HEAD`）
- ❌ controller 全量 dump 诊断输出回灌上下文(`workflow_cli status/context`、`git diff/log/status` 一律 `jq`/`grep`/`--stat` 取字段;原始 diff 验证交 reviewer subagent,不在 controller 跑)
- ❌ reviewer / implementer 返回散文报告,或 **JSON 前后夹带散文/markdown/推理**(strict JSON-only:首字符即 `{`;controller 不做 loose-extract 容忍,夹带散文 = schema 违规,重派 1 次后 halt)
- ❌ 在 plan 执行路径里同时派发多个 implementer subagent（plan task 有依赖 / 共享文件，写动作顺序执行）。文件不重叠的独立写任务走 `dispatching-parallel-agents` 的 writable fan-out，不在本主路径并行

## 与其它 skill 的边界

- **TDD**：默认关闭。仅当 `/workflow-execute --tdd` 使入口返回 `tdd_enabled: true` 且任务满足 TDD 条件时,implementer prompt 才在 `<protocols>` 中引用 `../tdd/SKILL.md`（不内联 TDD 全文）。
- **Codex spec-级第二意见**：execute 末尾终审（Step 7）的 codex_enhanced 模式仅用于 spec §1 成功标准 / 跨 task contract 一致性。不驻留 per-task review。
- **dispatching-parallel-agents**：只读 fan-out（debug / research / multi-bug 调查）+ writable fan-out（文件不重叠的独立写任务）。**不参与有依赖的 plan task 执行** —— plan task 走本主路径顺序

## quality_gate 字段语义

详见 ADR `.claude/code-specs/adr/0002-drop-writable-parallel.md`。摘要：字段作为 `git_commit` action 边界 marker（commit gate），原 post-execution governance 路由（budget warning+ → pause-quality-gate）已随 lean-execute 重构退役（ADR 0004），字段保留仅用于 plan 层标注 commit 边界。代码质量 review 由 Step 5.2 reviewer Phase 2 默认覆盖，与本字段解耦。

> ⚠️ 别混淆两个同名概念：① `task.quality_gate`（plan 里的 bool，commit 边界 marker，本节所述）；② per-task reviewer 的终判结论（Step 6 ② reviewer PASS 后 controller 内存确认放行，per-task gate 落盘已退役，不回灌 controller 上下文，与 ADR 0002 "reviewer 输出不污染 controller" 不冲突）。
