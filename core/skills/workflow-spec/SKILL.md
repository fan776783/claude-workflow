---
name: workflow-spec
description: "Use when 用户调用 /workflow-spec, or 提出新需求要走完整 spec → plan → execute 流程并需要状态机管理, or 用户描述\"完整需求规格 / spec → plan → execute / 跨 module 新需求\"等场景。简单任务请用 /quick-plan。"
---

> 路径约定 + CLI 写入契约见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)（完整 canonical key 以 `core/utils/workflow/planning_gates.js` `mapSpecReviewChoice` 为准）。

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
5. ☐ 设计深化路由判断(仅评估,不执行)
6. ☐ 🛑 用户审批(含设计深化决策)+ 规划完成

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

**预检**(详见 [`../../specs/workflow-runtime/preflight.md`](../../specs/workflow-runtime/preflight.md)):
1. **Git 状态** — 已初始化且有初始提交。无 git 时用户显式选择降级或暂停
2. **项目配置** — `project-config.json` 不存在或 `project.id` 无效 → 引导先跑 `/scan`(空项目用 `/scan --init`),不再自动生成最小配置
3. **workflow 状态** — 存在未 archive 的 workflow 时根据状态(running/paused/failed/completed)提示恢复、覆盖或 archive
4. **projectId 获取** — 直接读 `project-config.json` 的 `project.id`,不要在此或下游入口调用 `stableProjectId()` 重新计算(只有 `/scan` 初始化/迁移时才允许)。禁止 shell 手动哈希

### 预检通过后:强制调用 `workflow_cli.js plan`

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" plan "<原始需求或 PRD 路径>"
```

CLI 此刻会落盘:
- `workflow-state.json`(status=`spec_review`)
- `spec.md` 骨架(带模板 front matter)— **plan.md 不在此时生成**
- `role-context.json` 骨架
- `ux_gate_required` 标记(仅当涉及 UI 关键词或检测到前端框架时为 true)

**plan.md 何时生成**:Step 6 调用 `spec-review --choice "Spec 正确，生成 Plan"` 时,CLI 读取已扩写好的 spec.md 首次生成 plan.md 骨架并推到 `planned`。

**后续 Step 的 contract**:
- Step 2-3 不是"从零写 JSON 工件",而是**读取骨架按 canonical schema 填值**
- Step 4 在 spec.md 骨架上 Edit 扩写;禁止 Write 全量覆盖,禁止删除/重命名 front matter 字段(`version` / `requirement_source` / `created_at` / `spec_file` / `status` / `role` / `role_profile` / `context_profile`)

**错误处理**:
- CLI 返回 `已存在未归档工作流` → 回到预检 Step 3 让用户选择 archive / 恢复 / `--force` 覆盖。**不得改用 `init` 子命令**
- 其他错误 → 直接展示给用户,不自行推进

## Step 1.1: Code Specs 读取(advisory)

将 `.claude/code-specs/` 作为 Constraints 参考:
1. 目录存在 → `getCodeSpecsContextScoped()` 按当前 plan 推断的 package 读取子树,汇总成 Constraints 摘要
2. 目录不存在且 `project-config.json` 中 `codeSpecs.bootstrapStatus !== 'skipped'` → 输出 advisory:`💡 未检测到项目 code-specs,建议执行 /spec-bootstrap 建立骨架并用 /spec-update 沉淀规范。`
3. 不阻塞 workflow,不修改任何文件

## Step 2: 代码库分析(强制)

**宣告**:`📊 Phase 0: 代码分析`

提取:
1. **相关文件** — 可复用或需修改的现有实现
2. **可复用组件** — 可继承的基类、工具类
3. **架构模式** — 相似功能的实现参考(如 Repository Pattern、Error Boundary)
4. **技术约束** — 数据库、框架、规范、错误处理模式
5. **依赖关系** — 内部和外部依赖

**持久化**:写入 `~/.claude/workflows/{projectId}/analysis-result.json`。此工件由 AI 全权产出(非 CLI 管理),可直接 Write。

### analysis-result.json schema

```json
{
  "created_at": "2026-04-10T10:00:00Z",
  "source": "phase-0-code-analysis",
  "relatedFiles": [
    { "path": "src/services/auth.ts", "purpose": "需修改以支持 OAuth", "reuseType": "modify" }
  ],
  "reusableComponents": [
    { "path": "src/utils/validators.ts", "description": "通用校验函数", "purpose": "可复用" }
  ],
  "patterns": [
    { "name": "Repository Pattern", "description": "数据访问层使用 *Repo 类封装" }
  ],
  "constraints": ["数据库 PostgreSQL 15 + Prisma"],
  "dependencies": [
    { "name": "prisma", "type": "external", "reason": "ORM" }
  ]
}
```

`reuseType`: `modify | reference | extend`;`dependencies[].type`: `internal | external`。

### Code Specs Freshness Check(条件)

`.claude/code-specs/` 存在时,在代码分析结尾对涉及层(frontend / backend / guides)的 Filled 文件执行过期检测:
1. `git log -1 --format=%ct` 检查最后修改时间
2. > 30 天未更新 → 输出 `⚠️ code-specs/{layer}/{file} 已 {N} 天未更新,建议 review 后更新`
3. 不阻塞,仅 advisory;不涉及的层不检查

## Step 3: 需求讨论(条件)

**宣告**:`💬 Phase 0.2: 需求讨论`
**跳过条件**:内联需求 ≤100 字符且预分析无待澄清项。

### 质询纪律

同 `/grill` Deep Mode — 走决策树每个分支,一次一个问题,每问带推荐答案。能在代码/已有工件中查到的不问用户。

### 讨论范围

基于 Step 2 代码分析识别待澄清项。典型关注点:
- 范围边界(in/out-of-scope 的灰色地带)
- 行为定义(正常 + 异常 + 边界场景)
- 技术约束冲突(PRD vs 现有架构)
- 外部依赖就绪度

**不逐维度过**。只讨论真正有歧义的点。无歧义的直接写入 spec,不确认。

### 被拒需求扫描

检查项目根 `.out-of-scope/`(协议见 `core/specs/shared/out-of-scope-protocol.md`):
- 与当前需求相关的记录 → 写入 analysis-result.json 的 `constraints` 数组,标注 `[out-of-scope]` 前缀
- 讨论时如触碰到 out-of-scope 边界 → 主动告知用户

### 分流

- 阻塞 Spec 生成的决策 → AskUserQuestion(逐个,每题带推荐 + why)
- 交互细节级 → 写入 spec § 9.1 附 self-recommended,不阻塞
- 非功能性 → 仅在 § 9 风险章节留痕

### 术语挑战

同 grill: 用户用的术语和 glossary 冲突时当场指出。新术语确认后按路由模式 inline 更新(本 repo → `core/specs/shared/glossary.md`;用户项目 → `.claude/code-specs/shared/business-glossary.md`)。

### 方案探索(条件)

仅在存在互斥实现路径或显著技术 tradeoff 时触发。确认的技术选型反写到 `project-config.json`。

### 持久化

讨论结果写入 spec.md § 9(§ 9.1 需求澄清记录、§ 9.2 方案选择、§ 9.3 未解决依赖)。不得仅依赖对话上下文记忆。

## Step 4: Spec 文本扩写 + Self-Review(核心章节)

**宣告**:`📘 Phase 1: Spec 扩写`

**健康检查**(扩写前):

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" status
```

确认 `spec_file` 已就绪、`status=spec_review`。异常时回到 Step 1 调 `plan` 重建骨架。

**扩写硬约束**:
- 用 Edit 逐节扩写,**禁止 Write 全量覆盖**
- 不得删除或重命名 YAML front matter 字段
- 不得改动模板章节标题或锚点;只在正文内扩展
- **§ 4.4 UX & UI Design 和 § 5.6 System Design 不在本 Step 填写**,留给 Step 5 设计深化

**输入**:需求(PRD 或内联)+ `analysis-result.json` + `.claude/code-specs/` 相关规范文件。
**输出**:在 `~/.claude/workflows/{pid}/specs/{task-name}-{MMDD}.md` 骨架上 Edit 扩写。

**Spec 核心章节**(本 Step 覆盖):
1. **Context** — 背景和目标
2. **Scope** — in-scope / out-of-scope / blocked
3. **Constraints** — 硬约束 + 讨论澄清摘要
4. **User-facing Behavior** — § 4.1-4.3(正常/异常/边界,§ 4.4 留给 Step 5)
5. **Architecture and Module Design** — § 5.1-5.5(module 划分、数据模型、技术选型,§ 5.6 留给 Step 5)
6. **File Structure** — 新建/修改/测试文件
7. **Acceptance Criteria** — 按 module 的验收条件
8. **Implementation Slices** — 渐进交付切片
9. **Open Questions** — 待确认问题

### Self-Review(生成后立即执行)

发现问题直接修复,无需重审。必须输出执行摘要:覆盖率 + placeholder 扫描 + 一致性结果。

**1. PRD 原文回溯扫描** — 将 PRD 原文按标题层级 + 列表项拆为语义段落,逐段检查 Spec 是否覆盖。重点关注:
- 包含**精确值**的段落(数字、公式、枚举、"最多N个")— 数字必须原样保留
- 包含**否定约束**的段落("不支持"、"禁用"、"不可")— 否定语义不得遗漏
- 包含**联动关系**的段落("根据…拉取"、"条件展示")— 联动逻辑不得被简化
- 包含**改造指令**的段落("改名为"、"替换"、"重命名")— 改造细节不得被概括

未覆盖的精确值/否定约束/联动关系/改造指令段落追加到 §9 Open Questions。不计算百分比。

**2. Placeholder 扫描** — 搜索 `TBD` / `TODO` / `待补充` / `待确认` 及空的章节或未填写的模板变量,替换为实际内容。

**3. 内部一致性** — Architecture 章节的 module 划分是否与 User-facing Behavior 的操作路径一致;File Structure 是否与 Architecture 的 module 对应。

**4. 约束完整性** — 需求中的硬约束(字段名、数量限制、条件分支等)是否都在 § 3 Constraints 出现;讨论确认的技术决策是否体现在 Architecture 中。

**5. 首次使用体验** — 涉及工作区/初始化/应用安装等概念时,是否有首次使用引导描述。

> § 4.4 / § 5.6 的一致性检查由 `/ux-elaboration` 和 `/system-design` 各自内部的 Self-Review 覆盖（仅当用户在 Step 6 选择执行设计深化时触发）,本 Step 不涉及。
> 覆盖率即时计算(将 PRD 原文按语义段落逐段比对 Spec 内容),结果直接展示给用户,不持久化为独立文件。

## Step 5: 设计深化路由判断(不执行)

**宣告**:`🎨 Phase 1.5: 设计深化评估`

本 Step 仅做路由判断并输出推荐，**不执行深化 skill**。实际执行推迟到 Step 6 由用户决策。

**跳过条件**(直接进入 Step 6，不输出推荐):
- 纯 CLI / 工具类项目（`ux_gate_required=false` 且 § 5.1 无后端服务模块）
- spec 定义 ≤2 个 module 且 ≤3 个 page/endpoint（在 § 5.1 inline 架构决策即可）

**路由规则**:

| 信号 | 推荐 |
|------|------|
| `ux_gate_required=true` 且 § 5.1 含 API/Service/DB 层 | 推荐前端 + 后端设计深化 |
| `ux_gate_required=true` 且 § 5.1 无后端服务模块 | 推荐前端设计深化 |
| `ux_gate_required=false` 且 § 5.1 含 API/Service/DB 层 | 推荐后端设计深化 |
| 以上均不满足 | skip → 直接进入 Step 6 |

**输出**: 一行路由声明（如 `→ 推荐执行: 前端 + 后端设计深化`），随 Step 6 审批一并展示。

> **Runtime 兼容性**: `planning_gates.js` 可能在 state 中写入 `codex_spec_review` 对象（via `updateCodexSpecReview`）。该字段现为 no-op——runtime 写入但 skill 不再消费。如用户需要 Codex 审查 spec，可直接使用 `/collaborating-with-codex --review`。

## Step 6: 🛑 用户审批 + 规划完成

**Phase 编号**:2 — Human Gate
**治理模式**:`human_gate` — 用户主权确认。

**展示内容**:
1. Spec 关键章节摘要(Scope、Constraints、Acceptance Criteria)
2. 设计深化推荐(Step 5 路由结果,如有)— 明确标注"尚未执行,是否需要?"
3. PRD 覆盖率(即时计算)

**review 时必须将 spec.md 与需求原文逐段对照**,不能只依据摘要判断。

**用户决策分支**:

| 用户意图 | 处理 |
|---|---|
| 通过,生成 Plan（不需要设计深化） | 直接走 approve 分支 |
| 通过,但先执行设计深化 | 执行对应 skill（`/ux-elaboration` / `/system-design` / both），完成后回到 Step 6 重新审批 |
| Spec 要改 | 回到 Step 4 |
| 范围要拆 | 状态回 idle |

**设计深化执行**（仅当用户在本 Step 选择执行时）:

| 路由结果 | 委托 |
|---------|------|
| frontend only | 调用 `/ux-elaboration` skill |
| backend only | 调用 `/system-design` skill |
| both | 先执行 `/ux-elaboration`，再执行 `/system-design` |

委托完成后，设计深化的 Self-Review 由各独立 skill 内部执行。执行完毕后重新展示 Step 6 审批内容（含深化摘要），用户再次确认。

**用户回复归一化 → CLI 调用**:

> **完整 canonical 字符串清单以 `core/utils/workflow/planning_gates.js` 中 `mapSpecReviewChoice` 为准**(共 7 个 key);`core/specs/shared/workflow-cli.md` 提供常用 5 个的快速参考。**禁止把用户原话直接塞给 `--choice`**,必须先归一化。

常见映射(完整列表见上述 source of truth):

| 用户意图 | canonical choice | 结果 |
|---|---|---|
| 通过,生成 Plan | `Spec 正确，生成 Plan` | CLI 生成 plan.md 骨架,进入 `planned` |
| Spec 要改 | `需要修改 Spec` | 回到 Step 4 |
| 范围要拆 | `需要拆分范围` | 状态回 idle |

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" spec-review --choice "<canonical 字符串>"
```

approve 分支 CLI 会重新读取 spec.md 并生成 plan.md 骨架(含任务拆分),状态推进到 `planned`。

**输出摘要**:Spec 路径、Plan 路径、需求统计、任务数量。

**下一步提示**:执行 `/workflow-plan` 扩写详细实施计划。
