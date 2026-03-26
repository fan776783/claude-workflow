# Phase 1.4: User Spec Review 详情

## 目的

在进入 Plan 生成前，让用户显式确认 `spec.md` 的范围、模块边界、用户行为和验收映射，形成后续执行的稳定共识。

> 本阶段属于 **HumanGovernanceGate**。
>
> 它不是质量收敛 loop，不负责机器自动修文或自动重审；它只负责**范围、边界、模块切分与方向主权确认**。

## 执行时机

**强制执行**：Phase 1.3 Spec Generation 完成后，Phase 1.5 Intent Review 之前。

## 输入

- `spec.md`
- `tech-design.md`
- `acceptance checklist`（如有）

## 输出

- 用户审查结论
- `review_status.user_spec_review`
- 如不通过，回退到 `Phase 1.3` 或 `Phase 1`

## 治理语义

- `review_mode = 'human_gate'`
- `attempt = 1`
- `max_attempts = 1`
- 不参与 machine loop
- 用户结论直接决定后续走向，不做自动收敛

## 实现细节

### Step 1: 展示 Spec 摘要

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧾 Phase 1.4: User Spec Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const specSummary = summarizeSpecForReview(readFile(specPath));
console.log(specSummary);
```

### Step 2: 请求用户确认

```typescript
const specChoice = await AskUserQuestion({
  questions: [{
    question: '请确认当前 Spec 是否正确反映了本次需求范围与设计边界？',
    header: 'User Spec Review',
    multiSelect: false,
    options: [
      { label: 'Spec 正确，继续', description: '进入 Intent Review 和 Plan Generation' },
      { label: '需要修改 Spec', description: '回到 Phase 1.3，修改规范文档' },
      { label: '需要拆分范围', description: '回到技术设计或重新拆分需求' }
    ]
  }]
});
```

### Step 3: 根据用户选择分流

```typescript
if (specChoice === 'Spec 正确，继续') {
  state.status = 'planned';
  state.review_status.user_spec_review = {
    status: 'approved',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    attempt: 1,
    max_attempts: 1,
    last_decision: 'pass',
    next_action: 'continue_to_intent_check'
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  console.log('✅ User Spec Governance Gate 已批准，继续进入 Intent Review');
}

if (specChoice === '需要修改 Spec') {
  state.status = 'spec_review';
  state.review_status.user_spec_review = {
    status: 'revise_required',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    attempt: 1,
    max_attempts: 1,
    last_decision: 'revise',
    next_action: 'return_to_phase_1_3_spec_generation',
    notes: ['用户要求修改 Spec 后再继续']
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  console.log(`⏸️ 请先修改 Spec：${specPath}`);
  return;
}

if (specChoice === '需要拆分范围') {
  state.status = 'spec_review';
  state.review_status.user_spec_review = {
    status: 'rejected',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    attempt: 1,
    max_attempts: 1,
    last_decision: 'split',
    next_action: 'return_to_phase_1_scope_split',
    blocking_issues: ['范围需拆分后再进入 Plan 阶段'],
    notes: ['用户认为当前 Spec 范围过宽，需要拆分']
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  console.log('⏸️ 请回退到技术设计阶段重新拆分范围');
  return;
}
```

## 用户关注点

User Spec Review 应引导用户重点检查：

- 范围是否准确，是否有遗漏或越界
- 用户可见行为是否描述充分
- 模块边界是否合理
- 文件结构是否符合团队预期
- 验收映射是否覆盖关键能力

## Spec 摘要函数

```typescript
function summarizeSpecForReview(specContent: string): string {
  const sections = [
    extractSection(specContent, '## 1. Context'),
    extractSection(specContent, '## 2. Scope'),
    extractSection(specContent, '## 3. User-facing Behavior'),
    extractSection(specContent, '## 6. Acceptance Mapping')
  ].filter(Boolean);

  return sections.join('\n\n');
}
```

## 辅助函数

```typescript
function extractSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}[\\s\\S]*?(?=\\n## |$)`);
  const match = content.match(regex);
  return match ? match[0].trim() : '';
}
```

## 输出结果约定

- **approved**：进入 `Phase 1.5 IntentConsistencyCheck`
- **revise_required**：返回 `Phase 1.3 Spec Generation`
- **rejected**：返回 `Phase 1` 或更早阶段，重新收敛范围
