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

## Tasks

> S2 去骨架后：机器 task 源 = task-dir（`~/.claude/workflows/{pid}/tasks/{Tn}/task.json`），spec 审批落壳、`/workflow-plan` 现写定粒度。本节为人类可读叙述，**不再**承载结构化 task block。
>
> task-dir 的 `task.json` 字段（对齐 WorkflowTaskV2，由 workflow-plan 现写时细化）：`阶段`、`Package`、`Spec 参考`、`Plan 参考`、`需求 ID`、`actions`、`步骤`、可选 `Target Layer`（`frontend`/`backend`/`guides`，命中则 `pre-execute-inject` 优先注入对应 code-specs 子集）、可选 `Interaction`（`AFK` 默认 / `HITL` 需人工决策点，命中时 `workflow-execute` Step 4 必须 `AskUserQuestion`）。

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
