---
name: debug
description: "Bug 修复流程：问题定位 → 影响分析 → 确认方案 → 修复 → Codex 审查。既可处理单个缺陷，也可作为 bug-batch 的单修复单元执行协议，支持关联缺陷、重复缺陷和共享根因场景。修复完成后输出是否允许进入状态流转的结论。"
---

# 调试与修复

从问题定位到修复验证的完整流程。该 skill 既可直接处理单个 Bug，也可作为 `bug-batch` 的底层执行协议，用于处理一个 `FixUnit`。

## 用法

```bash
/debug <问题描述>
/debug "p328_600"
```

## 适用模式

### 模式 A：单缺陷调试

直接接收一个问题描述、错误现象或工作项编号，按标准调试流程执行。

### 模式 B：单修复单元执行协议

当由 `bug-batch` 调用时，输入对象不再只是单个缺陷，而是一个 `FixUnit`：
- 包含 1 个 `primary_issue`
- 包含若干 `included_issues`
- 可包含 `duplicate_issues`
- 可附带 `blocked_by_units`、`shared_root_cause`、`affected_scope`、`validation_scope`

在该模式下，`debug` 的目标不是只修一个工单，而是验证并修复整个修复单元覆盖的问题集合。

## 统一术语

- `IssueRecord`：单个缺陷的标准化信息
- `FixUnit`：一个实际执行修复的最小单元
- `primary_issue`：修复单元中的主缺陷
- `included_issues`：本次修改直接覆盖的缺陷
- `duplicate_issues`：判定为重复、继承主修复结果的缺陷
- `shared_root_cause`：多个缺陷共享的根因描述
- `status_transition_ready`：是否允许进入缺陷状态流转

## 输入契约

### 单缺陷模式输入

```yaml
bug: "用户头像上传失败，返回 413 错误"
```

或：

```yaml
issue_number: "p328_600"
```

### FixUnit 模式输入

```yaml
unit_id: "FU-001"
primary_issue: "p003"
included_issues: ["p003", "p001"]
duplicate_issues: ["p002"]
blocked_by_units: []
shared_root_cause: "token 刷新链路失效"
affected_scope:
  - "auth/api"
  - "session-store"
validation_scope:
  - "登录态刷新"
  - "历史重复问题回归验证"
issue_context:
  - issue_number: "p003"
    title: "登录后刷新失败"
  - issue_number: "p001"
    title: "会话偶发失效"
  - issue_number: "p002"
    title: "与 p001 重复的登录问题"
```

## 输出契约

无论是哪种模式，最终都应输出以下结构化信息：
- `root_cause_confirmed`
- `recommended_fix`
- `alternative_fixes`
- `affected_scope`
- `verification_summary`
- `review_summary`
- `issues_fixed_directly`
- `issues_covered_as_duplicates`
- `status_transition_ready`
- `residual_risks`

当输入为 `FixUnit` 时，以上字段必须基于修复单元整体输出，而不是只针对主缺陷。

## 执行流程

```
Phase 1: 检索上下文 + 问题分析
Phase 2: 影响分析 + 确认方案（Hard Stop）
Phase 3: 修复实施 + 验证方案
Phase 4: 模型审查 + 状态流转就绪判断
```

## Phase 1: 检索上下文 + 问题分析

### 1.1 检索上下文

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 检索相关代码
2. 收集错误日志、堆栈信息、复现步骤
3. 若输入为 `FixUnit`，需同时读取主缺陷、关联缺陷、重复缺陷的上下文，验证关系判断是否成立

### 1.2 识别问题类型

| 关键词 | 类型 | 审查方式 |
|--------|------|----------|
| 白屏、渲染、样式、组件、状态 | 前端 | 当前模型直接审查 |
| API、数据库、500、超时、权限 | 后端 | Codex 审查 |
| 混合特征 | 全栈 | Codex 审查（后端逻辑优先） |

若一个 `FixUnit` 同时覆盖前后端问题，以**共享根因所在层**为主；无法判断时按全栈处理。

### 1.3 假设驱动的根因追溯

**Step 1: 反向追踪**
- 从错误现象出发，沿数据流/调用链反向追踪
- 在每个组件边界检查输入/输出，定位“最后正确”和“首次错误”的边界
- 记录追踪路径：`错误现象 → 组件A → 组件B → 根因位置`

**Step 2: 形成假设**
- 基于追踪结果，形成 1 个主假设 + 最多 1 个备选假设
- 假设格式：`因为 {原因}，导致 {组件} 在 {条件} 下产生 {错误行为}`
- 若为 `FixUnit`，需同时说明：
  - 哪些缺陷由主假设直接解释
  - 哪些缺陷只是重复现象
  - 哪些缺陷与主假设耦合但仍需单独验证

**Step 3: 最小化验证**
- 设计最小实验验证主假设，不直接进入修复
- 主假设被证伪 → 验证备选假设 → 都被证伪则回到 Step 1
- 假设被证实 → 进入 Phase 2

### 1.4 关系复核（FixUnit 模式必做）

若由 `bug-batch` 传入 `FixUnit`，必须在 Phase 1 明确输出关系复核结果：
- `duplicate_of` 判断是否成立
- `same_root_cause` 判断是否成立
- `coupled_with` 是否需要保持同单元修复
- `blocked_by` 是否仍然有效

若发现关系判断不成立：
- 不允许直接继续修复
- 输出 `status_transition_ready = false`
- 建议将当前单元退回批量编排阶段重新拆分

### 1.5 失败计数器

- 计数对象：Phase 3 中修复后验证仍失败的次数
- 连续 3 次失败 → Hard Stop，输出：`已尝试 3 次修复均失败，问题可能不在表层。建议重新审视 {相关模块} 的架构设计或重新拆分修复单元。`
- 用户确认后重置计数器，可选择继续修复或转为架构重构

### 1.6 红旗清单

- `先试试改这个看看` — 没有假设就动手
- `可能是这里的问题` — 模糊定位，没有追踪证据
- `改了好几个地方应该能修好` — 散弹枪式修复
- `这些缺陷看起来差不多就合并吧` — 没有关系证据就合并

### 1.7 Phase 1 输出

分析完成后输出：
1. 根因假设及验证证据
2. 修复方案（至少 2 个）
3. 推荐方案及理由
4. 若为 `FixUnit`：
   - `issues_fixed_directly` 的候选列表
   - `issues_covered_as_duplicates` 的候选列表
   - 关系复核结论

## Phase 2: 影响分析 + 确认方案（Hard Stop）

### 2.1 影响分析

详见 [references/impact-analysis.md](references/impact-analysis.md) — 修复前必须完成。

若为 `FixUnit`，影响分析必须覆盖：
- 主缺陷直接影响范围
- 关联缺陷共享的代码路径
- 重复缺陷需要补做的回归验证范围
- 下游依赖单元是否会因当前修复而解除阻塞

### 2.2 展示诊断结果并等待用户确认

#### 单缺陷模式

```markdown
## 诊断结果

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

## 是否继续执行此修复方案？(Y/N)
```

#### FixUnit 模式

```markdown
## 修复单元诊断结果

### 修复单元
- FixUnit: <unit_id>
- 主缺陷: <primary_issue>
- 直接覆盖缺陷: <included_issues>
- 重复缺陷: <duplicate_issues>

### 问题分析
**共享根因**：<具体诊断>
**关系复核**：<duplicate / same_root_cause / coupled_with / blocked_by 的确认结果>
**问题类型**：前端 / 后端 / 全栈

### 修复方案
**推荐方案**：<方案描述>
**备选方案**：<方案描述>

### 影响分析
**风险等级**：高/中/低
**直接影响**：<文件/函数>
**联动验证范围**：<需一起验证的功能点>
**阻塞解除判断**：<是否会解除其他单元阻塞>

## 是否继续执行该 FixUnit 的修复方案？(Y/N)
```

**立即终止，禁止继续执行任何操作。**

## Phase 3: 修复实施 + 验证方案

用户确认后执行：
- 遵循推荐方案，最小化改动
- 处理边界条件
- 严禁为了同时覆盖多个缺陷而进行无边界的大范围重构

### 3.1 修复要求

若为 `FixUnit`：
- 优先保证 `primary_issue` 与 `included_issues` 被直接修复
- `duplicate_issues` 不强制逐个定制修复，但必须验证它们是否被主修复覆盖
- 若验证发现某个 `duplicate_issue` 实际并非重复问题，应在结果中显式标记并要求退回重编排

### 3.2 验证方案输出

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

若为 `FixUnit`，还需追加：

```markdown
### 缺陷覆盖说明
- 直接修复：<issues_fixed_directly>
- 重复归并覆盖：<issues_covered_as_duplicates>
- 仍需人工判断：<未能确认的工单，如有>
```

如有可执行的测试命令，直接运行验证；无自动化测试时，列出手动验证步骤供用户确认。

### 3.3 Phase 3 输出

完成后必须输出：
- `files_changed`
- `issues_fixed_directly`
- `issues_covered_as_duplicates`
- `verification_summary`
- `residual_risks`
- `status_transition_ready` 的初步判断

## Phase 4: 模型审查 + 状态流转就绪判断

修复完成后，根据 Phase 1 识别的问题类型选择审查方式。

### 路由规则

- 前端问题 → 当前模型直接审查
- 后端问题 → Codex 审查
- 全栈问题 → Codex 审查（后端逻辑优先）

按 `collaborating-with-codex` skill 调用（后台执行，不设 timeout）：

```
PROMPT: "ROLE: Code Reviewer. CONSTRAINTS: READ-ONLY, output review comments sorted by P0→P3. Review bug fix: Bug/FixUnit: {{问题描述或修复单元编号}}. Root cause: {{根本原因}}. Fix: {{方案摘要}}. Diff: {{git diff 内容}}. Evaluate: root cause resolution, regression risk, edge cases, code quality. OUTPUT FORMAT: Review comments only, sort by P0→P3."
```

**降级策略**：Codex 不可用时由当前模型直接审查。

### 4.1 状态流转就绪判断

审查完成后，必须显式给出：
- `review_summary`
- `root_cause_confirmed`
- `status_transition_ready`

仅当以下条件同时满足时，才可输出 `status_transition_ready = true`：
- 根因已确认
- 推荐方案已落地
- 验证结果与预期一致
- 审查未发现阻断问题
- 若为 `FixUnit`，关联缺陷与重复缺陷的覆盖结论清晰

若任一条件不满足：
- 输出 `status_transition_ready = false`
- 明确说明原因
- 若由 `bug-batch` 调用，应由上层流程决定保持在 `处理中`、转为 `manual_intervention`，或退回重新编排

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
- Status Transition Ready: true / false
- Residual Risks: <残余风险>
```

## 关键原则

1. **先验证，不假设** — 所有假设需证据支持
2. **先确认关系，再修复** — FixUnit 模式下必须先复核重复/耦合/依赖判断
3. **分析影响** — 修复前评估回归风险与联动验证范围
4. **用户确认** — 修复前必须获得确认
5. **最小改动** — 优先局部修复，避免大范围重构
6. **重复不单修** — 重复缺陷默认继承主修复结果，但必须验证其确实被覆盖
7. **状态流转要有依据** — 只有 `status_transition_ready = true` 才允许上层流程推进状态更新
8. **按需审查** — 后端/全栈问题路由到 Codex，前端问题由当前模型直接审查
