# workflow-status 输出格式

## 简洁模式

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

## 详细模式

简洁模式 + 追加：任务清单、最近 5 条 journal、质量关卡、上下文预算。

## JSON 模式

直接输出 `status` 命令原始 JSON。

## 条件字段展示

| 条件 | 展示 |
|------|------|
| `failure_reason` 非空 | 状态行下加 `⚠️ 失败原因：{failure_reason}` |
| 存在 `blocked` 任务 | 任务表加 `⏳ 阻塞 \| {blocked_count}` 行 |
| `quality_gates[taskId]` 存在 | 显示各关卡通过状态 |
| `continuation.handoff_required` 为 true（从磁盘 state JSON 读取） | 显示 `🔄 需要 handoff：{reason}` |
| 存在 journal 记录 | 最近 5 条摘要 + 最新一条的 `next_steps` 与 `decisions` |
