# TDD 执行纪律（TDD Enforcement）

> 从 `execution-modes.md` 拆分。借鉴 Superpowers test-driven-development 的 Iron Law。

## 快速导航

- 想看 TDD 何时强制启用：看“适用条件”
- 想看豁免文件：看“豁免列表”
- 想看 Red-Green-Refactor 流程：看对应执行流程章节
- 想看无测试模板时如何退化：看实现开头

## 何时读取

- task 属于 implement/ui 类且涉及可测试代码时
- 需要确认是否必须先写失败测试时

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

## Iron Law

```
没有失败的测试，不得编写生产代码。
```

## Red-Green-Refactor 执行流程

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

## 合理化借口检测

| 借口 | 现实 |
|------|------|
| "太简单了，不需要测试" | 简单代码也会出错，测试只需 30 秒 |
| "写完再补测试" | 事后测试直接通过 = 什么也没证明 |
| "事后测试效果一样" | 事后测试回答"它做了什么"；先行测试回答"它应该做什么" |
| "已经手动测试过了" | 手动测试不可重复、无记录 |
| "需要先探索" | 可以探索，但之后必须删掉，从 TDD 重来 |
| "测试太难写" | 难测 = 难用 = 设计有问题 |

## 红旗清单

- 先写了生产代码再补测试
- 测试直接通过（没看到它失败）
- 说不清测试为什么失败
- 测试"稍后补"
- "保留当参考"或"基于已有代码改"

**以上任何一条触发：删除代码，从 TDD 重来。**
