# Phase 1.1: User Spec Review 详情

## 快速导航

- 想看为什么必须做用户确认：看“目的”
- 想看展示摘要与请求确认：看 Step 1 / Step 2
- 想看不通过如何回退：看输出与状态更新章节
- 想看这是哪种 governance gate：看开头说明

## 何时读取

- `spec.md` 生成完成，准备进入 Plan Generation 之前
- 需要确认 HumanGovernanceGate 的交互与回退规则时

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
- 如不通过，回退到 Phase 1 或 Phase 0.3

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
      { label: 'Spec 正确，生成 Plan', description: '批准 Spec 并进入 Plan Generation，不开始执行' },
      { label: '需要修改 Spec', description: '回到 Phase 1，修改规范文档' },
      { label: '页面分层需要调整', description: '单个页面功能过多，需要拆分' },
      { label: '缺少需求细节', description: '关键交互、例外条件或 must_preserve 细节在 Spec 中被压缩或遗漏' },
      { label: '需要拆分范围', description: '范围过大，需要拆分为多个 Spec' }
    ]
  }]
});
```

### Step 3: 根据用户选择分流

```typescript
if (specChoice === 'Spec 正确，生成 Plan' || specChoice === 'Spec 正确，继续') {
  state.review_status.user_spec_review = {
    status: 'approved',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    next_action: 'continue_to_plan_generation'
  };
  console.log('✅ Spec 已批准，进入 Plan Generation；如需开始执行，后续请显式使用 /workflow execute');
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

if (specChoice === '页面分层需要调整') {
  state.status = 'spec_review';
  state.review_status.user_spec_review = {
    status: 'revise_required',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    next_action: 'return_to_phase_0_3_ux_design_gate'
  };
  console.log('⏸️ 请回到 Phase 0.3 调整页面分层后重新生成 Spec。');
  return;
}

if (specChoice === '缺少用户流程') {
  state.status = 'spec_review';
  state.review_status.user_spec_review = {
    status: 'revise_required',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    next_action: 'return_to_phase_0_3_ux_design_gate'
  };
  console.log('⏸️ 请回到 Phase 0.3 补充用户流程或首次使用引导后重新生成 Spec。');
  return;
}

if (specChoice === '缺少需求细节') {
  state.status = 'spec_review';
  state.review_status.user_spec_review = {
    status: 'revise_required',
    review_mode: 'human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    next_action: 'return_to_phase_1_spec_generation_preserve_requirement_details'
  };
  console.log('⏸️ 请回到 Phase 1 补充 Requirement Traceability、Raw Requirement Nuances 或 must_preserve 细节后重新生成 Spec。');
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
  console.log(`
⏸️ 需要拆分 Spec 范围

当前 Spec 已保存为：${specPath}

恢复方式：
1. 手动缩小 ${specPath} 的 Scope 章节范围，然后使用 /workflow start -f 覆盖启动
2. 或使用 /workflow start -f "新的缩小范围需求" 全新启动
3. 将 out-of-scope 部分另起一个独立的 /workflow start

注意：当前工作流状态为 spec_review，可通过 /workflow status 查看。
  `);
  return;
}
```

## 用户关注点

User Spec Review 应引导用户从六个维度检查：

- 功能覆盖 — 需求范围是否准确（是否有遗漏或越界）
- 需求保真 — must_preserve 的交互细节、例外条件、角色差异是否被保留为 traceability / raw nuances
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
    extractSection(specContent, '### 2.4 Requirement Traceability'),
    extractSection(specContent, '## 3. Constraints'),
    extractSection(specContent, '## 7. Acceptance Criteria'),
    extractSection(specContent, '### 9.1 Raw Requirement Nuances')
  ].filter(Boolean);

  return sections.join('\n\n');
}
```

## 输出结果约定

- **approved**：进入 Phase 2 Plan Generation
- **revise_required**：返回 Phase 1 Spec Generation，或在 UX 结构问题时返回 Phase 0.3 UX 设计审批
- **rejected**：拆分范围后重新启动。恢复方式：手动缩小 Spec Scope 后 `/workflow start -f` 覆盖启动，或全新启动
