# diff-review 报告结构规范

> 定义 `diff-review` 的增强型报告结构。目标是在保持现有 Summary / Findings / Verdict 阅读习惯的同时，引入 verification 与 impact-aware 字段。

## 何时读取

- `core/skills/diff-review/SKILL.md` 进入报告汇总阶段时
- `references/deep-mode.md` 合并 Codex / Claude 候选问题并输出最终报告时
- Review Loop 为 P0/P1 生成修复建议时

## 设计目标

1. 保持用户熟悉的结构：Summary → Findings → Verdict → fix/skip
2. 让每个 material finding 都有可验证证据，而不仅是主观判断
3. 让 blocking finding 天然携带 impact-aware remediation scope
4. 保留来源归属（Codex / Claude / Both）与统计信息

## 顶层结构

```markdown
# Deep Review Report

## Summary
...

---

## Findings
...

---

## Verdict
...
```

## Summary 字段

Summary 至少包含以下字段：

| Field | Required | 说明 |
|------|----------|------|
| Review Mode | yes | `Deep` |
| 审查范围 | yes | 自然语言描述，如"已暂存的 3 个文件变更（登录模块重构）" |
| Verdict | yes | `CORRECT` / `INCORRECT` |
| Confidence | yes | 0.00 ~ 1.00 |
| Impact Status | yes | `not_needed` / `partial` / `complete` |
| Verification Coverage | yes | `none` / `partial` / `complete` |
| Files | yes | 变更文件数与 +/- 行数 |
| Codex Status | yes | `success` / `failed` / `degraded` |

Summary 下方应有 1-3 句 **Explanation**，说明为什么得出该 verdict，以及 impact/verification 是否充分。

## Findings 分组

分为两组：

- `## Critical Issues (P0-P1)`
- `## Other Issues (P2-P3)`

P0/P1 需排在前面。

## 单个 Finding 的规范字段

每个最终进入报告的 finding 至少包含：

| Field | Required | 说明 |
|------|----------|------|
| ID | yes | 稳定标识，便于 review loop 引用 |
| Severity | yes | `P0` / `P1` / `P2` / `P3` |
| Title | yes | 问题标题 |
| File / Lines | yes | 具体定位 |
| Source | yes | `Codex` / `Claude` / `Both` |
| Evidence | yes | 说明问题为何成立 |
| Verification | yes | 是否已验证、如何验证 |
| Impact | conditional | material finding 必填 |
| If Unfixed | yes | 不修复的后果 |
| Fix Scope | conditional | P0/P1 必填 |
| Regression Verification | conditional | P0/P1 必填 |

## 推荐渲染格式

```markdown
### [P1] <Title>
| Field | Value |
|-------|-------|
| ID | F-01 |
| File | `path/to/file.ts` |
| Lines | 10-24 |
| Source | Codex/Claude/Both |

**Evidence**
- <为什么它是问题>

**Verification**
- Status: verified
- Notes: <检索证据、适用性判断、必要时含 YAGNI/side-effect 说明>

**Impact**
- Direct files: ...
- Affected modules: ...
- Affected surfaces: ...
- Shared state / contracts: ...
- Blast radius: local / module / cross-module / systemic
- Regression risk: low / medium / high
- Existing tests: ...
- Validation scope: ...

**If Unfixed**
- <后果>

**Fix Scope**
- <改什么>
- <不要误伤什么>

**Regression Verification**
- <修复后必须验证的测试 / 场景 / 调用链>
```

## Verification 字段要求

`Verification` 必须反映当前模型是否已对 finding 执行校验：

```text
verified            = 问题已被代码库证据明确确认，可按影响面进入最终 severity 判断
partially_verified  = 问题大体成立，但 impact / applicability 仍有部分不确定；仅可作为 P2/P3 或不确定性说明进入报告，不能单独阻断 Verdict，也不能作为最终 P0/P1
rejected            = 候选问题不成立，不得进入最终 findings
```

如果候选问题被拒绝：
- 不应出现在最终 findings；
- 如需解释，可在 Summary 或附注里说明"已过滤误报 / 不适用建议"。

## Impact 字段要求

以下情况必须填写完整 `Impact`：
- P0 / P1 finding
- 声称存在跨模块、共享状态、契约边界或回归风险的 P2 finding

此外：
- 最终 P0/P1 finding 的 `Verification.Status` 必须为 `verified`
- `partially_verified` finding 只能作为 P2/P3 或附注保留，不能单独支撑 `INCORRECT` verdict

局部问题可写轻量版：

```markdown
**Impact**
- Scope: local only
- Reason: <局部原因>
- Validation scope: <最小验证面>
```

## Verdict 规则

- 无 P0/P1 → `CORRECT`
- 任一 P0 → `INCORRECT`
- 达到阻塞阈值的 P1 组合 → `INCORRECT`
- Codex 调用失败且无 P0 → `CORRECT (degraded)` 可在 Summary 的解释中说明

报告 schema 不负责重新定义判定阈值，但要求所有阻塞性结论都必须有 verification + impact evidence 支撑。

## Review Loop 集成要求

若 Verdict = `INCORRECT`，报告中每个 P0/P1 finding 必须直接给出：
- `Fix Scope`
- `Regression Verification`

报告尾部继续保留：

```markdown
> 发现 X 个 P0/P1 问题，修复方案如上。是否按以上方案执行修复？输入 `fix` 执行，输入 `skip` 跳过。
```

## 统计信息

报告建议追加：

```markdown
## Statistics
| Metric | Value |
|--------|-------|
| Codex Candidates | X |
| Claude Candidates | X |
| Verified Findings | X |
| Consensus Issues | X |
| Rejected Candidates | X |
```

这样可以区分"候选问题数量"和"最终通过验证进入报告的问题数量"。

## 兼容性要求

- 保持 `Summary / Findings / Verdict / fix-skip` 主体结构
- 保持 `CORRECT / INCORRECT` verdict 语义
- 在此基础上做增量增强，而不是完全替换旧报告风格
