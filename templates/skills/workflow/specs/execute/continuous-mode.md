# 连续模式（continuous）— 默认

> 从 `execution-modes.md` 拆分。连续模式是执行的默认模式。

## 快速导航

- 想看触发方式：看“触发方式”
- 想看何时暂停：看“行为”
- 想看具体执行循环：看“实现”
- 想看 budget / handoff 的前置治理：结合 `context-governor.md`

## 何时读取

- 当前模式为默认 execute / continuous 时
- 需要确认质量关卡前后暂停语义时

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

## 实现

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
      const reviewResult = getReviewResult(state, currentTask.id);
      const specStatus = reviewResult?.spec_status || '未执行';
      const codeStatus = reviewResult?.code_status || '未执行';
      const specIssues = reviewResult?.spec_issues_count || 0;
      const codeIssues = reviewResult?.code_issues_count || 0;

      console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 质量关卡完成 — 等待用户审查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 关卡任务：${currentTask.id} - ${currentTask.name}

📋 Spec 合规审查：${specStatus} ${specIssues > 0 ? `（${specIssues} 个问题）` : ''}
📋 代码质量审查：${codeStatus} ${codeIssues > 0 ? `（${codeIssues} 个问题）` : ''}
      `);

      // 内循环：展示报告后回到选项，不重新执行任务
      let reportShown = false;
      while (true) {
        const options = [
          { label: '审查通过，继续执行', description: '确认质量结果，继续下一批任务' },
          { label: '需要修复问题', description: '暂停执行，先修复审查发现的问题' },
        ];
        // P6 修复：报告已展示后移除「查看」选项，避免死循环
        if (!reportShown) {
          options.push({ label: '查看详细审查报告', description: '展示完整的审查报告后再决定' });
        }

        const reportChoice = await AskUserQuestion({
          questions: [{
            question: '请审查以上质量关卡结果：',
            header: '质量关卡审查',
            multiSelect: false,
            options
          }]
        });

        if (reportChoice === '查看详细审查报告') {
          reportShown = true;
          displayFullReviewReport(getReviewResult(state, currentTask.id));
          continue; // 留在审查选择内循环
        }

        if (reportChoice === '需要修复问题') {
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

        break; // 用户确认通过，继续执行下一任务
      }
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
