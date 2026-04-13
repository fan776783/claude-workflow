---
name: workflow-archive
description: "/workflow-archive 入口。归档已完成的工作流。"
---

# workflow-archive

> 本 skill 是 `/workflow-archive` 的完整行动指南。

<HARD-GATE>
不可违反的规则：
1. **完成前置**：`archive` 仅允许对 `completed` 状态的工作流执行，不得跳过状态校验
</HARD-GATE>

---

## Checklist（按序执行）

1. ☐ 调用 CLI 执行归档
2. ☐ 展示归档结果
3. ☐ 给出下一步建议

```
CLI archive → 展示结果 → 下一步建议
     │            │
 状态校验+     归档变更数
 文件搬迁     摘要文件路径
```

### Step 1: 调用 CLI 执行归档

```bash
# 基本归档
node core/utils/workflow/workflow_cli.js archive

# 带摘要报告的归档
node core/utils/workflow/workflow_cli.js archive --summary
```

CLI 自动完成：
- 校验工作流状态为 `completed`（否则返回错误）
- 将 `changes/CHG-*` 目录移动到 `archive/`
- 生成归档摘要（`--summary` 时）
- 更新 `workflow-state.json` 状态为 `archived`
- 清空 `delta_tracking.current_change`

**错误处理**：

| 错误 | 含义 | 建议 |
|------|------|------|
| `没有可归档的工作流` | 无项目配置或无状态文件 | 提示先执行 `/scan` 和 `/workflow-plan` |
| `只有 completed 状态的工作流可以归档` | 当前状态不是 `completed` | 显示当前 `state_status`，提示先完成工作流 |

### Step 2: 展示归档结果

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 工作流归档

✅ 归档完成！

- **项目 ID**：{project_id}
- **状态**：archived
- **归档变更数**：{archived_changes.length}
- **归档目录**：{archive_dir}
{如有摘要：- **摘要文件**：{summary_file}}

文件结构：
~/.claude/workflows/{projectId}/
├── workflow-state.json        ← 状态已更新为 archived
├── archive/                   ← 归档目录
│   ├── CHG-*/                 ← delta 变更记录（如有）
│   └── archive-summary-*.md   ← 归档摘要（如有）
└── changes/                   ← 已清空
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 3: 下一步建议

```
🎉 工作流已归档，可以开始新的任务了！

/workflow-plan "新功能描述"
```

> ⚠️ `/workflow-archive` 只归档 workflow runtime；team 相关归档应使用 `/team archive`。

---

## CLI 命令速查

```bash
# 归档
node core/utils/workflow/workflow_cli.js archive
node core/utils/workflow/workflow_cli.js archive --summary
```

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-plan` | 规划流程 | [`../workflow-plan/SKILL.md`](../workflow-plan/SKILL.md) |
| `workflow-execute` | 任务执行 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| `workflow-review` | 全量完成审查（execute 完成后独立执行） | [`../workflow-review/SKILL.md`](../workflow-review/SKILL.md) |
| `workflow-delta` | 增量变更 | [`../workflow-delta/SKILL.md`](../workflow-delta/SKILL.md) |
| `workflow-status` | 状态查看 | [`../workflow-status/SKILL.md`](../workflow-status/SKILL.md) |

> CLI 入口：`core/utils/workflow/workflow_cli.js`
>
> 运行时资源参见 [`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
