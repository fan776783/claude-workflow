---
name: prototype
description: "Build throwaway prototypes to flush out design questions before committing. Routes between Logic (terminal TUI for state/data validation) and UI (multiple radically different variants on one route). Use when user says 'prototype this' / '原型' / '试一下' / 'let me play with it' / 'try a few designs' / '验证一下这个设计', or needs to answer a question only running code can answer."
argument-hint: <要验证的设计问题>
---

<CONTEXT>
Read `core/specs/shared/glossary.md`（确保命名一致）。prototype 是丢弃物,code-specs 可跳过。
</CONTEXT>

# Prototype

Prototype 是**回答一个问题的丢弃代码**。问题决定形状。

## 选分支

识别要回答的问题——来自用户 prompt、周围代码、或直接问:

- **"这个逻辑/状态模型对不对?"** → [LOGIC.md](references/LOGIC.md)。建 terminal TUI 把状态机推过纸上难想的 case。
- **"这个应该长什么样?"** → [UI.md](references/UI.md)。在同一路由生成多个结构性不同的变体,浮动栏切换。

两个分支产出完全不同——选错浪费整个 prototype。真不确定时:后端 module → Logic;page/component → UI。开头写明假设。

## 通用规则

1. **一出生就是丢弃物**。放在它要验证的 module/page 附近,命名让人一眼看出是 prototype。
2. **一条命令可跑**。用项目已有 task runner(`pnpm run <name>` / `python <path>` / etc)。
3. **不持久化**。状态放内存。除非问题本身是关于持久化的。
4. **跳过 polish**。不写测试、不加 error handling、不搞抽象。
5. **暴露状态**。每次 action 后打印/渲染完整相关状态。
6. **答案是唯一产出**。prototype 回答完问题后,答案沉淀到 commit message / ADR / issue / NOTES.md,代码删除或吸收。

## 完成后

问用户学到了什么。如果用户 AFK,留 `NOTES.md` 在 prototype 旁边,记录问题 + 答案 + 结论。

## Anti-patterns

- 给 prototype 写测试
- 连真实数据库(用内存,除非问题就是关于持久化)
- 泛化("万一以后要支持 X")
- Logic 分支把逻辑和 TUI 混在一起(逻辑必须是纯 module,TUI 是薄壳)
- UI 变体只换颜色/文案(必须结构性不同)
- 把 prototype 代码直接发布到生产(丢弃约束下写的,重写后再用)

## 与其他 skill 的关系

- `/grill` 对齐后 → 进 prototype 回答"跑起来才知道"的问题
- prototype 答案 → 喂 `/quick-plan` 或 `/tdd`
- `/tdd` 不能替代 prototype(prototype 不写测试,只回答设计问题)
- `/workflow-spec` Step 5 设计深化中如需验证设计假设 → 用户可手动调用 `/prototype`
