---
name: workflow-status
description: "/workflow-status 入口。查看workflow运行时状态、进度与下一步建议。"
---

<PATH-CONVENTION>
所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。
该路径在 `npm install` 后始终存在，所有 agent 共享，无需动态解析。
</PATH-CONVENTION>

# workflow-status

> 本 skill 是 `/workflow-status` 的完整行动指南。

<HARD-GATE>
不可违反的规则：
1. **只读原则**：`status` 仅读取状态，不得修改 `workflow-state.json` 或任何产物文件
</HARD-GATE>

---

## Checklist（按序执行）

1. ☐ 获取workflow状态数据
2. ☐ 获取补充上下文（条件）
3. ☐ 格式化输出报告
4. ☐ 给出下一步建议

```
获取状态 → 补充上下文（条件） → 格式化输出 → 下一步建议
    │            │                    │
 CLI status   context/budget     简洁/详细/JSON
```

### Step 1: 获取workflow状态数据

调用 CLI 读取状态：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
```

**错误情况**：
- `error: '没有活跃的工作流'` → 检查是否有项目配置（可能需要 `/scan`），或提示用 `/workflow-spec` 启动新workflow

### Step 2: 获取补充上下文（条件）

根据用户指定的详细级别，获取额外信息：

| 参数 | 说明 | 需要的额外数据 |
|------|------|----------------|
| _(无参数)_ | 简洁模式 | `next` 命令获取下一任务 |
| `--detail` | 详细模式 | `progress` + `next` + `budget` + `journal list` + `context` |
| `--json` | JSON 模式 | 直接输出 `status` 命令的原始 JSON |

**简洁模式额外调用**：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js next
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
```

> `context` 返回 `spec_file`、`plan_file` 等字段，`status` 本身不含这些信息。

**详细模式额外调用**：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js progress
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js next
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js list
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js budget
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal list
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
```

> `list` 返回各任务的 id / name / phase / status / actions，用于渲染任务清单。

### Step 3: 格式化输出报告

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

### 条件字段展示规则

| 条件 | 展示内容 |
|------|---------|
| `failure_reason` 非空 | 在状态行下方显示 `⚠️ 失败原因：{failure_reason}` |
| 存在 `blocked` 任务 | 在任务统计表中追加 `⏳ 阻塞 \| {blocked_count}` 行 |
| `quality_gates[taskId]` 存在 | 显示各关卡的通过状态 |
| `continuation.handoff_required` 为 true | 显示 `🔄 需要 handoff：{reason}` |
| 存在 journal 记录 | 最近 5 条摘要 + 最新一条的 `next_steps` 和 `decisions` |

### Step 4: 下一步建议

根据当前状态给出建议：

| 当前状态 | 下一步提示 |
|---------|-----------|
| `spec_review` | review `spec.md` 后确认 Spec 审批（Plan 生成中也归入此状态） |
| `planned` | review Spec 和 Plan 后执行 `/workflow-execute` |
| `running` | 继续执行 `/workflow-execute` |
| `halted` (halt_reason=governance) | 根据暂停原因处理后 `/workflow-execute` 恢复 |
| `halted` (halt_reason=dependency) | 使用 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dep>` 解除依赖 |
| `halted` (halt_reason=failure) | 修复后 `/workflow-execute --retry` 或 `--skip` |
| `review_pending` | 执行 `/workflow-review` 进行全量完成review |
| `completed` | 🎉 workflow已完成，可执行 `/workflow-archive` |
| `archived` | 需要新需求请 `/workflow-spec` |

> Legacy 状态 `paused` / `blocked` / `failed` / `planning` 仍可能出现在未迁移的磁盘文件中，会被投影为上述新状态。可运行 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js migrate-state` 一次性升级。

> ⚠️ `/workflow-status` 只读取 workflow runtime；若用户使用的是 `/team`，应转而查看 `/team status`，不得把 team runtime 混入 workflow status。

---

## CLI 命令速查

```bash
# 状态查看
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js progress
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js next
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js budget
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal list
```

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-spec` | Spec 生成 + 设计深化 + 用户审批 | [`../workflow-spec/SKILL.md`](../workflow-spec/SKILL.md) |
| `workflow-plan` | Plan 扩写（在已审批 Spec 上） | [`../workflow-plan/SKILL.md`](../workflow-plan/SKILL.md) |
| `workflow-execute` | 任务执行 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| `workflow-review` | 全量完成review（execute 完成后独立执行） | [`../workflow-review/SKILL.md`](../workflow-review/SKILL.md) |
| `workflow-delta` | delta | [`../workflow-delta/SKILL.md`](../workflow-delta/SKILL.md) |
| `workflow-archive` | workflowarchive | [`../workflow-archive/SKILL.md`](../workflow-archive/SKILL.md) |

> CLI 入口：`~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js`
>
> 运行时资源参见 [`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
