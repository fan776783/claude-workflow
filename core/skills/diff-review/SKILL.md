---
name: diff-review
description: "代码审查 - 基于 git diff 的 impact-aware 结构化审查，支持 Quick 模式（Claude 单模型，默认）和 Deep 模式（Codex 协作，--deep）。触发条件：用户调用 /diff-review，或请求代码审查、PR 审查、提交前检查。支持 --staged、--branch、--deep 等参数。审查报告输出后支持 Review Loop：确认修复后自动重新审查，循环直到无问题。"
---

# 代码审查

## 用法

`/diff-review [OPTIONS]`

| 参数 | 说明 |
|------|------|
| (无) | 审查 `git diff HEAD`，Claude 单模型 |
| `--staged` | 仅审查已暂存变更 |
| `--branch <base>` | 审查相对 base 分支的变更 |
| `--deep` | 多模型深度审查（Codex 协作） |

## 模式路由（强制执行）

检查 `$ARGUMENTS` 是否包含 `--deep`：

- **不包含 `--deep`（默认 Quick 模式）**：读取 [references/quick-mode.md](references/quick-mode.md) 并严格执行其流程
- **包含 `--deep`**：**必须**读取 [references/deep-mode.md](references/deep-mode.md) 并严格执行其流程。Deep 模式**必须**通过 `collaborating-with-codex` skill 调用 Codex 进行候选问题发现，当前模型负责统一裁决与最终报告

**⚠️ 关键约束**：Deep 模式下，如果没有按 `collaborating-with-codex` skill 执行 Codex 调用，则审查流程不合规。不得以任何理由省略外部模型调用步骤。

## 共享审查管线（Quick / Deep 共用）

所有模式都遵循以下 8 阶段，只是候选问题的来源不同：

1. **Review Subject Resolution**：解析审查对象（`HEAD` / `--staged` / `<base>...HEAD`）
2. **Diff Acquisition + File Classification**：获取 diff 与变更文件；Deep 模式额外做前后端分类
3. **Candidate Finding Discovery**：发现候选问题（Quick = 当前模型；Deep = Codex + 当前模型）
4. **Finding Verification**：验证问题真实存在、由本次变更引入、且适用于当前代码库
5. **Impact Analysis**：对 material findings 评估影响范围、blast radius、回归风险与验证面
6. **Severity Calibration**：基于验证结果和影响面确定最终 P0-P3
7. **Report Synthesis**：按统一 schema 输出报告
8. **Impact-aware Review Loop**：若 Verdict = `INCORRECT`，进入 `fix / skip` 修复循环

## 共享规范（必须读取）

- [specs/impact-analysis.md](specs/impact-analysis.md)
- [specs/report-schema.md](specs/report-schema.md)

Quick / Deep 的细节流程都不得与上述两个规范冲突。

## 通用：获取 Diff

```bash
# 根据参数选择 diff 命令
git diff HEAD          # 默认
git diff --staged      # --staged
git diff <base>...HEAD # --branch <base>

git status --short
```

## Review Subject 约定

审查对象应在报告 Summary 中显式写明：

- 默认：`HEAD`
- `--staged`：`--staged`
- `--branch <base>`：`<base>...HEAD`

禁止在未说明 review subject 的情况下输出结论。

## 优先级定义

| 级别 | 含义 |
|------|------|
| P0 | 阻塞发布 |
| P1 | 应尽快处理 |
| P2 | 最终需修复 |
| P3 | 有则更好 |

## Verdict 规则

| 场景 | Verdict |
|------|---------|
| 无 P0/P1 | CORRECT |
| 任一 P0 | INCORRECT |
| 阻塞阈值的 P1 组合 | INCORRECT |
| 模型失败，无 P0 | CORRECT (degraded) |

## 审查标准

按以下标准识别问题：
1. 影响准确性、性能、安全性或可维护性
2. 问题具体且可操作
3. 是本次变更引入的（非预先存在）
4. 如认为破坏其他部分，必须找到具体受影响代码，并附带 impact evidence

**忽略**：琐碎风格、纯格式、拼写、文档补充

## Finding Verification（共享阶段）

所有准备进入最终报告的 P0/P1/P2 候选问题，都必须先经过验证。

### 验证流程

1. **代码库验证**：检索代码库，验证建议所描述的问题是否真实存在
2. **Introduced-by-change 检查**：确认问题由当前 diff 引入，而不是预先存在
3. **适用性检查**：确认建议适用于当前技术栈、架构和上下文
4. **YAGNI 检查**：建议要求添加新功能/抽象时，检查是否有实际使用场景（安全/正确性类发现可豁免）
5. **副作用评估**：评估采纳该建议是否会引入新的问题

### 处理规则

| 验证结果 | 处理 |
|----------|------|
| 问题真实存在，且适用 | 保留，进入 impact analysis |
| 问题存在，但影响有限或前提不足 | 降级或标记为 `partially_verified`；仅允许作为 P2/P3 或不确定性说明进入最终报告，不能单独阻断 Verdict |
| 问题不存在 | 移除，不进入最终 findings |
| YAGNI 不通过（非安全类） | 降级为 P3，说明当前无实际使用场景 |
| 建议自身有明显副作用风险 | 可保留，但必须补充风险说明与更小修复范围 |

### 禁止行为

- 不加验证地全盘接受外部模型的所有建议
- 对明显错误的建议表示“完全同意”
- 在未验证时，把推测性问题直接提升为 P0/P1
- 实施与当前代码库风格/架构不一致的建议

## Impact Analysis（共享阶段）

对所有 material findings 执行影响性分析，详见 [specs/impact-analysis.md](specs/impact-analysis.md)。

### 最低要求

- 所有最终进入报告的 P0/P1 finding：必须执行完整 impact analysis
- 声称存在跨模块、共享状态、契约边界或回归风险的 P2 finding：必须执行完整 impact analysis
- 局部 P2 / P3：可使用轻量 impact scan，但必须说明为什么影响局限于局部

### 输出责任

impact analysis 必须为最终 severity、fix scope、regression verification 提供依据；不能只作为补充说明。

## Severity Calibration（共享阶段）

最终优先级必须在 verification 和 impact analysis 之后确定：

- **P0**：已验证的问题会造成阻塞发布级故障，或后果极严重（安全、数据破坏、核心流程瘫痪）
- **P1**：问题真实存在，影响面明确，会在实际使用中造成重要功能错误或明显回归
- **P2**：问题真实存在，但影响受限、可控，或需要特定上下文才触发
- **P3**：建议项、局部优化项，或 impact 已证实局限在很小范围内

禁止在未完成 verification / impact analysis 前，仅凭直觉给出最终 P0/P1。

## 报告输出

报告结构必须遵循 [specs/report-schema.md](specs/report-schema.md)。

### 关键要求

- Summary 中必须写明：`Review Mode`、`Review Subject`、`Verdict`、`Confidence`、`Impact Status`、`Verification Coverage`
- 所有 material findings 必须包含 `Evidence` 与 `Verification`
- P0/P1 findings 必须是 `verified`，且包含完整 `Impact`、`Fix Scope`、`Regression Verification`
- Deep 模式保留 `Source` 归属与统计信息

## Review Loop（审查修复循环）

报告输出后，如果存在 P0/P1 问题（Verdict = `INCORRECT`），进入交互式修复循环。

### Blocking finding 的最小内容

当 Verdict = `INCORRECT` 时，每个 P0/P1 问题必须同时附带：

- **问题描述**：问题为什么成立
- **影响范围**：哪些文件 / 模块 / 契约 / 用户行为会受影响
- **修复范围（Fix Scope）**：具体修改内容（改什么、不要误伤什么）
- **回归验证（Regression Verification）**：修复后必须重查的测试 / 场景 / 调用链

### 报告尾部提示

> 发现 X 个 P0/P1 问题，修复方案如上。输入 `fix` 按方案执行修复，`skip` 跳过。

### 循环流程

```text
REVIEW → 报告(含影响面与方案) → 用户 fix → 按方案执行 → 重新 REVIEW → ...
                                  ↓                                   ↓
                               用户 skip                         无 P0/P1 问题
                                  ↓                                   ↓
                                结束                                 结束
```

### 每轮循环

1. **修复执行阶段**：用户输入 `fix` 后，按报告中的方案逐问题执行修复
   - 按 P0→P1 优先级顺序执行代码修改
   - 全部修复完成后输出修复摘要

2. **重新审查阶段**：对修复后的代码重新执行完整审查流程
   - 重新获取 diff（`git diff HEAD`）
   - 先检查上轮 blocking findings 的 `Regression Verification` / `Validation scope`
   - 再按当前模式（Quick/Deep）执行完整审查
   - 输出新的审查报告（若仍有问题，同样附带影响面与修复方案）

3. **循环判定**：
   - 新报告 Verdict = `CORRECT` → 输出最终确认，**循环结束**
   - 新报告 Verdict = `INCORRECT` → 再次提示用户确认是否继续修复
   - 连续 3 轮仍有问题 → 强制停止，输出剩余问题清单供用户手动处理

### 修复纪律

- **最小化修复**：仅修改报告中指出的问题，不做额外重构
- **逐问题修复**：不批量修改，确保每个修复可追溯
- **修复后验证**：修复前检查上下文，确保修复不引入新问题
- **复审优先级**：先复查 impact scope，再复查修改行本身
