# Deep Review Mode (--deep)

Codex 协作审查，适用于重要 PR / 高风险改动。Deep 模式不是把 Codex 意见直接展示给用户，而是将 Codex 与当前模型的候选问题统一纳入 adjudication pipeline，完成验证、影响分析和最终裁决。

## 角色

**代码审查协调员**，编排双来源候选问题：
1. **Codex** — 后端逻辑、安全、性能、资源管理候选问题
2. **Claude (Self)** — 前端 UI/UX、可访问性、状态管理、交互行为候选问题
3. **Claude (Self)** — 统一裁决：归一化、验证、impact analysis、severity calibration、最终报告

## 执行原则

- Codex 输出的是**候选问题**，不是最终 findings
- 最终进入报告的问题必须经过当前模型统一验证与 impact analysis
- 只有通过验证的问题才能出现在最终报告中
- 报告结构必须遵循 `../specs/report-schema.md`

## 流程

### Layer A: Review Subject Resolution + Diff Acquisition

1. 解析 review subject：
   - 默认：`HEAD`
   - `--staged`
   - `<base>...HEAD`
2. 获取 diff 与状态
3. 统计变更文件、+/- 行数

### Layer B: File Classification

将变更文件分为两类：
- **后端文件**: `*.js, *.ts, *.py, *.go, *.java, *.rs` 等（非组件）
- **前端文件**: `*.tsx, *.jsx, *.vue, *.svelte, *.css, *.scss` 等

如遇全栈文件或边界不清晰文件，允许同时纳入两个视角审查。

### Layer C: Parallel Candidate Discovery

#### Codex 候选问题发现

使用 `run_in_background: true`（**不设置** timeout），按 `collaborating-with-codex` skill 调用。

Codex prompt 应明确要求：
- 只输出候选问题，不输出最终 verdict
- 关注：
  - logic correctness
  - edge cases
  - error handling
  - security vulnerabilities
  - performance issues
  - concurrency / resource management
  - changed contracts and likely downstream impact
- 若声称会影响其他部分，必须指出具体受影响代码路径、调用方、契约或测试面

#### 当前模型候选问题发现

在等待 Codex 结果期间，当前模型独立审查前端与集成面：
- 组件设计、props 接口、状态管理
- 可访问性（语义 HTML、ARIA、键盘导航）
- 响应式设计、暗色模式支持
- 交互状态（hover、focus、loading、error、empty）
- 前后端 / 跨层契约匹配

### Layer D: Candidate Normalization + Deduplication

使用 `TaskOutput` 获取 Codex 结果后，当前模型统一处理候选问题：
1. 将 Codex / Claude 两侧输出归一化为同一 finding 结构
2. 去重合并相同问题
3. 标记来源：`Codex` / `Claude` / `Both`
4. 区分“候选问题数量”和“准备进入验证的问题数量”

### Layer E: Finding Verification

对所有准备进入最终报告的 P0 / P1 / P2 候选问题执行验证：

1. **代码库验证**：问题是否真实存在
2. **Introduced-by-change 检查**：是否由当前 diff 引入
3. **适用性检查**：建议是否适用于当前架构与技术栈
4. **YAGNI 检查**：非安全类建议是否有实际使用场景
5. **副作用评估**：采纳建议是否可能引入新问题

处理结果：
- `verified`：进入 impact analysis
- `partially_verified`：允许保留，但仅能作为 P2/P3 或不确定性说明进入最终报告
- `rejected`：从最终报告剔除

### Layer F: Impact Analysis

对所有 material findings 执行影响性分析，遵循 `../specs/impact-analysis.md`。

至少需要覆盖：
- direct files
- affected modules / callers / consumers
- contract / shared state / user-visible surfaces
- blast radius
- regression risk
- existing tests
- validation scope

### Layer G: Severity Calibration + Final Adjudication

在 verification 与 impact analysis 完成后：
1. 重新确定 severity（P0-P3）
2. 确认哪些 finding 真正足以影响 verdict
3. 计算：
   - `Impact Status`
   - `Verification Coverage`
   - 最终 `Confidence`
4. 输出最终 `Verdict`

### Layer H: Report Synthesis

按 `../specs/report-schema.md` 输出 Deep 报告。

## 推荐输出格式

```markdown
# Deep Review Report

## Summary
| Field | Value |
|-------|-------|
| Review Mode | Deep |
| Review Subject | HEAD / --staged / <base>...HEAD |
| Verdict | CORRECT / INCORRECT |
| Confidence | 0.XX |
| Impact Status | not_needed / partial / complete |
| Verification Coverage | none / partial / complete |
| Files | X files (+Y/-Z lines) |
| Codex Status | success / failed / degraded |

**Explanation**: <综合结论>

---

## Critical Issues (P0-P1)

### [PX] <标题>
| Field | Value |
|-------|-------|
| ID | F-01 |
| File | `path/to/file.ts` |
| Lines | X-Y |
| Source | Codex / Claude / Both |

**Evidence**
- ...

**Verification**
- Status: verified
- Notes: ...

**Impact**
- ...

**If Unfixed**
- ...

**Fix Scope**
- ...

**Regression Verification**
- ...

---

## Other Issues (P2-P3)
...

---

## Statistics
| Metric | Value |
|--------|-------|
| Codex Candidates | X |
| Claude Candidates | X |
| Verified Findings | X |
| Consensus Issues | X |
| Rejected Candidates | X |

---

## Verdict
- <最终结论>
```

## Deep 模式额外要求

- 若 Codex 调用失败，但当前模型未发现 P0，可输出 `CORRECT (degraded)`，并在 Summary 中明确说明
- 若某个高优先级候选问题无法完成验证，不得直接进入最终 findings
- `partially_verified` 不能单独阻断 Verdict，也不能作为最终 P0/P1
- Source 归属不能替代 verification；`Source = Both` 只说明双方都发现了它，不说明它一定成立

## Review Loop 要求

若 Verdict = `INCORRECT`：
- 所有 P0/P1 finding 必须给出 impact-aware `Fix Scope` 与 `Regression Verification`
- 报告末尾必须保留：

```markdown
> 发现 X 个 P0/P1 问题，修复方案如上。输入 `fix` 按方案执行修复，`skip` 跳过。
```

重新审查时：
1. 先重新检查上轮 blocking findings 的 impact scope 与 validation scope
2. 再重新执行完整 Deep 流程（含候选问题发现、验证、impact analysis、汇总裁决）
