---
name: workflow-spec
description: "Use when 用户调用 /workflow-spec, or 提出新需求要走完整 spec → plan → execute 流程并需要状态机管理。简单任务请用 /quick-plan。"
---

> 路径约定 + CLI 写入契约 + spec-review 5 个 canonical 字符串见 [`../../specs/shared/pre-flight.md`](../../specs/shared/pre-flight.md) § Workflow CLI 路径约定。

# workflow-spec

<HARD-GATE>
1. Spec 未经用户确认,不得进入 Plan 扩写
2. 讨论结果必须写入 spec.md § 9 对应章节,不得仅在对话中存在
3. **Step 1 必须先调 `workflow_cli.js plan` 建立 state 与骨架文件**,后续 Step 只能在骨架上 Edit 扩写,禁止 Write 全量覆盖 spec.md
</HARD-GATE>

> 🔧 自愈例外:会话丢失重建 state 时,CLI `init` 按 spec 文件存在性推断审批状态(`system-recovery` 标记,非用户主权审批)。仅限执行期,规划期不得触发。

## Checklist

1. ☐ 解析参数 + 基础设施预检
2. ☐ 代码库分析(强制)
3. ☐ 需求讨论(条件)
4. ☐ Spec 文本扩写(在 CLI 骨架上)+ Self-Review
4.D ☐ 设计深化(条件,前端/后端/全栈分支)
4.5 ☐ Codex Spec Review(条件,advisory)
5. ☐ 🛑 用户审批 + 规划完成

---

## Step 1: 参数解析 + 预检

**参数格式**:
- 内联需求:`/workflow-spec "实现用户认证功能"`
- 文件需求:`/workflow-spec docs/prd.md`(自动检测 `.md` 文件存在)
- 强制覆盖:`/workflow-spec -f "需求"`
- 跳过讨论:`/workflow-spec --no-discuss "需求"`

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

**plan.md 何时生成**:Step 5 调用 `spec-review --choice "Spec 正确，生成 Plan"` 时,CLI 读取已扩写好的 spec.md 首次生成 plan.md 骨架并推到 `planned`。

**后续 Step 的 contract**:
- Step 2-3 不是"从零写 JSON 工件",而是**读取骨架按 canonical schema 填值**
- Step 4 在 spec.md 骨架上 Edit 扩写;禁止 Write 全量覆盖,禁止删除/重命名 front matter 字段(`version` / `requirement_source` / `created_at` / `spec_file` / `status` / `role` / `role_profile` / `context_profile`)

**错误处理**:
- CLI 返回 `已存在未归档工作流` → 回到预检 Step 3 让用户选择 archive / 恢复 / `--force` 覆盖。**不得改用 `init` 子命令**
- 其他错误 → 直接展示给用户,不自行推进

## Step 1.5: Code Specs 读取(advisory)

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

**宣告**:`💬 Phase 0.2: 需求分析讨论`
**跳过条件**:`--no-discuss`,或内联需求 ≤100 字符且预分析无待澄清项。

1. **需求预分析** — 基于代码分析结果识别待澄清事项,按 P0/P1/P2 分层(P0=阻塞 Spec、P1=交互细节、P2=非功能性)。检查维度:范围边界、行为定义、边界场景、权限与角色、非功能性需求、技术约束冲突、外部依赖就绪度、UX 导航结构、文档内部一致性
2. **探索优先(定向)** — 凡是可通过已有工件回答的问题,不得提问用户。先读 `analysis-result.json`,不足再 Read/Grep 具体文件,不重复全量扫描
3. **分流澄清** — 按**决策依赖树**排序,先问根节点。P0 逐个 AskUserQuestion(每题必带推荐答案 + why),P1 写入 `clarifications[]` 附 self-recommended,P2 仅在 Spec 风险章节留痕
4. **方案探索(条件)** — 仅在存在互斥实现路径或显著技术 tradeoff 时触发
5. **技术决策反写** — 讨论确认的技术选型反写到 `project-config.json`

**持久化**:讨论结果写入 spec.md § 9(§ 9.1 需求澄清记录、§ 9.2 方案选择、§ 9.3 未解决依赖)。

> ⚠️ 不得仅依赖对话上下文记忆,讨论结果必须落盘到 spec.md。

## Step 4: Spec 文本扩写 + Self-Review

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
- **§ 4.4 UX & UI Design 和 § 5.6 System Design 不在本 Step 填写**,留给 Step 4.D

**输入**:需求(PRD 或内联)+ `analysis-result.json` + `.claude/code-specs/` 相关规范文件。
**输出**:在 `.claude/specs/{task-name}.md` 骨架上 Edit 扩写。

**Spec 核心章节**(本 Step 覆盖):
1. **Context** — 背景和目标
2. **Scope** — in-scope / out-of-scope / blocked
3. **Constraints** — 硬约束 + 讨论澄清摘要
4. **User-facing Behavior** — § 4.1-4.3(正常/异常/边界,§ 4.4 留给 4.D)
5. **Architecture and Module Design** — § 5.1-5.5(module 划分、数据模型、技术选型,§ 5.6 留给 4.D)
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

**覆盖率目标 ≥ 90%**。低于阈值时,将 partial/uncovered 段落追加到 §9 Open Questions。

**2. Placeholder 扫描** — 搜索 `TBD` / `TODO` / `待补充` / `待确认` 及空的章节或未填写的模板变量,替换为实际内容。

**3. 内部一致性** — Architecture 章节的 module 划分是否与 User-facing Behavior 的操作路径一致;File Structure 是否与 Architecture 的 module 对应。

**4. 约束完整性** — 需求中的硬约束(字段名、数量限制、条件分支等)是否都在 § 3 Constraints 出现;讨论确认的技术决策是否体现在 Architecture 中。

**5. UX 一致性**(仅当 § 4.4 存在) — workflow 图中每个步骤是否在 § 4 有对应描述;flowchart scenarios ≥ 3(首次使用、核心操作、异常/边界);L0 module ≤ 4 个。

**6. 首次使用体验** — 涉及工作区/初始化/应用安装等概念时,是否有首次使用引导描述。

> 覆盖率即时计算(将 PRD 原文按语义段落逐段比对 Spec 内容),结果直接展示给用户,不持久化为独立文件。

## Step 4.D: 设计深化(条件)

**宣告**:`🎨 Phase 1.5: 设计深化`
**跳过条件**:纯 CLI / 工具类项目(`ux_gate_required=false` 且 § 5.1 无后端服务模块)。

| 信号 | 前端分支 | 后端分支 |
|------|---------|---------|
| `ux_gate_required=true` | ✓ | — |
| § 5.1 含 API/Service/DB 层 | — | ✓ |
| 全栈 | ✓ | ✓ |

详细执行指南:[`references/design-elaboration.md`](references/design-elaboration.md)。

### 前端分支(§ 4.4 UX & UI Design)

1. **§ 4.4.1 User Flow** — 主会话生成 Mermaid 用户操作流程图,≥ 3 场景(首次使用、核心操作、异常/边界)
2. **§ 4.4.2 Page Hierarchy** — 主会话填写页面层级表(L0 ≤ 4 个功能 module)
3. **设计稿关联** — 用 AskUserQuestion 收集 DesignSourceMap(逐页或批量):Figma URL → fileKey + nodeId / 截图路径 → imagePath / 跳过 → infer
4. **§ 4.4.3 Page Layout Summary** — **分派子 Agent**(只读任务,不占主上下文)并行提取布局锚点,主会话回收后 Edit 写入 spec.md

> 子 Agent 只输出 LayoutAnchor JSON,不写项目文件。降级:子 Agent 超时/失败 → 改用 infer 路径,不阻塞。

### 后端分支(§ 5.6 System Design)

主会话内完成(纯文本 + Mermaid):
1. **§ 5.6.1 API Contract Summary** — 从 § 4.1 行为推导接口清单
2. **§ 5.6.2 Data Flow** — Mermaid 数据流图
3. **§ 5.6.3 Service Boundaries** — 基于 § 5.1 定义服务边界和通信方式
4. **§ 5.6.4 Data Migration** — 条件填写(涉及 schema 变更时)

### 全栈

主会话先完成 § 4.4.1 + § 4.4.2 + 设计稿关联,然后**并行**:主会话写 § 5.6,子 Agent 提取 § 4.4.3。

## Step 4.5: Codex Spec Review(条件,advisory-to-human)

**Phase 编号**:1.2.5(conditional `machine_loop`)
**治理模式**:`advisory-to-human` — Codex 发现不自动修复 Spec,作为 Step 5 Human Gate 的参考输入。
**触发条件**:`workflow-state.json` 的 `context_injection.planning.codex_spec_review.triggered`。
**未触发**:输出 `⏭️ Codex Spec Review: skipped`,直接进入 Step 5。
**执行流程**:见 [`references/codex-spec-review.md`](references/codex-spec-review.md)。

摘要输出:`🔍 Codex Spec Review: {n} issues found (critical: {x}, important: {y})`

**与 Step 5 的衔接**:Step 5 展示时增加一栏 "Codex review 发现",用户可选择"采纳 Codex 建议并修改 Spec"回到 Step 4。

## Step 5: 🛑 用户审批 + 规划完成

**治理模式**:`human_gate` — 用户主权确认。

**展示内容**:
1. Spec 关键章节摘要(Scope、Constraints、Acceptance Criteria)
2. 设计深化摘要(§ 4.4 / § 5.6,如有)
3. PRD 覆盖率(即时计算)
4. Codex review 发现(若 Step 4.5 已执行)

**review 时必须将 spec.md 与需求原文逐段对照**,不能只依据摘要判断。

**用户回复归一化 → CLI 调用**:

调用 `AskUserQuestion`(canonical 字符串见 pre-flight.md § Workflow CLI 路径约定):

| 用户意图 | canonical choice | 结果 |
|---|---|---|
| 通过,生成 Plan | `Spec 正确，生成 Plan` | CLI 生成 plan.md 骨架,进入 `planned` |
| 通过,继续 | `Spec 正确，继续` | 继续 workflow |
| Spec 要改 | `需要修改 Spec` | 回到 Step 4 |
| 缺需求 | `缺少需求细节` | 回到 Step 4,保留细节 |
| 范围要拆 | `需要拆分范围` | 状态回 idle |

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" spec-review --choice "<canonical 字符串>"
```

approve 分支 CLI 会重新读取 spec.md 并生成 plan.md 骨架,状态推进到 `planned`。

**输出摘要**:Spec 路径、Plan 路径(如已生成)、需求统计。

**下一步提示**:
1. review `spec.md`
2. `/workflow-plan` 扩写详细 Plan
3. `/workflow-execute` 开始实施
