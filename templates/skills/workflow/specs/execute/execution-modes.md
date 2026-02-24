# 执行模式详情

## 概述

workflow execute 支持多种执行模式，以适应不同的工作场景和用户偏好。

## 模式类型

### 1. 单步模式（step）

**触发方式**：
- 命令行：`/workflow execute step`
- 自然语言：`/workflow execute 单步执行`

**行为**：
- 执行一个任务后立即暂停
- 显示任务执行结果
- 提示用户执行 `/workflow execute` 继续

**适用场景**：
- 需要仔细检查每个任务的执行结果
- 调试工作流
- 学习工作流的执行过程

**实现**：
```typescript
if (executionMode === 'step') {
  // 执行当前任务
  await executeTask(currentTask, state, tasksPath, statePath);

  // 立即暂停
  console.log(`
✅ 任务 ${currentTask.id} 执行完成

📍 下一个任务：${nextTaskId}

💡 继续执行：/workflow execute
  `);
  return;
}
```

---

### 2. 阶段模式（phase）

**触发方式**：
- 命令行：`/workflow execute`（默认）
- 自然语言：`/workflow execute 继续` / `/workflow execute 下一阶段`

**行为**：
- 连续执行同一阶段的任务
- 遇到阶段变化时暂停
- 显示阶段完成摘要

**适用场景**：
- 按阶段组织的工作流（design → infra → ui-layout → ...）
- 需要在阶段间进行检查和调整
- 平衡效率和控制

**实现**：
```typescript
if (executionMode === 'phase') {
  const currentPhase = currentTask.phase;

  while (true) {
    // 执行当前任务
    await executeTask(currentTask, state, tasksPath, statePath);

    // 查找下一个任务
    const nextTaskId = findNextTask(tasksContent, state.progress);
    if (!nextTaskId) {
      completeWorkflow(state, statePath, tasksPath);
      return;
    }

    // 提取下一个任务
    const nextTask = extractCurrentTask(tasksContent, nextTaskId);
    if (!nextTask) break;

    // 检查阶段是否变化
    if (nextTask.phase !== currentPhase) {
      console.log(`
✅ 阶段 "${currentPhase}" 完成

📍 下一阶段：${nextTask.phase}
📍 下一个任务：${nextTask.id} - ${nextTask.name}

💡 继续执行：/workflow execute
      `);
      break;
    }

    // 更新当前任务
    state.current_task = nextTaskId;
    Object.assign(currentTask, nextTask);
  }
}
```

---

### 3. 连续模式（quality_gate）

**触发方式**：
- 命令行：`/workflow execute 连续`
- 自然语言：`/workflow execute 执行到质量关卡`

**行为**：
- 连续执行任务直到遇到质量关卡或 git_commit
- 遇到质量关卡时暂停（需要审查）
- 遇到 git_commit 且 `pause_before_commit=true` 时暂停

**适用场景**：
- 快速执行大量简单任务
- 在质量关卡前批量完成实现任务
- 自动化程度高的工作流

**实现**：
```typescript
if (executionMode === 'quality_gate') {
  while (true) {
    // 执行当前任务
    await executeTask(currentTask, state, tasksPath, statePath);

    // 查找下一个任务
    const nextTaskId = findNextTask(tasksContent, state.progress);
    if (!nextTaskId) {
      completeWorkflow(state, statePath, tasksPath);
      return;
    }

    // 提取下一个任务
    const nextTask = extractCurrentTask(tasksContent, nextTaskId);
    if (!nextTask) break;

    // 检查是否为质量关卡
    if (nextTask.quality_gate) {
      console.log(`
✅ 已执行到质量关卡

📍 下一个任务：${nextTask.id} - ${nextTask.name}
🔍 质量关卡：需要代码审查

💡 继续执行：/workflow execute
      `);
      break;
    }

    // 检查是否为 git_commit 且需要暂停
    if (nextTask.actions?.includes('git_commit') && pauseBeforeCommit) {
      console.log(`
✅ 已执行到提交任务

📍 下一个任务：${nextTask.id} - ${nextTask.name}
📝 准备提交代码

💡 继续执行：/workflow execute
      `);
      break;
    }

    // 更新当前任务
    state.current_task = nextTaskId;
    Object.assign(currentTask, nextTask);
  }
}
```

---

### 4. 重试模式（--retry）

**触发方式**：
- 命令行：`/workflow execute --retry`
- 自然语言：`/workflow execute 重试`

**行为**：
- 检查工作流状态是否为 `failed`
- 重新执行失败的任务
- 成功后继续工作流（根据原执行模式）

**适用场景**：
- 任务执行失败后修复问题
- 临时性错误（网络、权限等）
- 调试和测试

**实现**：
```typescript
async function executeRetryMode() {
  // 读取状态
  const state = JSON.parse(readFile(statePath));

  // 检查状态
  if (state.status !== 'failed') {
    console.log(`
⚠️ 当前工作流状态不是 failed，无需重试

当前状态：${state.status}
当前任务：${state.current_task}

💡 继续执行：/workflow execute
    `);
    return;
  }

  console.log(`
🔄 重试模式

失败任务：${state.current_task}
失败原因：${state.failure_reason || '未知'}

开始重试...
  `);

  // 重置状态
  state.status = 'running';
  state.failure_reason = null;
  writeFile(statePath, JSON.stringify(state, null, 2));

  // 重新执行当前任务
  const tasksContent = readFile(tasksPath);
  const currentTask = extractCurrentTask(tasksContent, state.current_task);

  if (!currentTask) {
    console.log(`❌ 无法找到任务 ${state.current_task}`);
    return;
  }

  try {
    await executeTask(currentTask, state, tasksPath, statePath);

    console.log(`
✅ 重试成功

任务 ${currentTask.id} 已完成

💡 继续执行：/workflow execute
    `);
  } catch (error) {
    console.log(`
❌ 重试失败

错误信息：${error.message}

请修复问题后再次重试：/workflow execute --retry
    `);

    state.status = 'failed';
    state.failure_reason = error.message;
    writeFile(statePath, JSON.stringify(state, null, 2));
  }
}
```

---

### 5. 跳过模式（--skip）

**触发方式**：
- 命令行：`/workflow execute --skip`
- 自然语言：`/workflow execute 跳过`

**行为**：
- 标记当前任务为 `skipped`
- 移动到下一个任务
- 继续工作流（根据原执行模式）

**适用场景**：
- 任务暂时无法执行（等待外部依赖）
- 任务不再需要（需求变更）
- 临时绕过问题任务

**警告**：
- 跳过任务可能导致后续任务失败（依赖关系）
- 跳过的任务不会被执行，需要手动补充
- 慎用此模式

**实现**：
```typescript
async function executeSkipMode() {
  // 读取状态
  const state = JSON.parse(readFile(statePath));
  const tasksContent = readFile(tasksPath);
  const currentTask = extractCurrentTask(tasksContent, state.current_task);

  if (!currentTask) {
    console.log(`❌ 无法找到任务 ${state.current_task}`);
    return;
  }

  console.log(`
⚠️ 跳过模式

当前任务：${currentTask.id} - ${currentTask.name}

⚠️ 警告：跳过任务可能导致后续任务失败

确认跳过？
  `);

  const confirm = await AskUserQuestion({
    questions: [{
      question: "确认跳过当前任务？",
      header: "跳过确认",
      multiSelect: false,
      options: [
        { label: "确认跳过", description: "标记任务为 skipped 并继续" },
        { label: "取消", description: "返回正常执行" }
      ]
    }]
  });

  if (confirm === "取消") {
    console.log("✅ 已取消跳过");
    return;
  }

  // 标记为 skipped
  addUnique(state.progress.skipped, currentTask.id);

  // 更新 tasks.md
  const updatedContent = updateTaskStatus(tasksContent, currentTask.id, 'skipped');
  writeFile(tasksPath, updatedContent);

  // 查找下一个任务
  const nextTaskId = findNextTask(tasksContent, state.progress);
  if (!nextTaskId) {
    completeWorkflow(state, statePath, tasksPath);
    return;
  }

  // 更新状态
  state.current_task = nextTaskId;
  state.updated_at = new Date().toISOString();
  writeFile(statePath, JSON.stringify(state, null, 2));

  console.log(`
✅ 已跳过任务 ${currentTask.id}

📍 下一个任务：${nextTaskId}

💡 继续执行：/workflow execute
  `);
}
```

---

## 兜底机制

为防止上下文溢出，所有模式都有兜底机制：

### 连续执行计数限制

```typescript
// 连续执行任务计数
state.consecutive_count = (state.consecutive_count || 0) + 1;

// 动态计算最大连续任务数
const taskComplexity = detectTaskComplexity(currentTask);
const maxConsecutiveTasks = calculateDynamicMaxTasks(
  taskComplexity,
  state.contextMetrics.usagePercent
);

// 检查是否达到上限
if (state.consecutive_count >= maxConsecutiveTasks) {
  console.log(`
⚠️ 已连续执行 ${state.consecutive_count} 个任务，达到上限

为避免上下文溢出，建议暂停检查。

💡 继续执行：/workflow execute
  `);

  // 重置计数
  state.consecutive_count = 0;
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}
```

### 上下文使用率限制

```typescript
// 检查上下文使用率
if (state.contextMetrics.usagePercent > state.contextMetrics.dangerThreshold) {
  console.log(`
⚠️ 上下文使用率过高 (${state.contextMetrics.usagePercent}%)

为避免上下文溢出，强制暂停。

建议：
- 使用 subagent 模式（自动启用）
- 减少连续执行任务数
- 清理不必要的文件

💡 继续执行：/workflow execute
  `);

  // 重置计数
  state.consecutive_count = 0;
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}
```

---

## 模式优先级

执行模式的优先级（从高到低）：

1. **命令行参数**：`/workflow execute step`
2. **state 配置**：`state.execution_mode`
3. **默认值**：`phase`

```typescript
const executionMode = executionModeOverride || state.execution_mode || 'phase';
```

---

## Subagent 模式

当启用 subagent 模式时，所有执行模式的行为保持不变，但任务执行方式改变：

**直接模式**：
- 在当前上下文中执行任务
- 上下文累积，可能溢出

**Subagent 模式**：
- 使用 Task tool 在独立 subagent 中执行
- 每个任务有独立的上下文
- 避免上下文累积

```typescript
if (useSubagent) {
  // 使用 Task tool 执行
  await executeTaskInSubagent(currentTask, state, tasksPath, statePath);
} else {
  // 直接执行
  await executeTaskDirect(currentTask, state, tasksPath, statePath);
}
```

详见 `specs/workflow/subagent-routing.md`。
