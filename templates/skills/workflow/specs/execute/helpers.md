# 辅助函数详情

## 概述

execute 流程中使用的辅助函数，用于任务查找、状态更新、完成检查等。

## 任务查找函数

### findNextTask

查找下一个待执行的任务。

```typescript
function findNextTask(
  tasksContent: string,
  progress: {
    completed: string[];
    blocked: string[];
    skipped: string[];
    failed: string[];
  }
): string | null {
  // 提取所有任务 ID
  const taskIds = extractAllTaskIds(tasksContent);

  // 过滤已完成、已跳过、失败的任务
  const excludedIds = [
    ...progress.completed,
    ...progress.skipped,
    ...progress.failed
  ];

  // 查找第一个未执行的任务
  for (const taskId of taskIds) {
    if (!excludedIds.includes(taskId)) {
      // 检查是否被阻塞
      if (progress.blocked?.includes(taskId)) {
        continue;
      }
      return taskId;
    }
  }

  return null;
}
```

### extractAllTaskIds

从任务清单中提取所有任务 ID。

```typescript
function extractAllTaskIds(content: string): string[] {
  const regex = /##+ (T\d+):/g;
  const ids: string[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    ids.push(match[1]);
  }

  return ids;
}
```

### countTasks

统计任务总数。

```typescript
function countTasks(content: string): number {
  return extractAllTaskIds(content).length;
}
```

---

## 状态更新函数

### updateTaskStatus

更新任务清单中的任务状态（添加状态 emoji）。

```typescript
function updateTaskStatus(
  content: string,
  taskId: string,
  status: 'completed' | 'skipped' | 'failed' | 'in_progress'
): string {
  // 校验 taskId 格式
  if (!validateTaskId(taskId)) {
    throw new Error(`Invalid task ID: ${taskId}`);
  }

  const escapedId = escapeRegExp(taskId);
  const emoji = getStatusEmoji(status);

  // 匹配任务标题行
  const regex = new RegExp(
    `(##+ ${escapedId}:\\s*)(.+?)(?:${STATUS_EMOJI_REGEX.source})?(\\s*\\n)`,
    'gm'
  );

  // 替换：移除旧 emoji，添加新 emoji
  return content.replace(regex, (match, prefix, title, suffix) => {
    const cleanTitle = title.trim();
    return `${prefix}${cleanTitle} ${emoji}${suffix}`;
  });
}
```

### getStatusEmoji

获取状态对应的 emoji。

```typescript
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'completed': return '✅';
    case 'in_progress': return '⏳';
    case 'failed': return '❌';
    case 'skipped': return '⏭️';
    default: return '';
  }
}
```

### extractStatusFromTitle

从任务标题中提取状态 emoji。

```typescript
const STATUS_EMOJI_REGEX = /(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;

function extractStatusFromTitle(title: string): string | null {
  const match = title.match(STATUS_EMOJI_REGEX);
  if (!match) return null;

  const emoji = match[0].trim();
  switch (emoji) {
    case '✅': return 'completed';
    case '⏳': return 'in_progress';
    case '❌': return 'failed';
    case '⏭️':
    case '⏭\uFE0F': return 'skipped';
    default: return null;
  }
}
```

---

## 字段提取函数

### extractField

从任务内容中提取字段值。

```typescript
function extractField(body: string, fieldName: string): string | null {
  // 兼容两种格式：
  // 1. - **字段**: 值
  // 2. **字段**: 值
  const regex = new RegExp(
    `^\\s*-?\\s*\\*\\*${escapeRegExp(fieldName)}\\*\\*\\s*:\\s*(.+?)$`,
    'mi'
  );

  const match = body.match(regex);
  if (!match) return null;

  // 清理值：移除反引号、trim
  return match[1].replace(/`/g, '').trim();
}
```

### extractConstraints

从任务清单中提取全局约束。

```typescript
function extractConstraints(content: string): string[] {
  // 查找"约束"章节
  const regex = /##\s*约束[^\n]*\n([\s\S]*?)(?=\n##|$)/i;
  const match = content.match(regex);

  if (!match) return [];

  // 提取列表项
  const constraintsText = match[1];
  const lines = constraintsText.split('\n');
  const constraints: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      constraints.push(trimmed.substring(2).trim());
    }
  }

  return constraints;
}
```

### parseQualityGate

解析任务是否为质量关卡。

```typescript
function parseQualityGate(body: string): boolean {
  const value = extractField(body, '质量关卡');
  if (!value) return false;

  return value.toLowerCase() === 'true' || value === '是';
}
```

---

## 工作流完成函数

### completeWorkflow

标记工作流为已完成。

```typescript
function completeWorkflow(
  state: any,
  statePath: string,
  tasksPath: string
): void {
  // 更新状态
  state.status = 'completed';
  state.phase = 'done';
  state.current_task = null;
  state.updated_at = new Date().toISOString();
  state.completed_at = new Date().toISOString();

  writeFile(statePath, JSON.stringify(state, null, 2));

  // 统计信息
  const totalTasks = countTasks(readFile(tasksPath));
  const completedCount = state.progress.completed.length;
  const skippedCount = state.progress.skipped?.length || 0;
  const failedCount = state.progress.failed?.length || 0;

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 工作流执行完成！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 **执行统计**

- 总任务数：${totalTasks}
- 已完成：${completedCount}
- 已跳过：${skippedCount}
- 失败：${failedCount}

📂 **工作流目录**：${path.dirname(statePath)}
📄 **任务清单**：${state.tasks_file}
📝 **技术方案**：${state.tech_design}

💡 **下一步**

- 查看工作流状态：/workflow status
- 归档工作流：/workflow archive

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}
```

---

## 工具函数

### addUnique

向数组中添加唯一元素。

```typescript
function addUnique<T>(arr: T[], item: T): void {
  if (!arr.includes(item)) {
    arr.push(item);
  }
}
```

### escapeRegExp

转义正则表达式特殊字符。

```typescript
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

### validateTaskId

验证任务 ID 格式。

```typescript
function validateTaskId(taskId: string): boolean {
  return /^T\d+$/.test(taskId);
}
```

---

## 依赖检查函数

### checkTaskDependencies

检查任务依赖是否满足。

```typescript
function checkTaskDependencies(
  task: Task,
  progress: {
    completed: string[];
    skipped: string[];
    failed: string[];
  }
): { satisfied: boolean; missing: string[] } {
  if (!task.depends) {
    return { satisfied: true, missing: [] };
  }

  const dependencies = task.depends.split(',').map(d => d.trim());
  const missing: string[] = [];

  for (const dep of dependencies) {
    if (!progress.completed.includes(dep)) {
      missing.push(dep);
    }
  }

  return {
    satisfied: missing.length === 0,
    missing
  };
}
```

### checkBlockedDependencies

检查阻塞依赖是否解除。

```typescript
function checkBlockedDependencies(
  task: Task,
  unblocked: string[]
): { satisfied: boolean; missing: string[] } {
  if (!task.blocked_by || task.blocked_by.length === 0) {
    return { satisfied: true, missing: [] };
  }

  const missing = task.blocked_by.filter(dep => !unblocked.includes(dep));

  return {
    satisfied: missing.length === 0,
    missing
  };
}
```

---

## 上下文记录函数

### recordContextUsage

记录任务执行的上下文使用情况。

```typescript
function recordContextUsage(
  state: any,
  taskId: string,
  estimatedTokens: number
): void {
  if (!state.contextMetrics) {
    state.contextMetrics = {
      estimatedTokens: 0,
      warningThreshold: 60,
      dangerThreshold: 80,
      maxConsecutiveTasks: 5,
      usagePercent: 0,
      history: []
    };
  }

  // 添加历史记录
  state.contextMetrics.history.push({
    taskId,
    tokens: estimatedTokens,
    timestamp: new Date().toISOString()
  });

  // 保留最近 20 条记录
  if (state.contextMetrics.history.length > 20) {
    state.contextMetrics.history = state.contextMetrics.history.slice(-20);
  }
}
```

---

## 任务复杂度检测

### detectTaskComplexity

检测任务复杂度。

```typescript
function detectTaskComplexity(task: Task): 'simple' | 'medium' | 'complex' {
  const actions = (task.actions || '').split(',').length;
  const hasMultipleFiles = (task.file || '').includes(',');
  const isQualityGate = task.quality_gate;
  const hasDesignRef = !!task.design_ref;

  if (isQualityGate || hasDesignRef || hasMultipleFiles) return 'complex';
  if (actions > 2) return 'medium';
  return 'simple';
}
```

---

## 进度计算函数

### calculateProgress

计算工作流进度百分比。

```typescript
function calculateProgress(
  totalTasks: number,
  progress: {
    completed: string[];
    skipped: string[];
    failed: string[];
  }
): number {
  const finishedCount = progress.completed.length +
                        progress.skipped.length +
                        progress.failed.length;

  return Math.round((finishedCount / totalTasks) * 100);
}
```

### generateProgressBar

生成进度条。

```typescript
function generateProgressBar(percent: number): string {
  const filled = Math.round(percent / 5);
  let bar = '';

  for (let i = 0; i < 20; i++) {
    if (i < filled) {
      bar += '█';
    } else {
      bar += '░';
    }
  }

  return `[${bar}] ${percent}%`;
}
```

---

## 错误处理函数

### handleTaskError

处理任务执行错误。

```typescript
function handleTaskError(
  error: Error,
  task: Task,
  state: any,
  statePath: string
): void {
  console.log(`
❌ 任务执行失败

任务：${task.id} - ${task.name}
错误：${error.message}

请使用以下命令：
- 重试当前步骤：/workflow execute --retry
- 跳过当前步骤：/workflow execute --skip（慎用）
  `);

  // 更新状态
  state.status = 'failed';
  state.failure_reason = error.message;
  state.updated_at = new Date().toISOString();

  // 记录失败任务
  addUnique(state.progress.failed, task.id);

  writeFile(statePath, JSON.stringify(state, null, 2));
}
```

---

## 文件操作函数

### ensureDir

确保目录存在。

```typescript
function ensureDir(dirPath: string): void {
  if (!fileExists(dirPath)) {
    // 使用 mkdir -p 创建目录（包括父目录）
    Bash({ command: `mkdir -p "${dirPath}"` });
  }
}
```

### copyFile

复制文件。

```typescript
function copyFile(src: string, dest: string): void {
  Bash({ command: `cp "${src}" "${dest}"` });
}
```

---

## 时间格式化函数

### formatDuration

格式化时间间隔。

```typescript
function formatDuration(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMs = end.getTime() - start.getTime();

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
```

### formatTimestamp

格式化时间戳。

```typescript
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
```

---

## 并行执行函数

### canRunInParallel

检查两个任务是否可以并行执行。

```typescript
function canRunInParallel(
  taskA: Task,
  taskB: Task,
  allTasks: Task[]
): boolean {
  // 1. 文件独立：操作的文件没有交集
  if (taskA.file && taskB.file && taskA.file === taskB.file) return false;

  // 2. 直接依赖检查（支持逗号分隔的多依赖）
  const aDeps = (taskA.depends || '').split(',').map(s => s.trim()).filter(Boolean);
  const bDeps = (taskB.depends || '').split(',').map(s => s.trim()).filter(Boolean);
  if (aDeps.includes(taskB.id) || bDeps.includes(taskA.id)) return false;

  // 3. 传递依赖检查：A 的任何上游是否包含 B（或反之）
  if (hasTransitiveDependency(taskA, taskB, allTasks)) return false;
  if (hasTransitiveDependency(taskB, taskA, allTasks)) return false;

  // 4. 共享状态检查：同时操作 store/config/constants/types 目录
  const sharedPaths = ['store', 'config', 'constants', 'types', 'shared'];
  const aIsShared = sharedPaths.some(p => (taskA.file || '').includes(`/${p}/`));
  const bIsShared = sharedPaths.some(p => (taskB.file || '').includes(`/${p}/`));
  if (aIsShared && bIsShared) return false;

  // 5. Import 路径检查：A 创建的文件不被 B 的 requirement 引用（或反之）
  if (taskA.file && taskB.requirement?.includes(taskA.file)) return false;
  if (taskB.file && taskA.requirement?.includes(taskB.file)) return false;

  return true;
}
```

### hasTransitiveDependency

检查传递依赖关系（A 是否间接依赖 B）。

```typescript
function hasTransitiveDependency(
  taskA: Task,
  taskB: Task,
  allTasks: Task[],
  visited: Set<string> = new Set()
): boolean {
  if (visited.has(taskA.id)) return false;
  visited.add(taskA.id);

  if (!taskA.depends) return false;

  // 支持逗号分隔的多依赖
  const deps = taskA.depends.split(',').map(s => s.trim()).filter(Boolean);

  for (const depId of deps) {
    if (depId === taskB.id) return true;

    const upstream = allTasks.find(t => t.id === depId);
    if (upstream && hasTransitiveDependency(upstream, taskB, allTasks, visited)) {
      return true;
    }
  }

  return false;
}
```

### findParallelGroup

从当前阶段的 pending 任务中找出可并行执行的任务组。

```typescript
function findParallelGroup(
  tasksContent: string,
  progress: Progress,
  allTasks: Task[]
): string[][] {
  // 1. 找出当前阶段所有 pending 且未阻塞的任务
  const pendingTasks = allTasks.filter(t =>
    !progress.completed.includes(t.id) &&
    !progress.blocked.includes(t.id) &&
    !progress.skipped.includes(t.id) &&
    !progress.failed.includes(t.id)
  );

  if (pendingTasks.length < 2) return [];

  // 2. 按阶段分组
  const currentPhase = pendingTasks[0]?.phase;
  const samePhase = pendingTasks.filter(t => t.phase === currentPhase);

  if (samePhase.length < 2) return [];

  // 3. 贪心分组：逐个检查独立性
  const groups: string[][] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < samePhase.length; i++) {
    if (assigned.has(samePhase[i].id)) continue;

    const group = [samePhase[i].id];
    assigned.add(samePhase[i].id);

    for (let j = i + 1; j < samePhase.length; j++) {
      if (assigned.has(samePhase[j].id)) continue;

      // 检查与组内所有任务的独立性
      const canParallel = group.every(gId => {
        const gTask = allTasks.find(t => t.id === gId)!;
        return canRunInParallel(gTask, samePhase[j], allTasks);
      });

      if (canParallel) {
        group.push(samePhase[j].id);
        assigned.add(samePhase[j].id);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  return groups;
}
```

### updateParallelGroupStatus

更新并行执行批次状态。

```typescript
function updateParallelGroupStatus(
  state: WorkflowState,
  groupId: string,
  status: 'running' | 'completed' | 'failed',
  conflictDetected: boolean = false
): void {
  const group = state.parallel_groups.find(g => g.id === groupId);
  if (group) {
    group.status = status;
    group.conflict_detected = conflictDetected;
    if (status !== 'running') {
      group.completed_at = new Date().toISOString();
    }
  }
}
```

---

## 使用示例

```typescript
// 查找下一个任务
const nextTaskId = findNextTask(tasksContent, state.progress);

// 更新任务状态
const updatedContent = updateTaskStatus(tasksContent, 'T1', 'completed');
writeFile(tasksPath, updatedContent);

// 检查依赖
const depCheck = checkTaskDependencies(currentTask, state.progress);
if (!depCheck.satisfied) {
  console.log(`任务依赖未满足：${depCheck.missing.join(', ')}`);
}

// 记录上下文使用
recordContextUsage(state, currentTask.id, estimatedTokens);

// 计算进度
const progressPercent = calculateProgress(totalTasks, state.progress);
console.log(generateProgressBar(progressPercent));

// 完成工作流
if (!nextTaskId) {
  completeWorkflow(state, statePath, tasksPath);
}
```
