# 重试模式（--retry）+ 结构化调试协议

> 从 `execution-modes.md` 拆分。

## 快速导航

- 想看 retry 何时触发：看“触发方式”
- 想看失败态前置检查：看“行为”与“实现”开头
- 想看结构化调试协议：看后续四阶段调试部分
- 想看连续失败 Hard Stop：看对应限制章节

## 何时读取

- 用户执行 `/workflow execute --retry`
- 需要处理 failed 状态任务并进入调试闭环时

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

## 实现

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

---

## 结构化调试协议

> ⚠️ `structuredDebugging()` 是**指导性框架**，不是可调用的确定性函数。
> AI Agent 应按以下四阶段顺序执行调试思维链，每个阶段是一段自然语言推理过程，不是 Python/TypeScript 函数调用。

借鉴 Superpowers systematic-debugging 的四阶段调试流程。

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

### 升级阈值

| 重试次数 | 行为 |
|----------|------|
| 第 1 次 | 执行四阶段调试流程 |
| 第 2 次 | 加强 Phase 2（扩大模式搜索范围） |
| **第 3 次** | **Hard Stop：质疑架构，与用户讨论** |

### 调试红旗清单

- "先快速修一下，回头再调查"
- "试试改这个看看行不行"
- "同时改几个地方，跑一下测试"
- 在没有追踪数据流的情况下提出修复方案
- 已经失败 2 次以上仍然"再试一次"

**以上任何一条触发：停下来，回到 Phase 1。**
