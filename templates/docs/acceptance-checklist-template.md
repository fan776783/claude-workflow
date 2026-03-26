---
version: 2
# DEPRECATED: 本遗留模板仅保留为迁移占位说明。
# 当前 workflow 请使用 templates/skills/workflow/templates/brief-template.md
replacement: "templates/skills/workflow/templates/brief-template.md"
---

# 遗留验收清单模板（已废弃）

当前 workflow 已不再生成独立“验收清单”模板。

请改用：
- `templates/skills/workflow/templates/brief-template.md`
- `templates/skills/workflow/references/brief.md`

## 路径迁移

| 旧路径 | 新路径 |
|--------|--------|
| `.claude/acceptance/{name}-checklist.md` | `.claude/acceptance/{name}-brief.md` |
| `acceptance-checklist-template.md` | `brief-template.md` |

## 说明

旧版本将“验收清单”和“实现指南”拆分维护；当前版本统一收敛为 `Acceptance & Implementation Brief`，用于承载：

- 验收标准
- 测试策略
- 实现提示
- requirement 映射
- coverage gaps

如需查看当前模板结构，请直接打开 `templates/skills/workflow/templates/brief-template.md`。
