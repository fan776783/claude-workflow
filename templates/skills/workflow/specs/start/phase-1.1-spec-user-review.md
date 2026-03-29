# Phase 1.1: User Spec Review 详情

## 目的

在进入 Plan 生成前，让用户显式确认 `spec.md` 的范围、架构设计、验收标准和关键约束。

> 本阶段属于 **HumanGovernanceGate**。它只负责范围和方向的主权确认，不参与机器自动修文。

## 执行时机

**强制执行**：Phase 1 Spec Generation 完成后，Phase 2 Plan Generation 之前。

## 输入

- `spec.md`

## 输出

- 用户审查结论
- `review_status.user_spec_review`
- 如不通过，回退到 Phase 1

## 实现细节

### Step 1: 展示 Spec 摘要

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧾 Phase 1.1: User Spec Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const specContent = readFile(specPath);
const specSummary = summarizeSpec(specContent);
console.log(specSummary);
```

### Step 2: 请求用户确认

```typescript
const specChoice = await AskUserQuestion({
  questions: [{
    question: '请确认当前 Spec 是否正确反映了需求范围、架构设计和用户体验？',
    header: 'User Spec Review（多维度）',
    multiSelect: false,
    options: [
      { label: 'Spec 正确，继续', description: '进入 Plan Generation' },
      { label: '需要修改 Spec', description: '回到 Phase 1，修改规范文档' },
      { label: '页面分层需要调整', description: '单个页面功能过多，需要拆分' },
      { label: '缺少用户流程', description: '需要补充操作流程图或首次使用引导' },
      { label: '需要拆分范围', description: '范围过大，需要拆分为多个 Spec' }
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
    next_action: 'continue_to_plan_generation'
  };
  console.log('✅ Spec 已批准，继续进入 Plan Generation');
}

if (specChoice === '需要修改 Spec') {
  state.status = 'spec_review';
  state.review_status.user_spec_review = {
    status: 'revise_required',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    next_action: 'return_to_phase_1_spec_generation'
  };
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
    next_action: 'split_scope'
  };
  console.log('⏸️ 请拆分 Spec 范围后重新启动');
  return;
}
```

## 用户关注点

User Spec Review 应引导用户从六个维度检查：

- 功能覆盖 — 需求范围是否准确（是否有遗漏或越界）
- 架构合理性 — 关键约束是否被正确记录，架构设计是否合理
- UX 合理性 — 页面分层是否合理，单页面尿不应承载超过 4 个独立功能模块
- 信息密度 — 操作步骤是否过多，是否需要分层导航
- 首次体验 — 新用户首次使用是否有引导流程
- 多平台联动 — 工作目录是否可自动发现和关联

## Spec 摘要函数

```typescript
function summarizeSpec(specContent: string): string {
  const sections = [
    extractSection(specContent, '## 2. Scope'),
    extractSection(specContent, '## 3. Constraints'),
    extractSection(specContent, '## 7. Acceptance Criteria')
  ].filter(Boolean);

  return sections.join('\n\n');
}
```

## 输出结果约定

- **approved**：进入 Phase 2 Plan Generation
- **revise_required**：返回 Phase 1 Spec Generation
- **rejected**：拆分范围后重新启动
