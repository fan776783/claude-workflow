# Lean 化 workflow-execute（删 durable，单一精简路径）

## 背景与目标

把 workflow-execute 从"可恢复治理型状态机"瘦身为单一 lean 路径，对齐 Superpowers，砍掉 resumability + 机器化 gate 税。

依据：中断恢复（resume）场景实证极少——journal 显示实际 run 都是 5–7 task 单会话跑完（session-014=7 task、session-015=5 task），跨会话 resume 几乎不发生。每 task ~7 次 CLI 往返中约 4 次（decide / decide-post-execution / quality_review pass / advance 的 state 部分）纯为 resume + 跨会话审计存在。

## 核心决策（grill 对齐）

1. **彻底删 durable**，不留 opt-in 双路径。
2. **极简 state**：仅 `project_id / plan_file / spec_file / progress.completed[] / status`；删 `quality_gates` + governor + `context_injection` + `review_status`（state 22KB → ~1KB）。
3. **lifecycle 收敛**为 `planned → running → completed`；删 `review_pending`。
4. **终审折叠进 execute 末尾**——所有 task 跑完后 inline 派 final reviewer subagent 跑整个 branch diff vs spec；**废除独立 `/workflow-review`**；branch 级单审改走 `/diff-review`。
5. **write-scope soft 化**：implementer prompt prose 写明该 task 预期改动文件（取自 plan task 的 file 列表，不走 CLI 强制）+ implementer 越界自报 `DONE_WITH_CONCERNS` + reviewer 复核；无机器 hard-block。

## 执行循环改动（每 task CLI 往返 ~7 → ~2）

- Step 1 controller 一次性读 plan 持全切片；删 per-task `task-bundle` + Step 4 `task_parser`（吸收 P1：消除 task_text 与抽取字段双份）。
- implementer prompt = `task_text` 切片 + controller 策展 context，**不塞解析字段**。
- 删 governor `decide` / `decide-post-execution`；phase 边界 + context 压力改 controller 内联一句 banner（无 CLI、无落盘）。
- 删 per-task `quality_review.js pass` 持久化；reviewer PASS 内存确认即继续。

## 保留（不动）

per-task reviewer subagent（AC + 质量两 phase）、verification 命令运行、codex oracle 回灌（loop=2 stuck）、triage、TDD / HITL 路径、journal、execute→末尾终审的 handoff 摘要。

## 联动改（跨 skill + 框架层）

- glossary：重写 `workflow`（去 "persisted" 措辞）/ `quality-gate`（去 "per-task automatic" + 持久化语义）。
- `cmdStatus` / `cmdContext` / `buildRuntimeSummary`：随极简 state 重写（顺带消除 P2 的 runtime 重复字段）。
- `/workflow-status` / `/workflow-archive` / `/workflow-delta`：适配极简 state。
- SessionStart hook：适配（注入内容随 state 收缩）。
- `/workflow-review` skill：废除。

## 被吸收的既往优化点（不单列）

- **P1**（task-bundle 双份）→ 由"controller 持全 plan + implementer 只收 task_text"吸收。
- **P2**（cmdContext runtime 重复）→ 被复制字段随 state 删除而消失；cmdStatus/cmdContext 重写时顺手清。
- **P3**（quality_gates 元数据膨胀）→ 删 per-task 持久化后根因消失，纯红利。
- **P4**（plan.md 重读）→ controller 一次性持全 plan 后问题不存在。

## 接受的代价

- 跨会话 resume 退为手动（开新会话 + 读 plan + git log 自行定位进度）。
- per-task review 审计链断（只剩末尾终审 + git history）。
- write-scope 软化（无机器 hard-block，靠 reviewer 兜，大共享前端上有残余风险）。

## 非目标

- 不改 `/workflow-spec` / `/workflow-plan` 的 spec/plan 生成逻辑。
- 不动 figma / alidocs / bk 等 MCP wrapper skill。
- 不引入新的并行执行（plan task 仍顺序）。
