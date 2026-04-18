# Session Context Capture

> 本 skill 不依赖 `git diff` 或文件系统扫描；审查范围来自**当前对话上下文**里模型自己写入/编辑过的文件与改动意图。这是 `session-review` 区别于 `diff-review` 的核心点。
>
> 相应地，只要上下文不完整——被压缩、被清空、或 skill 在"跨 session 恢复"后运行——就无法可靠界定本会话的改动。此时必须硬停，不得降级为"尽量回忆"。

## Step 1: Compaction 硬停检测（必须首先执行）

进入 skill 后的第一件事是判定上下文是否完整。以下**任一**信号命中即立即中断，不进行后续任何步骤：

| 信号 | 典型表现 |
|------|---------|
| 对话中出现过 compaction 系统提示 | `<compaction-summary>`、"conversation was compacted"、"earlier turns have been summarized"、"context was compressed" 等明显的压缩标记 |
| 对话一开始就被 `/clear` 清空 | 当前上下文从一个几乎空白的起点展开，用户却要求"审查本会话的改动" |
| 有 session 边界 tag 表明是 resume | 例如提示里出现明确的"resumed from previous session"或显式的 session boundary marker |

**关键纪律**：判断依据是对话里**可检索到的压缩/清空标记**，不是模型自己对"我还记得清"的主观评估。不得因"感觉记得起来"跳过此步骤；也不得在命中任一信号后"尽量补齐"。

命中后输出固定文案（原样复制）：

```
⚠️ 检测到本会话上下文已被压缩或清空，会话变更信息不完整。
session-review 不能在此状态下执行，否则会遗漏或误报改动。

建议改用：
- /diff-review                 —— 基于 git diff，不依赖会话记忆
- /diff-review <file1> <file2> —— 手工列出要审查的文件
```

然后**立即返回**，不进入 Step 2。

## Step 2: 变更集盘点

通过 compaction 检测后，从当前上下文里盘出以下三项：

### 2.1 本会话变更摘要

用 1-3 句自然语言总结"本会话做了什么"。例如："精简 3 个 SKILL.md，抽出 1 个共享 pipeline，新增 2 个 references 文件。"

摘要不是给用户看的装饰，而是 Codex prompt 的上下文：Codex 看不到本会话历史，只能从这句摘要里理解**意图**，避免把"迁移到独立命令链"的说明误判成"重复陈述"。

### 2.2 改动文件清单

扫描当前上下文里本模型发起的 tool call（主要是 `Edit`、`Write`、`NotebookEdit`；`Bash` 里通过 `>`、`tee`、`sed -i` 等间接写入也要算上），收集路径去重后列出。

输出格式（必须）：

```
本会话改动文件清单（来自上下文）：
- <path-1>
- <path-2>
...
共 N 个文件。
```

**不允许的动作**：
- 不得用 `git status` / `git diff` 的结果替代本清单（那会混入上游合并、其他人的改动、旧脏文件）
- 不得因"清单看起来不全"去读 git 补齐——宁可清单短，不能混入会话外改动

### 2.3 每个文件的改动摘要（可选但推荐）

如果能从上下文里明确提取，每个文件附一行改动描述（"删除 X 章节"、"补齐 box-drawing 禁用 WHY"）。这部分用于后续 Codex prompt 里帮助它理解改动意图。

提取不出来的文件不强求，留空即可；但不得猜测。

## Step 3: 用户确认（推荐，非硬要求）

在进入后续审查管线前，把 Step 2 的三项内容展示给用户，让用户确认清单是否完整：

```
以上是我从本会话上下文里盘出的改动集。确认进入审查请回复 `go`，或输入 `+ <path>` / `- <path>` 调整清单。
```

用户确认后进入 `SKILL.md` 的后续阶段。

用户可以明确跳过此确认（`/session-review --no-confirm`），但跳过不改变 Step 1/2 的硬约束。

## Step 4: 交付给共享管线

把 Step 2 的三项作为**变更集**输入 `../diff-review/specs/review-pipeline.md`。管线要求的输入契约已经满足：

- 变更集来源 = "本会话上下文提取的 N 个文件"
- 文件清单 = Step 2.2 的列表
- 统计 = 文件数（行数 +/- 不强制，因为不跑 git diff）

在 Codex prompt 里必须显式加上：

```
Review ONLY these N files. Ignore all other modified or untracked files in the working tree.
```

这是 `session-review` 必备的范围限定——否则 Codex 会扫到 git working-tree 里的上游改动，产出大量范围外 finding。
