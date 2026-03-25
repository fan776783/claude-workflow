# Phase 1.3: Spec Generation 详情

## 目的

生成用户友好的 `spec.md`，将技术设计转化为更清晰、可审查、可引用的规范文档，作为 `plan.md` 的直接上游。

## 执行时机

**强制执行**：Phase 1.2 Spec Review 通过后。

## 输入

- `tech-design.md`
- `requirement baseline`
- `discussion-artifact.json`（如有）
- `acceptance checklist`（如有）
- `implementation guide`（如有，仅作测试策略提示，不主导结构）

## 输出

- `.claude/specs/{task-name}.md`

## 实现细节

### Step 1: 生成 Spec 路径

```typescript
const specPath = `.claude/specs/${sanitizedName}.md`;
ensureDir('.claude/specs');
```

### Step 2: 准备渲染输入

```typescript
const specTemplate = loadTemplate('spec-template.md');
const acceptanceSummary = acceptanceChecklist
  ? renderAcceptanceSummary(acceptanceChecklist)
  : '（无结构化验收清单，需在 Spec 中手动补充验收映射）';

const fileStructure = extractFileStructureFromTechDesign(techDesignContent);
const architectureSummary = extractArchitectureSummary(techDesignContent);
const scopeSummary = deriveScopeSummaryFromBaseline(requirementBaseline);
const outOfScopeSummary = renderOutOfScopeSummary(requirementBaseline);
const traceabilitySummary = renderRequirementTraceability(requirementBaseline);
const requirementCoverageSummary = renderRequirementCoverageSummary(requirementBaseline);
const scopeDecisionSummary = renderScopeDecisionSummary(requirementBaseline);
const criticalConstraintSummary = renderCriticalRequirementConstraints(requirementBaseline);
```

### Step 3: 渲染 Spec 文档

```typescript
const specContent = replaceVars(specTemplate, {
  task_name: taskName,
  requirement_source: requirementSource,
  created_at: new Date().toISOString(),
  requirement_baseline_path: requirementBaselinePath || '',
  tech_design_path: techDesignPath,
  acceptance_checklist_path: acceptanceChecklistPath || '',
  context_summary: requirementContent,
  scope_summary: scopeSummary,
  out_of_scope_summary: outOfScopeSummary,
  requirement_traceability: traceabilitySummary,
  requirement_coverage_summary: requirementCoverageSummary,
  scope_decision_summary: scopeDecisionSummary,
  critical_requirement_constraints: criticalConstraintSummary,
  architecture_summary: architectureSummary,
  file_structure: fileStructure,
  acceptance_mapping: acceptanceSummary,
  implementation_slices: renderImplementationSlicesFromBaseline(requirementBaseline)
});

writeFile(specPath, specContent);
```

## Spec 文档结构

### Front Matter

```yaml
---
version: 1
requirement_source: "docs/prd.md"
created_at: "2026-03-24T10:30:00Z"
requirement_baseline: ".claude/analysis/task-name-requirement-baseline.md"
tech_design: ".claude/tech-design/task-name.md"
acceptance_checklist: ".claude/acceptance/task-name-checklist.md"
status: draft
role: spec
---
```

### 1. Context

描述问题背景、目标和触发来源。

### 2. Scope

基于 baseline 输出 in-scope / out-of-scope，而不是自由摘要 requirementContent。

### 3. Requirement Traceability

把 baseline 中的 requirement item 与 spec 中的 capability / file structure / acceptance 显式映射。

### 4. Critical Requirement Constraints

集中列出后续 plan 与执行阶段不可协商的需求约束。

### 5. User-facing Behavior

描述正常流程、异常流程、边界行为和可观察输出。

### 6. Architecture and Module Design

从用户视角和系统视角整合模块职责。

### 7. File Structure

列出建议新增、修改和测试文件结构。

### 8. Acceptance Mapping

把用户能力映射到验收清单中的具体项。

### 9. Implementation Slices

按可渐进交付的切片组织计划输入，并为每个 slice 标注 Related Requirement IDs。

## 关键设计原则

- 对用户可读，而不是仅供解析器消费
- 可以被 Plan 和 Intent 显式引用
- 章节稳定，适合作为增量变更 diff 基线
- 每节优先描述“是什么 / 边界是什么”，而不是“具体怎么一步步实现”
- 所有 in-scope requirement 都必须在 Spec 中有落点
- 所有 out-of-scope / partial requirement 都必须显式说明原因

## 辅助函数

### deriveScopeSummaryFromBaseline

```typescript
function deriveScopeSummaryFromBaseline(requirementBaseline: RequirementBaseline): string {
  const inScopeItems = requirementBaseline.items.filter(item => item.scope_status === 'in_scope');
  return inScopeItems.length > 0
    ? inScopeItems.map(item => `- [${item.id}] ${item.normalized_summary}`).join('\n')
    : '（未识别到 in-scope requirement，需人工确认）';
}
```

### renderCriticalRequirementConstraints

```typescript
function renderCriticalRequirementConstraints(requirementBaseline: RequirementBaseline): string {
  const constraints = requirementBaseline.items.flatMap(item =>
    item.critical_constraints.map(c => `- [${item.id}] ${c}`)
  );
  return constraints.length > 0 ? constraints.join('\n') : '（未提取关键约束）';
}
```
