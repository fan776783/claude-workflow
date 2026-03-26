# Phase 1.2: Spec Review 详情

## 目的

在生成 `spec.md` 之前，验证当前 `tech-design.md` 是否已经达到可写规范文档的质量门槛，避免把模糊设计直接放大到后续 Plan / Task 阶段。

> 本阶段属于 **MachineReviewLoop**，显式依赖 `templates/specs/workflow/review-loop.md` 中定义的 shared review loop contract。
>
> 它不再只是“一次性检查后 return”，而是一个**有预算、有边界、有产物落盘的 planning-side machine loop**。

## 执行时机

**强制执行**：Phase 1 技术设计完成后，Phase 1.3 Spec Generation 开始前。

## Loop Policy

```typescript
const PHASE_1_2_REVIEW_POLICY: ReviewLoopPolicy = {
  max_attempts: 3,
  freeze_truth_sources: [
    requirementBaselinePath,
    requirementBaselineJsonPath
  ],
  allowed_revision_scope: [
    'tech-design.md: Requirement Traceability',
    'tech-design.md: Out of Scope with Reason',
    'tech-design.md: Critical Constraints to Preserve',
    'tech-design.md: 模块划分 / 数据模型 / 接口设计 / 风险与缓解'
  ],
  escalate_on: ['budget_exhausted', 'split']
};
```

**边界约束**：
- loop 期间允许修订 `tech-design.md`
- loop 期间**不允许**改写 requirement baseline 真相源
- 若 reviewer 结论为 `split`，立即退出自动 loop，升级为人工范围拆分

## 输入

- `tech-design.md`
- `requirement baseline`
- `discussion-artifact.json`（如有）
- `requirementItems`（如有，Phase 0.5 提取输出）
- `brief`（如有）

## 审查目标

- **完整性**：设计是否覆盖主路径、边界路径、约束和主要模块
- **清晰度**：是否存在模糊表述、跳步或未定义术语
- **一致性**：需求、设计、验收之间是否互相冲突
- **范围适配**：当前需求是否适合收敛为单一 Spec
- **YAGNI**：是否存在不必要扩张、提前设计或过度抽象
- **Traceability Completeness**：所有 in-scope requirement 是否在设计中显式落点
- **Critical Constraint Preservation**：baseline 中的关键约束是否在设计中保留
- **Scope Decision Explicitness**：partial / out_of_scope / blocked 是否写清原因

## 实现细节

### Step 1: 归一化审查对象与 policy

```typescript
const reviewInputs = {
  techDesign: readFile(techDesignPath),
  requirementBaseline: requirementBaselinePath ? readFile(requirementBaselinePath) : null,
  discussionArtifact: discussionArtifact || null,
  requirementItems: requirementItems || null,
  brief: briefPath ? readFile(briefPath) : null
};

const reviewSubject: ReviewSubject = {
  kind: 'document',
  ref: techDesignPath,
  requirement_ids: extractInScopeRequirementIds(reviewInputs.requirementBaseline || ''),
  critical_constraints: extractCriticalConstraints(reviewInputs.requirementBaseline || '')
};

const reviewPolicy = PHASE_1_2_REVIEW_POLICY;
```

### Step 2: 运行显式 machine loop

```typescript
async function runPhase12ReviewLoop(): Promise<ReviewLoopArtifact> {
  let attempt = 0;
  let latestResult: SpecReviewResult | null = null;

  while (attempt < reviewPolicy.max_attempts) {
    attempt += 1;
    latestResult = reviewSpecReadiness(reviewInputs);

    sinkPhase12ReviewStatus({
      attempt,
      maxAttempts: reviewPolicy.max_attempts,
      decision: latestResult.decision,
      result: latestResult
    });

    if (latestResult.decision === 'pass') {
      return toPhase12Artifact({
        subject: reviewSubject,
        attempt,
        maxAttempts: reviewPolicy.max_attempts,
        decision: 'pass',
        issues: [],
        nextAction: 'continue_to_spec_generation',
        overallPassed: true
      });
    }

    if (latestResult.decision === 'split') {
      return toPhase12Artifact({
        subject: reviewSubject,
        attempt,
        maxAttempts: reviewPolicy.max_attempts,
        decision: 'split',
        issues: latestResult.splitRecommendations,
        blockingIssues: latestResult.splitRecommendations,
        nextAction: 'escalate_to_user_scope_split',
        overallPassed: false
      });
    }

    await reviseTechDesignWithinBoundary({
      techDesignPath,
      issues: latestResult.issues,
      traceabilityIssues: latestResult.traceabilityIssues,
      allowedRevisionScope: reviewPolicy.allowed_revision_scope
    });

    reviewInputs.techDesign = readFile(techDesignPath);
  }

  return toPhase12Artifact({
    subject: reviewSubject,
    attempt: reviewPolicy.max_attempts,
    maxAttempts: reviewPolicy.max_attempts,
    decision: 'rejected',
    issues: latestResult
      ? [...latestResult.issues, ...latestResult.traceabilityIssues]
      : ['Phase 1.2 review loop budget exhausted'],
    blockingIssues: ['Phase 1.2 review loop budget exhausted'],
    nextAction: 'escalate_to_human_scope_review',
    overallPassed: false
  });
}
```

### Step 3: 将 loop artifact 落盘到状态机

```typescript
function sinkPhase12ReviewStatus(params: {
  attempt: number;
  maxAttempts: number;
  decision: SpecReviewResult['decision'] | 'rejected';
  result: SpecReviewResult;
}) {
  const reviewedAt = new Date().toISOString();
  const reviewStatus = params.decision === 'pass'
    ? 'passed'
    : (params.decision === 'split' || params.decision === 'rejected')
      ? 'rejected'
      : 'revise_required';

  state.review_status.spec_review = {
    status: reviewStatus,
    review_mode: 'machine_loop',
    reviewed_at: reviewedAt,
    reviewer: 'subagent',
    attempt: params.attempt,
    max_attempts: params.maxAttempts,
    last_decision: params.decision,
    next_action: params.decision === 'pass'
      ? 'continue_to_spec_generation'
      : params.decision === 'split'
        ? 'escalate_to_user_scope_split'
        : params.decision === 'rejected'
          ? 'escalate_to_human_scope_review'
          : 'revise_tech_design_and_retry_phase_1_2',
    blocking_issues: params.decision === 'split'
      ? params.result.splitRecommendations
      : params.decision === 'rejected'
        ? (params.result.blockingIssues || ['Phase 1.2 review loop budget exhausted'])
        : [],
    notes: params.decision === 'split'
      ? params.result.splitRecommendations
      : params.decision === 'rejected'
        ? params.result.issues
        : params.result.issues,
    metrics: {
      completeness: params.result.scores.completeness,
      traceabilityCompleteness: params.result.scores.traceabilityCompleteness,
      criticalConstraintPreservation: params.result.scores.criticalConstraintPreservation,
      scopeDecisionExplicitness: params.result.scores.scopeDecisionExplicitness
    }
  };

  state.review_status.traceability_review = {
    status: reviewStatus,
    review_mode: 'machine_loop',
    reviewed_at: reviewedAt,
    reviewer: 'subagent',
    attempt: params.attempt,
    max_attempts: params.maxAttempts,
    last_decision: params.decision,
    next_action: state.review_status.spec_review.next_action,
    blocking_issues: params.result.traceabilityIssues,
    notes: params.result.traceabilityIssues,
    metrics: {
      in_scope_total: params.result.traceabilityMetrics.inScopeTotal,
      mapped_in_design: params.result.traceabilityMetrics.mappedInDesign,
      mapped_critical_constraints: params.result.traceabilityMetrics.mappedCriticalConstraints,
      uncovered_requirement_ids: params.result.traceabilityMetrics.uncoveredRequirementIds
    }
  };

  persistWorkflowState(statePath, state);
}
```

### Step 4: 根据 loop 结论分流

```typescript
const phase12Artifact = await runPhase12ReviewLoop();

if (phase12Artifact.decision === 'pass') {
  console.log('✅ Phase 1.2 machine loop 通过，继续生成 spec.md');
}

if (phase12Artifact.decision === 'split') {
  console.log(`
⚠️ Phase 1.2 判定当前范围不适合继续自动收敛为单一 Spec

需人工处理：
${phase12Artifact.issues.map(i => `- ${i}`).join('\n')}
  `);
  return;
}

if (phase12Artifact.decision === 'rejected') {
  const finalRejectedResult = reviewSpecReadiness(reviewInputs);

  sinkPhase12ReviewStatus({
    attempt: phase12Artifact.attempt,
    maxAttempts: phase12Artifact.max_attempts,
    decision: 'rejected',
    result: {
      ...finalRejectedResult,
      issues: phase12Artifact.issues,
      traceabilityIssues: finalRejectedResult.traceabilityIssues,
      splitRecommendations: [],
      blockingIssues: phase12Artifact.blocking_issues,
      nextAction: phase12Artifact.next_action
    }
  });

  console.log(`
❌ Phase 1.2 review loop 已耗尽预算

阻塞项：
${phase12Artifact.blocking_issues?.map(i => `- ${i}`).join('\n') || '- 无'}

下一步：${phase12Artifact.next_action}
  `);
  return;
}
```

## 审查结果数据结构

```typescript
interface SpecReviewResult {
  decision: 'pass' | 'revise' | 'split';
  scores: {
    completeness: number;
    clarity: number;
    consistency: number;
    scopeFit: number;
    yagni: number;
    traceabilityCompleteness: number;
    criticalConstraintPreservation: number;
    scopeDecisionExplicitness: number;
  };
  issues: string[];
  traceabilityIssues: string[];
  splitRecommendations: string[];
  blockingIssues?: string[];
  nextAction?: string;
  traceabilityMetrics: {
    inScopeTotal: number;
    mappedInDesign: number;
    mappedCriticalConstraints: number;
    uncoveredRequirementIds: string[];
  };
}
```

## 审查函数

```typescript
function reviewSpecReadiness(inputs: {
  techDesign: string;
  requirementBaseline?: string | null;
  discussionArtifact?: any;
  requirementItems?: any;
  brief?: string | null;
}): SpecReviewResult {
  const issues: string[] = [];
  const traceabilityIssues: string[] = [];
  const splitRecommendations: string[] = [];

  const hasTraceability = /## 2\. Requirement Traceability/.test(inputs.techDesign);
  const hasOutOfScope = /### 2\.3 Out of Scope with Reason/.test(inputs.techDesign);
  const hasCriticalConstraints = /### 2\.4 Critical Constraints to Preserve/.test(inputs.techDesign);
  const hasModuleStructure = /### 4\.1 模块划分/.test(inputs.techDesign);
  const hasDataModel = /### 4\.2 数据模型/.test(inputs.techDesign);
  const hasInterfaceDesign = /### 4\.3 接口设计/.test(inputs.techDesign);
  const hasRisks = /## 6\. 风险与缓解/.test(inputs.techDesign);

  if (!hasTraceability) issues.push('缺少 Requirement Traceability 章节');
  if (!hasOutOfScope) issues.push('缺少 Out of Scope with Reason 章节');
  if (!hasCriticalConstraints) issues.push('缺少 Critical Constraints to Preserve 章节');
  if (!hasModuleStructure) issues.push('缺少模块划分章节');
  if (!hasDataModel) issues.push('缺少数据模型章节');
  if (!hasInterfaceDesign) issues.push('缺少接口设计章节');
  if (!hasRisks) issues.push('缺少风险与缓解章节');

  const inScopeIds = extractInScopeRequirementIds(inputs.requirementBaseline || '');
  const mappedIds = extractRequirementIdsFromTechDesign(inputs.techDesign);
  const uncoveredRequirementIds = inScopeIds.filter(id => !mappedIds.includes(id));
  if (uncoveredRequirementIds.length > 0) {
    traceabilityIssues.push(`存在未在设计中映射的 in-scope requirements: ${uncoveredRequirementIds.join(', ')}`);
  }

  const criticalConstraints = extractCriticalConstraints(inputs.requirementBaseline || '');
  const missingConstraints = criticalConstraints.filter(c => !inputs.techDesign.includes(c));
  if (missingConstraints.length > 0) {
    traceabilityIssues.push(`存在未保留的关键约束: ${missingConstraints.join(' | ')}`);
  }

  const missingScopeReasons = hasOutOfScope ? [] : ['partial / out_of_scope / blocked 原因未显式记录'];
  traceabilityIssues.push(...missingScopeReasons);

  const overlyWide = /以及|并且|同时支持.+以及.+并支持/.test(inputs.techDesign);
  if (overlyWide) {
    splitRecommendations.push('需求疑似包含多个子系统，建议拆分为多个 Spec');
  }

  const mustRevise = uncoveredRequirementIds.length > 0 || missingConstraints.length > 0;
  const decision = splitRecommendations.length > 0
    ? 'split'
    : (issues.length > 0 || mustRevise)
      ? 'revise'
      : 'pass';

  return {
    decision,
    scores: {
      completeness: issues.length === 0 ? 5 : 3,
      clarity: 4,
      consistency: 4,
      scopeFit: overlyWide ? 2 : 4,
      yagni: 4,
      traceabilityCompleteness: uncoveredRequirementIds.length === 0 ? 5 : 2,
      criticalConstraintPreservation: missingConstraints.length === 0 ? 5 : 2,
      scopeDecisionExplicitness: missingScopeReasons.length === 0 ? 5 : 2
    },
    issues,
    traceabilityIssues,
    splitRecommendations,
    blockingIssues: decision === 'split' ? splitRecommendations : [],
    nextAction: decision === 'pass'
      ? 'continue_to_spec_generation'
      : decision === 'split'
        ? 'escalate_to_user_scope_split'
        : 'revise_tech_design_and_retry_phase_1_2',
    traceabilityMetrics: {
      inScopeTotal: inScopeIds.length,
      mappedInDesign: mappedIds.length,
      mappedCriticalConstraints: criticalConstraints.length - missingConstraints.length,
      uncoveredRequirementIds
    }
  };
}
```

## 强制规则

- 任何 `in_scope` requirement 若未映射到 tech-design / spec，必须 `revise`
- 任何 `constraints` 若未在设计显式出现，必须 `revise`
- 任何 `partial / out_of_scope / blocked` 若未带 reason，应提示修订
- `split` 不参与自动修文重试，必须升级为人工范围治理
- `attempt === max_attempts` 仍未通过时，必须产出 `rejected` artifact 并停止自动 loop
