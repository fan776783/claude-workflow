---
description: 跳过当前步骤 - 慎用，用于特殊情况下跳过某个步骤
allowed-tools: Read(*), Write(*)
---

# 跳过当前步骤

⚠️ **慎用功能**：跳过步骤可能导致后续问题，仅在特殊情况下使用。

## 🎯 适用场景

### ✅ 合理的跳过场景

1. **条件步骤不需要执行**：
   - 用户确认步骤，但需求无歧义
   - 专项分析步骤，但功能不涉及相关领域

2. **已通过其他方式完成**：
   - 已有详细技术方案，跳过方案生成步骤
   - 已手动完成验证，跳过自动验证步骤

3. **外部因素无法执行**：
   - Codex 服务临时不可用
   - 某个工具暂时无法使用

### ❌ 不应跳过的场景

- **质量关卡**：Codex 审查、测试验证等关键步骤
- **核心实施步骤**：代码编写、测试编写等
- **仅因为评分不达标**：应该使用 `/workflow-retry-step` 而非跳过

---

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

const currentStep = memory.steps.find(step =>
  step.status === 'pending' || step.status === 'in_progress' || step.status === 'failed'
);

if (!currentStep) {
  throw new Error('没有可跳过的步骤');
}
```

### Step 2：显示跳过警告

```markdown
⚠️ **即将跳过步骤**

**步骤 ID**：{{currentStep.id}}
**步骤名称**：{{currentStep.name}}
**所属阶段**：{{currentStep.phase}}
**当前状态**：{{currentStep.status}}

{{if currentStep.quality_gate}}
🚨 **警告**：这是质量关卡步骤！
跳过质量关卡可能导致严重的质量问题。

**评分阈值**：{{currentStep.threshold}}
**如果跳过**：后续步骤可能基于不合格的产出继续执行
{{endif}}

---

## ⚠️ 跳过风险

跳过此步骤可能导致：
1. 后续步骤缺少必要的输入
2. 质量无法保证
3. 最终交付物存在缺陷
4. 团队协作时信息不完整

---

## 📝 请提供跳过理由

**必须提供跳过理由以便追溯**：
```

### Step 3：记录跳过原因

```typescript
// 提示用户输入跳过理由
const reason = await askUser('请输入跳过理由（必填）：');

if (!reason || reason.trim().length === 0) {
  throw new Error('必须提供跳过理由');
}

// 标记步骤为 skipped
currentStep.status = 'skipped';
currentStep.skipped_at = new Date().toISOString();
currentStep.skipped_reason = reason;
currentStep.skipped_by = 'user';

// 如果是质量关卡，记录风险
if (currentStep.quality_gate) {
  memory.issues.push({
    severity: 'high',
    type: 'quality_gate_skipped',
    step_id: currentStep.id,
    step_name: currentStep.name,
    description: `质量关卡被跳过：${reason}`,
    timestamp: new Date().toISOString()
  });
}

// 更新当前步骤指针
memory.current_step_id = currentStep.id + 1;
memory.updated_at = new Date().toISOString();

saveMemory(memory);
```

### Step 4：显示确认信息

```markdown
✅ 步骤已跳过

**跳过步骤**：{{currentStep.name}}
**跳过理由**：{{reason}}
**跳过时间**：{{currentStep.skipped_at}}

{{if currentStep.quality_gate}}
⚠️ **已记录风险**：质量关卡被跳过，可能影响最终质量

此风险已记录到工作流记忆，在最终报告中会体现。
{{endif}}

---

## 🚀 继续执行

执行下一步：
\```bash
/workflow-execute
\```

查看当前状态：
\```bash
/workflow-status
\```
```

---

## 💡 示例

### 示例1：跳过用户确认步骤

```
⚠️ 即将跳过步骤

**步骤 ID**：3
**步骤名称**：用户确认（如有歧义）
**所属阶段**：analyze
**当前状态**：pending

---

## ⚠️ 跳过风险

跳过此步骤可能导致：
1. 后续实施方向可能存在偏差
2. 技术选型可能不符合预期

---

## 📝 请提供跳过理由

> 需求已非常明确，无歧义，无需用户确认

---

✅ 步骤已跳过

**跳过步骤**：用户确认（如有歧义）
**跳过理由**：需求已非常明确，无歧义，无需用户确认
**跳过时间**：2025-01-19 12:00:00

---

## 🚀 继续执行

执行下一步：
\```bash
/workflow-execute
\```
```

### 示例2：跳过质量关卡（不推荐）

```
⚠️ 即将跳过步骤

**步骤 ID**：8
**步骤名称**：Codex 方案审查
**所属阶段**：design
**当前状态**：failed

🚨 警告：这是质量关卡步骤！
跳过质量关卡可能导致严重的质量问题。

**评分阈值**：80
**如果跳过**：技术方案未经充分审查，可能存在重大缺陷

---

## ⚠️ 跳过风险

跳过此步骤可能导致：
1. 技术方案存在重大缺陷
2. 后续实施基于不合理的设计
3. 最终交付质量无法保证

---

## 📝 请提供跳过理由

> Codex 服务临时不可用，已人工审查技术方案，确认无重大问题

---

✅ 步骤已跳过

**跳过步骤**：Codex 方案审查
**跳过理由**：Codex 服务临时不可用，已人工审查技术方案，确认无重大问题
**跳过时间**：2025-01-19 12:10:00

⚠️ 已记录风险：质量关卡被跳过，可能影响最终质量

此风险已记录到工作流记忆，在最终报告中会体现。

---

## 🚀 继续执行

执行下一步：
\```bash
/workflow-execute
\```
```

---

## 📊 跳过记录追溯

所有跳过的步骤都会记录在 `workflow-memory.json` 中：

```json
{
  "steps": [
    {
      "id": 8,
      "name": "Codex 方案审查",
      "status": "skipped",
      "skipped_at": "2025-01-19 12:10:00",
      "skipped_reason": "Codex 服务临时不可用，已人工审查",
      "skipped_by": "user"
    }
  ],
  "issues": [
    {
      "severity": "high",
      "type": "quality_gate_skipped",
      "step_id": 8,
      "step_name": "Codex 方案审查",
      "description": "质量关卡被跳过：Codex 服务临时不可用",
      "timestamp": "2025-01-19 12:10:00"
    }
  ]
}
```

在最终的工作流总结报告中，会单独列出所有跳过的步骤和风险。

---

## 🔧 相关命令

```bash
# 重试当前步骤（推荐优先使用）
/workflow-retry-step

# 查看状态
/workflow-status

# 继续执行
/workflow-execute

# 查看任务记忆
cat .claude/workflow-memory.json
```

---

## ⚠️ 最后提醒

**跳过步骤是不得已的选择，应优先考虑：**

1. **重试步骤**：`/workflow-retry-step`
2. **优化内容**：根据反馈改进后重新执行
3. **调整阈值**：手动修改 workflow-memory.json（需充分理由）

**只有在以上方法都不可行时，才考虑跳过步骤。**
