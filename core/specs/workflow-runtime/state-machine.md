# workflow状态机 (v6.0)

> 📌 **Canonical Source**：本文件是workflow状态机的**统一规范**。Skills 的 SKILL.md 引用本文件定义的状态和转换；CLI 实现本文件的状态逻辑。不与 skills 文档重复，不标记弃用。

> 状态的读写由 CLI 脚本消化。AI 通过 `workflow_cli.js` 操作状态，不直接读写 `workflow-state.json`。


## 状态定义

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `spec_review` | Spec 已生成，等待用户确认范围（Plan 生成期间复用此态，无独立 planning 态） |
| `planned` | Plan 已生成，等待执行 |
| `running` | workflow执行中 |
| `halted` | 执行中断，等待治理介入；中断原因由 `halt_reason` 区分 |
| `completed` | 所有任务完成且 execute 末尾终审通过 |
| `archived` | workflow已archive |

> 状态集与 `workflow_types.js` `MINIMUM_STATE_STATUSES` 逐项一致（7 态）：`{idle, spec_review, planned, running, halted, completed, archived}`。旧的 `planning`/`paused`/`blocked`/`failed` 已收敛——`planning` 并入 `spec_review`，`paused`/`blocked`/`failed` 统一为 `halted` + `halt_reason`。

### halt_reason 枚举

`halted` 态的中断原因由 `halt_reason` 字段区分（`workflow_types.js` `HALT_REASON`）：

| `halt_reason` | 含义 | 恢复 |
|---------------|------|------|
| `failure` | 任务失败（默认值；含 review-loop 上限 / reviewer schema 非法，成因记入 `failure_reason`） | `workflow execute retry` / `skip`（`--retry` / `--skip` 亦可） |
| `dependency` | 等待外部依赖阻塞 | `workflow unblock <dependency>` 后恢复 |

> review-loop 上限 / reviewer schema 失败经 `fail` 统一写入口落 `halt_reason=failure`、成因写 `failure_reason`，不单列独立 halt_reason 值（见 `../shared/workflow-cli.md` § fail）。halt_reason 已较 ADR 0004 进一步收敛（去 `review-loop` / `awaiting_codex_review` 独立值），ADR 为历史记录不回写。

## 状态转换

```
# workflow-spec 管辖
idle → spec_review         workflow start (spec 生成完成；alias: plan)  [/workflow-spec Step 1]
spec_review → planned      workflow spec-review --choice "approve" [/workflow-spec Step 5]
spec_review → spec_review   用户要求修改 Spec                      [/workflow-spec Step 5→4]
spec_review → idle          用户拒绝/拆分范围                      [/workflow-spec Step 5]

# workflow-plan 管辖（planned 状态下的 Plan 扩写，不改变状态）

# workflow-execute 管辖
planned → running           workflow execute                       [/workflow-execute Step 1]
running → halted            任务失败（含 review-loop 上限 / reviewer schema 非法）/ 依赖阻塞（halt_reason 区分）
running → completed         所有任务完成且 /workflow-execute 末尾终审通过（Step 7 inline final reviewer）
halted → running            workflow execute retry / skip（failure；`--retry` / `--skip` 亦可）、unblock <dep>（dependency）
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
| continuous | 默认 | 质量关卡完成后暂停提示用户review |
| phase | `--phase` | 每个 phase 完成后 + 质量关卡完成后 |

---

## CLI 状态操作

> ⚠️ **所有状态delta统一通过 CLI 完成**。不直接读写 `workflow-state.json`。

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

# 开始/恢复执行（planned/halted → running）
node utils/workflow/workflow_cli.js execute
node utils/workflow/workflow_cli.js execute --mode phase
node utils/workflow/workflow_cli.js execute retry
node utils/workflow/workflow_cli.js execute skip

# 完成任务并推进到下一个
node utils/workflow/workflow_cli.js advance T3 --journal "实现了用户认证"

# 解除依赖阻塞（halted[dependency] → running）
node utils/workflow/workflow_cli.js unblock api_spec

# 归档（completed → archived）
node utils/workflow/workflow_cli.js archive
```

### delta

```bash
# 基于 PRD 变更生成增量（常规由 /workflow-delta skill 编排）。delta 需子命令：init|impact|apply|fail|sync
node utils/workflow/workflow_cli.js delta init --type requirement --source docs/prd-v2.md
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
| Spec | `~/.claude/workflows/{projectId}/specs/{name}-{MMDD}.md` | workflowDir 下 |
| Plan | `~/.claude/workflows/{projectId}/plans/{name}-{MMDD}.md` | workflowDir 下 |

> `workflow-state.json` 只能位于 `~/.claude/workflows/` 下，**不得存在于项目目录**。

## Task 源与 resume 恢复

机器 task 源 = **task-dir**（`~/.claude/workflows/{projectId}/tasks/{taskId}/{task.json,task.md,context.jsonl}`），由 `/workflow-plan` 现写、execute 期 `execution_sequencer` / `task_manager` 经 `createTaskSource(state)` 反查。`plan.md` **退化为可选的人类可读叙述**（front matter + 锚点），不再作机器 task 源解析。

**task-dir schema v2**（见 `task-dir-schema.md`）：执行所需 rich 正文（`files`/`patterns`/`mandatory_reading`/`constraints`/`task_text`）进 task.json 结构化字段，`task.md` 为其渲染产物（execute 逐字注入、不回解析）。`task.json.schema_version` 标版本——**execute 入口对 `< 2` 的 task-dir 硬阻断**（`reason: task_dir_schema_v1`），引导全量重 plan；本版本不兼容 v1 task-dir，无回退。只读命令不受影响。

- `createTaskSource(state)` 工厂：task-dir 非空 → `TaskDirSource`；仅 legacy plan.md（无 task-dir）→ `LegacyPlanMdSource`（复用 `parseTasksV2` 兼容读 + stderr 显式迁移提示，C-7 不静默失效）；皆无 → `null`（调用方报 `task_source_missing`）。
- `current_tasks[0]` = task 源 `firstTaskId()`，顺序由 task-dir 数字序（或 legacy plan.md 解析序）稳定确定，是 resume 的可复现起点。锚点重导/修复语义（task-write 自动重导、repair-anchor 修锚、failed/blocked 回退 retry/unblock 目标）见 `core/specs/shared/workflow-cli.md` § task-write 的 resume 锚点重导 / § repair-anchor，plan-review 的 current_tasks_orphaned/current_tasks_empty hard issue 兜底挡 ready。

**resume 三元组**：`/clear` 后内存全丢，运行时仅从 disk 重建 **`current_tasks[0]` + `status` + task 源**三者，即可等价恢复执行位置（C-1）。task 序列、`current_tasks[0]`、`status`、各 task status 重建前后逐项等价。

## 最小必需状态

CLI `start` 命令自动创建状态文件，包含以下 7 个必需字段：

```json
{
  "project_id": "abc123",
  "status": "running",
  "current_tasks": ["T1"],
  "plan_file": "/Users/<you>/.claude/workflows/{pid}/plans/example-0506.md",
  "spec_file": "/Users/<you>/.claude/workflows/{pid}/specs/example-0506.md",
  "progress": { "completed": [], "blocked": [], "failed": [], "skipped": [] },
  "updated_at": "2026-03-29T10:00:00Z"
}
```

> `plan_file` / `spec_file` 持久化的是 **OS 已展开的绝对路径**（`os.homedir()` 解析结果），不写 `~`。读取侧通过 `path.isAbsolute` 区分新旧格式（旧格式为项目相对路径如 `.claude/plans/foo.md`）。

> 其他字段（`context_injection`, `discussion`, `ux_design`, `requirement_baseline`, `initial_head_commit` 等）为可选增强字段，由 CLI 按需自动添加。质量关卡不再落盘（lean-execute 退役）；几个旧字段（per-task 关卡记录、`continuation`、`review_report_path`）仅在读取侧做向后兼容，老 state 读入后由 `ensureStateDefaults` 丢弃。

## 依赖类型

| 依赖标识 | 说明 | 解除 |
|---------|------|------|
| `api_spec` | 后端接口规格 | `workflow unblock api_spec` |
| `external` | 第三方服务/SDK | `workflow unblock external` |

## review与质量关卡

review状态由 CLI 和执行引擎自动管理，写入 `workflow-state.json` 的对应字段：

| 关卡 | 状态字段 | 管理方式 |
|------|---------|---------|
| 用户 Spec review | `review_status.user_spec_review` | `/workflow-spec` spec-review 阶段 |
| Plan Review | `review_status.plan_review` | 执行引擎自动触发 |
| 执行质量关卡 | （不持久化） | per-task reviewer 内存确认（execute Step 6）+ execute 末尾终审（Step 7 inline final reviewer）；通过/拒绝不写 state |

> 质量关卡结果不再落盘。per-task 关卡记录与 `execution_reviews` 均为旧版字段，仅作只读兼容：`node utils/workflow/state_manager.js review-result --task-id <id>` 在老 state 上仍可读出历史关卡记录，新执行流不产生这些字段。

### user_spec_review 状态值

| 值 | 含义 | 来源 |
|------|------|------|
| `pending` | 等待用户审批 | CLI `start` 默认值 |
| `approved` | 用户审批通过 | `spec-review --choice` 或 `system-recovery`（自愈且 spec 存在） |
| `skipped` | 无 spec 路径的自愈恢复 | `system-recovery` |

> `skipped` 不阻塞执行（`getSpecReviewGateViolation` 视同 `approved`），但记录了该 plan 未经过完整 spec 审批管线。
