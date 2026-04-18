---
name: session-review
description: "Use when asked to review the changes made in the current session — phrases like 审查本会话的改动 / review this session's changes / 用 codex review 刚才改的文件 should trigger this. Unlike diff-review which reads git diff, this skill gathers the file list from the current conversation context (Edit/Write tool calls) and hard-stops if the context was compacted or cleared. Aborts rather than falling back to git, so scope never drifts into upstream merges or unrelated working-tree changes."
---

# session-review

审查**当前会话内由本模型产生的代码改动**。与 `diff-review` 的区别只有一个：审查范围不从 `git diff` 拿，而是从当前对话上下文里盘出模型自己写入/编辑过的文件。

这么做的目的是避免 `git diff` 类方案把上游合并、其他人的改动或旧脏文件一起拉进审查范围——会话里真正属于本轮工作的改动往往只是 working-tree 的子集。

代价是**信息源脆弱**：上下文一旦被压缩或清空，会话边界就丢了。所以本 skill 不做"尽量回忆"的降级，只要检测到压缩/清空就硬停。

## 执行铁律

- 未完成 Compaction 硬停检测前，不得进入任何后续步骤；不得用 `git diff` / `git status` 补齐或替代会话盘点结果。
- 变更集必须来自对话上下文里本模型的 Edit/Write/NotebookEdit（含 Bash 间接写入）记录，不得从 git 推断。
- Codex 审查 prompt 里必须把范围显式限定到本会话文件清单，并声明"忽略其它 working-tree 变更"。
- 未完成 verification 与 impact analysis 前，不得给出最终 P0/P1，也不得输出 `INCORRECT`。

## Entry Gate

按顺序执行，中途不得跳步：

1. **Compaction 硬停检测**——按 [`references/context-capture.md`](references/context-capture.md) Step 1 判定。命中任一信号 → 输出固定中断文案后立即返回。
2. **变更集盘点**——按 `references/context-capture.md` Step 2 从上下文提取三项：变更摘要、文件清单、每文件改动摘要。
3. **用户确认（可选）**——按 `references/context-capture.md` Step 3 把清单展示给用户；`--no-confirm` 可跳过此步，但不影响前两步的硬约束。
4. **读取共享规范**：[`../diff-review/specs/review-pipeline.md`](../diff-review/specs/review-pipeline.md)、[`../diff-review/specs/impact-analysis.md`](../diff-review/specs/impact-analysis.md)、[`../diff-review/specs/report-schema.md`](../diff-review/specs/report-schema.md)。

Entry Gate 全部完成之前，不得输出 candidate findings、不得给出 Verdict。

## 用法

```
/session-review [OPTIONS]
```

| 参数 | 说明 |
|------|------|
| (无) | 从上下文盘出本会话改动文件后等待用户确认，再进入审查 |
| `--no-confirm` | 跳过 Step 3 的用户确认，盘点完成直接进入审查 |

本 skill 不接受文件列表参数——如果想手工列文件，请用 `/diff-review <file1> <file2> ...`。这是刻意的设计：让 `session-review` 只有一条路径（上下文盘点），避免两种 scope 混用。

## 审查范围描述

Report Summary 的审查范围字段必须明确标出信息来源：

```
审查范围：本会话上下文提取的 N 个改动文件（来源：Edit/Write tool calls）
```

禁止描述成"最近的改动"、"用户关心的文件"等含糊表述——信息源是否是本会话上下文，是本 skill 与 diff-review 的关键区别。

## 审查管线

Entry Gate 完成后，把 Step 2 盘出的变更集交给共享管线：[`../diff-review/specs/review-pipeline.md`](../diff-review/specs/review-pipeline.md) Layer C-H（Candidate Discovery → Normalization → Verification → Impact Analysis → Severity Calibration → Report Synthesis）。

管线所需的输入契约（变更集来源 / 文件清单 / 统计）在 Entry Gate Step 2 已经准备好。

### 给 Codex 的范围限定

Codex 看不到本会话对话，也默认会扫到整个 working tree。必须在 prompt 里显式限定：

```
Review ONLY the following N files (from the current session's Edit/Write history). 
Ignore all other modified or untracked files in the working tree — they are out of scope.

Files in scope:
1. <path-1>
2. <path-2>
...

Context: <Step 2.1 的本会话变更摘要>
```

变更摘要 + 文件列表提供给 Codex 的意图上下文——否则 Codex 只看到孤立 diff，容易把"迁移到独立命令链"之类的文档重构误判成重复陈述。

## 优先级、Verdict、Review Loop

完全沿用 `../diff-review/specs/review-pipeline.md` 与 `../diff-review/specs/report-schema.md`，本 skill 不另作定义。

## Exit Criteria

允许表述为"已完成"的条件：

- Compaction 硬停检测通过，变更集盘点从上下文取得
- Codex prompt 已包含显式范围限定
- 候选问题经过 verification，需要的 impact analysis 已完成
- 报告 Summary 含 `Review Mode = session`、`审查范围`（含信息来源）、`Verdict`、`Confidence`、`Impact Status`、`Verification Coverage`、`Files`
- 若 Verdict = `INCORRECT`，每个 blocking finding 都包含 `Fix Scope` 与 `Regression Verification`

检测到 compaction 后立即返回的情况，不视为"完成审查"；应视为**审查未执行**，由用户改用 `/diff-review` 继续。

## 协同关系

| 关联 | 路径 | 说明 |
|------|------|------|
| 共享管线 | `../diff-review/specs/review-pipeline.md` | Layer C-H 的候选发现/验证/影响/汇总 |
| 影响分析 | `../diff-review/specs/impact-analysis.md` | Layer F 的影响面维度 |
| 报告规范 | `../diff-review/specs/report-schema.md` | 报告结构与 terminal/artifact 模板 |
| Codex 桥接 | `../collaborating-with-codex/SKILL.md` | Codex 调用契约 |
| 变更集盘点 | `references/context-capture.md` | 本 skill 独有的上下文盘点流程 |
