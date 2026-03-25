# Phase 1.3: Spec Generation 详情

## 目的

生成用户友好的 `spec.md`，将技术设计转化为更清晰、可审查、可引用的规范文档，作为 `plan.md` 的直接上游。

## 执行时机

**强制执行**：Phase 1.2 Spec Review 通过后。

## 输入

- `tech-design.md`
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
const scopeSummary = deriveScopeSummary(requirementContent, discussionArtifact);
```

### Step 3: 渲染 Spec 文档

```typescript
let specContent: string;

if (specTemplate) {
  specContent = replaceVars(specTemplate, {
    task_name: taskName,
    requirement_source: requirementSource,
    created_at: new Date().toISOString(),
    tech_design_path: techDesignPath,
    acceptance_checklist_path: acceptanceChecklistPath || '',
    context_summary: requirementContent,
    scope_summary: scopeSummary,
    architecture_summary: architectureSummary,
    file_structure: fileStructure,
    acceptance_mapping: acceptanceSummary,
    implementation_slices: '1. 先打通主路径\n2. 再补充异常与边界\n3. 最后收敛质量门禁'
  });
} else {
  specContent = generateInlineSpec({
    taskName,
    requirementSource,
    techDesignPath,
    acceptanceChecklistPath,
    requirementContent,
    scopeSummary,
    architectureSummary,
    fileStructure,
    acceptanceSummary
  });
}

writeFile(specPath, specContent);
console.log(`✅ Spec 已生成：${specPath}`);
```

## Spec 文档结构

### Front Matter

```yaml
---
version: 1
requirement_source: "docs/prd.md"
created_at: "2026-03-24T10:30:00Z"
tech_design: ".claude/tech-design/task-name.md"
acceptance_checklist: ".claude/acceptance/task-name-checklist.md"
status: draft
role: spec
---
```

### 1. Context

描述问题背景、目标和触发来源。

### 2. Scope

#### 2.1 In Scope

明确本次 Spec 包含的能力边界。

#### 2.2 Out of Scope

明确不做什么，限制范围蔓延。

#### 2.3 Subsystem Boundaries

描述前后端、模块或服务的边界责任。

### 3. User-facing Behavior

描述正常流程、异常流程、边界行为和可观察输出。

### 4. Architecture and Module Design

从用户视角和系统视角整合模块职责。

### 5. File Structure

列出建议新增、修改和测试文件结构。

### 6. Acceptance Mapping

把用户能力映射到验收清单中的具体项。

### 7. Implementation Slices

按可渐进交付的切片组织计划输入，而不是直接列任务。

## 关键设计原则

- 对用户可读，而不是仅供解析器消费
- 可以被 Plan 和 Intent 显式引用
- 章节稳定，适合作为增量变更 diff 基线
- 每节优先描述“是什么 / 边界是什么”，而不是“具体怎么一步步实现”

## 辅助函数

### renderAcceptanceSummary

```typescript
function renderAcceptanceSummary(checklistContent: string): string {
  const matches = checklistContent.match(/AC-[^\n]+/g) || [];
  return matches.length > 0
    ? matches.map(item => `- ${item}`).join('\n')
    : '（未检测到标准验收项 ID，建议手动整理映射）';
}
```

### extractFileStructureFromTechDesign

```typescript
function extractFileStructureFromTechDesign(techDesignContent: string): string {
  const match = techDesignContent.match(/### 3\.2 模块划分[\s\S]*?(?=\n### )/);
  return match ? match[0].replace('### 3.2 模块划分', '').trim() : '（待补充文件结构）';
}
```

### extractArchitectureSummary

```typescript
function extractArchitectureSummary(techDesignContent: string): string {
  const match = techDesignContent.match(/## 3\. 架构设计[\s\S]*?(?=\n## 4\.)/);
  return match ? match[0].replace('## 3. 架构设计', '').trim() : '（待补充架构设计摘要）';
}
```

### deriveScopeSummary

```typescript
function deriveScopeSummary(requirementContent: string, discussionArtifact?: any): string {
  const clarified = discussionArtifact?.clarifications?.length || 0;
  return `基于原始需求与 ${clarified} 条澄清结果整理的范围说明。`;
}
```

### generateInlineSpec

```typescript
function generateInlineSpec(params: {
  taskName: string;
  requirementSource: string;
  techDesignPath: string;
  acceptanceChecklistPath?: string;
  requirementContent: string;
  scopeSummary: string;
  architectureSummary: string;
  fileStructure: string;
  acceptanceSummary: string;
}): string {
  return `---
version: 1
requirement_source: "${params.requirementSource}"
created_at: "${new Date().toISOString()}"
tech_design: "${params.techDesignPath}"
acceptance_checklist: "${params.acceptanceChecklistPath || ''}"
status: draft
role: spec
---

# Spec: ${params.taskName}

## 1. Context

${params.requirementContent}

## 2. Scope

### 2.1 In Scope

${params.scopeSummary}

### 2.2 Out of Scope

- 本阶段未在需求中明确提出的扩展能力
- 与本次交付无直接关系的系统性重构

### 2.3 Subsystem Boundaries

- 以现有系统边界为准，避免跨上下文侵入式改造

## 3. User-facing Behavior

- 覆盖主路径、异常路径和边界行为
- 输出应与验收项可对应

## 4. Architecture and Module Design

${params.architectureSummary}

## 5. File Structure

${params.fileStructure}

## 6. Acceptance Mapping

${params.acceptanceSummary}

## 7. Implementation Slices

1. 先打通主路径
2. 再补全异常和边界
3. 最后完成测试与质量收口
`;
}
```
