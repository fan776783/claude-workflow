---
description: 统一 workflow 命令入口，路由规划、执行、增量变更与运行时操作
allowed-tools: Read(*), Grep(*), Glob(*)
examples:
  - /workflow start "实现用户认证功能"
    启动规划流程，生成 spec.md 与 plan.md
  - /workflow execute
    恢复执行器，按 plan 推进任务
  - /workflow delta docs/prd-v2.md
    基于 PRD 更新生成增量变更
  - /workflow status
    查看当前工作流状态与下一步建议
---

# workflow

统一的 `/workflow <action> [args]` command 入口。

它只负责暴露稳定命令面，并把具体能力路由到专项 workflow skills 或 shared runtime 文档：

- `start` → `workflow-planning`
- `execute` → `workflow-executing`
- `delta` → `workflow-delta`
- `status` / `archive` → shared runtime references
- `review` **不是公开 action**，而是在执行阶段按质量关卡由 `workflow-reviewing` 内部触发

---

## Usage

```bash
/workflow start "需求描述"
/workflow start docs/prd.md
/workflow start --no-discuss docs/prd.md

/workflow execute
/workflow execute --phase
/workflow execute --retry
/workflow execute --skip

/workflow status
/workflow status --detail

/workflow delta
/workflow delta docs/prd-v2.md
/workflow delta "新增导出功能，支持 CSV"

/workflow archive
```

---

## Action 路由

### `start`

进入规划阶段，生成 `spec.md` 与 `plan.md`。

阅读：
- `../skills/workflow-planning/SKILL.md`

### `execute`

恢复执行器，读取当前状态、决定治理边界并推进任务。

阅读：
- `../skills/workflow-executing/SKILL.md`

### `delta`

处理需求变更、PRD 更新与 API 同步影响。

阅读：
- `../skills/workflow-delta/SKILL.md`

### `status`

查看运行时状态、当前任务与下一步建议。

阅读：
- `../specs/workflow-runtime/status.md`

### `archive`

归档已完成工作流与变更记录。

阅读：
- `../specs/workflow-runtime/archive.md`

---

## Command Contract

- `/workflow` 是 **command 入口**，不是专项 skill 本身
- `workflow-planning` / `workflow-executing` / `workflow-reviewing` / `workflow-delta` 是真正的 workflow skills
- `workflow-reviewing` 不直接暴露为单独的 review action，而由执行流程内部在质量关卡处引用
- 当前 shared runtime 已迁移到 `templates/specs/workflow-runtime/`、`templates/specs/workflow-templates/` 与 `templates/utils/workflow/`

---

## 推荐入口顺序

```bash
/scan
/workflow start "需求描述"
/workflow execute
```

如需查看总览导航：
- `agents.md`
