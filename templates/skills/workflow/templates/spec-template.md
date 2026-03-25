---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
requirement_baseline: "{{requirement_baseline_path}}"
tech_design: "{{tech_design_path}}"
acceptance_checklist: "{{acceptance_checklist_path}}"
status: draft
role: spec
---

# Spec: {{task_name}}

> 本文档是用户可审查、后续 Plan 可引用的稳定规范层文档。

## 1. Context

{{context_summary}}

### 1.1 Problem Statement

- 当前问题：
- 业务目标：
- 成功结果：

### 1.2 Constraints and Assumptions

- 技术约束：
- 业务约束：
- 默认假设：

---

## 2. Scope

### 2.1 In Scope

{{scope_summary}}

### 2.2 Out of Scope

{{out_of_scope_summary}}

### 2.3 Subsystem Boundaries

- 前端职责：
- 后端职责：
- 数据层职责：
- 外部依赖边界：

---

## 3. Requirement Traceability

{{requirement_traceability}}

### 3.1 Requirement Coverage Summary

{{requirement_coverage_summary}}

### 3.2 Out-of-Scope / Partial Decisions

{{scope_decision_summary}}

---

## 4. Critical Requirement Constraints

{{critical_requirement_constraints}}

---

## 5. User-facing Behavior

### 5.1 Primary Flow

- 入口：
- 关键步骤：
- 成功结果：

### 5.2 Error and Edge Flows

- 异常输入：
- 空状态 / 无权限 / 外部依赖失败：
- 降级与提示：

### 5.3 Observable Outcomes

- 页面 / 接口 / 日志 / 状态变化：
- 用户可感知反馈：

---

## 6. Architecture and Module Design

{{architecture_summary}}

### 6.1 Module Responsibilities

- 模块 A：
- 模块 B：
- 模块 C：

### 6.2 Data and Interface Boundaries

- 核心数据对象：
- 输入输出契约：
- 跨模块调用关系：

### 6.3 Risks and Trade-offs

- 风险：
- 权衡：
- 不采用方案：

---

## 7. File Structure

{{file_structure}}

### 7.1 Files to Create

- `path/to/new-file`

### 7.2 Files to Modify

- `path/to/existing-file`

### 7.3 Files to Test

- `tests/example.test.ts`

---

## 8. Acceptance Mapping

{{acceptance_mapping}}

### 8.1 Capability → Acceptance

| Capability | Acceptance Criteria | Notes |
|------------|---------------------|-------|
| 示例能力 | AC-1 | 说明 |

### 8.2 Gaps to Resolve

- 若验收清单未覆盖的内容，需在进入 Plan 前补充：

---

## 9. Implementation Slices

{{implementation_slices}}

### 9.1 Slice 1

- 目标：
- 交付边界：
- 验证方式：
- Related Requirement IDs:

### 9.2 Slice 2

- 目标：
- 交付边界：
- 验证方式：
- Related Requirement IDs:

### 9.3 Slice 3

- 目标：
- 交付边界：
- 验证方式：
- Related Requirement IDs:

---

## 10. Open Questions

- 问题 1：
- 问题 2：

---

## 11. References

- Requirement Baseline：`{{requirement_baseline_path}}`
- 技术设计：`{{tech_design_path}}`
- 验收清单：`{{acceptance_checklist_path}}`
