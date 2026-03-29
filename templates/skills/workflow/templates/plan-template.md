---
version: 2
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
spec_file: "{{spec_file}}"
status: draft
role: plan
---

# {{task_name}} Implementation Plan

> **Spec**: `{{spec_file}}`

**Goal:** {{goal}}

**Architecture:** {{architecture_summary}}

**Tech Stack:** {{tech_stack}}

---

## File Structure

### Files to Create

{{files_create}}

### Files to Modify

{{files_modify}}

### Files to Test

{{files_test}}

---

## Tasks

> 每个任务块必须使用 `## Tn:` 标题，并包含 `阶段`、`Spec 参考`、`Plan 参考`、`actions`、`步骤` 等 WorkflowTaskV2 字段。

{{tasks}}

---

## Self-Review Checklist

> Plan 生成后必须逐条检查。

- [ ] **Spec coverage** — 逐条 spec 需求，确认每条都有对应 task
- [ ] **Placeholder scan** — 搜索 TBD/TODO/模糊描述，全部替换为实际内容
- [ ] **Type consistency** — 跨 task 的类型名、函数名、属性名是否一致
- [ ] **Command accuracy** — 验证命令和文件路径是否正确
- [ ] **Gaps** — 如发现 spec 需求无 task 对应，立即补充 task

---

## Verification Summary

| Task | Spec Ref | Files | Verification Command | Expected |
|------|----------|-------|---------------------|----------|
