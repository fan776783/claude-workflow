---
name: teach
description: "Stateful multi-session teaching: 把当前目录当作 teaching workspace（MISSION / GLOSSARY / RESOURCES / learning-records），按 Knowledge-Skills-Wisdom 三要素 + zone of proximal development 教用户一门技能或概念。Use when 用户说「教我 X」「我想系统学 X」「teach me」「继续上次的学习」, or 在已有 teaching workspace 目录中继续学习。一次性技术答疑不触发——直接回答即可。"
argument-hint: "想学什么?"
disable-model-invocation: true
---

<CONTEXT>
教学 workspace 与代码库无关，code-specs / glossary 跳过。Read workspace 内 `MISSION.md` / `GLOSSARY.md` / `RESOURCES.md` / `learning-records/`（如存在）。
</CONTEXT>

# Teach

有状态的多 session 教学——用户打算跨多个 session 学完这个主题。当前目录 = teaching workspace。

## Workspace 文件

学习状态全部落在这几个文件:

- `MISSION.md` — 用户学这个主题的 _原因_。所有教学决策的锚点。格式见 [references/MISSION-FORMAT.md](references/MISSION-FORMAT.md)。
- `GLOSSARY.md` — 主题 glossary。workspace 所有文件遵守其术语。格式见 [references/GLOSSARY-FORMAT.md](references/GLOSSARY-FORMAT.md)。
- `RESOURCES.md` — 可信资源清单,explainer 的知识来源,wisdom 的社区来源。格式见 [references/RESOURCES-FORMAT.md](references/RESOURCES-FORMAT.md)。
- `learning-records/*.md` — 学习记录,教学版 ADR:记录非显然的 lesson 和关键 insight,用于推算 zone of proximal development。编号 `0001-<dash-case-name>.md` 递增。格式见 [references/LEARNING-RECORD-FORMAT.md](references/LEARNING-RECORD-FORMAT.md)。
- `./assets/*` — 可复用组件库(样式表 / quiz 组件 / 模拟器 / 图表助手等)。跨多节课复用,见下方 ## Assets。

## Assets

课程从 `./assets/` 里的可复用**组件**构建,不是每节课各自内联。

- **复用是默认** — 写课前先读 `./assets/`,从已有组件搭。遇到新的可复用东西,抽成组件放回 `./assets/` 而不是内联进单节课
- **共享样式表是第一个该有的组件** — 让多节课看起来像一门课,不是一堆散页
- **随 workspace 增长** — 组件库也要增长。每节课产出的可复用部分回流到 `./assets/`

## 哲学

深度学习需要三要素:

- **Knowledge** — 从高质量、高信任资源获取
- **Skills** — 通过你基于知识设计的高相关练习获得
- **Wisdom** — 与其他学习者 / 实践者互动获得

`RESOURCES.md` 未充实前,首要任务是找高质量资源。**绝不信任参数化知识**。

主题决定配比:理论物理偏 knowledge,瑜伽偏 skills。

## Mission

每次教学都挂到 mission——用户学这个主题的原因。

用户讲不清 mission 或 `MISSION.md` 未填 → 第一件事是访谈用户为什么学。

不懂 mission → 知识获取脱离现实目标、练习太抽象、无法判断用户下一步该学什么。

## Zone of Proximal Development

用户应始终感到被"刚好够"地挑战。教学范围要极紧,直连 mission。

用户可能指定要学的确切内容。没指定时,推算 ZPD:

- 读 `learning-records/`
- 按 mission 判断该教什么
- 教落在 ZPD 内的最相关内容

用户说"这个我已经会了" → 记入 `learning-records/`。

## 获取 Knowledge

知识和技能通常打 1-2 连击:先教知识,再用练习巩固技能。

知识先从可信资源收集,再通过 HTML explainer 教给用户:

- 美观、遵守 glossary、落盘本地可回看
- **密集引用** — 每个论断附外部来源链接佐证
- **尽可能交互** — "try this" callout 让用户即时上手
- 给用户一条 CLI 命令一键打开 explainer

用户读完后答疑:直接回答,需要时修订 explainer(或另出一篇)。

确认用户理解某术语后 → 更新 glossary。

## 获取 Skills

技能走交互练习,可用工具:

- 交互式 HTML explainer(quiz / 轻量浏览器内练习)
- 引导真实世界步骤的 HTML explainer(如瑜伽体式)
- agent 内 quiz(就所学内容做场景化提问)

每个练习围绕**反馈回路**设计,反馈越即时越好。

## 获取 Wisdom

wisdom 来自真实世界互动——在学习环境之外检验技能。

用户的问题看起来需要 wisdom 时:默认姿态是先尽力回答,但最终**委托给社区**。

社区 = 用户能在真实世界检验技能的地方(线上或线下):论坛、subreddit、线下课(预算允许)、本地兴趣小组。找高声誉社区;用户明确不想加入 → 尊重并记录在 `RESOURCES.md`。
