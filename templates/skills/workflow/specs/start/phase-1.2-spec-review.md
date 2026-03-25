# Phase 1.2: Spec Review 详情

## 目的

在生成 `spec.md` 之前，验证当前 `tech-design.md` 是否已经达到可写规范文档的质量门槛，避免把模糊设计直接放大到后续 Plan / Task 阶段。

## 执行时机

**强制执行**：Phase 1 技术设计完成后，Phase 1.3 Spec Generation 开始前。

## 输入

- `tech-design.md`
- `discussion-artifact.json`（如有）
- `requirementAnalysis`（如有）
- `acceptance checklist`（如有）

## 审查目标

- **完整性**：设计是否覆盖主路径、边界路径、约束和主要模块
- **清晰度**：是否存在模糊表述、跳步或未定义术语
- **一致性**：需求、设计、验收之间是否互相冲突
- **范围适配**：当前需求是否适合收敛为单一 Spec
- **YAGNI**：是否存在不必要扩张、提前设计或过度抽象

## 实现细节

### Step 1: 汇总审查输入

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Phase 1.2: Spec Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const reviewInputs = {
  techDesign: readFile(techDesignPath),
  discussionArtifact: discussionArtifact || null,
  requirementAnalysis: requirementAnalysis || null,
  acceptanceChecklist: acceptanceChecklist ? readFile(acceptanceChecklistPath) : null
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
  notes: specReviewResult.issues
};

writeFile(statePath, JSON.stringify(state, null, 2));
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
  };
  issues: string[];
  splitRecommendations: string[];
}
```

## 审查函数

```typescript
function reviewSpecReadiness(inputs: {
  techDesign: string;
  discussionArtifact?: any;
  requirementAnalysis?: any;
  acceptanceChecklist?: string | null;
}): SpecReviewResult {
  const issues: string[] = [];
  const splitRecommendations: string[] = [];

  const hasModuleStructure = /### 3\.2 模块划分/.test(inputs.techDesign);
  const hasDataModel = /### 3\.3 数据模型/.test(inputs.techDesign);
  const hasInterfaceDesign = /### 3\.4 接口设计/.test(inputs.techDesign);
  const hasRisks = /## 4\. 风险与缓解/.test(inputs.techDesign);

  if (!hasModuleStructure) issues.push('缺少模块划分章节');
  if (!hasDataModel) issues.push('缺少数据模型章节');
  if (!hasInterfaceDesign) issues.push('缺少接口设计章节');
  if (!hasRisks) issues.push('缺少风险与缓解章节');

  if (inputs.acceptanceChecklist && !/验收/.test(inputs.techDesign)) {
    issues.push('设计未显式体现验收来源或验收映射意图');
  }

  const scoreBase = issues.length === 0 ? 5 : Math.max(2, 5 - issues.length);
  const overlyWide = /以及|并且|同时支持.+以及.+并支持/.test(inputs.techDesign);

  if (overlyWide) {
    splitRecommendations.push('需求疑似包含多个子系统，建议拆分为多个 Spec');
  }

  return {
    decision: splitRecommendations.length > 0 ? 'split' : issues.length > 2 ? 'revise' : 'pass',
    scores: {
      completeness: scoreBase,
      clarity: scoreBase,
      consistency: scoreBase,
      scopeFit: overlyWide ? 2 : 4,
      yagni: 4
    },
    issues,
    splitRecommendations
  };
}
```

## 输出

- 审查结论：`pass / revise / split`
- 状态记录：`review_status.spec_review`
- 缺口列表：供回退到 `tech-design.md` 修订时使用
