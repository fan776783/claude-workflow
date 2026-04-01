---
version: 2
# DEPRECATED: 本遗留模板仅保留为迁移占位说明。
replacement: "templates/skills/workflow-planning/references/start-overview.md"
---

# 遗留验收清单模板（已废弃）

当前 workflow 已不再生成独立“验收清单”模板，也不再维护旧的 Brief / requirement baseline 模板路径。

请改为：
- `templates/skills/workflow-planning/references/start-overview.md`
- `templates/commands/workflow.md`

## 路径迁移

| 旧路径 | 当前入口 |
|--------|---------|
| `.claude/acceptance/{name}-checklist.md` | `.claude/specs/{name}.md` + `.claude/plans/{name}.md` |
| `acceptance-checklist-template.md` | `templates/skills/workflow-planning/references/start-overview.md` |

## 说明

旧版本将“验收清单”和“实现指南”拆分维护；当前版本统一收敛为 workflow 的 `spec.md` / `plan.md` 规划链路。

如需查看当前规划入口，请直接打开 `templates/commands/workflow.md`。
