---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
status: draft
role: requirement-baseline
---

# Requirement Baseline: {{task_name}}

> 本文档是当前需求的追溯真相源，用于为 `brief`、`tech-design`、`spec`、`plan` 和 `tasks` 提供统一 requirement IDs 与范围判定。

## 1. 摘要

{{requirement_summary}}

## 2. 范围统计

{{scope_summary}}

### 2.1 Scope Summary

| Scope Status | Count | Notes |
|--------------|-------|-------|
| in_scope | - | 当前 workflow 需要完整承接 |
| partially_in_scope | - | 仅承接展示 / 调用 / 验收 / 适配 |
| out_of_scope | - | 当前 workflow 显式排除 |
| blocked | - | 需等待外部依赖 |

## 3. 关键约束总表

{{critical_constraints}}

## 4. Requirement Items

{{requirement_items}}

### 示例格式

#### R-001

- **原始需求**: 保留 PRD 原文关键句
- **摘要**: 面向下游文档的短描述
- **场景**: 用户管理
- **职责归属**: frontend
- **范围状态**: in_scope
- **约束**:
  - 约束 1
  - 约束 2
- **关联条目**: R-002, R-003
- **依赖标签**:
  - api_spec
- **易丢失风险**: 容易在后续摘要中被吞并成抽象标题
- **说明**:
  - 如为 `partial / out_of_scope / blocked`，需写清原因

## 5. Out-of-Scope Items

> 这些条目并非遗漏，而是显式排除。必须保留原因，禁止在后续文档中无声消失。

| Requirement ID | Summary | Owner | Exclusion Reason |
|----------------|---------|-------|------------------|
| R-999 | 示例 | backend | 后端导入链路，本次前端 workflow 不承接 |

## 6. Blocked / Partial Items

| Requirement ID | Scope Status | Dependency | Notes |
|----------------|--------------|------------|-------|
| R-998 | blocked | api_spec | 需等待后端接口规格冻结 |

## 7. 下游消费规则

- `brief` 必须引用 requirement IDs，输出 requirement-to-brief mapping，并在模块级别标记 `Related Requirement IDs` 和 `Constraints`。
- `tech-design` / `spec` 必须生成 Requirement Traceability 章节。
- `plan` / `tasks` 必须将 `requirement_ids` 带入步骤与运行时任务模型。

## 8. Baseline Warnings

{{uncovered_notes}}
