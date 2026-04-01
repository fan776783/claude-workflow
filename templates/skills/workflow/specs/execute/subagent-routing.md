# Subagent 模式与并行执行

> 从 `execution-modes.md` 拆分。

## 快速导航

- 想看什么时候必须先读 dispatching-parallel-agents：看开头约束
- 想看平台路由：看“平台路由”
- 想看并行批次与边界分组：看后续独立性/批次章节
- 想看单 reviewer 与并行 dispatch 的区别：看约束说明

## 何时读取

- 执行阶段需要启用子 agent
- 需要判断是否可以并行 dispatch 同阶段 2+ 独立任务时

当启用 subagent 模式时，所有执行模式的行为保持不变，但任务执行方式改变。

在进入**并行批次决策**之前，必须先读取并应用 `../../dispatching-parallel-agents/SKILL.md`。以下独立性检查、上下文边界分组与冲突降级规则都以该 skill 为准；单任务子 agent 与单 reviewer 子 agent 继续按各自动作规范直接路由。

## 平台路由

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

---

## 并行执行（Subagent 模式）

当 Subagent 模式启用时，同阶段且通过独立性检查的任务可并行执行。

> 自 vNext 起，`parallel-boundaries` 不只是性能优化，也是 `ContextGovernor` 的 continuation action 之一：当规划工件稳定、主会话上下文进入 warning 区、且同阶段存在 2+ 可证明独立边界时，应优先评估边界并行，而不是让主会话顺序吞下多个独立任务。

并行策略必须遵循 `../../dispatching-parallel-agents/SKILL.md`：先做平台检测，再做独立性检查，然后按上下文边界分组；边界内串行，边界间并行。若批次中存在需要隔离写入的任务，必须先完成串行 worktree provisioning，再进入后台并行 dispatch；明确只读的分析/审查任务可跳过 worktree。

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

    // 2. 串行 provisioning：先为需要隔离写入的任务准备 worktree
    //    明确只读的分析/审查任务可直接复用主仓库路径

    // 3. 并行分派（后台运行）
    const handles: string[] = [];
    for (const taskId of group) {
      const task = allTasks.find(t => t.id === taskId)!;
      const handle = await executeTaskInSubagent(task, state, planPath, statePath, {
        routing,
        run_in_background: true
      });
      handles.push(handle);
    }

    // 4. 等待所有任务完成，收集结果
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
