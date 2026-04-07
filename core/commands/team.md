---
description: 独立 team 命令入口，显式启动团队化规划、执行、状态查看与归档
argument-hint: <start|execute|status|archive> [args]
allowed-tools: Read(*), Grep(*), Glob(*)
examples:
  - /team start "实现用户认证功能"
    显式进入 team 模式，生成 spec.md、plan.md 与 team-state
  - /team execute
    推进 team-exec → team-verify / team-fix 循环
  - /team status
    查看当前 team phase、边界任务与下一步建议
---

# team

独立的 `/team <action> [args]` command 入口。

它用于**显式**进入 team runtime，并尽量复用现有 workflow 的 planning / execution / review / runtime helpers。

`/team` 不会由自然语言关键词、Broad Request Detection、`/workflow execute`、`/quick-plan` 或 `dispatching-parallel-agents` 自动触发；只有用户明确输入 `/team ...` 时才启用。

---

## Usage

```bash
/team start "需求描述"
/team start docs/prd.md

/team execute
/team status
/team archive
```

---

## Action 路由

### `start`

进入 team-plan，复用 workflow planning 能力，并额外生成 team runtime 工件。

阅读：
- `../skills/team/SKILL.md`
- `../specs/team-runtime/overview.md`
- `../specs/team-runtime/state-machine.md`

### `execute`

进入 team-exec，按团队边界推进执行、验证与修复循环。

阅读：
- `../skills/team/SKILL.md`
- `../specs/team-runtime/execute-entry.md`

### `status`

查看当前 team phase、边界任务状态与下一步建议。

阅读：
- `../specs/team-runtime/status.md`

### `archive`

归档当前 team runtime 与相关编排工件。

阅读：
- `../specs/team-runtime/archive.md`

---

## Command Contract

- `/team` 是 **独立 command 入口**，不是 `/workflow execute` 的自动分支
- `team` skill 负责 `/team start` 与 `/team execute` 的团队编排语义
- team runtime 推荐使用独立 Node.js 脚本：`core/utils/team/*.js`
- `status` / `archive` 继续由 team runtime 文档定义共享约束
- `dispatching-parallel-agents` 只能作为 `team-exec` 内部的**规则来源**（独立性检查 / 边界分组 / 冲突降级），不能替代 team runtime
- `/workflow`、`/quick-plan`、Broad Request Detection 与自然语言请求都**不会**自动切换到 `/team`
