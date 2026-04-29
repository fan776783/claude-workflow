---
version: 2
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
spec_file: "{{spec_file}}"
status: draft
role: plan
role_profile: "{{role_profile}}"
context_profile: "{{context_profile}}"
---

# {{task_name}} Implementation Plan

> **Spec**: `{{spec_file}}`

**Goal:** {{goal}}

**Architecture:** {{architecture_summary}}

**Tech Stack:** {{tech_stack}}

**Role Profile:** {{role_profile}}

---

## File Structure

### Files to Create

{{files_create}}

### Files to Modify

{{files_modify}}

### Files to Test

{{files_test}}

### Injected Context

{{injected_context_summary}}

---

## Requirement Coverage

| Requirement ID | Summary | Spec Section | Covered By Tasks | Coverage Status |
|----------------|---------|--------------|------------------|-----------------|
{{requirement_coverage}}

---

## Tasks

> 每个任务块必须使用 `## Tn:` 标题，并包含 `阶段`、`Package`（plan 生成器按以下顺序推断：单包→project.name / package.json#name / 仓库目录名；monorepo→monorepo.defaultPackage / monorepo.packages[0]；若需改写，由写 plan 的人手动调整）、`Spec 参考`、`Plan 参考`、`需求 ID`、`actions`、`步骤` 等 WorkflowTaskV2 字段。
>
> 任务可选字段：
>
> - `Target Layer`（可省略）— `frontend` / `backend` / `guides` 之一。显式声明后，`pre-execute-inject` 会把 `.claude/code-specs/{Package}/{Target Layer}/` 作为优先注入子集；省略则按 package 级别回退。
>
> - `Interaction`（可省略，默认 `AFK`）— `AFK` / `HITL` 之一。
>   - `AFK`（默认）：任务可由 agent 独立完成到 quality_gate，无需人工介入
>   - `HITL`：任务需要人工决策点（如设计选择、API 密钥 / 凭证输入、手动浏览器验证、外部操作确认）；`workflow-execute` Step 4 命中 HITL 任务时**必须**调用 `AskUserQuestion` 才能继续
>   - 省略 = `AFK`（向后兼容：老 plan 行为不变）

{{tasks}}

---

## Self-Review Checklist

> Plan 生成后必须逐条检查。
> 下列 checkbox 仅用于自审展示，不是任务解析格式；plan parser 仍以 `## Tn:` 的 WorkflowTaskV2 任务块为准。

- [ ] **Requirement coverage** — 逐条 spec 需求，确认每条都有对应 task
- [ ] **PRD 覆盖率** — 即时计算 PRD 段落覆盖率，检查 partial/uncovered 段落是否有对应 task
- [ ] **Placeholder scan** — 搜索 TBD/TODO/模糊描述，全部替换为实际内容
- [ ] **Type consistency** — 跨 task 的类型名、函数名、属性名是否一致
- [ ] **Command accuracy** — 验证命令语法和文件路径是否正确（语义正确性在执行阶段验证）
- [ ] **Gaps** — 如发现 spec 需求无 task 对应，立即补充 task
- [ ] **Interaction 标注** — 每个 task 显式标注 `- **Interaction**: AFK` 或 `HITL`（默认 AFK）。HITL 场景示例：需要用户粘贴 API 密钥 / 设计选择需要人拍板 / 需要手动浏览器或外部系统验证。workflow-execute Step 4.1 会对 HITL 任务调 `AskUserQuestion`。
- [ ] **Depth 段触发判定** — 若本 plan 对应的 spec § 5.1 Module Responsibilities 的 module 数 ≥ 3，确认 spec § 5.5 已填 Depth and Seams；否则 spec § 5.5 整段删除（避免套话）。

---

## Verification Summary

| Task | Requirement IDs | Spec Ref | Files | Verification Command | Expected |
|------|-----------------|----------|-------|---------------------|----------|
