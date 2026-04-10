---
version: 3
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
status: draft
role: spec
prd_coverage: "prd-spec-coverage.json"
---

# Spec: {{task_name}}

> 统一规范文档：需求范围 + 设计决策 + 验收标准

## 1. Context

{{context_summary}}

### 1.1 Problem Statement

- 当前问题：
- 业务目标：
- 成功结果：

### 1.2 Assumptions

- 技术假设：
- 业务假设：

---

## 2. Scope

### 2.1 In Scope

{{scope_summary}}

### 2.2 Out of Scope

{{out_of_scope_summary}}

### 2.3 Blocked

{{blocked_summary}}

---

## 3. Constraints

> 不可协商的硬约束，来自原始需求或技术限制。

{{critical_constraints}}

---

## 4. User-facing Behavior

### 4.1 Primary Flow

{{user_facing_behavior}}

### 4.2 Error and Edge Flows

- 异常输入：
- 空状态 / 无权限 / 外部依赖失败：
- 降级与提示：

### 4.3 Observable Outcomes

- 页面 / 接口 / 日志 / 状态变化：
- 用户可感知反馈：

---

## 5. Architecture and Module Design

{{architecture_summary}}

### 5.1 Module Responsibilities

- 模块 A：
- 模块 B：
- 模块 C：

### 5.2 Data Models

- 核心数据对象：
- 输入输出契约：

### 5.3 Technology Choices

- 框架 / 库 / 存储选型及理由：

### 5.4 Risks and Trade-offs

- 风险：
- 权衡：
- 不采用方案：

---

## 6. File Structure

{{file_structure}}

---

## 7. Acceptance Criteria

{{acceptance_criteria}}

### 7.1 Test Strategy

- 单元测试：
- 集成测试：
- E2E 测试：

---

## 8. Implementation Slices

{{implementation_slices}}

---

## 9. Open Questions

- 问题 1：
- 问题 2：
