---
version: 2
requirement_source: "inline"
created_at: "2026-04-07T12:00:43.038036"
spec_file: ".claude/specs/team.team.md"
status: draft
role: plan
---

# 新增 team 模式 (Team) Implementation Plan

> **Spec**: `.claude/specs/team.team.md`

**Goal:** 新增 team 模式

**Architecture:** team runtime 负责多实例协调，workflow 能力作为内部 phase engine 复用；team mode 显式触发，不自动升级。

**Tech Stack:** unknown | unknown

---

## File Structure

### Files to Create

- .claude/specs/team.team.md
- .claude/plans/team.team.md
- .claude/plans/team.team-tasks.md

### Files to Modify

- 无

### Files to Test

- 无

---

## Tasks

> 每个任务块必须使用 `## Tn:` 标题，并包含 `阶段`、`Spec 参考`、`Plan 参考`、`actions`、`步骤` 等 WorkflowTaskV2 字段。

## T1: Team planning
- **阶段**: planning
- **Spec 参考**: §1, §2, §5
- **Plan 参考**: P1
- **需求 ID**: R1
- **关键约束**: 只允许显式 /team 触发, 不自动升级 /workflow
- **验收项**: 生成 team spec / plan / task board
- **质量关卡**: false
- **状态**: pending
- **actions**: 生成规划工件,拆分 team 边界,记录治理约束
- **步骤**:
  - A1: 生成 team 规划工件 → 输出 spec/plan（验证：工件存在）
  - A2: 生成 team task board → 输出边界任务（验证：任务可解析）

## T2: Team execution
- **阶段**: implement
- **Spec 参考**: §5, §7, §8
- **Plan 参考**: P2
- **需求 ID**: R1
- **关键约束**: team runtime 内部管理并行, 不直接调用 dispatching-parallel-agents 作为 team 编排器
- **验收项**: 团队执行与汇总状态可推进
- **质量关卡**: false
- **状态**: pending
- **actions**: 推进 team-exec,更新 team-state,汇总结果
- **步骤**:
  - A1: 推进边界任务执行 → 输出 team-exec 状态（验证：team-state 更新）
  - A2: 汇总执行结果 → 输出 verify 输入（验证：结果可读）

## T3: Team verify and fix
- **阶段**: review
- **Spec 参考**: §7, §8
- **Plan 参考**: P3
- **需求 ID**: R1
- **关键约束**: verify/fix loop 只回流失败边界
- **验收项**: team-verify / team-fix 状态可推进到 completed 或 failed
- **质量关卡**: true
- **状态**: pending
- **actions**: quality_review,更新汇总状态
- **步骤**:
  - A1: 汇总 quality gates 与验证证据 → 输出 team-verify 结论（验证：quality_gates 可读取）
  - A2: 若失败则进入 team-fix → 输出失败边界列表（验证：fix_loop 更新）

---

## Self-Review Checklist

> Plan 生成后必须逐条检查。
> 下列 checkbox 仅用于自审展示，不是任务解析格式；plan parser 仍以 `## Tn:` 的 WorkflowTaskV2 任务块为准。

- [ ] **Spec coverage** — 逐条 spec 需求，确认每条都有对应 task
- [ ] **Placeholder scan** — 搜索 TBD/TODO/模糊描述，全部替换为实际内容
- [ ] **Type consistency** — 跨 task 的类型名、函数名、属性名是否一致
- [ ] **Command accuracy** — 验证命令语法和文件路径是否正确（语义正确性在执行阶段验证）
- [ ] **Gaps** — 如发现 spec 需求无 task 对应，立即补充 task

---

## Verification Summary

| Task | Spec Ref | Files | Verification Command | Expected |
|------|----------|-------|---------------------|----------|
