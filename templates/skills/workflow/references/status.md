# workflow status - 查看工作流状态 (v4.0)

读取 `workflow-state.json` + `plan.md`，生成进度报告。

> **实现方式**：所有状态读取和报告生成逻辑由 Python 脚本处理，AI 调用脚本获取结构化数据后格式化输出。

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
py -3 workflow_cli.py status

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

**JSON 模式**：`py -3 workflow_cli.py status` 的输出直接满足 `--json` 需求。

**错误情况**：
- 无项目配置 → 提示执行 `/scan`
- 无状态文件 → 提示执行 `/workflow start`
- 计划文件缺失 → 提示重新启动

### Step 2：获取进度详情

```bash
# 详细进度（含约束信息）
py -3 workflow_cli.py progress

# 下一个待执行任务
py -3 workflow_cli.py next

# 上下文预算
py -3 workflow_cli.py budget

# 最近会话记录
py -3 workflow_cli.py journal list

# 聚合上下文（一条命令获取全部信息）
py -3 workflow_cli.py context
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

🎯 **质量关卡**：
{对每个 quality_gate 显示通过状态}

📦 **约束系统**：
{硬约束 / 软约束 / 成功标准}

🔍 **上下文预算**：
{usage_percent}% / {context_bar}
```

### 各状态下的下一步操作

| 当前状态 | 下一步提示 |
|---------|-----------|
| `planned` | 审查 Spec 和 Plan 后执行 `/workflow execute` |
| `spec_review` | 审查 `spec.md` 后确认或修改 |
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
