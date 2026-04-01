# Phase 1: Spec Generation 详情

## 快速导航

- 想看 Spec 的输入来源：看“输入”
- 想看结构化提取与范围判定：看 Step 2 及后续章节
- 想看模板与输出路径：看 Step 1 与输出章节
- 想看 UX / discussion artifact 如何并入：看输入与生成步骤

## 何时读取

- Phase 0 / 0.2 / 0.3 完成后，需要正式生成 `spec.md` 时
- 需要确认 spec 作为唯一规范输入时

## 目的

生成统一的 `spec.md`，在单一文档中完成需求范围判定、关键约束提取、架构设计、用户行为描述和验收标准定义。

> spec.md 是后续 plan.md 的**唯一权威上游**。不再生成独立的 requirement-baseline、brief 或 tech-design。

## 执行时机

**强制执行**：Phase 0（代码分析）完成后执行；若 Phase 0.2（需求讨论）被触发则必须先完成，若 Phase 0.3（UX 设计审批）被触发则必须先审批通过。

## 输入

- `requirementContent`（原始需求或 PRD 内容）
- `analysisResult`（Phase 0 代码分析结果）
- `discussion-artifact.json`（如有，Phase 0.2 讨论结果）
- `ux-design-artifact.json`（如有，Phase 0.3 UX 设计工件）
- `projectConfig`（项目配置）

## 输出

- `.claude/specs/{task-name}.md`

## 实现细节

### Step 1: 生成路径与检查冲突

```typescript
const specPath = `.claude/specs/${sanitizedName}.md`;
ensureDir('.claude/specs');

if (fileExists(specPath) && !forceOverwrite) {
  // 询问用户使用现有 / 重新生成 / 取消
}
```

### Step 2: 需求结构化（内联执行）

从 PRD 内容中提取结构化需求，在 spec 内部完成（不再生成独立 baseline）：

```typescript
// 从需求内容中提取需求条目
const requirements = extractRequirements(requirementContent, discussionArtifact);

// 为每条需求编号并判定范围
const classifiedRequirements = requirements.map((req, index) => ({
  id: `R-${String(index + 1).padStart(3, '0')}`,
  summary: req.summary,
  scope_status: classifyScope(req),  // in_scope / out_of_scope / blocked
  constraints: extractConstraints(req),
  owner: classifyOwner(req)
}));
```

### Step 3: 架构设计（内联执行）

基于代码分析和需求，直接在 spec 中完成架构决策：

```typescript
const architectureDecisions = {
  modules: deriveModules(classifiedRequirements, analysisResult),
  dataModels: deriveDataModels(classifiedRequirements),
  fileStructure: deriveFileStructure(analysisResult, classifiedRequirements),
  risks: identifyRisks(classifiedRequirements, analysisResult)
};
```

### Step 4: 验收标准（内联执行）

为每个模块生成验收标准：

```typescript
const acceptanceCriteria = classifiedRequirements
  .filter(r => r.scope_status === 'in_scope')
  .map(req => ({
    requirementId: req.id,
    criteria: deriveAcceptanceCriteria(req),
    testStrategy: deriveTestStrategy(req, projectConfig)
  }));
```

### Step 5: 渲染 Spec 文档

```typescript
const specTemplate = loadTemplate('spec-template.md');
const specContent = replaceVars(specTemplate, {
  task_name: taskName,
  requirement_source: requirementSource,
  created_at: new Date().toISOString(),
  context_summary: requirementContent,
  scope_summary: renderScopeSummary(classifiedRequirements),
  out_of_scope_summary: renderOutOfScope(classifiedRequirements),
  blocked_summary: renderBlocked(classifiedRequirements),
  clarification_summary: renderClarificationSummary(discussionArtifact),
  critical_constraints: renderConstraints(classifiedRequirements, uxDesignArtifact?.detectedWorkspaces),
  user_facing_behavior: renderUserFacingBehavior(classifiedRequirements, uxDesignArtifact),
  architecture_summary: renderArchitecture(architectureDecisions, discussionArtifact),
  file_structure: renderFileStructure(architectureDecisions.fileStructure),
  acceptance_criteria: renderAcceptanceCriteria(acceptanceCriteria),
  implementation_slices: renderSlices(classifiedRequirements)
});

writeFile(specPath, specContent);
```

## Spec 文档结构

### Front Matter

```yaml
---
version: 2
requirement_source: "docs/prd.md"
created_at: "2026-03-29T10:00:00Z"
status: draft
role: spec
---
```

### 1. Context
问题背景、目标和触发来源。

### 2. Scope
基于需求判定 in-scope / out-of-scope / blocked。每条需求编号 R-001 起。

### 3. Clarification Summary
汇总 Phase 0.2 的关键澄清结论、选定方案和未就绪依赖（若存在讨论工件）。

### 4. Constraints
集中列出不可协商的关键约束（字段名、条件分支、上限值等）。
**包含**：多 Agent / 工作区相关的预设目录与环境约束（来自 Phase 0.3 UX 设计工件，如有）。

### 5. User-facing Behavior
正常流程、异常流程、边界行为、可观察输出。
**包含**：用户操作流程图（Mermaid），从首次打开到核心操作完成的完整路径（来自 Phase 0.3 UX 设计工件）。

### 6. Architecture and Module Design
模块划分、数据模型、接口设计、技术选型、风险与权衡。
**包含**：页面信息架构表（层级、页面、功能、导航方式）（来自 Phase 0.3 UX 设计工件）；若讨论阶段已选定方案，则作为架构设计起点。

### 7. File Structure
新建、修改、测试文件清单。

### 8. Acceptance Criteria
按模块组织的验收条件和测试策略。

### 9. Implementation Slices
按可渐进交付的切片组织，标注 Related Requirement IDs。

### 10. Open Questions
待确认的问题。

## Spec Self-Review

Spec 生成后，必须执行一次内联自审查（非子 Agent）：

1. **需求覆盖扫描** — 逐条检查原始需求，确认每条都在 Scope 章节有对应条目
2. **Placeholder 扫描** — 搜索 "TBD"、"TODO"、"待补充" 等占位符
3. **内部一致性** — 架构章节是否与用户行为章节一致
4. **约束完整性** — 原始需求中的硬约束是否都在 Constraints 章节出现
5. **UX 流程一致性** — 流程图中的每个步骤是否在 User-facing Behavior 有对应描述（仅当 uxDesignArtifact 存在时）
6. **页面分层合理性** — 单页面不超过 4 个独立功能模块（仅当 uxDesignArtifact 存在时）
7. **首次使用体验** — 涉及工作区/初始化概念时必须有首次使用引导描述

发现问题直接修复，无需重新审查。

> 注：此 Self-Review 与执行阶段的「Spec 合规审查（子 Agent）」是不同的机制。Self-Review 为内联自检，聚焦 spec 文档本身的完整性和一致性；执行阶段的 Spec 合规审查由 [`../../../workflow-reviewing/SKILL.md`](../../../workflow-reviewing/SKILL.md) 承接的独立审查协议执行，聚焦**代码实现**与 spec 的一致性，且仅在质量关卡等条件满足时触发。

## 强制规则

- 所有需求都必须在 Scope 章节有明确判定（in_scope / out_of_scope / blocked）
- 所有 out_of_scope 和 blocked 需求必须写明原因
- 所有硬约束（字段名、数量限制、条件分支等）必须在 Constraints 章节出现
- 验收标准章节必须覆盖所有 in_scope 需求
- 禁止占位符（TBD/TODO/待补充）
