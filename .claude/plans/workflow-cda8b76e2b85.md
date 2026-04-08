---
version: 2
requirement_source: "inline"
created_at: "2026-04-08T10:29:58.608Z"
spec_file: ".claude/specs/workflow-cda8b76e2b85.md"
status: draft
role: plan
role_profile: "plan-planner"
context_profile: "{"signals":{"ui":false,"workspace":false,"security":true,"data":false,"backend_heavy":false,"clarification_count":0},"phase":"plan_generation"}"
---

# 实现用户登录功能 - 用户可使用用户名密码登录 - 登录失败时显示明确错误提示 - 支持记... Implementation Plan

> **Spec**: `.claude/specs/workflow-cda8b76e2b85.md`

**Goal:** 实现用户登录功能 - 用户可使用用户名密码登录 - 登录失败时显示明确错误提示 - 支持记住登录状态 - 不影响现有注册流程 - 无权限和空状态需要有边界处理

**Architecture:** 基于现有实现做最小必要改动，并复用已有模块与状态流转能力。

**Tech Stack:** unknown | unknown

**Role Profile:** plan-planner

---

## File Structure

### Files to Create

- .claude/specs/workflow-cda8b76e2b85.md
- .claude/plans/workflow-cda8b76e2b85.md

### Files to Modify

- 无

### Files to Test

- 无

### Injected Context

- role: planner
- profile: plan-planner
- signals: security

---

## Requirement Coverage

| Requirement ID | Summary | Spec Section | Covered By Tasks | Coverage Status |
|----------------|---------|--------------|------------------|-----------------|
| R-001 | - 用户可使用用户名密码登录 | §2 | T1 | covered |
| R-002 | - 登录失败时显示明确错误提示 | §2 | T2 | covered |
| R-003 | - 支持记住登录状态 | §5 | T3 | covered |
| R-004 | - 不影响现有注册流程 | §2 | T4 | covered |
| R-005 | - 无权限和空状态需要有边界处理 | §2 | T5 | protected |

---

## Tasks

> 每个任务块必须使用 `## Tn:` 标题，并包含 `阶段`、`Spec 参考`、`Plan 参考`、`需求 ID`、`actions`、`步骤` 等 WorkflowTaskV2 字段。

## T1: 实现 R-001 - 用户可使用用户名密码登录
- **阶段**: implement
- **Spec 参考**: §2, §7
- **Plan 参考**: P1
- **需求 ID**: R-001
- **创建文件**: src/shared/r-001.ts
- **修改文件**: .claude/specs/r-001.md
- **测试文件**: tests/shared/r-001.test.ts
- **关键约束**: 保持现有功能不受影响
- **验收项**: 确认 - 用户可使用用户名密码登录 可工作
- **依赖**: 无
- **质量关卡**: false
- **状态**: pending
- **actions**: 审阅现有实现, 实现需求变更, 补齐验证
- **步骤**:
  - A1: 审阅 R-001 对应的现有实现与 §2 → 确认最小改动范围（验证：需求边界清晰）
  - A2: 实现 - 用户可使用用户名密码登录 → 让行为满足 Spec 与 Requirement Coverage（验证：确认 - 用户可使用用户名密码登录 可工作）
  - A3: 运行验证并核对 R-001 → 确认 requirement_ids / 关键约束 / 验收项一致（验证：相关检查全部通过）
- **验证命令**: npm test -- r-001.test.ts
- **验证期望**: PASS, R-001 covered

## T2: 实现 R-002 - 登录失败时显示明确错误提示
- **阶段**: implement
- **Spec 参考**: §2, §7
- **Plan 参考**: P2
- **需求 ID**: R-002
- **创建文件**: src/shared/r-002.ts
- **修改文件**: .claude/specs/r-002.md
- **测试文件**: tests/shared/r-002.test.ts
- **关键约束**: 保持现有功能不受影响
- **验收项**: 确认 - 登录失败时显示明确错误提示 可工作
- **依赖**: T1
- **质量关卡**: false
- **状态**: pending
- **actions**: 审阅现有实现, 实现需求变更, 补齐验证
- **步骤**:
  - A1: 审阅 R-002 对应的现有实现与 §2 → 确认最小改动范围（验证：需求边界清晰）
  - A2: 实现 - 登录失败时显示明确错误提示 → 让行为满足 Spec 与 Requirement Coverage（验证：确认 - 登录失败时显示明确错误提示 可工作）
  - A3: 运行验证并核对 R-002 → 确认 requirement_ids / 关键约束 / 验收项一致（验证：相关检查全部通过）
- **验证命令**: npm test -- r-002.test.ts
- **验证期望**: PASS, R-002 covered

## T3: 实现 R-003 - 支持记住登录状态
- **阶段**: implement
- **Spec 参考**: §5, §7
- **Plan 参考**: P3
- **需求 ID**: R-003
- **创建文件**: src/shared/r-003.ts
- **修改文件**: .claude/specs/r-003.md
- **测试文件**: tests/shared/r-003.test.ts
- **关键约束**: 保持现有功能不受影响
- **验收项**: 确认 - 支持记住登录状态 可工作
- **依赖**: T2
- **质量关卡**: false
- **状态**: pending
- **actions**: 审阅现有实现, 实现需求变更, 补齐验证
- **步骤**:
  - A1: 审阅 R-003 对应的现有实现与 §5 → 确认最小改动范围（验证：需求边界清晰）
  - A2: 实现 - 支持记住登录状态 → 让行为满足 Spec 与 Requirement Coverage（验证：确认 - 支持记住登录状态 可工作）
  - A3: 运行验证并核对 R-003 → 确认 requirement_ids / 关键约束 / 验收项一致（验证：相关检查全部通过）
- **验证命令**: npm test -- r-003.test.ts
- **验证期望**: PASS, R-003 covered

## T4: 实现 R-004 - 不影响现有注册流程
- **阶段**: implement
- **Spec 参考**: §2, §7
- **Plan 参考**: P4
- **需求 ID**: R-004
- **创建文件**: src/shared/r-004.ts
- **修改文件**: .claude/specs/r-004.md
- **测试文件**: tests/shared/r-004.test.ts
- **关键约束**: 保持现有功能不受影响
- **验收项**: 确认 - 不影响现有注册流程 可工作
- **依赖**: T3
- **质量关卡**: false
- **状态**: pending
- **actions**: 审阅现有实现, 实现需求变更, 补齐验证
- **步骤**:
  - A1: 审阅 R-004 对应的现有实现与 §2 → 确认最小改动范围（验证：需求边界清晰）
  - A2: 实现 - 不影响现有注册流程 → 让行为满足 Spec 与 Requirement Coverage（验证：确认 - 不影响现有注册流程 可工作）
  - A3: 运行验证并核对 R-004 → 确认 requirement_ids / 关键约束 / 验收项一致（验证：相关检查全部通过）
- **验证命令**: npm test -- r-004.test.ts
- **验证期望**: PASS, R-004 covered

## T5: 实现 R-005 - 无权限和空状态需要有边界处理
- **阶段**: implement
- **Spec 参考**: §2, §7
- **Plan 参考**: P5
- **需求 ID**: R-005
- **创建文件**: src/shared/r-005.ts
- **修改文件**: .claude/specs/r-005.md
- **测试文件**: tests/shared/r-005.test.ts
- **关键约束**: - 无权限和空状态需要有边界处理
- **验收项**: 验证 - 无权限和空状态需要有边界处理
- **依赖**: T4
- **质量关卡**: false
- **状态**: pending
- **actions**: 审阅现有实现, 实现需求变更, 补齐验证
- **步骤**:
  - A1: 审阅 R-005 对应的现有实现与 §2 → 确认最小改动范围（验证：需求边界清晰）
  - A2: 实现 - 无权限和空状态需要有边界处理 → 让行为满足 Spec 与 Requirement Coverage（验证：验证 - 无权限和空状态需要有边界处理）
  - A3: 运行验证并核对 R-005 → 确认 requirement_ids / 关键约束 / 验收项一致（验证：相关检查全部通过）
- **验证命令**: npm test -- r-005.test.ts
- **验证期望**: PASS, R-005 covered


---

## Self-Review Checklist

> Plan 生成后必须逐条检查。
> 下列 checkbox 仅用于自审展示，不是任务解析格式；plan parser 仍以 `## Tn:` 的 WorkflowTaskV2 任务块为准。

- [ ] **Requirement coverage** — 逐条 requirement baseline / spec 需求，确认每条都有对应 task
- [ ] **Protected nuance coverage** — 所有 must_preserve 细节都在 task 或验证步骤中有落点
- [ ] **Placeholder scan** — 搜索 TBD/TODO/模糊描述，全部替换为实际内容
- [ ] **Type consistency** — 跨 task 的类型名、函数名、属性名是否一致
- [ ] **Command accuracy** — 验证命令语法和文件路径是否正确（语义正确性在执行阶段验证）
- [ ] **Gaps** — 如发现 spec / baseline 需求无 task 对应，立即补充 task

---

## Verification Summary

| Task | Requirement IDs | Spec Ref | Files | Verification Command | Expected |
|------|-----------------|----------|-------|---------------------|----------|
