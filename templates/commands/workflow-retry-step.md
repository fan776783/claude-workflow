---
description: 重试当前步骤 - 用于质量关卡失败后优化并重新审查
allowed-tools: Read(*), Write(*), Edit(*), SlashCommand(*)
---

# 重试当前步骤（v2）

用于质量关卡失败或任务执行失败后，根据反馈优化内容并重新执行。

---

## 🎯 使用场景

1. **Codex 代码审查失败**：评分 < 阈值，需要修复代码问题后重新审查
2. **测试失败**：需要修复后重新运行测试
3. **任务执行出错**：需要修正后重新执行

---

## 🔍 执行流程

### Step 1：定位工作流状态

```typescript
const cwd = process.cwd();
const configPath = '.claude/config/project-config.json';

if (!fileExists(configPath)) {
  console.log(`
❌ 未发现项目配置

当前路径：${cwd}

💡 请先执行扫描命令：/scan
  `);
  return;
}

const projectConfig = JSON.parse(readFile(configPath));
const projectId = projectConfig.project?.id;

if (!projectId) {
  console.log(`🚨 项目配置缺少 project.id，请重新执行 /scan`);
  return;
}

// 路径安全校验：projectId 只允许字母数字和连字符
if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
  console.log(`🚨 项目 ID 包含非法字符: ${projectId}`);
  return;
}

const workflowDir = path.join(os.homedir(), '.claude/workflows', projectId);
const statePath = path.join(workflowDir, 'workflow-state.json');

if (!fileExists(statePath)) {
  console.log(`❌ 未发现工作流任务`);
  return;
}
```

### Step 2：读取当前状态

```typescript
const state = JSON.parse(readFile(statePath));

// 校验 tasks_file 路径安全性
if (!state.tasks_file ||
    state.tasks_file.includes('..') ||
    path.isAbsolute(state.tasks_file) ||
    !/^[a-zA-Z0-9_\-\.]+$/.test(state.tasks_file)) {
  console.log(`🚨 任务文件路径不安全: ${state.tasks_file}`);
  return;
}

const tasksPath = path.join(workflowDir, state.tasks_file);

// 二次校验：确保最终路径在 workflowDir 内
if (!tasksPath.startsWith(workflowDir)) {
  console.log(`🚨 路径穿越检测: ${tasksPath}`);
  return;
}

const tasksContent = readFile(tasksPath);

// 检查是否有失败的任务
const failedTaskId = state.progress.failed[state.progress.failed.length - 1];

if (!failedTaskId && state.status !== 'failed') {
  console.log(`
⚠️ 当前没有需要重试的任务

当前任务：${state.current_task}
状态：${state.status}

💡 如果需要执行当前任务，请使用：/workflow-execute
  `);
  return;
}

// 获取需要重试的任务 ID
const retryTaskId = failedTaskId || state.current_task;

// 校验 taskId 格式，防止正则注入
if (!/^T\d+$/.test(retryTaskId)) {
  console.log(`❌ 无效的任务 ID 格式: ${retryTaskId}`);
  return;
}

// 从 tasks.md 提取任务详情（使用转义后的 ID，更宽松的正则）
const escapedId = retryTaskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const taskRegex = new RegExp(
  `## ${escapedId}:\\s*([^\\n]+)\\n\\s*<!-- id: ${escapedId}[^>]*-->\\s*\\n([\\s\\S]*?)(?=## T\\d+:|$)`,
  'm'
);
const taskMatch = tasksContent.match(taskRegex);

if (!taskMatch) {
  console.log(`❌ 无法找到任务 ${retryTaskId}`);
  return;
}

const taskName = taskMatch[1].trim();
const taskBody = taskMatch[2];

// 提取任务属性
const task = {
  id: retryTaskId,
  name: taskName,
  phase: extractField(taskBody, '阶段'),
  file: extractField(taskBody, '文件'),
  requirement: extractField(taskBody, '需求'),
  quality_gate: taskBody.includes('质量关卡**: true'),
  threshold: parseInt(extractField(taskBody, '阈值') || '80')
};

// 获取质量关卡评分（如有）
const gateKey = Object.keys(state.quality_gates || {}).find(
  k => state.quality_gates[k].task_id === retryTaskId
);
const gateInfo = gateKey ? state.quality_gates[gateKey] : null;
```

### Step 3：显示重试信息

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 **重试任务**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**任务 ID**：{{task.id}}
**任务名称**：{{task.name}}
**所属阶段**：{{task.phase}}
{{#if task.file}}**文件**：`{{task.file}}`{{/if}}

---

{{#if gateInfo}}
## ⚠️ 质量关卡失败详情

**评分**：{{gateInfo.actual_score}} / 100
**阈值**：{{gateInfo.threshold}}
**差距**：{{gateInfo.threshold - gateInfo.actual_score}} 分

💡 **建议**：
1. 查看 Codex 审查意见
2. 根据反馈修改代码
3. 确认修改后重新提交

{{/if}}

---

## 📋 重试前检查

请确保已：
1. 查看失败原因或审查意见
2. 完成必要的修改
3. 验证修改不会引入新问题
```

### Step 4：重置任务状态

```typescript
// 从 failed 数组中移除
state.progress.failed = state.progress.failed.filter(id => id !== retryTaskId);

// 确保不在 completed 中
state.progress.completed = state.progress.completed.filter(id => id !== retryTaskId);

// 设置为当前任务
state.current_task = retryTaskId;
state.status = 'in_progress';
state.updated_at = new Date().toISOString();

// 记录重试次数
if (!state.retry_counts) state.retry_counts = {};
state.retry_counts[retryTaskId] = (state.retry_counts[retryTaskId] || 0) + 1;

// 重置质量关卡状态
if (gateKey) {
  state.quality_gates[gateKey].actual_score = null;
  state.quality_gates[gateKey].passed = null;
}

// 保存状态
writeFile(statePath, JSON.stringify(state, null, 2));

// 更新 tasks.md 中的状态
updateTaskStatusInMarkdown(tasksPath, retryTaskId, 'pending');
```

### Step 5：开始重试

```markdown
✅ 任务已重置为待执行状态

**任务 ID**：{{task.id}}
**任务名称**：{{task.name}}
**重试次数**：{{state.retry_counts[retryTaskId]}}

{{#if state.retry_counts[retryTaskId] >= 3}}
⚠️ **警告**：重试次数已达 {{state.retry_counts[retryTaskId]}} 次

建议考虑：
- 重新审视技术方案
- 降低复杂度
- 寻求帮助或协作

{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🚀 重新执行

执行命令：
\```bash
/workflow-execute
\```

💡 **提示**：
- 确保已根据反馈完成修改
- 重试次数过多（> 3次）建议重新评估方案
```

---

## 📦 辅助函数

```typescript
function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*\`?([^\`\\n]+)\`?`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

function updateTaskStatusInMarkdown(filePath: string, taskId: string, newStatus: string) {
  let content = readFile(filePath);

  // 转义 taskId 防止 regex 注入
  const escapedId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 先提取该任务段落
  const taskRegex = new RegExp(
    `(## ${escapedId}:[\\s\\S]*?)(?=\\n## T\\d+:|$)`,
    'm'
  );
  const taskMatch = content.match(taskRegex);

  if (!taskMatch) {
    console.log(`⚠️ 无法找到任务 ${taskId} 进行状态更新`);
    return;
  }

  // 在段落内替换状态
  const taskBlock = taskMatch[1];
  const statusRegex = /(- \*\*状态\*\*: )([^\n]+)/;

  if (!statusRegex.test(taskBlock)) {
    console.log(`⚠️ 任务 ${taskId} 缺少状态字段`);
    return;
  }

  // 使用 replacer 函数避免 newStatus 中的 $ 被解释为替换 token
  const updatedBlock = taskBlock.replace(statusRegex, (_, prefix) => prefix + newStatus);
  content = content.replace(taskBlock, updatedBlock);
  writeFile(filePath, content);
}
```

---

## ⚠️ 注意事项

### 重试次数限制

- **建议**：每个任务重试次数不超过 3 次
- **超过 3 次**：可能需要重新设计方案或调整目标

### 不要过度依赖重试

如果多次重试仍无法通过质量关卡，考虑：
1. 重新分析需求，可能理解有偏差
2. 调整技术方案，选择更简单的实现
3. 咨询团队成员或专家
4. 使用 `/workflow-skip-step` 跳过（需充分理由）

---

## 🔧 相关命令

```bash
# 查看当前状态
/workflow-status

# 继续执行
/workflow-execute

# 跳过当前步骤（慎用）
/workflow-skip-step

# 查看技术方案
cat .claude/tech-design/{task_name}.md
```
