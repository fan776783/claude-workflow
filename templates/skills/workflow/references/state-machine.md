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
| `spec_review` | Spec 已生成，等待用户确认范围 |
| `planning` | Spec 已批准，正在生成或整理 Plan |
| `planned` | Plan 已生成，规划完成，等待执行 |
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

## 最小必需状态（Minimum Viable State）

以下 7 个字段是状态文件的**强制字段**。`/workflow execute` 启动时如果 `workflow-state.json` 不存在，必须创建包含这些字段的最小文件：

```json
{
  "project_id": "abc123",
  "status": "running",
  "current_tasks": ["T1"],
  "plan_file": ".claude/plans/example.md",
  "spec_file": ".claude/specs/example.md",
  "progress": { "completed": [], "failed": [], "skipped": [] },
  "updated_at": "2026-03-29T10:00:00Z"
}
```

> ⚠️ 不要因为不知道如何填写可选字段而跳过整个状态文件的创建。**最小版本只需 7 个字段**。
>
> 其他所有字段（`quality_gates`, `execution_reviews`, `contextMetrics`, `continuation`, `parallel_groups`, `discussion`, `ux_design`, `git_status` 等）为**可选增强字段**，在需要时按需添加。
>
> **运行时状态机唯一来源**：本文件是 workflow skill 的运行时 schema 单一真相。`templates/specs/workflow/state-machine.md` 为扩展/共享架构说明，不应覆盖本文件的运行时字段定义。

---

## 状态文件结构（完整版）

`workflow-state.json` 位于 `~/.claude/workflows/{project-id}/`

```json
{
  "project_id": "abc123",
  "project_name": "my-project",
  "project_root": "/workspace/my-project",
  "status": "running",
  "current_tasks": ["T1"],
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
  "quality_gates": {
    "T1": {
      "gate_task_id": "T1",
      "review_mode": "machine_loop",
      "last_decision": "pass",
      "stage1": {
        "passed": true,
        "attempts": 1,
        "issues_found": 0,
        "completed_at": "2026-03-29T11:00:00Z"
      },
      "stage2": {
        "passed": true,
        "attempts": 1,
        "assessment": "approved",
        "critical_count": 0,
        "important_count": 0,
        "minor_count": 0,
        "completed_at": "2026-03-29T11:05:00Z"
      },
      "overall_passed": true,
      "reviewed_at": "2026-03-29T11:05:00Z"
    }
  },
  "unblocked": [],
  "sessions": {
    "platform": "cursor",
    "executor": null
  },
  "progress": {
    "completed": ["T1"],
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
      "nextTaskIds": ["T2"]
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
| `quality_gates` | 执行阶段质量关卡结果（execution side review sink，per gate task） |
| `quality_gates.{taskId}.stage1` | 规格合规审查结果 |
| `quality_gates.{taskId}.stage2` | 代码质量审查结果 |
| `execution_reviews` | **旧版字段（只读兼容）**。迁移策略见下方说明 |
| `unblocked` | 已解除的依赖列表 |
| `progress` | 任务进度 |
| `contextMetrics` | 上下文预算指标 |
| `continuation` | continuation 治理状态 |
| `delta_tracking` | 增量变更追踪 |

### `execution_reviews` 迁移策略

> **状态**: 旧版字段，仅做只读兼容。所有迁移规则集中定义于此，其他文件引用本节。

| 规则 | 说明 |
|------|------|
| **新写入目标** | 所有新审查结果只写入 `quality_gates[taskId]`（stage1 / stage2） |
| **禁止回写** | 新代码不得创建、更新或回写 `execution_reviews` 字段 |
| **只读兼容** | 读取审查结果时，若 `quality_gates[taskId]` 不存在，允许降级读取 `execution_reviews[taskId]` |
| **归一化读取** | 建议通过统一 helper（`getReviewResult()`）封装 fallback 逻辑，避免散落判断 |
| **迁移终点** | 当所有活跃工作流的状态文件均已使用 `quality_gates` 后，可安全移除 `execution_reviews` 兼容逻辑 |

## 审查状态接口

> **实现参考**：`scripts/state_manager.py` 负责审查状态的读写。以下为 JSON 字段规范。

### `review_status.user_spec_review`（Phase 1.1 用户审查）

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `pending / approved / revise_required / rejected` | 审查决策 |
| `review_mode` | `human_gate` | 固定为人工审查 |
| `reviewed_at` | ISO 时间 | 审查时间 |
| `reviewer` | `user` | 审查者 |
| `next_action` | string | 后续动作提示 |

### `quality_gates[taskId]`（执行阶段质量关卡）

| 字段 | 类型 | 说明 |
|------|------|------|
| `gate_task_id` | string | 关卡对应的任务 ID |
| `review_mode` | `machine_loop` | 机器审查循环 |
| `last_decision` | `pass / revise / rejected` | 最后审查决策 |
| `stage1.passed` | boolean | 规格合规审查是否通过 |
| `stage1.attempts` | number | 尝试次数 |
| `stage2.passed` | boolean | 代码质量审查是否通过 |
| `stage2.assessment` | `approved / needs_fixes / rejected` | 质量评估 |
| `stage2.critical_count` | number | Critical 级别问题数 |
| `overall_passed` | boolean | 总体是否通过 |

### Per-task 运行时状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `retry_count` | number | 重试次数 |
| `last_failure_stage` | `execution / verification / spec_compliance / code_quality` | 最后失败阶段 |
| `last_failure_reason` | string | 失败原因 |
| `hard_stop_triggered` | boolean | 是否触发硬停止 |
| `debugging_phases_completed` | array | 已完成的调试阶段 |

## 状态转换

```
idle → spec_review (spec 生成完成，等待用户确认)
spec_review → planning (spec 已批准，进入 plan 生成)
spec_review → spec_review (用户要求修改 Spec)
spec_review → idle (用户拒绝并终止)
planning → planned (plan 生成完成)
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
