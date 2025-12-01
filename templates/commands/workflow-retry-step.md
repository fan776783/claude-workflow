---
description: 重试当前步骤 - 用于质量关卡失败后优化并重新审查
allowed-tools: Read(*), Write(*), mcp__codex__codex(*)
---

# 重试当前步骤

用于质量关卡失败后，根据反馈优化内容并重新执行审查。

## 🎯 使用场景

1. **Codex 方案审查失败**：评分 < 80，需要优化技术方案后重新审查
2. **Codex 代码审查失败**：评分 < 80，需要修复代码问题后重新审查
3. **测试失败**：需要修复后重新运行测试
4. **其他质量检查失败**：需要改进后重新验证

## 🔍 执行流程

### Step 1：查找并读取任务记忆

```bash
# 加载工具函数库
source ~/.claude/utils/workflow-helpers.sh

# 获取当前项目路径
current_path=$(pwd)

# 查找活跃工作流
workflow_dir=$(find_active_workflow "$current_path")

if [ -z "$workflow_dir" ]; then
  echo "❌ 未发现工作流任务记忆"
  exit 1
fi

# 读取工作流记忆
memory_file="$workflow_dir/workflow-memory.json"
```

```typescript
const memory = JSON.parse(readFile(memory_file));

// 找到当前步骤（最后一个 failed 或 in_progress 的步骤）
const currentStep = memory.steps.find(step =>
  step.status === 'failed' || step.status === 'in_progress'
);

if (!currentStep) {
  throw new Error('没有需要重试的步骤');
}
```

### Step 2：显示重试信息

```markdown
🔄 **重试步骤**：{{currentStep.name}}

**步骤 ID**：{{currentStep.id}}
**所属阶段**：{{currentStep.phase}}
**当前状态**：{{currentStep.status}}

{{if currentStep.status === 'failed'}}
**失败原因**：{{currentStep.failure_reason}}
**失败时间**：{{currentStep.failed_at}}

**上次评分**：{{currentStep.actual_score}} / 100
**要求阈值**：{{currentStep.threshold}}
**差距**：{{currentStep.threshold - currentStep.actual_score}} 分
{{endif}}

---

## 📋 重试前检查

{{if currentStep.suggestions}}
请确保已根据以下建议优化：

{{currentStep.suggestions}}
{{endif}}

继续重试？
```

### Step 3：重置步骤状态

```typescript
// 重置步骤状态为 pending
currentStep.status = 'pending';
currentStep.retry_count = (currentStep.retry_count || 0) + 1;
currentStep.last_retry_at = new Date().toISOString();

// 清除失败信息
delete currentStep.failed_at;
delete currentStep.failure_reason;
delete currentStep.actual_score;

// 保存
saveMemory(memory);
```

### Step 4：重新执行

```markdown
✅ 步骤已重置为待执行状态

**重试次数**：{{currentStep.retry_count}}

---

## 🚀 重新执行

执行命令：
\```bash
/workflow-execute
\```

💡 **提示**：
- 确保已根据反馈优化相关内容
- 重试次数过多（> 3次）可能需要重新设计方案
- 可以手动编辑 workflow-memory.json 调整阈值（不推荐）
```

---

## 💡 示例

### 示例：Codex 方案审查失败后重试

```
🔄 重试步骤：Codex 方案审查

**步骤 ID**：8
**所属阶段**：design
**当前状态**：failed

**失败原因**：评分 72 低于阈值 80
**失败时间**：2025-01-19 11:30:00

**上次评分**：72 / 100
**要求阈值**：80
**差距**：8 分

---

## 📋 重试前检查

请确保已根据以下建议优化：

### 主要问题
1. 缺少数据迁移方案
2. 权限验证逻辑不完整
3. 性能影响未充分评估

### 改进建议
1. 补充现有数据如何迁移到多租户架构的详细方案
2. 完善权限验证中间件的实现细节
3. 增加性能测试计划和预期指标

---

✅ 步骤已重置为待执行状态

**重试次数**：1

---

## 🚀 重新执行

执行命令：
\```bash
/workflow-execute
\```

💡 提示：
- 请先编辑技术方案文档，补充缺失的内容
- 重新审查时，Codex 会复用之前的会话上下文
```

---

## ⚠️ 注意事项

### 重试次数限制

- **建议**：每个步骤重试次数不超过 3 次
- **超过 3 次**：可能需要重新设计方案或调整目标

### 不要过度依赖重试

如果多次重试仍无法通过质量关卡，考虑：
1. 重新分析需求，可能理解有偏差
2. 调整技术方案，选择更简单的实现
3. 咨询团队成员或专家
4. 降低质量阈值（需要充分理由和记录）

### 手动调整阈值（高级用法）

如果确信当前评分已足够（但低于阈值），可以：

```bash
# 1. 备份任务记忆
cp .claude/workflow-memory.json .claude/workflow-memory.backup.json

# 2. 编辑 workflow-memory.json
# 找到对应步骤，修改 threshold 值

# 3. 或者直接标记步骤为 completed
# 修改 status 为 "completed"，设置 actual_score 为通过值

# 4. 继续执行
/workflow-execute
```

⚠️ **警告**：手动调整可能导致后续质量问题，请谨慎操作并记录理由。

---

## 🔧 相关命令

```bash
# 查看当前状态
/workflow-status

# 查看任务记忆（使用 /workflow-status 命令）
/workflow-status

# 查看技术方案（如果是方案审查失败）
cat .claude/tech-design/{{task_name}}.md

# 跳过当前步骤（慎用）
/workflow-skip-step

# 继续执行
/workflow-execute
```
