# 工作流状态机 (v4.0)

## 状态定义

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `planned` | 规划完成，等待用户审查后执行 |
| `spec_review` | Spec 已生成，等待用户确认范围 |
| `intent_review` | Intent 文档已生成，等待审查 |
| `running` | 工作流执行中 |
| `paused` | 暂停等待用户操作 |
| `blocked` | 等待外部依赖（接口/第三方能力） |
| `failed` | 任务失败，需要处理 |
| `completed` | 所有任务完成 |
| `archived` | 工作流已归档 |

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
| `api_spec` | 后端接口规格 | `/workflow unblock api_spec` |
| `external` | 第三方服务/SDK | `/workflow unblock external` |

> `design_spec` 已移除，设计稿依赖通过 `/figma-ui` 工作流处理。

## 状态文件结构

`workflow-state.json` 位于 `~/.claude/workflows/{project-id}/`

```json
{
  "project_id": "abc123",
  "project_name": "my-project",
  "status": "running",
  "current_tasks": ["T3"],
  "parallel_groups": [],
  "execution_mode": "phase",
  "mode": "progressive",
  "use_subagent": true,
  "pause_before_commit": true,
  "consecutive_count": 2,
  "tasks_file": "tasks-example.md",
  "tech_design": ".claude/tech-design/example.md",
  "spec_file": ".claude/specs/example.md",
  "plan_file": ".claude/plans/example.md",
  "review_status": {
    "spec_review": {
      "status": "passed",
      "reviewed_at": "2026-03-24T10:20:00Z",
      "reviewer": "subagent"
    },
    "user_spec_review": {
      "status": "approved",
      "reviewed_at": "2026-03-24T10:28:00Z",
      "reviewer": "user"
    },
    "intent_review": {
      "status": "approved",
      "reviewed_at": "2026-03-24T10:35:00Z",
      "reviewer": "user"
    },
    "plan_review": {
      "status": "passed",
      "reviewed_at": "2026-03-24T10:42:00Z",
      "reviewer": "subagent"
    }
  },
  "unblocked": [],
  "sessions": {
    "platform": "cursor",
    "executor": null,
    "reviewers": {
      "codex": null,
      "gemini": null,
      "claude": null
    }
  },
  "progress": {
    "completed": ["T1", "T2"],
    "blocked": ["T5"],
    "failed": [],
    "skipped": []
  },
  "discussion": {
    "completed": true,
    "artifact_path": "discussion-artifact.json",
    "clarification_count": 5,
    "approach_selected": true,
    "unresolved_dependencies": ["api_spec"]
  },
  "contextMetrics": {
    "estimatedTokens": 45000,
    "warningThreshold": 60,
    "dangerThreshold": 80,
    "maxConsecutiveTasks": 5,
    "history": [
      { "taskId": "T1", "tokens": 12000, "timestamp": "2026-03-24T11:10:00Z" },
      { "taskId": "T2", "tokens": 18000, "timestamp": "2026-03-24T11:20:00Z" }
    ]
  },
  "collaboration": {
    "schemaVersion": "2.1",
    "mode": "dual",
    "lead": "claude",
    "support": ["codex"],
    "parallelPhases": ["analysis", "review"],
    "reason": "frontend task on Cursor with secondary code review",
    "confidence": 0.85
  },
  "constraints": {
    "hard": [],
    "soft": [],
    "openQuestions": [],
    "successCriteria": []
  },
  "zeroDecisionAudit": {
    "passed": true,
    "antiPatterns": [],
    "remainingAmbiguities": [],
    "auditedAt": "2026-03-24T10:25:00Z"
  },
  "created_at": "2026-03-24T10:00:00Z",
  "updated_at": "2026-03-24T10:30:00Z",
  "failure_reason": null,
  "delta_tracking": {
    "enabled": true,
    "changes_dir": "changes/",
    "current_change": "CHG-001",
    "applied_changes": ["CHG-001"],
    "change_counter": 1
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `mode` | 工作流模式：`normal` / `progressive` |
| `current_tasks` | 当前执行中的任务 ID 数组；顺序执行时仅包含 1 个任务 ID |
| `parallel_groups` | 并行执行批次历史记录 |
| `tech_design` | 技术设计文档路径 |
| `delta_tracking.current_change` | 当前活动变更的 changeId；归档后清空 |
| `spec_file` | Spec 文档路径 |
| `plan_file` | Plan 文档路径 |
| `tasks_file` | 运行时任务清单路径 |
| `review_status.spec_review` | Phase 1.2 审查状态 |
| `review_status.user_spec_review` | Phase 1.4 用户 Spec 审查状态 |
| `review_status.intent_review` | Phase 1.5 Intent 审查状态 |
| `review_status.plan_review` | Phase 2.5 Plan 审查状态 |
| `unblocked` | 已解除的依赖列表 |
| `sessions` | 平台与会话槽位信息 |
| `progress.blocked` | 当前被阻塞的任务 ID 列表 |
| `contextMetrics` | 上下文感知指标，用于动态调整执行策略 |
| `collaboration` | 多模型协作配置 |
| `constraints` | 约束系统 |
| `zeroDecisionAudit` | 零决策审计结果 |
| `delta_tracking` | 增量变更追踪系统 |
| `task_runtime` | Per-task 运行时状态（v3.5.0），键为任务 ID |
| `quality_gates` | 质量关卡审查结果（v3.5.0），键为关卡任务 ID |

## 审查状态接口

```typescript
interface ReviewCheckpoint {
  status: 'pending' | 'passed' | 'approved' | 'revise_required' | 'rejected';
  reviewed_at?: string;
  reviewer?: 'user' | 'subagent' | 'system';
  notes?: string[];
}

interface ReviewStatus {
  spec_review: ReviewCheckpoint;
  user_spec_review: ReviewCheckpoint;
  intent_review: ReviewCheckpoint;
  plan_review: ReviewCheckpoint;
}
```

## 执行纪律接口定义（v3.5.0）

### TaskRuntime

```typescript
interface TaskRuntime {
  retry_count: number;
  last_failure_stage: 'execution' | 'verification' | 'self_review' | 'spec_compliance' | 'review_stage1' | 'review_stage2';
  last_failure_reason: string;
  hard_stop_triggered: boolean;
  debugging_phases_completed: ('investigation' | 'pattern' | 'hypothesis' | 'implementation')[];
}
```

**重置规则**：
- `retry_count`：任务转为 `completed` 时重置为 0
- `debugging_phases_completed`：成功后清空
- `hard_stop_triggered`：需用户确认后才能重置

### QualityGateResult

```typescript
interface QualityGateResult {
  gate_task_id: string;
  commit_hash: string;
  diff_window: {
    from_task: string | null;
    to_task: string;
    files_changed: number;
  };
  stage1: {
    passed: boolean;
    attempts: number;
    issues_found: number;
    completed_at: string;
  };
  stage2?: {
    passed: boolean;
    attempts: number;
    assessment: 'approved' | 'needs_fixes' | 'rejected';
    critical_count: number;
    important_count: number;
    minor_count: number;
    completed_at: string;
  };
  overall_passed: boolean;
}
```

## WorkflowTaskV2

### 接口定义

```typescript
interface WorkflowTaskV2 {
  id: string;
  name: string;
  phase: string;
  files: {
    create?: string[];
    modify?: string[];
    test?: string[];
  };
  leverage?: string[];
  spec_ref: string;
  plan_ref: string;
  acceptance_criteria?: string[];
  depends?: string[];
  blocked_by?: string[];
  quality_gate?: boolean;
  status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  actions: Array<'create_file' | 'edit_file' | 'run_tests' | 'quality_review' | 'git_commit'>;
  steps: Array<{
    id: string;
    description: string;
    expected: string;
    verification?: string;
  }>;
  verification?: {
    commands?: string[];
    expected_output?: string[];
    notes?: string[];
  };
}
```

### 模型原则

- 任务模型仅保留 V2 字段，不再维护旧任务格式的镜像字段
- 执行链路直接消费 `files{}`、`steps[]`、`verification`
- `spec_ref` 指向 `spec.md` 的章节
- `plan_ref` 指向 `plan.md` 的步骤或任务段落
- `acceptance_criteria` 持续映射到 Phase 0.6 验收项

## 术语基础类型

```typescript
type ExecutionPlatform = 'cursor' | 'claude-code' | 'codex' | 'other';
type ModelProvider = 'codex' | 'gemini' | 'claude' | 'user';
```

**约定**：
- `ExecutionPlatform` 表示当前运行环境或子 agent 路由目标
- `ModelProvider` 表示参与分析、审查、约束提炼的模型来源
- 平台与模型必须分层建模，禁止混用

## 状态转换

```
idle → planned (workflow-start 完成基础规划)
planned → spec_review (spec 文档生成，等待用户确认)
spec_review → planned (spec 已批准，继续 intent / plan / task 编译)
planned → intent_review (intent 文档生成)
intent_review → planned (intent 批准)
planned → running (workflow-execute 开始执行)
planned → idle (用户取消)
spec_review → idle (用户拒绝并终止)
intent_review → idle (intent 拒绝)
running → paused (阶段完成 / 质量关卡)
running → blocked (遇到阻塞任务且无可执行任务)
running → failed (任务失败)
running → completed (所有任务完成)
paused → running (resume)
blocked → running (unblock)
failed → running (retry)
failed → running (skip → 下一任务)
completed → archived (/workflow archive 执行)
```

## 任务依赖自动分类规则

```typescript
function classifyTaskDependencies(
  task: { name: string; files?: string[] },
  discussionArtifact?: DiscussionArtifact
): string[] {
  const deps: string[] = [];
  const name = task.name.toLowerCase();
  const file = (task.files || []).join(' ').toLowerCase();

  if (/api|接口|服务层|service|fetch|request|http/.test(name) ||
      /services\/|api\/|http\//.test(file)) {
    deps.push('api_spec');
  }

  if (discussionArtifact?.unresolvedDependencies) {
    for (const dep of discussionArtifact.unresolvedDependencies) {
      if (dep.status === 'not_started' && !deps.includes(dep.type)) {
        deps.push(dep.type);
      }
    }
  } else {
    if (/第三方|sdk|外部服务|third.party|payment|sms|oauth|oss/.test(name)) {
      if (!deps.includes('external')) {
        deps.push('external');
      }
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

自动检测：
- Claude Code / Cursor：优先启用 `Task` 子 agent
- Codex：检测到多 agent 能力时启用 `spawn_agent`
- 任务数 > 5 或上下文压力过高时默认建议启用

手动控制：
- `--subagent` 强制启用
- `--no-subagent` 强制禁用

### 并行执行支持

Subagent 模式下，同阶段且通过独立性检查的任务可并行执行。

```typescript
interface ParallelGroup {
  id: string;
  task_ids: string[];
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  conflict_detected: boolean;
}
```

**状态同步规则**：
- `current_tasks` 在并行分派时更新为所有并行任务 ID
- 顺序执行时，`current_tasks` 仅保留当前任务 ID
- 并行任务全部完成后，`current_tasks` 更新为下一批任务或清空

## Delta Tracking 系统 (v3.0)

### 接口定义

```typescript
interface DeltaTracking {
  enabled: boolean;
  changes_dir: string;
  current_change: string | null;
  applied_changes: string[];
  change_counter: number;
}

interface DeltaSpec {
  id: string;
  parent_change: string | null;
  created_at: string;
  status: 'draft' | 'reviewed' | 'applied' | 'archived';
  trigger: {
    type: 'new_requirement' | 'bug_fix' | 'design_change' | 'review_feedback';
    description: string;
    source: string;
  };
  spec_deltas: Array<{
    operation: 'ADDED' | 'MODIFIED' | 'REMOVED';
    section: string;
    before: string | null;
    after: string | null;
    rationale: string;
  }>;
  task_deltas: Array<{
    operation: 'ADDED' | 'MODIFIED' | 'REMOVED';
    task_id: string;
    field_changes?: Record<string, { before: any; after: any }>;
    full_task?: object;
    rationale: string;
  }>;
}
```

### 目录结构

```
~/.claude/workflows/{projectId}/
├── workflow-state.json
├── tasks-{name}.md
├── changes/
│   └── CHG-001/
│       ├── delta.json
│       ├── intent.md
│       └── review-status.json
└── archive/
    └── CHG-001/
```
