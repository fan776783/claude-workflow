# Phase 2.5: Plan Review 详情

## 目的

在 `plan.md` 被编译为 `tasks.md` 之前，对计划进行系统审查，确保其完整性、与 Spec 对齐程度、步骤粒度和可执行性都达到进入编排层的要求。

## 执行时机

**强制执行**：Phase 2 Plan Generation 完成后，Phase 3 Task Compilation 之前。

## 输入

- `plan.md`
- `spec.md`
- `acceptance checklist`（如有）
- `implementation guide`（如有）

## 审查维度

- **Completeness**：是否覆盖目标文件、步骤、验证和质量关卡
- **Spec Alignment**：是否与 Spec 范围、行为、文件结构保持一致
- **Task Decomposition**：步骤是否足够原子，适合编译成任务 steps[]
- **Buildability**：是否具备可执行、可验证、可收口的实现路径

## 实现细节

### Step 1: 加载文档

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Phase 2.5: Plan Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const planContent = readFile(planPath);
const specContent = readFile(specPath);
const acceptanceContent = acceptanceChecklistPath ? readFile(acceptanceChecklistPath) : '';
```

### Step 2: 执行审查

```typescript
const planReview = reviewPlanDocument({
  planContent,
  specContent,
  acceptanceContent
});

console.log(`
📋 Plan Review 结果：${planReview.decision}
- 完整性: ${planReview.scores.completeness}/5
- Spec 对齐: ${planReview.scores.specAlignment}/5
- 步骤拆解: ${planReview.scores.decomposition}/5
- 可执行性: ${planReview.scores.buildability}/5
`);
```

### Step 3: 根据结论分流

```typescript
if (planReview.decision === 'pass') {
  console.log('✅ Plan 已通过审查，继续进入 Task Compilation');
}

if (planReview.decision === 'revise') {
  console.log(`
⚠️ Plan 仍需修订后再编译任务

待修订项：
${planReview.issues.map(i => `- ${i}`).join('\n')}
  `);
  return;
}
```

### Step 4: 更新状态机

```typescript
state.review_status.plan_review = {
  status: planReview.decision === 'pass' ? 'passed' : 'revise_required',
  reviewed_at: new Date().toISOString(),
  reviewer: 'subagent',
  notes: planReview.issues
};

writeFile(statePath, JSON.stringify(state, null, 2));
```

## 审查结果结构

```typescript
interface PlanReviewResult {
  decision: 'pass' | 'revise';
  scores: {
    completeness: number;
    specAlignment: number;
    decomposition: number;
    buildability: number;
  };
  issues: string[];
}
```

## 审查函数

```typescript
function reviewPlanDocument(params: {
  planContent: string;
  specContent: string;
  acceptanceContent?: string;
}): PlanReviewResult {
  const issues: string[] = [];

  if (!/## 2\. File Structure First/.test(params.planContent)) {
    issues.push('Plan 缺少 File Structure First 章节');
  }
  if (!/## 4\. Atomic Steps/.test(params.planContent)) {
    issues.push('Plan 缺少 Atomic Steps 章节');
  }
  if (!/## 5\. Verification Plan/.test(params.planContent)) {
    issues.push('Plan 缺少 Verification Plan 章节');
  }
  if (!/spec_file:/.test(params.planContent)) {
    issues.push('Plan 未记录 spec_file 引用');
  }

  const stepCount = (params.planContent.match(/### Step P\d+/g) || []).length;
  if (stepCount === 0) {
    issues.push('Plan 未生成任何可编译的原子步骤');
  }

  const hasAcceptanceSection = /## 6\. Acceptance Mapping/.test(params.specContent);
  if (hasAcceptanceSection && !/Acceptance Coverage/.test(params.planContent)) {
    issues.push('Spec 存在验收映射，但 Plan 未提供 Acceptance Coverage');
  }

  return {
    decision: issues.length > 0 ? 'revise' : 'pass',
    scores: {
      completeness: issues.length === 0 ? 5 : 3,
      specAlignment: issues.length === 0 ? 5 : 3,
      decomposition: stepCount >= 3 ? 4 : 2,
      buildability: issues.length === 0 ? 5 : 3
    },
    issues
  };
}
```

## 输出

- 审查结论：`pass / revise`
- 状态记录：`review_status.plan_review`
- 修订建议：供回退到 `Phase 2 Plan Generation` 时使用
