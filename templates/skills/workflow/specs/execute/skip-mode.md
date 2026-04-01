# 跳过模式（--skip）

> 从 `execution-modes.md` 拆分。

## 快速导航

- 想看 skip 何时适用：看“适用场景”
- 想看为何 skip 不进入完成流水线：看开头例外说明
- 想看用户确认与状态更新：看“实现”
- 想看跳过后的风险：看“警告”

## 何时读取

- 用户执行 `/workflow execute --skip`
- 需要把当前任务标记为 `skipped` 并继续工作流时

**触发方式**：
- 命令行：`/workflow execute --skip`
- 自然语言：`/workflow execute 跳过`

**行为**：
- 标记当前任务为 `skipped`
- 更新 `plan.md` 与 `workflow-state.json`
- 移动到下一个任务
- 继续工作流（根据原执行模式）

> Skip 属于**例外路径**，不是"task 完成"路径，因此不执行实现验证、Step ② 本地检查或完整审查流水线；但必须留下清晰的 `skipped` 状态供后续审查与恢复使用。

**适用场景**：
- 任务暂时无法执行（等待外部依赖）
- 任务不再需要（需求变更）
- 临时绕过问题任务

**警告**：
- 跳过任务可能导致后续任务失败（依赖关系）
- 跳过的任务不会被执行，需要手动补充
- 慎用此模式

## 实现

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
  const nextTaskId = findNextTask(updatedContent, state.progress);
  if (!nextTaskId) {
    state.current_tasks = [];
    state.status = 'completed';
    state.updated_at = new Date().toISOString();
    writeFile(statePath, JSON.stringify(state, null, 2));
    return;
  }

  // 更新状态
  state.current_tasks = [nextTaskId];
  state.status = 'running';
  state.updated_at = new Date().toISOString();
  writeFile(statePath, JSON.stringify(state, null, 2));

  console.log(`
✅ 已跳过任务 ${currentTask.id}

📍 下一个任务：${nextTaskId}

💡 继续执行：/workflow execute
  `);
}
```
