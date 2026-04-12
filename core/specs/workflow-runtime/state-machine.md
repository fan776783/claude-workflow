# 工作流状态机 (v6.0)

> 📌 **Canonical Source**：本文件是工作流状态机的**统一规范**。Skills 的 SKILL.md 引用本文件定义的状态和转换；CLI 实现本文件的状态逻辑。不与 skills 文档重复，不标记弃用。

> 状态的读写由 CLI 脚本消化。AI 通过 `workflow_cli.js` 操作状态，不直接读写 `workflow-state.json`。


## 状态定义

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `spec_review` | Spec 已生成，等待用户确认范围 |
| `planning` | Spec 已批准，正在生成 Plan（短暂内部状态） |
| `planned` | Plan 已生成，等待执行 |
| `running` | 工作流执行中 |
| `paused` | 暂停等待用户操作 |
| `blocked` | 等待外部依赖 |
| `failed` | 任务失败，需要处理 |
| `review_pending` | 所有任务执行完毕，等待显式审查 |
| `completed` | 审查通过，所有任务完成 |
| `archived` | 工作流已归档 |

## 状态转换

```
idle → spec_review         workflow plan (spec 生成完成)
spec_review → planned      workflow spec-review --choice "Spec 正确，生成 Plan"
spec_review → spec_review   用户要求修改 Spec
spec_review → idle          用户拒绝/拆分范围
planned → running           workflow execute
running → paused            暂停 / 预算暂停
running → blocked           遇到阻塞任务
running → failed            任务失败
running → review_pending    所有任务完成，进入审查等待
review_pending → completed  /workflow-review 审查通过
review_pending → running    审查发现问题，需要修复
paused → running            workflow execute (resume)
blocked → running           workflow unblock <dependency>
failed → running            workflow execute --retry / --skip
completed → archived        workflow archive
```

## 任务状态

| 状态 | 说明 |
|------|------|
| `pending` | 待执行 |
| `blocked` | 被阻塞 |
| `in_progress` | 执行中 |
| `completed` | 已完成 |
| `skipped` | 已跳过 |
| `failed` | 失败 |

## 执行模式

| 模式 | 参数 | 中断点 |
|------|------|--------|
| continuous | 默认 | 质量关卡完成后暂停提示用户审查 |
| phase | `--phase` | 每个 phase 完成后 + 质量关卡完成后 |

---

## CLI 状态操作

> ⚠️ **所有状态变更统一通过 CLI 完成**。不直接读写 `workflow-state.json`。

### 查询状态

```bash
# 查看当前状态、进度、下一步建议
node utils/workflow/workflow_cli.js status

# 聚合上下文（状态 + 下一任务 + 预算 + git + journal）
node utils/workflow/workflow_cli.js context

# 查询下一个待执行任务
node utils/workflow/workflow_cli.js next

# 查看任务进度统计
node utils/workflow/workflow_cli.js progress

# 查看上下文预算
node utils/workflow/workflow_cli.js budget
```

### 推进状态

```bash
# 启动规划（idle → spec_review / planned）
node utils/workflow/workflow_cli.js start "需求描述"
node utils/workflow/workflow_cli.js start docs/prd.md

# 用户审批 Spec（spec_review → planned）
node utils/workflow/workflow_cli.js spec-review --choice "Spec 正确，生成 Plan"

# 开始/恢复执行（planned/paused/failed → running）
node utils/workflow/workflow_cli.js execute
node utils/workflow/workflow_cli.js execute --mode phase
node utils/workflow/workflow_cli.js execute retry
node utils/workflow/workflow_cli.js execute skip

# 完成任务并推进到下一个
node utils/workflow/workflow_cli.js advance T3 --journal "实现了用户认证"

# 解除依赖阻塞（blocked → running）
node utils/workflow/workflow_cli.js unblock api_spec

# 归档（completed → archived）
node utils/workflow/workflow_cli.js archive
```

### 增量变更

```bash
# 基于 PRD 变更生成增量
node utils/workflow/workflow_cli.js delta docs/prd-v2.md
```

### 会话日志

```bash
node utils/workflow/workflow_cli.js journal add --title "..." --summary "..."
node utils/workflow/workflow_cli.js journal list --limit 5
node utils/workflow/workflow_cli.js journal search "关键词"
```

---

## 状态文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| 运行时状态 | `~/.claude/workflows/{projectId}/workflow-state.json` | CLI 自动管理 |
| 项目配置 | `.claude/config/project-config.json` | 项目目录下 |
| Spec | `.claude/specs/{name}.md` | 项目目录下 |
| Plan | `.claude/plans/{name}.md` | 项目目录下 |

> `workflow-state.json` 只能位于 `~/.claude/workflows/` 下，**不得存在于项目目录**。

## 最小必需状态

CLI `start` 命令自动创建状态文件，包含以下 7 个必需字段：

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

> 其他字段（`quality_gates`, `context_injection`, `continuation`, `discussion`, `ux_design`, `requirement_baseline`, `initial_head_commit` 等）为可选增强字段，由 CLI 按需自动添加。

## 依赖类型

| 依赖标识 | 说明 | 解除 |
|---------|------|------|
| `api_spec` | 后端接口规格 | `workflow unblock api_spec` |
| `external` | 第三方服务/SDK | `workflow unblock external` |

## 审查与质量关卡

审查状态由 CLI 和执行引擎自动管理，写入 `workflow-state.json` 的对应字段：

| 关卡 | 状态字段 | 管理方式 |
|------|---------|---------|
| 用户 Spec 审查 | `review_status.user_spec_review` | `/workflow-plan` spec-review 阶段 |
| Plan Review | `review_status.plan_review` | 执行引擎自动触发 |
| 执行质量关卡 | `quality_gates[taskId]` | `/workflow-review` 独立步骤（execute 完成后手动触发） |

> `execution_reviews` 为旧版字段（只读兼容）。新写入只使用 `quality_gates`。归一化读取：`node utils/workflow/state_manager.js review-result --task-id <id>`。

### user_spec_review 状态值

| 值 | 含义 | 来源 |
|------|------|------|
| `pending` | 等待用户审批 | CLI `start` 默认值 |
| `approved` | 用户审批通过 | `spec-review --choice` 或 `system-recovery`（自愈且 spec 存在） |
| `skipped` | 无 spec 路径的自愈恢复 | `system-recovery`（自愈但无 spec，如来自 `/quick-plan`） |

> `skipped` 不阻塞执行（`getSpecReviewGateViolation` 视同 `approved`），但记录了该 plan 未经过完整 spec 审批管线。
