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

{{tasks}}

---

## Self-Review Checklist

> Plan 生成后必须逐条检查。
> 下列 checkbox 仅用于自审展示，不是任务解析格式；plan parser 仍以 `## Tn:` 的 WorkflowTaskV2 任务块为准。

- [ ] **Requirement coverage** — 逐条 spec 需求，确认每条都有对应 task
- [ ] **PRD 覆盖率** — 检查 prd-spec-coverage.json 中 partial/uncovered 段落是否有对应 task
- [ ] **Placeholder scan** — 搜索 TBD/TODO/模糊描述，全部替换为实际内容
- [ ] **Type consistency** — 跨 task 的类型名、函数名、属性名是否一致
- [ ] **Command accuracy** — 验证命令语法和文件路径是否正确（语义正确性在执行阶段验证）
- [ ] **Gaps** — 如发现 spec 需求无 task 对应，立即补充 task

---

## Verification Summary

| Task | Requirement IDs | Spec Ref | Files | Verification Command | Expected |
|------|-----------------|----------|-------|---------------------|----------|
