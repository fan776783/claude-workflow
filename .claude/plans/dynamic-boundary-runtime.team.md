---
version: 1
requirement_source: "inline"
created_at: "2026-04-07T11:01:56.848Z"
spec_file: ".claude/specs/dynamic-boundary-runtime.team.md"
status: draft
role: team-plan
---

# dynamic boundary board requirement (Team) Team Plan

> **Spec**: `.claude/specs/dynamic-boundary-runtime.team.md`

**Goal:** dynamic boundary board requirement

**Architecture:** team runtime 负责多实例协调，workflow 能力作为内部 phase engine 复用；team mode 显式触发，不自动升级。

**Tech Stack:** unknown | unknown

---

## File Structure

### Files to Create

- .claude/specs/dynamic-boundary-runtime.team.md
- .claude/plans/dynamic-boundary-runtime.team.md
- .claude/plans/dynamic-boundary-runtime.team-tasks.md

### Files to Modify

- 无

### Files to Test

- 无

---

## Team Tasks

## B1: Generate planning artifacts
- **阶段**: planning
- **关键约束**: 只允许显式 /team 触发, 不自动升级 /workflow
- **验收项**: 生成 spec / plan / team task board / runtime state
- **状态**: pending
- **步骤**:
  - A1: 生成 team 规划工件 → 输出 spec/plan（验证：工件存在）
  - A2: 初始化 runtime 工件 → 输出 team-state / team-task-board（验证：runtime 可读）

## B2: Validate runtime artifacts
- **阶段**: planning
- **关键约束**: spec/plan/team-state/task-board 缺一不可
- **验收项**: start gate 可通过
- **状态**: pending
- **步骤**:
  - A1: 校验 planning 工件 → 输出缺失项列表（验证：工件完整）
  - A2: 校验 ownership / dispatch metadata → 输出 metadata（验证：state 可执行）

## B3: Dispatch executable boundaries
- **阶段**: implement
- **关键约束**: execute 阶段必须有可写 worker, team runtime 内部管理并行
- **验收项**: 边界任务可进入执行
- **状态**: pending
- **步骤**:
  - A1: 选择可执行边界 → 输出 current_tasks（验证：team-state 更新）
  - A2: 生成 dispatch 决策 → 输出 next_action（验证：边界可推进）

## B4: Run team verification
- **阶段**: review
- **关键约束**: 不得跳过 verify 直接 completed
- **验收项**: team_review 写回且 verify 结论明确
- **状态**: pending
- **步骤**:
  - A1: 汇总验证结果 → 输出 team_review（验证：reviewed_at / overall_passed 可读）
  - A2: 判定 completed 或 team-fix → 输出 verify 决策（验证：phase 可推进）

## B5: Repair failed boundaries
- **阶段**: fix
- **关键约束**: verify/fix loop 只回流失败边界
- **验收项**: 仅失败边界进入修复循环
- **状态**: pending
- **步骤**:
  - A1: 收集失败边界 → 输出 current_failed_boundaries（验证：fix_loop 更新）
  - A2: 回流失败边界 → 输出 fix 输入（验证：不重跑全部边界）

---

## Governance Checklist

- [ ] `/team` remains explicit-only
- [ ] team runtime does not auto-upgrade from `/workflow`
- [ ] dispatch rules stay internal to team runtime

---

## Verification Summary

| Task | Phase | Files | Expected |
|------|-------|-------|----------|
