---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
spec_file: "{{spec_file}}"
status: draft
role: team-plan
---

# {{task_name}} Team Plan

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

## Team Tasks

{{tasks}}

---

## Governance Checklist

- [ ] `/team` remains explicit-only
- [ ] team runtime does not auto-upgrade from `/workflow`
- [ ] dispatch rules stay internal to team runtime

---

## Verification Summary

| Task | Phase | Files | Expected |
|------|-------|-------|----------|
