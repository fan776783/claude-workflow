---
name: quick-plan
description: "Use when 用户说「快速规划」「轻规划」「不走 workflow」「plan 一下」「quick plan」, or 需求清晰、作用域明确、可一次性规划完成的简单到中等任务。复杂项目(跨 module / 新子系统 / 需追溯)或需要正式需求文档 / PRD 请用 /workflow-spec。"
argument-hint: <需求描述 | path/to/requirement.md>
disable-model-invocation: true
---

<CONTEXT>
Read `.claude/code-specs/{pkg}/{layer}/index.md`（按涉及文件映射）+ `core/specs/shared/glossary.md`。单行 typo 直接改,无需 plan。
</CONTEXT>

# quick-plan

从对话上下文和代码库中合成一份可执行 plan。不走状态机,不质询(需要质询先走 `/grill`)。

## 产出

写到 `~/.claude/workflows/{pid}/plans/{kebab-case-name}-{MMDD}.plan.md`,格式见 [plan-template](references/plan-template.md)。

## 规则

- 不清楚就问,不猜——但能查代码的先查
- 新代码必须与代码库现有模式一致
- `.md` 参数 → 读文件内容作为输入
- 信心 < 5 → 建议切 `/workflow-spec`,不硬塞
- 复杂度评估见 [references/complexity-scoring.md](references/complexity-scoring.md)
- XL 级(跨 module / 新子系统) → 建议切 `/workflow-spec`
- 产出后不自动执行,告诉用户下一步选项,带编号便于快速回复:
  - `1` 直接实施(人工 / `/tdd`)
  - `2` 修改 plan → 回复反馈
  - `3` 升级完整 workflow → `/workflow-spec`
- 不调 AskUserQuestion。用户直接回复编号或内容即可。

## 与其他 skill 的关系

- 需求模糊 → 先 `/grill` 对齐再回本 skill,grill 产出直接作输入
- 需要调研外部方案 → 先 `/research`
- plan 后要沉淀规范 → `/spec-update`
- 需要正式需求文档 / PRD,或跨 module 追溯 → `/workflow-spec`
