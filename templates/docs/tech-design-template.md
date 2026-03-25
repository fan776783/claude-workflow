---
version: 3
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
requirement_baseline: "{{requirement_baseline_path}}"
status: draft  # draft | approved | superseded
---

# 技术方案: {{task_name}}

## 1. 需求摘要

{{requirement_summary}}

{{requirement_detail_sections}}

## 2. Requirement Traceability

### 2.1 Scope Classification Summary

{{scope_classification_summary}}

### 2.2 Requirement Traceability Mapping

{{requirement_traceability}}

### 2.3 Out of Scope with Reason

{{out_of_scope_with_reason}}

### 2.4 Critical Constraints to Preserve

{{critical_constraints_to_preserve}}

## 3. 代码分析结果

### 3.1 相关现有代码

| 文件 | 用途 | 复用方式 |
|------|------|----------|
{{related_files_table}}

### 3.2 现有架构模式

{{existing_patterns}}

### 3.3 技术约束

{{constraints}}

## 4. 架构设计

### 4.1 模块划分

```
{{module_structure}}
```

### 4.2 数据模型

```typescript
{{data_models}}
```

### 4.3 接口设计

```typescript
{{interface_design}}
```

### 4.4 模块职责与边界

{{architecture_decisions}}

## 5. 实施计划

| 序号 | 任务 | 文件 | 依赖 |
|------|------|------|------|
{{implementation_plan}}

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
{{risks}}

## 7. 验收标准

{{acceptance_criteria}}

## 8. PBT 属性清单

> Property-Based Testing 属性定义系统行为的不变性约束

{{#if pbt_properties.length}}
| ID | 属性名 | 类别 | 定义 |
|----|--------|------|------|
{{#each pbt_properties}}
| {{id}} | {{name}} | {{category}} | {{definition}} |
{{/each}}

### 边界条件

{{#each pbt_properties}}
- **{{id}}**: {{boundaryConditions}}
{{/each}}

### 证伪策略

{{#each pbt_properties}}
- **{{id}}**: {{falsificationStrategy}}
{{/each}}
{{else}}
_（PBT 属性将在代码分析阶段自动提取）_
{{/if}}

## 9. Codex 审查记录

（审查后自动追加）

## 10. 变更历史

| Change ID | 日期 | 类型 | 摘要 | 状态 |
|-----------|------|------|------|------|
| CHG-001 | {{created_at}} | new_requirement | 初始设计 | applied |
