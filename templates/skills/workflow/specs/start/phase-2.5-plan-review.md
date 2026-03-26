# Phase 2.5: Plan Review 详情

## 目的

在 `plan.md` 被编译为 `tasks.md` 之前，对计划进行系统审查，确保其完整性、与 Spec / Baseline 对齐程度、步骤粒度、需求覆盖与可执行性都达到进入编排层的要求。

> 本阶段属于 **MachineReviewLoop**，显式依赖 `templates/specs/workflow/review-loop.md` 中定义的 shared review loop contract。
>
> 它不再是“单次 review + revise_required”，而是一个**有最大尝试次数、修订边界和结构化 artifact 的 planning-side machine loop**。

## 执行时机

**强制执行**：Phase 2 Plan Generation 完成后，Phase 3 Task Compilation 之前。

## Loop Policy

```typescript
const PLAN_REVIEW_POLICY: ReviewLoopPolicy = {
  max_attempts: 3,
  freeze_truth_sources: [
    requirementBaselinePath,
    requirementBaselineJsonPath,
    specPath
  ],
  allowed_revision_scope: [
    'plan.md: Requirement Coverage by Step',
    'plan.md: Non-Negotiable Requirement Constraints',
    'plan.md: Verification Plan',
    'plan.md: Atomic Steps',
    'plan.md: quality gates / commit checkpoints'
  ],
  escalate_on: ['budget_exhausted']
};
```

**边界约束**：
- 允许修订：coverage、constraints、verification、step decomposition
- 不允许修订：scope、执行目标、requirement truth source
- 若发现需要改 Scope / Goal，必须退出当前 loop，回到更早的规划阶段处理

## 输入

- `plan.md`
- `spec.md`
- `requirement baseline`
- `brief`（如有）

## 审查维度

- **Completeness**：是否覆盖目标文件、步骤、验证和质量关卡
- **Spec Alignment**：是否与 Spec 范围、行为、文件结构保持一致
- **Task Decomposition**：步骤是否足够原子，适合编译成任务 `steps[]`
- **Buildability**：是否具备可执行、可验证、可收口的实现路径
- **Requirement Coverage**：所有 in-scope requirement 是否至少映射到一个 step
- **Critical Constraint Preservation**：所有关键约束是否在 step 或 Non-Negotiable 约束中出现

## 实现细节

### Step 1: 归一化审查对象与 policy

```typescript
const reviewInputs = {
  planContent: readFile(planPath),
  specContent: readFile(specPath),
  baselineContent: requirementBaselinePath ? readFile(requirementBaselinePath) : '',
  briefContent: briefPath ? readFile(briefPath) : ''
};

const reviewSubject: ReviewSubject = {
  kind: 'document',
  ref: planPath,
  requirement_ids: extractInScopeRequirementIds(reviewInputs.baselineContent),
  critical_constraints: extractCriticalConstraints(reviewInputs.baselineContent)
};

const reviewPolicy = PLAN_REVIEW_POLICY;
```

### Step 2: 运行显式 machine loop

```typescript
async function runPlanReviewLoop(): Promise<ReviewLoopArtifact> {
  let attempt = 0;
  let latestResult: PlanReviewResult | null = null;

  while (attempt < reviewPolicy.max_attempts) {
    attempt += 1;
    latestResult = reviewPlanDocument(reviewInputs);

    sinkPlanReviewStatus({
      attempt,
      maxAttempts: reviewPolicy.max_attempts,
      decision: latestResult.decision,
      result: latestResult
    });

    if (latestResult.decision === 'pass') {
      return toPlanReviewArtifact({
        subject: reviewSubject,
        attempt,
        maxAttempts: reviewPolicy.max_attempts,
        decision: 'pass',
        issues: [],
        nextAction: 'continue_to_task_compilation',
        overallPassed: true
      });
    }

    await revisePlanWithinBoundary({
      planPath,
      issues: latestResult.issues,
      allowedRevisionScope: reviewPolicy.allowed_revision_scope
    });

    reviewInputs.planContent = readFile(planPath);
  }

  return toPlanReviewArtifact({
    subject: reviewSubject,
    attempt: reviewPolicy.max_attempts,
    maxAttempts: reviewPolicy.max_attempts,
    decision: 'rejected',
    issues: latestResult ? latestResult.issues : ['Phase 2.5 review loop budget exhausted'],
    blockingIssues: ['Phase 2.5 review loop budget exhausted'],
    nextAction: 'escalate_to_human_plan_rework',
    overallPassed: false
  });
}
```

### Step 3: 将 loop artifact 落盘到状态机

```typescript
function sinkPlanReviewStatus(params: {
  attempt: number;
  maxAttempts: number;
  decision: PlanReviewResult['decision'] | 'rejected';
  result: PlanReviewResult;
}) {
  state.review_status.plan_review = {
    status: params.decision === 'pass' ? 'passed' : params.decision === 'rejected' ? 'rejected' : 'revise_required',
    review_mode: 'machine_loop',
    reviewed_at: new Date().toISOString(),
    reviewer: 'subagent',
    attempt: params.attempt,
    max_attempts: params.maxAttempts,
    last_decision: params.decision,
    next_action: params.decision === 'pass'
      ? 'continue_to_task_compilation'
      : params.decision === 'rejected'
        ? 'escalate_to_human_plan_rework'
        : 'revise_plan_and_retry_phase_2_5',
    blocking_issues: params.decision === 'rejected'
      ? (params.result.blockingIssues || ['Phase 2.5 review loop budget exhausted'])
      : params.result.coverage.missingConstraints,
    notes: params.result.issues,
    metrics: {
      covered_requirement_ids: params.result.coverage.coveredRequirementIds,
      uncovered_requirement_ids: params.result.coverage.uncoveredRequirementIds,
      critical_constraints_covered: params.result.coverage.coveredConstraints
    }
  };

  persistWorkflowState(statePath, state);
}
```

### Step 4: 根据 loop 结论分流

```typescript
const planReviewArtifact = await runPlanReviewLoop();

if (planReviewArtifact.decision === 'pass') {
  console.log('✅ Plan machine loop 通过，继续进入 Task Compilation');
}

if (planReviewArtifact.decision === 'rejected') {
  const finalRejectedResult = reviewPlanDocument(reviewInputs);

  sinkPlanReviewStatus({
    attempt: planReviewArtifact.attempt,
    maxAttempts: planReviewArtifact.max_attempts,
    decision: 'rejected',
    result: {
      ...finalRejectedResult,
      issues: planReviewArtifact.issues,
      blockingIssues: planReviewArtifact.blocking_issues,
      nextAction: planReviewArtifact.next_action,
      coverage: finalRejectedResult.coverage
    }
  });

  console.log(`
❌ Plan Review Loop 已耗尽预算

阻塞项：
${planReviewArtifact.blocking_issues?.map(i => `- ${i}`).join('\n') || '- 无'}

下一步：${planReviewArtifact.next_action}
  `);
  return;
}
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
  blockingIssues?: string[];
  nextAction?: string;
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
    blockingIssues: missingConstraints,
    nextAction: issues.length > 0
      ? 'revise_plan_and_retry_phase_2_5'
      : 'continue_to_task_compilation',
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
- `attempt === max_attempts` 仍未通过时，必须产出 `rejected` artifact 并停止自动 loop
