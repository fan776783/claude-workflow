---
description: 解除任务阻塞依赖 - 当后端接口或设计稿就绪时解除相关任务的阻塞状态
argument-hint: "<api_spec|design_spec> 解除指定类型的依赖阻塞"
allowed-tools: Read(*), Write(*), Bash(*), AskUserQuestion(*)
---

# 解除任务阻塞

渐进式工作流的依赖解除命令。当外部依赖就绪时，解除相关任务的阻塞状态。

## 依赖类型

| 依赖标识 | 说明 | 触发时机 |
|---------|------|----------|
| `api_spec` | 后端接口规格 | 后端 API 文档/Swagger 已就绪 |
| `design_spec` | 设计稿/UI 规格 | Figma/设计稿已交付 |

## 使用方法

```bash
/workflow-unblock api_spec     # 后端接口已就绪
/workflow-unblock design_spec  # 设计稿已就绪
/workflow-unblock all          # 解除所有阻塞
```

---

## 🎯 执行流程

### Step 0：解析参数

```typescript
const args = $ARGUMENTS.join(' ').trim();
const validDeps = ['api_spec', 'design_spec', 'all'];

if (!args || !validDeps.includes(args)) {
  console.log(`
❌ 请指定要解除的依赖类型

用法：
  /workflow-unblock api_spec     # 后端接口已就绪
  /workflow-unblock design_spec  # 设计稿已就绪
  /workflow-unblock all          # 解除所有阻塞

当前支持的依赖类型：
  - api_spec: 后端接口规格（API 文档、Swagger 等）
  - design_spec: 设计稿规格（Figma、设计稿等）
  `);
  return;
}

const depToUnblock = args;
```

---

### Step 1：加载工作流状态

```typescript
const configPath = '.claude/config/project-config.json';

if (!fileExists(configPath)) {
  console.log(`🚨 项目配置不存在，请先执行 /scan`);
  return;
}

const projectConfig = JSON.parse(readFile(configPath));
const projectId = projectConfig.project?.id;

if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
  console.log(`🚨 项目 ID 无效，请重新执行 /scan`);
  return;
}

const workflowDir = path.join(os.homedir(), '.claude/workflows', projectId);
const statePath = path.join(workflowDir, 'workflow-state.json');

if (!fileExists(statePath)) {
  console.log(`🚨 工作流未启动，请先执行 /workflow-start`);
  return;
}

const state = JSON.parse(readFile(statePath));

// 防御性初始化：兼容老版本状态文件
state.unblocked = Array.isArray(state.unblocked) ? state.unblocked : [];
state.progress = state.progress || { completed: [], blocked: [], skipped: [], failed: [] };
state.progress.blocked = Array.isArray(state.progress.blocked) ? state.progress.blocked : [];

if (state.mode !== 'progressive') {
  console.log(`
⚠️ 当前工作流不是渐进式模式

当前模式：${state.mode}
此命令仅适用于渐进式工作流（mode: progressive）
  `);
  return;
}
```

---

### Step 2：更新依赖状态

```typescript
// 确定要解除的依赖列表
const depsToUnblock = depToUnblock === 'all'
  ? ['api_spec', 'design_spec']
  : [depToUnblock];

// 检查是否已解除
const alreadyUnblocked = depsToUnblock.filter(d => state.unblocked.includes(d));
const newlyUnblocked = depsToUnblock.filter(d => !state.unblocked.includes(d));

if (newlyUnblocked.length === 0) {
  console.log(`
⚠️ 依赖已解除

已解除的依赖：${state.unblocked.join(', ') || '（无）'}

无需重复操作。
  `);
  return;
}

// 更新 unblocked 列表
state.unblocked = [...new Set([...state.unblocked, ...newlyUnblocked])];
state.updated_at = new Date().toISOString();

console.log(`
✅ 依赖已解除：${newlyUnblocked.join(', ')}

已解除的依赖：${state.unblocked.join(', ')}
`);
```

---

### Step 3：更新任务状态

```typescript
// 读取任务文件（使用 resolveUnder 防止路径遍历）
const tasksPath = resolveUnder(workflowDir, state.tasks_file);
if (!tasksPath) {
  console.log(`🚨 任务文件路径无效：${state.tasks_file}`);
  return;
}
if (!fileExists(tasksPath)) {
  console.log(`🚨 任务文件不存在：${tasksPath}`);
  return;
}
let tasksContent = readFile(tasksPath);

// 解析任务，找出需要解除阻塞的任务（兼容 ## 和 ### 格式）
const taskPattern = /##+\s*(T\d+):\s*(.+?)\r?\n[\s\S]*?-\s*\*\*阻塞依赖\*\*:\s*`(.+?)`[\s\S]*?-\s*\*\*状态\*\*:\s*blocked/g;
const unblockedTasks = [];

let match;
while ((match = taskPattern.exec(tasksContent)) !== null) {
  const [, taskId, taskName, blockedByStr] = match;
  const blockedBy = blockedByStr.split(', ').map(s => s.trim());

  // 检查是否所有依赖都已解除
  const remainingDeps = blockedBy.filter(dep => !state.unblocked.includes(dep));

  if (remainingDeps.length === 0) {
    unblockedTasks.push({ id: taskId, name: taskName });
  }
}

// 更新任务文件中的状态（兼容 ## 和 ### 格式）
unblockedTasks.forEach(task => {
  tasksContent = tasksContent.replace(
    new RegExp(`(##+\\s*${task.id}:[\\s\\S]*?-\\s*\\*\\*状态\\*\\*:\\s*)blocked`, 'g'),
    '$1pending'
  );
});

// 更新 progress.blocked 列表
state.progress.blocked = state.progress.blocked.filter(
  id => !unblockedTasks.some(t => t.id === id)
);

// 如果有任务解除阻塞，更新工作流状态
if (unblockedTasks.length > 0) {
  // 如果当前没有 current_task，设置第一个解除阻塞的任务
  if (!state.current_task) {
    state.current_task = unblockedTasks[0].id;
  }

  // 如果工作流状态是 blocked，改为 running
  if (state.status === 'blocked') {
    state.status = 'running';
  }

  // 写入更新后的任务文件
  writeFile(tasksPath, tasksContent);
}

// 写入更新后的状态文件
writeFile(statePath, JSON.stringify(state, null, 2));
```

---

### Step 4：输出结果

```typescript
if (unblockedTasks.length > 0) {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔓 **已解除阻塞的任务**：

${unblockedTasks.map(t => `- ${t.id}: ${t.name}`).join('\n')}

**工作流状态**：${state.status}
**当前任务**：${state.current_task}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **下一步**

\`\`\`bash
/workflow-execute   # 执行下一个任务
/workflow-status    # 查看当前状态
\`\`\`
`);
} else {
  // 查找仍然阻塞的任务（兼容 ## 和 ### 格式）
  const stillBlockedPattern = /##+\s*(T\d+):\s*(.+?)\r?\n[\s\S]*?-\s*\*\*阻塞依赖\*\*:\s*`(.+?)`[\s\S]*?-\s*\*\*状态\*\*:\s*blocked/g;
  const stillBlocked = [];

  while ((match = stillBlockedPattern.exec(tasksContent)) !== null) {
    const [, taskId, taskName, blockedByStr] = match;
    const remainingDeps = blockedByStr.split(', ').filter(dep => !state.unblocked.includes(dep));
    if (remainingDeps.length > 0) {
      stillBlocked.push({ id: taskId, name: taskName, deps: remainingDeps });
    }
  }

  if (stillBlocked.length > 0) {
    console.log(`
⏳ **仍有任务被阻塞**：

${stillBlocked.map(t => `- ${t.id}: ${t.name} [等待: ${t.deps.join(', ')}]`).join('\n')}

**需要解除的依赖**：
${[...new Set(stillBlocked.flatMap(t => t.deps))].map(d => `  /workflow-unblock ${d}`).join('\n')}
`);
  } else {
    console.log(`
✅ 所有任务均已解除阻塞！

执行 /workflow-execute 继续工作流。
`);
  }
}
```

---

## 🔄 相关命令

```bash
# 查看状态
/workflow-status

# 执行下一步
/workflow-execute

# 启动工作流
/workflow-start
```
