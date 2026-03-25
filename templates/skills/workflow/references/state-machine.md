# 工作流状态机 (v3.0)

## 状态定义

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `planned` | 规划完成，等待用户审查后执行 |
| `intent_review` | Intent 文档已生成，等待审查 |
| `running` | 工作流执行中 |
| `paused` | 暂停等待用户操作 |
| `blocked` | 等待外部依赖（接口/设计稿） |
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
  "current_task": "T3",
  "current_tasks": ["T3"],
  "parallel_groups": [],
  "execution_mode": "phase",
  "mode": "progressive",
  "use_subagent": true,
  "pause_before_commit": true,
  "consecutive_count": 2,
  "tasks_file": "tasks.md",
  "tech_design": ".claude/tech-design/task-name.md",
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
    "blocked": ["T5", "T6"],
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
      { "taskId": "T1", "tokens": 12000, "timestamp": "2026-01-08T10:10:00Z" },
      { "taskId": "T2", "tokens": 18000, "timestamp": "2026-01-08T10:20:00Z" }
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
    "hard": [
      {
        "id": "C001",
        "description": "API 响应必须包含 requestId",
        "type": "hard",
        "category": "interface",
        "sourceModel": "codex",
        "phase": "analysis",
        "verified": true
      }
    ],
    "soft": [
      {
        "id": "C002",
        "description": "建议使用 zod 进行输入验证",
        "type": "soft",
        "category": "data",
        "sourceModel": "claude",
        "phase": "analysis",
        "verified": false
      }
    ],
    "openQuestions": [],
    "successCriteria": [
      "所有 API 端点返回标准格式",
      "类型检查通过",
      "测试覆盖率 > 80%"
    ]
  },
  "zeroDecisionAudit": {
    "passed": true,
    "antiPatterns": [],
    "remainingAmbiguities": [],
    "auditedAt": "2026-01-08T10:25:00Z"
  },
  "created_at": "2026-01-08T10:00:00Z",
  "updated_at": "2026-01-08T10:30:00Z",
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
| `mode` | 工作流模式：`normal`（默认）/ `progressive`（渐进式） |
| `current_tasks` | 当前执行中的任务 ID 数组（并行执行时包含多个）|
| `current_task` | 向后兼容别名，等于 `current_tasks[0]` |
| `parallel_groups` | 并行执行批次历史记录 |
| `unblocked` | 已解除的依赖列表，如 `["api_spec"]` |
| `sessions` | 平台与会话槽位信息；`platform: ExecutionPlatform` 表示当前执行平台，`executor/reviewers` 用于跨阶段复用会话 |
| `progress.blocked` | 当前被阻塞的任务 ID 列表 |
| `contextMetrics` | 上下文感知指标，用于动态调整执行策略 |
| `contextMetrics.estimatedTokens` | 当前估算的上下文 token 数（字符数/4） |
| `contextMetrics.warningThreshold` | 警告阈值百分比（默认 60%） |
| `contextMetrics.dangerThreshold` | 危险阈值百分比（默认 80%） |
| `contextMetrics.maxConsecutiveTasks` | 动态计算的连续任务上限 |
| `contextMetrics.history` | 每次任务执行后的 token 变化记录 |
| `collaboration` | 多模型协作配置（v2.1） |
| `collaboration.mode` | 协作模式：none/single/dual/triple |
| `collaboration.lead` | 主导模型：`ModelProvider`（当前约定为 codex/gemini/claude，不含平台名） |
| `collaboration.support` | 辅助模型列表（`ModelProvider[]`，仅模型名，不含平台名） |
| `collaboration.parallelPhases` | 并行执行的阶段：analysis/prototype/review |
| `collaboration.confidence` | 路由置信度 0-1 |
| `constraints` | 约束系统（v2.1） |
| `constraints.hard` | 硬约束列表（必须满足） |
| `constraints.soft` | 软约束列表（建议满足） |
| `constraints.openQuestions` | 待澄清问题 |
| `constraints.successCriteria` | 成功标准 |
| `zeroDecisionAudit` | 零决策审计结果 |
| `delta_tracking` | 增量变更追踪系统（v3.0） |
| `delta_tracking.enabled` | 是否启用增量追踪 |
| `delta_tracking.changes_dir` | 变更目录路径 "changes/" |
| `delta_tracking.current_change` | 当前变更 ID，如 "CHG-001" |
| `delta_tracking.applied_changes` | 已应用的变更 ID 列表 |
| `delta_tracking.change_counter` | 变更 ID 计数器 |
| `task_runtime` | Per-task 运行时状态（v3.5.0），键为任务 ID |
| `task_runtime[id].retry_count` | 当前任务连续重试次数，成功后重置为 0 |
| `task_runtime[id].last_failure_stage` | 最后一次失败的阶段 |
| `task_runtime[id].last_failure_reason` | 最后一次失败的原因 |
| `task_runtime[id].hard_stop_triggered` | 是否触发了 Hard Stop（retry_count ≥ 3） |
| `task_runtime[id].debugging_phases_completed` | 已完成的调试阶段 |
| `quality_gates` | 质量关卡审查结果（v3.5.0），键为关卡任务 ID |

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
  commit_hash: string;             // 关卡通过时的 HEAD commit hash
  diff_window: {
    from_task: string | null;      // null = 工作流起点
    to_task: string;
    files_changed: number;
  };
  stage1: {
    passed: boolean;
    attempts: number;
    issues_found: number;
    completed_at: string;          // ISO 8601
  };
  stage2?: {                       // Stage 1 未通过时可缺省
    passed: boolean;
    attempts: number;
    assessment: 'approved' | 'needs_fixes' | 'rejected';
    critical_count: number;
    important_count: number;
    minor_count: number;
    completed_at: string;          // ISO 8601
  };
  overall_passed: boolean;
}
```

**失败态约定**：
- Stage 1 失败时，`stage2` 缺省（由 `markGateFailed` 不填充该字段）
- Stage 2 失败时，`stage2` 填充实际审查结果（`assessment: 'rejected'` 或 `'needs_fixes'`）
- 消费方（如 `status.md` 模板）须用 `{{#if stage2}}` 条件渲染

## 术语基础类型

```typescript
type ExecutionPlatform = 'cursor' | 'claude-code' | 'codex' | 'other';
type ModelProvider = 'codex' | 'gemini' | 'claude' | 'user';
```

**约定**：
- `ExecutionPlatform` 表示当前运行环境或子 agent 路由目标
- `ModelProvider` 表示参与分析、审查、约束提炼的模型来源
- 平台与模型必须分层建模，禁止混用

## 约束系统（v2.1）

### Constraint 接口定义

```typescript
interface Constraint {
  id: string;                    // 唯一标识 C001, C002...
  description: string;           // 约束描述
  type: 'hard' | 'soft';         // 硬约束必须满足，软约束建议满足
  category: 'requirement' | 'interface' | 'data' | 'error' | 'security' | 'performance';
  sourceModel: ModelProvider;    // 来源追踪（模型级，不含执行平台）
  phase: 'analysis' | 'review';  // 产生阶段
  verified?: boolean;            // 是否已验证
  verifyCmd?: string;            // 验证命令（可选）
}

interface ConstraintSet {
  hard: Constraint[];            // 硬约束（最多 7 个）
  soft: Constraint[];            // 软约束（最多 7 个）
  openQuestions: string[];       // 待澄清问题（最多 5 个）
  successCriteria: string[];     // 成功标准（最多 7 个）
}
```

### 约束合并语义

并行模型输出约束时，按以下规则合并：

```typescript
function mergeConstraints(sets: ConstraintSet[]): ConstraintSet {
  return {
    // 硬约束：取并集（所有模型的硬约束都必须满足）
    hard: deduplicateById(sets.flatMap(s => s.hard)).slice(0, 7),

    // 软约束：取并集，按出现频率排序
    soft: rankByFrequency(sets.flatMap(s => s.soft)).slice(0, 7),

    // 待澄清问题：取并集，保留来源
    openQuestions: deduplicate(sets.flatMap(s => s.openQuestions)).slice(0, 5),

    // 成功标准：取交集（所有模型都认可的标准）
    successCriteria: intersection(sets.map(s => s.successCriteria)).slice(0, 7)
  };
}
```

### 约束验证

```typescript
interface ConstraintVerification {
  constraintId: string;
  passed: boolean;
  details: string;
  checkedAt: string;
}

// 内置验证器
const BUILTIN_VERIFIERS = {
  'ts_typecheck': 'pnpm tsc --noEmit',
  'lint': 'pnpm lint',
  'test': 'pnpm test',
  'build': 'pnpm build'
};
```

## 状态转换

```
idle → planned (workflow-start 完成规划)
planned → intent_review (intent 文档生成)
planned → running (workflow-execute 开始执行)
planned → idle (用户取消)
intent_review → planned (intent 批准，继续任务生成)
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
  task: Task,
  discussionArtifact?: DiscussionArtifact
): string[] {
  const deps: string[] = [];
  const name = task.name.toLowerCase();
  const file = (task.file || '').toLowerCase();

  // 需要后端接口的任务
  if (/api|接口|服务层|service|fetch|request|http/.test(name) ||
      /services\/|api\/|http\//.test(file)) {
    deps.push('api_spec');
  }

  // 从 Phase 0.2 讨论工件中映射未就绪依赖
  if (discussionArtifact?.unresolvedDependencies) {
    for (const dep of discussionArtifact.unresolvedDependencies) {
      if (dep.status === 'not_started' && !deps.includes(dep.type)) {
        deps.push(dep.type);
      }
    }
  } else {
    // 回退：Phase 0.2 被跳过时，正则检测 external 依赖
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

**parallel_groups 结构**：

```typescript
interface ParallelGroup {
  id: string;                    // "PG-001"
  task_ids: string[];            // ["T3", "T4", "T5"]
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  conflict_detected: boolean;    // 冲突检测结果
}
```

**状态同步规则**：
- `current_tasks` 在并行分派时更新为所有并行任务 ID
- `current_task` 始终等于 `current_tasks[0]`（向后兼容）
- 并行任务全部完成后，`current_tasks` 更新为下一批任务或清空

## Delta Tracking 系统 (v3.0)

### 接口定义

```typescript
interface DeltaTracking {
  enabled: boolean;              // 是否启用增量追踪
  changes_dir: string;           // 变更目录 "changes/"
  current_change: string | null; // 当前变更 ID "CHG-001"
  applied_changes: string[];     // 已应用的变更列表
  change_counter: number;        // 变更 ID 计数器
}

interface DeltaSpec {
  id: string;                    // "CHG-001"
  parent_change: string | null;  // 父变更 ID
  created_at: string;
  status: "draft" | "reviewed" | "applied" | "archived";

  trigger: {
    type: "new_requirement" | "bug_fix" | "design_change" | "review_feedback";
    description: string;
    source: string;
  };

  spec_deltas: Array<{
    operation: "ADDED" | "MODIFIED" | "REMOVED";
    section: string;             // "3.2 Data Model"
    before: string | null;
    after: string | null;
    rationale: string;
  }>;

  task_deltas: Array<{
    operation: "ADDED" | "MODIFIED" | "REMOVED";
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
├── changes/                    ← 增量变更目录
│   └── CHG-001/
│       ├── delta.json          # 结构化变更描述
│       ├── intent.md           # 意图文档
│       └── review-status.json  # 审查状态
└── archive/                    ← 归档目录
    └── CHG-001/
```
