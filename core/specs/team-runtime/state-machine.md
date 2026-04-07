# Team Runtime 状态机

## 状态文件

```text
~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json
```

## 关联团队任务板

```text
~/.claude/workflows/{projectId}/teams/{teamId}/team-task-board.json
```

## 推荐 schema

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
  "worker_roster": [],
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

## 约束

- team state 复用 workflow 顶层字段，如 `project_id`、`status`、`current_tasks`、`plan_file`、`spec_file`、`progress`、`quality_gates`、`continuation`
- team 扩展字段至少包括：`team_id`、`team_name`、`team_phase`、`team_tasks_file`、`worker_roster`、`dispatch_batches`、`team_review`、`fix_loop`
- team runtime 的脚本实现收敛于 `core/utils/team/*.js`
- `team_phase` 与 `/workflow` 的普通执行状态必须区分，避免把 `parallel-boundaries` 误判成 team lifecycle
