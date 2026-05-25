---
name: workflow-plan
description: "Use when /workflow-spec 已审批通过且 status=planned, or 用户调用 /workflow-plan 在已审批 Spec 基础上扩写实施计划, or 用户说\"扩写实施计划 / 详细 task 拆分\"且已有审批过的 spec。"
---

> 路径 convention + CLI 写入 contract 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。
>
> Plan 骨架由 `/workflow-spec` Step 6 的 `spec-review --choice "Spec 正确，生成 Plan"` 生成。本 skill 不创建骨架,只在骨架上 Edit 扩写。

# workflow-plan

<HARD-GATE>
1. Plan 中不允许任何 placeholder(详见 [`references/no-placeholders.md`](references/no-placeholders.md);`plan-review` 的 `lintPlaceholder` 自动校验)
2. 扩写优先走 CLI `plan-edit --anchor <id>`(v2 plan 锚点 section 级替换);Edit 工具 `old_string` 不得跨锚点边界;
   禁止 `Bash` 调用 python/perl/sed/awk 的整文件 `write_text` / `>` 重定向改写 plan.md ——
   OS 级整文件写入即使保留 front matter 也等同全量覆盖。Edit 工具的审计轨迹与锚点完整性是 HARD-GATE 保护对象。
3. 禁止修改 CLI 已生成的 task ID,**尤其是首个 task ID**(`current_tasks[0]` 是执行起点)
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
  - **前置 guard**: Read spec.md,确认 §2 Scope / §3 Constraints / §4.1-4.3 / §5.1-5.5 / §6-§8 均非模板占位(grep 模板残留 token + 章节内容长度 < 50 字)。任一章节仍是占位 → 不要 approve,提示用户 "spec.md 仍含模板占位章节(列出哪些),请先回 /workflow-spec 完成扩写";
  - guard 通过后,主会话打印一行 `状态=spec_review,按 /workflow-plan 调用视为通过 spec 审批`,调用 `workflow_cli.js spec-review --choice "Spec 正确，生成 Plan"` 将状态推到 `planned`,再继续 Step 2 扩写;
  - **不要**回退到 `/workflow-spec`——用户已通过 skill 切换表达过 approve 意图
- `idle` → 先执行 `/workflow-spec` 启动规划(无 spec 可 approve)
- `running` / `halted` → 用 `/workflow-execute` 恢复

**上下文加载**:`spec.md`(唯一规范输入,文件规划与复用线索来自 §6 File Structure + §5.1 Architecture)+ spec.md § 9(若存在;讨论阶段跳过时 § 9 可能为空——此时跳过 Discussion Drift Check)。

## Step 2: Plan 扩写 + Self-Review

**宣告**:`📋 Plan 扩写`

**扩写硬约束**(违反会破坏执行期状态机；Hard Gate 已列其要):
- 禁止修改 YAML front matter(`spec_file` / `status` / `role_profile` / `context_profile`)
- 禁止修改 `plan_file` 路径或重命名 plan 文件
- 扩写仅限每个 task 内部的步骤、代码块、验证命令、Patterns / Mandatory Reading;新增 task 必须放在末尾,不得插入或重排

**输出**:在 CLI 已生成的 plan 骨架上 Edit 扩写（路径由 `state.plan_file` 指定,命名由 CLI `inferPlanRelativeFromSpec` 决定）。骨架模板:[`../../specs/workflow-templates/plan-template.md`](../../specs/workflow-templates/plan-template.md)。

### 设计原则

- **Spec-Normative** — spec.md 是唯一规范输入
- **File Structure First** — 先列文件清单,再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟原子操作
- **Actionable Steps** — 每步描述精确到文件、函数、行为。代码块仅用于非显然模式（复杂正则、算法、配置结构），不要求全文件内容
- **Exact Commands** — 验证命令包含预期输出
- **WorkflowTaskV2 Compatible** — 任务块用 `## Tn:` 标题和 V2 字段
- **Spec Section Ref** — 每步标注对应的 spec 章节

### No Placeholders 规则

详见 [`references/no-placeholders.md`](references/no-placeholders.md)（`plan-review` CLI 的 `lintPlaceholder` 自动校验,无需人工扫描)。

### 任务结构

每个 task 含:`## Tn: [组件名]` 标题 + **阶段** (implement/test/config) + **Package** + **创建/修改/测试文件**(精确路径) + **Spec 参考** + **验收项 AC-xxx** + **验证命令 + 预期输出** + **步骤** (S1 写测试 / S2 实现 / S3 运行)。

### Task Atomicity Rule

当 task 描述含 N≥5 个并列子项（筛选项 / 列 / 字段 / 标签 / tab）时，必须拆为 N 个 sub-task，每个 sub-task 带独立 acceptance bullet。**理由**：rm-agent 失败案例 T48 一个 task 覆盖 8 个筛选项漏 1 个 — 多子项聚合 task 漏项不可追溯。`plan_composer.lintTaskAtomicity` 会在 cmdPlan 返回 `plan_atomicity_lint.warnings` 标记疑似不达标的 task，由 skill 提示用户。阈值 5 可由 spec §3 显式 override。

### Pattern Discovery

从代码分析结果提取可复用模式,生成 `Patterns to Mirror` 和 `Mandatory Reading` 区块。引用必须指向真实存在的代码文件和符号。

### Confidence Score

由 `plan-review` CLI 的 `scoreConfidence` 自动计算（rubric: PRD+3 / Patterns+2 / Verification+3 / TestTask+2，partial 命中 PRD-1，`command_syntax` 有 issues → verification 维度封顶 0，`pattern_fidelity` 有 unresolved → patterns 维度封顶 0）。等级映射:`score ≥ 8 = high` / `≥ 6 = medium` / `< 6 = low`。低分摘要标注 `confidence=low,建议 review`。

### Discussion Drift Check

若 spec.md § 9 包含方案选择或未解决依赖:
- § 9.2 方案选择 → 验证 Spec Architecture 反映该方案。偏差 → 提示用户回 `/workflow-spec` 修订
- § 9.3 未解决依赖 → 验证 Spec Scope 对应需求标记为 `blocked`。缺失 → 提示用户回 `/workflow-spec` 修订

> ⚠️ Plan 阶段不得基于 § 9 讨论记录发明 spec 中不存在的任务。发现偏差一律回 `/workflow-spec` 修订。

### Self-Review

Plan 扩写完成后**调 CLI**,不再人工扫 plan body:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js plan-review
```

返回 JSON:
- `ready: false` → 按 `lints.placeholder.hits` / `coverage.uncovered_ids` / `lints.anchor_integrity`(Phase B 后)逐项修复 → 重跑直到 `ready: true`
- `ready: true` → 进入 Step 3

详细 lint 项与 ready 矩阵见 [`references/plan-self-review.md`](references/plan-self-review.md)。

## Step 3: 🛑 规划完成

状态结果:`status=planned`、`plan_file` / `current_tasks` 就绪,后续由 `workflow-execute` 接管。

**输出摘要**:直接 paste `plan-review` 返回 JSON 的 `summary` + `confidence` + `coverage` 字段,顺序:
1. `summary.paths`(Spec/Plan 路径)
2. `summary.req_stats` + `summary.task_count`
3. `confidence`(score / level / breakdown)—— CLI 已按 rubric 算分,不再人工逐项自检
4. `summary.task_table`(Task / 阶段 / 主要产出 / 依赖 / Interaction)
5. `summary.interaction_legend`
6. `lints` 摘要(warnings 非空时列出)

**下一步**(回复编号继续,或 `/clear` 后敲对应命令):
1. `/workflow-execute` — 实施(默认每 task 起 fresh implementer subagent + spec/quality 两段 review,task 间顺序执行)［上下文大时先 `/clear`:execute 从 state + plan.md 恢复,清理无损失］
2. `/collaborating-with-codex --review plans/<filename>.md` — 让 Codex 先审一遍 Plan
