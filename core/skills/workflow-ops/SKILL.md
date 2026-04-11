---
name: workflow-ops
description: "/workflow status 和 /workflow archive 入口。运行时状态查看与工作流归档。"
---

# workflow-ops

> 本 skill 是 `/workflow status` 和 `/workflow archive` 的完整行动指南。

<HARD-GATE>
两条不可违反的规则：
1. **只读原则**：`status` 仅读取状态，不得修改 `workflow-state.json` 或任何产物文件
2. **完成前置**：`archive` 仅允许对 `completed` 状态的工作流执行，不得跳过状态校验
</HARD-GATE>

---

## Action 1: status — 查看工作流状态

### Checklist（按序执行）

1. ☐ 获取工作流状态数据
2. ☐ 获取补充上下文（条件）
3. ☐ 格式化输出报告
4. ☐ 给出下一步建议

```
获取状态 → 补充上下文（条件） → 格式化输出 → 下一步建议
    │            │                    │
 CLI status   context/budget     简洁/详细/JSON
```

#### Step 1: 获取工作流状态数据

调用 CLI 读取状态：

```bash
node core/utils/workflow/workflow_cli.js status
```

**错误情况**：
- `error: '没有活跃的工作流'` → 检查是否有项目配置（可能需要 `/scan`），或提示用 `/workflow plan` 启动新工作流

#### Step 2: 获取补充上下文（条件）

根据用户指定的详细级别，获取额外信息：

| 参数 | 说明 | 需要的额外数据 |
|------|------|----------------|
| _(无参数)_ | 简洁模式 | `next` 命令获取下一任务 |
| `--detail` | 详细模式 | `progress` + `next` + `budget` + `journal list` + `context` |
| `--json` | JSON 模式 | 直接输出 `status` 命令的原始 JSON |

**简洁模式额外调用**：

```bash
node core/utils/workflow/workflow_cli.js next
node core/utils/workflow/workflow_cli.js context
```

> `context` 返回 `spec_file`、`plan_file` 等字段，`status` 本身不含这些信息。

**详细模式额外调用**：

```bash
node core/utils/workflow/workflow_cli.js progress
node core/utils/workflow/workflow_cli.js next
node core/utils/workflow/workflow_cli.js list
node core/utils/workflow/workflow_cli.js budget
node core/utils/workflow/workflow_cli.js journal list
node core/utils/workflow/workflow_cli.js context
```

> `list` 返回各任务的 id / name / phase / status / actions，用于渲染任务清单。

#### Step 3: 格式化输出报告

**简洁模式（默认）**：

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

**详细模式**（在简洁模式基础上追加）：

```
📋 **任务清单**：
{对每个任务显示: emoji id: name (phase) [files]}

📓 **最近会话记录**：
{最近 5 条 journal 记录，含 title / date / tasks_count}
{最新一条的 next_steps 和 decisions}

🎯 **质量关卡**：
{对每个 quality_gate 显示通过状态}

🔍 **上下文预算**：
{usage_percent}% / {context_bar}
```

**JSON 模式**：直接输出 `status` 命令的原始 JSON。

#### 条件字段展示规则

| 条件 | 展示内容 |
|------|---------| 
| `failure_reason` 非空 | 在状态行下方显示 `⚠️ 失败原因：{failure_reason}` |
| 存在 `blocked` 任务 | 在任务统计表中追加 `⏳ 阻塞 \| {blocked_count}` 行 |
| `quality_gates[taskId]` 存在 | 显示各关卡的通过状态 |
| `continuation.handoff_required` 为 true | 显示 `🔄 需要 handoff：{reason}` |
| 存在 journal 记录 | 最近 5 条摘要 + 最新一条的 `next_steps` 和 `decisions` |

#### Step 4: 下一步建议

根据当前状态给出建议：

| 当前状态 | 下一步提示 |
|---------|-----------| 
| `spec_review` | 审查 `spec.md` 后执行 `/workflow spec-review --choice "<结论>"` |
| `planning` | 内部瞬时阶段；如长时间停留应检查 Plan 生成流程 |
| `planned` | 审查 Spec 和 Plan 后执行 `/workflow execute` |
| `running` | 继续执行 `/workflow execute` |
| `paused` | 根据暂停原因处理后 `/workflow execute` |
| `blocked` | 使用 `/workflow unblock <dep>` 解除依赖 |
| `failed` | 修复后 `/workflow execute --retry` 或 `--skip` |
| `completed` | 🎉 工作流已完成，可执行 `/workflow archive` |
| `archived` | 需要新需求请 `/workflow plan` |

> ⚠️ `/workflow status` 只读取 workflow runtime；若用户使用的是 `/team`，应转而查看 `/team status`，不得把 team runtime 混入 workflow status。

---

## Action 2: archive — 归档工作流

### Checklist（按序执行）

1. ☐ 调用 CLI 执行归档
2. ☐ 展示归档结果
3. ☐ 给出下一步建议

```
CLI archive → 展示结果 → 下一步建议
     │            │
 状态校验+     归档变更数
 文件搬迁     摘要文件路径
```

#### Step 1: 调用 CLI 执行归档

```bash
# 基本归档
node core/utils/workflow/workflow_cli.js archive

# 带摘要报告的归档
node core/utils/workflow/workflow_cli.js archive --summary
```

CLI 自动完成：
- 校验工作流状态为 `completed`（否则返回错误）
- 将 `changes/CHG-*` 目录移动到 `archive/`
- 生成归档摘要（`--summary` 时）
- 更新 `workflow-state.json` 状态为 `archived`
- 清空 `delta_tracking.current_change`

**错误处理**：

| 错误 | 含义 | 建议 |
|------|------|------|
| `没有可归档的工作流` | 无项目配置或无状态文件 | 提示先执行 `/scan` 和 `/workflow plan` |
| `只有 completed 状态的工作流可以归档` | 当前状态不是 `completed` | 显示当前 `state_status`，提示先完成工作流 |

#### Step 2: 展示归档结果

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 工作流归档

✅ 归档完成！

- **项目 ID**：{project_id}
- **状态**：archived
- **归档变更数**：{archived_changes.length}
- **归档目录**：{archive_dir}
{如有摘要：- **摘要文件**：{summary_file}}

文件结构：
~/.claude/workflows/{projectId}/
├── workflow-state.json        ← 状态已更新为 archived
├── archive/                   ← 归档目录
│   ├── CHG-*/                 ← delta 变更记录（如有）
│   └── archive-summary-*.md   ← 归档摘要（如有）
└── changes/                   ← 已清空
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Step 3: 下一步建议

```
🎉 工作流已归档，可以开始新的任务了！

/workflow plan "新功能描述"
```

> ⚠️ `/workflow archive` 只归档 workflow runtime；team 相关归档应使用 `/team archive`。

---

## CLI 命令速查

```bash
# 状态查看
node core/utils/workflow/workflow_cli.js status
node core/utils/workflow/workflow_cli.js progress
node core/utils/workflow/workflow_cli.js next
node core/utils/workflow/workflow_cli.js budget
node core/utils/workflow/workflow_cli.js context
node core/utils/workflow/workflow_cli.js journal list

# 归档
node core/utils/workflow/workflow_cli.js archive
node core/utils/workflow/workflow_cli.js archive --summary
```

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-planning` | 规划流程 | [`../workflow-planning/SKILL.md`](../workflow-planning/SKILL.md) |
| `workflow-executing` | 任务执行 | [`../workflow-executing/SKILL.md`](../workflow-executing/SKILL.md) |
| `workflow-reviewing` | 质量关卡审查 | [`../workflow-reviewing/SKILL.md`](../workflow-reviewing/SKILL.md) |
| `workflow-delta` | 增量变更 | [`../workflow-delta/SKILL.md`](../workflow-delta/SKILL.md) |

> CLI 入口：`core/utils/workflow/workflow_cli.js`
>
> Command 入口：[`../../commands/workflow.md`](../../commands/workflow.md)
