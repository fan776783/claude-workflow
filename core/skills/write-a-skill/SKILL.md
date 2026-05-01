---
name: write-a-skill
description: "Use when user wants to create / write / draft / build a new skill — phrases like '写个 skill / 新建 skill / add a skill / 包装成 skill', or reviewing existing SKILL.md for size / description / structural compliance."
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:只改已有 skill 的 description 字段(1 行改动)可跳。
</PRE-FLIGHT>

# Write a Skill

## workflow

1. **收集需求** — 问用户:
   - 这个 skill 覆盖什么任务 / 领域?
   - 处理哪些具体用例?
   - 需要可执行脚本还是只要指令?
   - 有哪些参考资料要带?

2. **起草** — 创建:
   - `SKILL.md`(主指令,目标 ≤ 120 行)
   - 超出的内容拆到 `references/*.md`
   - 确定性操作拆到 `scripts/`(节省 token、提高可靠性)

3. **和用户 review** — 展示草稿,问:
   - 覆盖你的用例吗?
   - 有没有缺的或不清楚的?
   - 哪段要更详细 / 更简短?

## Skill 结构

```
skill-name/
├── SKILL.md           # 主指令(必须)
├── references/        # 详细文档(按需)
│   └── <topic>.md
└── scripts/           # 工具脚本(按需)
    └── <helper>.js
```

## SKILL.md 模板

```md
---
name: skill-name
description: "一句话说能力 + 'Use when <具体触发词>'. 1024 字符内,第三人称,中英混合触发词都带。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:<一句话>。
</PRE-FLIGHT>

# Skill Name

## 快速开始

[最小可跑示例]

## 工作流

[复杂任务的分步流程 + checklist]

## 高级特性

[见 references/<topic>.md]
```

## Description 规范

**description 是 agent 决定加载哪个 skill 时看到的唯一文本**。它和所有其他已装 skill 的描述一起出现在 system prompt 里。agent 读这些描述,按用户请求挑。

**目标**:让 agent 刚好够判断:
1. 这个 skill 提供什么能力
2. 什么时候 / 为什么触发(具体关键词、上下文、文件类型、中英混合用户口头语)

**格式**:
- 最多 1024 字符
- 第三人称写
- 第一句:做什么
- 第二句:"Use when <具体触发词>"
- 中英文触发词都要带(项目是中英混合会话)

**好例子**:
```
Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or user mentions PDF / 表格 / 合并文档.
```

**坏例子**:
```
Helps with documents.
```
没法和其他 skill 区分。

## 何时加脚本

- 操作是确定性的(校验 / 格式化)
- 同样代码会被反复生成
- 错误需要显式处理

脚本省 token 且比生成代码可靠。

## 何时拆文件

- SKILL.md 超过 120 行
- 内容有明显独立领域
- 高级特性很少用到

## Review Checklist

起草后对照:

- [ ] description 含"Use when ..." 且关键词具体
- [ ] SKILL.md ≤ 120 行
- [ ] 没有时间敏感信息("最新"、"下周" 等)
- [ ] 术语一致(用 `core/specs/shared/glossary.md` + `architecture-language.md`)
- [ ] 包含具体示例
- [ ] references / scripts 只拆一级深度
- [ ] 没有和其他 skill 重复的协议模板(Hard Stop / Manual Intervention / Codex 路由等走 `core/specs/shared/`)
- [ ] 没有复写 pre-flight 协议(只写 PRE-FLIGHT 块 + 跳过条件)

## 架构原则(借鉴 mattpocock/skills)

- **小**:每个 skill 只做一件事,跨任务靠组合
- **易改**:读起来像能被用户直接改的文档,不是代码生成器
- **可组合**:skill 间通过文档(pre-flight、glossary、shared 协议)相互引用,不通过代码耦合
- **审慎**:不加"看起来完备"的协议层。3 条相似指令是抽象的标志,不是 2 条

## 与其他 skill 的关系

- `/scan` 跑完后如果发现项目需要定制 skill,可触发本 skill
- 改现有 skill 的 description 时也用本 skill 的 description 规范自查
