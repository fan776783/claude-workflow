---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
status: draft  # draft | approved | superseded
---

# 技术方案: {{task_name}}

## 1. 需求摘要

{{requirement_summary}}

## 2. 代码分析结果

### 2.1 相关现有代码

| 文件 | 用途 | 复用方式 |
|------|------|----------|
| `{{file_path}}` | {{purpose}} | {{reuse_type}} |

### 2.2 现有架构模式

{{existing_patterns}}

### 2.3 技术约束

{{constraints}}

## 3. 架构设计

### 3.1 模块划分

```
{{module_structure}}
```

### 3.2 数据模型

```typescript
{{data_models}}
```

### 3.3 接口设计

```typescript
{{interface_design}}
```

## 4. 实施计划

| 序号 | 任务 | 文件 | 依赖 |
|------|------|------|------|
| {{index}} | {{task_name}} | `{{file_path}}` | {{dependencies}} |

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| {{risk}} | {{impact}} | {{mitigation}} |

## 6. 验收标准

{{acceptance_criteria}}

## 7. PBT 属性清单

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

## 8. Codex 审查记录

（审查后自动追加）

## 9. 变更历史

| Change ID | 日期 | 类型 | 摘要 | 状态 |
|-----------|------|------|------|------|
| CHG-001 | {{created_at}} | new_requirement | 初始设计 | applied |
