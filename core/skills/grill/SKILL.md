---
name: grill
description: "Use when 用户说「帮我理清」「先别写」「grill me」「我想想怎么做」「需求不清楚」, or 用户给出「写登录 / 加字段 / 加 API」之类模糊描述需要澄清。替代 quick-plan Step 1 Ambiguity Gate。"
---

<CONTEXT>
质询涉及代码库术语时 Read `core/specs/shared/glossary.md`。
</CONTEXT>

# Grill

质询用户到共享理解为止。走决策树每个分支,逐个解决依赖。每个问题给出你的推荐答案,一次只问一个,拿到反馈再进下一个。

**每个问题之前先检查**——能查到的不要问用户:
- 能在 `core/specs/shared/glossary.md` 里查到? → 查
- 能在代码里查到? → 用 `mcp__auggie-mcp__codebase-retrieval` 查
- 真的需要用户回答? → 问

质询中两个不放过的点:
- **glossary 是 canonical 权威** —— 用户术语和 `core/specs/shared/glossary.md` 冲突,或用模糊 / 过载词时当场戳出来,要求精确化
- **读代码抓矛盾** —— 用户陈述某处行为时读代码比对,口述与实现矛盾立即指出,别默认信任用户说法

产出:对齐后的任务描述(结构化 markdown,≤ 30 行),只读不写,交给用户。
