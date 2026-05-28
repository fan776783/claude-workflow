# 折叠 execute 为单一 lean 路径——删 governor + per-task gate 持久化 + 废 workflow-review

`workflow-execute` 当前是"可恢复治理型状态机"：per-task ~7 次 CLI 往返中约 4 次（governor `decide` / `decide-post-execution` / `apply-decision`、`quality_review pass` 写盘、`advance` 的 state 写）纯为跨会话 resume + 审计而存在；落盘 state 80%（实测 ~11.8KB / ~22KB）是 `quality_gates` per-task 审计记录。reelmatefrontend journal 实证：真实 run 均为 5–7 task 单会话跑完（session-014=7、session-015=5），跨会话 resume 几乎不发生。resume 既然罕见，这层 durable + 机器化 gate 是几乎不回本的固定成本。决定一刀切收敛为单一 lean 路径：删 governor 决策、删 per-task quality gate 持久化、删 `review_pending` 状态、废除 `/workflow-review` skill 并把终审折叠进 execute 末尾（inline 派 final reviewer subagent 跑整 branch diff vs spec）、把机器 write-scope hard-block 软化为 prompt prose + 越界自报 + reviewer 复核。对齐 superpowers `subagent-driven-development`（单会话、controller 持全 plan、末尾全量终审）。这是 ADR 0002「删 0 回本的 durable 机器」同一思路的延续——上次删的是 worktree-per-task 重型可写并行基建，本次删的是 governor + per-task gate 持久化这层治理/审计机器。

## Status

accepted（2026-05-27，via `/grill` 5 个决策节点 + `/workflow-spec`）。延续 ADR 0002 先例（见 0002 末尾后继指针）。

## Considered Options

- **lean 默认 + durable opt-in 双路径** — 拒绝。维护两条路径有持续复杂度成本；resume 实证极少，安全网几乎不触发，不值这笔维护账。
- **纯无状态（TodoWrite + git history，无 state 文件）** — 拒绝。击穿 `/workflow-status` / `/workflow-archive` / `/workflow-delta` + SessionStart / PreToolUse hook 对 `status` / `progress.completed` / `current_tasks` 的依赖，blast radius 过大。极简保留 state（含 `status`）是折中。
- **保留机器 write-scope hard-block（`allowed_write_paths` / `forbidden_actions` 强制）** — 拒绝。与瘦身方向矛盾，且需保留 task-bundle 抽取层；改为 prompt prose 软提示 + implementer 越界自报 `DONE_WITH_CONCERNS` + reviewer 复核裁定。
- **独立全量 `/workflow-review` 保留** — 拒绝。per-task review 罕见跨会话消费，独立 skill + `review_pending` 中间态纯增 surface area；折叠进 execute 末尾 inline 终审 + branch 级单审走 `/diff-review` 已覆盖。
- **删 spec/plan/delta 阶段 state 字段一并瘦身** — 拒绝。`context_injection` 实测仅 505B（非膨胀源），`review_status` / `delta_tracking` / `contract_digest_path` 由 `/workflow-spec` | `plan` | `delta` 拥有，删它们撞"不改 spec/plan/delta"非目标。删除边界精确收窄到 execute + `/workflow-review` 拥有的字段。

## Consequences

非直观下游警示：

- **state schema 兼容（读时丢弃，不写 migration）**：老 `workflow-state.json` 含 `quality_gates` / `continuation` / `review_report_path`（及 governor budget 的 `contextMetrics`）字段，新 `ensureStateDefaults` read-side normalize 时静默 `delete`。**第一次读老 state 后写回时，字段消失**。不写 migration 脚本——这是"读时丢弃"行为不是迁移，与 ADR 0002 删 `parallel_groups` / `parallel_execution` / `boundaryScheduling` 同手法。
- **status 枚举收缩**：`idle → spec_review → planned → running → completed`，删 `review_pending` 中间态；execute 跑完即 `completed`。`halted` 仍存（halt_reason: `failure` / `dependency` / `review-loop`；删 `governance`）。`/workflow-status` / `/workflow-archive` 适配极简 state，不再展示 `quality_gate_summary` / governor 字段。
- **CLI surface 收缩**：`workflow_cli.js` 删 `set-report-path`；`status` / `context` / `advance` 适配极简 state（`cmdStatus` / `cmdContext` / `buildRuntimeSummary` 移除 `quality_gates` / governor 字段引用，消除 cmdContext 的 runtime 重复）。`execution_sequencer.js` 退役 governor 决策导出（`decideGovernanceAction` / `decidePostExecutionAction` / `applyGovernanceDecision` / continuation），保留 task 解析 / skip / retry。`quality_review.js` 的 `pass` / `fail` 持久化退役（reviewer prompt 构造若被末尾终审复用则保留该部分）。
- **行为变化**：execute 不再调 `quality_review.js pass` 写 `state.quality_gates`；reviewer PASS 仅内存确认即继续。终审从独立 `/workflow-review` skill 折叠为 execute 末尾 inline 派 final reviewer subagent（整 branch diff vs spec）。每 task 模型面 CLI 往返 ~7 → ~2；落盘 state ~22KB → ~3KB（`quality_gates` 蒸发）。
- **write-scope 软化**：implementer prompt prose 写明该 task 预期改动文件（取自 plan task `files`），越界自报 `DONE_WITH_CONCERNS` + reviewer 复核；删机器 hard-block（`allowed_write_paths` / `forbidden_actions` 强制）。大共享前端越界风险残留，靠 reviewer 兜（已接受的 trade-off）。
- **平台 fallback**：no-subagent 平台（opencode / antigravity / droid / gemini）仍走 controller 主会话 self-review 路径，无 reviewer subagent 起停。质量上限低于 claude-code / cursor / codex；不阻塞执行（与 ADR 0002 平台降级一致，保留）。
- **`/workflow-review` 废除 + 引用清理**：`core/skills/workflow-review/` 整目录删除；全仓 `workflow-review` 反向引用（实测 ~31 文件）归零或对历史记录附 `// glossary-allow` 豁免——遗漏即悬挂链接，以 grep 全量归零为验收项。glossary `review` 词条 See 从 `workflow-review/SKILL.md` 改指 execute SKILL Step 7 终审 / `diff-review`。
- **hooks 安全**：`core/hooks/` 不读 `quality_gates` / `context_injection` / `review_status` / `review_pending`，仅读 `status` / `progress.completed` / `current_tasks` / `halt_reason`（全为保留字段）；`pre-execute-inject.js` 的 `halted+governance` 放行分支随 governor 删除简化为 `status==='running'`。
- **glossary drift 联动**：glossary 改 `workflow`（去 "persisted"）/ `quality-gate`（去 "per-task automatic" + 持久化语义）/ `review`（See 改指）定义须过 `scripts/validate.js` glossary-drift lint（扫描全部 normative 文档）；三词条 Forbidden synonyms 行保持不动，drift 扫描依赖它。

实施切片见 spec `docs/workflows/specs/执行流程精简化删可恢复-0527.md` §8 + plan `~/.claude/workflows/8c5fd4f4930b/plans/执行流程精简化删可恢复-0527.md`。
