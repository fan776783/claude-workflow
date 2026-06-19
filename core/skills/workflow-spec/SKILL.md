---
name: workflow-spec
description: "Use when 用户调用 /workflow-spec, or 提出新需求要走完整 spec → plan → execute workflow, or 用户描述\"完整需求规格 / spec → plan → execute / 跨 module 新需求\"等场景。简单任务请用 /quick-plan。"
argument-hint: "[-f] <需求描述 | 文件路径 | URL>"
disable-model-invocation: true
---

> 路径 convention + CLI 写入 contract 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。

# workflow-spec

<HARD-GATE>
1. Spec 未经用户确认,不得进入 Plan 扩写
2. 讨论结果必须写入 spec.md § 9 对应章节,不得仅在对话中存在
3. 禁止 Write 全量覆盖 spec.md / plan.md;禁止删除/重命名 YAML front matter 字段
</HARD-GATE>

> 🔧 自愈例外:会话丢失重建 state 时,CLI `init` 按 spec 文件存在性推断审批状态(`system-recovery` 标记,非用户主权审批)。仅限执行期,规划期不得触发。

## Checklist

1. ☐ 解析参数 + 基础设施预检 + Code Specs 读取
2. ☐ 代码库分析(强制)
3. ☐ 需求讨论(条件)
4. ☐ Spec 文本扩写(在 CLI 骨架上)+ Self-Review(核心章节)
5. ☐ 🛑 用户审批(含设计深化路由 + 决策)+ 规划完成

---

## Step 1: 参数解析 + 预检

**参数格式**:
- 内联需求:`/workflow-spec "实现用户认证功能"`
- 文件需求:`/workflow-spec docs/prd.md`(自动检测 `.md` 文件存在)
- 外部文档 URL:`/workflow-spec https://alidocs.dingtalk.com/...`(见下方 URL 路由)
- 强制覆盖:`/workflow-spec -f "需求"`

**URL 路由**(输入为 URL 时,先获取内容再继续 Step 2):

| URL 模式 | 路由目标 |
|---|---|
| `alidocs.dingtalk.com` | 调用 `/alidocs` skill 读取文档内容 |
| 其他已知平台 URL(飞书/Notion/Confluence) | 调用对应 MCP 或 skill |
| 通用 URL | WebFetch 兜底 |

读取完成后,将文档内容作为 PRD 原文传入后续步骤,不再重复请求用户粘贴。

**轻量化路径**:单次只读取外部文档时,直接用 Bash 调对应 CLI(如 alidocs CLI `dingtalk-mcp.mjs doc get_document_content`),不加载整个 `/alidocs` skill;仅在 auth/config 报错时再升级到 skill。

**预检**(4 项细节详见 [`../../specs/workflow-runtime/preflight.md`](../../specs/workflow-runtime/preflight.md):Git 状态 / 项目配置 / workflow 状态 / projectId 获取——`project.id` 直读不重算,缺失或无效引导 `/scan`)。两条 preflight.md 未覆盖的纪律必须遵守:

- **单次 Bash**:4 项预检(git status + 读 project-config + ls workflow 目录 + 读 state)合一次 Bash,禁拆多次往返。
- **config 防误报**:配置**固定**在 `.claude/config/project-config.json`(**非仓库根**;禁止 `cat project-config.json` 在根目录找,会误报"不存在")。

参考命令:

```bash
git status --short 2>&1; echo "---PC---"; cat .claude/config/project-config.json 2>&1; echo "---WF---"; ls -la ~/.claude/workflows/ 2>/dev/null || echo "no workflows dir"
```

### 预检通过后:强制调用 `workflow_cli.js plan`

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" plan "<原始需求或 PRD 路径>" \
  --task-name "<语义化中文需求名>"
```

CLI 此刻会落盘:
- `workflow-state.json`(status=`spec_review`)
- `spec.md` 骨架(带模板 front matter)— **plan.md / task-dir 不在此时生成**
- `ux_gate_required` 标记(仅当涉及 UI 关键词或检测到前端框架时为 true)

**文件命名**:落盘格式 `<slug>-<MMDD>.md`。每次必须传 `--task-name "<需求中文名>"`——主会话从需求拟一个 4-20 字的中文名词短语(如 `项目所属成员组与迁移`),禁止 hash 文件名。

**spec approve 落点(task 源)**:Step 5 approve 时 CLI 落 task-dir 元数据壳(`tasks/{taskId}/` 下 task.json,**无占位 body**)+ 推 `status=planned`;`current_tasks[0]=firstTaskId` 作 resume 起点。**最终 task 粒度/ID 不在此预定**,留给 `/workflow-plan` 现写阶段按 implementation slice 定(详见 Step 5 CLI 调用 + workflow-plan Hard Gate #3)。

**spec.md 落点**:默认 `<project-root>/docs/workflows/specs/<slug>-MMDD.md`(team 可见,可入 git)。`project-config.json` `workflow.specDocsRoot` 可改根目录;`workflow.legacySpecLocation: true` 时回退 `~/.claude/workflows/{pid}/specs/`。plan.md / state / 其它工件仍在 user 级 `~/.claude/workflows/{pid}/`。

**后续 Step 的 contract**:
- Step 2-3 不是"从零写 JSON 工件",而是**读取骨架按 canonical schema 填值**
- Step 4 在 spec.md 骨架上 Edit 扩写;禁止 Write 全量覆盖,禁止删除/重命名 front matter 字段(`version` / `requirement_source` / `created_at` / `status` / `role`)

**错误处理**:
- CLI 返回 `已存在未归档工作流` → 回到预检 Step 3 让用户选择 archive / 恢复 / `--force` 覆盖。**不得改用 `init` 子命令**
- 其他错误 → 直接展示给用户,不自行推进

## Step 1.1: Code Specs 读取(advisory)

将 `.claude/code-specs/` 作为 Constraints 参考:
1. 目录存在 → `getCodeSpecsContextScoped()` 按当前 plan 推断的 package 读取子树,汇总成 Constraints 摘要
2. 目录不存在且 `project-config.json` 中 `codeSpecs.bootstrapStatus !== 'skipped'` → 输出 advisory:`💡 未检测到项目 code-specs,建议执行 /spec-bootstrap 建立骨架并用 /spec-update 沉淀规范。`
3. 不阻塞 workflow,不修改任何文件

> code-specs 过期 / 漂移 / 模板检测走 `/spec-review`(其 stale 检测是 spec 阶段巡检的严格超集);本 skill 不另跑 git mtime 巡检。

## Step 2: 代码库分析(强制)

**宣告**:`📊 Phase 0: 代码分析`

提取:
1. **相关文件** — 可复用或需修改的现有实现
2. **可复用组件** — 可继承的基类、工具类
3. **架构模式** — 相似功能的实现参考(如 Repository Pattern、Error Boundary)
4. **技术约束** — 数据库、框架、规范、错误处理模式
5. **依赖关系** — 内部和外部依赖

**subagent contract**:代码分析建议起 1 个只读 subagent。subagent 报告**必须包含每个受影响 API/类型的请求/响应 interface 定义原文(字段名+类型)**,使主会话无需再 Read autogen / 类型文件。subagent 未给 contract 形状 → 补问 subagent,不在主会话 Read 大文件。

**持久化**:分析结论直接编入 Step 4 扩写的 spec.md 对应章节,不落独立工件:
- `relatedFiles[]` → §6 File Structure(标注 reuseType `modify|reference|extend`)
- `reusableComponents[]` → §5.1 Architecture(列为可复用 module)
- `patterns[]` → §5.1 Architecture(架构模式参考)
- `constraints[]` → §3 Constraints
- `dependencies[]` → §1 Context(内/外部依赖说明)

主会话只在内存中持有分析结果到 Step 4 扩写完成,不做 Write,不做 Read 回读校验。

**contract-digest 落盘(强制)**:代码分析的 contract——受影响文件 + 关键签名 + 共享 store/type shape——distill 到 ~3000 字符,写 `~/.claude/workflows/{pid}/contract-digest.md`(章节:受影响文件清单 / 关键签名 / 共享 store·type shape)。落盘后调:

```
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js set-contract-digest-path --path <contract-digest.md 绝对路径>
```

Explore/代码分析报告**不整篇进主会话**:主会话只持落盘确认 + 一行短摘要(指向 contract-digest.md),全文留在 disk 经 hook→execute subagent 注入。digest 硬截断由读时保证,写侧只给 ~3000 字符目标值(contract/spec/code-specs 三者语义边界见 Step 5 handoff 注)。

## Step 3: 需求讨论(条件)

**宣告**:`💬 Phase 0.2: 需求讨论`
**跳过条件**:内联需求 ≤100 字符且预分析无待澄清项。

### 质询纪律

走决策树每个分支,一次一个问题,每问带推荐答案。能在代码/已有工件中查到的不问用户。

**读代码抓矛盾**:用户陈述某处行为时读代码比对,口述与实现矛盾当场指出,不默认信任用户说法。

**场景压力测试**:讨论领域关系/概念边界时,编造戳边界的具体场景(异常/极端 case)逼用户精确化,不停留在抽象定义。

**单通道**:澄清问题走 `AskUserQuestion` 时就不再用 text 复述问题原文(选项 label 已承载问题),避免同一内容双份输出。

**选项构造规则**:
- 每题选项必须沿**同一决策维度**排列,不得在 (A)(B)(C) 间混用正交维度(如"范围 in/out × 实施时机 now/blocked")
- 正交维度若必须问,拆为两题: 先问范围(Q.a),再问时机(Q.b)
- 反例: `(A)包含,现有接口 (B)包含,等后端 (C)不包含` — 混了范围(in/out)和时机(now/blocked),用户需 cross-reference
- 正例: 先 `Q1 范围: (A)包含 (B)不包含`;若 Q1=A 再问 `Q1.1 接口: (A)现有 (B)新接口`

### 讨论范围

基于 Step 2 代码分析识别待澄清项。典型关注点:
- 范围边界(in/out-of-scope 的灰色地带)
- 行为定义(正常 + 异常 + 边界场景)
- 技术约束冲突(PRD vs 现有架构)
- 外部依赖就绪度

**不逐维度过**。只讨论真正有歧义的点。无歧义的直接写入 spec,不确认。

### 被拒需求扫描

检查项目根 `.out-of-scope/`(协议见 `core/specs/shared/out-of-scope-protocol.md`):
- 与当前需求相关的记录 → 编入 spec.md §3 Constraints,标注 `[out-of-scope]` 前缀
- 讨论时如触碰到 out-of-scope 边界 → 主动告知用户

### 分流

- 阻塞 Spec 生成的决策 → AskUserQuestion(逐个,每题带推荐 + why)
- 交互细节级 → 写入 spec § 9.1 附 self-recommended,不阻塞
- 非功能性 → 仅在 § 9 风险章节留痕

### 术语挑战

走 `core/specs/shared/domain-modeling-protocol.md` 统一协议——术语冲突当场指出 / 模糊词提议 canonical / glossary inline 更新 / ADR 三重门槛判定。

### 方案探索(条件)

仅在存在互斥实现路径或显著技术 tradeoff 时触发。确认的技术选型反写到 `project-config.json`。

### 持久化

讨论结果写入 spec.md § 9(§ 9.1 需求澄清记录、§ 9.2 方案选择、§ 9.3 未解决依赖)。不得仅依赖对话上下文记忆。

§ 9.2 中的决策命中三重门槛 → 建议落 ADR,不自动创建。判定 + 落盘走 `core/specs/shared/domain-modeling-protocol.md § ADR 提议`。

## Step 4: Spec 文本扩写 + Self-Review(核心章节)

**宣告**:`📘 Phase 1: Spec 扩写`

> **仅 revise 回环重入本 Step 时**(审批后改 Spec 再回来)跑一次 `workflow_cli.js status` 确认 `workflow_status=spec_review`,异常回 Step 1 调 `plan` 重建骨架。前向路径无中间状态变更,不另做健康检查。

**扩写硬约束**:
- 不得改动模板章节标题或锚点;只在正文内 Edit 扩展
- **§ 4.4 UX & UI Design 不在本 Step 填写**,留给 Step 5 前端设计深化

**输入**:需求(PRD 或内联)+ Step 2 代码分析结论(主会话内存)+ `.claude/code-specs/` 相关规范文件。
**输出**:在 `<project-root>/docs/workflows/specs/{task-name}-{MMDD}.md`(默认)骨架上 Edit 扩写。legacy 模式落点 `~/.claude/workflows/{pid}/specs/`。

**覆盖范围**:§1 Context / §2 Scope / §3 Constraints / §4.1-4.3 User-facing Behavior / §5.1-5.5 Architecture / §6 File Structure / §7 Acceptance Criteria / §8 Implementation Slices / §9 Open Questions。§4.4 由 Step 5 路由。

### Self-Review(生成后立即执行)

发现问题直接修复,无需重审。必须输出执行摘要:覆盖率 + 空章节扫描 + 一致性结果。

> **上下文纪律**:spec 正文在 Step 4 Edit 时已进主上下文,self-review 与 Step 5 审批对照**不再 Read spec.md 全文**;需复查具体章节按 anchor / offset 局部读,省主上下文。

**1. PRD 原文回溯扫描** — 将 PRD 原文按标题层级 + 列表项拆为语义段落,逐段检查 Spec 是否覆盖。重点关注:
- 包含**精确值**的段落(数字、公式、枚举、"最多N个")— 数字必须原样保留
- 包含**否定约束**的段落("不支持"、"禁用"、"不可")— 否定语义不得遗漏
- 包含**联动关系**的段落("根据…拉取"、"条件展示")— 联动逻辑不得被简化
- 包含**改造指令**的段落("改名为"、"替换"、"重命名")— 改造细节不得被概括

未覆盖的精确值/否定约束/联动关系/改造指令段落追加到 §9 Open Questions。不计算百分比。

**2. 空章节扫描** — 空的章节或未填写的模板变量替换为实际内容。占位硬门(TBD/TODO/中文占位/未渲染 `{{}}`)由 CLI `spec-review` 的 `lintPlaceholder` 兜底(见 Step 5),**不要**人工扫 `待确认`——CLI 故意排除它(spec §9 open question 合法使用)。

**3. 内部一致性** — Architecture 章节的 module 划分是否与 User-facing Behavior 的操作路径一致;File Structure 是否与 Architecture 的 module 对应。

**4. 约束完整性** — 需求中的硬约束(字段名、数量限制、条件分支等)是否都在 § 3 Constraints 出现;讨论确认的技术决策是否体现在 Architecture 中。

**5. 首次使用体验** — 涉及工作区/初始化/应用安装等概念时,是否有首次使用引导描述。

> §4.4 一致性由 `/ux-elaboration` 内部 Self-Review 覆盖(仅 Step 5 选前端深化时触发),本 Step 不涉及。覆盖率即时计算不持久化。

## Step 5: 🛑 用户审批 + 规划完成

**Phase 编号**:2 — Human Gate
**治理模式**:`human_gate` — 用户主权确认。

**设计深化路由(仅判断展示,不执行)**:`ux_gate_required=true` 时推荐前端设计深化(`/ux-elaboration` → §4.4);`ux_gate_required=false`(纯 CLI / 工具类)或 spec ≤3 page(§4.1-4.3 inline 即可)时无需。**此处仅判断并展示推荐;设计深化执行须待用户在审批时显式选择「先做前端深化」**——对齐 HARD-GATE #1(未经用户确认不得推进),不得在审批前自行调 `/ux-elaboration`。`ux_gate_required` 由 Step 1 `plan` 落盘。

**不调 AskUserQuestion**(同 `/quick-plan`、`/diagnose`、`/collaborating-with-codex`)，让用户自由回复后归一化(审批轴 approve/revise/split × 路由轴 plan-only/前端,modal 装不下)。

**展示内容**(输出后等用户回复,**不弹 modal**):

主会话默认仅输出指针 + 决策依据,不重复 spec 内容:

```
📘 Spec 已生成 → <spec.md 绝对路径>
PRD 覆盖率: <✅ 完整 | ⚠️ 待补 §9.X | ❌ 缺 §9.Y>
设计深化推荐: <前端 | 无需> (尚未执行)

请打开 spec.md 与需求原文逐段对照后回复:
- 通过 → 「生成 Plan」/「OK」
- 通过 + 先做设计深化 → 「先做前端深化」
- 改 Spec → 直接说改哪里(如「§5.2 拆细」)
- 拆范围 → 「拆」

(若不便切文件回复「展开摘要」获取完整 Scope/Constraints/Acceptance 摘要)
```

**覆盖率符号**(展示内容必须遵守):✅ 完整 / ⚠️ 待补全(含原因) / ❌ 未覆盖。

**「展开摘要」兜底**(用户回复后才输出):

只在用户显式回复「展开摘要」/「show summary」/「fallback」时输出,不默认展示:
- Scope 段使用文本标签 `[in]` / `[out]` / `[blocked]`(**不**用 ✅/❌,避免与覆盖率符号双义)
- Constraints 摘要(逐条列硬约束)
- Acceptance Criteria 摘要(逐条列验收条件)
- Self-Review 执行摘要(覆盖率 / 空章节 / 一致性结果)

**review 时必须将 spec.md 与需求原文逐段对照**,不能只依据摘要判断。「展开摘要」是 fallback,不是决策依据。

### 用户回复归一化

| 用户回复(示例) | 归一化路径 |
|---|---|
| "OK" / "通过" / "生成 Plan" | approve 分支,canonical `Spec 正确，生成 Plan` |
| "改 §X" / "再扩一下" / "Spec 要改" | revise 分支,canonical `需要修改 Spec`(细节缺失走 `缺少需求细节`) |
| "页面结构不对" / "页面层级要调整" / "§4.4 重排" | revise 分支,canonical `页面分层需要调整` |
| "缺用户流程" / "没有 user flow" / "补流程图" | revise 分支,canonical `缺少用户流程` |
| "拆" / "范围太大" / "拆开" | split 分支,canonical `需要拆分范围` |
| "先做前端深化" | elaborate-then-approve,委托 `/ux-elaboration` 后回到 Step 5 |
| 直接调用 `/workflow-plan`(无文字回复) | **隐式 approve**:先输出一行 "未见显式回复,按 `/workflow-plan` 调用视为通过 spec 审批",再走 approve 分支 |

**模糊回复**(如"看着办" / "你决定")→ 不归一化,反问用户具体走哪条。

> 归一化目标字符串**以 `planning_gates.js` `mapSpecReviewChoice` 为准**(共 7 个 key,快速参考见 workflow-cli.md)。**禁止把用户原话直接塞给 `--choice`**。

### 设计深化分支(仅 elaborate-then-approve)

用户选「先做前端深化」→ 调用 `/ux-elaboration` skill。

> 委托时**不向 ux-elaboration 传设计源参数**——PRD 中的图片/URL 不一定是布局参考,需要人在深化 skill 内部显式策展。

委托完成后,深化 Self-Review 由各独立 skill 内部执行。执行完毕**重新输出 Step 5 指针**,等用户再次回复 → 进入 approve / revise / split 分支。

二次输出**复用首轮模板**:标题换「Spec 第二轮审批 — 深化已并入 §4.4」,提示行指向 spec.md §4.4 与首轮版本对照(首轮章节未变更)。**二轮回复选项收窄为 通过 / 改 §4.4 / 拆范围——不再提供「先做前端深化」(深化已完成,避免循环),「改 Spec」收窄为「改 §4.4」**。深化章节为 §4.4;「展开摘要」兜底只展示本轮新增/修改章节,首轮折叠为一行 "未变更"。若需像素级 UI 还原 → 走 /figma-ui(执行期)。

### CLI 调用(approve / revise / split 时)

**approve 占位防线已 CLI 化**:`spec-review` approve 自带 spec 占位校验(机制见 workflow-cli.md),命中返回 `reason: spec_placeholder` + `placeholder_hits` 并拒绝 approve——skill 层无需重扫,按 `placeholder_hits` 回 Step 4 补全后重调。核心章节内容质量(非占位但过简)仍由 Step 4 Self-Review 人工把关。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" spec-review --choice "<canonical 字符串>"
```

approve 分支 CLI 落 task-dir 元数据壳(无占位 task body) + `current_tasks=[firstTaskId]`,状态推进到 `planned`。**不预渲染占位 task 列表、不锁定最终 task 粒度**——真实 task 切分由 `/workflow-plan` 现写。

### 写 handoff(spec→plan,approve 分支末尾)

task-dir 壳落盘后,把本阶段决策蒸馏成 handoff 交给 plan 阶段(正文长度上限 + freshness header 机制见 workflow-cli.md):建议 `## Decisions`(关键技术选型/范围裁决)/ `## Rejected`(被拒方案+原因)/ `## Risks`(未解决依赖)+ 一行 contract-digest 指针(指向 Step 2 落盘的 contract-digest.md)。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js write-handoff --from spec --to plan --content-file <handoff 正文 .md 绝对路径>
```

> **语义边界(三者不重复)**:contract = 既有代码复用面(受影响文件/签名/store·type shape,落 contract-digest.md,Step 2 已写);spec = 需求(behavior/scope/AC,落 spec.md);code-specs = 项目规范(convention/contract 约束,`.claude/code-specs/`)。handoff 只装本阶段决策/取舍指针,不复写 spec 正文,不复写 contract-digest——读侧按指针回溯。

**输出摘要**:Spec 路径、Plan 路径、需求统计、任务数量。

**下一步**(回复编号继续,或 `/clear` 后敲对应命令):
1. `/workflow-plan` — 扩写详细实施计划［上下文大时先 `/clear`:plan 从 disk 重读 spec.md、讨论结论已落 §9,清理无损失］
2. `/collaborating-with-codex --review specs/<filename>.md` — 让 Codex 先审一遍 Spec
