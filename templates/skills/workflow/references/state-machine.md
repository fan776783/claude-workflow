# 工作流状态机 (v5.0)

## 快速导航

- 状态定义
- 任务状态与依赖
- 状态文件结构
- 审查状态接口
- 状态转换
- 执行模式

## 状态定义

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `planned` | 规划完成，等待用户审查后执行 |
| `spec_review` | Spec 已生成，等待用户确认范围 |
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

## 状态文件结构

`workflow-state.json` 位于 `~/.claude/workflows/{project-id}/`

```json
{
  "project_id": "abc123",
  "project_name": "my-project",
  "project_root": "/workspace/my-project",
  "status": "running",
  "current_tasks": ["Task-1"],
  "execution_mode": "phase",
  "spec_file": ".claude/specs/example.md",
  "plan_file": ".claude/plans/example.md",
  "review_status": {
    "user_spec_review": {
      "status": "approved",
      "review_mode": "human_gate",
      "reviewed_at": "2026-03-29T10:00:00Z",
      "reviewer": "user",
      "next_action": "continue_to_plan_generation"
    }
  },
  "execution_reviews": {
    "Task-1": {
      "spec_compliance": {
        "status": "Compliant",
        "reviewed_at": "2026-03-29T11:00:00Z",
        "issues": []
      },
      "code_quality": {
        "status": "Approved",
        "reviewed_at": "2026-03-29T11:05:00Z",
        "issues": []
      }
    }
  },
  "unblocked": [],
  "sessions": {
    "platform": "cursor",
    "executor": null
  },
  "progress": {
    "completed": ["Task-1"],
    "blocked": [],
    "failed": [],
    "skipped": []
  },
  "discussion": {
    "completed": true,
    "artifact_path": "discussion-artifact.json",
    "clarification_count": 5
  },
  "contextMetrics": {
    "maxContextTokens": 1000000,
    "estimatedTokens": 45000,
    "usagePercent": 5,
    "warningThreshold": 60,
    "dangerThreshold": 80,
    "hardHandoffThreshold": 90
  },
  "continuation": {
    "strategy": "budget-first",
    "last_decision": {
      "action": "continue-direct",
      "reason": "mode-phase-boundary",
      "severity": "info",
      "nextTaskIds": ["Task-2"]
    },
    "handoff_required": false
  },
  "delta_tracking": {
    "enabled": true,
    "changes_dir": "changes/",
    "current_change": null,
    "applied_changes": [],
    "change_counter": 0
  },
  "git_status": {
    "initialized": true,
    "subagent_available": true,
    "user_acknowledged_degradation": false
  },
  "ux_design": {
    "completed": true,
    "artifact_path": "ux-design-artifact.json",
    "flowchart_scenarios": 3,
    "page_count": 5,
    "approved_at": "2026-03-29T10:15:00Z"
  },
  "created_at": "2026-03-29T10:00:00Z",
  "updated_at": "2026-03-29T11:00:00Z",
  "failure_reason": null
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `spec_file` | Spec 文档路径 |
| `plan_file` | Plan 文档路径 |
| `project_root` | 项目根目录，用于从任意工作目录解析相对 `spec_file` / `plan_file` |
| `review_status.user_spec_review` | Phase 1.1 用户 Spec 审查（HumanGovernanceGate） |
| `execution_reviews` | 执行阶段的子 Agent 审查结果（per task） |
| `execution_reviews.{taskId}.spec_compliance` | Spec 合规审查结果 |
| `execution_reviews.{taskId}.code_quality` | 代码质量审查结果 |
| `unblocked` | 已解除的依赖列表 |
| `progress` | 任务进度 |
| `contextMetrics` | 上下文预算指标 |
| `continuation` | continuation 治理状态 |
| `delta_tracking` | 增量变更追踪 |

## 审查状态接口

```typescript
// 简化后只保留 User Spec Review + 执行阶段子 Agent 审查
interface ReviewStatus {
  user_spec_review: {
    status: 'pending' | 'approved' | 'revise_required' | 'rejected';
    review_mode: 'human_gate';
    reviewed_at?: string;
    reviewer: 'user';
    next_action?: string;
  };
}

// 执行阶段的子 Agent 审查结果
interface ExecutionReview {
  spec_compliance: {
    status: 'Compliant' | 'Issues Found';
    reviewed_at: string;
    issues: Array<{
      file: string;
      line?: number;
      description: string;
      fix_suggestion: string;
    }>;
  };
  code_quality: {
    status: 'Approved' | 'Issues Found';
    reviewed_at: string;
    issues: Array<{
      severity: 'Critical' | 'Important';
      file: string;
      line?: number;
      description: string;
      fix_suggestion: string;
    }>;
  };
}

// Per-task 运行时状态
interface TaskRuntime {
  retry_count: number;
  last_failure_stage: 'execution' | 'verification' | 'spec_compliance' | 'code_quality';
  last_failure_reason: string;
  hard_stop_triggered: boolean;
  debugging_phases_completed: ('investigation' | 'pattern' | 'hypothesis' | 'implementation')[];
}
```

## 状态转换

```
idle → planned (workflow-start 完成规划)
planned → spec_review (spec 生成，等待用户确认)
spec_review → planned (spec 已批准，继续 plan 生成)
spec_review → spec_review (用户要求修改 Spec)
spec_review → idle (用户拒绝并终止)
planned → running (workflow-execute 开始执行)
planned → idle (用户取消)
running → paused (暂停 / 预算暂停)
running → blocked (遇到阻塞任务)
running → failed (任务失败)
running → completed (所有任务完成)
paused → running (resume)
blocked → running (unblock)
failed → running (retry)
failed → running (skip → 下一任务)
completed → archived (/workflow archive)
```

## 执行模式

| 模式 | 参数 | 中断点 |
|------|------|--------|
| continuous | 默认 | 质量关卡完成后暂停提示用户审查 |
| phase | `--phase` | 每个 phase 完成后 + 质量关卡完成后 |
