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

<!-- WF:ANCHOR:file_structure:begin -->
## File Structure

### Files to Create

{{files_create}}

### Files to Modify

{{files_modify}}

### Files to Test

{{files_test}}

### Injected Context

{{injected_context_summary}}
<!-- WF:ANCHOR:file_structure:end -->

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

<!-- WF:ANCHOR:tasks:begin -->
{{tasks}}
<!-- WF:ANCHOR:tasks:end -->

---

## Self-Review

> 由 `workflow_cli.js plan-review` 自动执行（lintPlaceholder / coverage / anchor_integrity / scoreConfidence 等）。
> 详见 [`../../skills/workflow-plan/references/plan-self-review.md`](../../skills/workflow-plan/references/plan-self-review.md)。
> HITL 标注与 Depth 段触发等语义判定仍由 plan 作者人工保证。

---

<!-- WF:ANCHOR:verification_summary:begin -->
## Verification Summary

| Task | Requirement IDs | Spec Ref | Files | Verification Command | Expected |
|------|-----------------|----------|-------|---------------------|----------|
<!-- WF:ANCHOR:verification_summary:end -->
