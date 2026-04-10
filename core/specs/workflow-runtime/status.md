# workflow status - 查看工作流状态 (v4.0)

读取 `workflow-state.json` + `plan.md`，生成进度报告。

> `workflow-state.json` 只允许位于 `~/.claude/workflows/{projectId}/workflow-state.json`；项目目录 `.claude/` 不得承载运行时状态文件。

- > **实现方式**：所有状态读取和报告生成逻辑由 Node.js 脚本处理，AI 调用脚本获取结构化数据后格式化输出。

## 快速导航

- 想看简洁/详细/JSON 三种输出：看“渐进披露模式”
- 想看状态读取命令：看 Step 1
- 想看下一步建议与预算信息：看后续步骤
- 想看统一 CLI：结合 `references/shared-utils.md`

## 何时读取

- 用户调用 `/workflow status`
- 需要确认当前 task、进度、预算、最近 journal 或下一步建议时

## 渐进披露模式

| 参数 | 说明 |
|------|------|
| _(无参数)_ | 简洁模式：只显示核心进度和下一步操作 |
| `--detail` | 详细模式：显示完整的约束、审计、产物信息 |
| `--json` | JSON 模式：输出原始状态数据供脚本处理 |

---

## 🔍 检查逻辑

### Step 1：获取工作流状态

```bash
# 获取结构化状态数据
node utils/workflow/workflow_cli.js status

# 输出示例：
# {
#   "workflow_status": "running",
#   "current_tasks": ["T3"],
#   "total_tasks": 8,
#   "completed": 2,
#   "failed": 0,
#   "skipped": 0,
#   "progress_percent": 25,
#   "progress_bar": "[█████░░░░░░░░░░░░░░░] 25%"
# }
```

**JSON 模式**：`node utils/workflow/workflow_cli.js status` 的输出直接满足 `--json` 需求。

**错误情况**：
- 无项目配置 → 提示执行 `/scan`
- 无状态文件 → 提示执行 `/workflow start`
- 计划文件缺失 → 提示重新启动

### Step 2：获取进度详情

```bash
# 详细进度（含约束信息）
node utils/workflow/workflow_cli.js progress

# 下一个待执行任务
node utils/workflow/workflow_cli.js next

# 上下文预算
node utils/workflow/workflow_cli.js budget

# 最近会话记录
node utils/workflow/workflow_cli.js journal list

# 聚合上下文（一条命令获取全部信息）
node utils/workflow/workflow_cli.js context
```

---

## 📊 输出格式规范

AI 获取脚本数据后，按以下格式向用户展示状态报告：

### 简洁模式（默认）

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

🚀 **下一步**：/workflow execute
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 详细模式（`--detail`）

在简洁模式基础上追加：

```
📋 **任务清单**：
{对每个任务显示: emoji id: name (phase) [files]}

📓 **最近会话记录**：
{最近 5 条 journal 记录，含 title / date / tasks_count}
{最新一条的 next_steps 和 decisions}

🎯 **质量关卡**：
{对每个 quality_gate 显示通过状态}

📦 **约束系统**：
{硬约束 / 软约束 / 成功标准}

🔍 **上下文预算**：
{usage_percent}% / {context_bar}
```

### 条件字段展示规则

| 条件 | 展示内容 |
|------|---------|
| `failure_reason` 非空 | 在状态行下方显示 `⚠️ 失败原因：{failure_reason}` |
| 存在 `blocked` 任务 | 在任务统计表中追加 `⏳ 阻塞 \| {blocked_count}` 行 |
| `quality_gates[taskId]` 存在 | 显示各关卡的 `stage1.passed` / `stage2.passed` / `overall_passed` |
| `continuation.handoff_required` 为 true | 显示 `🔄 需要 handoff：{continuation.last_decision.reason}` |
| 存在 journal 记录 | 最近 5 条摘要 + 最新一条的 `next_steps` 和 `decisions` |

> `/workflow status` 只读取 workflow runtime；若用户使用的是 `/team`，应转而查看 `/team status`，不得自动把 team runtime 混入 workflow status，也不得继承 active team runtime 的 `team_id` / `team_name`。

### Journal 数据展示格式

```bash
# 获取 journal 数据
node utils/workflow/workflow_cli.js journal list
```

在详细模式的 `📓 最近会话记录` 区块中展示：

```
📓 **最近会话记录**：

| # | 日期 | 标题 | 完成任务 |
|---|------|------|----------|
| 3 | 2026-03-30 | 完成 T3 → T4 | 1 个 |
| 2 | 2026-03-29 | 完成认证模块 | 3 个 |

**上次 Next Steps**：
- T4 需要等待后端接口
- T5 可继续

**上次关键决策**：
- 选择 JWT 而非 session 方案
```

> 无 journal 记录时显示：_（暂无会话记录。执行工作流后将在关键节点自动记录。）_

💡 **查看更多**：`/workflow journal list` · **搜索**：`/workflow journal search "关键词"`

### 各状态下的下一步操作

| 当前状态 | 下一步提示 |
|---------|-----------|
| `spec_review` | 审查 `spec.md` 后执行 `/workflow spec-review --choice "<结论>"` |
| `planning` | 内部瞬时阶段；如长时间停留应检查 Plan 生成流程 |
| `planned` | 审查 Spec 和 Plan 后执行 `/workflow execute` |
| `running` | 继续执行 `/workflow execute` |
| `paused` | 根据暂停原因处理后 `/workflow execute` |
| `blocked` | 使用 `/workflow unblock <dep>` 解除依赖 |
| `failed` | 修复后 `/workflow execute --retry` 或 `--skip` |
| `completed` | 🎉 工作流已完成 |
| `archived` | 需要新需求请 `/workflow start` |

---

## 🔄 相关命令

```bash
# 执行下一步
/workflow execute

# 查询下一步（脚本化）
/workflow next

# 聚合上下文
/workflow context

# 重试当前步骤
/workflow execute --retry

# 跳过当前步骤（慎用）
/workflow execute --skip

# 启动新工作流
/workflow start "功能需求描述"

# 查看会话历史
/workflow journal list
```
