# Phase 2.5: Plan Review 详情

## 目的

在 `plan.md` 被编译为 `tasks.md` 之前，对计划进行系统审查，确保其完整性、与 Spec / Baseline 对齐程度、步骤粒度、需求覆盖与可执行性都达到进入编排层的要求。

## 执行时机

**强制执行**：Phase 2 Plan Generation 完成后，Phase 3 Task Compilation 之前。

## 输入

- `plan.md`
- `spec.md`
- `requirement baseline`
- `brief`（如有）

## 审查维度

- **Completeness**：是否覆盖目标文件、步骤、验证和质量关卡
- **Spec Alignment**：是否与 Spec 范围、行为、文件结构保持一致
- **Task Decomposition**：步骤是否足够原子，适合编译成任务 steps[]
- **Buildability**：是否具备可执行、可验证、可收口的实现路径
- **Requirement Coverage**：所有 in-scope requirement 是否至少映射到一个 step
- **Critical Constraint Preservation**：所有关键约束是否在 step 或 Non-Negotiable 约束中出现

## 实现细节

### Step 1: 加载文档

```typescript
const planContent = readFile(planPath);
const specContent = readFile(specPath);
const baselineContent = requirementBaselinePath ? readFile(requirementBaselinePath) : '';
const briefContent = briefPath ? readFile(briefPath) : '';
```

### Step 2: 执行审查

```typescript
const planReview = reviewPlanDocument({
  planContent,
  specContent,
  baselineContent,
  briefContent
});

console.log(`
📋 Plan Review 结果：${planReview.decision}
- 完整性: ${planReview.scores.completeness}/5
- Spec 对齐: ${planReview.scores.specAlignment}/5
- 步骤拆解: ${planReview.scores.decomposition}/5
- 可执行性: ${planReview.scores.buildability}/5
- 需求覆盖: ${planReview.scores.requirementCoverage}/5
- 关键约束保留: ${planReview.scores.criticalConstraintPreservation}/5
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
  notes: planReview.issues,
  metrics: {
    covered_requirement_ids: planReview.coverage.coveredRequirementIds,
    uncovered_requirement_ids: planReview.coverage.uncoveredRequirementIds,
    critical_constraints_covered: planReview.coverage.coveredConstraints
  }
};
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
    requirementCoverage: number;
    criticalConstraintPreservation: number;
  };
  issues: string[];
  coverage: {
    coveredRequirementIds: string[];
    uncoveredRequirementIds: string[];
    coveredConstraints: number;
    missingConstraints: string[];
  };
}
```

## 审查函数

```typescript
function reviewPlanDocument(params: {
  planContent: string;
  specContent: string;
  baselineContent?: string;
  briefContent?: string;
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
  if (!/Requirement Coverage by Step/.test(params.planContent)) {
    issues.push('Plan 缺少 Requirement Coverage by Step 章节');
  }
  if (!/Non-Negotiable Requirement Constraints/.test(params.planContent)) {
    issues.push('Plan 缺少 Non-Negotiable Requirement Constraints 章节');
  }

  const stepCount = (params.planContent.match(/### Step P\d+/g) || []).length;
  if (stepCount === 0) {
    issues.push('Plan 未生成任何可编译的原子步骤');
  }

  const inScopeRequirementIds = extractInScopeRequirementIds(params.baselineContent || '');
  const coveredRequirementIds = extractRequirementIdsFromPlan(params.planContent);
  const uncoveredRequirementIds = inScopeRequirementIds.filter(id => !coveredRequirementIds.includes(id));
  if (uncoveredRequirementIds.length > 0) {
    issues.push(`Plan 未覆盖以下 in-scope requirements: ${uncoveredRequirementIds.join(', ')}`);
  }

  const criticalConstraints = extractCriticalConstraints(params.baselineContent || '');
  const missingConstraints = criticalConstraints.filter(c => !params.planContent.includes(c));
  if (missingConstraints.length > 0) {
    issues.push(`Plan 未体现以下关键约束: ${missingConstraints.join(' | ')}`);
  }

  const hasAcceptanceSection = /## 8\. Acceptance Mapping/.test(params.specContent);
  if (hasAcceptanceSection && !/Acceptance Coverage/.test(params.planContent)) {
    issues.push('Spec 存在验收映射，但 Plan 未提供 Acceptance Coverage');
  }

  return {
    decision: issues.length > 0 ? 'revise' : 'pass',
    scores: {
      completeness: issues.length === 0 ? 5 : 3,
      specAlignment: issues.length === 0 ? 5 : 3,
      decomposition: stepCount >= 3 ? 4 : 2,
      buildability: issues.length === 0 ? 5 : 3,
      requirementCoverage: uncoveredRequirementIds.length === 0 ? 5 : 2,
      criticalConstraintPreservation: missingConstraints.length === 0 ? 5 : 2
    },
    issues,
    coverage: {
      coveredRequirementIds,
      uncoveredRequirementIds,
      coveredConstraints: criticalConstraints.length - missingConstraints.length,
      missingConstraints
    }
  };
}
```

## 强制规则

- 所有 `in_scope` requirement 至少映射到一个 plan step
- 所有 blocked requirement 若影响计划，必须显式标记 dependency 标签
- 所有 critical constraints 至少出现在 step 或 Non-Negotiable 约束中
- 仅覆盖抽象能力但未覆盖具体约束，视为 `partial`，应要求修订
