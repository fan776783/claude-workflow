# 审查反馈处理协议

> 借鉴 Superpowers receiving-code-review 的结构化反馈处理。

收到代码审查反馈后（两阶段审查、Codex review、外部审查），按此协议处理。

## 响应流程

```
收到反馈
  → READ（完整阅读，不立即反应）
  → UNDERSTAND（复述技术要求）
  → VERIFY（对照代码库验证反馈正确性）
  → EVALUATE（对当前代码库是否适用）
  → RESPOND（技术回应或合理推回）
  → IMPLEMENT（按优先级逐项修复）
```

```typescript
async function handleReviewFeedback(
  feedback: CodeQualityResult | SpecComplianceResult
): Promise<void> {
  const allIssues = collectAllIssues(feedback);

  // 1. READ + UNDERSTAND：完整理解每个反馈项
  for (const issue of allIssues) {
    if (!isIssueClear(issue)) {
      // 不理解 → 提问，不实现
      // 原因：项目之间可能有关联，部分理解 = 错误实现
      return;
    }
  }

  // 2. VERIFY + EVALUATE：对照代码库验证
  // 3. RESPOND：技术回应（或推回）
  // 4. IMPLEMENT：按优先级逐项修复
  const sorted = sortByPriority(allIssues);
  for (const issue of sorted) {
    await fixIssue(issue);
    await verifyFix(issue); // 每项修完单独测试
  }
}
```

## 禁止的回应

- "你说得对！"（表演性认同）
- "好建议！" / "优秀的反馈！"（讨好式回应）
- "让我马上实现"（未验证就行动）

**正确做法**：
- 复述技术要求，或直接动手修复
- 用技术推理推回不正确的反馈
- 修复后说明改了什么，而非感谢

## 不理解时的处理

```
如果任一反馈项不清楚：
  停下 — 不实现任何内容
  对不清楚的项目提问

原因：项目之间可能有关联，部分理解 = 错误实现
```

## 合理推回时机

以下情况应以技术推理推回反馈：

- 建议会破坏现有功能（引用通过的测试作为证据）
- 审查者缺少完整上下文
- 违反 YAGNI（建议实现未被使用的功能）
- 技术上不适用于当前技术栈
- 与用户的架构决策冲突

**推回方式**：使用技术推理 + 具体问题 + 代码证据，不使用防御性语言。

## 实现顺序

多项反馈时按以下顺序处理：

1. 先澄清所有不清楚的项目
2. 然后按优先级实现：
   - 阻塞性问题（崩溃、安全漏洞）
   - 简单修复（拼写、import）
   - 复杂修复（重构、逻辑）
3. 每项修复后单独测试
4. 确认无回归

## 已知限制

**讨论工件文本未转义**：Phase 0.2 的自由文本回答原样写入 `discussion-artifact.json` 并渲染到 tech-design.md。当前未做 Markdown 转义或 trust-boundary 隔离。在单人工作流场景中风险可接受（用户输入自己的数据）；若未来支持多人协作，需在 `renderDiscussionSummarySection` 中对 `item.answer` 做引用块包裹或转义。
