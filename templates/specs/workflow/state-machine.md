# 工作流状态机

## 状态定义

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `planned` | 规划完成，等待用户审查后执行 |
| `running` | 工作流执行中 |
| `paused` | 暂停等待用户操作 |
| `blocked` | 等待外部依赖（接口/设计稿） |
| `failed` | 任务失败，需要处理 |
| `completed` | 所有任务完成 |

## 任务状态定义

| 任务状态 | 说明 |
|---------|------|
| `pending` | 待执行 |
| `blocked` | 被阻塞，等待依赖解除 |
| `in_progress` | 执行中 |
| `completed` | 已完成 |
| `skipped` | 已跳过 |
| `failed` | 失败 |

## 依赖类型定义

| 依赖标识 | 说明 | 解除条件 |
|---------|------|---------|
| `api_spec` | 后端接口规格 | `/workflow-unblock api_spec` |
| `design_spec` | 设计稿/UI 规格 | `/workflow-unblock design_spec` |

## 状态文件结构

`workflow-state.json` 位于 `~/.claude/workflows/{project-id}/`

```json
{
  "project_id": "abc123",
  "project_name": "my-project",
  "status": "running",
  "current_task": "T3",
  "execution_mode": "phase",
  "mode": "progressive",
  "use_subagent": true,
  "pause_before_commit": true,
  "consecutive_count": 2,
  "tasks_file": "tasks.md",
  "tech_design": ".claude/docs/tech-design.md",
  "unblocked": [],
  "sessions": {
    "codex": null,
    "gemini": null,
    "claude": null
  },
  "progress": {
    "completed": ["T1", "T2"],
    "blocked": ["T5", "T6"],
    "failed": [],
    "skipped": []
  },
  "contextMetrics": {
    "estimatedTokens": 45000,
    "warningThreshold": 60,
    "dangerThreshold": 80,
    "maxConsecutiveTasks": 5,
    "history": [
      { "taskId": "T1", "tokens": 12000, "timestamp": "2026-01-08T10:10:00Z" },
      { "taskId": "T2", "tokens": 18000, "timestamp": "2026-01-08T10:20:00Z" }
    ]
  },
  "collaboration": {
    "schemaVersion": "2.1",
    "mode": "dual",
    "lead": "codex",
    "support": ["claude"],
    "parallelPhases": ["analysis", "review"],
    "reason": "complex backend task",
    "confidence": 0.85
  },
  "created_at": "2026-01-08T10:00:00Z",
  "updated_at": "2026-01-08T10:30:00Z",
  "failure_reason": null
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `mode` | 工作流模式：`normal`（默认）/ `progressive`（渐进式） |
| `unblocked` | 已解除的依赖列表，如 `["api_spec"]` |
| `sessions` | 多模型会话 ID，用于跨阶段复用上下文 |
| `progress.blocked` | 当前被阻塞的任务 ID 列表 |
| `contextMetrics` | 上下文感知指标，用于动态调整执行策略 |
| `contextMetrics.estimatedTokens` | 当前估算的上下文 token 数（字符数/4） |
| `contextMetrics.warningThreshold` | 警告阈值百分比（默认 60%） |
| `contextMetrics.dangerThreshold` | 危险阈值百分比（默认 80%） |
| `contextMetrics.maxConsecutiveTasks` | 动态计算的连续任务上限 |
| `contextMetrics.history` | 每次任务执行后的 token 变化记录 |
| `collaboration` | 多模型协作配置（v2.1） |
| `collaboration.mode` | 协作模式：none/single/dual/triple |
| `collaboration.lead` | 主导模型：codex/gemini/claude |
| `collaboration.support` | 辅助模型列表 |
| `collaboration.parallelPhases` | 并行执行的阶段：analysis/prototype/review |
| `collaboration.confidence` | 路由置信度 0-1 |

## 状态转换

```
idle → planned (workflow-start 完成规划)
planned → running (workflow-execute 开始执行)
planned → idle (用户取消)
running → paused (阶段完成 / 质量关卡)
running → blocked (遇到阻塞任务且无可执行任务)
running → failed (任务失败)
running → completed (所有任务完成)
paused → running (resume)
blocked → running (unblock)
failed → running (retry)
failed → running (skip → 下一任务)
```

## 任务依赖自动分类规则

```typescript
function classifyTaskDependencies(task: Task): string[] {
  const deps: string[] = [];
  const name = task.name.toLowerCase();
  const file = (task.file || '').toLowerCase();

  // 需要后端接口的任务
  if (/api|接口|服务层|service|fetch|request|http/.test(name) ||
      /services\/|api\/|http\//.test(file)) {
    deps.push('api_spec');
  }

  // 需要设计稿的任务
  if (/ui|样式|组件|还原|视觉|布局|卡片|弹窗|表单/.test(name) ||
      /\.vue$|\.tsx$|\.jsx$|\.css$|\.scss$/.test(file) ||
      /components\/|pages\/|views\//.test(file)) {
    // 排除骨架类任务
    if (!/骨架|skeleton|mock|stub/.test(name)) {
      deps.push('design_spec');
    }
  }

  return deps;
}
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
