# Phase 1.2: Spec Review 详情

## 目的

在生成 `spec.md` 之前，验证当前 `tech-design.md` 是否已经达到可写规范文档的质量门槛，避免把模糊设计直接放大到后续 Plan / Task 阶段。

> 本阶段不再只是“文档结构检查”，而是升级为 **结构审查 + 追溯审查 + 关键约束审查**。

## 执行时机

**强制执行**：Phase 1 技术设计完成后，Phase 1.3 Spec Generation 开始前。

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

### Step 1: 汇总审查输入

```typescript
const reviewInputs = {
  techDesign: readFile(techDesignPath),
  requirementBaseline: requirementBaseline ? readFile(requirementBaselinePath) : null,
  discussionArtifact: discussionArtifact || null,
  requirementItems: requirementItems || null,
  brief: brief ? readFile(briefPath) : null
};
```

### Step 2: 运行 Spec 审查

```typescript
const specReviewResult = reviewSpecReadiness(reviewInputs);

console.log(`
📋 Spec Review 结果：${specReviewResult.decision}
- 完整性: ${specReviewResult.scores.completeness}/5
- 清晰度: ${specReviewResult.scores.clarity}/5
- 一致性: ${specReviewResult.scores.consistency}/5
- 范围适配: ${specReviewResult.scores.scopeFit}/5
- YAGNI: ${specReviewResult.scores.yagni}/5
- 追溯完整性: ${specReviewResult.scores.traceabilityCompleteness}/5
- 关键约束保留: ${specReviewResult.scores.criticalConstraintPreservation}/5
- 范围判定显式性: ${specReviewResult.scores.scopeDecisionExplicitness}/5
`);
```

### Step 3: 根据结论分流

```typescript
if (specReviewResult.decision === 'pass') {
  console.log('✅ 设计已达到 Spec 编写门槛，继续生成 spec.md');
}

if (specReviewResult.decision === 'revise') {
  console.log(`
⚠️ 设计仍需补充后再生成 Spec

待修订项：
${specReviewResult.issues.map(i => `- ${i}`).join('\n')}
  `);
  return;
}

if (specReviewResult.decision === 'split') {
  console.log(`
⚠️ 当前范围不适合单一 Spec，请先拆分需求或回退技术设计

拆分建议：
${specReviewResult.splitRecommendations.map(i => `- ${i}`).join('\n')}
  `);
  return;
}
```

### Step 4: 更新状态机

```typescript
state.review_status.spec_review = {
  status: specReviewResult.decision === 'pass' ? 'passed' : 'revise_required',
  reviewed_at: new Date().toISOString(),
  reviewer: 'subagent',
  notes: specReviewResult.issues,
  metrics: {
    completeness: specReviewResult.scores.completeness,
    traceabilityCompleteness: specReviewResult.scores.traceabilityCompleteness,
    criticalConstraintPreservation: specReviewResult.scores.criticalConstraintPreservation,
    scopeDecisionExplicitness: specReviewResult.scores.scopeDecisionExplicitness
  }
};

state.review_status.traceability_review = {
  status: specReviewResult.decision === 'pass' ? 'passed' : 'revise_required',
  reviewed_at: new Date().toISOString(),
  reviewer: 'subagent',
  notes: specReviewResult.traceabilityIssues,
  metrics: {
    in_scope_total: specReviewResult.traceabilityMetrics.inScopeTotal,
    mapped_in_design: specReviewResult.traceabilityMetrics.mappedInDesign,
    mapped_critical_constraints: specReviewResult.traceabilityMetrics.mappedCriticalConstraints,
    uncovered_requirement_ids: specReviewResult.traceabilityMetrics.uncoveredRequirementIds
  }
};
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

  return {
    decision: splitRecommendations.length > 0 ? 'split' : (issues.length > 0 || mustRevise) ? 'revise' : 'pass',
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
