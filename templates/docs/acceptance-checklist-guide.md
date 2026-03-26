# Acceptance & Implementation Brief 使用指南

> **DEPRECATED**: 本文档保留为迁移说明。当前 workflow 已不再生成独立“验收清单”，请统一使用 `templates/skills/workflow/references/brief.md` 与 `templates/skills/workflow/templates/brief-template.md`。

## 当前结论

当前 `workflow` 的 Phase 0.6 会生成一份统一的 `Brief`，把旧版本中的“验收清单”和“实现指南”合并为同一份开发参考文档。

## 路径迁移

| 旧路径 | 新路径 |
|--------|--------|
| `.claude/acceptance/{name}-checklist.md` | `.claude/acceptance/{name}-brief.md` |
| `templates/docs/acceptance-checklist-template.md` | `templates/skills/workflow/templates/brief-template.md` |
| `templates/skills/workflow/references/acceptance-checklist.md` | `templates/skills/workflow/references/brief.md` |

## 现在应该怎么用

### 1. 生成 Brief

```bash
/workflow start docs/prd.md
```

### 2. 查看 Brief

```bash
ls .claude/acceptance/
code .claude/acceptance/<task-name>-brief.md
```

### 3. 查看任务关联的验收项

```bash
grep "T3:" ~/.claude/workflows/*/tasks-*.md -A 10 | grep "验收项"
grep "AC-M1.1" .claude/acceptance/*-brief.md -A 15
```

## Brief 中包含什么

- Requirement Coverage Summary
- Requirement-to-Brief Mapping
- 模块级 Acceptance Criteria
- Test Strategy
- Implementation Hints
- Coverage Gaps
- Acceptance Pass Criteria

## 相关文档

- `templates/skills/workflow/references/brief.md`
- `templates/skills/workflow/references/start-overview.md`
- `templates/skills/workflow/templates/brief-template.md`
- `templates/skills/workflow/templates/requirement-baseline-template.md`
