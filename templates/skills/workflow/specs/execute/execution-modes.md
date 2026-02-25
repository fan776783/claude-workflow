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

### 并行执行（Subagent 模式）

当 Subagent 模式启用时，同阶段且通过独立性检查的任务可并行执行。

**触发条件**：
- Subagent 模式已启用
- 当前阶段有 ≥ 2 个 pending 任务
- 任务通过独立性检查（`findParallelGroup()`）

**执行流程**：

```typescript
if (useSubagent) {
  const allTasks = parseAllTasks(tasksContent);
  const parallelGroups = findParallelGroup(tasksContent, state.progress, allTasks);

  if (parallelGroups.length > 0) {
    const group = parallelGroups[0];
    const groupId = `PG-${String((state.parallel_groups || []).length + 1).padStart(3, '0')}`;

    // 0. 向后兼容：确保字段存在
    if (!state.parallel_groups) state.parallel_groups = [];
    if (!state.current_tasks) state.current_tasks = [];

    // 1. 记录并行批次
    state.parallel_groups.push({
      id: groupId,
      task_ids: group,
      status: 'running',
      started_at: new Date().toISOString(),
      conflict_detected: false
    });
    state.current_tasks = group;
    state.current_task = group[0];

    console.log(`⚡ 并行执行 ${group.length} 个任务: ${group.join(', ')}`);

    // 2. 并行分派（run_in_background）
    const taskOutputIds: string[] = [];
    for (const taskId of group) {
      const task = allTasks.find(t => t.id === taskId)!;
      const outputId = await executeTaskInSubagent(task, state, tasksPath, statePath, {
        run_in_background: true
      });
      taskOutputIds.push(outputId);
    }

    // 3. 等待所有任务完成，收集结果
    const results: Array<{ taskId: string; passed: boolean }> = [];
    for (let i = 0; i < taskOutputIds.length; i++) {
      const output = await TaskOutput(taskOutputIds[i], { block: true, timeout: 600000 });
      const taskPassed = output.exit_code === 0;
      results.push({ taskId: group[i], passed: taskPassed });

      // 单个任务失败：立即标记
      if (!taskPassed) {
        state.progress.failed.push(group[i]);
      } else {
        state.progress.completed.push(group[i]);
      }
    }

    const anyFailed = results.some(r => !r.passed);

    // 4. 冲突检测：运行全量测试（仅当所有任务都成功时）
    if (!anyFailed) {
      const testResult = await runProjectTests();
      if (!testResult.passed) {
        console.log('⚠️ 并行执行后检测到冲突，回退为顺序执行');
        updateParallelGroupStatus(state, groupId, 'failed', true);
        // 回滚：将并行任务标记回 pending，逐个重新执行
        for (const taskId of group) {
          state.progress.completed = state.progress.completed.filter(id => id !== taskId);
        }
        // 降级为顺序执行
        for (const taskId of group) {
          const task = allTasks.find(t => t.id === taskId)!;
          await executeTaskInSubagent(task, state, tasksPath, statePath);
        }
      } else {
        updateParallelGroupStatus(state, groupId, 'completed');
      }
    } else {
      updateParallelGroupStatus(state, groupId, 'failed');
      console.log(`⚠️ ${results.filter(r => !r.passed).map(r => r.taskId).join(', ')} 执行失败`);
    }

    // 5. 同步 current_task/current_tasks
    state.current_tasks = [];
    state.current_task = findNextTask(tasksContent, state.progress) || state.current_task;
  } else {
    // 无可并行任务，顺序执行
    await executeTaskInSubagent(currentTask, state, tasksPath, statePath);
  }
}
```

**降级策略**：
- 独立性检查不通过 → 回退为顺序执行
- 并行执行后冲突检测失败 → 回滚并改为顺序执行
- 任一并行任务失败 → 标记该任务 `failed`，其余正常完成

详见 `specs/workflow/subagent-routing.md`。

---

## Post-Execution Pipeline

> 所有执行模式共享的后置管线。每个任务执行完成后、标记状态前，必须经过此管线。

```
executeTask() → Step 6.5（验证铁律）→ Step 6.7（规格合规）→ Step 7（更新状态）
```

**适用范围**：直接模式和 Subagent 模式均适用。所有 5 种执行模式（step/phase/quality_gate/retry/skip）在调用 `executeTask()` / `executeTaskInSubagent()` 后，都必须经过 Step 6.5 和 Step 6.7 再进入 Step 7。并行执行时，每个并行任务独立经过此管线。

---

### Step 6.5：完成验证（Verification Iron Law）

**铁律：没有新鲜验证证据，不得标记任务为 completed。**

#### 验证证据格式

每次验证必须产生结构化证据记录：

```typescript
interface VerificationEvidence {
  command: string;       // 执行的验证命令
  exit_code: number;     // 退出码
  output_summary: string; // 输出摘要（截取关键行，≤ 500 字符）
  timestamp: string;     // ISO 8601 时间戳
  passed: boolean;       // 是否通过
}
```

#### 验证命令映射

根据任务 action 类型确定验证方式：

| Action | 验证命令 | 通过条件 |
|--------|----------|----------|
| `create_file` / `edit_file` | 运行相关测试 或 语法检查 | 测试通过 或 无语法错误 |
| `run_tests` | 读取测试输出 | 全部通过，exit_code = 0 |
| `codex_review` | 读取审查评分 | 评分 ≥ threshold |
| `git_commit` | `git log -1 --format="%H %s"` | commit hash 存在且消息匹配 |

#### 执行流程

1. **识别验证命令**：根据任务 action 类型查表
2. **执行验证命令**：实际运行命令
3. **读取输出**：必须读取命令输出（禁止忽略）
4. **步骤级验证**：如果任务的 `requirement` 包含编号步骤列表（`1. ... → 预期：...`），逐项检查每个步骤的预期结果是否满足
5. **生成证据**：填充 `VerificationEvidence`
6. **判定结果**：
   - 通过 → 继续 Step 6.7
   - 失败 → 标记 `failed`，记录 `failure_reason`，禁止标记 `completed`

#### 红旗清单

出现以下情况说明在跳过验证：

- 使用"应该没问题"、"看起来正确"等模糊措辞
- 没有运行任何命令就标记完成
- 只运行了部分验证就声称全部通过
- 引用之前的测试结果而非本次运行结果
- 验证命令的输出没有被读取就声称通过

---

### Step 6.7：规格合规检查（Spec Compliance Check）

对 `create_file` 和 `edit_file` 类型的任务，在验证通过后执行只读规格合规检查。

**跳过条件**：
- `run_tests`、`codex_review`、`git_commit` 类型的任务跳过
- 任务无 `acceptance_criteria` 时跳过

**检查内容**：

1. **验收项覆盖**：任务关联的验收项是否都被实现覆盖
2. **设计参考一致**：实现是否与 `design_ref` 指向的技术方案章节一致
3. **需求完整性**：`requirement` 描述的功能是否完整实现

**执行方式**：
- 当前模型直接检查（不调用外部模型，保持轻量）
- 读取任务的验收项内容，逐项比对实现代码

**检查结果**：

| 结果 | 处理 |
|------|------|
| 全部覆盖 | 继续 Step 7 |
| 存在偏差 | 输出偏差列表，追加补充任务到 tasks.md，当前任务仍标记 completed |
| 严重偏差（缺失核心功能） | 标记 `failed`，提示用户 |
