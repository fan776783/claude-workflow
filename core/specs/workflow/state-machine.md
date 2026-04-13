# 工作流状态机（扩展架构说明）

> ⚠️ 本文件用于描述跨 skill / 共享架构层的扩展状态模型。
> workflow 的**运行时状态机唯一来源**是 `core/specs/workflow-runtime/state-machine.md`（shared workflow runtime 文档）。
> 若运行时字段定义与本文件冲突，以 shared runtime 状态机为准。

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
  "boundaryScheduling": {
    "enabled": true,
    "currentBoundary": null,
    "boundaryProgress": {
      "ui-domain": {
        "completed": ["T2"],
        "pending": ["T3"],
        "preferredModel": "codex"
      }
    }
  },
  "execution_mode": "phase",
  "mode": "progressive",
  "use_subagent": true,
  "pause_before_commit": true,
  "consecutive_count": 2,
  "tasks_file": "tasks-example.md",
  "tech_design": ".claude/tech-design/example.md",
  "spec_file": ".claude/specs/example.md",
  "plan_file": ".claude/plans/example.md",
  "requirement_baseline": {
    "generated": true,
    "path": ".claude/analysis/example-requirement-baseline.md",
    "json_path": "requirement-baseline.json",
    "total_requirements": 18,
    "in_scope_count": 12,
    "partial_count": 3,
    "out_of_scope_count": 2,
    "blocked_count": 1,
    "uncovered_requirements": []
  },
  "review_status": {
    "spec_review": {
      "status": "passed",
      "review_mode": "machine_loop",
      "reviewed_at": "2026-03-24T10:20:00Z",
      "reviewer": "subagent",
      "attempt": 2,
      "max_attempts": 3,
      "last_decision": "pass",
      "next_action": "generate_spec"
    },
    "traceability_review": {
      "status": "passed",
      "review_mode": "machine_loop",
      "reviewed_at": "2026-03-24T10:21:00Z",
      "reviewer": "subagent",
      "attempt": 2,
      "max_attempts": 3,
      "last_decision": "pass",
      "next_action": "generate_spec",
      "metrics": {
        "in_scope_total": 12,
        "mapped_in_design": 12,
        "mapped_critical_constraints": 9,
        "uncovered_requirement_ids": []
      }
    },
    "user_spec_review": {
      "status": "approved",
      "review_mode": "human_gate",
      "reviewed_at": "2026-03-24T10:28:00Z",
      "reviewer": "user",
      "last_decision": "pass",
      "next_action": "run_intent_check"
    },
    "intent_review": {
      "status": "passed",
      "review_mode": "conditional_human_gate",
      "reviewed_at": "2026-03-24T10:35:00Z",
      "reviewer": "system",
      "attempt": 1,
      "max_attempts": 1,
      "last_decision": "pass",
      "next_action": "generate_plan",
      "notes": ["auto-pass: stable spec + low-risk change"]
    },
    "plan_review": {
      "status": "passed",
      "review_mode": "machine_loop",
      "reviewed_at": "2026-03-24T10:42:00Z",
      "reviewer": "subagent",
      "attempt": 1,
      "max_attempts": 3,
      "last_decision": "pass",
      "next_action": "compile_tasks",
      "metrics": {
        "covered_requirement_ids": ["R-001", "R-002"],
        "uncovered_requirement_ids": [],
        "critical_constraints_covered": 9
      }
    }
  },
  "traceability": {
    "baseline_path": ".claude/analysis/example-requirement-baseline.md",
    "mappings": [],
    "coverage_summary": {
      "spec_full": 10,
      "spec_partial": 2,
      "plan_full": 9,
      "plan_partial": 3,
      "task_full": 8,
      "task_partial": 4
    }
  },
  "unblocked": [],
  "sessions": {
    "platform": "cursor",
    "executor": null,
    "reviewers": {
      "codex": null,
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
    "unresolved_dependencies": [{"type": "api_spec", "status": "not_started", "description": "等待后端接口规格冻结"}]
  },
  "contextMetrics": {
    "maxContextTokens": 1000000,
    "estimatedTokens": 45000,
    "projectedNextTurnTokens": 62000,
    "reservedExecutionTokens": 8000,
    "reservedVerificationTokens": 5000,
    "reservedReviewTokens": 0,
    "reservedSafetyBufferTokens": 4000,
    "usagePercent": 5,
    "projectedUsagePercent": 6,
    "warningThreshold": 60,
    "dangerThreshold": 80,
    "hardHandoffThreshold": 90,
    "maxConsecutiveTasks": 5,
    "history": [
      {
        "taskId": "T1",
        "phase": "feature-implementation",
        "preTaskTokens": 10000,
        "postTaskTokens": 12000,
        "tokenDelta": 2000,
        "executionPath": "direct",
        "triggeredVerification": true,
        "triggeredReview": false,
        "timestamp": "2026-03-24T11:10:00Z"
      },
      {
        "taskId": "T2",
        "phase": "feature-implementation",
        "preTaskTokens": 12000,
        "postTaskTokens": 18000,
        "tokenDelta": 6000,
        "executionPath": "parallel-boundaries",
        "triggeredVerification": true,
        "triggeredReview": false,
        "timestamp": "2026-03-24T11:20:00Z"
      }
    ]
  },
  "continuation": {
    "strategy": "context-first",
    "last_decision": {
      "action": "continue-direct",
      "reason": "mode-phase-boundary",
      "severity": "info",
      "nextTaskIds": ["T3"],
      "suggestedExecutionPath": "direct",
      "primarySignals": {
        "taskIndependence": {"level": "medium"},
        "contextPollutionRisk": {"level": "low"}
      },
      "budgetBackstopTriggered": false,
      "budgetLevel": "safe",
      "decisionNotes": []
    },
    "handoff_required": false,
    "artifact_path": null
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
| `boundaryScheduling` | 上下文边界调度状态（由 dispatching-parallel-agents skill 维护） |
| `tech_design` | 技术设计文档路径 |
| `delta_tracking.current_change` | 当前活动变更的 changeId；归档后清空 |
| `spec_file` | Spec 文档路径 |
| `plan_file` | Plan 文档路径 |
| `tasks_file` | 运行时任务清单路径 |
| `requirement_baseline` | Requirement Baseline 路径与统计信息 |
| `traceability` | 跨文档追溯映射与覆盖率统计 |
| `review_status.spec_review` | Phase 1.2 结构审查状态（MachineReviewLoop） |
| `review_status.traceability_review` | Phase 1.2 追溯审查状态（MachineReviewLoop） |
| `review_status.user_spec_review` | Phase 1.4 用户 Spec 治理关口状态（HumanGovernanceGate） |
| `review_status.intent_review` | Phase 1.5 Intent 条件化关口状态（ConditionalHumanGate） |
| `review_status.plan_review` | Phase 2.5 Plan 审查状态（MachineReviewLoop，含 role/profile/signal snapshot） |
| `context_injection` | 运行时角色注入信号、profile 选择与工件路径 |
| `unblocked` | 已解除的依赖列表 |
| `sessions` | 平台与会话槽位信息 |
| `progress.blocked` | 当前被阻塞的任务 ID 列表 |
| `contextMetrics` | 上下文预算指标，供 ContextGovernor 评估 continue / pause / handoff |
| `continuation` | continuation governance 状态，记录 context-first 决策信号、budget backstop 与 handoff 信息 |
| `collaboration` | 多模型协作配置 |
| `constraints` | 约束系统 |
| `zeroDecisionAudit` | 零决策审计结果 |
| `delta_tracking` | 增量变更追踪系统 |
| `task_runtime` | Per-task 运行时状态（v3.5.0），键为任务 ID |
| `quality_gates` | 质量关卡审查结果（v3.5.0），键为关卡任务 ID |

## 审查状态接口

```typescript
interface SpecReviewMetrics {
  completeness: number;
  traceabilityCompleteness: number;
  criticalConstraintPreservation: number;
  scopeDecisionExplicitness: number;
}

interface TraceabilityReviewMetrics {
  in_scope_total: number;
  mapped_in_design: number;
  mapped_critical_constraints: number;
  uncovered_requirement_ids: string[];
}

interface PlanReviewMetrics {
  covered_requirement_ids: string[];
  uncovered_requirement_ids: string[];
  critical_constraints_covered: number;
}

type ReviewDecision = 'pass' | 'revise' | 'split' | 'rejected';
type ReviewMode = 'machine_loop' | 'human_gate' | 'conditional_human_gate';

interface ReviewCheckpointBase<TMetrics = Record<string, any>> {
  status: 'pending' | 'passed' | 'approved' | 'revise_required' | 'rejected';
  review_mode?: ReviewMode;
  reviewed_at?: string;
  reviewer?: 'user' | 'subagent' | 'system';
  attempt?: number;
  max_attempts?: number;
  last_decision?: ReviewDecision;
  next_action?: string;
  blocking_issues?: string[];
  notes?: string[];
  metrics?: TMetrics;
}

interface ReviewStatus {
  spec_review: ReviewCheckpointBase<SpecReviewMetrics>;
  traceability_review: ReviewCheckpointBase<TraceabilityReviewMetrics>;
  user_spec_review: ReviewCheckpointBase;
  intent_review: ReviewCheckpointBase;
  plan_review: ReviewCheckpointBase<PlanReviewMetrics>;
}
```

## Traceability 接口定义

```typescript
interface RequirementBaselineStatus {
  generated: boolean;
  path?: string;
  json_path?: string;
  total_requirements: number;
  in_scope_count: number;
  partial_count: number;
  out_of_scope_count: number;
  blocked_count: number;
  uncovered_requirements: string[];
}

interface TraceabilityMapping {
  requirement_id: string;
  acceptance_ids?: string[];
  spec_refs?: string[];
  tech_design_refs?: string[];
  plan_step_ids?: string[];
  task_ids?: string[];
  coverage_level: 'full' | 'partial' | 'none';
  scope_status: 'in_scope' | 'partially_in_scope' | 'out_of_scope' | 'blocked';
  notes?: string;
}

interface TraceabilityState {
  baseline_path?: string;
  mappings: TraceabilityMapping[];
  coverage_summary: {
    spec_full: number;
    spec_partial: number;
    plan_full: number;
    plan_partial: number;
    task_full: number;
    task_partial: number;
  };
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
  review_type?: string;
  review_mode?: 'machine_loop';
  gate_task_id: string;
  subject?: ReviewSubject;
  attempt?: number;
  max_attempts?: number;
  last_decision?: ReviewDecision;
  next_action?: string;
  reviewed_at?: string;
  reviewer?: 'subagent' | 'system';
  blocking_issues?: string[];
  commit_hash: string;
  diff_window: {
    from_task: string | null;
    to_task: string;
    files_changed: number;
  };
  protected_requirement_ids?: string[];
  protected_constraints?: string[];
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
  requirement_ids?: string[];
  critical_constraints?: string[];
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
    requirement_ids?: string[];
    critical_constraints?: string[];
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
- `requirement_ids` 指向 Requirement Baseline 的 requirement items
- `critical_constraints` 用于保护容易在执行期被弱化的非协商约束
- `acceptance_criteria` 持续映射到 Phase 0.6 Brief 验收项

## 术语基础类型

```typescript
type ExecutionPlatform = 'cursor' | 'claude-code' | 'codex' | 'other';
type ModelProvider = 'codex' | 'claude' | 'user';
```

**约定**：
- `ExecutionPlatform` 表示当前运行环境或子 agent 路由目标
- `ModelProvider` 表示参与分析、审查、约束提炼的模型来源
- 平台与模型必须分层建模，禁止混用

## 状态转换

```
idle → planned (workflow-start 完成基础规划)
planned → planned (Phase 1.2 machine loop revise，返回 tech-design 修订并重审)
planned → planned (Phase 1.2 machine loop split，升级为人工范围拆分)
planned → spec_review (spec 文档生成，等待用户治理确认)
spec_review → planned (spec 已批准，继续 intent check / plan / task 编译)
spec_review → spec_review (用户要求修改 Spec 或拆分范围)
planned → intent_review (IntentConsistencyCheck 命中条件，需要人工 Intent Gate)
planned → planned (IntentConsistencyCheck auto-pass，无需人工确认，继续 Plan Generation)
intent_review → planned (intent 人工关口批准)
intent_review → paused (intent 人工关口要求调整，待修改 spec / intent 后重新启动)
planned → planned (Phase 2.5 machine loop revise，返回 plan 修订并重审)
planned → running (workflow-execute 开始执行)
planned → idle (用户取消)
spec_review → idle (用户拒绝并终止)
intent_review → idle (intent 人工关口拒绝或取消)
running → paused (阶段完成 / 质量关卡)
running → blocked (遇到阻塞任务且无可执行任务)
running → failed (任务失败)
running → completed (所有任务完成)
paused → running (resume)
blocked → running (unblock)
failed → running (retry)
failed → running (skip → 下一任务)
completed → archived (/workflow-archive 执行)
```

## 任务依赖自动分类规则

```typescript
function classifyTaskDependencies(
  task: {
    name: string;
    files?: {
      create?: string[];
      modify?: string[];
      test?: string[];
    };
    requirement_ids?: string[];
  },
  discussionArtifact?: DiscussionArtifact
): string[] {
  const deps: string[] = [];
  const name = task.name.toLowerCase();
  const file = [
    ...(task.files?.create || []),
    ...(task.files?.modify || []),
    ...(task.files?.test || [])
  ].join(' ').toLowerCase();

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
| phase | `--phase` | 治理 phase 边界变化时 |
| quality_gate | `连续` / `执行到质量关卡` | 质量关卡后；若下一步是 `git_commit` 且 `pause_before_commit=true`，则提交前也会暂停 |

## Subagent 模式

自动检测：任务数 > 5 时启用

执行阶段若启用**同阶段独立任务并行批次**，必须先读取并应用 `../../skills/dispatching-parallel-agents/SKILL.md`。

手动控制：
- `--subagent` 强制启用
- `--no-subagent` 强制禁用

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
