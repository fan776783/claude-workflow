---
name: team
description: "团队模式入口 - 仅在用户显式调用 /team start|execute|status|archive 时使用；复用 workflow planning/executing/reviewing/runtime helpers，不会被 /workflow、/quick-plan、dispatching-parallel-agents 或自然语言请求自动触发。"
---

# 团队模式 `/team`

## 用法

```bash
/team "需求描述 | path/to/requirement.md"
/team start "需求描述 | path/to/requirement.md"
/team execute
/team status
/team archive
```

## 模式契约

- `/team` 是**显式模式**，只有用户明确输入 `/team ...` 时才允许进入
- `/team <自然语言需求>` 视为 `/team start <需求>` 的简写，但只在 `/team` 命令内部生效，不构成自动触发
- `/workflow` 保持现有语义，不自动升级为 team mode
- `/quick-plan` 只生成轻量 `plan.md`，不会切换到 team mode
- `dispatching-parallel-agents` 只是 `team-exec` 内部可复用的**并行规则来源**，不负责 team 生命周期，也不是 team runtime 的直接执行器
- team runtime 使用独立状态文件：`~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json`

## Runtime 路径与最小工件

团队模式至少涉及以下 runtime 工件：

```text
~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json
~/.claude/workflows/{projectId}/teams/{teamId}/team-task-board.json
.claude/specs/{teamId}.team.md
.claude/plans/{teamId}.team.md
```

若未生成上述 planning/runtime 工件，不得把当前状态视为合法的 team run。

---

## `start`

`/team start` 复用 workflow planning 的预检、代码分析、需求讨论、UX gate、`spec.md` 与 `plan.md` 生成流程，并额外产出团队编排工件。

必读：
- `../../specs/workflow-runtime/preflight.md`
- `../workflow-planning/references/start-overview.md`
- `../../specs/team-runtime/overview.md`
- `../../specs/team-runtime/state-machine.md`

额外产物：
- team-state
- 边界化 team task list
- worker ownership / dispatch metadata

### Start Exit Gate（强制）

只有当以下条件全部满足时，`/team start` 才能返回成功：

- `spec.md` 已生成并落盘
- `plan.md` 已生成并落盘
- `team-state.json` 已生成且可解析
- `team-task-board.json` 已生成且可解析
- worker ownership / dispatch metadata 已写入 runtime

若任一条件缺失：
- 不得宣告 team start 完成
- 不得建议用户继续 `/team execute`
- 必须明确报告缺失工件或缺失字段

---

## `execute`

`/team execute` 读取 team runtime，按 `team_phase` 推进：

```text
team-plan -> team-exec -> team-verify -> team-fix (loop) -> completed | failed | archived
```

### Execute Entry Gate（强制）

`/team execute` 开始前必须验证以下条件；任一条件不满足时，必须立即失败并停止推进 phase：

- `team-state.json` 存在且可解析
- `team_phase` 合法，必须属于：`team-plan`、`team-exec`、`team-verify`、`team-fix`、`completed`、`failed`、`archived`
- 若当前已处于 `completed`、`failed` 或 `archived`，不得继续执行推进
- `spec_file`、`plan_file`、`team_tasks_file` 已在 state 中声明，且目标文件存在、可读
- `team-task-board.json` 非空，且每个 boundary 具有唯一 `id` 与合法 `status`
- state 至少包含以下字段：`project_id`、`team_id`、`team_name`、`status`、`team_phase`、`spec_file`、`plan_file`、`team_tasks_file`、`worker_roster`、`team_review`、`fix_loop`

### Phase Transition Rules（强制）

#### `team-plan -> team-exec`

只有同时满足以下条件才允许进入 `team-exec`：
- `spec.md` 已存在
- `plan.md` 已存在
- `team-task-board.json` 已存在且至少包含一个 boundary
- worker ownership / dispatch metadata 已存在
- `worker_roster` 已初始化，至少包含 orchestration 角色

否则必须报 `team-plan gate failed`，不得自动跳转到 `team-exec`。

#### `team-exec -> team-verify`

只有同时满足以下条件才允许进入 `team-verify`：
- board 中不存在 `pending`
- board 中不存在 `in_progress`
- board 中不存在 `failed`
- 所有 boundary 都已进入完成态
- 若 runtime 维护 `dispatch_batches`，则不得存在未结束批次
- verify 输入可读且可定位到已完成 boundary 的执行结果

否则：
- 若存在 `failed` boundary，则进入 `team-fix`
- 若仍存在 `pending` / `in_progress`，则保持 `team-exec`
- 不得仅因“完成数量较多”而进入 `team-verify`

#### `team-verify -> team-fix | completed`

进入 verify 后必须执行 team 级汇总验证，不得跳过 verify 直接 completed。

只有当以下条件满足时，才允许 `completed`：
- `team_review` 已生成并写回 runtime
- `team_review.overall_passed === true`
- `team_review.reviewed_at` 已写入

若 `team_review.overall_passed === false`，且能定位失败边界，则进入 `team-fix`。

#### `team-fix -> team-verify | failed`

进入 `team-fix` 前必须满足：
- 至少存在一个失败边界，或 `team_review` 已明确指出失败边界
- `fix_loop` 已存在，且记录 `attempt` 与 `current_failed_boundaries`

修复阶段约束：
- 只允许回流失败边界，不得重跑整个团队
- 每次进入 `team-fix` 都必须增加 `fix_loop.attempt`
- 若失败边界为空，不得进入 `team-fix`
- 若达到实现定义的最大修复尝试次数，可进入 `failed`

### Worker Role Contract（强制）

- planning 阶段允许使用只读 worker（如需求分析、代码探索）
- execute 阶段必须至少存在一个可写执行型 worker
- 如果当前 roster 仅包含只读 worker，不得进入 `team-exec`
- 不得把前期调研 worker 的存在，视为 execute 阶段 worker 已就绪

### 执行要求

- 优先复用 `workflow-executing` 的治理、验证与质量关卡
- team runtime 自己管理多实例与边界任务板；`dispatching-parallel-agents` 只作为可复用规则来源，不作为 team 编排器直接调用
- verify 失败时只回流失败边界到 `team-fix`
- 不得把 `parallel-boundaries` 解释成“自动进入 team mode”
- 不得因 board 状态“看起来接近完成”而跳过 runtime 工件检查、verify 检查或 fix_loop 检查

必读：
- `../workflow-executing/SKILL.md`
- `../workflow-reviewing/SKILL.md`
- `../dispatching-parallel-agents/SKILL.md`（仅复用独立性检查 / 边界分组 / 冲突降级规则）
- `../../specs/team-runtime/execute-entry.md`
- `../../specs/team-runtime/status.md`

## `status` / `archive`

- `status`：查看团队阶段、边界任务进度、失败项与下一步建议
- `archive`：归档 team runtime，不改变普通 `/workflow archive` 的现有语义

## Failure Default（默认失败行为）

出现以下任一情况时，必须 fail-fast：

- 未生成 planning 工件却试图结束 `/team start`
- 未生成 runtime 工件却试图进入 `/team execute`
- `team_phase` 非法
- 缺少 `spec_file`、`plan_file`、`team_tasks_file`
- task board 为空或 boundary status 非法
- execute 阶段没有可写 worker
- verify 结果未写回 runtime，却试图进入 `team-fix` 或 `completed`
- `completed` / `failed` / `archived` 状态仍尝试继续执行

默认行为：
- 停止推进
- 输出缺失工件、缺失字段或非法状态
- 不得继续编码或宣告进入下一 phase

## 共享运行时工具

- team CLI：`../../utils/team/team-cli.js`
- team lifecycle：`../../utils/team/lifecycle.js`
- team state：`../../utils/team/state-manager.js`
- team task board：`../../utils/team/task-board.js`
- team phase controller：`../../utils/team/phase-controller.js`
- team governance：`../../utils/team/governance.js`
- team status renderer：`../../utils/team/status-renderer.js`

阅读：
- `../../specs/team-runtime/status.md`
- `../../specs/team-runtime/archive.md`
