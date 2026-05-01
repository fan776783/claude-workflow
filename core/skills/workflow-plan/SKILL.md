---
name: workflow-plan
description: "/workflow-plan 入口。在已审批 Spec 的基础上扩写详细 Plan（实施计划）。前置：/workflow-spec 已完成且 status=planned。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行(project-config → repo-context → 受影响的 code-specs → glossary)。只有跳过条件成立时才可跳过。
</PRE-FLIGHT>

<PATH-CONVENTION>
所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。
该路径在 `npm install` 后始终存在，所有 agent 共享，无需动态解析。
</PATH-CONVENTION>

<CLI-CONTRACT>
**workflow_cli.js 是 planning 状态机的唯一写入口**。

Step → 必调命令映射：

| Step | 必调子命令 | 作用 |
|------|----------|------|
| Step 1 开始前 | `status` | 健康检查：`plan_file` 就绪、`status=planned`、`current_tasks` 非空 |

⚠️ Plan 骨架由 `/workflow-spec` Step 5 的 `spec-review --choice "Spec 正确，生成 Plan"` 生成。本 skill 不创建骨架，只在骨架上 Edit 扩写。
</CLI-CONTRACT>

# workflow-plan

> 本 skill 是 `/workflow-plan` 的完整行动指南。在 `/workflow-spec` 审批通过后，将已审批的 Spec 转化为可执行的 Plan。

<HARD-GATE>
三条不可违反的规则：
1. Plan 中不允许任何 TBD/TODO/占位符
2. 用 Edit 扩写骨架内容，**禁止 Write 全量覆盖 plan.md**
3. 禁止修改 CLI 已生成的 task ID，**尤其是首个 task ID**
</HARD-GATE>

## Checklist（按序执行）

1. ☐ 状态检查 + 上下文加载
2. ☐ Plan 扩写（在 CLI 骨架上）+ Self-Review
3. ☐ Codex Plan Review（条件，bounded-autofix）
4. ☐ 🛑 规划完成（Hard Stop）

---

## Step 1: 状态检查 + 上下文加载

**前置状态**：`/workflow-spec` 已完成，CLI 已生成 plan.md 骨架，`status=planned`。

**健康检查**：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js \
  --project-root "$PWD" status
```

确认 `status=planned`、`plan_file` 已就绪、`current_tasks` 非空。状态异常时停下提示用户：
- `spec_review` → 提示先执行 `/workflow-spec` 完成 Spec 审批
- `idle` → 提示先执行 `/workflow-spec` 启动规划
- `running` / `paused` / `failed` → 提示使用 `/workflow-execute` 恢复执行

**上下文加载**：

- 读取 `spec.md`（**唯一规范输入**）
- 读取 `analysis-result.json`（仅作为文件规划与复用提示的辅助上下文）
- 读取 spec.md § 9（仅做一致性校验，不从中生成新任务）

---

## Step 2: Plan 扩写（在 CLI 骨架上）+ Self-Review

**目的**：在 `/workflow-spec` Step 5 approve 分支 CLI 生成的 `plan.md` 骨架上扩写详细实施计划。

**宣告**：`📋 Phase 2: Plan 扩写`

**扩写硬约束**（违反会破坏执行期状态机）：

- 用 Edit 扩写骨架内容，**禁止 Write 全量覆盖 plan.md**
- 禁止修改 YAML front matter（特别是 `spec_file` / `status` / `role_profile` / `context_profile`）
- 禁止修改 `plan_file` 路径或重命名 plan 文件
- 禁止修改 CLI 已生成的 task ID，**尤其是首个 task ID**（`task_manager` / `execution_sequencer` 依赖 `current_tasks[0]` 定位起点）
- 扩写仅限每个 task 内部的步骤、代码块、验证命令、Patterns / Mandatory Reading；新增 task 必须放在现有 task 之后，不得插入或重排

**输出**：在 CLI 已生成的 `.claude/plans/{task-name}.md` 骨架上 Edit 扩写（骨架使用 [`../../specs/workflow-templates/plan-template.md`](../../specs/workflow-templates/plan-template.md)）

### 设计原则

- **Spec-Normative** — spec.md 是唯一规范输入
- **File Structure First** — 先列文件清单，再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟的原子操作
- **Complete Code** — 每步包含完整代码块（不是伪代码或描述）
- **Exact Commands** — 验证命令包含预期输出
- **No Placeholders** — 禁止 TBD / TODO / "类似 Task N" / 模糊描述
- **WorkflowTaskV2 Compatible** — 任务块使用 `## Tn:` 标题和 V2 字段
- **Spec Section Ref** — 每步标注对应的 spec 章节

### No Placeholders 规则

以下内容在 plan 中出现即为 **plan failure**：
- "TBD"、"TODO"、"implement later"
- "Add appropriate error handling" / "add validation"
- "Write tests for the above"（未提供实际测试代码）
- "Similar to Task N"（必须重复代码，读者可能乱序阅读）
- 仅描述"做什么"但不展示"怎么做"的步骤
- 引用未在任何 task 中定义的类型或函数

### 任务结构

每个 task 包含：

- `## Tn: [组件名]` — 标题
- **阶段**: implement / test / config
- **Package**: 任务归属的 package
- **创建/修改/测试文件**: 精确路径
- **Spec 参考**: 对应的 spec 章节编号
- **验收项**: AC-xxx
- **验证命令** + **预期输出**
- **步骤**: S1 写测试 / S2 实现代码 / S3 运行验证

### Pattern Discovery

从代码分析结果提取可复用的代码模式，生成 `Patterns to Mirror` 和 `Mandatory Reading` 区块。引用必须指向真实存在的代码文件和符号。

### Confidence Score

基于覆盖率、模式数量、约束数量、测试策略综合评分（1-10），写入 plan Metadata。

### Discussion Drift Check

若 spec.md § 9 包含方案选择或未解决依赖：
- § 9.2 方案选择存在 → 验证 Spec Architecture 章节是否反映该方案。偏差 → 提示用户回 `/workflow-spec` 修订 Spec
- § 9.3 未解决依赖存在 → 验证 Spec Scope 对应需求标记为 `blocked`。缺失 → 提示用户回 `/workflow-spec` 修订

> ⚠️ Plan 阶段不得基于 § 9 讨论记录发明 spec 中不存在的任务。发现偏差一律提示回 `/workflow-spec` 修订。

### Self-Review

Plan 生成后立即执行。详见 [`references/plan-self-review.md`](references/plan-self-review.md)。必须输出执行摘要：需求覆盖 + placeholder 扫描 + 跨 task 一致性结果。

---

## Step 3: Codex Plan Review（条件，bounded-autofix）

**目的**：从技术可行性角度review Plan，发现实现顺序问题、缺失步骤和集成风险。

**Phase 编号**：2.5.5（conditional `machine_loop`）

**治理模式**：`bounded-autofix` — Codex 发现经当前模型验证后，可自动修复 Plan 并重跑 Self-Review。

**触发条件**：从 `workflow-state.json` 的 `context_injection.planning.codex_plan_review.triggered` 读取。

**未触发时**：输出 `⏭️ Codex Plan Review: skipped`，直接进入 Step 4。

**执行workflow**：详见 [`references/codex-plan-review.md`](references/codex-plan-review.md)。

**预算**：max_attempts = 2（1 次 Codex review + 最多 1 次修复后复审）。Provider 失败立即降级。

**摘要输出**：
```
🔍 Codex Plan Review: {n} issues found, {m} fixed
```

---

## Step 4: 🛑 规划完成（Hard Stop）

**状态结果**：

- `status=planned`，`plan_file` / `current_tasks` 就绪
- 后续由 `workflow-execute` skill 接管执行

**输出摘要**：展示 Spec 路径、Plan 路径、需求统计、任务数量、Confidence Score。

**下一步提示**：

1. review `spec.md` 和 `plan.md`
2. 使用 `workflow-execute` 开始实施

---

## 产物路径速查

| 产物 | 路径 |
|------|------|
| Spec 文档 | `.claude/specs/{task-name}.md` |
| Plan 文档 | `.claude/plans/{task-name}.md` |
| 状态文件 | `~/.claude/workflows/{projectId}/workflow-state.json` |
| 代码分析 | `~/.claude/workflows/{projectId}/analysis-result.json` |

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-spec` | Spec 生成 + 设计深化 + 用户审批（前置步骤） | [`../workflow-spec/SKILL.md`](../workflow-spec/SKILL.md) |
| `workflow-execute` | 按 Plan 推进任务执行 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| `workflow-review` | 全量完成review（execute 完成后独立执行） | [`../workflow-review/SKILL.md`](../workflow-review/SKILL.md) |
| `dispatching-parallel-agents` | 并行子 Agent 分派 | [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md) |

> CLI 入口：`~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js`
>
> 运行时资源参见 [`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
