# Quick Review Mode (--quick)

适用于日常快速检查，Claude 单模型审查，但必须遵循 impact-aware review pipeline，而不是直接从 diff 跳到最终 findings。

## 执行原则

- Quick 模式是**单模型审查**，不是默认模式，也不是低标准审查
- 只对最终会进入报告的 material findings 做完整验证与影响分析
- 对局部且低风险的问题，可使用轻量 impact scan
- 报告结构必须遵循 `../specs/report-schema.md`
- 输出报告后默认停止；只有用户明确确认要修复并输入 `fix`，才进入 Review Loop

## 流程

### Phase 1: Review Subject Resolution + 获取 Diff

1. 根据参数确定 review subject：
   - 默认：`HEAD`
   - `--staged`
   - `<base>...HEAD`
2. 获取 diff 与状态：

```bash
git diff HEAD
git status --short
```

若使用 `--staged` 或 `--branch <base>`，则替换为对应 diff 命令。

### Phase 2: Candidate Finding Discovery

基于 diff 发现候选问题，重点关注：
- 逻辑正确性
- 安全性
- 性能
- 可维护性
- 接口 / 状态 / 契约变更
- 用户可见行为退化

**忽略**：琐碎风格、纯格式、拼写、文档补充。

此阶段只产出候选问题，不直接下最终结论。

### Phase 3: Finding Verification

对所有准备进入最终报告的 P0 / P1 / P2 候选问题执行验证：

1. 问题是否真实存在？
2. 是否由本次 diff 引入？
3. 是否适用于当前代码库与架构？
4. 是否属于 YAGNI（除安全 / 正确性类外）？
5. 建议是否会引入明显副作用？

如果候选问题无法通过验证：
- 移除；或
- 降级为 `partially_verified`，并谨慎调整 severity

`partially_verified` 只能作为 P2/P3 或不确定性说明进入最终报告，不能单独阻断 verdict，也不能作为 P0/P1 输出。

### Phase 4: Impact Analysis

对 material findings 执行 impact analysis，遵循 `../specs/impact-analysis.md`。

#### 必做完整分析

- 所有 P0 / P1
- 所有声称存在跨模块、共享状态、契约边界、回归风险的 P2

#### 可做轻量分析

- 局部 P2
- P3

Quick 模式需要重点回答：
- 直接受影响的是哪些文件 / 函数 / 组件？
- 是否有调用链传播、共享状态、契约边界变化？
- 现有测试是否覆盖？
- 修复后最小验证面是什么？

### Phase 5: Severity Calibration + Confidence

在 verification 与 impact analysis 之后，重新确定：
- 最终 severity（P0-P3）
- 当前报告的 confidence
- `Impact Status`（`not_needed` / `partial` / `complete`）
- `Verification Coverage`（`none` / `partial` / `complete`）

禁止在未完成验证与影响分析时，仅凭直觉给出最终 P0/P1。

### Phase 6: 输出报告

按 `../specs/report-schema.md` 输出 Quick 报告。

## 推荐输出格式

```markdown
# Review Report

## Summary
| Field | Value |
|-------|-------|
| Review Mode | Quick |
| Review Subject | HEAD / --staged / <base>...HEAD |
| Verdict | CORRECT / INCORRECT |
| Confidence | 0.XX |
| Impact Status | not_needed / partial / complete |
| Verification Coverage | none / partial / complete |

**Explanation**: <1-3 句>

---

## Findings

### [PX] <标题>
| Field | Value |
|-------|-------|
| ID | F-01 |
| File | `<路径>` |
| Lines | <start>-<end> |

**Evidence**
- <问题为什么成立>

**Verification**
- Status: verified
- Notes: <验证证据>

**Impact**
- <完整或轻量 impact analysis>

**If Unfixed**
- <后果>

**Fix Scope**
- <P0/P1 必填>

**Regression Verification**
- <P0/P1 必填>

---

## Verdict
- <为什么是 CORRECT / INCORRECT>
```

## Verdict 规则

| 场景 | Verdict |
|------|---------|
| 无 P0/P1 | CORRECT |
| 任一 P0 | INCORRECT |
| 达到阻塞阈值的 P1 组合 | INCORRECT |

## Review Loop 要求

若 Verdict = `INCORRECT`：
- 每个 P0/P1 finding 必须包含 `Fix Scope` 与 `Regression Verification`
- 报告末尾必须提示用户：

```markdown
> 发现 X 个 P0/P1 问题，修复方案如上。是否按以上方案执行修复？输入 `fix` 执行，输入 `skip` 跳过。
```

在用户实际确认并输入 `fix` 前，Quick 模式默认停在报告阶段，不自动转入修复。

重新审查时：
1. 先检查上轮 finding 的 `Validation scope` / `Regression Verification`
2. 再重新执行完整 Quick 审查流程
