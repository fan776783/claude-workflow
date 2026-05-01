# Pre-Flight：碰代码前读什么

"读规范后再改代码" 协议的单一事实来源。任何涉及分析、修改或review代码的 skill 都链接到这里,而不是各自重复一段前置。

> 本文件 **不是** 运行时启动 pre-flight。Git / `project-config.json` / `workflow-state.json` 的 bootstrap 在 [`../workflow-runtime/preflight.md`](../workflow-runtime/preflight.md)。两者回答的不是同一个问题:本文件讨论的是"碰代码前要不要读 code-specs / glossary / repo-context"。

## 触发条件

满足任一条即运行本协议:

- 即将用 `Edit` / `Write` 修改的文件路径能映射到 `.claude/code-specs/` 下的某个 `{pkg}/{layer}`
- 进入 workflow 的 `plan` / `execute` / `review` 阶段
- 分析 bug、提修复方案或 review delta

## 必读项(按序)

会话内已完成的步骤跳过。单个文件本会话内不要读第二次。

### 1. 项目配置
**Read**: `.claude/config/project-config.json`
**作用**: 获取 `project.id`、`project.bkProjectId`、pkg 清单、技术栈提示。
**缺失时**: 提示用户先跑 `/scan`,不要凭空构造配置。

### 2. 仓库上下文(如存在)
**Read**: `.claude/repo-context.md`
**作用**: `/scan` 产出的仓库概览(技术栈、结构、convention)。
**缺失时**: 可继续,但告诉用户 `/scan` 能补上这份视角。

### 3. 受影响 layer 的 code-specs
对任务涉及的每个 `{pkg}/{layer}`:
- **Read**: `.claude/code-specs/{pkg}/{layer}/index.md`
- 按 index 里的 `## Pre-Development Checklist` 用 `Read` 跟读点名的 convention / contract 文件。

**缺失时**: `.claude/code-specs/` 整体不存在 → 调用 `/spec-bootstrap`;只是某个 `{pkg}/{layer}` 不存在 → 在任务产出里标记 `spec_gap`,按通用原则继续。

### 4. Glossary
**Read**: [`./glossary.md`](./glossary.md)(每会话一次即可)
**作用**: 所有 normative 产出(spec / plan / review 意见 / PR 正文)必须用 canonical 术语。drift lint 只给 warning,提前读 glossary 是最省事的避坑方式。

### 5. Business Glossary(条件可选)
**Read**: `.claude/code-specs/shared/business-glossary.md`(**存在**则读,否则跳过)
**作用**: 项目级业务领域术语。涉及业务讨论的 skill(spec 扩写 / fix-bug Phase 1 / spec-update)推荐跟读;涉及纯框架 / 内部工具的任务可跳过。
**缺失时**: 不 fail。项目未沉淀业务词表是常态;协议见 [`./business-glossary.md`](./business-glossary.md)。

### 6. ADR Protocol(条件可选)
**Read**: [`./adr-protocol.md`](./adr-protocol.md)(每会话一次即可,仅当本次任务涉及结构性决策)
**作用**: 判断本次决策是否需要留 ADR;三重门槛定义见 adr-protocol.md。
**适用**: `workflow-spec` § 9.2 方案选择 / `workflow-review` Stage 1 advisory / `fix-bug` Phase 4 架构级 gap。不涉及决策的任务跳过。

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
- [`./glossary.md`](./glossary.md) — canonical glossary(框架层),第 4 步会读它
- [`./business-glossary.md`](./business-glossary.md) — 业务层术语协议,第 5 步按需跟读项目级文件
- [`./adr-protocol.md`](./adr-protocol.md) — ADR 三重门槛协议,第 6 步按需读

## skill 应该如何引用本文件

Skill **不**使用被动 markdown link,必须写显式 Read 指令。不同 agent 工具对 markdown link 的跟随行为不一致,显式 Read 指令最可靠。

### 最小 `<PRE-FLIGHT>` 块模板

推荐每个 SKILL.md 顶部(frontmatter 之后、skill 正文开头)只写这三行:

```markdown
<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:<一句话说明何时可跳过>。
</PRE-FLIGHT>
```

不再复写"读 project-config → 读 repo-context → 读 code-specs"的步骤——那是本文件的职责,skill 只说"读我"和"什么时候可跳"。

### 其他 shared 协议如何被引用

skill 内部用到下列跨 skill 的协议时,**也写引用而非复写**:

| 协议文件 | 何时引用 | 引用范例 |
|---|---|---|
| `glossary.md` | 产出 normative 文档前 | 已由 pre-flight § 4 覆盖,skill 侧无须单独提 |
| `architecture-language.md` | 讨论 module / interface / depth / seam / adapter / refactor 时 | `core/specs/shared/architecture-language.md § Terms` |
| `hard-stop-templates.md` | AskUserQuestion 真决策点 | `core/specs/shared/hard-stop-templates.md § T3`(按模板编号) |
| `manual-intervention-reasons.md` | 产出 manual_intervention 分支 | `core/specs/shared/manual-intervention-reasons.md` + 本 skill 可能命中的子集 |
| `codex-routing.md` | review路径判定 | `core/specs/shared/codex-routing.md § 决策表` |
| `status-readiness.md` | 缺陷 / issue 状态流转 | `core/specs/shared/status-readiness.md § 判定条件` |
| `impact-analysis-template.md` | 影响面分析 | `core/specs/shared/impact-analysis-template.md § 6 个维度` |

原则:**协议本体只写一份,skill 里只说"查 XX § YY"**。新增或修改协议时只改共享文件,skill 自动跟着更新。
