---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
requirement_baseline: "{{requirement_baseline_path}}"
spec_file: "{{spec_file}}"
brief: "{{brief_path}}"
status: draft
role: plan
---

# Plan: {{task_name}}

> 本文档是从 Spec 派生的实施计划，目标是为 Task Compilation 提供稳定、细粒度、可验证的输入。

## 1. Plan Context

- **Requirement Baseline**: `{{requirement_baseline_path}}`
- **Spec**: `{{spec_file}}`
- **Requirement Source**: `{{requirement_source}}`
- **Brief**: `{{brief_path}}`

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

### 3.2 Governance Slices

- Slice 列表：
- 哪些 slice 属于同一治理 phase：
- 哪些 slice 是治理边界：
- 哪些 slice 可视为 continuation-safe：

### 3.3 Parallelization Opportunities

- 哪些边界可并行：
- 哪些边界必须串行：
- 冲突风险：

### 3.4 Quality Constraints

- 需要满足的硬约束：
- TDD 要求：
- 必须保留的现有行为：

### 3.5 Non-Negotiable Requirement Constraints

{{non_negotiable_requirement_constraints}}

---

## 4. Atomic Steps

> Atomic Steps 用于 `steps[]` 级别的可追溯性与验证，不应直接等价于 phase 边界。Task Compilation 应优先按治理切片聚合，再把 Atomic Steps 作为子步骤挂载到运行时任务中。

{{atomic_steps}}

### Step P1

- **Goal**:
- **Spec Ref**:
- **Requirement IDs**:
- **Critical Constraints**:
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

| Plan Step | Requirement IDs | Acceptance Criteria | Verification |
|-----------|-----------------|---------------------|--------------|
| P1 | R-001 | AC-1 | `pnpm test ...` |

---

## 6. Requirement Coverage by Step

{{requirement_coverage_by_step}}

---

## 7. Quality Gates and Commit Points

### 7.1 Quality Gates

- Gate 1:
- Gate 2:

### 7.2 Commit Strategy

- 提交节点：
- Commit 粒度：
- 不应合并的改动：

---

## 8. Risks and Fallbacks

- 风险 1：
- 风险 2：
- 回退方案：

---

## 9. Task Compilation Notes

- 任务编译器应从本 Plan 生成 `steps[]`
- 每个步骤必须能映射到 `spec_ref`、`acceptance_criteria`、`requirement_ids`
- `tasks.md` 必须写入 `requirement_ids` 与 `critical_constraints`
