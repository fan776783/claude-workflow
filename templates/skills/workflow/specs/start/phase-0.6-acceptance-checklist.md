# Phase 0.6: 验证清单生成详情

## 目的

将 Requirement Baseline 与结构化需求转换为可执行的验证清单，用于验证功能交付质量。验证清单关注用户视角的验收标准，与 Phase 0.7 生成的实现指南（开发者视角）互补。

> 自本版本起，验收清单不再只是“按类型整理的验证项集合”，而是 Baseline 的**派生覆盖视图**：每个 requirement 都要能看到自己的验收去向与覆盖级别。

## 执行条件

**条件执行**：仅在 Phase 0.55 成功生成 Requirement Baseline 后执行

```typescript
if (requirementAnalysis && requirementBaseline) {
  acceptanceChecklist = generateAcceptanceChecklist(requirementAnalysis, requirementBaseline, taskName);
  // Phase 0.6 完成后，自动触发 Phase 0.7 生成实现指南
} else {
  console.log(`⏭️ 跳过（未生成 Requirement Baseline）\n`);
}
```

## 与 Phase 0.7 的关系

- **Phase 0.6 (验收清单)**: 用户视角的验收标准，用于验证交付质量
- **Phase 0.7 (实现指南)**: 开发者视角的实现路径，提供 TDD 流程和测试模板

两者都必须消费 Requirement Baseline，并通过 requirement IDs 保持一致。

## 数据结构

### AcceptanceChecklist

```typescript
interface AcceptanceChecklist {
  requirementCoverageSummary: RequirementCoverageSummary;
  requirementToAcceptanceMapping: RequirementToAcceptanceMapping[];
  partiallyCoveredRequirements: RequirementCoverageGap[];
  uncoveredRequirements: RequirementCoverageGap[];
  formValidations: FormValidation[];
  permissionValidations: PermissionValidation[];
  interactionValidations: InteractionValidation[];
  businessRuleValidations: BusinessRuleValidation[];
  edgeCaseValidations: EdgeCaseValidation[];
  uiDisplayValidations: UiDisplayValidation[];
  functionalFlowValidations: FunctionalFlowValidation[];
  taskChecklistMapping: TaskChecklistMapping[];
}
```

```typescript
interface RequirementCoverageSummary {
  totalRequirements: number;
  inScopeRequirements: number;
  fullyCovered: number;
  partiallyCovered: number;
  uncovered: number;
}

interface RequirementToAcceptanceMapping {
  requirementId: string;
  requirementSummary: string;
  scopeStatus: 'in_scope' | 'partially_in_scope' | 'out_of_scope' | 'blocked';
  coverageLevel: 'full' | 'partial' | 'none';
  acceptanceIds: string[];
  notes?: string;
}

interface RequirementCoverageGap {
  requirementId: string;
  summary: string;
  reason: string;
  suggestedAction?: string;
}
```

### FormValidation

```typescript
interface FormValidation {
  scene: string;
  sceneId: string;
  relatedRequirementIds: string[];
  items: Array<{
    fieldName: string;
    checks: string[];
    testCases: Array<{ input: string; expected: string }>;
    relatedRequirementIds?: string[];
  }>;
}
```

### PermissionValidation

```typescript
interface PermissionValidation {
  role: string;
  roleId: string;
  relatedRequirementIds: string[];
  items: Array<{
    scenario: string;
    checks: string[];
    testSteps: string[];
    relatedRequirementIds?: string[];
  }>;
}
```

### InteractionValidation

```typescript
interface InteractionValidation {
  category: string;
  categoryId: string;
  relatedRequirementIds: string[];
  items: Array<{
    element: string;
    trigger: string;
    checks: string[];
    precondition: string;
    relatedRequirementIds?: string[];
  }>;
}
```

### BusinessRuleValidation

```typescript
interface BusinessRuleValidation {
  ruleId: string;
  description: string;
  relatedRequirementIds: string[];
  checks: string[];
  relatedFields: string;
  testScenarios: Array<{
    scenario: string;
    input: string;
    expected: string;
  }>;
}
```

### EdgeCaseValidation

```typescript
interface EdgeCaseValidation {
  scenario: string;
  relatedRequirementIds: string[];
  checks: string[];
  context: string;
  fallback: string;
}
```

### UiDisplayValidation

```typescript
interface UiDisplayValidation {
  context: string;
  contextId: string;
  relatedRequirementIds: string[];
  items: Array<{
    rule: string;
    checks: string[];
    visualChecks: string[];
    relatedRequirementIds?: string[];
  }>;
}
```

### FunctionalFlowValidation

```typescript
interface FunctionalFlowValidation {
  flowName: string;
  relatedRequirementIds: string[];
  steps: string[];
  conditionalPaths: Array<{
    condition: string;
    expectedBehavior: string;
  }>;
  entryPoints: Array<{
    entry: string;
    expectedResult: string;
  }>;
}
```

## 转换策略

### 1. Baseline → Requirement Coverage Summary

先从 Requirement Baseline 中读取所有 `in_scope` 与 `partially_in_scope` 条目，再检查每条 requirement 是否在验收清单中有对应 acceptance IDs。

```typescript
function buildRequirementCoverageSummary(
  requirementBaseline: RequirementBaseline,
  mappings: RequirementToAcceptanceMapping[]
): RequirementCoverageSummary {
  const inScope = requirementBaseline.items.filter(item => item.scope_status === 'in_scope');
  return {
    totalRequirements: requirementBaseline.items.length,
    inScopeRequirements: inScope.length,
    fullyCovered: mappings.filter(item => item.coverageLevel === 'full').length,
    partiallyCovered: mappings.filter(item => item.coverageLevel === 'partial').length,
    uncovered: mappings.filter(item => item.coverageLevel === 'none').length
  };
}
```

### 2. RequirementItem → 验收映射

**转换规则**：
- 每个 `in_scope` requirement 至少尝试映射到一个 acceptance item
- 若只覆盖到部分语义或未覆盖关键约束，则标记 `partial`
- 若完全没有验收落点，则标记 `none`
- `out_of_scope / blocked` requirement 也应列出，但说明为什么当前不验收

### 3. 结构化需求 → 分类验收项

保留原有按表单、权限、交互、业务规则、边界场景、UI 展示、功能流程分组的方式，但每一组都必须带 `relatedRequirementIds`。

## 模板渲染约定

验收清单模板必须与 workflow 其他规划模板保持一致，统一使用 `replaceVars(template, vars)` 的 `{{placeholder}}` 语法，不使用单大括号占位符。

```typescript
const prioritySummary = summarizeAcceptancePriorities(acceptanceChecklist);
const acceptanceCommands = resolveAcceptanceCommands(projectConfig);
const acceptanceTemplate = loadTemplate('acceptance-checklist-template.md');
const acceptanceMarkdown = replaceVars(acceptanceTemplate, {
  task_name: taskName,
  sanitized_name: sanitizedName,
  requirement_source: requirementSource,
  created_at: new Date().toISOString(),
  requirement_baseline_path: requirementBaselinePath,
  implementation_guide_path: implementationGuidePath,
  tech_design_path: techDesignPath,
  tasks_file_path: path.join(workflowDir, `tasks-${sanitizedName}.md`),
  total_count: prioritySummary.total,
  p0_count: prioritySummary.p0,
  p1_count: prioritySummary.p1,
  p2_count: prioritySummary.p2,
  requirement_coverage_summary: renderRequirementCoverageSummary(coverageSummary),
  requirement_total_count: coverageSummary.totalRequirements,
  requirement_in_scope_count: coverageSummary.inScopeRequirements,
  requirement_full_coverage_count: coverageSummary.fullyCovered,
  requirement_partial_coverage_count: coverageSummary.partiallyCovered,
  requirement_none_coverage_count: coverageSummary.uncovered,
  requirement_to_acceptance_mapping: renderRequirementToAcceptanceMapping(mappings),
  form_validation_items: renderFormValidations(acceptanceChecklist.formValidations),
  permission_validation_items: renderPermissionValidations(acceptanceChecklist.permissionValidations),
  interaction_validation_items: renderInteractionValidations(acceptanceChecklist.interactionValidations),
  business_rule_validation_items: renderBusinessRuleValidations(acceptanceChecklist.businessRuleValidations),
  edge_case_validation_items: renderEdgeCaseValidations(acceptanceChecklist.edgeCaseValidations),
  ui_display_validation_items: renderUiDisplayValidations(acceptanceChecklist.uiDisplayValidations),
  functional_flow_validation_items: renderFunctionalFlowValidations(acceptanceChecklist.functionalFlowValidations),
  partially_covered_requirements: renderCoverageGaps(partiallyCoveredRequirements),
  uncovered_requirements: renderCoverageGaps(uncoveredRequirements),
  quality_gate_command: acceptanceCommands.qualityGate,
  coverage_command: acceptanceCommands.coverage,
  performance_check_command: acceptanceCommands.performance
});
```

```typescript
interface AcceptanceChecklistTemplateVars {
  task_name: string;
  sanitized_name: string;
  requirement_source: string;
  created_at: string;
  requirement_baseline_path: string;
  implementation_guide_path: string;
  tech_design_path: string;
  tasks_file_path: string;
  total_count: number;
  p0_count: number;
  p1_count: number;
  p2_count: number;
  requirement_coverage_summary: string;
  requirement_total_count: number;
  requirement_in_scope_count: number;
  requirement_full_coverage_count: number;
  requirement_partial_coverage_count: number;
  requirement_none_coverage_count: number;
  requirement_to_acceptance_mapping: string;
  form_validation_items: string;
  permission_validation_items: string;
  interaction_validation_items: string;
  business_rule_validation_items: string;
  edge_case_validation_items: string;
  ui_display_validation_items: string;
  functional_flow_validation_items: string;
  partially_covered_requirements: string;
  uncovered_requirements: string;
  quality_gate_command: string;
  coverage_command: string;
  performance_check_command: string;
}
```

- `summarizeAcceptancePriorities()` 负责生成 `total_count / p0_count / p1_count / p2_count`
- `resolveAcceptanceCommands()` 负责生成 `quality_gate_command / coverage_command / performance_check_command`
- 所有 `*_items` 字段都必须在渲染前转换为 Markdown 字符串，模板本身不做结构遍历

> 若模板新增字段，必须同步在此处补充变量映射，避免模板语法与渲染契约漂移。

## 强制规则

- 任何 `in_scope` requirement 不允许在验收清单中“无声消失”
- 任何 `partial` requirement 必须写明缺口原因
- 任何 `uncovered` requirement 必须在 `Uncovered Requirements` 区块显式暴露
- 验收项 ID 与 requirement IDs 必须可双向追溯

## 输出要求

生成的验收清单必须包含：

- Requirement Coverage Summary
- Requirement-to-Acceptance Mapping
- Partially Covered Requirements
- Uncovered Requirements
- 原有分类验收结构
