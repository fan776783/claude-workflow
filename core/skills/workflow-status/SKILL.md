---
name: workflow-status
description: "Use when 用户调用 /workflow-status, or 需要查看当前 workflow 的状态/进度/下一步建议。只读操作,不修改任何文件。"
---

> 路径约定见 [`../../specs/shared/pre-flight.md`](../../specs/shared/pre-flight.md) § Workflow CLI 路径约定。

# workflow-status

<HARD-GATE>
**只读原则**：仅读取状态,不得修改 `workflow-state.json` 或任何产物文件。
</HARD-GATE>

## Checklist

1. ☐ 调用 CLI 读取状态
2. ☐ 按详细级别补充上下文
3. ☐ 格式化输出报告
4. ☐ 给出下一步建议

## Step 1: 读取状态

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
```

返回 `error: '没有活跃的工作流'` → 提示用户先 `/scan` 或 `/workflow-spec` 启动新 workflow。

## Step 2: 按详细级别补充

| 参数 | 模式 | 额外 CLI |
|------|------|----------|
| _(无参数)_ | 简洁 | `next` + `context` |
| `--detail` | 详细 | `progress` + `next` + `list` + `budget` + `journal list` + `context` |
| `--json` | JSON | 直接输出 `status` 原始 JSON |

`context` 返回 `spec_file` / `plan_file` 等字段,`status` 本身不含;`list` 返回各任务的 id / name / phase / status / actions。

## Step 3: 格式化输出

**简洁模式**:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 工作流状态报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**状态**：{workflow_status}
**进度**：{progress_percent}%（{completed + skipped} / {total_tasks}）

{progress_bar}

| 状态 | 数量 |
|------|------|
| ✅ 已完成 | {completed} |
| ⏭️ 已跳过 | {skipped} |
| ❌ 失败 | {failed} |
| ⏸️ 待执行 | {pending} |

📍 **当前任务**：{current_task.id} - {current_task.name}
📘 **Spec**：{spec_file}
🧭 **Plan**：{plan_file}

🚀 **下一步**：{next_action}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**详细模式**追加任务清单 / 最近 5 条 journal / 质量关卡 / 上下文预算。

**JSON 模式**直接输出 status 原始 JSON。

### 条件字段展示

| 条件 | 展示 |
|------|------|
| `failure_reason` 非空 | 状态行下加 `⚠️ 失败原因：{failure_reason}` |
| 存在 `blocked` 任务 | 任务表加 `⏳ 阻塞 \| {blocked_count}` 行 |
| `quality_gates[taskId]` 存在 | 显示各关卡通过状态 |
| `continuation.handoff_required` 为 true | 显示 `🔄 需要 handoff：{reason}` |
| 存在 journal 记录 | 最近 5 条摘要 + 最新一条的 `next_steps` 与 `decisions` |

## Step 4: 下一步建议

| 当前状态 | 建议 |
|---------|------|
| `spec_review` | review `spec.md` 后确认 Spec 审批 |
| `planned` | review Spec/Plan 后 `/workflow-execute` |
| `running` | 继续 `/workflow-execute` |
| `halted` (governance) | 处理暂停原因后 `/workflow-execute` 恢复 |
| `halted` (dependency) | `workflow_cli.js unblock <dep>` 解除依赖 |
| `halted` (failure) | `/workflow-execute --retry` 或 `--skip` |
| `review_pending` | `/workflow-review` 全量完成 review |
| `completed` | 🎉 可 `/workflow-archive` |
| `archived` | 新需求请 `/workflow-spec` |

> Legacy 状态 `paused` / `blocked` / `failed` / `planning` 会被 CLI 投影为上述新状态。需一次性升级旧文件运行 `workflow_cli.js migrate-state`。
>
> `/workflow-status` 只读 workflow runtime;若用户用 `/team`,改查 `/team status`。
