---
description: /quick-plan - 轻量快速规划，适用于简单到中等任务。复杂项目请使用 /workflow-plan
argument-hint: <需求描述 | path/to/requirement.md>
---

# /quick-plan - 轻量快速规划

路由到 `quick-plan` skill 执行轻量规划流程。

## 用法

```
/quick-plan "修复登录按钮样式"
/quick-plan "添加新的 API 字段"
/quick-plan docs/requirement.md
```

## 与 workflow 的关系

| 命令              | 适用场景                  | 产物                           |
| ----------------- | ------------------------- | ------------------------------ |
| `/quick-plan`     | 简单/中等任务，快速 plan  | 仅 `plan.md`                   |
| `/workflow-plan` | 复杂/跨模块，需 spec 追溯 | `spec.md` + `plan.md` + 状态机 |

- `/quick-plan` 只生成轻量 `plan.md`，不进入 workflow 状态机。
- 如果 `/quick-plan` 过程中发现任务复杂度升到 XL 级，应切换到 `/workflow-plan`。
- 如果用户接受 `/quick-plan` 生成的计划，并希望按 workflow 执行，建议先 `/workflow-plan` 升级为完整工作流（含 spec + 状态机）。直接 `/workflow-execute` 会因缺少 spec 而要求确认降级。