---
name: workflow-plan
description: "Use when /workflow-spec 已审批通过且 status=planned, or 用户调用 /workflow-plan 在已审批 Spec 基础上扩写实施计划, or 用户说\"扩写实施计划 / 详细 task 拆分\"且已有审批过的 spec。"
---

> 路径约定 + CLI 写入契约见 [`../../specs/shared/pre-flight.md`](../../specs/shared/pre-flight.md) § Workflow CLI 路径约定。
>
> Plan 骨架由 `/workflow-spec` Step 7 的 `spec-review --choice "Spec 正确，生成 Plan"` 生成。本 skill 不创建骨架,只在骨架上 Edit 扩写。

# workflow-plan

<HARD-GATE>
1. Plan 中不允许任何 TBD/TODO/占位符
2. 用 Edit 扩写骨架,**禁止 Write 全量覆盖** plan.md
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

确认 `status=planned`、`plan_file` 已就绪、`current_tasks` 非空。状态异常时停下提示:
- `spec_review` → 先执行 `/workflow-spec` 完成 Spec 审批
- `idle` → 先执行 `/workflow-spec` 启动规划
- `running` / `paused` / `failed` → 用 `/workflow-execute` 恢复

**上下文加载**:`spec.md`(唯一规范输入)+ `analysis-result.json`(辅助上下文,文件规划与复用)+ spec.md § 9(仅做一致性校验,不从中生成新任务)。

## Step 2: Plan 扩写 + Self-Review

**宣告**:`📋 Phase 2: Plan 扩写`

**扩写硬约束**(违反会破坏执行期状态机；Hard Gate 已列其要):
- 禁止修改 YAML front matter(`spec_file` / `status` / `role_profile` / `context_profile`)
- 禁止修改 `plan_file` 路径或重命名 plan 文件
- 扩写仅限每个 task 内部的步骤、代码块、验证命令、Patterns / Mandatory Reading;新增 task 必须放在末尾,不得插入或重排

**输出**:在 CLI 已生成的 `~/.claude/workflows/{pid}/plans/{task-name}-{MMDD}.md` 骨架上 Edit 扩写(骨架使用 [`../../specs/workflow-templates/plan-template.md`](../../specs/workflow-templates/plan-template.md))。

### 设计原则

- **Spec-Normative** — spec.md 是唯一规范输入
- **File Structure First** — 先列文件清单,再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟原子操作
- **Actionable Steps** — 每步描述精确到文件、函数、行为。代码块仅用于非显然模式（复杂正则、算法、配置结构），不要求全文件内容
- **Exact Commands** — 验证命令包含预期输出
- **No Placeholders** — 禁止 TBD / TODO / "类似 Task N" / 模糊描述
- **WorkflowTaskV2 Compatible** — 任务块用 `## Tn:` 标题和 V2 字段
- **Spec Section Ref** — 每步标注对应的 spec 章节

### No Placeholders 规则

以下出现即为 plan failure:`TBD` / `TODO` / `implement later` / `Add appropriate error handling` / `add validation` / `Write tests for the above`(无实际测试代码) / `Similar to Task N`(必须重复代码,读者可能乱序) / 仅描述"做什么"不展示"怎么做" / 引用未在任何 task 定义的类型或函数。

### 任务结构

每个 task 含:`## Tn: [组件名]` 标题 + **阶段** (implement/test/config) + **Package** + **创建/修改/测试文件**(精确路径) + **Spec 参考** + **验收项 AC-xxx** + **验证命令 + 预期输出** + **步骤** (S1 写测试 / S2 实现 / S3 运行)。

### Pattern Discovery

从代码分析结果提取可复用模式,生成 `Patterns to Mirror` 和 `Mandatory Reading` 区块。引用必须指向真实存在的代码文件和符号。

### Confidence Score

基于以下 rubric 综合评分(1-10),写入 plan body 的 Metadata 区块和 Step 4 输出摘要;**不**写 plan front matter(CLI 不消费):

| 维度 | 分值 | 触发条件 |
|------|-----|---------|
| PRD 覆盖率 | +3 | ≥ 90% |
| Patterns to Mirror | +2 | 引用 ≥ 3 个真实存在的模式 |
| 验证命令带预期输出 | +3 | 每个 task 的 `验证` 含期望输出比对 |
| 测试 task 存在 | +2 | plan 中有显式 `phase: test` 任务 |

满分 10;基础分 0,触发条件全满则 10。低于 6 分时在摘要中标注 `confidence=low,建议 review`。

### Discussion Drift Check

若 spec.md § 9 包含方案选择或未解决依赖:
- § 9.2 方案选择 → 验证 Spec Architecture 反映该方案。偏差 → 提示用户回 `/workflow-spec` 修订
- § 9.3 未解决依赖 → 验证 Spec Scope 对应需求标记为 `blocked`。缺失 → 提示用户回 `/workflow-spec` 修订

> ⚠️ Plan 阶段不得基于 § 9 讨论记录发明 spec 中不存在的任务。发现偏差一律回 `/workflow-spec` 修订。

### Self-Review

Plan 生成后立即执行,详见 [`references/plan-self-review.md`](references/plan-self-review.md)。必须输出执行摘要:需求覆盖 + placeholder 扫描 + 跨 task 一致性结果。

> **Runtime 兼容性**: `planning_gates.js` 可能在 state 中写入 `codex_plan_review.triggered = true`。该字段现为 no-op——runtime 写入但 skill 不再消费。

## Step 3: 🛑 规划完成

状态结果:`status=planned`、`plan_file` / `current_tasks` 就绪,后续由 `workflow-execute` 接管。

输出摘要:Spec 路径、Plan 路径、需求统计、任务数量、Confidence Score。

下一步:review `spec.md` 与 `plan.md` → `/workflow-execute` 开始实施。
