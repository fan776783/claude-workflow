---
name: write-a-skill
description: "Use when user wants to create / write / draft / build a new skill — phrases like '写个 skill / 新建 skill / add a skill / 包装成 skill', or reviewing existing SKILL.md for size / description / structural compliance."
---

<CONTEXT>
Read `core/specs/shared/glossary.md` + `core/specs/shared/skill-craft.md`（skill 元理论词汇 + failure modes 诊断清单，审计 skill 时用作镜头）+ 目标 skill 的已有 SKILL.md（如有）。只改 description 字段（1 行改动）可跳过 skill-craft.md。
</CONTEXT>

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
argument-hint: "[<target>]"   # 可选;带参数才加,语法按功能分(见 Argument-hint 规范)
---

<CONTEXT>
Read `core/specs/shared/glossary.md` + 目标 skill 的已有 SKILL.md（如有）。只改 description 字段（1 行改动）可跳过。
</CONTEXT>

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

## Argument-hint 规范(可选)

`argument-hint` 是可选 frontmatter 字段,输入 `/skill ` 后灰显在命令名后提示参数。**纯文档,不解析**——真正取值靠 body 内 `$ARGUMENTS` / `$1` `$2`。不带参数的 skill 不加。

**核心原则:语法按功能分**(参 Claude Code 内置 `code-review`:`[low|medium|high|xhigh|max|ultra] [--fix] [--comment] [<target>]`)

| 参数功能 | 语法 | 例 |
|---|---|---|
| 互斥模式枚举(选 1) | 裸词,无 `--` | `low\|medium\|high`、`session`、`branch <base>` |
| 正交布尔开关(可叠加) | `--flag` | `--fix` `--comment` |
| 位置目标 | `<positional>` | `<target>` `<paths>...` |

**分层只在轴正交可组合时做**。互斥单轴(scope 三选一这类)→ 统一裸词,别给互斥项切 `--`/裸词混排。多根正交轴(模式 × 开关 × 目标)才按上表分层并存。

**两个坑**:
- **YAML**:值以 `[` 开头必须加引号 → `argument-hint: "[branch <base> | session]"`,否则被当 flow sequence 解析失败。
- **别加违背 skill 契约的参数**:如「审完默认停下、等用户显式确认才改」的 skill 不该加 launch `--fix`(启动即改)——破坏安全契约。功能差异不是对齐项,别为"像某个内置 skill"硬抄。

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
- [ ] 有 `<CONTEXT>` 块声明需要读什么（glossary / code-specs），不引用已废弃的 pre-flight 协议
- [ ] 若带参数:`argument-hint` 语法按功能分（枚举裸词 / 开关 `--` / 目标 `<>`），值以 `[` 开头已加引号，未抄违背契约的参数

## 元理论审计（对照 `core/specs/shared/skill-craft.md`）

起草后用 failure modes 诊断清单逐条过一遍：

- [ ] description 无 no-op（砍了身份说明 / 消费链 / 交叉引用，只留触发短语 + 行为边界）
- [ ] 入口 / 编排类 skill 标了 `disable-model-invocation: true`（避免 context load 失控 + 误触发）
- [ ] step 标题用 leading word（预训练动词，非"处理 / 搞定"）
- [ ] 无 sediment（退役协议残留步骤已删，不是"以防万一"保留）
- [ ] 无 duplication（共享词汇 / 协议走 `core/specs/shared/`，不 inline）
- [ ] 无 sprawl（一个 skill 不覆盖 3+ 不相关领域；超出则拆）

## 架构原则(借鉴 mattpocock/skills)

- **小**:每个 skill 只做一件事,跨任务靠组合
- **易改**:读起来像能被用户直接改的文档,不是代码生成器
- **可组合**:skill 间通过文档(glossary、shared 协议、`<CONTEXT>` 块)相互引用,不通过代码耦合
- **审慎**:不加"看起来完备"的协议层。3 条相似指令是抽象的标志,不是 2 条

## 与其他 skill 的关系

- `/scan` 跑完后如果发现项目需要定制 skill,可触发本 skill
- 改现有 skill 的 description 时也用本 skill 的 description 规范自查
