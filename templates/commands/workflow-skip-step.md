---
description: 跳过当前步骤 - 慎用，用于特殊情况下跳过某个步骤
allowed-tools: Read(*), Write(*), Edit(*), AskUserQuestion(*)
---

# 跳过当前步骤（v2）

⚠️ **慎用功能**：跳过步骤可能导致后续问题，仅在特殊情况下使用。

---

## 🎯 适用场景

### ✅ 合理的跳过场景

1. **条件步骤不需要执行**：
   - 任务不适用于当前项目
   - 已通过其他方式完成

2. **外部因素无法执行**：
   - Codex 服务临时不可用
   - 某个工具暂时无法使用

3. **已手动完成**：
   - 已有详细技术方案，跳过方案生成步骤
   - 已手动完成验证，跳过自动验证步骤

### ❌ 不应跳过的场景

- **质量关卡**：Codex 审查、测试验证等关键步骤
- **核心实施步骤**：代码编写、测试编写等
- **仅因为评分不达标**：应该使用 `/workflow-retry-step` 而非跳过

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

### Step 2：读取当前任务

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

const currentTaskId = state.current_task;

if (!currentTaskId) {
  console.log(`
⚠️ 当前没有可跳过的任务

状态：${state.status}

💡 如果工作流已完成，无需跳过
  `);
  return;
}

// 校验 taskId 格式，防止正则注入
if (!/^T\d+$/.test(currentTaskId)) {
  console.log(`❌ 无效的任务 ID 格式: ${currentTaskId}`);
  return;
}

// 从 tasks.md 提取任务详情（使用转义后的 ID，更宽松的正则）
const escapedId = currentTaskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const taskRegex = new RegExp(
  `## ${escapedId}:\\s*([^\\n]+)\\n\\s*<!-- id: ${escapedId}[^>]*-->\\s*\\n([\\s\\S]*?)(?=## T\\d+:|$)`,
  'm'
);
const taskMatch = tasksContent.match(taskRegex);

if (!taskMatch) {
  console.log(`❌ 无法找到任务 ${currentTaskId}`);
  return;
}

const taskName = taskMatch[1].trim();
const taskBody = taskMatch[2];

const task = {
  id: currentTaskId,
  name: taskName,
  phase: extractField(taskBody, '阶段'),
  file: extractField(taskBody, '文件'),
  quality_gate: taskBody.includes('质量关卡**: true'),
  threshold: parseInt(extractField(taskBody, '阈值') || '80')
};
```

### Step 3：显示跳过警告

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ **即将跳过任务**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**任务 ID**：{{task.id}}
**任务名称**：{{task.name}}
**所属阶段**：{{task.phase}}
{{#if task.file}}**文件**：`{{task.file}}`{{/if}}

{{#if task.quality_gate}}
🚨 **严重警告**：这是质量关卡任务！

跳过质量关卡可能导致：
- 代码质量无法保证
- 潜在问题无法及时发现
- 最终交付物存在风险

**阈值要求**：{{task.threshold}} 分
{{/if}}

---

## ⚠️ 跳过风险

跳过此步骤可能导致：
1. 后续步骤缺少必要的输入
2. 质量无法保证
3. 最终交付物存在缺陷

---

## 📝 请提供跳过理由

**必须提供跳过理由以便追溯**
```

### Step 4：获取跳过理由

```typescript
const reason = await AskUserQuestion({
  questions: [{
    question: "请选择跳过理由",
    header: "跳过理由",
    multiSelect: false,
    options: [
      { label: "任务不适用", description: "当前项目不需要此任务" },
      { label: "已手动完成", description: "已通过其他方式完成此任务" },
      { label: "外部服务不可用", description: "Codex 等服务暂时不可用" },
      { label: "时间紧迫", description: "截止日期紧迫，需要跳过" }
    ]
  }]
});

if (!reason || reason.trim().length === 0) {
  console.log(`❌ 必须提供跳过理由`);
  return;
}
```

### Step 5：更新状态

```typescript
// 添加到 skipped 数组
state.progress.skipped.push(currentTaskId);

// 从 failed 数组中移除（如果存在）
state.progress.failed = state.progress.failed.filter(id => id !== currentTaskId);

// 找到下一个任务
const nextTaskId = findNextTask(tasksContent, state.progress);

if (nextTaskId) {
  state.current_task = nextTaskId;
  state.status = 'in_progress';  // 恢复为进行中状态
} else {
  state.current_task = null;
  state.status = 'completed';
}

state.updated_at = new Date().toISOString();
state.failure_reason = null;  // 清除失败原因

// 如果是质量关卡，记录风险
if (task.quality_gate) {
  if (!state.issues) state.issues = [];
  state.issues.push({
    severity: 'high',
    type: 'quality_gate_skipped',
    task_id: currentTaskId,
    task_name: task.name,
    reason: reason,
    timestamp: new Date().toISOString()
  });
}

// 记录跳过信息
if (!state.skipped_info) state.skipped_info = {};
state.skipped_info[currentTaskId] = {
  reason: reason,
  skipped_at: new Date().toISOString()
};

// 保存状态
writeFile(statePath, JSON.stringify(state, null, 2));

// 更新 tasks.md 中的状态
updateTaskStatusInMarkdown(tasksPath, currentTaskId, `⏭️ skipped (${reason})`);
```

### Step 6：显示确认信息

```markdown
✅ 任务已跳过

**跳过任务**：{{task.id}} - {{task.name}}
**跳过理由**：{{reason}}
**跳过时间**：{{new Date().toISOString()}}

{{#if task.quality_gate}}
⚠️ **已记录风险**：质量关卡被跳过

此风险已记录到工作流状态，在最终报告中会体现。
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{#if nextTaskId}}
## 🚀 继续执行

**下一个任务**：{{nextTaskId}}

执行命令：
\```bash
/workflow-execute
\```

{{else}}
## 🎉 工作流已完成

所有任务已执行或跳过。

查看状态：
\```bash
/workflow-status
\```
{{/if}}
```

---

## 📦 辅助函数

```typescript
function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*\`?([^\`\\n]+)\`?`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

function findNextTask(content: string, progress: Progress): string | null {
  const taskIds = [...content.matchAll(/## (T\d+):/g)].map(m => m[1]);

  for (const id of taskIds) {
    if (!progress.completed.includes(id) &&
        !progress.skipped.includes(id) &&
        !progress.failed.includes(id)) {
      return id;
    }
  }

  return null;
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

## ⚠️ 最后提醒

**跳过步骤是不得已的选择，应优先考虑：**

1. **重试步骤**：`/workflow-retry-step`
2. **优化内容**：根据反馈改进后重新执行
3. **寻求帮助**：咨询团队成员

**只有在以上方法都不可行时，才考虑跳过步骤。**

---

## 🔧 相关命令

```bash
# 重试当前步骤（推荐优先使用）
/workflow-retry-step

# 查看状态
/workflow-status

# 继续执行
/workflow-execute
```
