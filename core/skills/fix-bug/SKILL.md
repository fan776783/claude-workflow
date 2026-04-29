---
name: fix-bug
description: "Bug 修复workflow：问题定位 → 影响分析 → 确认方案 → 修复 → Codex review。用于处理单个缺陷，包含完整的 4 Phase workflow和 Hard Stop 确认。批量场景请使用 bug-batch，其内部修复协议不经过本 skill。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:纯 typo 级修复可走跳过条件;没有最新 code-specs 和 glossary 做 bug 分析容易误判 layer。
</PRE-FLIGHT>

# 调试与修复

单个 Bug 的分析、确认、修复、review四阶段workflow。批量缺陷场景请使用 `/bug-batch`（其内部修复协议不调用本 skill，避免嵌套 Hard Stop）。

## 用法

```bash
/fix-bug <问题描述>
/fix-bug "p328_600"
```

## 前置建议：先建反馈循环

复杂 Bug / 性能回归 / 间歇性问题 → 建议先 `/diagnose` 完成反馈循环 + 根因证伪，把产出的 `root_cause` / `recommended_fix` / `alternative_fixes` / `regression_seam` 带回本 skill 消费。

简单 Bug / 明确根因的修复可直接进入 Phase 1。

## 统一术语

- `IssueRecord`：单个缺陷的标准化信息
- `FixUnit`：一个实际执行修复的最小单元
- `primary_issue`：修复单元中的主缺陷
- `included_issues`：本次修改直接覆盖的缺陷
- `duplicate_issues`：判定为重复、继承主修复结果的缺陷
- `shared_root_cause`：多个缺陷共享的根因描述
- `status_transition_ready`：是否允许进入缺陷状态流转

## 输入contract

```yaml
bug: "用户头像上传失败，返回 413 错误"
```

或：

```yaml
issue_number: "p328_600"
```

## 输出contract

最终输出结构化字段（详见 Phase 4 / 摘要）：
- `root_cause_confirmed`、`recommended_fix`、`alternative_fixes`、`affected_scope`
- `verification_summary`、`review_summary`
- `issues_fixed_directly`、`issues_covered_as_duplicates`
- `status_transition_ready`、`commit_sha`、`manual_intervention_reason`、`residual_risks`
- `code_specs_impact`（`spec_violation` / `spec_gap` / `contract_misread` / `spec_unrelated`）+ `code_specs_advisory`

## 执行workflow

```
Phase 1: 检索上下文 + 问题分析
Phase 2: 影响分析 + 确认方案（Hard Stop）
Phase 3: 修复实施 + 验证方案
Phase 4: 模型审查 + 状态流转就绪判断
```

## Phase 1: 检索上下文 + 问题分析

### 1.1 输入归一化

入参形态判断后标准化为 `IssueRecord`：
- `issue_number` → 按 [references/issue-intake.md](references/issue-intake.md) 读项目配置 + 通过 `bk` skill 的 `get_issue` CLI 拉详情
- 自由描述 `bug` → 构造只含 `description` 的最小 IssueRecord；`status_transition_ready` 恒为 `false`

### 1.2 检索上下文

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 检索相关代码
2. 收集错误日志、堆栈信息、复现步骤
3. 按问题代码目录定位对应 code-spec：
   - 从检索结果定位文件路径提取 `pkg` / `layer`
   - 此处 `layer` 仅用于**定位 spec 目录**（frontend / backend / unit-test / docs 等），与 1.3 review路由判断无关
   - 读 `.claude/code-specs/{pkg}/{layer}/index.md` 的 Guidelines Index 表
   - 跟读命中的 convention / contract 的 **Common Mistakes** + **Rules** 段（单文件 200 行预算）
   - 未命中或 `.claude/code-specs/` 不存在 → 记录"code-spec 未覆盖"，不阻断

### 1.3 review路由

按 `core/specs/shared/codex-routing.md § 决策表` 判定前端 / 后端 / 全栈，为 Phase 4 选择review方式。

### 1.4 根因追溯

**首选**：调用 `/diagnose` 产出 `root_cause` + `recommended_fix` + 可证伪假设表，回到本 skill 的 Phase 2。

**简单 Bug 直接追溯**：
- 反向追踪数据流 / 调用链，找"最后正确 / 首次错误"边界
- 基于证据生成根因陈述（不是 vibe）

若追溯失败 / 假设无法验证 → 标记 `manual_intervention` + `reason: root_cause_mismatch`（见 `core/specs/shared/manual-intervention-reasons.md`）。

### 1.5 失败与中止

- Phase 3 验证连续 3 次失败 → `manual_intervention` + `reason: verification_failed`，Hard Stop 输出：`已尝试 3 次修复均失败...`
- 用户继续修复需要重走 1.4（计数器重置）；放弃则保留 `manual_intervention`
- 任何 `manual_intervention` 路径强制 `status_transition_ready = false`

### 1.6 重复缺陷识别（仅 issue_number 入参）

best-effort 扫描同经办人 / 同module未关闭缺陷（`bk list_issues`）。
- 命中 → Phase 2 Hard Stop 中列出，由用户决定纳入 `included_issues` 或 `issues_covered_as_duplicates`
- 不自动合并；不确定保持空数组

### 1.7 Manual Intervention Reasons

单缺陷可能命中子集：`root_cause_mismatch` / `verification_failed` / `out_of_scope` / `review_rejected` / `user_rejected`。完整定义见 `core/specs/shared/manual-intervention-reasons.md`。

### 1.8 Phase 1 输出

- 根因假设 + 验证证据
- 修复方案（至少 2 个）+ 推荐理由
- 候选 `included_issues` / `issues_covered_as_duplicates`（若 1.6 命中）

## Phase 2: 影响分析 + 确认方案（Hard Stop）

### 2.1 影响分析

按 `core/specs/shared/impact-analysis-template.md § 6 个维度` 评估（最低要求：维度 1, 2, 3, 6）；具体操作手法见 [references/impact-analysis.md](references/impact-analysis.md)（依赖链 / 数据流 / 测试覆盖检查）。

### 2.2 展示诊断结果并 Hard Stop

```markdown
## 诊断结果

### 缺陷单
**issue_number**：<若有，否则标注 "无缺陷单（自由描述）">
**标题 / 经办人**：<来自 IssueRecord>

### 问题分析
**根本原因**：<具体诊断>
**问题类型**：前端 / 后端 / 全栈（按 codex-routing § 决策表）

### 修复方案
**推荐方案**：<方案描述>
**备选方案**：<方案描述>

### 影响分析
**风险等级**：高/中/低（按 impact-analysis-template § 严重性映射）
**Blast Radius**：<direct / upstream / downstream>
**Regression Surface**：<covered_by_tests / needs_manual_test>

### Code Specs 对照
- 相关 spec：`<pkg>/<layer>/<file>.md`（或"未找到对应 spec"）
- 命中已有 Common Mistake：`<file>.md § <H3 子标题>`（或"未命中"）
- 对照结论（初判）：spec_violation / spec_gap / contract_misread / spec_unrelated

### 可能的重复缺陷（来自 1.6）
- <候选 issue_number>：<简述> — 建议：一起修 / 作为重复覆盖 / 忽略
```

展示后调用 AskUserQuestion，模板见 `core/specs/shared/hard-stop-templates.md § T3`：
- `confirm` — 按推荐方案进入 Phase 3
- `use_alternative` — 切到备选方案再进入 Phase 3
- `reject` — 终止，标记 `manual_intervention` + `reason: user_rejected`

**立即终止，禁止继续执行任何操作**，直到用户回复。

## Phase 3: 修复实施 + 验证方案

用户确认后：
- 遵循推荐方案，最小化改动
- 处理边界条件
- 改动落在 Phase 2 已确认范围内；若被迫扩大 → 停下来标 `manual_intervention` + `reason: out_of_scope`

### 3.1 验证方案输出

```markdown
## 验证方案

### 复现验证
- 复现步骤：<原始 Bug 的复现路径>
- 预期结果：<修复后的正确行为>

### 回归检查
- 相关功能：<需验证未被破坏的功能点>
- 现有测试：<运行命令>

### 边界场景
- <场景 1>：<预期行为>
- <场景 2>：<预期行为>
```

有可执行测试直接跑；无自动化时列出手动验证步骤供用户确认。

### 3.2 Phase 3 输出

`files_changed` / `issues_fixed_directly` / `issues_covered_as_duplicates` / `verification_summary` / `residual_risks` / `status_transition_ready` 初判。

### 3.3 状态流转（"处理中"）

仅当入参有 `issue_number` 且验证通过时执行。按 `core/specs/shared/status-readiness.md § 流转动作` 通过 `bk transition_issue` 推进到 `处理中`，表明代码已落地。`manual_intervention` 路径跳过。失败处理按该文件"失败处理"矩阵。

### 3.4 Commit

验证通过且（若适用）流转到"处理中"后创建单 commit：
- 不使用 `--no-verify`；pre-commit hook 失败 → 修复后重新 commit（不 amend）
- message 模板：`fix: <issue_number> <一句话问题摘要>`（无 issue_number 时退为 `fix: <摘要>`）
- 摘要来自 Phase 1 确认的根因，不含文件路径 / 行号
- 单 commit；难以一句话概括 → 回 3.1 按 `out_of_scope` 处理
- 记录 `commit_sha` 供 Phase 4 引用

## Phase 4: 模型review + 状态流转就绪判断

### 4.1 路由 + 调用

按 `core/specs/shared/codex-routing.md` 决定review方 + 调用 prompt 模板。降级策略同该文件。

### 4.2 Code Specs Impact 定档（强制）

review完成后必须按四档之一输出 `code_specs_impact`：

| 档位 | 含义 | 输出动作 |
|------|------|----------|
| `spec_violation` | 违反已有 Common Mistake / Rule | 指出段落路径 `{pkg}/{layer}/{file}.md § {H3}`，附"code-spec 已明示但未被遵守，建议追溯workflow断点" |
| `spec_gap` | spec 里未覆盖 | `code_specs_advisory` 填一条 Bad/Good + Why 草案，附"建议 `/spec-update` 写入 `{pkg}/{layer}/{file}.md` Common Mistakes" |
| `contract_misread` | contract误解 | 指向 contract 文件的 `§ Validation & Error Matrix` 或 `§ Wrong vs Correct` |
| `spec_unrelated` | 环境 / 第三方 / 偶发 | 明确标注"与 code-spec 无关"，`advisory` 留空 |

兜底：`.claude/code-specs/` 整个目录不存在 → 统一判 `spec_unrelated`，`advisory` 留空。

### 4.3 状态流转就绪判断

按 `core/specs/shared/status-readiness.md § 判定条件` 评估（6 条全满足才 `true`）。

- `true` → 按 `status-readiness § 流转动作` 推进到 `待验证`（`transition_issue --target_state 待验证 --comment "Commit <sha> 已提交"`）。`included_issues` / `duplicate_issues` 同步跟随流转。
- `false` → 明确说原因；review P0 / P1 额外标 `manual_intervention` + `reason: review_rejected`

失败处理按 `status-readiness § 失败处理`。

## 最终摘要格式

```markdown
## 修复结果摘要

- Root Cause Confirmed: true
- Recommended Fix: <方案摘要>
- Alternative Fixes: <备选方案>
- Files Changed: <修改文件>
- Issues Fixed Directly: <直接修复>
- Issues Covered As Duplicates: <重复覆盖>
- Verification Summary: <验证结果>
- Review Summary: <审查结论>
- Commit SHA: <commit_sha 或 空>
- Status Transition Ready: true / false
- Manual Intervention Reason: <reason 或 空>
- Residual Risks: <残余风险>
- Code Specs Impact: spec_violation / spec_gap / contract_misread / spec_unrelated
- Code Specs Advisory: <见 4.2 档位要求>
```

## 关键原则

1. **先验证，不假设** — 所有假设需证据；复杂 Bug 用 `/diagnose` 先建反馈循环
2. **分析影响** — 修复前评估回归风险（`impact-analysis-template § 6 个维度`）
3. **用户确认** — 修复前 Hard Stop
4. **最小改动** — 优先局部修复
5. **状态流转有依据** — 只有 `status_transition_ready = true` 才推进
6. **按需review** — `codex-routing` 决定review方
