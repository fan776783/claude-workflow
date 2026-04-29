---
version: 3
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
status: draft
role: spec
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

### 3.x Project Code Specs Constraints

> 从 `.claude/code-specs/` 提取的与本任务相关的项目级约束（如有）。
> 若 code-specs 目录不存在或无相关内容，删除本小节。

{{code_specs_constraints}}

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

### 4.4 UX Design（前端任务适用）

<!-- 后端/CLI 项目删除本节 -->

#### User Flow（Mermaid）

```mermaid
flowchart TD
  A[Start] --> B[Complete]
```

**场景覆盖**（≥ 3 个）：

| 场景 | 描述 | 覆盖节点 |
|------|------|---------|
| 首次使用 | 新用户引导路径 | |
| 核心操作 | 入口到完成核心功能 | |
| 异常/边界 | 操作失败、数据为空、权限不足 | |

#### Page Hierarchy

| 层级 | 页面名 | 功能module | 导航方式 |
|------|--------|---------|---------|
| L0 | | | |
| L1 | | | |

> L0 module不超过 4 个。

---

## 5. Architecture and Module Design

{{architecture_summary}}

### 5.1 Module Responsibilities

- module A：
- module B：
- module C：

### 5.2 Data Models

- 核心数据对象：
- 输入输出contract：

### 5.3 Technology Choices

- 框架 / 库 / 存储选型及理由：

### 5.4 Risks and Trade-offs

- 风险：
- 权衡：
- 不采用方案：

### 5.5 Depth and Seams（条件段）

> **触发规则**：仅当 § 5.1 Module Responsibilities 列出 **≥ 3 个 module**时填写；否则**整段删除**（含 `### 5.5` 标题）。
>
> **本段存在 = 承诺认真填**——不要留 `<高/中/低>` 这种套话，否则对 review 无价值。
>
> 参考 mattpocock/skills 的 `improve-codebase-architecture/LANGUAGE.md` / `DEEPENING.md`；workflow-review Stage 1 的 Depth Heuristics（H1/H2）会优先信任本段声明。

#### 5.5.1 Module Depth Justification

每个 module 按 `core/skills/workflow-review/references/depth-heuristics.md` H1 的 deletion test 判断，每 module 1 行：

| Module | 接口方法数 | Deletion test 结论 |
|--------|-----------|--------------------|
| <名> | <数字> | 删了 → 复杂度 `分散到 N 个 caller` / `蒸发` / `搬到另一处` |

`蒸发`是危险信号——说明该 module 是 pass-through，复杂度其实应该留在 caller 处；写了`蒸发`就要回答为什么还要保留它。

#### 5.5.2 Seam Strategy（仅当本 spec 引入新抽象接口 / port 时填；否则删除本小节）

| Seam（接口名） | Adapter 数量 | 理由 |
|---------------|--------------|------|
| <名> | 2（prod + test fake） | 真实 seam |
| <名> | 1 | 暂为 indirection——spec 承诺的第二个 adapter 见 § X |

只有 1 个 adapter 且无计划加第二个 → 该行删除、并在 § 5.1 把抽象接口改为直接内联实现（避免 single-adapter abstraction）。

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

## 9. Open Questions & Dependencies

### 9.1 需求澄清记录

<!-- 讨论阶段的澄清结果。每项格式：维度 / 问题 / 答案 / 影响级别 -->

| 维度 | 问题 | 答案 | 影响 |
|------|------|------|------|
| | | | |

### 9.2 方案选择

<!-- 仅当存在互斥实现路径时填写 -->

**选定方案**：

**被排除方案**：

| 方案 | 排除原因 |
|------|---------|
| | |

### 9.3 未解决依赖

<!-- 外部依赖未就绪时填写。对应需求在 § 2 Scope 中标记为 blocked -->

| 依赖 | 类型 | 状态 | 影响 |
|------|------|------|------|
| | | | |

### 9.4 Open Questions

- 问题 1：
- 问题 2：
