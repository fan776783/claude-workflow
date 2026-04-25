# Code Spec:为 AI 编程设计的项目约束库

> 作者:justinfan · 2026-04-25
> 主题:介绍本项目 `@justinfan/agent-workflow` 的 `code-specs` 设计;附与 Google CodeWiki、Qoder Repo Wiki 的方案对比作为背景补充。
> 读者:写 AI 编码工作流、做项目知识库、或者正在做选型的工程师。

---

## 0. 这份文档在讲什么

本项目 `@justinfan/agent-workflow` 的 `code-specs` 是一套**项目级的编码约束以及契约库**。它把代码里写不出来的规则——命名约定、被禁用的模式、踩过的坑、字段契约的 Why——沉淀成结构化的 spec 文件,再喂回到 plan / execute / review 三个阶段的 AI 工作流里。这篇文档的主要任务就是把 code-specs 的设计讲清楚:二维布局为什么是 `{pkg}/{layer}/`、模板为什么分 convention 以及 contract 两档、审查为什么只做声明式 lint、bug 修复怎么和 spec 形成闭环。

与此同时,2026 年同一赛道上还有另一拨方案——Google CodeWiki、Qoder Repo Wiki、DeepWiki 这类"让 AI 读代码,自动生成 wiki"的派生文档产品。它们和 code-specs 都在说"项目知识库",可是解决的根本就不是同一个问题。文档后半部分会借助这两个方案做横向对比,把 code-specs 在这个谱系里的位置讲清楚,作为设计背景的补充。

**一句话版本**:code-specs 规定代码**必须**要去满足什么,CodeWiki 描述代码**是**什么。两者是互补的,前者在 AI 编程场景里是 must-have。

---

## 1. 三个方案的速写

### 1.1 Google CodeWiki

> 来源:arxiv 2510.24428(ACL 2026)"CodeWiki" 论文、Google Developers Blog "Introducing Code Wiki: Accelerating your code understanding"、codewiki.google、示例页 codewiki.google/github.com/google-gemini/gemini-cli。

- **是什么**:Google Cloud 的 Developer & Experiences 团队于 2025-11 发布的产品,原文里给的定义是:"Code Wiki, a platform that maintains a continuously updated, structured wiki for code repositories"。codewiki.google 官方自己挂出来的示例仓库就是 Gemini CLI,URL 的形式是 `codewiki.google/{hosting}/{org}/{repo}`(比如 `codewiki.google/github.com/google-gemini/gemini-cli`),任意一个 public GitHub 仓库都可以借助这个路径拉出来一份 wiki。
- **生成方式**:全自动,由 Gemini 来驱动。论文这边描述了三件事情串起来——hierarchical decomposition(分层分解) → recursive multi-agent processing with dynamic task delegation(递归多智能体再加上动态任务委派) → multi-modal synthesis(文本加上架构图加上数据流图)。产品这边的原文是:"Code Wiki scans the full codebase and regenerates the documentation after each change"。
- **产出**:带有架构感知的分层文档,强调的是模块依赖以及整体视图。官方明确列出来三类"always-current"图表——**architecture diagrams / class diagrams / sequence diagrams**,再配上可交互式的代码定义跳转,还有一个集成了 Gemini 的聊天入口,在页面上就可以直接问这个代码库的任何问题。
- **更新机制**:"automated & always up-to-date, the docs evolve with the code",每一次代码变更以后整份再重新生成,不做增量的 patch。
- **部署模式**:SaaS(codewiki.google 直接用)以及自托管(Google 正在做 Gemini CLI extension,让团队把同一套系统跑在自己内部的私有仓库上)。
- **目标用户**:以人类开发者为主,帮新人比较快地建立起心智模型;Gemini CLI extension 上线以后也会变成 CLI Agent 的上下文来源。

### 1.2 Qoder Repo Wiki

> 来源:docs.qoder.com/zh/user-guide/repo-wiki。

- **是什么**:Qoder AI IDE 内置的代码库知识库模块。
- **生成方式**:纯粹的 AI 自动。一键就从零开始生成,首次打开项目时默认是没有 Wiki 的,4000 文件级别的仓库大约要 120 分钟才能完成。
- **产出**:官方没有列出具体章节,不过系统会去抽取函数签名、类定义以及 API 端点。
- **更新机制**:自动检测加上手动确认。代码变更的时候系统检测到"不一致",用户就点"更新";Git 同步的时候点"同步"。单次的变更量 ≤ 10,000 行。
- **目标用户**:双端,人来读(架构查询、"X 是如何实现的"),以及 IDE 里的 Agent 消费(定位代码、加功能、修 bug)。

### 1.3 本项目 `code-specs`

> 来源:`core/skills/spec-bootstrap|spec-update|spec-review/SKILL.md`、`core/specs/spec-templates/`。

- **是什么**:项目级的编码规范以及契约库,AI 在 plan/execute/review 三个阶段里都会去读。
- **生成方式**:**以人写为主,AI 在一旁引导**。`/spec-bootstrap` 按照栈模板铺开 `{pkg}/{layer}/` 骨架,`00-bootstrap-guidelines` 首任务引导 Document Reality,`/spec-update` 交互式地追加,分成基础更新以及深度更新两档。
- **产出结构**(二维布局再加上共享 guides):
  ```
  .claude/code-specs/
  ├── index.md
  ├── {pkg-a}/
  │   ├── frontend/
  │   │   ├── index.md              ← 层入口:Guidelines Index / Pre-Development Checklist / Task Profiles / Quality Check
  │   │   └── {topic}.md            ← 两档模板之一
  │   └── backend/...
  ├── guides/index.md                ← 跨 package 的思考清单
  ├── local.md                       ← 项目对 canonical 模板的裁剪记录
  └── .template-hashes.json          ← 模板漂移治理
  ```
  - **Convention 模板**(主力,轻量 4 段):Overview / Rules / DO·DON'T / Common Mistakes。每一条 Rule 都必须要有代码示例以及 Why。
  - **Contract 模板**(重量 7 段,只针对字段级契约):Scope / Signatures / Contracts / Validation & Error Matrix / Good-Base-Bad Cases / Tests Required / Wrong vs Correct。
- **更新机制**:显式的、由用户来驱动、增量地追加。`/spec-update` 先去做主题 fuzzy 匹配,命中了就追加,没命中就新建。`.template-hashes.json` 用来跟踪模板版本,落后于最新 manifest 的时候走 planMigration/applyMigration 去做显式的迁移。`/spec-review` 是只读的 lint,按照文件类型分档去查必备段、代码示例、Why、过期、指针断裂、模板漂移,**并不会自动修复**。
- **目标用户**:主要是下游的 AI 工作流,`/workflow-plan` 把它当作 Spec 生成的 Constraints 输入;`/workflow-execute` 按照任务所在的 `{pkg}/{layer}` 自动注入 advisory;`/workflow-review` Stage 1 由人工来做对照。人读是副产品。

---

## 2. 维度对比

把三个方案按照"**谁来生成 / 写什么 / 怎么去更新 / 给谁来用 / 和代码的关系**"五个维度摆在一起:

| 维度 | Google CodeWiki | Qoder Repo Wiki | 本项目 code-specs |
|---|---|---|---|
| **生成主体** | AI 全自动 | AI 全自动(一键) | 人写为主,AI 引导 + 模板 |
| **写什么** | 代码**是什么**(模块/依赖/API) | 代码**是什么**(签名/端点/类) | **约束 + 契约**(风格/规则/字段合约) |
| **文档形态** | 分层 + 架构图 + 数据流图 | 结构化章节(未公开细节) | 二维骨架 + 两档模板(4 段/7 段) |
| **更新触发** | 随代码演进(未详述) | 代码变更检测 → 手动确认 | 学到新约定 → `/spec-update` |
| **更新方式** | 重新生成 | 重新生成 + 同步 | 增量追加 + 模板漂移迁移 |
| **和代码的关系** | 派生(代码 → 文档) | 派生(代码 → 文档) | 独立(文档定义代码必须满足什么) |
| **首要读者** | 人 | 人 + Agent | AI 工作流 + 人(次) |
| **一致性保证** | AI 重新生成 | 人点"更新" | `/spec-review` 只读 lint,人对照 |
| **规模** | 未公开 | ≤10K 行变更/次 | 无硬上限 |

看完这张表以后就能看出来一条核心的分界线:

- **"描述代码 vs 约束代码"**,CodeWiki 以及 Qoder 都在**描述**(代码长什么样),只有 `code-specs` 在**约束**(代码**必须**要去满足什么)。

这条线就决定了三者所要解决的问题根本就不是一回事。

---

## 3. 架构差异:两张图

### 3.1 CodeWiki / Qoder 的"代码 → 文档"派生模型

```
┌───────────┐     LLM      ┌──────────┐
│   代码库   │ ───────────▶ │ 生成的 wiki│ ──▶ 人读 / Agent 消费
└───────────┘  多轮 agent   └──────────┘
     ▲                           │
     │     代码变了,重生成         │
     └───────────────────────────┘
```

**优点**:几乎是零维护成本,对任何仓库都可以开箱即用。
**缺点**:
- 文档就是代码的**镜像**,代码里有什么它就有什么,代码里没表达的隐知识(为什么要这么做、这里不能那么改、历史上有谁踩过什么坑)它永远也写不出来。
- 一致性依靠"再跑一次"来保证,增量更新的粒度相对粗;在那种长期演进的项目里就会存在不同版本 wiki 并存的风险。
- 产出是"整块地生成",人要是想局部修补再合回去就比较麻烦。

### 3.2 本项目 code-specs 的"骨架 + 两档模板 + 人在环"模型

```
┌──────────────────────────────────────────────────────────┐
│ /spec-bootstrap                                           │
│   按 {pkg}/{layer}/ 铺骨架 + 栈模板拷主题文件              │
│   生成 00-bootstrap-guidelines 首任务 + .template-hashes  │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ /spec-update(交互)   ◀─────┐                              │
│   主题 fuzzy 匹配 → 追加 or 新建                           │
│   convention(4 段必备)/contract(7 段)两档选一             │
└──────────────────────────────────────────────────────────┘
           │                 │
           ▼                 │
┌──────────────────────────────┐      消费      ┌─────────────────┐
│ .claude/code-specs/           │ ─────────────▶│ /workflow-plan   │
│ ├ {pkg}/{layer}/{topic}.md    │               │ /workflow-execute│
│ ├ guides/                     │               │ /workflow-review │
│ └ .template-hashes.json       │               └─────────────────┘
└──────────────────────────────┘
           │  ▲                                   回写(spec_gap)
           ▼  │  读 Common Mistakes + Rules             │
┌──────────────────────────────────────────────────────────┐
│ /spec-review(只读 lint)                                  │
│   convention: 4 段 + code sample + Why                    │
│   contract: 7 段 + signature/tests 具体化                  │
│   stale / broken-pointer / 模板漂移                        │
└──────────────────────────────────────────────────────────┘
           ▲
           │  code_specs_impact 四档判定
           │  (spec_violation / spec_gap /
           │   contract_misread / spec_unrelated)
           │
┌──────────────────────────────────────────────────────────┐
│ /fix-bug(单缺陷)   /bug-batch(批量)                      │
│   Phase 1.2  按 {pkg}/{layer} 读对应 spec 激活经验库       │
│   Phase 4    每次修复定档 code_specs_impact + advisory     │
│   Phase 8    批量聚合:同一文件 ≥2 次 spec_gap → 强信号     │
└──────────────────────────────────────────────────────────┘
```

**每一块都不是随意加进来的**,下一节就会讲清楚为什么。

---

## 4. 本项目的五个设计决策(以及背后的 trade-off)

### 4.1 "人写"而不是"AI 生成"

**为什么**:code-specs 所要记录的是**代码不会说出来的那些话**,比如命名约定、被禁用的模式、踩过的坑、字段契约的 Why。这些信息在代码里面根本就不存在,让 AI 从代码里去"总结"出来的东西只能是伪信息。

Qoder 的 Repo Wiki 可以告诉你"这个函数签名是什么",可是它永远也不会告诉你"这个函数之所以长成这样,是由于上次某个同事踩了并发的坑"。

**代价**:前期是需要有人工投入的,一个新项目 bootstrap 完也只是骨架,后面还得靠 00-task 去引导一步一步地填。为此我们设计了这样几件事情:

- **Document Reality, Not Ideals**,模板里明着写"从本仓库挑选真实的代码,不虚构"。
- **渐进地填充**,`/spec-review` 把空 layer 改成 advisory 不计入问题数,避免一开始就把用户给吓退。
- **每一条 Rule 都必备"代码示例 + Why"**,这是两个硬性维度,在 review 里直接就卡住。没有这两样的规则就是空话。

### 4.2 "二维布局 {pkg}/{layer}/" 而不是扁平目录

**为什么**:扁平目录加上文件名元数据,在 single project 里是能跑起来的,可到了 monorepo 里就会出问题,同一个主题(比如 `error-handling`)在不同 package 的不同 layer 里做法完全不一样。

二维布局让 AI 在执行任务的时候只需要去读「当前改的文件所在的 `{pkg}/{layer}/index.md`」,天然地就把作用域收窄了。`codeSpecs.runtime.scope: "active_task"` 这个 v3 里新增的字段就是为此而来的,monorepo 项目就不会再出现"会话一启动就把整棵 spec 树都读进来"这种情况了。

**代价**:初始化的时候就得把 package 边界想清楚。我们的处理办法是这样的:

- 从 `codeSpecs.packages.include` 里显式地声明,或者自动扫描 workspace 之后让用户借助 `AskUserQuestion` 来确认"建议纳管 / 自动过滤"的清单。
- 有 `codeSpecs.packages.skipDefaultFilters` 兜底给那些不想用默认过滤的用户。

### 4.3 "两档模板"而不是单一模板

**为什么**:单一的轻量模板在写复杂契约的时候就不太够用了;反过来,contract 7 段模板搬过来写"命名约定"又太过设计了。

我们的切分方式是这样的:

- **Convention(4 段必备再加上可选扩展)**,Overview / Rules / DO·DON'T / Common Mistakes。**主力**,占到 80% 的场景。
- **Contract(7 段)**,Scope / Signatures / Contracts / Validation & Error Matrix / Good-Base-Bad / Tests / Wrong vs Correct。**只针对字段级的契约**(API 请求响应、DB schema、错误码矩阵)。

`/spec-update` 的决策规则是比较明确的:"代码风格 / 约定 / 组织" 走 convention;"字段级契约" 走 contract;"写代码之前想什么" 走 guide。不确定的时候优先选 convention。

**代价**:多出了一层选择。好在 `/spec-update` 的 Step 2 交互里把 6 类语义标签映射成"建议选用哪个模板"的表格,用户不用去死记。

### 4.4 "模板漂移治理"借助 `.template-hashes.json` 而不是依靠 local.md

**为什么**:早期的版本(v2.1 之前)依靠 `local.md` 的 Template Baseline 表去追踪模板版本,结果就是用户改没改 / 漏没漏根本就没法机器去校验。v2.2 切到了 `.template-hashes.json`(模板 sha256 加上 canonical version),`/spec-review` 就可以直接对账了。

v3 Stage C 还加上了 `planMigration` / `applyMigration`:

- 版本落后,并且 manifest 标了 `recommendMigrate: true` 的话 → 展示预览(chain / apply / skip / conflicts 条数),让用户来决定。
- conflicts 非空的话默认终止,不会自动合并。
- partial failure 的时候写入 `migrationStatus: "failed_partial"` 以及 `.migration-rollback.json`,强制 `/spec-update` 再跑的时候先走恢复路径。

**对比**:CodeWiki 以及 Qoder 的"重生成"模式,本质上就不存在模板漂移这个问题,因为它们的输出以及输入都攥在 AI 手里,每一次重刷的都是最新的。可代价就是上一版里的人工修改也一起都没了。我们选的路线是"人写 + 模板演进",那就必须要把漂移问题解决掉。

### 4.5 "声明式审查"而不是"机读硬卡口"

**为什么**:早期有人提过"要不要加上 frontmatter 让规则能机读,直接去 block 掉 AI 执行"。v2.2 最后选了反向:**不做**机读规则、**不做**硬卡口,审查 100% 走人工的对照。

理由是这样的:

- 编码约束本质上就是自然语言,强行机读总会有误判;一旦 block 上线,人就会开始绕过去写 hack。
- AI 执行的时候把 code-spec 当作 **advisory** 注入,由当前模型自己来判断要不要去遵守,reviewer 人工在 `/workflow-review` Stage 1 做对照。
- `/spec-review` 只输出报告,不会去修文件,用户自己来决定是否要触发 `/spec-update` 去把缺口补齐。

---

## 5. AI 编程场景下,code-specs 相比 CodeWiki 的优势

前面讲的是架构层面上的差异。到了 AI 编程这个具体场景,也就是让 LLM/Agent 来写代码、改 bug、做重构这件事情,两者的分工以及局限就会看得更清楚。下面这五条就是 code-specs 相比 CodeWiki 在"AI 编程"场景下的实际优势。

### 5.1 CodeWiki 描述事实,code-specs 规定行为

AI 在写代码的时候真正需要的并不是"这个函数现在长什么样"(它自己 grep 一下就知道了),而是"**下一次写类似的函数应该长成什么样**"。

- CodeWiki 所有的产出都是对当前代码的描述:architecture diagram / class diagram / sequence diagram / 模块说明。AI 读完以后知道代码是什么,可是并不知道**边界**在哪里,哪些写法被禁止了、哪一种 pattern 是这个项目的首选、某个历史决策的 Why 是什么。
- code-specs 里每一条 Rule 都含有 `Why:` 以及 Bad/Good 对比,Contract 模板还明确要求 Tests Required 指向具体的测试文件。AI 读完以后就知道写代码的边界到底在哪里。

举个具体例子:CodeWiki 上的 gemini-cli wiki 能够告诉你"`packages/core/src/tools/` 下面每一个 tool 导出一个 `declaration` 以及 `invocation`",但它并不会告诉你"新增 tool **必须** 在 `tools.test.ts` 里加上一条 denylist 校验,否则安全的 reviewer 就会打回来",这种约束只存在于团队共识里,就必须要有人把它写进 code-spec 里去。

### 5.2 隐知识在 CodeWiki 里存不下来

AI 编程最大的翻车点就是隐知识,就是那些"代码没写,但不能违反"的东西。典型的场景:

| 类型 | 例子 | CodeWiki 能抓到吗 | code-specs 怎么处理 |
|---|---|---|---|
| 历史陷阱 | "这里不能用 async,上次并发挂过" | ❌ 代码里看不出来 | Common Mistakes 段,配上 Bad/Good 对比 + Why |
| 跨层契约 | "前端 `userId` = 后端 `user_id`" | ⚠️ 需要看两边才能推断,还可能推错 | contract 模板的 Contracts 段,显式字段映射表 |
| 长期规约 | "全项目禁用 lodash,用原生替代" | ❌ 现状是部分用了部分没用,AI 会被误导 | conventions.md 的 DON'T 段 + 迁移指引 |
| 产品意图 | "这个错误不能静默,必须上报" | ❌ 代码里只有 try/catch | Validation & Error Matrix 段,每条输入条件映射到明确的行为 |

Google 自己在 CodeWiki 的 Gemini CLI extension 里加上了"私有仓库加上内部文档"这个卖点,就说明他们自己也已经意识到公有 wiki 覆盖不了企业的知识。可是 extension 仍然是把更多的代码喂给 LLM 去重生成,并没有去解决"代码里压根就没写的东西"这个根本问题。

### 5.3 AI 消费的粒度:整本 wiki vs 任务相关的 {pkg}/{layer}

CodeWiki 面向的是**人读**,所以它倾向于整块地生成一份完整的 wiki。这在 AI 编程里反倒成了一种负担:

- AI 改一个后端的字段,没必要把整份前端架构图都读进上下文里,那就是无效的 token。
- Monorepo 里有十几个 package,AI 没办法从一整份 wiki 里精确地定位到"当前任务相关的约束"。

code-specs 的 `{pkg}/{layer}/` 二维布局再加上 v3 的 `codeSpecs.runtime.scope: "active_task"` 就把这个问题给解决了:

- 工作流 hook 按照 active task 的 `package` 自动地把 code-specs 读取范围收窄掉,会话启动的时候不会去读整棵树。
- `{pkg}/{layer}/index.md` 里还有 Task Profiles(new-feature / bugfix / performance),按照任务类型进一步收窄到本次必读的 guideline 文件。

实际的效果是:Agent 打开任务的时候只带着"本次要改的 package + layer + task type"对应的那几份 spec 进入执行阶段,上下文比较干净,指令也比较明确。

### 5.4 执行链路的三段式接入,不只是"有一份文档"而已

CodeWiki 的定位就是"一个 wiki 页面",集成点只有两个,人打开网页来看、Gemini Chat 回答问题。AI 在自主编码的时候要怎么去用它呢?基本上只能靠 RAG 检索来拼上下文。

code-specs 直接就嵌在了工作流的三个阶段里:

- **`/workflow-plan`**:生成 Spec 的时候去读相关的 `{pkg}/{layer}/*.md` 来当作 Constraints 输入,让 plan 本身就带着约束走。
- **`/workflow-execute`**:PreToolUse(Task) hook 按照 active task 自动注入 scoped context;没有活跃 workflow 的时候 SessionStart hook 注入 overview,改代码的时候再按照路径反推去读对应的 `{pkg}/{layer}/index.md`。
- **`/workflow-review`** Stage 1:人工对照实现以及 code-spec,偏差就当作 review 的显式条目。

每一个阶段读什么、什么时候读、读到哪一层,都是由工作流来决定的,不需要用户每次去手工 @ 文档。

#### 5.4.1 code-specs 的五个注入时机

上一节说"hook 自动注入",这里把触发点拆开来讲清楚,这样才能看出来 code-specs 和 CodeWiki 在"AI 上下文"这件事情上根本上的区别。code-specs 的注入由两个官方 hook、加上一个约定规则、再加上两个 skill 显式读取共同覆盖:

| 触发时机 | 触发者 | 注入什么 | scope |
|---|---|---|---|
| **① 会话启动** | `SessionStart` hook(`session-start.js`) | code-specs 概览 / 或 paths-only / 或 scoped 主题块 | 按 `codeSpecs.runtime.scope` 来决定:`active_task` → 当前任务 package;allowlist → 命中包;`null` → 全树兜底;`scopeDenied` → 空段加上原因提示(不会回退全树) |
| **② 主会话 Task 派发前** | `PreToolUse(Task)` hook(`pre-execute-inject.js`) | task block + spec + quality gate + scoped code-specs(digest) | 按 active task 的 `package` + `layer` 收窄,附上 `changedFileHints` 作为进一步缩小的提示 |
| **③ Subagent 派发前** | 同上 hook,按 `subagent_role` 分支 | `implement` / `general-purpose` → full task + spec + scoped digest;`research` / `Explore` / `Plan` → 只给 paths-only 清单 | 执行型 subagent 按 task scope;研究型只给路径不给正文,避免浪费 token |
| **④ 无活跃 workflow,Edit/Write 前** | 约定规则(CLAUDE.md 规定) | `{pkg}/{layer}/index.md` + 其 Pre-Development Checklist 点名的 spec 文件 | 按即将改动的文件路径反推 `{pkg}/{layer}`,本会话首次读,后续跳过。单行修复 / typo / 纯研究豁免 |
| **⑤ Bug 修复流程** | `/fix-bug` Phase 1.2、`/bug-batch` Phase 3 | 按根因模块 `{pkg}/{layer}/index.md` + 对应 convention/contract 的 **Common Mistakes + Rules** 段 | 单文件 200 行预算;未命中或目录不存在就记录"未覆盖",不阻断 |

几个关键的设计点:

- **精度优先,不去灌满上下文**:hook 在 monorepo 首次 bootstrap 的时候默认把 `codeSpecs.runtime.scope` 写成 `"active_task"`,会话启动的时候就不再把整棵 spec 树都读进来;单包项目才保持全树兜底。
- **paths-only 降级**:scope 解析到了 denied(比如 active task 的 package 不在 allowlist 里),hook **不会**静默地回退到全树,而是输出空段加上原因,让 AI 以及用户都能够看到"这一次没给你注入 spec,因为 scope 不允许"。
- **研究型 subagent 只给路径**:Explore / Plan / research 这类 subagent 派发的时候只注入 paths-only 清单,不塞正文进去。让它知道"哪儿有约束,要用的时候自己去读",不是一开始就吞掉 20 个文件的原文。
- **无 workflow 场景的兜底**:CLAUDE.md 里面显式规定"改代码之前按照文件路径反推读对应的 index.md",这是一条 AI 自觉去执行的约定,并不依靠 hook,覆盖掉"随手改两行"这种并不启动工作流的场景。

对比 CodeWiki:它没有"注入时机"这个概念,是因为它并不参与 Agent 的 tool 调用链。AI 想要去用 CodeWiki 的内容,要么人打开网页看完再喂给 AI,要么走 RAG。前者是手工操作,后者的相关性取决于 embedding 的质量。code-specs 这五个注入点是**系统级的、确定性的**:会话启动的时候一定会注入、Task 派发之前一定会注入、Edit 之前一定会反推去读,AI 不需要"记得"去查,也不会"忘了"去查。

### 5.5 修补闭环:Bug 修复流程原生联动 code-specs

AI 编程典型的失败循环就是"反复地在同一个地方犯同一个错"。CodeWiki 的更新机制是"代码变了就重生成",可是 AI 写错被人工打回的时候代码可能根本就还没 commit,CodeWiki 就看不到这一次的教训。本项目的 `/fix-bug` 以及 `/bug-batch` 这两条 skill 把 code-specs 直接嵌进了 bug 修复的 4 个 Phase 里,形成了"读 spec → 修 bug → 判定影响 → 按照信号回写"的闭环。

**Phase 1.2 定位阶段:激活本层的经验库**

修复任何一个 bug,都要先按照问题代码所在的目录反推出 `{pkg}/{layer}`,然后:

- 去读 `.claude/code-specs/{pkg}/{layer}/index.md` 的 Guidelines Index,按关键词匹配到具体的 convention/contract 文件。
- 读该文件的 **Common Mistakes** 以及 **Rules** 段(单文件 200 行预算)。
- 未命中或者 code-specs 目录不存在的时候 → 记录"未覆盖该模块",不阻断流程。

这一步会让 bug 修复一开始就带着"同类的坑以前是怎么踩的"进入分析,不是 AI 从零开始推理。

**Phase 4 审查阶段:必填 code_specs_impact 四档**

审查完成、状态流转之前,主会话**必须**对本次的根因以及 code-spec 的关系显式地去定档,四档里必选一种:

| 档位 | 含义 | advisory 要求 |
|---|---|---|
| `spec_violation` | 违反了已有的 Common Mistake / Rule | 指出具体段落路径 `{pkg}/{layer}/{file}.md § {H3 子标题}`,附上"code-spec 已经明示,但未被读取或未被遵守,建议追溯流程断点" |
| `spec_gap` | spec 里未覆盖这种情况 | 预填 Common Mistake 草案(Bad/Good + Why)+ 一句"建议运行 `/spec-update` 去写入 `{pkg}/{layer}/{file}.md` 的 Common Mistakes 段" |
| `contract_misread` | 误读了 contract 文件的字段 / 错误码 | 指向 contract 的 `§ Validation & Error Matrix` 或 `§ Wrong vs Correct` |
| `spec_unrelated` | 环境/第三方/偶发的,和 spec 无关 | advisory 留空,避免"每次都要动 spec"的仪式感 |

`.claude/code-specs/` 整个目录不存在的时候就统一判成 `spec_unrelated`,没有 spec 结构的时候"缺口"这个概念就不成立了,强行判 `spec_gap` 会产出虚假的 advisory。

**/bug-batch Phase 8:批量聚合出强信号**

批量修 bug 的时候,每一个 FixUnit 都会在单元级的 review 阶段附上 `code_specs_impact` 字段。Phase 8 就直接消费这些字段去做聚合:

- 同一个 `{pkg}/{layer}/{file}.md` 被 **2+ 个 FixUnit** 标成 `spec_gap` 的话 → 输出强信号 advisory:"本批次 FU-xxx / FU-yyy 共享根因指向 `{file}.md`,该文件缺少对应的 Common Mistake。建议运行 `/spec-update` 去归纳一下。"
- 单发的 `spec_gap` / `contract_misread` 只在单元视图里保留,不升级为批量 advisory。这个 2 次的阈值是刻意设计的,避免每修一个 bug 就提示一次 `/spec-update` 造成疲劳。

**闭环的关键差异**

和 CodeWiki 的"代码变了就重生成"比起来,这个闭环的核心维度在于:

- **输入并不只是代码,还包括"本次 bug 的根因以及 review 结论"**,这个信息 CodeWiki 的派生模型本质上就拿不到。
- **advisory 不是"建议读更多",而是具体到"把这段 Bad/Good 草案写进哪个文件的哪一段"**,草案在主会话里已经拟好了,用户只需要确认以后触发 `/spec-update` 去落盘。
- **强弱信号分开**,单次触发弱信号(单元视图),多次聚合出强信号(批量 advisory),契合人类对"这事真的是个规律"的判定阈值。

这就是 CodeWiki 派生模型本质上做不到的,**它的输入只有代码,并没有"人在 review 里说的话"这个维度**。

### 小结

| 维度 | CodeWiki 的角色 | code-specs 的角色 |
|---|---|---|
| 代码**现状** | ✅ 自动、全面、视觉化 | ❌ 不做 |
| 代码**边界** | ❌ 表达不出"不能这么写" | ✅ Rules + DO/DON'T + Common Mistakes |
| 隐知识 | ❌ 代码里没有的写不出来 | ✅ 人写,Why 必填 |
| AI 上下文粒度 | ⚠️ 整本 wiki | ✅ scope 收窄到 `{pkg}/{layer}` + task profile |
| 工作流集成 | ⚠️ 网页 / Chat | ✅ 5 个注入时机(SessionStart / PreToolUse Task / subagent / 路径反推 / fix-bug Phase 1.2) |
| 学习闭环 | ❌ 代码没变就没新内容 | ✅ `/fix-bug` 四档判定 + `/bug-batch` 批量聚合 → `/spec-update` 回写 |
| 跨仓、新人入门 | ✅ 这是它最强的场景 | ⚠️ 骨架期是要人工填的 |

**结论**:两者并不是替代的关系。CodeWiki 擅长把代码的**现状**讲给人听,code-specs 擅长把代码的**边界**讲给 AI 听。AI 编程这个场景下前者是 nice-to-have,后者就是 must-have,因为 Agent 在执行代码任务的时候真正需要的是约束,不是描述。

---

## 6. 什么场景该选哪个

| 你的需求 | 推荐 |
|---|---|
| 把一个陌生的 10 万行仓库让新人 3 天上手 | **CodeWiki** / **Qoder Repo Wiki**,代码 → 文档派生,基本零维护 |
| AI IDE 里让 Agent 回答"X 是怎么实现的"这种代码理解型问题 | **Qoder Repo Wiki** 或者类似的 RAG 方案 |
| 跨年迭代的项目,想沉淀踩坑经验以及约定 | **本项目 code-specs**,`/spec-update` 写到 `{pkg}/{layer}/` 里 |
| Monorepo,前后端多包多层,想让 AI 写代码的时候自动去遵守每个包的约定 | **本项目 code-specs**,二维布局 + scope 自动收窄 |
| 字段级 API / DB 契约,需要配对 Tests Required 和 Error Matrix | **本项目 code-specs contract 模板** |
| 项目还比较早期,不想预先投入写规范 | **CodeWiki** / **Qoder** 先生成一版派生文档当草稿 |

这些方案并不是互斥的。实际工程里一个比较合理的组合是这样的:

- 借助 CodeWiki 这类产品产出"代码是什么"的派生文档,放在 wiki 或者 IDE 里面给人以及 Agent 来查;
- 借助 code-specs 去写"代码必须满足什么"的约束,放进 AI 的执行链路里去。

一个负责描述、一个负责约束,角色的分工就很清楚了。

---

## 7. 本项目 code-specs 的独特价值,一句话版本

> **CodeWiki / Qoder 回答的是"这段代码是什么",而 code-specs 规定的是"代码必须满足什么",并且直接喂给下游的 AI 工作流,在 plan / execute / review 三个阶段里各自起作用。**

派生文档可以给你一张代码地图,可是 AI 在地图上走路的时候,需要有人来告诉它"这一条路左边有坑、右边靠右",这就是 code-specs。

---

## 附:资料来源

- Google CodeWiki:arxiv 2510.24428(ACL 2026)"CodeWiki" 论文、Google Developers Blog "Introducing Code Wiki: Accelerating your code understanding"、codewiki.google 官网、示例页 codewiki.google/github.com/google-gemini/gemini-cli、Gemini CLI extensions(geminicli.com/extensions)。
- Qoder Repo Wiki:docs.qoder.com/zh/user-guide/repo-wiki。
- 本项目:core/skills/spec-{bootstrap,update,review}/SKILL.md、core/skills/fix-bug/SKILL.md、core/skills/bug-batch/SKILL.md、core/specs/spec-templates/、core/hooks/session-start.js、core/hooks/pre-execute-inject.js。
