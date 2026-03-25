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
Phase 5: 按 FixUnit 顺序执行修复（复用 debug 单修复单元协议）
Phase 6: 修复完成后流转到“处理中”并进入人工确认卡点
Phase 7: 人工确认后流转到“待验证”
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

## Phase 5: 按 FixUnit 顺序执行修复

用户确认后，按顺序逐个执行 `FixUnit`。

执行纪律：
- 同一时间只允许一个 `FixUnit` 进入 `fixing`
- `blocked_by_units` 未解除时保持 `blocked`
- `duplicate_issues` 只参与验证和状态流转，不触发独立编码
- 某个单元失败后，不阻塞与其无依赖关系的后续单元

### 调用 debug 协议

为每个 `FixUnit` 启动独立 agent，上下文中必须传入：
- `unit_id`
- `primary_issue`
- `included_issues`
- `duplicate_issues`
- `blocked_by_units`
- `shared_root_cause`
- `affected_scope`
- `validation_scope`

要求 `debug`：
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

## Phase 6: 流转到“处理中”并进入人工确认卡点

仅当以下条件同时满足时，才允许推进状态流转：
- 代码修复完成
- 验证方案已执行，或已给出明确人工验证步骤
- 模型审查通过，或当前模型给出等价审查结论
- `status_transition_ready = true`

先将当前 `FixUnit` 覆盖的 `included_issues` 与 `duplicate_issues` 流转到 `处理中`。

若 MCP 支持批量或单条状态更新，可按实际接口调用；若当前环境没有状态更新接口，必须在这里显式停下，提示人工手动流转，禁止假装更新成功。

展示人工确认卡点时，读取 `references/status-and-reporting.md` 中的模板。

## Phase 7: 人工确认后流转到“待验证”

仅在人工确认通过后，将当前 `FixUnit` 覆盖的缺陷从 `处理中` 流转到 `待验证`。

若人工确认未通过：
- 保持缺陷状态在 `处理中`
- 将当前 `FixUnit` 标记为 `manual_intervention`，或生成返修单元
- 在最终汇总中记录失败原因和后续动作

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
6. 在批量开始前和流转到待验证前各设置一次 Hard Stop
7. 修复完成后先流转到 `处理中`，人工确认后再流转到 `待验证`
8. 始终遵循最小改动原则
9. 单个修复单元失败时，只阻塞其依赖链，不阻塞无关单元
