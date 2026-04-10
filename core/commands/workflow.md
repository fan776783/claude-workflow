---
description: 统一 workflow 命令入口，路由规划、执行、增量变更与运行时操作
allowed-tools: Read(*), Grep(*), Glob(*)
examples:
  - /workflow plan "实现用户认证功能"
    启动规划流程，生成 spec.md 并进入用户审查
  - /workflow spec-review --choice "Spec 正确，生成 Plan"
    在用户审查通过后生成 plan.md 并进入 planned
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

- `plan` → `workflow-planning`（`start` 为向后兼容别名）
- `execute` → `workflow-executing`
- `delta` → `workflow-delta`
- `status` / `archive` → shared runtime references
- `review` **不是公开 action**，而是在执行阶段按质量关卡由 `workflow-reviewing` 内部触发

---

## Usage

```bash
/workflow plan "需求描述"
/workflow plan docs/prd.md
/workflow plan --no-discuss docs/prd.md
/workflow spec-review --choice "Spec 正确，生成 Plan"

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

### `plan`

进入规划阶段，生成 `spec.md` 并进入用户审查。

默认先生成 `spec.md` 并停在 `spec_review`；用户审查通过后，再通过 `/workflow spec-review --choice ...` 生成 `plan.md`。

> `start` 是 `plan` 的向后兼容别名，功能完全相同。

阅读：
- `../skills/workflow-planning/SKILL.md`

### `spec-review`

记录用户对 `spec.md` 的审查结论；通过时生成 `plan.md` 并进入 `planned`。

阅读：
- `../skills/workflow-planning/SKILL.md`（Step 6: User Spec Review）

### `execute`

恢复执行器，先读取 workflow runtime 状态，再决定治理边界并推进任务。

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
- 当前 shared runtime 已迁移到 `core/specs/workflow-runtime/`、`core/specs/workflow-templates/` 与 `core/utils/workflow/`
- 普通 `/workflow` session 只允许读取 workflow runtime；不得继承 team runtime 的 `team_id`、`team_name`、`worker_roster`、`dispatch_batches`、`team_review` 或 `team-state.json` 上下文
- `/team` 是独立 command 入口；即使 workflow 检测到 2+ 独立任务或 `parallel-boundaries` 机会，也不会自动升级为 team mode
- `/workflow plan` 默认结束于 `spec_review`，不会直接开始执行
- `/workflow spec-review --choice "Spec 正确，生成 Plan"` 会把已批准的 `spec.md` 继续推进到 `planned`
- 规划完成后不会自动进入 execute；如需开始执行必须显式使用 `/workflow execute`

---

## 推荐入口顺序

```bash
/scan
/workflow plan "需求描述"
/workflow spec-review --choice "Spec 正确，生成 Plan"
/workflow execute
```
