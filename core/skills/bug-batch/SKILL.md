---
name: bug-batch
description: "批量修缺陷——从蓝鲸项目管理平台一次性拉一批 Bug，先做全量分析找出重复和共享根因再成组修，避免逐条打补丁。适合清积压、集中处理同一模块多个相关问题，或需要统一验证一组接口改动。项目 ID 从 project-config.json 的 project.bkProjectId 读取。"
---

# 批量缺陷修复

先分析全部缺陷，再按修复单元顺序执行。不要在缺少关系判断时直接逐条修复。

## 用法

```bash
/bug-batch                                        # 使用保存的经办人
/bug-batch <operator_user>                        # 显式指定经办人（并更新配置）
/bug-batch fanjj --state 待处理 --priority HIGH
```

参数：
- `operator_user`：经办人用户名，使用公司邮箱 `@` 前的部分。显式传入时覆盖当前会话取值，并写回用户配置
- `--state`：缺陷状态筛选，默认 `待处理`
- `--priority`：优先级筛选，默认全部

## 前置条件

- 读取 `.claude/config/project-config.json` 中的 `project.bkProjectId` 作为蓝鲸项目 ID。若为空或不存在，提示用户先执行 `/scan` 完成项目关联并终止。
- 解析经办人，顺序为：CLI 参数 > 用户配置 `~/.claude/agent-workflow/config.json` 的 `bugBatch.operatorUser` > 首次交互询问并回写到该文件。详见 Phase 0。

## 核心概念

### IssueRecord

将蓝鲸缺陷标准化为统一记录，至少保留：
- `issue_number`
- `title`
- `description`
- `reproduction_steps`
- `priority`
- `state`
- `operator_user`
- `reporter`
- `created_at`
- `screenshots`
- `module_hint`

### RelationType

只使用以下关系：
- `duplicate_of`：重复缺陷，不单独创建编码动作
- `same_root_cause`：共享根因，通常合并进同一修复单元
- `coupled_with`：强耦合，拆开修复会提高冲突或回归风险
- `blocked_by`：依赖其他缺陷或修复单元先完成
- `needs_manual_judgement`：关系不明确，必须人工裁决

### FixUnit

将实际修复粒度定义为 `FixUnit`，包含：
- `unit_id`
- `primary_issue`
- `included_issues`
- `duplicate_issues`
- `blocked_by_units`
- `shared_root_cause`
- `affected_scope`
- `validation_scope`
- `merge_reason`：合并动机，取值 `primary` / `same_root_cause` / `coupled_with`
- `execution_status`：执行状态（见下方）
- `manual_intervention_reason`：当 `execution_status = manual_intervention` 时必填
- `covered_by_unit`：当 `execution_status = covered_by_other` 时，指向覆盖它的 FixUnit

### 执行状态

| 状态 | 含义 | 出现阶段 |
|------|------|---------|
| `pending` | 已编排，等待进入修复 | Phase 4 完成后 |
| `blocked` | 被 `blocked_by_units` 阻塞 | Phase 5 分层调度中 |
| `in_progress` | 子 agent 正在修复 | Phase 5 |
| `completed` | 修复完成并通过单元级 review + 物化 | Phase 5.5 |
| `no_change_needed` | 根因已不存在，无需修改 | Phase 5.5.3 |
| `covered_by_other` | 问题已被其他 FixUnit 覆盖 | Phase 5.5.3 |
| `manual_intervention` | 需要人工介入，必须附 `manual_intervention_reason` | Phase 5 / 5.5 / 6 / 7 |

### manual_intervention 原因枚举

| 原因 | 触发位置 | 说明 |
|------|---------|------|
| `root_cause_mismatch` | Phase 5 子 agent | 根因复核失败，代码与描述不符 |
| `verification_failed` | Phase 5 子 agent | 验证命令连续 3 次失败 |
| `out_of_scope` | Phase 5 子 agent | 修改文件超出 `files_to_modify` |
| `review_rejected` | Phase 5.5.1 | 单元级 review 发现 P0/P1 问题 |
| `materialization_failed` | Phase 5.5.2 | 物化失败且无法自动恢复 |
| `cross_unit_conflict` | Phase 5.5.5 / Phase 6 | 批量级 review 或交叉影响分析发现不兼容 |
| `user_rejected` | Phase 7 | 用户在全量确认时不认可 |
| `ambiguous_empty_change` | Phase 5.5.3 | 无实际修改但原因不明确 |
| `cover_unit_failed` | Phase 5.5 | 作为 covered_by_other 所依赖的覆盖单元失败 |

## 执行纪律

### 状态标签

每个 Phase 开始时输出对应标签：

```
[PHASE:0/CONFIG]       读取项目配置与经办人
[PHASE:1/FETCH]        拉取缺陷清单
[PHASE:2/NORMALIZE]    标准化 IssueRecord
[PHASE:3/ANALYZE]      全量分析
[PHASE:4/PLAN]         编排 FixUnit
[HARD-STOP:CONFIRM-PLAN]          等待用户确认编排方案
[PHASE:5/FIX]                     并行修复执行
[PHASE:5.5/REVIEW]                单元级 review（主会话）+ 物化 + 即时流转到处理中 + 批量级 review
[HARD-STOP:CONFIRM-BATCH-REVIEW]  是否执行批量级 codex review
[HARD-STOP:BATCH-REVIEW-BLOCKER]* 批量级 review 发现阻断性问题（条件性）
[PHASE:6/CROSS]                   跨单元交叉影响分析
[HARD-STOP:CROSS-CONFLICT]*       交叉影响分析发现严重冲突（条件性）
[HARD-STOP:CONFIRM-COMMIT]        等待用户确认全量结果
[HARD-STOP:REJECTED-UNIT-ACTION]* 用户不认可某 FixUnit 时的处理选择（条件性）
[HARD-STOP:DEPENDENCY-CONFLICT]*  拒绝单元与确认单元存在依赖冲突（条件性）
[HARD-STOP:REBUILD-CONFLICT]*     Phase 7 重建 cherry-pick 冲突或验证失败（条件性）
[HARD-STOP:BRANCH-REWRITE]*       协调分支不可改写（条件性）
[PHASE:7/COMMIT]                  提交 Commit + 待验证流转
[PHASE:8/REPORT]                  汇总报告
```

带 `*` 的 Hard Stop 为条件性触发。

### Hard Stop 行为规范

Hard Stop 是强制交互节点。输出 `[HARD-STOP:...]` 标签后：

1. 停止所有代码修改、状态流转、子 agent 调度
2. 向用户展示规定格式的确认内容
3. 等到用户明确输入（Y/N 或具体指令）再继续

等待期间不要继续分析或编码、不要把"用户未反对"当作确认、不要自动生成默认回答——这些都等同于跳过 Hard Stop。

### 前置条件检查

每个 Phase 入口必须验证上游产出：

| Phase | 前置条件 |
|-------|---------|
| Phase 3 | Phase 2 已输出所有 IssueRecord，无缺失 |
| Phase 4 | Phase 3 已完成所有缺陷的关系识别，`needs_manual_judgement` 项已明确标注 |
| Phase 5 | 用户已在 `[HARD-STOP:CONFIRM-PLAN]` 处给出明确确认 |
| Phase 5.5 | Phase 5 所有 Task 已达终态，结果已收集 |
| Phase 6 | Phase 5.5 单元级 review、即时流转、批量级 review 均已完成，`batch_review_summary` 已记录 |
| Phase 7 | 用户已在 `[HARD-STOP:CONFIRM-COMMIT]` 处给出明确确认 |

### 子 agent 执行纪律

Phase 5 的修复子 agent 收到的是已确认的根因和方案，执行范围严格限定。允许与禁止行为、输入/输出契约、失败终止规则统一由 `references/fix-protocol.md` 定义；主会话向子 agent 下发任务时必须包含该协议中的 `execution_constraints`，作为单一事实来源。

## 按需读取的参考文件

- `references/analysis-and-planning.md`：分析视图、关系矩阵、FixUnit 编排示例、Task 树预览
- `references/status-and-reporting.md`：分层 review 汇总、状态流转示例、人工确认卡点、汇总报告模板
- `references/fix-protocol.md`：子 agent 输入/输出契约、执行规范
- `references/coverage-graph.md`：`covered_by_other` 图规范化、终点解析、失败级联传递
- `references/commit-rebuild.md`：Phase 7 协调分支重建、git 事务、Hard Stop 触发清单

## 执行流程

```text
Phase 0:   读取项目配置
Phase 1:   拉取缺陷清单
Phase 2:   获取详情并标准化 IssueRecord
Phase 3:   全量分析（根因初判 / 重复识别 / 耦合识别 / 依赖分析）
Phase 4:   编排 FixUnit 并等待批量确认（Hard Stop）
Phase 5:   按依赖分层并行执行修复
Phase 5.5: 单元级 review + 物化 + 单元即时流转到"处理中" + 批量级 codex review（可选）
Phase 6:   跨单元交叉影响分析
Phase 7:   全量确认 + 提交 Commit + 流转到"待验证"（Hard Stop）
Phase 8:   输出汇总报告
```

## Phase 0: 读取项目配置

1. 读取 `.claude/config/project-config.json`
2. 提取 `project.bkProjectId` 作为 `project_id`
3. 若为空，提示 `蓝鲸项目未关联，请先执行 /scan 完成项目关联` 并终止
4. 解析经办人 `operator_user`，来源优先级：
   1. CLI 参数：若 `/bug-batch` 传入了 `operator_user`，使用该值，并在本次执行末尾回写用户配置（首次写入或值变更时）
   2. 用户配置：读取 `~/.claude/agent-workflow/config.json`，取 `bugBatch.operatorUser`
   3. 交互询问：两者均缺失时，输出提示 `未检测到经办人账号，请输入蓝鲸经办人用户名（公司邮箱 @ 前的部分；将保存到 ~/.claude/agent-workflow/config.json）`，收到用户输入后写回文件。用户误填完整邮箱时，自动截取 `@` 前的部分再写入
5. 写入用户配置结构，保留文件中其它字段：

```json
{
  "bugBatch": {
    "operatorUser": "<username>"
  }
}
```

读取与写入规则：目录不存在时自动创建 `~/.claude/agent-workflow/`；文件不存在或 JSON 解析失败时视为空对象；仅更新 `bugBatch.operatorUser`，不得覆盖其它顶层键。

## Phase 1: 拉取缺陷清单

调用 `mcp__mcp-router__list_issues` 拉取缺陷列表，筛选规则：

| 筛选维度 | 调用策略 |
|---------|---------|
| 经办人 `operator_user` | 若 MCP 支持 operator 参数，优先在调用时过滤；否则拉全量再在主会话中按 `operator_user` 字段匹配 |
| 状态 | 默认 `待处理`，可被 `--state` 覆盖 |
| 优先级 | `--priority` 指定时过滤；未指定则保留全部 |

缺陷量过大时可分页拉取，但进入 Phase 3 前必须形成完整分析视图。无匹配缺陷直接告知用户并终止。

## Phase 2: 获取详情并标准化 IssueRecord

对每个缺陷调用 `mcp__mcp-router__get_issue(issue_number)`，提取标题、描述、复现步骤、优先级、状态、创建时间、创建人、经办人、截图、链接、日志片段、模块关键词、接口名、页面路径、错误码等上下文线索。多个 `get_issue` 调用在单条消息里并行发起，批量拉取时按 ~10 个一组并发。

标准化时补充：`symptom_summary` / `entry_point` / `module_hint` / `risk_hint` / `suspected_root_cause`。

排序只服务展示：优先级高者在前，同优先级按创建时间升序。

## Phase 3: 全量分析

先分析全部缺陷，再决定如何修复。此阶段禁止开始编码。

### 根因初判

对每个 `IssueRecord` 输出：初步根因假设、受影响模块、可能涉及的代码入口、风险等级、是否需要与其他缺陷联动处理。

### Code Specs 对照

对每个初步根因按 `module_hint` 定位对应 code-spec（逻辑同 fix-bug Phase 1.2 第 3 步）：

- 读 `.claude/code-specs/{pkg}/{layer}/index.md` 的 Guidelines Index 表，匹配具体 convention/contract 文件
- 命中已有 Common Mistake → 在 IssueRecord 附加 `spec_hint: "{pkg}/{layer}/{file}.md § {H3 子标题}"`
- 未命中 → 不附加
- `.claude/code-specs/` 不存在时整体跳过本步骤，不阻断

`spec_hint` 是 Phase 5.5.1 定档 `code_specs_impact` 的参考输入，也用于 Phase 8 跨单元归纳；不改变 Phase 3 的关系识别结论。

### 关系识别

- `duplicate_of`：复现路径、错误现象、预期行为和根因证据高度一致
- `same_root_cause`：表象不同，但最终落到同一代码路径、同一状态源或同一接口约束
- `coupled_with`：修改文件和验证范围高度重叠，拆开修复会产生冲突或重复改动
- `blocked_by`：当前缺陷必须等待另一个缺陷或修复单元先完成，才能稳定验证
- 无法确认时标记为 `needs_manual_judgement`，禁止自动合并

展示分析结果时，读取 `references/analysis-and-planning.md` 中的模板。

## Phase 4: 编排 FixUnit 并等待批量确认（Hard Stop）

根据分析结果生成 `FixUnit`：
- 将重复缺陷归并到主缺陷所在单元，不创建独立编码任务
- 将共享根因缺陷和强耦合缺陷按最小改动原则合并
- 将阻塞关系表达为 `blocked_by_units`
- 将关系不明确的项保留为独立单元，并在确认阶段请求人工裁决

选择 `primary_issue` 优先级：优先级更高者优先 → 创建时间更早者优先 → 描述更稳定、更完整者优先。

展示 FixUnit 编排结果时读取 `references/analysis-and-planning.md` 中的模板，然后调用 `AskUserQuestion` 收集决策，`question` 写"FixUnit 编排是否进入修复？"，`options` 给三条：

- `confirm_plan` — 确认编排方案，进入 Phase 5 按依赖分层修复
- `revise_plan` — 需要调整编排（合并/拆分 FixUnit、重选 primary_issue），本 skill 按反馈重排后再次询问
- `reduce_scope` — 批次范围过大，缩小缺陷集合后重新从 Phase 3 开始

在收到用户选择前不得继续进入修复。

## Phase 5: 按依赖分层并行执行修复

`[PHASE:5/FIX]`

进入前置条件：用户已在 `[HARD-STOP:CONFIRM-PLAN]` 处确认。

**本阶段不调用 fix-bug skill。** 使用内部修复协议（见 `references/fix-protocol.md`），避免嵌套 Hard Stop 和重复分析。

### 5.1 构建 Task 树

为每个 FixUnit 创建一个 Claude Code Task，用 `blockedBy` 表达依赖拓扑：

- 每个 FixUnit 对应一个 Task，subject 为 `fix:<unit_id>`
- `blocked_by_units` 中的每个上游 unit_id 对应的 Task ID 填入 `addBlockedBy`
- Layer 0（无依赖）的 Task 创建后立即推进为 `in_progress`
- Layer N 的 Task 初始状态为 `pending`，等待 `blockedBy` 中所有 Task completed 后再推进

### 5.2 拓扑分层

根据 `blocked_by_units` 构建依赖图：

```text
Layer 0: 无任何 blocked_by_units 的 FixUnit（可立即并行执行）
Layer 1: 仅依赖 Layer 0 中单元的 FixUnit（Layer 0 全部完成后并行执行）
Layer N: 依赖 Layer 0..N-1 中单元的 FixUnit
```

### 5.3 worktree 隔离策略

| 场景 | 策略 |
|------|------|
| 同层 2+ FixUnit 且 `affected_scope` 无文件交集 | 各自 worktree 并行执行 |
| 同层 2+ FixUnit 但存在文件交集 | 有交集的 FixUnit 降级串行 |
| 同层仅 1 个 FixUnit | 主工作树直接执行，不需要 worktree |

worktree provisioning 完成后，再并行启动子 agent。

**路径与命名**：
- 根目录：`<repo_root>/../bug-batch-worktrees/`（与仓库同级）
- worktree 目录：`<root>/<unit_id>`
- 分支名：`fix/<unit_id>`，从协调分支拉出
- `diff_base`：协调分支当前 HEAD

**清理策略**：
- 物化成功的 FixUnit：worktree 和分支保留到 Phase 7 结束；Phase 7 commit 完成并流转到"待验证"后统一清理
- 物化失败 / `manual_intervention` 的 FixUnit：保留 worktree 和分支供人工介入，路径写入 Phase 8 汇总报告
- 用户在 Phase 7 选择"放弃修改"的 FixUnit：保留 7 天

### 5.4 内部修复协议

为每个 FixUnit 的子 agent 提供精简输入：
- `unit_id`、`primary_issue`、`included_issues`、`duplicate_issues`
- `shared_root_cause`、`confirmed_root_cause_location`
- `confirmed_fix_plan`（修复方案 + files_to_modify + test_command）
- `affected_scope`、`validation_scope`、`execution_constraints`

子 agent 执行步骤（无 Hard Stop）：
1. 根因复核（只读验证代码中是否仍存在描述的问题）
2. 实施修复（按 confirmed_fix_plan，只改 files_to_modify）
3. 运行验证（test_command 或手动步骤）
4. 输出结构化结果

输入/输出契约详见 `references/fix-protocol.md`。

### 5.5 执行纪律

- 同一层内的独立 FixUnit **并行执行**
- `blocked_by_units` 未解除时保持 `blocked`
- `duplicate_issues` 只参与验证和状态流转，不触发独立编码
- 某个单元失败后，只阻塞其依赖链，不阻塞无关单元
- 同层仅 1 个 FixUnit 时退化为串行

### 5.6 Task 状态推进

| 子 agent 结果 | Task 操作 | FixUnit 状态 | 附加字段 |
|--------------|-----------|-------------|---------|
| `files_changed` 非空且 `root_cause_confirmed = true` | `TaskUpdate(status: completed)` | `completed`（待 5.5 review 与物化） | - |
| `root_cause_obsolete: true`（files_changed 为空） | `TaskUpdate(status: completed)` | `no_change_needed` | - |
| `covered_by_other_unit` 指名覆盖单元（files_changed 为空） | `TaskUpdate(status: completed)` | `covered_by_other` | `covered_by_unit: <unit_id>` |
| `root_cause_mismatch: true` | `TaskUpdate(status: completed)` | `manual_intervention` | `reason: root_cause_mismatch` |
| 连续 3 次验证失败 | `TaskUpdate(status: completed)` | `manual_intervention` | `reason: verification_failed` |
| 修改文件超出 `files_to_modify` | `TaskUpdate(status: completed)` | `manual_intervention` | `reason: out_of_scope` |
| `files_changed` 为空且四种信号均未给出 | `TaskUpdate(status: completed)` | `manual_intervention` | `reason: ambiguous_empty_change` |

Layer N 的 Task 解除阻塞规则：所有 `blockedBy` Task completed 后，按前置 FixUnit 终态决定下游行为：

| 前置组合 | 下游行为 |
|---------|---------|
| 所有前置均为 `completed` | 推进为 `in_progress` 并启动子 agent |
| 所有前置均为 `completed` 或 `no_change_needed` | 推进为 `in_progress`（依赖的问题已不存在，下游可继续推进） |
| 任一前置为 `covered_by_other` | 下游的 `blocked_by_units` 中该项自动重定向到 `covered_by_unit` 指向的覆盖单元；重新判断 |
| 任一前置为 `manual_intervention` | 当前 FixUnit 保持 `blocked`，附带原因：上游 `<unit_id>` 需人工介入 |

### 5.7 收集结果

每个 FixUnit 至少收集：`root_cause_confirmed`、`files_changed`、`issues_fixed_directly`、`issues_covered_as_duplicates`、`verification_summary`、`residual_risks`、`status_transition_ready`、`materialization_artifact`（与 `files_changed` 严格联动）。

## Phase 5.5: 单元级 review + 即时流转 + 批量级 review

`[PHASE:5.5/REVIEW]`

进入前置条件：Phase 5 所有 Task 已达终态，结果已收集。

**终态分流**（进入 5.5.1 前先做）：

| 终态 | 处理路径 | 进 5.5.1/5.5.2 | 参与状态流转 |
|------|---------|---------------|-------------|
| `completed` | 单元级 review + 物化 + 即时流转 | 是 | 是（独立流转到"处理中"） |
| `no_change_needed` | 跳过 review/物化；登记到 Phase 8 关闭建议列表 | 否 | 否 |
| `covered_by_other` | 跳过 review/物化；缺陷加入覆盖单元的 `transition_set` | 否 | 是（并入覆盖单元） |
| `manual_intervention` | 跳过 review/物化；登记到 Phase 8 人工介入列表 | 否 | 否 |

**顺序**（不得颠倒）：

1. **先做 `covered_by_other` 图规范化**：对整个 `covered_by_unit` 图做终点解析，把所有异常图结构（环、悬空引用、非 completed 终点、入环前缀）显式降级为 `manual_intervention`。详细规则见 `references/coverage-graph.md` 第 2 节。
2. **再做前置快速检查**：规范化完成后若所有 FixUnit 均非 `completed`，直接跳过 5.5.1–5.5.2 到 Phase 8 输出报告，向用户说明"本批次无可交付的修复单元"。

### 5.5.1 单元级 review

对 `status_transition_ready = true` 的单元逐个审查（此时尚未物化，review 在 worktree / 子分支 diff 上进行）。

**由主会话直接审查 diff，不调用 codex。** codex review 只在批量级（5.5.4）按需触发。

审查内容：根因修复是否落地到 `files_changed`；是否遵循最小改动；验证结果是否覆盖 `validation_scope` 与 `duplicate_issues`；是否引入明显回归风险。

review 不通过（P0/P1 问题）按 `references/coverage-graph.md` 第 4 节的两步顺序处理：先执行失败级联，再将该单元标记 `manual_intervention` + `review_rejected`。

**顺带定档 Code Specs Impact**：主会话在审阅每个通过 review 的 FixUnit diff 时，按 fix-bug Phase 4.1 的四档给该单元附加 `code_specs_impact` 字段（和对应 `code_specs_advisory`，规则与 fix-bug 一致）。定档只在单元级 review 环节做一次，Phase 8 的 Code Specs 归纳直接消费这些字段，不再重复分析。子 agent 输出契约不扩展，这一步是主会话职责。

所有单元 review 完成后、物化开始前，输出一次"单元级 review 汇总"表（模板见 `references/status-and-reporting.md` 的"分层 review 汇总"）。

### 5.5.2 结果物化到协调分支

单元级 review 通过的 FixUnit，按 `materialization_artifact` 落回协调分支。

**每个 FixUnit 必须以独立 commit 形式落到协调分支**，便于 Phase 7 按单元 cherry-pick 重建：

- 在第一个单元物化**之前**，记录协调分支当前 HEAD SHA 到 `pre_bug_batch_base`（Phase 7 重建基线）
- commit message 前缀统一为 `[bug-batch-stage] <unit_id>:`
- 每次只物化一个 FixUnit，完成后记录该单元 commit 的 SHA 到 `materialized_commit_sha`
- 不得把多个 FixUnit 合并为一个 commit
- 记录物化顺序到 `materialization_order`（Phase 7 cherry-pick 按此顺序）

**物化方式选择**（见 fix-protocol.md 的 materialization_artifact 定义）：

| artifact.kind | 首选方式 | 降级方式 |
|---------------|---------|---------|
| `worktree` | `cherry-pick <head_commit>` | `git diff <diff_base>..<head_commit>` 生成 patch，`git apply` 后再 commit |
| `working-tree` | 主工作树直接 `git add` + commit | - |
| `patch` | `git apply <patch_path>` 后 commit | - |

物化失败分级：

| 失败原因 | 处置 |
|---------|------|
| cherry-pick 冲突，且冲突原因是同层其它 FixUnit 已物化 | 自动降级为"生成 patch 再 apply" |
| patch apply 冲突，冲突区域 ≤ 3 行且语义不相关 | 尝试 `-3` 三方合并；失败则升级 |
| patch apply 冲突无法自动解决 | 标记 `manual_intervention` + `materialization_failed`，保留 artifact 供人工介入 |
| 基线漂移导致 patch 无法应用 | 提示主会话基于最新协调分支重建 patch；仍失败则标记 `materialization_failed` |

物化成功后记录 `materialized_units`、`materialized_issue_numbers`、`materialization_log`。

被标记为 `materialization_failed` 的单元按 `references/coverage-graph.md` 第 4 节处理：先执行失败级联，再从后续提交集合中移除，在 Phase 8 汇总中保留 artifact 位置。

### 5.5.3 单元即时流转到"处理中"

单元级 review 通过、已物化且 `files_changed` 非空的 FixUnit，立即将覆盖缺陷流转到"处理中"。

**流转前置条件**（全部满足才流转）：review 通过、已物化、`files_changed` 非空、`status_transition_ready = true`。

**无实际修改的处理**：

| 情况 | 状态 | 附加字段 | 处理 |
|------|------|---------|------|
| `files_changed` 为空，`root_cause_obsolete = true` | `no_change_needed` | - | 不流转；Phase 8 建议人工确认后关闭，禁止自动关闭 |
| `files_changed` 为空，`covered_by_other_unit` 指名覆盖单元 | `covered_by_other` | `covered_by_unit: <unit_id>` | 缺陷并入覆盖单元 `transition_set`，随覆盖单元一起流转 |
| `files_changed` 为空，`root_cause_mismatch = true` | `manual_intervention` | `reason: root_cause_mismatch` | 不流转 |
| `files_changed` 为空，四信号均为 false | `manual_intervention` | `reason: ambiguous_empty_change` | 不流转 |

**`covered_by_other` 绑定与失败级联**：`transition_set` 合并、绑定失效判定、传递级联、缺陷状态回退动作，全部集中在 `references/coverage-graph.md`。5.5.5、Phase 6、Phase 7 中任何让覆盖单元离开最终交付集合的路径都必须先调用该级联，再处理覆盖单元自身。

**流转调用**：

```text
update_issue_state(
  issue_number: "<primary_issue 以及 included_issues、duplicate_issues>",
  target_state: "处理中",
  comment: "FixUnit <unit_id> 已完成代码修复与验证，等待全量确认"
)
```

MCP 支持 FixUnit 内批量流转时可合并一次调用，否则按顺序逐条更新。

流转失败处理：
- 网络或接口错误 → 重试 1 次，仍失败则记录到 `transition_failures`，不阻塞其它单元
- 状态不允许转换（如当前已是"待验证"）→ 记录实际状态，跳过

### 5.5.4 批量级 review

所有物化完成后，对协调分支整体评估是否需要跨单元审查。

**Step 1 — 批量影响范围评估**

| 维度 | 评估项 |
|------|--------|
| 已物化单元数 | 数量 |
| 文件交集 | 是否有多个 FixUnit 修改同一文件 |
| 共享依赖 | 是否多个 FixUnit 触及同一公共模块 / 类型 / 接口 |
| 敏感面覆盖 | 单元中是否有任一命中安全 / 核心模块 / 接口契约 |
| 总修改规模 | 文件总数 |

**Step 2 — 建议档位**

| 建议 | 触发条件 |
|-----|---------|
| `recommended` | 已物化单元 ≥ 2 且存在文件交集 / 共享依赖 / 任一敏感面命中 |
| `optional` | 已物化单元 ≥ 2 但无交集、无敏感面 |
| `skip` | 仅 1 个已物化单元 |

**Step 3 — 询问用户（Hard Stop）**

输出 `[HARD-STOP:CONFIRM-BATCH-REVIEW]`，先展示批量影响范围：

```markdown
## 批量级 review 确认

### 批量影响范围
- 已物化单元: <unit_ids>
- 文件交集: <有/无，详情>
- 共享依赖: <有/无，详情>
- 敏感面覆盖: <命中项或"无">
- 总修改文件: <数量>

### 建议
<recommended / optional / skip> — <一句话理由>
```

随后调用 `AskUserQuestion` 收集决策，`question` 写"批量级 review 方式？"，`options` 按档位给出：

- `codex_adversarial` — 启动 codex 对协调分支整体执行 adversarial review
- `self_review` — 主会话直接审查协调分支整体 diff（记录 `batch_review_mode: "self"`）
- `skip` — 跳过批量级 review（仅 1 个已物化单元时可选）

无回复时**停止等待**，不得自动按建议执行。用户显式"本批次后续全部 X"时，可作为批量指令沿用到后续条件性 Hard Stop。

**Step 4 — 执行 review**

同步或后台由规模决定：已物化 FixUnit ≤ 3 且修改文件总量 ≤ 10 → 同步；否则追加 `--background` 后台执行，进入 Phase 6 前用 `--status <jobId>` 等待完成。

```bash
node scripts/codex-bridge.mjs \
  --cd "<repo_root>" \
  --adversarial-review working-tree \
  [--background] \
  --prompt "FOCUS: Cross-unit batch review. Units: <unit_ids>. Evaluate: inter-unit conflicts, shared dependency compatibility, interface contract breaks, regression coverage."
```

按用户选择分支：
- `codex_adversarial` → 启动 codex adversarial review
- `self_review` → 主会话直接审查协调分支整体 diff，记录 `batch_review_mode: "self"` 后继续
- `skip` → 记录 `batch_review_mode: "skipped"` 进入 Phase 6

### 5.5.5 结论处理

记录为 `batch_review_summary`，分三档：

- **无重大问题**：继续 Phase 6
- **跨单元兼容性问题**：按 `references/coverage-graph.md` 第 4 节两步处理——先执行失败级联，再将受影响 FixUnit 标记 `manual_intervention` + `cross_unit_conflict`；该单元自身修复的缺陷已在"处理中"，保持不变，但从 Phase 7 提交集合中移除
- **阻断性问题**：触发 `[HARD-STOP:BATCH-REVIEW-BLOCKER]`，调用 `AskUserQuestion` 收集决策，`question` 写"批量级 review 发现阻断性问题，如何处理？"，`options` 给三条：

  - `ignore_and_continue` — 继续推进（忽略警告，进入 Phase 6；仅在用户明确判定为误报时选择）
  - `drop_affected_units` — 仅剔除受影响单元（先执行失败级联；再把 review 点名的 FixUnit 标记 `cross_unit_conflict`；物化代码保留在协调分支）
  - `abort_batch` — 放弃本批次全部已物化修改（先对每个作为 `covered_by_unit` 的已物化单元执行失败级联；再回滚协调分支上所有已物化 FixUnit，缺陷状态从"处理中"回退到"待处理"；进入 Phase 8）

用户选择后按对应路径继续，不得默认方案。

展示 review 汇总时读取 `references/status-and-reporting.md` 中的模板。

批量级 review 完成后才允许进入 Phase 6。

## Phase 6: 跨单元交叉影响分析

`[PHASE:6/CROSS]`

进入前置条件：Phase 5.5 批量级 review 已完成，`batch_review_summary` 已记录。

对**已物化且通过 review** 的就绪单元执行跨单元交叉影响分析。此时各单元覆盖缺陷已在 Phase 5.5.3 流转到"处理中"，本阶段不再负责状态流转。

### 分析维度

| 维度 | 检查内容 |
|------|----------|
| **文件冲突** | 多个 FixUnit 是否修改了同一文件的相同区域，合并后是否存在语义冲突 |
| **共享依赖** | 不同 FixUnit 修改的模块是否共享同一上游依赖，修改是否兼容 |
| **接口契约** | 一个 FixUnit 修改了接口签名或返回值，另一个 FixUnit 的调用方是否受影响 |
| **状态副作用** | 多个 FixUnit 涉及同一全局状态（store、缓存、会话）时是否引入竞态或覆盖 |
| **回归风险** | 合并所有修改后，各 FixUnit 独立通过的验证是否仍然成立 |

### 执行方式

1. 汇总所有已物化且就绪 FixUnit 的 `files_changed`，检测文件交集
2. 对存在交集的 FixUnit 对，检查修改是否语义兼容
3. 在协调分支上运行项目级测试或聚合验证命令（若可用）
4. 若无自动化测试，列出需人工验证的交叉影响点

### 结果处理

- **无交叉影响**：进入 Phase 7
- **发现兼容性问题**：按 `references/coverage-graph.md` 第 4 节两步处理——先执行失败级联，再将受影响 FixUnit 标记 `manual_intervention` + `cross_unit_conflict`，附带说明；该单元修复的缺陷保持"处理中"，但从 Phase 7 提交集合中移除
- **发现严重冲突**：触发 `[HARD-STOP:CROSS-CONFLICT]`，选项与 `BATCH-REVIEW-BLOCKER` 一致

## Phase 7: 全量确认 + 提交 Commit + 流转到"待验证"

### 全量确认

展示所有 FixUnit 的修复结果汇总（模板见 `references/status-and-reporting.md`），等待用户一次性确认。收到确认前不得继续。

若用户对某个 FixUnit 不认可，调用 `AskUserQuestion` 收集处理方式，`question` 写"FU-<unit_id> 不认可，如何处理？"，`options` 给三条：

- `discard` — 放弃修改：该单元代码不进入最终重建分支，缺陷状态回退到"待处理"
- `keep_code_no_commit` — 保留代码但不提交：该单元代码不进入最终重建分支，缺陷保持"处理中"
- `user_will_handle` — 另行处理：同 `keep_code_no_commit`，但在汇总中标注"用户计划另行处理"

三个选项从 git 操作视角完全一致（都不进入最终重建分支，worktree 都保留 7 天）。区别仅在**蓝鲸缺陷状态**和**汇总报告标注**。

**前置步骤**：若被拒绝的 FixUnit 是其他 FixUnit 的 `covered_by_unit`，先执行 `references/coverage-graph.md` 第 4 节的失败级联，再处理被拒绝单元自身。

| 选项 | 蓝鲸缺陷状态 | FixUnit 标记 |
|------|-------------|-------------|
| 1. 放弃修改 | 回退到"待处理" | `manual_intervention` + `user_rejected` |
| 2. 保留代码但不提交 | 保持"处理中" | `manual_intervention` + `user_rejected` |
| 3. 另行处理 | 保持"处理中" | `manual_intervention` + `user_rejected` |

被拒绝的 FixUnit 从 `confirmed_units` 与 `commit_scope` 中移除。

**依赖冲突**：被拒绝 FixUnit 与某个已确认 FixUnit 存在依赖关系（后者建立在前者基础上）时，cherry-pick 重建会冲突。触发 `[HARD-STOP:DEPENDENCY-CONFLICT]`，先展示依赖对，然后调用 `AskUserQuestion`，`question` 写"依赖冲突，如何处理？"，`options` 给三条：

- `reject_dependents` — 一并拒绝依赖方，按依赖方的处理方式（`discard` / `keep_code_no_commit` / `user_will_handle`）再次 AskUserQuestion
- `manual_intervention` — 将依赖方降级为 `manual_intervention`（保留依赖方物化代码，缺陷保持"处理中"）
- `restore_confirmation` — 放弃拒绝，恢复被拒 FixUnit 的原确认状态

用户选择 `reject_dependents` 时按单元粒度再问一次处理方式，其余路径按选择直接执行。

### 提交 Commit

Phase 5.5.2 已将每个已物化 FixUnit 以独立 `[bug-batch-stage] <unit_id>:` commit 落到协调分支，并记录了 `pre_bug_batch_base`。Phase 7 **从 `pre_bug_batch_base` 重建**，而非 revert——因为 FixUnit 之间可能存在隐性顺序依赖，revert 会抹掉上下文。

完整重建流程（备份 → 拉临时分支 → cherry-pick → squash → 审计 → 本地/远端 ref 改写事务 → 清理）、所有 Hard Stop 触发清单、commit message 格式，见 `references/commit-rebuild.md`。

### 流转到"待验证"

Commit 完成后，仅将实际进入该 commit 的已确认 FixUnit 覆盖缺陷从"处理中"批量流转到"待验证"。

状态流转示例读取 `references/status-and-reporting.md`。

## Phase 8: 输出汇总报告

全部修复单元处理完成后，输出：修复单元统计、FixUnit 视图、Issue 视图、失败项 / 阻塞项。

报告模板读取 `references/status-and-reporting.md`。

### Code Specs 归纳（汇总后追加）

读取本批次所有 `completed` FixUnit 在 Phase 5.5.1 已定档的 `code_specs_impact`，聚合后输出：

- 同一 `{pkg}/{layer}/{file}.md` 被 2+ FixUnit 标记为 `spec_gap` → 输出强信号 advisory：
  > 本批次 FU-xxx / FU-yyy 共享根因指向 `{file}.md`，该文件缺少对应 Common Mistake。建议 `/spec-update` 归纳。
- 同一段落被 2+ FixUnit 标记为 `spec_violation` → 输出：
  > `{file}.md § {H3 子标题}` 在本批次被重复违反，建议审视其执行机制（是否需要补强 DO/DON'T 或加入 spec-before-dev checklist）。
- 单发 `spec_gap` / `contract_misread` 只在单元视图里保留，不升级为批量 advisory（避免仪式感）。

`.claude/code-specs/` 不存在时整体跳过本段。

## 关键原则

1. 先分析，后修复
2. 以 `FixUnit` 为执行粒度，不以原始缺陷为执行粒度
3. 重复缺陷只归并，不重复编码
4. 共享根因和强耦合问题优先合并处理
5. 将阻塞关系显式化为 Task 依赖和执行顺序
6. 无实际代码修改的 FixUnit 不流转状态，原状态保留
7. 始终遵循最小改动原则
8. 单个修复单元失败时，只阻塞其依赖链，不阻塞无关单元
