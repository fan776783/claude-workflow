---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
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

- 不在本次交付中的功能：
- 明确不做的优化项：
- 后续迭代再考虑的内容：

### 2.3 Subsystem Boundaries

- 前端职责：
- 后端职责：
- 数据层职责：
- 外部依赖边界：

---

## 3. User-facing Behavior

### 3.1 Primary Flow

- 入口：
- 关键步骤：
- 成功结果：

### 3.2 Error and Edge Flows

- 异常输入：
- 空状态 / 无权限 / 外部依赖失败：
- 降级与提示：

### 3.3 Observable Outcomes

- 页面 / 接口 / 日志 / 状态变化：
- 用户可感知反馈：

---

## 4. Architecture and Module Design

{{architecture_summary}}

### 4.1 Module Responsibilities

- 模块 A：
- 模块 B：
- 模块 C：

### 4.2 Data and Interface Boundaries

- 核心数据对象：
- 输入输出契约：
- 跨模块调用关系：

### 4.3 Risks and Trade-offs

- 风险：
- 权衡：
- 不采用方案：

---

## 5. File Structure

{{file_structure}}

### 5.1 Files to Create

- `path/to/new-file`

### 5.2 Files to Modify

- `path/to/existing-file`

### 5.3 Files to Test

- `tests/example.test.ts`

---

## 6. Acceptance Mapping

{{acceptance_mapping}}

### 6.1 Capability → Acceptance

| Capability | Acceptance Criteria | Notes |
|------------|---------------------|-------|
| 示例能力 | AC-1 | 说明 |

### 6.2 Gaps to Resolve

- 若验收清单未覆盖的内容，需在进入 Plan 前补充：

---

## 7. Implementation Slices

{{implementation_slices}}

### 7.1 Slice 1

- 目标：
- 交付边界：
- 验证方式：

### 7.2 Slice 2

- 目标：
- 交付边界：
- 验证方式：

### 7.3 Slice 3

- 目标：
- 交付边界：
- 验证方式：

---

## 8. Open Questions

- 问题 1：
- 问题 2：

---

## 9. References

- 技术设计：`{{tech_design_path}}`
- 验收清单：`{{acceptance_checklist_path}}`
