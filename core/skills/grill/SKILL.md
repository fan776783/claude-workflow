---
name: grill
description: "对齐澄清 - 在动手写代码 / 写 plan / 写 spec 之前,把模糊需求反复质询到共享理解为止。触发条件:用户说「帮我理清」「先别写」「grill me」「我想想怎么做」「需求不清楚」「写登录 / 加字段 / 加 API 之类模糊描述」。替代旧 /enhance(prompt 改写)和 quick-plan Step 1 的 Ambiguity Gate。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:用户只要 prompt 字面改写(无代码库诉求)时可跳过 code-specs,但仍须读 glossary。
</PRE-FLIGHT>

# Grill

质询用户到共享理解为止。走决策树每个分支,逐个解决依赖。每个问题给出你的推荐答案,一次只问一个,拿到反馈再进下一个。

能在代码里查到的答案不要问——直接查代码。

## Quick Mode(无代码库诉求)

用户只是想把一段模糊 prompt 改写为结构化需求(原 `/enhance` 的场景)。跳过 glossary 挑战,按以下骨架补齐后发还给用户:

- **目标**:<一句话,用户视角>
- **功能点**:<列表,可测试>
- **技术约束**:<语言 / 栈 / 依赖 / 不能做什么>
- **验收标准**:<可勾选清单>

补齐后自然语言提示:"增强版本如上,要用请继续,要改直接回复改动。" 不上 AskUserQuestion。

## Deep Mode(涉及代码库)

进入决策树质询。**每个问题之前先检查**:
- 这个问题能在 glossary 里查到答案? → 查
- 能在代码里查到答案? → 用 `mcp__auggie-mcp__codebase-retrieval` 查
- 真的需要用户回答? → 问

### 挑战 glossary

用户用的术语和 `core/specs/shared/glossary.md` 里定义冲突时,立刻戳出来:"你说的 'cancellation' 在 glossary 里是 X,你这里似乎想说 Y,哪个对?"

用户用模糊 / 过载术语时,提议精确替换:"你说 'account',是指 Customer 还是 User?这俩是不同的 module。"

### 具体化场景

关系讨论时用具体场景压力测试:"如果用户在 A 状态下点了 B,结果应该是什么?C 状态呢?" 边界通过场景浮出来。

### 交叉验证

用户陈述某处行为时,读代码比对。发现矛盾就指出来:"代码里只支持整单取消,你说部分取消是可能的——哪个对?"

### 产出

- **对齐后的任务描述**(结构化 markdown,≤ 30 行)
- **新增 canonical 术语草案**(如果质询中发现 glossary 缺词,列 Bad/Good + Why,交给用户用 `/spec-update` 固化)
- **ADR 草案**(可选,见下)

### ADR 何时产出(三重门槛)

三条都满足才建议写 ADR,否则不提:

1. **难以反悔**:改主意的成本够大
2. **无背景难理解**:未来读者会问"为什么这么做"
3. **真实权衡**:当时有真实的替代方案,选了 A 是因为 B/C 的具体代价

任一不满足 → 跳过。ADR 模板见 `core/specs/shared/adr-protocol.md`。

## 边界

grill 产出的是**对齐后的任务描述**,不是 plan / spec。后续动作:
- 要出 plan → `/quick-plan` 或 `/workflow-spec`
- 要沉淀词汇 / convention → `/spec-update`
- 要直接改代码(明确是 typo 级) → 直接改,不用再经过 grill
