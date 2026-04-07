---
version: 2
requirement_source: "inline"
created_at: "2026-04-07T12:00:43.038036"
status: draft
role: spec
---

# Spec: 新增 team 模式 (Team)

> 统一规范文档：需求范围 + 设计决策 + 验收标准

## 1. Context

- 原始需求来源: inline
- Team mode: explicit invocation only
- 需求摘要: 新增 team 模式

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

- R1: 新增 team 模式

### 2.2 Out of Scope

- 不自动从 /workflow、/quick-plan、关键词触发 team mode

### 2.3 Blocked

- 无

---

## 3. Constraints

> 不可协商的硬约束，来自原始需求或技术限制。

- Team mode 必须显式通过 /team 进入
- 不得因 parallel-boundaries 自动升级为 team mode
- 保持现有 /workflow 语义不变

---

## 4. User-facing Behavior

### 4.1 Primary Flow

- 以 team 模式协作完成：新增 team 模式

### 4.2 Error and Edge Flows

- 异常输入：
- 空状态 / 无权限 / 外部依赖失败：
- 降级与提示：

### 4.3 Observable Outcomes

- 页面 / 接口 / 日志 / 状态变化：
- 用户可感知反馈：

---

## 5. Architecture and Module Design

- 以独立 team runtime 协调 planning / execution / verify / fix
- 并行能力由 team runtime 内部管理，不直接调用 dispatching-parallel-agents 作为外层编排器

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

- .claude/specs/team.team.md
- .claude/plans/team.team.md
- .claude/plans/team.team-tasks.md

---

## 7. Acceptance Criteria

- [ ] 新增 team 模式
- [ ] Team mode 保持显式触发
- [ ] 现有 /workflow 不被自动升级

### 7.1 Test Strategy

- 单元测试：
- 集成测试：
- E2E 测试：

---

## 8. Implementation Slices

- Slice 1：生成 team 规划工件
- Slice 2：拆分 team work packages
- Slice 3：进入 execute / verify / fix 生命周期

---

## 9. Open Questions

- 问题 1：
- 问题 2：
