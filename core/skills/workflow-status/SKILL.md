---
name: workflow-status
description: "Use when 用户调用 /workflow-status, or 需要查看当前 workflow 的状态/进度/下一步建议。只读操作,不修改任何文件。"
---

> 路径 convention 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。

# workflow-status

<HARD-GATE>
**只读原则**：仅读取状态,不得修改 `workflow-state.json` 或任何产物文件。
</HARD-GATE>

## Checklist

1. ☐ 调用 CLI 读取状态
2. ☐ 按详细级别补充上下文
3. ☐ 格式化输出报告
4. ☐ 给出下一步建议

## Step 1: 读取状态

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
```

返回 `error: '没有活跃的工作流'` → 提示用户先 `/scan` 或 `/workflow-spec` 启动新 workflow。

## Step 2: 按详细级别补充

| 参数 | 模式 | 额外 CLI |
|------|------|----------|
| _(无参数)_ | 简洁 | `next` + `context` |
| `--detail` | 详细 | `progress` + `next` + `list` + `budget` + `journal list` + `context` |
| `--json` | JSON | 直接输出 `status` 原始 JSON |

`context` 返回 workflow 上下文字段;`spec_file` / `plan_file` 存在于磁盘 `workflow-state.json` 中,可直接从 `status` 原始 JSON 获取;`list` 返回各任务的 id / name / phase / status / actions。

## Step 3: 格式化输出

按模式渲染,模板与条件字段表见 [`references/output-format.md`](references/output-format.md)。简洁默认;`--detail` 追加任务清单/journal/关卡/预算;`--json` 直出原始 JSON。

## Step 4: 下一步建议

按 `workflow_status` + `halt_reason` 选建议,完整映射表 + halt_reason 解读见 [`references/next-action.md`](references/next-action.md)。CLI `next` 命令只返回下一个 task 对象,不出 next-action,建议由本 skill 翻译。

> Legacy 状态 `paused` / `blocked` / `failed` / `planning` 会被 CLI 投影为新状态。一次性升级旧文件运行 `workflow_cli.js migrate-state`。
>
> 本 skill 只读 workflow runtime;若用户用 `/team`,改查 `/team status`。
