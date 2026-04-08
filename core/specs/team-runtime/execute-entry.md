# `/team execute` 入口

`/team execute` 不是重写执行器，而是在现有 workflow execution/runtime helpers 外包一层 team orchestrator。

## 入口职责

1. 读取 `team-state.json`
2. 验证 runtime 工件与关键字段完整性
3. 识别当前 `team_phase`
4. 在 `team-exec` 中决定：顺序推进 / 单子 agent / 并行批次
5. 汇总验证结果，进入 `team-verify`
6. 若存在失败边界，则进入 `team-fix`
7. 只重投失败边界，直到 `completed`、`failed` 或人工中断

## Execute Entry Gate（强制）

在 `/team execute` 真正推进之前，必须先完成以下校验；任一项失败时，必须立即停止并返回阻断信息：

- `team-state.json` 存在且可解析
- `team_phase` 合法，必须属于：
  - `team-plan`
  - `team-exec`
  - `team-verify`
  - `team-fix`
  - `completed`
  - `failed`
  - `archived`
- 若当前 phase 为 `completed`、`failed` 或 `archived`，不得继续推进
- `spec_file`、`plan_file`、`team_tasks_file` 已在 state 中声明，且目标文件存在、可读
- `team-task-board.json` 非空，且 boundary 结构合法
- state 至少含有：`project_id`、`team_id`、`team_name`、`status`、`team_phase`、`spec_file`、`plan_file`、`team_tasks_file`、`worker_roster`、`team_review`、`fix_loop`

## 阶段准入条件

### `team-plan -> team-exec`

只有在以下条件全部满足时，才允许进入 `team-exec`：
- `spec.md` 已存在
- `plan.md` 已存在
- `team-task-board.json` 已存在，且至少包含一个 boundary
- worker ownership / dispatch metadata 已存在
- `worker_roster` 已初始化，至少包含 orchestration 角色

不满足时：
- 停留在 `team-plan`
- 返回 `team-plan gate failed`
- 输出缺失工件或缺失字段

### `team-exec -> team-verify`

只有在以下条件全部满足时，才允许进入 `team-verify`：
- board 中不存在 `pending`
- board 中不存在 `in_progress`
- board 中不存在 `failed`
- 所有 boundary 都已进入完成态
- 若存在 `dispatch_batches`，则不得有未结束批次
- verify 输入可读且能定位到已完成 boundary 的执行结果

不满足时：
- 若存在 `failed` boundary，则进入 `team-fix`
- 若仍存在 `pending` / `in_progress`，则保持 `team-exec`
- 不得仅依据“完成数量较多”就自动进入 `team-verify`

### `team-verify -> team-fix | completed`

进入 verify 后，必须执行 team 级汇总验证。

只有在以下条件全部满足时，才允许进入 `completed`：
- `team_review` 已生成并写回 runtime
- `team_review.overall_passed === true`
- `team_review.reviewed_at` 已写入

若 `team_review.overall_passed === false`，且能定位失败边界，则进入 `team-fix`。

### `team-fix -> team-verify | failed`

进入 `team-fix` 前，必须满足：
- 至少存在一个失败边界，或 `team_review` 已明确指出失败边界
- `fix_loop` 已存在，且包含：
  - `attempt`
  - `current_failed_boundaries`

修复阶段约束：
- 只允许回流失败边界，不得重跑整个团队
- 每次进入 `team-fix` 都必须增加 `fix_loop.attempt`
- 若失败边界为空，不得进入 `team-fix`
- 达到实现定义的最大修复尝试次数后，可进入 `failed`

## Worker Gate（强制）

- planning 阶段允许使用只读 worker
- execute 阶段必须至少存在一个可写执行型 worker
- 若当前 roster 仅包含只读 worker，不得进入 `team-exec`

## 与并行分派的关系

- team runtime 自己负责多实例编排、边界任务板与阶段推进
- `dispatching-parallel-agents` 只作为规则来源：独立性检查、边界分组、冲突降级
- `ContextGovernor` 返回 `continue-parallel-boundaries` 时，只能解释为当前 `team-exec` 的执行建议
- 在普通 `/workflow execute` 中，`parallel-boundaries` 仍只是 workflow 执行路径优化，不等于 team mode
- 不得把 `parallel-boundaries` 或普通 workflow 信号，解释为 team runtime 合法推进依据

## 复用优先级

优先复用：
- `workflow-executing`
- `workflow-reviewing`
- `dispatching-parallel-agents`（只复用独立性检查 / 边界分组 / 冲突降级规则）
- workflow runtime shared helpers

## 阻断返回建议

当 execute 因门禁失败而被阻断时，建议返回结构至少包含：

```json
{
  "error": "team execute gate failed",
  "team_phase": "team-plan",
  "missing_artifacts": ["spec_file", "team_tasks_file"],
  "invalid_fields": [],
  "next_action": "repair-runtime-or-rerun-team-start"
}
```

阻断返回必须指出：
- 当前 phase
- 缺失工件
- 非法字段或非法状态
- 建议下一步
