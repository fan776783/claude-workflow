---
name: grill
description: "Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions 'grill me' / 「帮我理清」「先别写」「我想想怎么做」「需求不清楚」。"
---

<CONTEXT>
纯访谈 skill,不强制读 code-specs / glossary。术语挑战 / glossary 更新 / ADR 提议走 `core/specs/shared/domain-modeling-protocol.md` 统一协议。
</CONTEXT>

# Grill

> **语言**：面向用户的提问与对齐结论一律用中文（遵循 global「用户输出用中文」协议）。下方英文是给模型的行为指令，**不决定输出语言**。

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## 协同

- 产出:对齐后的任务描述(结构化 markdown,≤ 30 行),只读不写,交给用户——可直接作 `/quick-plan` 输入
- 质询中需要外部证据 → `/research`
- 问题要"跑起来才知道" → `/prototype`
