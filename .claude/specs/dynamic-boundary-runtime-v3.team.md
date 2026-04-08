---
version: 1
requirement_source: "inline"
created_at: "2026-04-07T11:03:09.744Z"
status: draft
role: team-spec
---

# Team Spec: dynamic boundary board requirement v3 (Team)

## 1. Context

- 原始需求来源: inline
- Team mode: explicit invocation only
- 需求摘要: dynamic boundary board requirement v3

## 2. Scope

### 2.1 In Scope

- R1: dynamic boundary board requirement v3

### 2.2 Out of Scope

- 不自动从 /workflow、/quick-plan、关键词触发 team mode

### 2.3 Blocked

- 无

## 3. Team Constraints

- Team mode 必须显式通过 /team 进入
- 不得因 parallel-boundaries 自动升级为 team mode
- 保持现有 /workflow 语义不变

## 4. Team-facing Behavior

- 以 team 模式协作完成：dynamic boundary board requirement v3

## 5. Team Architecture

- 以独立 team runtime 协调 planning / execution / verify / fix
- 并行能力由 team runtime 内部管理，不直接调用 dispatching-parallel-agents 作为外层编排器

## 6. File Structure

- .claude/specs/dynamic-boundary-runtime-v3.team.md
- .claude/plans/dynamic-boundary-runtime-v3.team.md
- .claude/plans/dynamic-boundary-runtime-v3.team-tasks.md

## 7. Acceptance Criteria

- [ ] dynamic boundary board requirement v3
- [ ] Team mode 保持显式触发
- [ ] 现有 /workflow 不被自动升级

## 8. Team Implementation Slices

- Slice 1：生成 team 规划工件
- Slice 2：拆分 team work packages
- Slice 3：进入 execute / verify / fix 生命周期
