# 执行模式详情

## 概述

workflow execute 支持两种执行模式：**连续模式**（默认）和**单 phase 模式**（可选）。

> 核心设计：连续模式执行到质量关卡完成后自动暂停，提示用户审查质量结果。这确保代码质量始终受人工监督，同时最大化自动化执行效率。

> 执行链路直接消费 `WorkflowTaskV2`：任务提取使用 `extractCurrentTaskV2()`，动作判断使用 `actions[]`，实现语义读取 `steps[]`。
>
> 自 vNext 起，执行阶段采用 **budget-first** continuation governance：
> - `execution_mode` 只定义语义上的暂停偏好
> - `ContextGovernor` 负责 continue / pause / parallel-boundaries / handoff-required 的真实决策
> - 所有模式都必须先通过预算、安全、独立性与验证条件检查，才能继续执行

## 模式类型

### 1. 连续模式（continuous）— 默认

> 连续模式是执行的默认模式。它连续执行任务，跨越 phase 边界，直到遇到质量关卡。
> 质量关卡完成后自动暂停，展示审查结果，等待用户确认后才继续。
> 这确保代码质量始终受人工监督，同时最大化自动化效率。
>
> 连续模式仍为语义模式，不绕过 `ContextGovernor`。若 projected 预算不足、需切换到 `parallel-boundaries`、或达到 handoff 阈值，则应先执行对应治理动作。

**触发方式**：
- 命令行：`/workflow execute`（默认）
- 自然语言：`/workflow execute 继续` / `/workflow execute 连续`

**行为**：
- 连续执行任务，**跨越 phase 边界**，直到遇到质量关卡
- 遇到质量关卡时：先执行质量关卡（两阶段审查），审查完成后暂停，展示审查结果，等待用户确认
- 遇到 git_commit 且 `pause_before_commit=true` 时暂停
- 启动时提示用户可切换为单 phase 模式

**适用场景**：
- 快速执行大量任务，在质量关卡处接受人工审查
- 自动化程度高的工作流
- 平衡执行速度与代码质量监督

**实现**：
```typescript
// 启动时提示模式选择
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶️ 执行模式：${executionMode === 'phase' ? '单 phase' : '连续'}（默认）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 当前模式：${executionMode === 'phase' ? '单 phase——每个阶段完成后暂停' : '连续——执行到质量关卡完成后暂停，提示审查'}
💡 切换模式：/workflow execute --phase（按阶段执行）
`);

if (executionMode === 'continuous') {
  while (true) {
    // 执行当前任务
    await executeTask(currentTask, state, planPath, statePath);

    // 如果当前任务是质量关卡，执行完成后立即暂停，展示审查结果
    if (currentTask.quality_gate || normalizeTaskActions(currentTask).includes('quality_review')) {
      const reviewResult = state.execution_reviews?.[currentTask.id];
      const specStatus = reviewResult?.spec_compliance?.status || '未执行';
      const codeStatus = reviewResult?.code_quality?.status || '未执行';
      const specIssues = reviewResult?.spec_compliance?.issues?.length || 0;
      const codeIssues = reviewResult?.code_quality?.issues?.length || 0;

      console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 质量关卡完成 — 等待用户审查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 关卡任务：${currentTask.id} - ${currentTask.name}

📋 Spec 合规审查：${specStatus} ${specIssues > 0 ? `（${specIssues} 个问题）` : ''}
📋 代码质量审查：${codeStatus} ${codeIssues > 0 ? `（${codeIssues} 个问题）` : ''}
      `);

      const reviewChoice = await AskUserQuestion({
        questions: [{
          question: '请审查以上质量关卡结果：',
          header: '质量关卡审查',
          multiSelect: false,
          options: [
            { label: '审查通过，继续执行', description: '确认质量结果，继续下一批任务' },
            { label: '需要修复问题', description: '暂停执行，先修复审查发现的问题' },
            { label: '查看详细审查报告', description: '展示完整的审查报告后再决定' }
          ]
        }]
      });

      if (reviewChoice === '需要修复问题') {
        state.status = 'paused';
        state.continuation = {
          strategy: 'budget-first',
          last_decision: { action: 'pause-quality-gate', reason: 'user-review-fix-required' },
          handoff_required: false
        };
        writeFile(statePath, JSON.stringify(state, null, 2));
        console.log('⏸️ 已暂停。修复问题后执行 /workflow execute 继续。');
        return;
      }

      if (reviewChoice === '查看详细审查报告') {
        // 展示完整戺查报告
        displayFullReviewReport(state.execution_reviews[currentTask.id]);
        // 再次询问
        continue; // 回到循环头重新展示选项
      }

      // 用户确认通过，继续执行
    }

    // 查找下一个任务
    const nextTaskId = findNextTask(planContent, state.progress);
    if (!nextTaskId) {
      completeWorkflow(state, statePath, planPath);
      return;
    }

    // 提取下一个任务（V2 优先）
    const nextTask = extractCurrentTaskV2(planContent, nextTaskId);
    if (!nextTask) break;

    // 检查是否为 git_commit 且需要暂停
    if (normalizeTaskActions(nextTask).includes('git_commit') && pauseBeforeCommit) {
      console.log(`
✅ 已执行到提交任务

📍 下一个任务：${nextTask.id} - ${nextTask.name}
📝 准备提交代码

💡 继续执行：/workflow execute
      `);
      break;
    }

    // 更新当前任务
    state.current_tasks = [nextTaskId];
    Object.assign(currentTask, nextTask);
  }
}
```

---

### 2. 单 phase 模式（phase）— 可选

**触发方式**：
- 命令行：`/workflow execute --phase`
- 自然语言：`/workflow execute 单阶段` / `/workflow execute 下一阶段`

**行为**：
- 连续执行同一治理 phase 内的任务
- 在 phase 边界变化时暂停
- 遇到质量关卡时，同样执行质量关卡并暂停提示用户审查
- 显示阶段完成摘要

**适用场景**：
- 希望在每个阶段结束后手动检查
- 调试工作流或学习执行过程
- 需要精细控制的场景

**实现**：
```typescript
if (executionMode === 'phase') {
  const currentPhase = currentTask.phase;

  while (true) {
    // 执行当前任务
    await executeTask(currentTask, state, planPath, statePath);

    // 如果当前任务是质量关卡，执行完成后暂停提示用户审查
    if (currentTask.quality_gate || normalizeTaskActions(currentTask).includes('quality_review')) {
      const reviewResult = state.execution_reviews?.[currentTask.id];
      console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 质量关卡完成 — 等待用户审查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Spec 合规：${reviewResult?.spec_compliance?.status || '未执行'}
📍 代码质量：${reviewResult?.code_quality?.status || '未执行'}

💡 审查后执行 /workflow execute 继续
      `);
      break; // phase 模式在质量关卡后直接暂停
    }

    // 查找下一个任务
    const nextTaskId = findNextTask(planContent, state.progress);
    if (!nextTaskId) {
      completeWorkflow(state, statePath, planPath);
      return;
    }

    // 提取下一个任务（V2 优先）
    const nextTask = extractCurrentTaskV2(planContent, nextTaskId);
    if (!nextTask) break;

    // 检查阶段是否变化
    if (nextTask.phase !== currentPhase) {
      console.log(`
✅ 阶段 "${currentPhase}" 完成

📍 下一阶段：${nextTask.phase}
📍 下一个任务：${nextTask.id} - ${nextTask.name}

💡 继续执行：/workflow execute
💡 切换为连续模式：/workflow execute（无参数）
      `);
      break;
    }

    // 更新当前任务
    state.current_tasks = [nextTaskId];
    Object.assign(currentTask, nextTask);
  }
}
```

---

### 3. 重试模式（--retry）

**触发方式**：
- 命令行：`/workflow execute --retry`
- 自然语言：`/workflow execute 重试`

**行为**：
- 检查工作流状态是否为 `failed`
- 启动结构化调试协议定位根因
- 修复后重新执行失败的任务
- 连续 3 次失败触发 Hard Stop

**适用场景**：
- 任务执行失败后修复问题
- 临时性错误（网络、权限等）
- 调试和测试

**实现**：
```typescript
async function executeRetryMode() {
  const state = JSON.parse(readFile(statePath));

  if (state.status !== 'failed') {
    console.log(`
⚠️ 当前工作流状态不是 failed，无需重试

当前状态：${state.status}
当前任务：${state.current_tasks?.[0] || '无'}

💡 继续执行：/workflow execute
    `);
    return;
  }

  const planContent = readFile(planPath);
  const activeTaskId = state.current_tasks?.[0];
  const currentTask = activeTaskId ? extractCurrentTaskV2(planContent, activeTaskId) : null;

  if (!currentTask) {
    console.log(`❌ 无法找到任务 ${activeTaskId}`);
    return;
  }

  // 初始化 per-task runtime state
  if (!state.task_runtime) state.task_runtime = {};
  if (!state.task_runtime[currentTask.id]) {
    state.task_runtime[currentTask.id] = {
      retry_count: 0,
      last_failure_stage: 'execution',
      last_failure_reason: state.failure_reason || '',
      hard_stop_triggered: false,
      debugging_phases_completed: [],
    };
  }

  const runtime = state.task_runtime[currentTask.id];
  runtime.retry_count++;

  // Hard Stop 检查
  if (runtime.retry_count >= 3) {
    runtime.hard_stop_triggered = true;
    writeFile(statePath, JSON.stringify(state, null, 2));
    console.log(`
🛑 Hard Stop：任务 ${currentTask.id} 已连续失败 ${runtime.retry_count} 次

这通常意味着架构层面的问题，而非简单 bug。

请检查：
- 当前方案是否根本可行？
- 是否需要重新设计此部分？
- 是否存在未识别的外部依赖？

建议与用户讨论后再决定下一步。
使用 /workflow execute --skip 跳过此任务。
    `);
    return;
  }

  console.log(`
🔄 重试模式（第 ${runtime.retry_count} 次）

失败任务：${currentTask.id}
失败原因：${runtime.last_failure_reason}
失败阶段：${runtime.last_failure_stage}

📋 启动结构化调试流程...
  `);

  // 结构化调试协议
  await structuredDebugging(currentTask, state, runtime);

  // 重置状态并重试
  state.status = 'running';
  state.failure_reason = null;
  writeFile(statePath, JSON.stringify(state, null, 2));

  try {
    await executeTask(currentTask, state, planPath, statePath);
    console.log(`✅ 重试成功：任务 ${currentTask.id} 已完成`);
    runtime.retry_count = 0; // 成功后重置
    runtime.debugging_phases_completed = [];
    writeFile(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    state.status = 'failed';
    state.failure_reason = error.message;
    runtime.last_failure_reason = error.message;
    writeFile(statePath, JSON.stringify(state, null, 2));

    console.log(`
❌ 重试失败（第 ${runtime.retry_count} 次）

错误信息：${error.message}

请使用 /workflow execute --retry 再次重试
    `);
  }
}
```

#### 结构化调试协议

> 借鉴 Superpowers systematic-debugging 的四阶段调试流程。

**铁律：没有根因调查，不得尝试修复。症状修复等于失败。**

```
任务失败
  ↓
Phase 1：根因调查
  ├─ 仔细阅读完整错误信息
  ├─ 复现问题
  ├─ 检查最近变更（git diff HEAD~3 -- <file>）
  └─ 从错误点向上追溯数据流
  ↓
Phase 2：模式分析
  ├─ 在代码库中找到类似的正常工作的代码
  ├─ 对比正常代码与出错代码的差异
  └─ 列出每一个差异，无论多小
  ↓
Phase 3：假设验证
  ├─ 形成单一假设："我认为 X 是根因，因为 Y"
  ├─ 做最小可能的变更来验证
  └─ 一次只测试一个变量
  ↓
Phase 4：实施修复
  ├─ 先写失败测试用例
  ├─ 实施单一修复（针对根因，非症状）
  └─ 验证修复 + 确认无回归
```

#### 升级阈值

| 重试次数 | 行为 |
|----------|------|
| 第 1 次 | 执行四阶段调试流程 |
| 第 2 次 | 加强 Phase 2（扩大模式搜索范围） |
| **第 3 次** | **Hard Stop：质疑架构，与用户讨论** |

#### 调试红旗清单

- "先快速修一下，回头再调查"
- "试试改这个看看行不行"
- "同时改几个地方，跑一下测试"
- 在没有追踪数据流的情况下提出修复方案
- 已经失败 2 次以上仍然"再试一次"

**以上任何一条触发：停下来，回到 Phase 1。**

---

### 4. 跳过模式（--skip）

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
  const planContent = readFile(planPath);
  const activeTaskId = state.current_tasks?.[0];
  const currentTask = activeTaskId ? extractCurrentTaskV2(planContent, activeTaskId) : null;

  if (!currentTask) {
    console.log(`❌ 无法找到任务 ${activeTaskId}`);
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

  // 更新 plan.md
  const updatedContent = updateTaskStatus(planContent, currentTask.id, 'skipped');
  writeFile(planPath, updatedContent);

  // 查找下一个任务
  const nextTaskId = findNextTask(planContent, state.progress);
  if (!nextTaskId) {
    completeWorkflow(state, statePath, planPath);
    return;
  }

  // 更新状态
  state.current_tasks = [nextTaskId];
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

## ContextGovernor

所有执行模式共享同一 continuation governor。它不再是“兜底机制”，而是决定下一步的第一优先级调度器。

### 决策顺序

```text
1. 检查硬停止条件
   - failed / blocked
   - retry hard stop
   - 缺少验证证据
   - quality_review 预算耗尽

2. 计算下一执行单元的 projected budget
   - 当前主会话 token
   - 下一执行单元的执行成本
   - 验证成本
   - 审查成本
   - 安全缓冲

3. 检查是否存在同阶段 2+ 可证明独立边界
   - 若存在且工件稳定，可优先选择 parallel-boundaries

4. 应用预算阈值
   - warning：倾向 parallel-boundaries 或暂停
   - danger：预算暂停
   - hard handoff：生成 continuation artifact 并要求新会话恢复

5. 仅当以上均允许时，才应用 execution_mode 语义
   - step
   - phase
   - quality_gate
```

### 决策输出

```typescript
type ContinuationAction =
  | 'continue-direct'
  | 'continue-parallel-boundaries'
  | 'pause-budget'
  | 'pause-governance'
  | 'pause-quality-gate'
  | 'pause-before-commit'
  | 'handoff-required';
```

### 节奏控制信号

`consecutive_count` 与 `maxConsecutiveTasks` 继续保留，但它们只作为节奏控制信号：
- 不能覆盖 danger / hard handoff 水位
- 不能覆盖独立边界并行机会
- 不能绕过质量关卡或验证门控

### 预算暂停与交接语义

```typescript
if (state.contextMetrics.projectedUsagePercent >= state.contextMetrics.hardHandoffThreshold) {
  writeContinuationArtifact(state);
  state.continuation = {
    strategy: 'budget-first',
    last_decision: { action: 'handoff-required', reason: 'hard-handoff-threshold' },
    handoff_required: true,
    artifact_path: continuationArtifactPath
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}

if (state.contextMetrics.projectedUsagePercent >= state.contextMetrics.dangerThreshold) {
  state.continuation = {
    strategy: 'budget-first',
    last_decision: { action: 'pause-budget', reason: 'context-danger' },
    handoff_required: false,
    artifact_path: null
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}
```

---

## 决策优先级

`execution_mode` 仍保留原优先级，但它只在 `ContextGovernor` 判定允许继续时生效。

**执行治理优先级（从高到低）**：
1. **硬停止 / 验证阻断 / review budget 耗尽**
2. **ContextGovernor 预算判断**
3. **parallel-boundaries 调度机会**
4. **命令行参数**：`/workflow execute --phase`
5. **state 配置**：`state.execution_mode`
6. **默认值**：`continuous`

```typescript
const executionMode = executionModeOverride || state.execution_mode || 'continuous';
const decision = evaluateContinuationDecision(...);

if (decision.action !== 'continue-direct') {
  applyDecision(decision);
  return;
}
```

---

## Subagent 模式

当启用 subagent 模式时，所有执行模式的行为保持不变，但任务执行方式改变。

在进入**并行批次决策**之前，必须先读取并应用 `../../dispatching-parallel-agents/SKILL.md`。以下独立性检查、上下文边界分组与冲突降级规则都以该 skill 为准；单任务子 agent 与单 reviewer 子 agent 继续按各自动作规范直接路由。

### 平台路由

```typescript
interface SubagentRouting {
  supported: boolean;
  platform: ExecutionPlatform;
  dispatchTool: 'Task' | 'spawn_agent' | 'direct';
  waitTool?: 'TaskOutput' | 'wait';
  cleanupTool?: 'close_agent';
}

function detectSubagentRouting(env: Record<string, string>): SubagentRouting {
  if (env.CURSOR_PLUGIN_ROOT) {
    return { supported: true, platform: 'cursor', dispatchTool: 'Task', waitTool: 'TaskOutput' };
  }
  if (env.CLAUDE_PLUGIN_ROOT) {
    return { supported: true, platform: 'claude-code', dispatchTool: 'Task', waitTool: 'TaskOutput' };
  }
  if (env.CODEX_HOME || env.CODEX_SANDBOX) {
    return {
      supported: true,
      platform: 'codex',
      dispatchTool: 'spawn_agent',
      waitTool: 'wait',
      cleanupTool: 'close_agent'
    };
  }
  return { supported: false, platform: 'other', dispatchTool: 'direct' };
}
```

**直接模式**：
- 在当前上下文中执行任务
- 上下文累积，可能溢出

**Subagent 模式**：
- Claude Code / Cursor 使用 `Task` 在独立子 agent 中执行
- Codex 使用 `spawn_agent` 派发、`wait` 回收、`close_agent` 释放槽位
- 每个任务只接收最小必要上下文，避免主会话上下文污染
- 不支持子 agent 时自动回退为直接模式
- 同阶段多任务优先按上下文边界分组，再决定是否并行

```typescript
const routing = detectSubagentRouting(process.env);

if (useSubagent && routing.supported) {
  await executeTaskInSubagent(currentTask, state, planPath, statePath, routing);
} else {
  await executeTaskDirect(currentTask, state, planPath, statePath);
}
```

### 并行执行（Subagent 模式）

当 Subagent 模式启用时，同阶段且通过独立性检查的任务可并行执行。

> 自 vNext 起，`parallel-boundaries` 不只是性能优化，也是 `ContextGovernor` 的 continuation action 之一：当规划工件稳定、主会话上下文进入 warning 区、且同阶段存在 2+ 可证明独立边界时，应优先评估边界并行，而不是让主会话顺序吞下多个独立任务。

并行策略必须遵循 `../../dispatching-parallel-agents/SKILL.md`：先做平台检测，再做独立性检查，然后按上下文边界分组；边界内串行，边界间并行。

**触发条件**：
- Subagent 模式已启用
- 当前阶段有 ≥ 2 个 pending 任务
- 任务通过独立性检查（`findParallelGroup()`）

**执行流程**：

```typescript
if (useSubagent) {
  const allTasks = parseAllTasks(planContent);
  const parallelGroups = findParallelGroup(planContent, state.progress, allTasks);

  if (parallelGroups.length > 0) {
    const group = parallelGroups[0];
    const groupId = `PG-${String((state.parallel_groups || []).length + 1).padStart(3, '0')}`;

    // 0. 初始化并行执行字段
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

    console.log(`⚡ 并行执行 ${group.length} 个任务: ${group.join(', ')}`);

    // 2. 并行分派（后台运行）
    const handles: string[] = [];
    for (const taskId of group) {
      const task = allTasks.find(t => t.id === taskId)!;
      const handle = await executeTaskInSubagent(task, state, planPath, statePath, {
        routing,
        run_in_background: true
      });
      handles.push(handle);
    }

    // 3. 等待所有任务完成，收集结果
    const results: Array<{ taskId: string; passed: boolean }> = [];
    for (let i = 0; i < handles.length; i++) {
      const output = routing.platform === 'codex'
        ? await wait(handles[i])
        : await TaskOutput(handles[i], { block: true, timeout: 600000 });
      const taskPassed = output.exit_code === 0;
      results.push({ taskId: group[i], passed: taskPassed });

      if (routing.platform === 'codex' && routing.cleanupTool === 'close_agent') {
        await close_agent(handles[i]);
      }

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
          await executeTaskInSubagent(task, state, planPath, statePath);
        }
      } else {
        updateParallelGroupStatus(state, groupId, 'completed');
      }
    } else {
      updateParallelGroupStatus(state, groupId, 'failed');
      console.log(`⚠️ ${results.filter(r => !r.passed).map(r => r.taskId).join(', ')} 执行失败`);
    }

    // 5. 同步 current_tasks
    state.current_tasks = [];
    const nextRunnableTaskId = findNextTask(planContent, state.progress);
    if (nextRunnableTaskId) {
      state.current_tasks = [nextRunnableTaskId];
    }
  } else {
    // 无可并行任务，顺序执行
    await executeTaskInSubagent(currentTask, state, planPath, statePath);
  }
}
```

**降级策略**：
- 独立性检查不通过 → 回退为顺序执行
- 并行执行后冲突检测失败 → 回滚并改为顺序执行
- 任一并行任务失败 → 标记该任务 `failed`，其余正常完成

详见 `references/shared-utils.md`。

---

## Post-Execution Pipeline

> 所有执行模式共享的后置管线。每个任务执行完成后、标记状态前，必须经过此管线。

```
executeTask() → Step 6.5（验证铁律）→ Step 6.6（自审查）→ Step 6.7（规格合规）→ Step 7（更新状态）
```

**适用范围**：直接模式和 Subagent 模式均适用。所有 4 种执行模式（continuous/phase/retry/skip）在调用 `executeTask()` / `executeTaskInSubagent()` 后，都必须经过 Step 6.5 → Step 6.6 → Step 6.7 再进入 Step 7。质量关卡任务的 `quality_review` action 内部包含两阶段审查（详见 `specs/execute/actions/quality-review.md`）。并行执行时，每个并行任务独立经过此管线；具体 dispatch / wait / cleanup / conflict fallback 规则遵循 `../../dispatching-parallel-agents/SKILL.md`。

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
  artifact_ref?: string; // 关联产物引用（如 quality_gates.T8）
}
```

#### 验证命令映射

根据任务 action 类型确定验证方式：

| Action | 验证命令 | 通过条件 |
|--------|----------|----------|
| `create_file` / `edit_file` | 运行相关测试 或 语法检查 | 测试通过 或 无语法错误 |
| `run_tests` | 读取测试输出 | 全部通过，exit_code = 0 |
| `quality_review` | 读取两阶段审查结果 | `quality_gates[taskId].overall_passed === true` |
| `git_commit` | `git log -1 --format="%H %s"` | commit hash 存在且消息匹配 |

#### 执行流程

1. **识别验证命令**：根据任务 action 类型查表
2. **执行验证命令**：实际运行命令
3. **读取输出**：必须读取命令输出（禁止忽略）
4. **步骤级验证**：逐项检查 `steps[]` 中每个步骤的预期结果是否满足
5. **生成证据**：填充 `VerificationEvidence`
6. **判定结果**：
   - 通过 → 继续 Step 6.7
   - 失败 → 标记 `failed`，记录 `failure_reason`，禁止标记 `completed`

#### 验证门控函数（Gate Function）

在声称任何状态前，必须通过此门控：

```
1. IDENTIFY：什么命令能证明此声明？
2. RUN：执行完整命令（新鲜的、完整的）
3. READ：完整输出，检查退出码，计数失败
4. VERIFY：输出是否确认了声明？
5. ONLY THEN：发表声明
```

| 声明 | 需要的证据 | 不充分的证据 |
|------|-----------|-------------|
| "测试通过" | 测试命令输出：0 failures | 之前的运行、"应该通过" |
| "Lint 干净" | Linter 输出：0 errors | 部分检查、推测 |
| "构建成功" | 构建命令：exit 0 | Linter 通过 ≠ 构建通过 |
| "Bug 已修复" | 原始症状测试通过 | "代码改了" |
| "需求已满足" | 逐项对照 Spec 验收标准 | 测试通过 ≠ 需求满足 |

#### 红旗清单

出现以下情况说明在跳过验证：

**模糊措辞**：
- 使用"应该没问题"、"看起来正确"、"大概通过了"
- 使用"应该"、"可能"、"似乎"等不确定措辞
- 在验证前表达满意（"好了！"、"完成！"）

**验证缺失**：
- 没有运行任何命令就标记完成
- 只运行了部分验证就声称全部通过
- 引用之前的测试结果而非本次运行结果
- 验证命令的输出没有被读取就声称通过

**过早满足**：
- 代码编译通过就声称完成（编译 ≠ 正确）
- Linter 通过就声称构建成功（Linter ≠ 编译器）
- 单元测试通过就声称需求已满足（测试通过 ≠ 需求覆盖）

**信任代理报告**：
- 信任 subagent 的成功报告而不独立验证
- 信任外部工具的"success"输出而不检查细节

**以上任何一条触发：运行验证命令，读取输出，然后才能声称结果。**

---

### Step 6.6：自审查（Self-Review Checklist）

> 单次建议性检查。在验证通过后、规格合规检查前捕获明显问题，减少后续审查循环。

**适用条件**：`create_file` 和 `edit_file` 类型任务
**跳过条件**：`run_tests`、`quality_review`、`git_commit` 类型任务

#### 自审查清单

| 类别 | 检查项 |
|------|--------|
| **完整性** | 每个新函数/方法都有测试？ |
| **完整性** | 边界条件和错误路径都有覆盖？ |
| **正确性** | 测试用例的失败原因是功能缺失（非语法错误）？ |
| **正确性** | 每个测试都观察到了红-绿转换？ |
| **质量** | 代码中无硬编码的魔法数字/字符串？ |
| **质量** | 错误处理覆盖了所有外部调用？ |
| **质量** | 无重复代码（DRY）？ |
| **安全** | 用户输入都有验证和清理？ |
| **安全** | 无敏感信息硬编码？ |
| **一致性** | 命名风格与项目现有代码一致？ |
| **一致性** | 实现与 `spec_ref` / `plan_ref` 指向的规范与计划一致？ |

#### 执行方式

- 单次通过，运行一次即结束
- 输出未通过项的警告
- **永不阻塞**：无论结果如何，始终继续 Step 6.7
- 目的：提前发现明显问题，减少外部审查循环次数

---

### Step 6.7：规格合规检查（Spec Compliance Check）

对 `create_file` 和 `edit_file` 类型的任务，在验证通过后执行只读规格合规检查。

**跳过条件**：
- `run_tests`、`git_commit` 类型的任务跳过
- `quality_review` 类型任务跳过（由两阶段审查的 Stage 1 接管，详见 `specs/execute/actions/quality-review.md`）
- 任务无 `acceptance_criteria` 时跳过

**检查内容**：

1. **验收项覆盖**：任务关联的验收项是否都被实现覆盖
2. **规范与计划一致**：实现是否与 `spec_ref` 指向的规范章节、`plan_ref` 指向的计划步骤一致
3. **需求完整性**：`steps[]` 描述的执行意图是否完整实现

**执行方式**：
- 当前模型直接检查（不调用外部模型，保持轻量）
- 读取任务的验收项内容，逐项比对实现代码

**检查结果**：

| 结果 | 处理 |
|------|------|
| 全部覆盖 | 继续 Step 7 |
| 存在偏差 | 输出偏差列表，追加补充任务到 plan.md，当前任务仍标记 completed |
| 严重偏差（缺失核心功能） | 标记 `failed`，提示用户 |

---

## TDD 执行纪律（TDD Enforcement）

> 借鉴 Superpowers test-driven-development 的 Iron Law。

**适用条件**（全部满足才触发）：
1. 任务 `phase` 为 `implement`、`ui-layout`、`ui-display`、`ui-form`、`ui-integrate`
2. 项目存在 Spec（`.claude/specs/{name}.md`，Phase 1 产物）
3. 项目有可执行的测试命令（`project-config.json` 的 `testCommand`）
4. 任务 actions 包含 `create_file` 或 `edit_file`
5. 文件类型为可测试代码（排除豁免列表）

**豁免列表**：
- 配置文件：`*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.ini`, `*.env`
- 文档：`*.md`, `*.txt`, `*.rst`
- 数据库迁移：`*.sql`, `*.migration`
- 生成文件：`*.generated.*`, `*.auto.*`
- 纯类型定义：`types.ts`, `interfaces.ts`, `constants.ts`
- TypeScript 声明：`*.d.ts`
- 桶文件：`index.ts`, `barrel.ts`（纯 re-export）

**不满足任一条件时**：退化为现有行为（直接执行，不强制 TDD）。

### Iron Law

```
没有失败的测试，不得编写生产代码。
```

### Red-Green-Refactor 执行流程

```typescript
async function executeWithTdd(task: WorkflowTaskV2, guideContent: string): Promise<void> {
  const testTemplates = extractRelevantTests(guideContent, task);

  if (testTemplates.length === 0) {
    return executeTaskDirect(task); // 无相关测试模板，退化
  }

  let completedCycles = 0;
  const MAX_RETRIES_PER_PHASE = 3;

  for (const template of testTemplates) {
    // ── RED：编写失败测试 ──
    await writeTestFromTemplate(template);
    let redResult = await runTest(template.filePath);

    // 测试直接通过 = 在测试已有行为，修正测试使其失败
    let redRetries = 0;
    while (redResult.passed && redRetries < MAX_RETRIES_PER_PHASE) {
      await adjustTestToFail(template); // 修正测试以测试新行为
      redResult = await runTest(template.filePath);
      redRetries++;
    }
    if (redResult.passed) {
      continue; // 无法使测试失败，跳过此模板
    }

    // 语法错误 → 修复后重新 RED
    let syntaxRetries = 0;
    while (redResult.error_type === 'syntax' && syntaxRetries < MAX_RETRIES_PER_PHASE) {
      await fixTestSyntax(template);
      redResult = await runTest(template.filePath);
      syntaxRetries++;
    }
    if (redResult.error_type === 'syntax') {
      continue; // 语法错误无法修复，跳过此模板
    }

    // ── GREEN：编写最小实现 ──
    await executeTaskAction(task);
    let greenResult = await runTest(template.filePath);

    // GREEN 失败 → 修复实现（不修改测试）
    let greenRetries = 0;
    while (!greenResult.passed && greenRetries < MAX_RETRIES_PER_PHASE) {
      await fixImplementation(task, greenResult);
      greenResult = await runTest(template.filePath);
      greenRetries++;
    }
    if (!greenResult.passed) {
      continue; // 无法通过测试，跳过此模板
    }

    // ── REFACTOR：清理代码 ──
    const refactorResult = await runAllRelatedTests(task);
    if (!refactorResult.passed) {
      // 撤销重构，保持 GREEN 状态
      await revertLastChange();
    }

    completedCycles++;
  }

  // 完成性检查：至少一个模板完成了完整的 Red→Green 循环
  if (completedCycles === 0) {
    throw new Error(
      `TDD 执行失败：${testTemplates.length} 个测试模板均未完成 Red→Green 循环。` +
      `违反 Iron Law，无法验证实现的正确性。`
    );
  }
}
```

### 合理化借口检测

| 借口 | 现实 |
|------|------|
| "太简单了，不需要测试" | 简单代码也会出错，测试只需 30 秒 |
| "写完再补测试" | 事后测试直接通过 = 什么也没证明 |
| "事后测试效果一样" | 事后测试回答"它做了什么"；先行测试回答"它应该做什么" |
| "已经手动测试过了" | 手动测试不可重复、无记录 |
| "需要先探索" | 可以探索，但之后必须删掉，从 TDD 重来 |
| "测试太难写" | 难测 = 难用 = 设计有问题 |

### 红旗清单

- 先写了生产代码再补测试
- 测试直接通过（没看到它失败）
- 说不清测试为什么失败
- 测试"稍后补"
- "保留当参考"或"基于已有代码改"

**以上任何一条触发：删除代码，从 TDD 重来。**
