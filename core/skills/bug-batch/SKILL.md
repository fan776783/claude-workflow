---
name: bug-batch
description: "批量缺陷修复 - 从蓝鲸项目管理平台拉取缺陷清单后，先完成全量诊断、重复/关联关系识别与修复单元编排，再在用户确认后按修复单元顺序执行修复。适用于批量处理缺陷、清理积压 Bug、统一分析共享根因问题；修复完成后先流转到处理中，人工确认后再流转到待验证。项目 ID 从 project-config.json 的 project.bkProjectId 读取。"
---

# 批量缺陷修复

先分析全部缺陷，再按修复单元顺序执行。不要在缺少关系判断时直接逐条修复。

## 用法

```bash
/bug-batch <operator_user>
/bug-batch fanjj
/bug-batch fanjj --state 待处理 --priority HIGH
```

参数：
- `operator_user`：经办人用户名，必填
- `--state`：缺陷状态筛选，默认 `待处理`
- `--priority`：优先级筛选，默认全部

## 前置条件

读取 `.claude/config/project-config.json` 中的 `project.bkProjectId` 作为蓝鲸项目 ID。

若 `project.bkProjectId` 为空或不存在，提示用户先执行 `/scan` 完成项目关联并终止。

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
- `execution_status`

### 执行状态

使用以下修复单元状态：
- `analysis_pending`
- `awaiting_batch_confirmation`
- `ready_to_fix`
- `fixing`
- `awaiting_manual_verification`
- `completed`
- `manual_intervention`
- `blocked`

## 执行纪律

### 状态标签

每个 Phase 开始时输出对应标签，用于定位当前阶段：

```
[PHASE:0/CONFIG]       读取项目配置
[PHASE:1/FETCH]        拉取缺陷清单
[PHASE:2/NORMALIZE]    标准化 IssueRecord
[PHASE:3/ANALYZE]      全量分析
[PHASE:4/PLAN]         编排 FixUnit
[HARD-STOP:CONFIRM-PLAN]    等待用户确认编排方案
[PHASE:5/FIX]          并行修复执行
[PHASE:5.5/REVIEW]     分层 codex review
[PHASE:6/CROSS]        跨单元交叉影响分析 + 处理中流转
[HARD-STOP:CONFIRM-COMMIT]  等待用户确认全量结果
[PHASE:7/COMMIT]       提交 Commit + 待验证流转
[PHASE:8/REPORT]       汇总报告
```

### Hard Stop 行为规范

Hard Stop 是强制交互节点，不是建议。输出 `[HARD-STOP:...]` 标签后：

1. 停止所有代码修改、状态流转、子 agent 调度
2. 向用户展示规定格式的确认内容
3. 等待用户明确输入（Y/N 或具体指令）
4. 未收到确认前，禁止打印任何"下一步计划"或"准备继续执行"的内容

违规行为（等同于跳过 Hard Stop，禁止）：
- 在等待确认期间继续分析或编码
- 将"用户未反对"视为确认
- 自动为 Hard Stop 问题生成默认回答

### 前置条件检查

每个 Phase 入口必须验证上游产出：

| Phase | 前置条件 |
|-------|---------|
| Phase 3 | Phase 2 已输出所有 IssueRecord，无缺失 |
| Phase 4 | Phase 3 已完成所有缺陷的关系识别，`needs_manual_judgement` 项已明确标注 |
| Phase 5 | 用户已在 `[HARD-STOP:CONFIRM-PLAN]` 处给出明确确认 |
| Phase 5.5 | Phase 5 所有 Task 已达终态，结果已收集 |
| Phase 6 | Phase 5.5 批量级 review 已完成，`batch_review_summary` 已记录 |
| Phase 7 | 用户已在 `[HARD-STOP:CONFIRM-COMMIT]` 处给出明确确认 |

### 子 agent 执行纪律

Phase 5 的修复子 agent 收到的是已确认的根因和方案，执行范围严格限定。

子 agent 允许：
- 复核根因是否在代码中成立（只读验证）
- 实施最小化修复
- 运行验证命令
- 输出结构化结果

子 agent 禁止：
- 独立发起根因分析或影响分析
- 向用户发起 Hard Stop 或交互确认
- 调用 `collaborating-with-codex`
- 修改 FixUnit 的关系结论（duplicate_of / same_root_cause 等）

## 按需读取的参考文件

当需要展示示例输出或汇总模板时，再读取以下文件：
- `references/analysis-and-planning.md`：分析视图、关系矩阵、FixUnit 编排示例、Task 树预览
- `references/status-and-reporting.md`：分层 review 汇总、状态流转示例、人工确认卡点、汇总报告模板
- `references/fix-protocol.md`：内部修复协议（子 agent 输入/输出契约、执行规范）

## 执行流程

```text
Phase 0:   读取项目配置
Phase 1:   拉取缺陷清单
Phase 2:   获取详情并标准化 IssueRecord
Phase 3:   全量分析（根因初判 / 重复识别 / 耦合识别 / 依赖分析）
Phase 4:   编排 FixUnit 并等待批量确认（Hard Stop）
Phase 5:   按依赖分层并行执行修复（以 Task 树调度，每个 FixUnit 一个 Task）
Phase 5.5: 分层 codex review（单元级 + 批量级）
Phase 6:   跨单元交叉影响分析 + 批量流转到”处理中”
Phase 7:   全量确认 + 提交 Commit + 流转到”待验证”（Hard Stop）
Phase 8:   输出汇总报告
```

## Phase 0: 读取项目配置

1. 读取 `.claude/config/project-config.json`
2. 提取 `project.bkProjectId` 作为 `project_id`
3. 若为空，提示 `蓝鲸项目未关联，请先执行 /scan 完成项目关联` 并终止

## Phase 1: 拉取缺陷清单

调用 `mcp__mcp-router__list_issues` 拉取缺陷列表，只保留：
- 状态匹配的缺陷
- `--priority` 命中的缺陷

若缺陷量过大，可分页拉取，但在进入 Phase 3 前必须形成完整分析视图。

若无匹配缺陷，直接告知用户并终止。

## Phase 2: 获取详情并标准化 IssueRecord

对每个缺陷调用 `mcp__mcp-router__get_issue(issue_number)`，提取：
- 标题、描述、复现步骤
- 优先级、状态、创建时间、创建人、经办人
- 描述中的截图、链接、日志片段
- 模块关键词、接口名、页面路径、错误码等上下文线索

标准化时补充：
- `symptom_summary`
- `entry_point`
- `module_hint`
- `risk_hint`
- `suspected_root_cause`

排序只服务于展示，不直接等于最终执行顺序。优先级高者在前，同优先级按创建时间升序。

## Phase 3: 全量分析

先分析全部缺陷，再决定如何修复。此阶段禁止开始编码。

### 根因初判

对每个 `IssueRecord` 输出：
- 初步根因假设
- 受影响模块
- 可能涉及的代码入口
- 风险等级
- 是否需要与其他缺陷联动处理

### 关系识别

按以下规则判断关系：
- 判定为 `duplicate_of`：复现路径、错误现象、预期行为和根因证据高度一致
- 判定为 `same_root_cause`：表象不同，但最终落到同一代码路径、同一状态源或同一接口约束问题
- 判定为 `coupled_with`：修改文件和验证范围高度重叠，拆开修复会产生冲突或重复改动
- 判定为 `blocked_by`：当前缺陷必须等待另一个缺陷或修复单元先完成，才能稳定验证
- 无法确认时标记为 `needs_manual_judgement`，禁止自动合并

展示分析结果时，读取 `references/analysis-and-planning.md` 中的模板。

## Phase 4: 编排 FixUnit 并等待批量确认（Hard Stop）

根据分析结果生成 `FixUnit`：
- 将重复缺陷归并到主缺陷所在单元，不创建独立编码任务
- 将共享根因缺陷和强耦合缺陷按最小改动原则合并
- 将阻塞关系表达为 `blocked_by_units`
- 将关系不明确的项保留为独立单元，并在确认阶段请求人工裁决

选择 `primary_issue` 时使用以下优先级：
1. 优先级更高者优先
2. 创建时间更早者优先
3. 描述更稳定、更完整者优先

展示 FixUnit 编排结果并请求确认时，读取 `references/analysis-and-planning.md` 中的模板。

在收到用户确认前，立即停止，不得继续进入修复。

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

示例：

```
TaskCreate: subject=”fix:FU-001” → 立即 in_progress（Layer 0）
TaskCreate: subject=”fix:FU-003” → 立即 in_progress（Layer 0）
TaskCreate: subject=”fix:FU-002”, addBlockedBy=[FU-001的TaskId] → pending（Layer 1）
```

### 5.2 拓扑分层

根据 `blocked_by_units` 构建依赖图，将 FixUnit 划分为执行层：

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

worktree provisioning 必须串行完成（避免 `.git/config.lock` 竞争），再并行启动子 agent。

### 5.4 内部修复协议

为每个 FixUnit 的子 agent 提供精简输入，包含：
- `unit_id`、`primary_issue`、`included_issues`、`duplicate_issues`
- `shared_root_cause`
- `confirmed_root_cause_location`（根因所在文件和函数）
- `confirmed_fix_plan`（修复方案 + files_to_modify + test_command）
- `affected_scope`、`validation_scope`
- `execution_constraints`（执行禁止项列表）

子 agent 执行步骤（无 Hard Stop）：
1. **根因复核**（只读验证代码中是否仍存在描述的问题）
2. **实施修复**（按 confirmed_fix_plan，只改 files_to_modify）
3. **运行验证**（test_command 或手动步骤）
4. **输出结构化结果**

输入/输出契约详见 `references/fix-protocol.md`。

### 5.5 执行纪律

- 同一层内的独立 FixUnit **并行执行**
- `blocked_by_units` 未解除时保持 `blocked`，等待前置层全部完成
- `duplicate_issues` 只参与验证和状态流转，不触发独立编码
- 某个单元失败后，只阻塞其依赖链，不阻塞无关单元
- 若同层内仅有 1 个 FixUnit，退化为串行执行

### 5.6 Task 状态推进

| 子 agent 结果 | Task 操作 | FixUnit 状态 |
|--------------|-----------|-------------|
| 成功输出结果契约 | `TaskUpdate(status: completed)` | `completed` |
| `root_cause_mismatch: true` | `TaskUpdate(status: completed)` | `manual_intervention` |
| 连续 3 次验证失败 | `TaskUpdate(status: completed)` | `manual_intervention` |
| 修改文件超出 `files_to_modify` | `TaskUpdate(status: completed)` | `manual_intervention` |

Layer N 的 Task 解除阻塞规则：所有 `blockedBy` Task completed 后，检查对应 FixUnit 状态：
- 所有前置 FixUnit 均为 `completed` → 推进为 `in_progress` 并启动子 agent
- 任一前置 FixUnit 为 `manual_intervention` → 当前 FixUnit 保持 `blocked`（附带阻塞原因：上游 `<unit_id>` 需人工介入），Task 暂不推进；待上游问题解决或用户显式放弃后，再决定启动或标记 `manual_intervention`

### 5.7 收集结果

每个 FixUnit 至少收集：
- `root_cause_confirmed`
- `files_changed`
- `issues_fixed_directly`
- `issues_covered_as_duplicates`
- `verification_summary`
- `residual_risks`
- `status_transition_ready`

## Phase 5.5: 分层 codex review + 结果物化

`[PHASE:5.5/REVIEW]`

进入前置条件：Phase 5 所有 Task 已达终态，结果已收集。

### 5.5.1 单元级 review

在主会话收集到每个 FixUnit 的结果后，对 `status_transition_ready = true` 的单元逐个执行 review（此时尚未物化，review 在 worktree / 子分支的 diff 上进行）：

| 问题类型 | review 方式 |
|---------|------------|
| 前端 | 主会话直接审查 diff |
| 后端 / 全栈 | 调用 `collaborating-with-codex` 的 adversarial review |

后端/全栈问题的 codex 调用：

```bash
node scripts/codex-bridge.mjs \
  --cd “<repo_root>” \
  --adversarial-review working-tree \
  --prompt “FOCUS: Bug fix correctness for FixUnit <unit_id>. Root cause: <shared_root_cause>. Evaluate: regression risk, edge cases, minimal change adherence.”
```

review 不通过（P0/P1 问题）→ 标记 `manual_intervention`，不进入物化。

降级策略：codex 不可用时由主会话直接审查，输出降级说明。

### 5.5.2 结果物化到协调分支

单元级 review 通过的 FixUnit，将结果从 worktree / 子分支显式落回协调分支：

- 仅对 `status_transition_ready = true` 且单元级 review 通过的 FixUnit 执行物化
- 物化方式三选一：`cherry-pick` / `merge --no-ff` / `apply patch`，必须显式记录
- 物化后记录 `materialized_units`、`materialized_issue_numbers`、`materialization_log`
- 无法安全物化的 FixUnit → 标记 `manual_intervention`，从后续批量流转与提交集合中移除

### 5.5.3 批量级 review

所有物化完成后，对协调分支整体执行一次跨单元审查。

**同步 vs 后台决策**：

| 条件 | 决策 |
|------|------|
| 已物化 FixUnit ≤ 3 且修改文件总量 ≤ 10 | 同步执行 |
| 已物化 FixUnit > 3 或修改文件总量 > 10 | 后台执行（`--background`） |

同步执行：

```bash
node scripts/codex-bridge.mjs \
  --cd “<repo_root>” \
  --adversarial-review working-tree \
  --prompt “FOCUS: Cross-unit batch review. Units: <unit_ids>. Evaluate: inter-unit conflicts, shared dependency compatibility, interface contract breaks, regression coverage.”
```

后台执行：

```bash
# 启动
node scripts/codex-bridge.mjs \
  --cd “<repo_root>” \
  --adversarial-review working-tree \
  --background \
  --prompt “FOCUS: Cross-unit batch review. Units: <unit_ids>. Evaluate: inter-unit conflicts, shared dependency compatibility, interface contract breaks, regression coverage.”
# 返回 jobId

# 在进入 Phase 6 前查询并等待完成
node scripts/codex-bridge.mjs --cd “<repo_root>” --status <jobId>
```

### 5.5.4 结论处理

将结论记录为 `batch_review_summary`，分三档：

- **无重大问题**：继续 Phase 6
- **跨单元兼容性问题**：受影响 FixUnit 标记 `manual_intervention`，其余正常推进
- **阻断性问题**：触发临时 Hard Stop，向用户报告并等待决策

展示 review 汇总时，读取 `references/status-and-reporting.md` 中的模板。

批量级 review 完成后，才允许进入 Phase 6。

## Phase 6: 跨单元交叉影响分析 + 批量流转到”处理中”

`[PHASE:6/CROSS]`

进入前置条件：Phase 5.5 批量级 review 已完成，`batch_review_summary` 已记录。

对**已物化且通过 review** 的就绪单元执行跨单元交叉影响分析，最后统一流转。

### 跨单元交叉影响分析

并行执行的多个 FixUnit 各自通过了单元级验证，但只有在结果已落回协调分支后，才能真实评估合并后的交叉影响。此分析在结果物化完成后、状态流转前执行。

#### 分析维度

| 维度 | 检查内容 |
|------|----------|
| **文件冲突** | 多个 FixUnit 是否修改了同一文件的相同区域，合并后是否存在语义冲突 |
| **共享依赖** | 不同 FixUnit 修改的模块是否共享同一上游依赖（公共函数、类型定义、配置项），修改是否兼容 |
| **接口契约** | 一个 FixUnit 修改了接口签名或返回值，另一个 FixUnit 的调用方是否受影响 |
| **状态副作用** | 多个 FixUnit 涉及同一全局状态（store、缓存、会话）时，并发修改是否引入竞态或覆盖 |
| **回归风险** | 合并所有修改后，原本各 FixUnit 独立通过的验证是否仍然成立 |

#### 执行方式

1. 汇总所有已物化且就绪 FixUnit 的 `files_changed`，检测文件交集
2. 对存在交集的 FixUnit 对，检查修改是否语义兼容
3. 在协调分支上运行项目级测试或聚合验证命令（若可用）
4. 若无自动化测试，列出需人工验证的交叉影响点

#### 结果处理

- **无交叉影响**：继续批量流转
- **发现兼容性问题**：标记受影响的 FixUnit 为 `manual_intervention`，附带交叉影响说明，其余正常流转
- **发现严重冲突**：触发 Hard Stop，向用户报告冲突详情，等待决策后再继续

### 批量流转到”处理中”

对所有 `status_transition_ready = true`、已完成结果物化且通过交叉影响分析的单元统一处理。

仅当以下条件同时满足时，才允许推进状态流转：
- 代码修复完成
- 验证方案已执行，或已给出明确人工验证步骤
- 模型审查通过，或当前模型给出等价审查结论
- `status_transition_ready = true`

将所有就绪且已物化 FixUnit 覆盖的 `included_issues` 与 `duplicate_issues` 批量流转到 `处理中`。

若 MCP 支持批量或单条状态更新，可按实际接口调用；若当前环境没有状态更新接口，必须在这里显式停下，提示人工手动流转，禁止假装更新成功。

## Phase 7: 全量确认 + 提交 Commit + 流转到”待验证”（Hard Stop）

### 全量确认

展示所有 FixUnit 的修复结果汇总（读取 `references/status-and-reporting.md` 中的模板），等待用户一次性确认。

在收到用户确认前，立即停止，不得继续。

若用户对某个 FixUnit 不认可：
- 保持该 FixUnit 覆盖的缺陷在 `处理中`
- 将该 FixUnit 标记为 `manual_intervention`
- 将该 FixUnit 从 `confirmed_units` 与 `commit_scope` 中移除
- 若该单元的修改已临时落地到协调分支，必须先显式回滚或重建仅包含已确认单元的提交工作树
- 其余已确认的 FixUnit 继续执行后续流转

### 提交 Commit

用户确认后，仅将 `confirmed_units` 中的修改提交 commit。

Commit message 格式：

```
fix: <issue_number_1> <issue_number_2> ... 修复了 <问题摘要>
```

规则：
- 固定前缀 `fix:`
- 缺陷编号列表：仅包含实际进入本次 commit 的 `confirmed_units` 所覆盖的 `included_issues` 与 `duplicate_issues` 的 `issue_number`，空格分隔
- 问题摘要：用一句话概括本次批量修复内容

示例：

```
fix: p328_7489 p328_7488 p328_7490 修复了登录态刷新失效和会话过期问题
```

### 流转到”待验证”

Commit 完成后，仅将实际进入该 commit 的已确认 FixUnit 覆盖缺陷从 `处理中` 批量流转到 `待验证`。

状态流转示例读取 `references/status-and-reporting.md`。

## Phase 8: 输出汇总报告

全部修复单元处理完成后，输出：
- 修复单元统计
- `FixUnit` 视图
- `Issue` 视图
- 失败项 / 阻塞项

报告模板读取 `references/status-and-reporting.md`。

## 关键原则

1. 先分析，后修复
2. 以 `FixUnit` 为执行粒度，不以原始缺陷为执行粒度
3. 重复缺陷只归并，不重复编码
4. 共享根因和强耦合问题优先合并处理
5. 将阻塞关系显式化为 Task 依赖和执行顺序
6. 在批量开始前和全量确认+提交 Commit 前各设置一次 Hard Stop
7. 修复完成后先批量流转到 `处理中`，全量确认并提交 Commit 后再批量流转到 `待验证`
8. 始终遵循最小改动原则
9. 单个修复单元失败时，只阻塞其依赖链，不阻塞无关单元
10. 不调用 fix-bug，使用内部修复协议（子 agent 只做复核+修复+验证）
11. 分层 codex review：单元级审查修复正确性，批量级审查跨单元兼容性
