# 单 phase 模式（phase）— 可选

> 从 `execution-modes.md` 拆分。

## 快速导航

- 想看何时进入 phase 模式：看“触发方式”
- 想看 phase 边界何时暂停：看“行为”
- 想看具体循环与质量关卡暂停：看“实现”
- 想看与 continuous 的共享治理前提：结合 `context-governor.md`

## 何时读取

- 用户执行 `/workflow execute --phase`
- 需要按治理 phase 分段执行并在边界暂停时

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

## 实现

```typescript
if (executionMode === 'phase') {
  const currentPhase = currentTask.phase;

  while (true) {
    // 执行当前任务
    await executeTask(currentTask, state, planPath, statePath);

    // 如果当前任务是质量关卡，执行完成后暂停提示用户审查
    if (currentTask.quality_gate || normalizeTaskActions(currentTask).includes('quality_review')) {
      const reviewResult = getReviewResult(state, currentTask.id);
      console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 质量关卡完成 — 等待用户审查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Spec 合规：${reviewResult?.spec_status || '未执行'}
📍 代码质量：${reviewResult?.code_status || '未执行'}

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
