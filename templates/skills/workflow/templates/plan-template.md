---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
spec_file: "{{spec_file}}"
acceptance_checklist: "{{acceptance_checklist_path}}"
implementation_guide: "{{implementation_guide_path}}"
status: draft
role: plan
---

# Plan: {{task_name}}

> 本文档是从 Spec 派生的实施计划，目标是为 Task Compilation 提供稳定、细粒度、可验证的输入。

## 1. Plan Context

- **Spec**: `{{spec_file}}`
- **Requirement Source**: `{{requirement_source}}`
- **Acceptance Checklist**: `{{acceptance_checklist_path}}`
- **Implementation Guide**: `{{implementation_guide_path}}`

### 1.1 Scope Check

- 本 Plan 仅覆盖已批准 Spec 的 in-scope 内容
- 若发现新增范围，应回退到 Spec 阶段处理
- 若发现范围过大，应拆成多个 Plan

---

## 2. File Structure First

### 2.1 Files to Create

{{files_create}}

### 2.2 Files to Modify

{{files_modify}}

### 2.3 Files to Test

{{files_test}}

### 2.4 Reuse Opportunities

{{reuse_summary}}

---

## 3. Execution Strategy

### 3.1 Ordering Rationale

{{ordering_rationale}}

### 3.2 Parallelization Opportunities

- 哪些步骤可并行：
- 哪些步骤必须串行：
- 冲突风险：

### 3.3 Quality Constraints

- 需要满足的硬约束：
- TDD 要求：
- 必须保留的现有行为：

---

## 4. Atomic Steps

{{atomic_steps}}

### Step P1

- **Goal**:
- **Spec Ref**:
- **Files**:
- **Action Type**:
- **Expected Result**:
- **Verification**:
- **Depends On**:

### Step P2

- **Goal**:
- **Spec Ref**:
- **Files**:
- **Action Type**:
- **Expected Result**:
- **Verification**:
- **Depends On**:

---

## 5. Verification Plan

### 5.1 Step-level Verification

{{verification_plan}}

### 5.2 Integration Verification

- 集成验证命令：
- 期望输出：
- 回归范围：

### 5.3 Acceptance Coverage

| Plan Step | Acceptance Criteria | Verification |
|-----------|---------------------|--------------|
| P1 | AC-1 | `pnpm test ...` |

---

## 6. Quality Gates and Commit Points

### 6.1 Quality Gates

- Gate 1:
- Gate 2:

### 6.2 Commit Strategy

- 提交节点：
- Commit 粒度：
- 不应合并的改动：

---

## 7. Risks and Fallbacks

- 风险 1：
- 风险 2：
- 回退方案：

---

## 8. Task Compilation Notes

- 任务编译器应从本 Plan 生成 `steps[]`
- 每个步骤必须能映射到 `spec_ref` 与 `acceptance_criteria`
- `tasks.md` 仅写入 V2 字段，不再生成旧任务摘要字段
