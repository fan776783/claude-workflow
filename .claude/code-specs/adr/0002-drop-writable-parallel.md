# 删除 writable 并行子系统并改造为 fresh-subagent-per-task 主路径

`workflow-execute` 的 writable 并行子系统（worktree-per-task + 集成 worktree + `merge_strategist` + `batch_orchestrator` writable 路径 + `parallel_execution.enabled` 配置门 + `boundaryScheduling` + scope:batch quality gate）在 12 个真实 skymediafrontend session 中 0 启用，但占用大量代码与 SKILL.md 篇幅。决定一刀切下线 writable 并行，对齐 superpowers `dispatching-parallel-agents` 思路（只读 fan-out only），同时新建 fresh-subagent-per-task 主路径：每 task 起 fresh implementer subagent + 串行 spec reviewer + code-quality reviewer 两段 review，HITL task 通过 implementer `NEEDS_CONTEXT` 反问 → 主会话 `AskUserQuestion` → 重派协议处理。理由：现状 default `enabled:false` + 用户从不显式 opt-in → 100% 实测无收益；保留这条路径维护成本（state schema + merge_strategist + 独立性检测 + conflict 检测 + 集成 worktree + skill 文档）远大于收益。补偿手段（fresh-subagent-per-task）解决了 context pollution 这个真实痛点，比 writable 并行收益更直接。

## Status

accepted（2026-05-19，via `/grill` 6 个开放点 + `/quick-plan`）

## Considered Options

- **维持现状 + 翻 default 为 `enabled:true`** — 拒绝。即便翻默认，plan 形状（纵向链 + 共享 modal/locales）导致独立性检测仍把绝大多数批次打回串行；维护成本不变，收益依旧 ≈0
- **保留 writable 并行但 runtime auto-probe**（claude-code + git worktree available → 自动启用） — 拒绝。同上 plan 形状问题；且把"什么时候 writable 并行能跑"的复杂度推给了 runtime，调试更难
- **删 writable 并行但保留 batch_orchestrator 的 readonly fan-out 给 dispatching-parallel-agents** — 拒绝。superpowers 的 readonly fan-out 是 prose-only（控制器直接 `Task(...)`），不需要 batch_orchestrator 维护 group/artifact state。保留只是增加 surface area
- **改 brief mode 触发条件**让小 plan 跳过 reviewer subagent — 拒绝。架构一致性优先；小 plan 也付得起 implementer+spec+quality 三轮 subagent 成本
- **保留 `quality_gate: true` 触发额外 review** — 拒绝。每 task 默认 spec+quality 已覆盖；保留只会产生"普通 task 走双 review vs gate task 走三 review"的两套路径。`quality_gate` 字段瘦身为 commit gate marker
- **保留 `findParallelGroups` 缩窄到 readonly action 触发 planner hint** — 拒绝。实测 plan 形状下 0 命中，hint 永远不亮
- **HITL task 不进 subagent**（保留原协议主会话直接执行） — 拒绝。行为分裂：AFK 走 subagent / HITL 走主会话；不如统一通过 implementer NEEDS_CONTEXT 协议处理，subagent 隔离收益一致

## Consequences

非直观下游警示：

- **state schema 兼容**：老 `workflow-state.json` 含 `parallel_groups` / `parallel_execution` / `boundaryScheduling` 字段，新 `ensureStateDefaults` read-side normalize 时静默 `delete` 这三个字段。**第一次读老 state 后写回时，字段消失**。不写 migration 脚本——这是"读时丢弃"行为不是迁移
- **行为变化**：每 task 主会话起 3 个 subagent（implementer + spec reviewer + code-quality reviewer），cost ~ 3x 原 main-agent 模式。Brief mode 删除后小 plan 也付这笔成本。在 cost-sensitive 场景下用户可能要求加 opt-out 开关——但本 ADR 阶段**不提供** opt-out（行为收敛）
- **平台 fallback**：opencode / antigravity / droid / gemini 自动降级到主会话执行 + spec self-review，无 reviewer subagent 起停。质量上限低于 claude-code/cursor/codex；不阻塞执行
- **CLI surface 收缩**：`workflow_cli.js` 删除 `advance --batch` / `advance --batch-fail` / `--parallel` / `--no-parallel` / `parallel` subcommand；`batch_orchestrator.js` / `merge_strategist.js` 整删；`dependency_checker.js` 删 `findParallelGroups` / `canRunParallel` / `hasTransitiveDep` / `parallel` CLI；`task_manager.js` 删 `cmdParallel` / `cmdCompleteBatch`；`quality_review.js` 删 batch gate fns；`execution_sequencer.js` 删 `DEFAULT_PARALLEL_CONFIG` / `normalizeProjectConfig` / `buildBatchView` / `prepareParallelSequentialFallback`
- **ContextGovernor 决策**：原 `continue-parallel-boundaries` action 改为 `continue-direct` + `advisory: 'consider-handoff-or-split'`（不阻塞，软提示）。`hard-stop-templates.md` 不动（advisory 不是 hard stop）
- **跨 skill 联动**：`workflow-plan` 删 "2+ 独立任务域可并行" hint；`workflow-review` 删 scope:batch 入口；`dispatching-parallel-agents` 整体重写为 readonly fan-out only，明确写 "Never dispatch multiple implementation subagents in parallel"
- **HITL × subagent 协议**：implementer prompt 头部强制注入 `Before any code change, you MUST emit NEEDS_CONTEXT with the questions the human needs to answer.`，主会话拿到 `NEEDS_CONTEXT` 后调 `AskUserQuestion`，答案塞回 prompt 重派。HARD-GATE #5 改写
- **Codex 第三段 review 解耦**：原 `quality_gate: true` 叠加 codex review 的语义拆开。Codex review 由 `core/specs/shared/codex-routing.md` 信号独立驱动（backend_heavy / security / data），与 spec+quality 两段 review 并行存在、不替代
- **测试影响**：`tests/test_workflow_helpers.js` 删 9 个 batch-related test，新增 1 个 `ensureStateDefaults drops legacy fields` test。`scripts/validate.js` 三件契约测试不动

实施 P1-P6 见 `~/.claude/workflows/8c5fd4f4930b/plans/drop-writable-parallel-fresh-subagent-0519.plan.md`。

---

**Refined by**: ADR-0003（2026-05-26）—— 本 ADR 删的是 worktree-per-task **重型可写并行基建**，结论不变；但其顺手把 `dispatching-parallel-agents` 钉成「只读 fan-out only」这一条 consequence 被 0003 放宽：允许文件不重叠的 writable fan-out（superpowers 式轻量手动判定，零运行时基建）。两者不冲突 —— 重型并行仍不恢复。
