---
name: fix-bug
description: "Bug 修复流程：问题定位 → 影响分析 → 确认方案 → 修复 → Codex 审查。用于处理单个缺陷，包含完整的 4 Phase 流程和 Hard Stop 确认。批量场景请使用 bug-batch，其内部修复协议不经过本 skill。"
---

# 调试与修复

从问题定位到修复验证的完整流程。该 skill 用于处理单个 Bug，包含完整的分析、确认、修复、审查四阶段流程。

批量缺陷场景使用 `/bug-batch`。bug-batch 使用独立的内部修复协议（Internal Fix Protocol）处理 FixUnit，不再调用本 skill，以避免嵌套 Hard Stop 和重复分析。

## 用法

```bash
/fix-bug <问题描述>
/fix-bug "p328_600"
```

## 适用模式

### 模式 A：单缺陷调试

直接接收一个问题描述、错误现象或工作项编号，按标准调试流程执行。

> **模式 B 已弃用**：原模式 B（作为 bug-batch 的 FixUnit 执行协议）已由 bug-batch 的内部修复协议取代。当前 fix-bug 只用于单缺陷调试。

## 统一术语

- `IssueRecord`：单个缺陷的标准化信息
- `FixUnit`：一个实际执行修复的最小单元
- `primary_issue`：修复单元中的主缺陷
- `included_issues`：本次修改直接覆盖的缺陷
- `duplicate_issues`：判定为重复、继承主修复结果的缺陷
- `shared_root_cause`：多个缺陷共享的根因描述
- `status_transition_ready`：是否允许进入缺陷状态流转

## 输入契约

```yaml
bug: "用户头像上传失败，返回 413 错误"
```

或：

```yaml
issue_number: "p328_600"
```

## 输出契约

最终应输出以下结构化信息：
- `root_cause_confirmed`
- `recommended_fix`
- `alternative_fixes`
- `affected_scope`
- `verification_summary`
- `review_summary`
- `issues_fixed_directly`
- `issues_covered_as_duplicates`
- `status_transition_ready`
- `commit_sha`（未 commit 时为空）
- `manual_intervention_reason`（未进入 manual_intervention 时为空）
- `residual_risks`
- `code_specs_impact`：`spec_violation` / `spec_gap` / `contract_misread` / `spec_unrelated` 四档之一
- `code_specs_advisory`：除 `spec_unrelated` 档留空外，其它三档都填一句话——`spec_violation` 指段落路径、`spec_gap` 给 Bad/Good 草案 + `/spec-update` 提示、`contract_misread` 指 contract 文件的 `§ Validation & Error Matrix` 或 `§ Wrong vs Correct`

## 执行流程

```
Phase 1: 检索上下文 + 问题分析
Phase 2: 影响分析 + 确认方案（Hard Stop）
Phase 3: 修复实施 + 验证方案
Phase 4: 模型审查 + 状态流转就绪判断
```

## Phase 1: 检索上下文 + 问题分析

### 1.1 输入归一化

先判断入参形态，标准化为 `IssueRecord` 后再进入后续步骤：

- 入参是 `issue_number`：按 [references/issue-intake.md](references/issue-intake.md) 读项目配置 + 调用 `mcp__mcp-router__get_issue` 拉详情
- 入参是自由描述 `bug`：构造只含 `description` 的最小 IssueRecord；`status_transition_ready` 恒为 `false`，最终摘要标注"无缺陷单可流转"

完整字段表和失败路径见 issue-intake.md。

### 1.2 检索上下文

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 检索相关代码
2. 收集错误日志、堆栈信息、复现步骤
3. 按问题代码所在目录定位对应 code-spec（本层经验库激活）：
   - 从 codebase-retrieval 定位到的文件路径中提取 `pkg` 与 `layer`（按项目 `.claude/code-specs/` 实际布局识别）
   - 此处的 `layer` 仅用于**定位 spec 目录**（可能是 frontend / backend / unit-test / docs 等 spec 子目录名），与 1.3 的"前端/后端/全栈"**审查路由判断**互不相关
   - 读 `.claude/code-specs/{pkg}/{layer}/index.md` 的 Guidelines Index 表，按关键词匹配到具体 convention/contract 文件
   - 读该文件的 **Common Mistakes** + **Rules** 段（单文件 200 行预算）
   - 未命中或 `.claude/code-specs/` 不存在 → 记录"code-spec 未覆盖该模块"，不阻断流程

### 1.3 识别问题类型

| 关键词 | 类型 | 审查方式 |
|--------|------|----------|
| 白屏、渲染、样式、组件、状态 | 前端 | 当前模型直接审查 |
| API、数据库、500、超时、权限 | 后端 | Codex 审查 |
| 混合特征 | 全栈 | Codex 审查（后端逻辑优先） |

### 1.4 假设驱动的根因追溯

**Step 1: 反向追踪**
- 从错误现象出发，沿数据流/调用链反向追踪
- 在每个组件边界检查输入/输出，定位“最后正确”和“首次错误”的边界
- 记录追踪路径：`错误现象 → 组件A → 组件B → 根因位置`

**Step 2: 形成假设**
- 基于追踪结果，形成 1 个主假设 + 最多 1 个备选假设
- 假设格式：`因为 {原因}，导致 {组件} 在 {条件} 下产生 {错误行为}`

**Step 3: 最小化验证**
- 设计最小实验验证主假设，不直接进入修复
- 主假设被证伪 → 验证备选假设 → 都被证伪则回到 Step 1
- 假设被证实 → 进入 Phase 2

主/备假设均被证伪时，标记为 `manual_intervention` + `reason: root_cause_mismatch`，不继续推进到 Phase 2。

### 1.5 失败与中止处理

- Phase 3 验证失败按连续次数计数；连续 3 次失败 → 标记为 `manual_intervention` + `reason: verification_failed`，Hard Stop 输出：`已尝试 3 次修复均失败，问题可能不在表层。建议重新审视 {相关模块} 的架构设计或切分修复范围。`
- 用户若选择继续修复，需要重新走一遍 1.4 假设阶段（修改假设或拆小问题），计数器重置；直接放弃则保留 `manual_intervention` 标记。
- 任何进入 `manual_intervention` 的路径，`status_transition_ready` 强制为 `false`，不调用状态流转 MCP。

### 1.6 红旗清单

- `先试试改这个看看` — 没有假设就动手
- `可能是这里的问题` — 模糊定位，没有追踪证据
- `改了好几个地方应该能修好` — 散弹枪式修复
- `这些缺陷看起来差不多就合并吧` — 没有关系证据就合并

### 1.7 重复缺陷识别（可选）

仅在入参为 `issue_number` 时做一次 best-effort 扫描，用于发现可能被"顺手修掉"的同源缺陷。没有命中就留空，不强求。

- 按 `module_hint` / 关键错误码 / 主要复现路径，在项目缺陷列表中查找同经办人或同模块下未关闭的缺陷（可复用 `mcp__mcp-router__list_issues`）。
- 命中时在 Phase 2 的 Hard Stop 里把候选列出来，由用户决定是否纳入 `included_issues`（一起修）或 `issues_covered_as_duplicates`（判定为重复）。
- 禁止自动合并。不确定时保持空数组，与 bug-batch 的 `needs_manual_judgement` 策略保持一致。

### 1.8 Phase 1 输出

分析完成后输出：
1. 根因假设及验证证据
2. 修复方案（至少 2 个）
3. 推荐方案及理由
4. 候选的 `included_issues` / `issues_covered_as_duplicates`（若 1.7 有命中）

### 1.9 manual_intervention 原因表

单缺陷流程下，可能命中的 reason 枚举（与 bug-batch 保持同名，仅取单缺陷相关项）：

| reason | 触发点 |
|--------|--------|
| `root_cause_mismatch` | Phase 1.4 主/备假设均被证伪 |
| `verification_failed` | Phase 3 验证连续 3 次失败 |
| `out_of_scope` | Phase 3 实际改动超出确认方案的文件范围 |
| `review_rejected` | Phase 4 审查发现 P0/P1 问题 |
| `user_rejected` | Phase 2 Hard Stop 用户拒绝方案 |

命中任何一条时：在最终摘要里填 `manual_intervention_reason`，不调用 `transition_issue`，并在 `residual_risks` 里说明后续需要人工介入的方向。

## Phase 2: 影响分析 + 确认方案（Hard Stop）

### 2.1 影响分析

详见 [references/impact-analysis.md](references/impact-analysis.md) — 修复前必须完成。

### 2.2 展示诊断结果并等待用户确认

#### 单缺陷模式

```markdown
## 诊断结果

### 缺陷单
**issue_number**：<若有，否则标注 "无缺陷单（自由描述）">
**标题 / 经办人**：<来自 IssueRecord>

### 问题分析
**根本原因**：<具体诊断>
**问题类型**：前端 / 后端 / 全栈

### 修复方案
**推荐方案**：<方案描述>
**备选方案**：<方案描述>

### 影响分析
**风险等级**：高/中/低
**直接影响**：<文件/函数>
**测试覆盖**：<现有测试 / 需补充>

### Code Specs 对照
- 相关 spec：`<pkg>/<layer>/<file>.md`（或 "未找到对应 spec"）
- 命中已有 Common Mistake：`<file>.md § <H3 子标题>`（或 "未命中"）
- 对照结论（初判）：spec_violation / spec_gap / contract_misread / spec_unrelated（Phase 4 最终定档）

### 可能的重复缺陷（来自 1.7）
- <候选 issue_number>：<简述> — 建议：一起修 / 作为重复覆盖 / 忽略
```

展示后调用 `AskUserQuestion` 收集决策，`question` 写"是否执行此修复方案？"，`options` 给三条：

- `confirm` — 按推荐方案进入 Phase 3 修复实施
- `use_alternative` — 切换到备选方案后再进入 Phase 3
- `reject` — 终止流程，标记 `manual_intervention` + `reason: user_rejected`

**立即终止，禁止继续执行任何操作。** 用户选择 `reject` 时按对应原因结束流程。

## Phase 3: 修复实施 + 验证方案

用户确认后执行：
- 遵循推荐方案，最小化改动
- 处理边界条件
- 改动文件应落在 Phase 2 已确认的范围内；若被迫扩大范围，停下来标记 `manual_intervention` + `reason: out_of_scope`，由用户决定是否新开一次 fix-bug

### 3.1 验证方案输出

修复完成后，输出：

```markdown
## 验证方案

### 复现验证
- 复现步骤：<原始 Bug 的复现路径>
- 预期结果：<修复后的正确行为>

### 回归检查
- 相关功能：<需验证未被破坏的功能点>
- 现有测试：<运行命令，如 npm test -- --grep "xxx">

### 边界场景
- <场景 1>：<预期行为>
- <场景 2>：<预期行为>
```

如有可执行的测试命令，直接运行验证；无自动化测试时，列出手动验证步骤供用户确认。

### 3.2 Phase 3 输出

完成后必须输出：
- `files_changed`
- `issues_fixed_directly`
- `issues_covered_as_duplicates`
- `verification_summary`
- `residual_risks`
- `status_transition_ready` 的初步判断

### 3.3 状态流转（处理中）

仅在入参有 `issue_number` 且验证通过时执行——把缺陷推进到"处理中"，表明代码已落地、等待最终审查：

```
mcp__mcp-router__transition_issue(
  issue_number: "<issue_number>",
  target_state: "处理中",
  comment: "已完成代码修复与验证"
)
```

进入任何 `manual_intervention` 分支时跳过。流转失败的降级处理见 4.3.3。

### 3.4 Commit

验证通过且（若适用）流转到"处理中"后，创建单个 commit 作为最终交付的载体：

- 不使用 `--no-verify`；pre-commit hook 失败 → 修复后重新 commit（不 amend）
- message 模板：

  ```
  fix: <issue_number> <一句话问题摘要>
  ```

  无 `issue_number` 时退化为 `fix: <一句话摘要>`。摘要来自 Phase 1 确认的根因，不包含文件路径或行号。

- 单 commit，不拆分；若改动跨多个关注点以至于难以用一句话概括，说明范围超出了单缺陷，回到 3.1 顶部按 `out_of_scope` 处理
- 记录 commit SHA 到 `commit_sha`，供 Phase 4 引用

## Phase 4: 模型审查 + 状态流转就绪判断

修复完成后，根据 Phase 1 识别的问题类型选择审查方式。

### 路由规则

- 前端问题 → 当前模型直接审查
- 后端问题 → Codex 审查
- 全栈问题 → Codex 审查（后端逻辑优先）

按 `collaborating-with-codex` skill 调用（后台执行，不设 timeout）：

```
PROMPT: "ROLE: Code Reviewer. CONSTRAINTS: READ-ONLY, output review comments sorted by P0→P3. Review bug fix: Bug: {{问题描述}}. Root cause: {{根本原因}}. Fix: {{方案摘要}}. Diff: {{git diff 内容}}. Evaluate: root cause resolution, regression risk, edge cases, code quality. OUTPUT FORMAT: Review comments only, sort by P0→P3."
```

**降级策略**：Codex 不可用时由当前模型直接审查。

### 4.1 Code Specs Impact 定档（强制）

审查完成后、状态流转就绪判断前，必须按本次根因与 code-spec 的关系显式输出 `code_specs_impact`，四档必选其一：

| 档位 | 含义 | 输出动作 |
|------|------|----------|
| `spec_violation` | 违反了已有 spec 的 Common Mistake / Rule | 指出具体段落路径 `{pkg}/{layer}/{file}.md § {H3 子标题}`，附"spec-before-dev 未生效或流程断点，建议追溯为何未遵守" |
| `spec_gap` | spec 里未覆盖这种情况 | 填充 `code_specs_advisory`：一条预填 Common Mistake 草案（Bad/Good 对比 + Why），并附一句"建议运行 `/spec-update` 写入 `{pkg}/{layer}/{file}.md` 的 Common Mistakes 段" |
| `contract_misread` | 契约误解（API/DB/字段） | 指向对应 contract 文件的 `§ Validation & Error Matrix` 或 `§ Wrong vs Correct` 段落 |
| `spec_unrelated` | 环境/第三方/偶发，与 spec 无关 | 明确标注"与 code-spec 无关"，`code_specs_advisory` 留空，避免用户误以为每次都要动 spec |

定档说明：

- 本次根因若涉及 spec 已明示但未遵守的行为（Common Mistake 或 Rule 的反例），判 `spec_violation`
- 本次根因是 spec 范围内但未记录的新坑 → `spec_gap`，此时主会话直接把 Bad/Good 对比草拟成文字，交由用户触发 `/spec-update`
- 若根因是环境/第三方依赖/偶发，不要为了"看起来有闭环"强行判为 `spec_gap`

兜底：`.claude/code-specs/` 整个目录不存在 → 统一判 `spec_unrelated`，`code_specs_advisory` 留空（此时没有 spec 结构，"缺口"概念不成立，强判 `spec_gap` 会产生虚假 advisory）。`.claude/code-specs/` 存在时，只要该坑未被任何段落覆盖都判 `spec_gap`——Phase 1.2 命中具体文件的，advisory 指向该文件的 Common Mistakes 段；未命中具体文件的，advisory 里的 `{file}.md` 换成建议新建的文件路径（由 `/spec-update` 最终决定落点）。

### 4.2 状态流转就绪判断

审查完成后，必须显式给出：
- `review_summary`
- `root_cause_confirmed`
- `status_transition_ready`

仅当以下条件同时满足时，才可输出 `status_transition_ready = true`：
- 根因已确认
- 推荐方案已落地
- 验证结果与预期一致
- 审查未发现阻断问题
- 入参有 `issue_number`（自由描述的 bug 无缺陷单可流转）

若任一条件不满足：
- 输出 `status_transition_ready = false`，明确说明原因
- 审查发现 P0/P1 问题时，额外标记 `manual_intervention` + `reason: review_rejected`

### 4.3 状态流转动作

#### 4.3.1 审查通过

`status_transition_ready = true` 时，把缺陷从"处理中"推进到"待验证"：

```
mcp__mcp-router__transition_issue(
  issue_number: "<issue_number>",
  target_state: "待验证",
  comment: "Commit <commit_sha> 已提交"
)
```

`included_issues` / `issues_covered_as_duplicates` 里的缺陷与 `primary_issue` 一起流转，MCP 不支持一次多选时按顺序逐条调用。

#### 4.3.2 审查未通过 / manual_intervention

- 不调用 `transition_issue`
- 在最终摘要里填 `manual_intervention_reason`
- 已在 3.3 推进到"处理中"的缺陷保留原状态（让人工介入者能看到代码已落地），不回滚

#### 4.3.3 流转失败处理

与 bug-batch 一致的轻量策略：

- 网络或接口错误 → 重试 1 次，仍失败则记录到 `residual_risks`，流程继续不 Hard Stop
- 状态不允许转换（如当前已在"待验证"）→ 记录实际状态后跳过
- MCP 不可用 → 记录原因，提醒用户手动流转

## 推荐的最终结果摘要格式

```markdown
## 修复结果摘要

- Root Cause Confirmed: true
- Recommended Fix: <方案摘要>
- Alternative Fixes: <备选方案>
- Files Changed: <修改文件>
- Issues Fixed Directly: <直接修复的缺陷>
- Issues Covered As Duplicates: <作为重复问题覆盖的缺陷>
- Verification Summary: <验证结果>
- Review Summary: <审查结论>
- Commit SHA: <commit_sha 或 空>
- Status Transition Ready: true / false
- Manual Intervention Reason: <reason 或 空>
- Residual Risks: <残余风险>
- Code Specs Impact: spec_violation / spec_gap / contract_misread / spec_unrelated
- Code Specs Advisory: <spec_violation 指段落路径；spec_gap 给 Bad/Good 草案 + /spec-update 提示；contract_misread 指 contract 文件的 § Validation & Error Matrix 或 § Wrong vs Correct；spec_unrelated 留空>
```

## 关键原则

1. **先验证，不假设** — 所有假设需证据支持
2. **分析影响** — 修复前评估回归风险
3. **用户确认** — 修复前必须获得确认
4. **最小改动** — 优先局部修复，避免大范围重构
5. **状态流转要有依据** — 只有 `status_transition_ready = true` 才允许推进状态更新
6. **按需审查** — 后端/全栈问题路由到 Codex，前端问题由当前模型直接审查
