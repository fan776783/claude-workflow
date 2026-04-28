# Pre-Flight：碰代码前读什么

"读规范后再改代码" 协议的单一事实来源。任何涉及分析、修改或审查代码的 skill 都链接到这里,而不是各自重复一段前置。

> 本文件 **不是** 运行时启动 pre-flight。Git / `project-config.json` / `workflow-state.json` 的 bootstrap 在 [`../workflow-runtime/preflight.md`](../workflow-runtime/preflight.md)。两者回答的不是同一个问题:本文件讨论的是"碰代码前要不要读 code-specs / glossary / repo-context"。

## 触发条件

满足任一条即运行本协议:

- 即将用 `Edit` / `Write` 修改的文件路径能映射到 `.claude/code-specs/` 下的某个 `{pkg}/{layer}`
- 进入 workflow 的 `plan` / `execute` / `review` 阶段
- 分析 bug、提修复方案或 review 变更

## 必读项(按序)

会话内已完成的步骤跳过。单个文件本会话内不要读第二次。

### 1. 项目配置
**Read**: `.claude/config/project-config.json`
**作用**: 获取 `project.id`、`project.bkProjectId`、pkg 清单、技术栈提示。
**缺失时**: 提示用户先跑 `/scan`,不要凭空构造配置。

### 2. 仓库上下文(如存在)
**Read**: `.claude/repo-context.md`
**作用**: `/scan` 产出的仓库概览(技术栈、结构、约定)。
**缺失时**: 可继续,但告诉用户 `/scan` 能补上这份视角。

### 3. 受影响 layer 的 code-specs
对任务涉及的每个 `{pkg}/{layer}`:
- **Read**: `.claude/code-specs/{pkg}/{layer}/index.md`
- 按 index 里的 `## Pre-Development Checklist` 用 `Read` 跟读点名的 convention / contract 文件。

**缺失时**: `.claude/code-specs/` 整体不存在 → 调用 `/spec-bootstrap`;只是某个 `{pkg}/{layer}` 不存在 → 在任务产出里标记 `spec_gap`,按通用原则继续。

### 4. Glossary
**Read**: [`./glossary.md`](./glossary.md)(每会话一次即可)
**作用**: 所有 normative 产出(spec / plan / review 意见 / PR 正文)必须用 canonical 术语。drift lint 只给 warning,提前读 glossary 是最省事的避坑方式。

## 跳过条件

满足 **任一** 就整体跳过本协议:

- **单行 typo 级修复**,不触碰业务逻辑
- **纯研究**,不会触发 Edit / Write
- **纯 code review**,你只是 review 别人的 diff
- **目标路径无法映射**到 `{pkg}/{layer}`(如根级配置文件、scripts 目录)
- **`.claude/code-specs/` 不存在** 且当前不是 `/spec-bootstrap`

跳过时在第一条用户回复里顺带说一句理由,方便用户 push back 纠错。

## 相关文件

同为 `shared/` 下的三个文件,别混淆职责:

- [`../workflow-runtime/preflight.md`](../workflow-runtime/preflight.md) — 运行时启动检查:Git 是否初始化、`project-config.json` 是否有效、是否存在未收尾的 workflow
- [`./context-awareness.md`](./context-awareness.md) — 执行期治理伙伴:预算、并行分派、continuation 决策
- [`./glossary.md`](./glossary.md) — canonical 术语表,第 4 步会读它

## skill 应该如何引用本文件

Skill **不**使用被动 markdown link,必须写显式 Read 指令。不同 agent 工具对 markdown link 的跟随行为不一致,显式 Read 指令最可靠。

推荐每个 SKILL.md 顶部挂的单行前置:

> **在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md` 并按其必读清单执行。** 只有当其跳过条件成立时才可跳过。

这一行放在 frontmatter 之后、skill 正文开头,替换掉过去各自写的"读 project-config → 读 repo-context → 读 code-specs"段落。
