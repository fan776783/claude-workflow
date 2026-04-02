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

## 按需读取的参考文件

当需要展示示例输出或汇总模板时，再读取以下文件：
- `references/analysis-and-planning.md`：分析视图、关系矩阵、FixUnit 编排示例
- `references/status-and-reporting.md`：状态流转示例、人工确认卡点、汇总报告模板

## 执行流程

```text
Phase 0: 读取项目配置
Phase 1: 拉取缺陷清单
Phase 2: 获取详情并标准化 IssueRecord
Phase 3: 全量分析（根因初判 / 重复识别 / 耦合识别 / 依赖分析）
Phase 4: 编排 FixUnit 并等待批量确认（Hard Stop）
Phase 5: 按依赖分层并行执行修复（独立 FixUnit 通过 dispatching-parallel-agents 并行）
Phase 6: 跨单元交叉影响分析 + 批量流转到”处理中”
Phase 7: 全量确认 + 提交 Commit + 流转到”待验证”（Hard Stop）
Phase 8: 输出汇总报告
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

用户确认后，按依赖拓扑分层执行 `FixUnit`，同层内独立单元并行分派。

### 拓扑分层

根据 `blocked_by_units` 构建依赖图，将 FixUnit 划分为执行层：

```text
Layer 0: 无任何 blocked_by_units 的 FixUnit（可立即并行执行）
Layer 1: 仅依赖 Layer 0 中单元的 FixUnit（Layer 0 全部完成后并行执行）
Layer N: 依赖 Layer 0..N-1 中单元的 FixUnit
```

### 执行纪律

- 同一层内的独立 FixUnit **并行执行**
- `blocked_by_units` 未解除时保持 `blocked`，等待所在层的前置层全部完成
- `duplicate_issues` 只参与验证和状态流转，不触发独立编码
- 某个单元失败后，只阻塞其依赖链，不阻塞无关单元
- 若同层内仅有 1 个 FixUnit，退化为普通串行执行，不启动并行分派

### 并行分派（复用 dispatching-parallel-agents）

同层存在 2+ 独立 FixUnit 时，复用 `/dispatching-parallel-agents` skill：

1. **独立性检查**：确认同层 FixUnit 的 `affected_scope` 无文件交集；若存在共享文件，将相关 FixUnit 降级为串行
2. **worktree 隔离**：每个并行子 agent 使用 worktree 隔离，因为不同 FixUnit 会修改不同文件
3. **串行 provisioning**：先串行完成所有 worktree 创建，再并行启动子 agent
4. **冲突降级**：并行完成后若检测到冲突，回退受影响单元，按原顺序顺序重跑

### 调用 fix-bug 协议

为每个 `FixUnit` 启动独立 agent，上下文中必须传入：
- `unit_id`
- `primary_issue`
- `included_issues`
- `duplicate_issues`
- `blocked_by_units`
- `shared_root_cause`
- `affected_scope`
- `validation_scope`

要求 `fix-bug`：
1. 先复核根因与关系判断
2. 输出诊断结论、修复方案、风险与验证范围
3. 经确认后实施最小化修复
4. 输出哪些缺陷被直接修复，哪些缺陷通过重复归并覆盖
5. 输出 `status_transition_ready`

### 收集结果

每个 `FixUnit` 至少收集：
- `root_cause_confirmed`
- `files_changed`
- `issues_fixed_directly`
- `issues_covered_as_duplicates`
- `verification_summary`
- `review_summary`
- `status_transition_ready`
- `residual_risks`

以下情况将当前单元标记为 `manual_intervention`：
- 根因关系判断被证伪，需重新拆分单元
- 同一单元修复 3 次仍无法通过验证
- 修改范围超出最小改动原则
- 状态流转条件不满足，但需要人工推进

### 结果物化到协调分支

并行 FixUnit 在 worktree / 子分支中完成后，必须先将结果**显式落回协调分支**，再进入 Phase 6。

执行要求：
- 仅对 `status_transition_ready = true` 且验证通过的 FixUnit 执行结果物化
- 物化方式必须显式记录：`cherry-pick` / `merge --no-ff` / `apply patch` 三选一，禁止只依赖“已完成”状态推断结果已回到主工作树
- 物化后记录 `materialized_units`、`materialized_issue_numbers`、`materialization_log`
- 若某个 FixUnit 无法安全物化（冲突、补丁失败、语义不兼容），将其标记为 `manual_intervention`，并从后续批量流转与提交集合中移除

## Phase 6: 跨单元交叉影响分析 + 批量流转到”处理中”

所有 FixUnit 执行完毕后（含成功、失败、人工介入），先将可纳入主线的结果物化到协调分支，再对**已物化**的就绪单元执行跨单元交叉影响分析，最后统一流转。

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
5. 将阻塞关系显式化为执行顺序
6. 在批量开始前和全量确认+提交 Commit 前各设置一次 Hard Stop
7. 修复完成后先批量流转到 `处理中`，全量确认并提交 Commit 后再批量流转到 `待验证`
8. 始终遵循最小改动原则
9. 单个修复单元失败时，只阻塞其依赖链，不阻塞无关单元
