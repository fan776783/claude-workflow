# Team Runtime 状态机

## 状态文件

```text
~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json
```

## 关联团队任务板

```text
~/.claude/workflows/{projectId}/teams/{teamId}/team-task-board.json
```

## 最小必填 schema

`/team execute` 合法运行所需的最小字段如下：

```json
{
  "project_id": "abc123",
  "team_id": "team-auth-rollout",
  "team_name": "auth-rollout",
  "status": "running",
  "team_phase": "team-exec",
  "spec_file": ".claude/specs/auth-rollout.team.md",
  "plan_file": ".claude/plans/auth-rollout.team.md",
  "team_tasks_file": "~/.claude/workflows/abc123/teams/team-auth-rollout/team-task-board.json",
  "current_tasks": ["B1"],
  "worker_roster": [],
  "team_review": {
    "overall_passed": false,
    "reviewed_at": null,
    "notes": []
  },
  "fix_loop": {
    "attempt": 0,
    "current_failed_boundaries": []
  },
  "progress": {
    "completed": [],
    "blocked": [],
    "failed": [],
    "skipped": []
  }
}
```

### 最小必填字段清单

- `project_id`
- `team_id`
- `team_name`
- `status`
- `team_phase`
- `spec_file`
- `plan_file`
- `team_tasks_file`
- `current_tasks`
- `worker_roster`
- `team_review`
- `fix_loop`
- `progress`

缺少上述任一字段时，不应视为可执行的 team runtime。

此外，`activation` / `governance` 必须共同证明该 runtime 来源于显式 `/team` 或 `team-workflow` 入口；若缺失显式来源信息，不得被普通 session 或误路由入口继续消费。

## 可选扩展字段

以下字段可作为扩展状态写入，但不替代最小必填字段：

- `dispatch_batches`
- `boundary_claims`
- `quality_gates`
- `continuation`
- `governance`
- `activation`
- `archive_summary`
- `project_root`
- `created_at`
- `updated_at`

## 推荐完整 schema

```json
{
  "project_id": "abc123",
  "team_id": "team-auth-rollout",
  "team_name": "auth-rollout",
  "status": "running",
  "team_phase": "team-exec",
  "plan_file": ".claude/plans/auth-rollout.plan.md",
  "spec_file": ".claude/specs/auth-rollout.spec.md",
  "team_tasks_file": "~/.claude/workflows/abc123/teams/team-auth-rollout/team-task-board.json",
  "current_tasks": ["B1", "B2"],
  "worker_roster": [
    {
      "worker_id": "orchestrator-1",
      "role": "orchestrator",
      "writable": false,
      "status": "running"
    },
    {
      "worker_id": "implementer-1",
      "role": "implementer",
      "writable": true,
      "status": "idle"
    },
    {
      "worker_id": "reviewer-1",
      "role": "reviewer",
      "writable": false,
      "status": "idle"
    }
  ],
  "boundary_claims": {
    "B1": {
      "assigned_role": "implementer",
      "current_worker_id": null,
      "claim_status": "unclaimed",
      "claim_version": 0,
      "attempt": 0,
      "history": []
    }
  },
  "dispatch_batches": [],
  "progress": {
    "completed": [],
    "blocked": [],
    "failed": [],
    "skipped": []
  },
  "quality_gates": {},
  "team_review": {
    "overall_passed": false,
    "reviewed_at": null,
    "notes": []
  },
  "fix_loop": {
    "attempt": 0,
    "current_failed_boundaries": []
  },
  "continuation": {
    "strategy": "explicit-team",
    "last_decision": null,
    "handoff_required": false,
    "artifact_path": null
  },
  "activation": {
    "mode": "explicit-team-command",
    "entry": "team",
    "auto_trigger_allowed": false
  },
  "updated_at": "2026-04-07T10:00:00Z"
}
```

## Phase 流转

```text
team-plan -> team-exec -> team-verify -> team-fix -> team-verify
                                      \-> completed
                                      \-> failed
                                      \-> archived
```

## 合法 phase 集合

`team_phase` 必须属于以下集合：

- `team-plan`
- `team-exec`
- `team-verify`
- `team-fix`
- `completed`
- `failed`
- `archived`

## 非法状态说明

以下情况都属于 runtime 非法状态，`/team execute` 应 fail-fast：

- `team_phase` 不在合法集合中
- `spec_file`、`plan_file`、`team_tasks_file` 已声明但目标文件不存在
- `team-task-board.json` 为空
- boundary 缺少唯一 `id`
- boundary `status` 非法
- `team-fix` 时 `fix_loop.current_failed_boundaries` 为空
- `team-verify` 时缺少 `team_review`
- `completed`、`failed`、`archived` 状态仍试图继续进入 execute
- execute 阶段缺少可写 worker，而 runtime 仍尝试推进到 `team-exec`
- cleanup 前仍存在 active worker

## 终态约束

- `completed` 为终态，不得继续执行推进
- `failed` 为终态，除非有显式人工恢复策略，否则不得自动回到 `team-exec`
- `archived` 为终态，只允许读取状态或重新启动新的 team runtime bootstrap

## 约束

- team state 复用 workflow 顶层字段，如 `project_id`、`status`、`current_tasks`、`plan_file`、`spec_file`、`progress`、`quality_gates`、`continuation`
- team 扩展字段至少包括：`team_id`、`team_name`、`team_phase`、`team_tasks_file`、`worker_roster`、`boundary_claims`、`dispatch_batches`、`team_review`、`fix_loop`
- `worker_roster` 推荐收敛为最小默认角色：`orchestrator`、`implementer`、`reviewer`；`planner` 只在 `team-plan` 阶段按需出现
- specialist 能力优先复用 workflow role-profiles，而不是为 `/team` 复制 prompt
- team runtime 的脚本实现收敛于 `core/utils/team/*.js`
- `team_phase` 与 `/workflow` 的普通执行状态必须区分，避免把 `parallel-boundaries` 误判成 team lifecycle
- “推荐 schema” 不得弱化 `/team execute` 的最小必填要求
- 只有需要共享任务板、直接队友通信、自主认领时才应进入 `/team`；独立分析或单次并行继续走普通 Agent / 并行分派
