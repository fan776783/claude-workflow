---
name: team-workflow
description: "team 重型运行时入口 - 承接 /team start|execute|status|archive|cleanup 的 phase/state contract，统一复用 core/specs/team-runtime/* 与 core/utils/team/*.js。"
---

# team-workflow

> 本 skill 是 `/team` 的重型 runtime 入口，也是 team 执行纪律的完整行动指南。
> `team` skill 只保留显式入口契约与路由关系；team 的 phase/state contract、门禁规则、
> status/archive 语义与共享运行时资源统一由本 skill 承接。

## 先读

- Command 入口：[`../../commands/team.md`](../../commands/team.md)
- 显式入口说明：[`../team/SKILL.md`](../team/SKILL.md)
- runtime 概览：[`../../specs/team-runtime/overview.md`](../../specs/team-runtime/overview.md)
- 状态机：[`../../specs/team-runtime/state-machine.md`](../../specs/team-runtime/state-machine.md)

<HARD-GATE>
五条不可违反的规则：
1. Start 输出的 spec/plan/board 必须全部落盘且可解析，才允许宣告 start 完成
2. Execute 阶段必须至少存在一个可写 implementer，否则不得推进到 team-exec
3. verify 失败时只允许回流失败边界到 team-fix，不得重跑整个团队
4. 每个 boundary 完成后必须立即更新 board + state，禁止批量回写
5. team-review 未生成且 overall_passed 未确认，不得进入 completed
</HARD-GATE>

---

## Action 1: Start Contract

> 对齐 `workflow-plan` 的治理思路，简化版规划。

### Checklist（必须按序完成）

1. ☐ 解析参数 + 预检
   - 读取 requirement 与 team 标识
   - 检查是否存在未归档的 team runtime
   - CLI: `node team-cli.js status --project-id X` 确认无活跃 team
2. ☐ 代码库分析（复用 workflow-plan Step 2 思路）
   - 分析与需求相关的代码，提取可复用组件和架构模式
   - 输出辅助上下文供后续 spec/plan 使用
3. ☐ 生成 team spec.md（简化版，无 UX/讨论阶段）
   - 生成 team 专用 `spec.md`，落盘到 `.claude/specs/{team-name}.team.md`
   - task 格式必须与 `WorkflowTaskV2` 兼容
4. ☐ 生成 team plan.md + team-task-board.json
   - plan 落盘到 `.claude/plans/{team-name}.team.md`
   - board 落盘到 `~/.claude/workflows/{projectId}/teams/{teamId}/team-task-board.json`
   - board 至少包含一个 boundary
5. ☐ 初始化 team-state.json + boundary_claims
   - 初始化 `team-state.json` 到 `~/.claude/workflows/{projectId}/teams/{teamId}/`
   - 写入 `boundary_claims` 和 dispatch metadata
   - worker_roster 至少包含 orchestrator 角色
6. ☐ 🛑 Start 完成（Hard Stop，不自动进入 execute）
   - 验证全部工件落盘且可解析（HARD-GATE #1）
   - 输出提示：`/team start 完成，请执行 /team execute 开始实施`

### 与 workflow-plan 的关系

team 专用 spec/plan 是简化版规划产物，不等同于 `/workflow plan` 的完整 8 步管线。
以下 workflow-plan 治理措施在 team planning 中不适用：
- UX 设计审批
- 需求讨论
- Spec Self-Review / Plan Self-Review
- PRD Coverage Drift Check

如果 team 的规划需求升级到需要完整 spec 治理，应先拆分为独立的 `/workflow plan` 任务，
再将规划产物导入 team runtime。

---

## Action 2: Execute Contract

> 对齐 `workflow-execute` 的 7 步结构。

### Checklist（按序执行）

1. ☐ 读取 team runtime 状态（state-first）
   - CLI: `node team-cli.js context --project-id X --team-id Y`
   - 检查输出的 `team_phase` 和 `governance_signals`
   - 确认 `status` 不为终态
2. ☐ Execute Entry Gate（强制校验）
   - 当前 phase 不得为 `completed` / `failed` / `archived`
   - board 非空且合法
   - 至少存在一个可写 implementer（HARD-GATE #2）
   - CLI: 确认 `governance_signals.has_writable_worker === true`
   - 参见 [`../../specs/team-runtime/execute-entry.md`](../../specs/team-runtime/execute-entry.md)
3. ☐ 推断当前 team_phase + 提取可执行边界
   - CLI: `node team-cli.js next --project-id X --team-id Y`
   - 检查 `boundary_id` 和 `dependencies_met`
   - `boundary_id === null` 且 `reason === 'all_completed'` → 进入 verify
   - `boundary_id === null` 且 `reason === 'all_blocked'` → 等待或检查阻塞原因
4. ☐ 执行边界任务（单/并行）
   - 单边界：直接执行 boundary 对应的实现任务
   - 多独立边界：可通过 `dispatching-parallel-agents` 并行
   - `dispatching-parallel-agents` 只作为规则来源：独立性检查、边界分组、冲突降级
   - 执行完成后必须验证结果
5. ☐ Post-Execution Pipeline（每个 boundary 完成后 — HARD-GATE #4）
   - 验证执行结果（测试通过、文件存在）
   - 更新 board + state：`node team-cli.js advance <boundaryId> --project-id X --team-id Y`
   - 确认输出 `{ ok: true, board_updated: true, state_updated: true }`
   - 检查 `checkpoint_warning` 是否有 stale 提示
   - 每个 boundary 完成后立即执行此步骤，禁止攒到最后批量执行
6. ☐ 判断下一步
   - CLI: `node team-cli.js context --project-id X --team-id Y`
   - 检查 `governance_signals.phase_transition_pending`
   - 仍有 pending boundary → 回到步骤 3 继续 execute
   - 全部完成且无失败 → 进入 Action 3 (Verify)
   - 有失败 boundary → 进入 team-fix 子循环

### Execute 与 workflow-execute 对齐说明

| workflow-execute 步骤 | team-execute 对齐 |
|----------------------|-------------------|
| Step 2: state-first | team state-first：先读 `team-state.json`（CLI `context` 命令） |
| Step 3: ContextGovernor | team 只做 phase 边界判断（`inferTeamPhase()`），不复用完整 budget backstop |
| Step 5: 执行动作 | 边界任务按 board 推进（CLI `next` → 执行 → CLI `advance`） |
| Step 6: Post-Execution Pipeline | 每个 boundary 完成后：验证 → advance → 确认 checkpoint |
| Step 7: 下一步决策 | 推断 phase → 继续 / verify / fix |

> ContextGovernor 的 budget backstop 不复用到 team 层。
> 理由：orchestrator 自身 context 消耗较轻，boundary 执行由 sub-agent 完成，
> sub-agent 有独立的 context budget。

### team-fix 子循环

当 `team_phase === 'team-fix'` 时：
- 只允许回流失败边界，不得重跑整个团队（HARD-GATE #3）
- CLI: `node team-cli.js context` 获取失败边界列表
- 针对每个失败边界重新执行 → advance
- 每次进入 fix 循环必须增加 `fix_loop.attempt`
- 修复完成后回到 verify

---

## Action 3: Verify Contract

> 对齐 `workflow-review` 的两阶段审查。

### Checklist（按序执行）

1. ☐ 汇总所有 boundary 执行结果
   - CLI: `node team-cli.js context --project-id X --team-id Y`
   - 确认 `board_summary.failed === 0`
   - 确认所有 boundary 已进入完成态
2. ☐ Stage 1：合规验证（team spec 覆盖检查）
   - 对照 team spec，逐条验收每个 boundary 的输出
   - 检查文件是否创建/修改到位
   - 检查 acceptance criteria 是否满足
3. ☐ Stage 2：集成验证（跨边界接口一致性）
   - 验证跨 boundary 的函数签名、类型定义、数据格式一致
   - 运行整体测试
   - 检查跨模块依赖是否正确
4. ☐ 写入 team_review 结果
   - 更新 `team-state.json` 的 `team_review.overall_passed` 和 `team_review.reviewed_at`
   - 记录验证证据到 `team_review.evidence_summary`
5. ☐ 判定：completed / team-fix
   - `overall_passed === true` 且 `reviewed_at` 已写入 → completed（HARD-GATE #5）
   - 存在失败 → 记录 `failed_boundaries` → 回到 Action 2 的 team-fix 子循环

---

## Action 4: Status / Archive / Cleanup Contract

> 对齐 `workflow-ops` 的操作面。

### Status

- CLI: `node team-cli.js status --project-id X --team-id Y`
- 或更丰富的上下文：`node team-cli.js context --project-id X --team-id Y`

展示内容：
- `team_id` / `team_name`
- `status` / `team_phase`
- 当前边界任务、claim 角色与当前 owner
- 已完成 / 失败 / 待回流边界
- 最近一次 verify 结论
- 可认领的未阻塞边界
- 下一步建议

### Archive

- CLI: `node team-cli.js archive --project-id X --team-id Y`
- 前置检查：若 `team_phase` 仍为 `team-exec` 或 `team-fix`，先提示用户确认
- 归档只把 team runtime 标记为 `archived` 终态，不删除目录
- 保留 `spec.md` / `plan.md` 的可追溯性

### Cleanup

- CLI: `node team-cli.js cleanup --project-id X --team-id Y`
- 仅允许清理 `archived` 状态的 runtime
- 显式提供 `teamId`（team-guardrail 要求）
- cleanup 前必须确认无 active worker
- 只删除 `~/.claude/workflows/{projectId}/teams/{teamId}/`，不删除 repo 内规划工件

---

## 共享运行时资源

### Runtime 文档

- [`../../specs/team-runtime/overview.md`](../../specs/team-runtime/overview.md)
- [`../../specs/team-runtime/state-machine.md`](../../specs/team-runtime/state-machine.md)
- [`../../specs/team-runtime/execute-entry.md`](../../specs/team-runtime/execute-entry.md)
- [`../../specs/team-runtime/status.md`](../../specs/team-runtime/status.md)
- [`../../specs/team-runtime/archive.md`](../../specs/team-runtime/archive.md)

### Node.js helpers

- `../../utils/team/team-cli.js`
- `../../utils/team/lifecycle.js`
- `../../utils/team/state-manager.js`
- `../../utils/team/task-board.js`
- `../../utils/team/task-board-helpers.js`
- `../../utils/team/phase-controller.js`
- `../../utils/team/governance.js`
- `../../utils/team/planning-support.js`
- `../../utils/team/planning-artifacts.js`
- `../../utils/team/status-renderer.js`
- `../../utils/team/templates.js`
- `../../utils/team/doc-contracts.js`

---

## 约束

- `/team` 仍是显式入口，不因 `/workflow`、`/quick-plan`、Broad Request Detection、自然语言宽泛请求或 `dispatching-parallel-agents` 自动触发
- 只有显式 `/team` / `team-workflow` 入口才能消费 active team runtime；普通 session、workflow hooks 与普通 agent launch 必须忽略 team runtime
- 本 skill 持有 team 的重型 runtime contract，但不改动公开 `/team start|execute|status|archive|cleanup` 命令面
- team runtime 路径继续保持在 `~/.claude/workflows/{projectId}/teams/{teamId}/`
- 运行时实现继续收敛在 `core/specs/team-runtime/*` 与 `core/utils/team/*.js`
- 默认 team 规模按 3-5 个 worker 规划；不是每次都强制铺满所有角色
- idle worker 是正常协作信号，不应直接视为失败；cleanup 前必须由 lead 确认无 active worker
- `dispatching-parallel-agents` 只作为 `team-exec` 内部批次能力，不替代 team runtime
- specialist 能力优先复用 workflow role-profiles，不为 team 复制一套长期维护的 prompt
