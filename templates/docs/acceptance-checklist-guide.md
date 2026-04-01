# Acceptance & Implementation Brief 使用指南

> **DEPRECATED**: 本文档保留为迁移说明。当前 workflow 已不再生成独立“验收清单”，也不再维护旧的 Brief 模板路径；请统一使用 `/workflow start` 进入 `spec.md` / `plan.md` 规划链路。

## 当前结论

当前 `workflow` 已将旧版“验收清单 / 实现指南”分散文档收敛为统一的规划链路：

- `spec.md`：范围、约束、设计、验收标准
- `plan.md`：可执行步骤、文件清单、验证命令

## 路径迁移

| 旧路径 | 当前入口 |
|--------|---------|
| `.claude/acceptance/{name}-checklist.md` | `.claude/specs/{name}.md` + `.claude/plans/{name}.md` |
| `templates/docs/acceptance-checklist-template.md` | `templates/commands/workflow.md` |
| `templates/skills/workflow/references/acceptance-checklist.md` | `templates/skills/workflow-planning/references/start-overview.md` |
| `templates/skills/workflow/references/start-overview.md` | `templates/skills/workflow-planning/references/start-overview.md` |

## 现在应该怎么用

### 1. 启动规划

```bash
/workflow start docs/prd.md
```

### 2. 查看规划产物

```bash
ls .claude/specs/
ls .claude/plans/
code .claude/specs/<task-name>.md
code .claude/plans/<task-name>.md
```

### 3. 查看流程说明

- `templates/commands/workflow.md`
- `templates/skills/workflow-planning/references/start-overview.md`

## 相关文档

- `templates/commands/workflow.md`
- `templates/skills/workflow-planning/SKILL.md`
- `templates/skills/workflow-planning/references/start-overview.md`
