---
name: workflow-plan
description: "Use when /workflow-spec 已审批通过, or 用户调用 /workflow-plan 在已审批 Spec 基础上扩写实施计划, or 用户说\"扩写实施计划 / 详细 task 拆分\"且已有审批过的 spec。"
disable-model-invocation: true
---

> 路径 convention + CLI 写入 contract 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。
>
> 两类产物分工:机器 task 源(task-dir 元数据 + per-task `context.jsonl` 背包)由**本 skill 现写**——CLI `task-write` / `context-curate`(schema 见 [`../../specs/workflow-runtime/task-dir-schema.md`](../../specs/workflow-runtime/task-dir-schema.md)),按 implementation slice 定粒度;可选 plan.md 叙述骨架由 `/workflow-spec` 生成,本 skill 仅 Edit 扩写。

# workflow-plan

<HARD-GATE>
1. Plan 中不允许任何 placeholder(详见 [`references/no-placeholders.md`](references/no-placeholders.md);`plan-review` 的 `lintPlaceholder` 自动校验)
2. (仅当存在可选叙述 plan.md 时适用)扩写优先走 CLI `plan-edit --anchor <id>`(v2 plan 锚点 section 级替换);Edit 工具 `old_string` 不得跨锚点边界;
   禁止 `Bash` 调用 python/perl/sed/awk 的整文件 `write_text` / `>` 重定向改写 plan.md ——
   OS 级整文件写入即使保留 front matter 也等同全量覆盖。Edit 工具的审计轨迹与锚点完整性是 HARD-GATE 保护对象。
3. task 源 = task-dir(`~/.claude/workflows/{pid}/tasks/{taskId}/`),非 plan.md 物理解析。plan 阶段**按 implementation slice 现写最终 task 粒度/ID**(spec-approve 不再锁死);`current_tasks[0]` = task 源 `firstTaskId()` 始终是 resume 起点——`task-write` 整集替换后自动重导锚点,`plan-review` 对残留孤儿(`current_tasks_orphaned`)挡 ready;planner 不手改 state(修锚走 `repair-anchor`)。重导/修复语义详见 workflow-cli.md § task-write 的 resume 锚点重导 / § repair-anchor
4. **禁逆向引擎**:写 task-dir 只走 `task-write` / `context-curate`(schema 见 task-dir-schema.md),禁止 Read/grep `core/utils/workflow/*.js`(task_store/plan_composer/…)逆向函数、禁止手写 `.cjs` 直 `require` 内部模块绕过 CLI。CLI 不满足需求 → halt 报错让用户介入,不自行逆向(PreToolUse `guard-engine-source` hook 会 deny)。查命令签名用 `<cmd> --help`,查打分提升项读 `plan-review` 的 `confidence.hints`,均无需读源码。
</HARD-GATE>

## Checklist

1. ☐ 状态检查 + 上下文加载
2. ☐ Plan 扩写 + Self-Review
3. ☐ 🛑 规划完成

## Step 1: 状态检查

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js --project-root "$PWD" status
```

确认 `status=planned`、`plan_file` 已就绪、`current_tasks` 非空。状态异常处理:
- `spec_review` → **隐式 approve 路径**(与 workflow-spec 归一化表对齐):
  - 主会话打印一行 `状态=spec_review,按 /workflow-plan 调用视为通过 spec 审批`,调用 `workflow_cli.js spec-review --choice "Spec 正确，生成 Plan"` 将状态推到 `planned`,再继续 Step 2 扩写;
  - **占位防线在 CLI**:`spec-review` approve 自带 spec 正文占位校验,spec 仍含模板占位时返回 `reason: spec_placeholder` + hits 并拒绝——此时提示用户 "spec.md 仍含模板占位(转述 hits),请先回 /workflow-spec 完成扩写",不要自行绕过;
  - **不要**主动回退到 `/workflow-spec`——用户已通过 skill 切换表达过 approve 意图;仅 CLI 占位拒绝时才引导回去补全
- `idle` → 先执行 `/workflow-spec` 启动规划(无 spec 可 approve)
- `running` / `halted` → 用 `/workflow-execute` 恢复

**读 handoff(spec→plan,上下文加载前定向)**:先读 spec 阶段决策摘要,定向后续扩写,不必整篇重读 spec。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js read-handoff --from spec
```

返回 JSON `{fresh, content?, reason?, fallback?}`。`fresh:true` → 用 handoff 里的 Decisions/Rejected/Risks + contract-digest 指针定向;`fresh:false`(stale/missing)→ 不阻断,直接按下方上下文加载读全文 spec.md。

**上下文加载**:`spec.md`(唯一规范输入,文件规划与复用线索来自 §6 File Structure + §5.1 Architecture)+ spec.md § 9(若存在;讨论阶段跳过时 § 9 可能为空——此时跳过 Discussion Drift Check)。

## Step 2: Plan 扩写 + Self-Review

**宣告**:`📋 Plan 扩写`

**扩写硬约束**(违反会破坏执行期状态机；Hard Gate 已列其要):
- 禁止修改 YAML front matter(`spec_file` / `status` / `role_profile` / `context_profile`)
- 禁止修改 `plan_file` 路径或重命名 plan 文件(若生成了可选叙述 plan.md)

### 现写阶段定 task 粒度(task-dir 作 task 源)

spec-approve 阶段**只落了 task 元数据壳,未锁死最终粒度**(松 Hard Gate #3)。本阶段按 implementation slice **现写最终 task 切分**:

- 按真实实现切片确定 task 数量、ID、阶段、依赖、验收项,**以及 execute 护栏所需 v2 rich 字段**(`files` 写作用域 / `constraints` 关键约束 / `patterns` Patterns to Mirror / `mandatory_reading` Mandatory Reading / `task_text` 执行正文),**组成 JSON 数组一次性 `task-write` 整集写入**(字段见 task-dir-schema.md v2;原子替换 + 自动清孤儿 + **自动从 task.json 渲染 `task.md`**,不手编 task.json/task.md、不写 `.cjs`)。spec-approve 落的壳可增删/合并/重排——不受预锁 task ID 约束。
- **每 task 必填 `requirement_ids`**(承接 spec §2.1 R-ID;spec-approve 壳已按 1:1 预填,重切时把每个 R-ID 分配到新 task 集,一个 task 可承接多个 R-ID)。这是 `plan-review` coverage 比对与 confidence PRD 维度的数据源——缺失不挡 ready,但 coverage 会全量 uncovered。同 id 续写时省略该字段会自动承接旧值(返回 `requirement_ids_inherited`);重切的新 id 不承接,须显式填。写后仍缺的 task 经 `tasks_without_requirement_ids` 回报,逐个补填。

```bash
CLI=~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js
# 把全部 task 写成一个 JSON 数组(字段见 task-dir-schema.md)再整集落盘:
node "$CLI" task-write --from-file /tmp/wf-tasks.json     # 或 --from-file - 读 stdin
```

- `task-write` 落盘后自动重导 `current_tasks[0]` + 清孤儿(`plan-review` `current_tasks_orphaned` 兜底挡 ready);锚点损坏时走 reseed-only `repair-anchor`(不重写 task 集)。语义见 workflow-cli.md § task-write / § repair-anchor。
- **plan.md 退化为可选人读叙述**:execute 期 `execution_sequencer` 从 task-dir 读序列、不解析 plan.md;叙述可省。

> **legacy 兼容**:存量 plan.md 格式旧 workflow(无 task-dir)由 `LegacyPlanMdSource` 兜底——execute 检测到仅有 plan.md 时复用 `parseTasksV2` 读 task 序列 + 提示显式迁移,行为不变(C-7)。

### curate per-task context.jsonl 背包(plan 阶段策展)

为每个 task 策展 `context.jsonl` 文件指针背包,每行 `{file,reason}`,经 CLI `context-curate` 写(不手编):

```bash
# 每行一个 {file,reason} 的 JSONL,写给单个 task:
node "$CLI" context-curate --id T1 --from-file /tmp/wf-t1-ctx.jsonl   # 或 - 读 stdin
```

- **仅 spec/research 路径**(spec.md / 调研笔记 / PRD 等),**禁 code 路径**(.js/.ts 等源码)——code 复用面走 contract-digest,源码 implementer 执行期自读。code 扩展名行 `context-curate` 自动丢弃。
- 执行期由 `pre-execute-inject` 在 active task scope 解析后**展开指针全文**,与 `<task-contract>` + scoped code-specs 并列注入 implementer/check subagent(复用 `getContractDigest` 单文件读取风格)。
- 指向不存在文件 → execute 期跳过 + stderr warn,不阻断注入。
- **跨服务 contract 随引用自动入背包**:若 task 的 spec / slice 引用了 contract 锚点 `<file>#anchor`(如 `docs/contracts.md#seam-*`、`docs/architecture/README.md#seam-domain-*`),把锚点 `#` 前的 `.md` 路径 curate 进该 task 的 `context.jsonl`(`reason` 写引用的 seam id)。execute 期经 `<context-pack>` 注入,让 implementer 看到**权威 contract 原文**而非 spec 里的二手转述。路径按引用自身解析,项目无关;contract 是 SSOT,只引用不在 task 里重述字段。

**输出**:`task-write` 整集写 task-dir(task.json v2 元数据 + rich 字段,并自动渲染 task.md) + `context-curate` 逐 task 写 context.jsonl 背包;可选在 plan 叙述骨架上 Edit 扩写(路径由 `state.plan_file` 指定,**仅人读叙述,不承载机器 task 字段**)。骨架模板:[`../../specs/workflow-templates/plan-template.md`](../../specs/workflow-templates/plan-template.md)。

### 设计原则

- **Spec-Normative** — spec.md 是唯一规范输入
- **File Structure First** — 先列文件清单,再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟原子操作
- **Actionable Steps** — 每步描述精确到文件、函数、行为。代码块仅用于非显然模式（复杂正则、算法、配置结构），不要求全文件内容
- **Spec Section Ref** — 每步标注对应的 spec 章节

> verification 字段要求(`commands` + `expected_output` 非空)、task.json v2 落盘契约见下「任务结构」,不重述。

### 任务结构

每个 task = 一条 task.json v2 记录(经 `task-write` 落盘,字段 schema 见 task-dir-schema.md):`id`(Tn) + `name` + `phase`(implement/test/config) + `package` + `files`(精确路径写作用域) + `requirement_ids`(spec §2.1 R-ID) + `acceptance`(验收信号) + `verification`(`commands` + `expected_output`,**两者均须 string[] 且非空**,否则 confidence verification 维度 0 分) + `task_text`(执行正文,含步骤 S1 写测试 / S2 实现 / S3 运行)。

### Task Atomicity Rule

task 含 N≥5 并列子项 → 拆 N 个 sub-task 各带独立 acceptance（聚合漏项不可追溯）。`plan-review` `lints.atomicity` 自动标记(advisory)，命中人工确认。

### 共享文件信号（Merge / Fan-out）

`plan-review` `lints.shared_file` 扫 `files[]`×`depends[]`（advisory）报两类候选,**引擎只报不自动合/改**:

- **`merge_candidates`**：两 task 同产物 + 依赖边 → 建议合并;人确认后合,逐 acceptance bullet 挂回原 `R-id/CHG-id` 保留可追溯。
- **`fan_out`**：同一 file ≥3 task 触及 → 确认写序/归属;生成物(i18n/autogen)只碰源,物化收敛到末尾单 task。

与 Atomicity 正交(广度拆 vs 深度合),不双报。

### Pattern Discovery

从代码分析结果提取可复用模式,写进 `task-write` JSON 的 `patterns[]`(`{file,line?,note}`)和 `mandatory_reading[]`(`{path,reason,symbols[],line_hint}`)结构化字段——**不再写进 plan.md 锚点**(execute 与 plan-review lint 一律读 task.json,task.md 由其渲染)。引用必须指向真实存在的代码文件和符号；**行号可选**(implementer 在执行期自读定位,planner/controller 都不必为补行号去通读源码)。

### Global Constraints 块

spec 中约束**每个 task** 的规则（版本下限、依赖限制、命名和文案、精确值）写入第一个（或所有）task 的 `constraints_global` 字段（string[]）；execute 期 `pre-execute-inject` hook 逐字注入每个 implementer/reviewer 的 `<global-constraints>` 段。
- **逐字复制不转述**（到达 implementer 须与 spec 原文一致），只写影响 ≥2 task 的约束（单 task 走 `constraints`）。

### Per-Task Interfaces 块

每个 task 在 `task-write` JSON 的 `interfaces` 字段声明其消费和生产的接口，让只看自己 task 的 implementer 知道邻居 contract（T2 不读 T1 源码即知 `UserService.list` 返回形态）：

```json
{
  "interfaces": {
    "consumes": [{ "name": "UserService.list", "from_task": "T1", "contract": "返回 Promise<User[]>" }],
    "produces": [{ "name": "renderUserList", "contract": "(users: User[]) => JSX.Element" }]
  }
}
```

- `from_task` 标注接口来源 task（跨 task contract 追溯）；空时 reviewer 不校验接口一致性。

### Right-Sizing 指导

任务保持在「值得自己的测试周期和审阅器通过」的规模：
- **不要拆太碎**：setup / config / docs 折叠到需要它们的实现 task 中，不单独成 task（省一次 subagent + reviewer 往返）
- **不要合太大**：只在「reviewer 能独立 reject 其一而通过其邻」处拆——否则 review 变形式主义
- 粒度由 `lints.atomicity` / `lints.shared_file.merge_candidates` 自动标记，命中人工确认

### Discussion Drift Check

以审批后 Spec Architecture/Scope 为准,**不得据 §9 讨论记录发明 spec 外任务**。唯一主动核对:§9.3 有未解决依赖时,验证对应需求已标 `blocked`,缺失 → 回 `/workflow-spec`。

### Self-Review

Plan 扩写完成后**调 CLI**,不再人工扫 plan body:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js plan-review
```

返回 JSON:
- `ready: false` → 按 CLI 返回的被 flag `lints.*` issues 逐项修复 → 重跑（`coverage` advisory,不挡 ready,见下行）。
- `ready: true` 后**仍须确认 `lints.task_schema.warnings`(`empty_name`/`empty_acceptance`)已清**——warnings 不挡 ready 但不得带入 Step 3(见 Step 3 §6 摘要门);`coverage.uncovered_ids` advisory,人工确认未覆盖 R-ID 是否故意 → 进入 Step 3
- `confidence` 由 CLI 自动算;偏低读 `confidence.hints` 提升,`low` 时 Step 3 摘要标注「建议 review」。

详细 lint 项与 ready 矩阵见 [`references/plan-self-review.md`](references/plan-self-review.md)。

## Step 3: 🛑 规划完成

状态结果:`status=planned`、`plan_file` / `current_tasks` 就绪,后续由 `workflow-execute` 接管。

### 写 handoff(plan→execute)

把规划阶段决策蒸馏成 handoff 交给 execute:正文 ≤20 行(CLI 自动拼 5 行 freshness header),建议 `## Decisions`(task 拆分理由/排序约束)/ `## Rejected`(被否的拆分方案)/ `## Risks`(low-confidence task / 待验证依赖)+ contract-digest 指针。不复写 plan.md 正文。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js write-handoff --from plan --to execute --content-file <handoff 正文 .md 绝对路径>
```

**输出摘要**:直接 paste `plan-review` 返回 JSON 的 `summary` + `confidence` + `coverage` 字段,顺序:
1. `summary.paths`(Spec/Plan 路径)
2. `summary.req_stats` + `summary.task_count`
3. `confidence`(score / level / breakdown)—— CLI 已按 rubric 算分
4. `summary.task_table`(Task / 阶段 / 主要产出 / 依赖 / Interaction)
5. `summary.interaction_legend`
6. `lints` 摘要(warnings 非空时列出;`task_schema.warnings` 含 `empty_name`/`empty_acceptance` = task 现写漏项,回 `task-write` 补全后重跑 `plan-review`,不得带 warnings 交付)

**下一步**(回复编号继续,或 `/clear` 后敲对应命令):
1. `/workflow-execute` — 实施(默认每 task 起 fresh implementer subagent + spec/quality 两段 review,task 间顺序执行)［上下文大时先 `/clear`:execute 从 state + task-dir 恢复 resume 三元组(`current_tasks[0]`+`status`+task 源),清理无损失］
2. `/collaborating-with-codex --review plans/<filename>.md` — 让 Codex 先审一遍 Plan
