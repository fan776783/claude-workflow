---
name: bug-batch
description: "批量修缺陷——从蓝鲸项目管理平台一次性拉一批 Bug，先做全量分析找出重复和共享根因再成组修，避免逐条打补丁。适合清积压、集中处理同一module多个相关问题，或需要统一验证一组接口改动。项目 ID 从 project-config.json 的 project.bkProjectId 读取。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:批量分析会跨多个 `{pkg}/{layer}`,Phase 3 开始前把每个涉及 layer 的 code-specs index 都读一遍;无缺陷时直接终止。
</PRE-FLIGHT>

# 批量缺陷修复

先分析全部缺陷，再按修复单元顺序执行。不要在缺少关系判断时直接逐条修复。

## 用法

```bash
/bug-batch                                        # 使用保存的经办人
/bug-batch <operator_user>                        # 显式指定经办人（并更新配置）
/bug-batch fanjj --state 待处理 --priority HIGH
```

参数：`operator_user`（公司邮箱 `@` 前部分）、`--state`（默认 `待处理`）、`--priority`（默认全部）。

## 前置条件

- `.claude/config/project-config.json` 的 `project.bkProjectId` 必须存在；为空时提示 `/scan` 完成关联后终止。
- 经办人解析顺序：CLI 参数 > `~/.claude/agent-workflow/config.json` 的 `bugBatch.operatorUser` > 首次交互询问并回写。

## 核心概念

### IssueRecord
标准化字段：`issue_number` / `title` / `description` / `reproduction_steps` / `priority` / `state` / `operator_user` / `reporter` / `created_at` / `screenshots` / `module_hint`。

### RelationType
- `duplicate_of`：重复缺陷，不单独编码
- `same_root_cause`：共享根因，通常合并单元
- `coupled_with`：强耦合，拆开会冲突
- `blocked_by`：依赖其他缺陷或单元先完成
- `needs_manual_judgement`：关系不明，人工裁决

### FixUnit
字段：`unit_id` / `primary_issue` / `included_issues` / `duplicate_issues` / `blocked_by_units` / `shared_root_cause` / `affected_scope` / `validation_scope` / `merge_reason`（`primary` / `same_root_cause` / `coupled_with`）/ `execution_status` / `manual_intervention_reason`（见下）/ `covered_by_unit`（`covered_by_other` 时指向覆盖单元）。

### 执行状态

| 状态 | 含义 | 阶段 |
|------|------|-----|
| `pending` | 已编排待进修复 | Phase 4 后 |
| `blocked` | 被 `blocked_by_units` 阻塞 | Phase 5 |
| `in_progress` | subagent 修复中 | Phase 5 |
| `completed` | 单元级 review 通过 + 物化 | Phase 5.5 |
| `no_change_needed` | 根因已消失 | Phase 5.5.3 |
| `covered_by_other` | 被其他 FixUnit 覆盖 | Phase 5.5.3 |
| `manual_intervention` | 需人工介入，附 `manual_intervention_reason` | Phase 5 / 5.5 / 6 / 7 |

### Manual Intervention Reasons

本 skill 可能命中子集：`root_cause_mismatch` / `verification_failed` / `out_of_scope` / `review_rejected` / `materialization_failed` / `cross_unit_conflict` / `user_rejected` / `ambiguous_empty_change` / `cover_unit_failed`。

完整定义 + 触发点见 `../fix-bug/references/manual-intervention-reasons.md`。

## 执行纪律

### Phase 状态标签

```
[PHASE:0/CONFIG]       读项目配置 + 经办人
[PHASE:1/FETCH]        拉缺陷清单
[PHASE:2/NORMALIZE]    标准化 IssueRecord
[PHASE:3/ANALYZE]      全量分析
[PHASE:4/PLAN]         编排 FixUnit
[HARD-STOP:CONFIRM-PLAN]          等待用户确认编排
[PHASE:5/FIX]                     并行修复
[PHASE:5.5/REVIEW]                单元级 review + 物化 + 即时流转 + 批量级 review
[HARD-STOP:CONFIRM-BATCH-REVIEW]  批量 review 方式
[HARD-STOP:BATCH-REVIEW-BLOCKER]* 批量 review 阻断（条件）
[PHASE:6/CROSS]                   跨单元交叉影响分析
[HARD-STOP:CROSS-CONFLICT]*       交叉严重冲突（条件）
[HARD-STOP:CONFIRM-COMMIT]*       全量结果异常确认（条件）
[HARD-STOP:REJECTED-UNIT-ACTION]* 拒绝某 FixUnit 处理（条件）
[HARD-STOP:DEPENDENCY-CONFLICT]*  拒绝单元与确认单元依赖冲突（条件）
[HARD-STOP:REBUILD-CONFLICT]*     Phase 7 重建冲突（条件）
[HARD-STOP:BRANCH-REWRITE]*       协调分支不可改写（条件）
[PHASE:7/COMMIT]                  Commit + 待验证流转
[PHASE:8/REPORT]                  汇总报告
```

### Hard Stop 模板

所有 `[HARD-STOP:...]` 调用 `AskUserQuestion`，各 Phase 内指明 options 填充：
- `CONFIRM-PLAN` / `CONFIRM-BATCH-REVIEW` / `CONFIRM-COMMIT` / `BATCH-REVIEW-BLOCKER` / `CROSS-CONFLICT`。
- 输出 `[HARD-STOP:...]` 后立即停止所有代码修改、状态流转、subagent 调度，等到用户明确输入再继续。不把"用户未反对"当确认。

### 前置条件检查

| Phase | 前置 |
|-------|-----|
| Phase 3 | Phase 2 所有 IssueRecord 齐全 |
| Phase 4 | Phase 3 关系识别完，`needs_manual_judgement` 已明确 |
| Phase 5 | `CONFIRM-PLAN` 已确认 |
| Phase 5.5 | Phase 5 所有 Task 终态 |
| Phase 6 | Phase 5.5 单元 review + 即时流转 + 批量 review 已完成 |
| Phase 7 | Phase 6 无严重冲突；异常单元已在 `CONFIRM-COMMIT` 确认 |

### subagent 纪律

Phase 5 subagent 输入contract / 输出contract / 执行规范 / 失败终止统一由 `references/fix-protocol.md` 定义；主会话下发任务时必须带该协议的 `execution_constraints`。

## 按需读取的参考文件

- `references/analysis-and-planning.md`：分析视图、关系矩阵、FixUnit 编排示例、Task 树预览
- `references/status-and-reporting.md`：layer review 汇总、状态流转示例、确认卡点、汇总报告模板
- `references/fix-protocol.md`：subagent 输入/输出contract
- `references/coverage-graph.md`：`covered_by_other` 图规范化、终点解析、失败级联
- `references/commit-rebuild.md`：Phase 7 重建workflow、git 事务、Hard Stop 清单

## 执行workflow

```text
Phase 0:   读项目配置
Phase 1:   拉缺陷清单
Phase 2:   获取详情并标准化
Phase 3:   全量分析（根因 / 重复 / 耦合 / 依赖）
Phase 4:   编排 FixUnit（Hard Stop）
Phase 5:   分层并行修复
Phase 5.5: 单元级 review + 物化 + 即时流转 + 批量级 review
Phase 6:   跨单元交叉影响分析
Phase 7:   全量确认 + Commit + 流转到"待验证"（Hard Stop）
Phase 8:   汇总报告
```

## Phase 0: 读项目配置

1. 读 `.claude/config/project-config.json`，取 `project.bkProjectId` 为 `project_id`；空则提示 `/scan` 后终止。
2. 解析 `operator_user`：CLI > `~/.claude/agent-workflow/config.json` 的 `bugBatch.operatorUser` > 交互询问后回写。用户误填邮箱时自动截取 `@` 前部分。
3. 写入配置时仅更新 `bugBatch.operatorUser`，不覆盖其它顶层键；目录 / 文件不存在时自动创建。

## Phase 1: 拉缺陷清单

`bk list_issues` 按 `operator_user` / `--state`（默认 `待处理`）/ `--priority` 过滤。缺陷量大分页拉；进 Phase 3 前必须有完整视图。无匹配直接终止。

## Phase 2: 标准化

对每个缺陷并行 `bk get_issue`（~10 个一组）提取标题 / 描述 / 复现 / 优先级 / 状态 / 时间 / 人 / 截图 / 链接 / 日志 / module / 接口 / 页面 / 错误码。补充 `symptom_summary` / `entry_point` / `module_hint` / `risk_hint` / `suspected_root_cause`。排序（仅展示）：优先级 > 创建时间升序。

## Phase 3: 全量分析

**禁止开始编码**。

### 根因初判

每个 IssueRecord 输出：初步根因假设、受影响module、代码入口、风险等级、是否需联动处理。

### Code Specs 对照

按 `module_hint` 定位 `.claude/code-specs/{pkg}/{layer}/index.md`，匹配 convention / contract。命中已有 Common Mistake → 附 `spec_hint: "{pkg}/{layer}/{file}.md § {H3}"`；未命中不附；`.claude/code-specs/` 不存在整体跳过不阻断。`spec_hint` 是 Phase 5.5.1 定档 `code_specs_impact` 的输入。

### 关系识别

按 RelationType 定义识别 → `needs_manual_judgement` 禁止自动合并。

分析视图 / 关系矩阵模板见 `references/analysis-and-planning.md`。

## Phase 4: 编排 FixUnit

按关系生成 FixUnit：
- `duplicate_of` → 归并到主单元，不独立编码
- `same_root_cause` / `coupled_with` → 按最小改动合并
- `blocked_by` → 表达为 `blocked_by_units`
- `needs_manual_judgement` → 保留独立单元，请求裁决

`primary_issue` 优先级：优先级高 → 创建早 → 描述稳定。

编排模板见 `references/analysis-and-planning.md`。展示后 `[HARD-STOP:CONFIRM-PLAN]`，调用 AskUserQuestion：

- `confirm_plan` — 进 Phase 5
- `revise_plan` — 按反馈重排 FixUnit
- `reduce_scope` — 缩小缺陷集合重回 Phase 3

## Phase 5: layer并行修复

**不调用 fix-bug**。用内部修复协议（`references/fix-protocol.md`）避免嵌套 Hard Stop。

### 5.1 Task 树

每个 FixUnit = 一个 Claude Code Task，subject `fix:<unit_id>`；`blocked_by_units` 的上游 Task ID 填 `addBlockedBy`。Layer 0 立即 `in_progress`，Layer N `pending` 待上游 completed。

### 5.2 拓扑layer

```text
Layer 0: 无 blocked_by_units（可立即并行）
Layer 1: 仅依赖 Layer 0
Layer N: 依赖 Layer 0..N-1
```

### 5.3 worktree 隔离

| 场景 | 策略 |
|------|------|
| 同层 2+ 且无文件交集 | 各 worktree 并行 |
| 同层 2+ 有文件交集 | 有交集的降级串行 |
| 同层 1 个 | 主工作树直接 |

**路径**：`<repo_root>/../bug-batch-worktrees/<unit_id>`；分支 `fix/<unit_id>` 从协调分支拉；`diff_base` = 协调分支 HEAD。

**清理**：成功物化 → 保留到 Phase 7 结束统一清理；失败 / `manual_intervention` → 保留供介入，路径写入 Phase 8；用户"放弃修改" → 保留 7 天。

### 5.4 内部修复协议

subagent 输入：`unit_id` / `primary_issue` / `included_issues` / `duplicate_issues` / `shared_root_cause` / `confirmed_root_cause_location` / `confirmed_fix_plan`（方案 + files_to_modify + test_command）/ `affected_scope` / `validation_scope` / `execution_constraints`。

执行步骤（无 Hard Stop）：根因复核 → 实施修复（只改 files_to_modify）→ 运行验证 → 输出结构化结果。contract详见 `references/fix-protocol.md`。

### 5.5 执行纪律

同层独立并行；`blocked_by_units` 未解保 `blocked`；`duplicate_issues` 不独立编码；某单元失败只阻塞依赖链；同层 1 个退化串行。

### 5.6 Task 状态推进

| subagent 结果 | Task | FixUnit | 附加 |
|--------------|------|---------|------|
| `files_changed` 非空 + `root_cause_confirmed = true` | `completed` | `completed`（待 5.5 review） | - |
| `root_cause_obsolete: true`（空 diff） | `completed` | `no_change_needed` | - |
| `covered_by_other_unit`（空 diff） | `completed` | `covered_by_other` | `covered_by_unit` |
| `root_cause_mismatch: true` | `completed` | `manual_intervention` | `reason: root_cause_mismatch` |
| 连续 3 次验证失败 | `completed` | `manual_intervention` | `reason: verification_failed` |
| 改动文件超出 `files_to_modify` | `completed` | `manual_intervention` | `reason: out_of_scope` |
| `files_changed` 空且四信号均无 | `completed` | `manual_intervention` | `reason: ambiguous_empty_change` |

Layer N 解阻塞：所有 `blockedBy` completed 后按前置终态：
- 全 `completed`（或含 `no_change_needed`）→ 推进
- 任一 `covered_by_other` → 下游 `blocked_by_units` 重定向到 `covered_by_unit`，重判
- 任一 `manual_intervention` → 下游保 `blocked`，附"上游 `<unit_id>` 需人工介入"

### 5.7 收集结果

每单元至少收集：`root_cause_confirmed` / `files_changed` / `issues_fixed_directly` / `issues_covered_as_duplicates` / `verification_summary` / `residual_risks` / `status_transition_ready` / `materialization_artifact`。

## Phase 5.5: 单元 review + 物化 + 即时流转 + 批量 review

**终态分流**（进 5.5.1 前）：

| 终态 | 路径 | 进 5.5.1/5.5.2 | 状态流转 |
|------|------|---------------|---------|
| `completed` | 单元 review + 物化 + 即时流转 | 是 | 独立流转到"处理中" |
| `no_change_needed` | 跳过；登记 Phase 8 关闭建议 | 否 | 否 |
| `covered_by_other` | 跳过；并入覆盖单元 `transition_set` | 否 | 随覆盖单元流转 |
| `manual_intervention` | 跳过；登记 Phase 8 人工介入 | 否 | 否 |

**顺序**（不可颠倒）：
1. **`covered_by_other` 图规范化** — 规则见 `references/coverage-graph.md § 2`
2. **前置快速检查** — 规范化后若全非 `completed`，跳过 5.5.1–5.5.2 到 Phase 8，说明"本批次无可交付单元"

### 5.5.1 单元级 review

对 `status_transition_ready = true` 单元逐个review（未物化，在 worktree / 子分支 diff 上）。**主会话直接review diff，不调用 codex**（codex 只在 5.5.4 按需）。

review：根因是否落到 `files_changed`；是否最小改动；验证是否覆盖 `validation_scope` + `duplicate_issues`；是否引入明显回归。

P0/P1 → 按 `references/coverage-graph.md § 4` 两步（失败级联 → 标 `manual_intervention` + `review_rejected`）。

**顺带定档 `code_specs_impact`**：主会话审每个通过 review 的 FixUnit diff 时，按 fix-bug Phase 4.2 的四档给单元附加 `code_specs_impact` + `code_specs_advisory`。Phase 8 Code Specs 归纳直接消费。subagent 输出不扩展，本步骤是主会话职责。

所有单元 review 完后输出"单元级 review 汇总"（模板 `references/status-and-reporting.md`）。

### 5.5.2 物化到协调分支

通过 review 的 FixUnit 按 `materialization_artifact` 落回协调分支。

**每个 FixUnit 必须独立 commit**（Phase 7 按单元 cherry-pick 重建）：

- 第一个单元物化前记录 `pre_bug_batch_base` = 协调分支当前 HEAD
- message 前缀：`[bug-batch-stage] <unit_id>:`
- 每次物化一个，记录 `materialized_commit_sha`；不合并多个到一个 commit
- 记录 `materialization_order`

**物化方式**：

| artifact.kind | 首选 | 降级 |
|---------------|-----|------|
| `worktree` | `cherry-pick <head_commit>` | 生成 patch → `git apply` → commit |
| `working-tree` | 主工作树 `git add` + commit | - |
| `patch` | `git apply <patch_path>` → commit | - |

**失败分级**：

| 原因 | 处置 |
|------|------|
| cherry-pick 冲突且原因是同层已物化 | 自动降级 patch |
| patch 冲突 ≤ 3 行且语义无关 | 试 `-3`，失败升级 |
| patch 冲突无法自解 | `manual_intervention` + `materialization_failed`，保留 artifact |
| 基线漂移 | 基于最新协调分支重建 patch；仍失败 → `materialization_failed` |

成功记录 `materialized_units` / `materialized_issue_numbers` / `materialization_log`。`materialization_failed` 按 `coverage-graph.md § 4`（级联 → 从后续集合移除，artifact 位置留 Phase 8）。

### 5.5.3 单元即时流转到"处理中"

单元 review 通过 + 已物化 + `files_changed` 非空 + `status_transition_ready = true` → 流转。

**无实际修改**：

| 情况 | 状态 | 附加 | 处理 |
|------|-----|------|------|
| 空 diff + `root_cause_obsolete` | `no_change_needed` | - | 不流转；Phase 8 建议人工确认后关闭 |
| 空 diff + `covered_by_other_unit` | `covered_by_other` | `covered_by_unit` | 并入覆盖单元 `transition_set` |
| 空 diff + `root_cause_mismatch` | `manual_intervention` | `reason: root_cause_mismatch` | 不流转 |
| 空 diff + 四信号均 false | `manual_intervention` | `reason: ambiguous_empty_change` | 不流转 |

**`covered_by_other` 绑定 + 失败级联**：`transition_set` 合并 / 失效判定 / 传递级联 / 回退动作集中在 `references/coverage-graph.md`；5.5.5 / Phase 6 / Phase 7 任何让覆盖单元离开交付集合的路径必须先调用级联。

**流转**按 `../fix-bug/references/status-readiness.md § 流转动作`：

```text
bk transition_issue
  --issue_number <primary + included + duplicate>
  --target_state 处理中
  --comment "FixUnit <unit_id> 已完成代码修复与验证，等待全量确认"
```

失败处理按 `../fix-bug/references/status-readiness.md § 失败处理`。

### 5.5.4 批量级 review

所有物化完成后对协调分支整体评估。

**Step 1 — 影响范围**：已物化单元数 / 文件交集 / 共享依赖 / 敏感面覆盖 / 总修改规模。

**Step 2 — 档位**：

| 建议 | 触发 |
|-----|------|
| `recommended` | ≥ 2 单元 + 文件交集 / 共享依赖 / 敏感面 |
| `optional` | ≥ 2 单元但无交集 / 敏感 |
| `skip` | 仅 1 个已物化 |

**Step 3 — `[HARD-STOP:CONFIRM-BATCH-REVIEW]`**：展示范围 + 建议后调用 `AskUserQuestion`，`question` = "批量级 review 方式？"，options：

- `codex_adversarial` — 启 codex adversarial review
- `self_review` — 主会话review，记 `batch_review_mode: "self"`
- `skip` — 跳过，记 `"skipped"`（仅 1 个已物化时可选）

无回复停止等待，不自动按建议执行。用户"本批次后续全部 X"可作为批量指令沿用后续条件 Hard Stop。

**Step 4 — 执行**：≤ 3 单元 + ≤ 10 文件 → 同步；否则 `--background` + 进 Phase 6 前 `--status` 等待。

```bash
node scripts/codex-bridge.mjs \
  --cd "<repo_root>" \
  --adversarial-review working-tree \
  [--background] \
  --prompt "FOCUS: Cross-unit batch review. Units: <unit_ids>. Evaluate: inter-unit conflicts, shared dependency compatibility, interface contract breaks, regression coverage. HARD CONSTRAINTS: (1) Ignore hypothetical scenarios without a named caller or reachable code path — trust internal code with known shape. (2) Do not recommend refactors, renames, or cleanup outside the diff. (3) Report only Critical/Important findings; collapse minor/nit items into a single advisory line, do not expand."
```

Codex 路由降级按 `core/specs/shared/codex-routing.md`。

### 5.5.5 结论处理

记 `batch_review_summary`：
- **无重大问题** → Phase 6
- **跨单元兼容性问题** → `coverage-graph.md § 4`（级联 → 标 `cross_unit_conflict`），已流转的"处理中"保持，从 Phase 7 提交集合移除
- **阻断性** → `[HARD-STOP:BATCH-REVIEW-BLOCKER]`，options：
  - `ignore_and_continue` — 继续（仅明确误报时）
  - `drop_affected_units` — 剔除受影响（级联 → 标 `cross_unit_conflict`，物化代码保留）
  - `abort_batch` — 放弃全部（对每个作为 `covered_by_unit` 的单元执行级联 → 回滚协调分支上所有已物化 FixUnit，缺陷"处理中"回退到"待处理" → Phase 8）

用户选择后按对应路径，不得默认。

review 汇总模板见 `references/status-and-reporting.md`。

## Phase 6: 跨单元交叉影响分析

对已物化 + 通过 review 的单元做跨单元分析。单元覆盖缺陷已在 5.5.3 流转到"处理中"，本阶段不负责流转。

### 维度

- **文件冲突** — 同文件同区域 + 语义冲突
- **共享依赖** — 不同 FixUnit 的上游依赖是否兼容
- **接口contract** — 改签名 vs 调用方
- **状态副作用** — 同全局状态的竞态 / 覆盖
- **回归风险** — 合并后各单元独立验证是否仍成立

### 执行

1. 汇总已物化 `files_changed` 检测文件交集
2. 交集 FixUnit 对 → 语义兼容检查
3. 协调分支跑项目级测试 / 聚合验证
4. 无自动化 → 列手工验证点

### 结果

- **无交叉** → Phase 7
- **兼容性问题** → `coverage-graph.md § 4`（级联 → 标 `cross_unit_conflict`），覆盖缺陷保持"处理中"，从 Phase 7 集合移除
- **严重冲突** → `[HARD-STOP:CROSS-CONFLICT]`，options 与 `BATCH-REVIEW-BLOCKER` 一致

## Phase 7: 全量确认 + Commit + 流转到"待验证"

### 全量确认

展示汇总（模板 `references/status-and-reporting.md`）。

**Happy path 自动通过**：全 `completed` + 批量 review 无未修复 P0/P1 → 跳过 `[HARD-STOP:CONFIRM-COMMIT]`，汇总标注"全部通过，自动进入重建"。

**条件 Hard Stop**：任一 FixUnit 为 `manual_intervention` / `no_change_needed` / `covered_by_other`；或批量 review 有未修 P0/P1；或 Phase 6 发现已降级但未触发 `CROSS-CONFLICT` 的兼容性问题 → `[HARD-STOP:CONFIRM-COMMIT]`。

用户对某 FixUnit 不认可时调 `AskUserQuestion`，`question` = "FU-<unit_id> 不认可，如何处理？"，options：

- `discard` — 不入最终重建分支，缺陷回退"待处理"
- `keep_code_no_commit` — 不入最终重建分支，缺陷保持"处理中"
- `user_will_handle` — 同上，汇总标注"用户计划另行处理"

三选项 git 操作视角一致，区别仅在**蓝鲸状态**和**汇总标注**。

**前置**：被拒 FixUnit 若是其他的 `covered_by_unit`，先 `coverage-graph.md § 4` 级联再处理自身。

| 选项 | 蓝鲸状态 | FixUnit 标记 |
|------|---------|-------------|
| `discard` | "待处理" | `manual_intervention` + `user_rejected` |
| `keep_code_no_commit` | "处理中" | `manual_intervention` + `user_rejected` |
| `user_will_handle` | "处理中" | `manual_intervention` + `user_rejected` |

被拒单元从 `confirmed_units` 和 `commit_scope` 移除。

**依赖冲突**：被拒单元与某确认单元存在依赖 → cherry-pick 会冲突。`[HARD-STOP:DEPENDENCY-CONFLICT]` 展示依赖对，options：

- `reject_dependents` — 一并拒绝依赖方，按单元粒度再问处理方式
- `manual_intervention` — 依赖方降级为 `manual_intervention`（物化保留，缺陷"处理中"）
- `restore_confirmation` — 恢复被拒单元的原确认

### 提交 Commit

Phase 5.5.2 已将每单元以 `[bug-batch-stage] <unit_id>:` commit 落协调分支并记 `pre_bug_batch_base`。Phase 7 **从 `pre_bug_batch_base` 重建**（非 revert——FixUnit 间可能隐性依赖，revert 会抹上下文）。

重建workflow（备份 → 临时分支 → cherry-pick → squash → 审计 → 本地/远端 ref 改写事务 → 清理）+ Hard Stop 清单 + commit message 见 `references/commit-rebuild.md`。

### 流转到"待验证"

Commit 完成后，仅将实际入该 commit 的已确认 FixUnit 覆盖缺陷从"处理中"批量流转到"待验证"。

调用方式按 `../fix-bug/references/status-readiness.md`。示例模板 `references/status-and-reporting.md`。

## Phase 8: 汇总报告

输出：修复单元统计 / FixUnit 视图 / Issue 视图 / 失败项 / 阻塞项。模板 `references/status-and-reporting.md`。

### Code Specs 归纳

消费本批次所有 `completed` FixUnit 在 5.5.1 已定档的 `code_specs_impact` 聚合输出：

- 同一 `{pkg}/{layer}/{file}.md` 被 2+ FixUnit 标 `spec_gap` → 强信号：
  > 本批次 FU-xxx / FU-yyy 共享根因指向 `{file}.md`，该文件缺少对应 Common Mistake。建议 `/spec-update` 归纳。
- 同一段落 2+ `spec_violation` → 
  > `{file}.md § {H3}` 本批次被重复违反，建议审视执行机制。
- 单发 `spec_gap` / `contract_misread` 只留单元视图，不升级（避免仪式感）。

`.claude/code-specs/` 不存在整体跳过。

## 关键原则

1. 先分析，后修复
2. 以 FixUnit 为执行粒度
3. 重复缺陷只归并
4. 共享根因 / 强耦合优先合并
5. 阻塞关系显式化
6. 无修改的 FixUnit 不流转
7. 最小改动
8. 单元失败只阻塞依赖链
