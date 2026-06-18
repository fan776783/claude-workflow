# Skill Craft

skill 设计的元理论词汇。`glossary.md` 管项目 / workflow / 产物术语，`architecture-language.md` 管架构形状术语，本文件管 **skill 本身的设计** 术语——什么算好 skill、什么算坏 skill、如何诊断。

改编自 mattpocock/skills `writing-great-skills/GLOSSARY.md`（MIT 授权），本地化到本项目的 shared 文件范式。

## Scope

**必读**：
- `core/skills/write-a-skill/**`（写新 skill 或审计现有 skill 时）
- 任何对 SKILL.md 做 description / 结构 / 拆分决策时

**豁免**：与 `glossary.md` 一致（CLAUDE.md、README、`core/docs/**`、fenced code、`// glossary-allow` 后缀）。

## Terms

### Predictability
skill 的根德。每次触发产生 **一致的过程**，不是一致的输出。输出随输入变，过程（先做什么、读什么、写什么）稳定。区分"可预测"与"确定"：确定性操作该走 `scripts/`，skill 管的是需要判断但过程可预测的部分。
**Avoid**: "一致性"（歧义：输出一致还是过程一致？）

### Context Load
每个 model-invoked skill 的 description **每轮常驻** system prompt，花 token + 注意力竞争。user-invoked skill 的 description 不常驻（人显式键入才加载正文）。这是 user-invoked vs model-invoked 划分的根本代价依据。
**Avoid**: "token 成本"（只覆盖了代价的一半，漏了注意力竞争）

### Cognitive Load
用户面对 N 个 skill 时的记忆 / 选择负担。与 context load 不同：context load 是模型的代价，cognitive load 是人的代价。router skill（如 `ask-workflow`）是 cognitive load 的 cure——画一张图让人不用记全部入口。

### Information Hierarchy
skill 内容按 layer 分级，越往上层越贵（常驻或每次读），越往下层越便宜：
1. `SKILL.md` 正文 steps — 每次触发必读
2. `references/*.md` — 按需读，只在 step 显式指向时加载
3. `core/specs/shared/*.md` — 跨 skill 共享，0 context load，只在被 `<CONTEXT>` 指向时读
4. `scripts/*.js` — 确定性操作，0 context load

内容该放哪层取决于使用频率和跨 skill 复用度。共享词汇 / 协议永远放第 3 层，不放进 skill。

### Progressive Disclosure
不要一开始就把所有细节塞进 SKILL.md。先给 steps 骨架，细节拆到 `references/`，触发时按需读。判断标准：`SKILL.md` ≤ 120 行。超出时考虑拆文件——但先看能否砍 sediment / no-op，拆文件是最后手段。

### Leading Word
description 和 step 标题用模型预训练时见过的词锚定行为。用 "Interview" 而非 "Talk to user"，用 "Diagnose" 而非 "Find problem"。预训练词携带行为先验，减少歧义。中文触发词同理：用「质询」而非「聊聊」，用「诊断」而非「看看」。
**Avoid**: 模糊动词（"处理"、"搞定"、"搞定一下"）——不携带行为先验。

### Invocation Type
- **user-invoked**：`disable-model-invocation: true`。description 面向人（保留触发短语，砍维护者身份说明）。只人显式键入，模型不自动触发。适合纯入口 / 编排类（如 `workflow-spec`、`handoff`、`workflow-status`）。
- **model-invoked**：默认。description 面向模型（保留丰富触发短语）。模型按上下文自动触发。适合需要按场景自动激活的执行类（如 `diagnose`、`tdd`、`diff-review`）。

判断标准：如果这个 skill 该由模型"自动想起来用"，就 model-invoked；如果只该由人"主动决定用"，就 user-invoked。

### No-op
description 或 step 里对模型无信息增益的内容。典型：
- 身份说明（"本 skill 是 X 体系的一部分"）
- 消费链（"修复交给 Y 消费"）
- 交叉引用（"替代 Z Step N"）

这些是给维护者看的，该进 `references/` 或 CHANGELOG，不该进 description。model-invoked 的 description 保留触发短语 + 行为边界（"不直接写修复代码"是行为边界，保留），砍 no-op。

### Sediment
随版本累积、已无活跃用途的内容。和 no-op 不同：no-op 是写的时候就多余，sediment 是 **曾经有用但被新机制取代后没删**。典型：退役协议的残留步骤、被 shared 文件取代的 inline 内容、被 hook 取代的粘贴指令。cure 是删除，不是保留"以防万一"。

### Sprawl
单个 skill 膨胀到覆盖多个不相关领域。和 duplication 不同：duplication 是多个 skill 重复同一内容，sprawl 是一个 skill 装太多。cure 是拆成多个 skill + shared 文件。

### Duplication
同一协议 / 词汇在多个 skill inline 重复。cure 是抽到 `core/specs/shared/` 文件，各 skill 用 `<CONTEXT>Read ...</CONTEXT>` 引用。当前项目已用此范式（`architecture-language.md`、`glossary.md`、`adr-protocol.md`、本文件）。**永远不要在 skill 里 inline 共享词汇**——那是 duplication，不是 self-contained。

## Failure Modes 诊断清单

审计现有 skill 时逐条对照：

| 症状 | 诊断 | cure |
|------|------|------|
| description 超 1-2 句还含实现细节 | no-op | 砍身份说明 / 消费链 / 交叉引用，只留触发短语 + 行为边界 |
| `SKILL.md` > 120 行 | progressive disclosure 违反 | 先砍 sediment / no-op；仍超则拆 `references/`，正文只留 steps 骨架 |
| 同一协议在 3+ skill inline | duplication | 抽 `core/specs/shared/` 文件，各 skill `<CONTEXT>` 引用 |
| 入口 / 编排类 skill 被模型自动误触发 | invocation type 错误 | 加 `disable-model-invocation: true` |
| step 标题用模糊动词（"处理"、"搞定"） | leading word 缺失 | 换预训练词（"diagnose"、"interview"、"extract"） |
| 退役机制残留步骤 | sediment | 删除，或降级为 `references/` 里的历史说明 |
| 一个 skill 覆盖 3+ 不相关领域 | sprawl | 拆成多个 skill + shared 文件 |
| 每轮 context 里 20+ skill description | context load 失控 | 入口类转 user-invoked + 加 router skill 降 cognitive load |
| 共享词汇 inline 在 skill 里 | duplication | 移到 `core/specs/shared/`，skill 改为 `<CONTEXT>` 引用 |
