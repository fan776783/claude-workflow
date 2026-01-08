# 工作流状态机

## 状态定义

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `running` | 工作流执行中 |
| `paused` | 暂停等待用户操作 |
| `failed` | 任务失败，需要处理 |
| `completed` | 所有任务完成 |

## 状态文件结构

`workflow-state.json` 位于 `~/.claude/workflows/{project-id}/`

```json
{
  "project_id": "abc123",
  "project_name": "my-project",
  "status": "running",
  "current_task": "T3",
  "execution_mode": "phase",
  "use_subagent": true,
  "pause_before_commit": true,
  "consecutive_count": 2,
  "tasks_file": "tasks.md",
  "tech_design": ".claude/docs/tech-design.md",
  "progress": {
    "completed": ["T1", "T2"],
    "failed": [],
    "skipped": []
  },
  "created_at": "2026-01-08T10:00:00Z",
  "updated_at": "2026-01-08T10:30:00Z",
  "failure_reason": null
}
```

## 状态转换

```
idle → running (start)
running → paused (阶段完成 / 质量关卡)
running → failed (任务失败)
running → completed (所有任务完成)
paused → running (resume)
failed → running (retry)
failed → running (skip → 下一任务)
```

## 执行模式

| 模式 | 参数 | 中断点 |
|------|------|--------|
| step | `--step` | 每个任务后 |
| phase | `--phase` | 阶段变化时 |
| quality_gate | `--all` | 质量关卡 / git_commit |

## Subagent 模式

自动检测：任务数 > 5 时启用

手动控制：
- `--subagent` 强制启用
- `--no-subagent` 强制禁用
