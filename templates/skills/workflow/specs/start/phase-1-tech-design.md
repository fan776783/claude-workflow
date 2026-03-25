# Phase 1: 技术设计生成详情

## 目的

在生成用户可审查的 `spec.md` 之前，先明确架构决策、系统边界、关键风险和技术约束，形成稳定的设计底稿。

> `tech-design.md` 的职责是**设计**，不再直接承担任务拆解与实施计划编译输入职责。但它必须显式消费 Requirement Baseline，并对需求去向做出可审查说明。

## 执行时机

**强制执行**：每次启动工作流时必须执行，位于 Phase 0.7 之后、Phase 1.2 之前。

## 输入

- `requirementContent`
- `requirementAnalysis`（如有）
- `requirement baseline`（如有）
- `discussion-artifact.json`（如有）
- `analysisResult`

## 实现细节

### Step 1: 生成任务名称

```typescript
const taskName = generateTaskName(requirementContent);
const sanitizedName = sanitize(taskName);

const techDesignPath = `.claude/tech-design/${sanitizedName}.md`;
ensureDir('.claude/tech-design');
```

### Step 2: 检查文件冲突

```typescript
let existingChoice = null;
if (fileExists(techDesignPath)) {
  if (forceOverwrite) {
    existingChoice = '重新生成';
    console.log(`⚡ 强制覆盖：${techDesignPath}`);
  } else {
    // 询问用户使用现有设计 / 重新生成 / 取消
  }
}
```

### Step 3: 生成技术设计文档

```typescript
if (!fileExists(techDesignPath) || existingChoice === '重新生成') {
  const relatedFilesTable = analysisResult.relatedFiles.length > 0
    ? analysisResult.relatedFiles.map(f =>
        `| \`${f.path}\` | ${f.purpose} | ${f.reuseType} |`
      ).join('\n')
    : '| - | - | - |';

  const patternsContent = analysisResult.patterns.length > 0
    ? analysisResult.patterns.map(p => `- **${p.name}**: ${p.description}`).join('\n')
    : '（未检测到）';

  const constraintsContent = analysisResult.constraints.length > 0
    ? analysisResult.constraints.map(c => `- ${c}`).join('\n')
    : '（无特殊约束）';

  const requirementDetailSections = requirementAnalysis
    ? renderRequirementDetailSections(requirementAnalysis)
    : '';

  const traceabilitySection = requirementBaseline
    ? renderRequirementTraceability(requirementBaseline)
    : '（未生成 Requirement Baseline，需手动补齐追溯章节）';

  const outOfScopeSection = requirementBaseline
    ? renderOutOfScopeWithReason(requirementBaseline)
    : '（未显式判定）';

  const criticalConstraintsSection = requirementBaseline
    ? renderCriticalConstraints(requirementBaseline)
    : '（未提取）';

  const techDesignTemplate = loadTemplate('tech-design-template.md');

  const techDesignContent = replaceVars(techDesignTemplate, {
    requirement_source: requirementSource,
    created_at: new Date().toISOString(),
    task_name: taskName,
    requirement_baseline_path: requirementBaselinePath || '',
    requirement_summary: requirementContent,
    requirement_detail_sections: requirementDetailSections,
    scope_classification_summary: renderScopeClassificationSummary(requirementBaseline),
    requirement_traceability: traceabilitySection,
    out_of_scope_with_reason: outOfScopeSection,
    critical_constraints_to_preserve: criticalConstraintsSection,
    related_files_table: relatedFilesTable,
    existing_patterns: patternsContent,
    constraints: constraintsContent,
    architecture_decisions: '（请根据需求补充模块职责与边界）',
    module_structure: '（请根据需求补充模块结构）',
    data_models: '（请根据需求补充数据模型）',
    interface_design: '（请根据需求补充接口设计）',
    implementation_plan: '| 1 | 待补充 | - | - |',
    risks: '| （待评估） | - | - |',
    acceptance_criteria: '（请结合 acceptance checklist 与 baseline 补充）'
  });

  writeFile(techDesignPath, techDesignContent);
}
```

## 技术设计文档结构

### Front Matter

```yaml
---
version: 3
requirement_source: "docs/prd.md"
created_at: "2026-03-24T10:00:00Z"
requirement_baseline: ".claude/analysis/task-name-requirement-baseline.md"
status: draft
role: design-foundation
next_stage: spec-review
---
```

### 1. 需求摘要

原始需求内容与结构化提取摘要。

### 2. Requirement Traceability

必须显式回答以下问题：

- 哪些 requirement 是 in-scope
- 哪些 requirement 是 partial / out-of-scope / blocked
- 哪些 critical constraints 必须被后续 spec 继承
- 哪些原始需求最容易在后续摘要中丢失

### 3. 代码分析结果

记录相关代码、现有模式与技术约束。

### 4. 架构设计

记录模块划分、数据模型、接口设计、模块职责与边界。

### 5. 实施计划

仅给出高层实施框架，不直接承担 plan 编译职责。

### 6. 风险与缓解

记录当前方案中的系统性风险与缓解措施。

### 7. 验收标准

对接 acceptance checklist 的高层标准。

## Spec Readiness Checklist

- [ ] 范围边界明确
- [ ] Requirement Traceability 已显式填写
- [ ] Out of Scope with Reason 已显式填写
- [ ] Critical Constraints to Preserve 已显式填写
- [ ] 模块划分可落到文件结构
- [ ] 用户行为已覆盖主路径与异常路径
- [ ] 验收来源已对齐 acceptance checklist
- [ ] 无明显 YAGNI 设计扩张

> 此清单用于 Phase 1.2 Spec Review，不用于直接生成任务。
