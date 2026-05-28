# 下一步建议映射

按 `workflow_status` + `halt_reason` 选建议；优先回显 CLI `next` 命令返回的内容。

| 当前状态 | 建议 |
|---------|------|
| `spec_review` | review `spec.md` 后确认 Spec 审批 |
| `planned` | `/workflow-plan` 扩写详细计划,完成后 `/workflow-execute` |
| `running` | 继续 `/workflow-execute` |
| `halted` (dependency) | `workflow_cli.js unblock <dep>` 解除依赖 |
| `halted` (failure) | `/workflow-execute --retry` 或 `--skip` |
| `halted` (其他) | 处理暂停原因后 `/workflow-execute` 恢复 |
| `completed` | 🎉 可 `/workflow-archive` |
| `archived` | 新需求请 `/workflow-spec` |

> CLI `status` 返回 `workflow_status: 'halted'` 但不含 `halt_reason`。区分 halted 子类型需直接读 `workflow-state.json` 的 `halt_reason` 字段。
