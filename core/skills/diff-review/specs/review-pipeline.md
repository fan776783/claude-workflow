# 共享审查管线（Review Pipeline）

> 这份规范从 `diff-review` 的 deep-mode 抽出，作为所有"基于变更集的代码审查"skill 的共享管线契约。输入是一份**已界定的变更集**（文件列表 + 每个文件的 diff 或改动说明），输出是按 `report-schema.md` 的报告。
>
> 适用 skill：`diff-review`、`session-review`，以及其它以"候选问题 → 验证 → 影响分析 → 汇总"为骨架的审查型 skill。

## 何时读取

- 进入审查 skill 并完成**变更集界定**（获取 diff / 列出文件）之后
- 候选问题发现之前
- 每轮 Review Loop 重审之前

调用方负责提供变更集。本规范不规定变更集从哪里来（staged diff / branch diff / 会话上下文 / 用户显式列表）。

## 输入契约

调用方必须在进入本管线前准备好：

| 字段 | 说明 |
|------|------|
| `变更集来源` | 人可读描述，用自然语言说明"在审查什么"。例：`已暂存的 3 个文件`、`本会话从 Edit/Write 记录提取的 7 个文件` |
| `文件清单` | 改动文件的路径列表 + 每个文件的 diff 或改动摘要 |
| `统计` | 文件数、+/- 行数（可选但推荐） |

未提供变更集来源的调用**禁止**进入本管线。

## 管线

### Layer C: Parallel Candidate Discovery

#### Codex 候选问题发现

按 `collaborating-with-codex` skill 实际执行桥接脚本调用 Codex，使用 `run_in_background: true`（**不设置** timeout）。

**禁止预判降级**：不得在未实际执行桥接脚本的情况下，以"当前环境 Codex 不可用"、"未检测到 Codex"、"Codex 环境缺失"等理由跳过此步骤。是否可用只能由脚本执行结果决定——先调用，失败了再走降级路径。

Codex prompt 必须明确：

- 只输出候选问题，不输出最终 verdict
- 审查范围要在 prompt 里显式限定到本次变更集文件，并声明"忽略其它 working-tree 变更"——避免 Codex 审到范围外的内容
- 关注维度：
  - logic correctness
  - edge cases
  - error handling
  - security vulnerabilities
  - performance issues
  - concurrency / resource management
  - changed contracts and likely downstream impact
- 若声称会影响其他部分，必须指出具体受影响代码路径、调用方、契约或测试面

#### 当前模型候选问题发现

在等待 Codex 结果期间，当前模型独立审查：

- 组件设计、props 接口、状态管理
- 可访问性（语义 HTML、ARIA、键盘导航）
- 响应式设计、暗色模式支持
- 交互状态（hover、focus、loading、error、empty）
- 前后端 / 跨层契约匹配

两路并行，主任务不得等 Codex 结果才开始自审。

### Layer D: Candidate Normalization + Deduplication

使用 `TaskOutput` 获取 Codex 结果后，当前模型统一处理：

1. 将 Codex / Claude 两侧输出归一化为同一 finding 结构
2. 去重合并相同问题（同 file + 近似 line range + 同 issue category）
3. 标记来源：`Codex` / `Claude` / `Both`
4. 区分"候选问题数量"与"准备进入验证的问题数量"

### Layer E: Finding Verification

对所有准备进入最终报告的 P0 / P1 / P2 候选问题执行验证：

1. **代码库验证**：检索代码库，确认问题真实存在
2. **Introduced-by-change 检查**：确认问题由本次变更集引入，而不是预先存在
3. **适用性检查**：建议是否适用于当前技术栈、架构与上下文
4. **YAGNI 检查**：非安全类建议是否有实际使用场景
5. **副作用评估**：采纳建议是否可能引入新问题

处理结果：

| 结果 | 处理 |
|------|------|
| `verified` | 进入 impact analysis |
| `partially_verified` | 保留，但仅能作为 P2/P3 或不确定性说明进入最终报告，不能单独阻断 Verdict |
| `rejected` | 从最终报告剔除 |

禁止不加验证地全盘接受外部模型建议；禁止把推测性问题直接提升为 P0/P1。

### Layer F: Impact Analysis

对所有 material findings 执行影响性分析，遵循 [`impact-analysis.md`](impact-analysis.md)。

至少覆盖：direct files、affected modules / callers / consumers、contract / shared state / user-visible surfaces、blast radius、regression risk、existing tests、validation scope。

**最低要求**：

- 所有最终进入报告的 P0/P1 finding：必须执行完整 impact analysis
- 声称存在跨模块、共享状态、契约边界或回归风险的 P2 finding：必须执行完整 impact analysis
- 局部 P2 / P3：可使用轻量 impact scan，但必须说明为什么影响局限于局部

impact analysis 必须为最终 severity、fix scope、regression verification 提供依据，不是补充说明。

### Layer G: Severity Calibration + Final Adjudication

在 verification 与 impact analysis 完成后：

1. 重新确定 severity（P0-P3）
2. 确认哪些 finding 真正足以影响 verdict
3. 计算：`Impact Status`、`Verification Coverage`、最终 `Confidence`
4. 输出最终 `Verdict`

**Severity 定义**：

- **P0**：已验证的问题会造成阻塞发布级故障，或后果极严重（安全、数据破坏、核心流程瘫痪）
- **P1**：问题真实存在，影响面明确，会在实际使用中造成重要功能错误或明显回归
- **P2**：问题真实存在，但影响受限、可控，或需要特定上下文才触发
- **P3**：建议项、局部优化项，或 impact 已证实局限在很小范围内

禁止在未完成 verification / impact analysis 前，仅凭直觉给出最终 P0/P1。

**Verdict 规则**：

| 场景 | Verdict |
|------|---------|
| 无 P0/P1 | `CORRECT` |
| 任一 P0 | `INCORRECT` |
| 阻塞阈值的 P1 组合 | `INCORRECT` |
| Codex 调用失败，无 P0 | `CORRECT (degraded)` |

### Layer H: Report Synthesis

按 [`report-schema.md`](report-schema.md) 输出报告。

**关键要求**：

- Summary 包含：`Review Mode`、`审查范围`、`Verdict`、`Confidence`、`Impact Status`、`Verification Coverage`、`Files`、`Codex Status`
- 所有 material findings 必须包含 `Evidence` 与 `Verification`
- P0/P1 findings 必须是 `verified`，且包含完整 `Impact`、`Fix Scope`、`Regression Verification`
- 保留 `Source` 归属与统计信息

## Review Loop 契约

若 Verdict = `INCORRECT`：

- 所有 P0/P1 finding 必须给出 impact-aware `Fix Scope` 与 `Regression Verification`
- 报告末尾保留 fix/skip 提示句（见 `report-schema.md`）
- 在用户明确输入 `fix` 之前，默认停在报告阶段，不自动转入修复

重新审查时：

1. 先重新检查上轮 blocking findings 的 impact scope 与 validation scope
2. 再重新执行完整管线（Layer C-H）
3. 连续 3 轮仍有问题 → 强制停止，输出剩余问题清单供用户手动处理

## 不在本规范范围

- **变更集界定方式**：由调用方 skill 决定（git diff / 会话上下文 / 文件列表）
- **Entry Gate / 审查铁律**：由调用方 skill 定义
- **报告格式细节**：见 `report-schema.md`
- **影响分析细节**：见 `impact-analysis.md`
