---
name: workflow-archive
description: "Use when 用户调用 /workflow-archive, or workflow 状态为 completed 需要归档。"
---

> 路径约定见 [`../../specs/shared/pre-flight.md`](../../specs/shared/pre-flight.md) § Workflow CLI 路径约定。归档只动元数据,pre-flight 必读项里 glossary 仍要读一下,保证 summary 用 canonical 术语。

# workflow-archive

<HARD-GATE>
**完成前置**：仅允许对 `completed` 状态执行 archive,不得跳过状态校验。
</HARD-GATE>

## Checklist

1. ☐ 调用 CLI 执行归档
2. ☐ 展示归档结果
3. ☐ 下一步建议

## Step 1: CLI 归档

```bash
# 基本归档
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js archive

# 带摘要报告
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js archive --summary
```

CLI 自动完成 tombstone 两阶段提交:校验 `status=completed` → 写 `ARCHIVING.marker` → 在 `history/<YYYY-MM>/<task>-<timestamp>/` 下生成快照(`workflow-state.json` status=archived、`tasks.md`、`changes/CHG-*`、可选 summary)→ 删除根目录 `workflow-state.json` / `tasks.md` / `changes/` → 清除 tombstone。

崩溃后下次任意 `/workflow-*` 启动会自动识别 tombstone:Phase 1 未完成则回滚 destDir,Phase 2 未完成则前滚清理根目录。

| 错误 | 含义 | 建议 |
|------|------|------|
| `没有可归档的工作流` | 无项目配置或无状态文件 | 提示先 `/scan` 和 `/workflow-spec` |
| `只有 completed 状态的工作流可以归档` | 当前不是 `completed` | 显示当前 `state_status`,提示先完成 workflow |

## Step 2: 展示结果

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 工作流归档

✅ 归档完成！

- **项目 ID**：{project_id}
- **状态**：archived
- **归档变更数**：{archived_changes.length}
- **归档目录**：{archive_dir}
{如有摘要：- **摘要文件**：{summary_file}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 3: 下一步

```
🎉 工作流已归档,可以开始新任务。
/workflow-spec "新功能描述"
```

> `/workflow-archive` 只 archive workflow runtime。原生 `/team` 的收尾由 `TeammateIdle` hook 触发负责人 `clean up team`。
