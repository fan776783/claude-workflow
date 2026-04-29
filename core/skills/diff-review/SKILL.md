---
name: diff-review
description: "Use when asked to review a diff, do a pre-commit code review, or review staged/branch changes. Supports staged diffs, branch diffs, and --session mode that reviews only files edited in the current conversation context."
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:纯 code review 场景,pre-flight 跳过条件命中;但必须读 glossary(§ 4)保证 normative 评审报告用 canonical 术语,架构相关 finding 参考 `core/specs/shared/architecture-language.md` 的 Module / Interface / Seam / Depth 词汇。
</PRE-FLIGHT>

# 代码review

默认主路径：先完成review并输出报告，然后停止；只有用户明确确认要修复并输入 `fix`，才进入修复循环。

## 执行铁律

- 未完成review范围解析和共享规范加载前，不得输出 findings 或 verdict。
- 必须实际执行 `collaborating-with-codex` 桥接脚本调用 Codex，不能以任何理由（包括"环境不可用""Codex 未安装""未检测到 Codex"）在未尝试调用的情况下降级为当前模型自审。
- 未完成 verification 与 impact analysis 前，不得给出最终 P0/P1，也不得输出 `INCORRECT`。
- 报告输出后默认停止；只有用户明确确认要修复并输入 `fix`，才允许进入 Review Loop。

## Entry Gate

进入 skill 后先完成以下步骤：

1. 解析 `$ARGUMENTS`，确定review范围（已暂存delta / 分支差异 / 会话delta）
2. 若 `--session` → 按 [references/context-capture.md](references/context-capture.md) 完成 compaction 硬停检测 + 会话delta集盘点
3. 读取共享规范：`specs/impact-analysis.md` 与 `specs/report-schema.md`
4. 读取 [references/deep-mode.md](references/deep-mode.md) 并严格执行其workflow

在 Entry Gate 完成前，禁止直接罗列问题、给出 Verdict，或跳过规范加载。

## 用法

`/diff-review [OPTIONS]`

| 参数              | 说明 |
| ----------------- | ---- |
| (无)              | review已暂存delta（默认） |
| `--branch <base>` | review相对 base 分支的delta |
| `--session`       | 只review当前会话 Edit/Write 修改过的文件（compaction 时硬停，不降级到 git） |

## review管线

所有review遵循以下 8 阶段：

1. **review范围确认**：用自然语言在报告中描述范围
2. **Diff Acquisition + File Classification**：获取 diff 与delta文件，做前后端分类（按 `core/specs/shared/codex-routing.md § 决策表`）
3. **Candidate Finding Discovery**：Codex + 当前模型并行发现候选问题
4. **Finding Verification**：验证问题真实存在、由本次delta引入、且适用于当前代码库
5. **Impact Analysis**：对 material findings 评估影响范围、blast radius、回归风险与验证面（见 `specs/impact-analysis.md` + `core/specs/shared/impact-analysis-template.md`）
6. **Severity Calibration**：基于验证结果和影响面确定最终 P0-P3
7. **Report Synthesis**：按统一 schema 输出报告
8. **Optional Review Loop Entry**：若 Verdict = `INCORRECT`，报告中给出 `fix / skip` 入口，但默认仍在报告后停止，等待用户显式选择

## 共享规范（必须读取）

- [specs/impact-analysis.md](specs/impact-analysis.md) — 评审专用影响维度
- [specs/report-schema.md](specs/report-schema.md) — 报告结构
- `core/specs/shared/impact-analysis-template.md` — 跨 skill 通用 6 维骨架
- `core/specs/shared/architecture-language.md` — 架构 finding 必须用 Module / Interface / Seam / Depth / Adapter 词汇

## 获取 Diff

```bash
# 默认
git diff --staged

# --branch <base>
git diff <base>...HEAD

# --session（不跑 git）
# 从当前对话上下文里本模型的 Edit / Write / NotebookEdit tool call 盘出文件清单
# 详见 references/context-capture.md Step 2
```

## review范围描述

报告 Summary 中的review范围用自然语言描述：

- 默认：`已暂存的 3 个文件变更（用户认证模块重构）`
- `--branch <base>`：`feature/auth 分支相对 main 的 12 个提交变更`
- `--session`：`本会话上下文提取的 N 个改动文件（来源：Edit/Write tool calls）`——信息源是关键区别

禁止在未说明范围的情况下输出结论；禁止把"最近的改动"等含糊表述当作 session 模式。

## --session 模式的额外约束

1. **Compaction 硬停** — 命中 compaction 信号立即返回，不降级到 git。完整判定见 `references/context-capture.md § Step 1`。
2. **delta集来源** — 必须来自会话上下文的 Edit / Write / NotebookEdit（含 Bash 间接写入）记录，不得从 git 推断。
3. **Codex prompt 范围限定** — 必须显式加：
   ```
   Review ONLY these N files. Ignore all other modified or untracked files in the working tree.
   ```
4. **Report Mode 字段** — Summary 必须写 `Review Mode = session`。

## 优先级定义

| 级别 | 含义 |
| ---- | ---- |
| P0   | 阻塞发布 |
| P1   | 应尽快处理 |
| P2   | 最终需修复 |
| P3   | 有则更好 |

## Verdict 规则

| 场景               | Verdict |
| ------------------ | ------- |
| 无 P0/P1           | CORRECT |
| 任一 P0            | INCORRECT |
| 阻塞阈值的 P1 组合 | INCORRECT |
| 模型失败，无 P0    | CORRECT (degraded) |

## review标准

识别以下问题：

1. 影响准确性、性能、安全性或可维护性
2. 问题具体且可操作
3. 是本次delta引入的（非预先存在）
4. 如认为破坏其他部分，必须找到具体受影响代码，并附带 impact evidence

**忽略**：琐碎风格、纯格式、拼写、文档补充。

## Finding Verification（共享阶段）

所有进入最终报告的 P0/P1/P2 候选都必须经验证。

### workflow

1. **代码库验证**：检索代码库，验证建议所描述的问题是否真实存在
2. **Introduced-by-change 检查**：确认问题由当前 diff 引入
3. **适用性检查**：当前技术栈 / 架构是否适用
4. **YAGNI 检查**：新功能 / 抽象要有实际使用场景（安全 / 正确性类可豁免）
5. **副作用评估**：采纳建议是否引入新问题

### 处理规则

| 验证结果 | 处理 |
| -------- | ---- |
| 真实存在且适用 | 保留，进 impact analysis |
| 存在但影响有限 / 前提不足 | 降级或 `partially_verified`；仅作 P2/P3 或不确定性说明，不单独阻断 Verdict |
| 不存在 | 移除 |
| YAGNI 不通过（非安全类） | 降级 P3 |
| 建议自身有副作用风险 | 保留，但补充风险说明与更小修复范围 |

### 禁止行为

- 不加验证地全盘接受外部模型的建议
- 对明显错误的建议表示"完全同意"
- 未验证就把推测性问题提升为 P0/P1
- 实施与当前代码库风格 / 架构不一致的建议

## Impact Analysis（共享阶段）

对所有 material findings 执行影响分析：
- P0/P1 finding：按 `specs/impact-analysis.md` 全维度 + `core/specs/shared/impact-analysis-template.md § 6 个维度` 最低要求全覆盖
- 跨module / 共享状态 / contract边界的 P2：评审专用维度 + shared 维度 1/2/3
- 局部 P2 / P3：轻量 scan + 一句话说明局部

impact analysis 必须为 severity、fix scope、regression verification 提供依据。

## Severity Calibration

最终优先级在 verification 和 impact analysis 之后确定：

- **P0**：已验证的阻塞发布级故障，或后果极严重（安全、数据破坏、核心workflow瘫痪）
- **P1**：问题真实存在，影响面明确，实际使用中造成重要功能错误或明显回归
- **P2**：问题真实存在但影响受限 / 特定上下文才触发
- **P3**：建议 / 局部优化 / impact 证实局限

禁止在未完成 verification / impact analysis 前凭直觉给最终 P0/P1。

## 报告输出

报告结构遵循 [specs/report-schema.md](specs/report-schema.md)。

### 关键要求

- Summary 必须写：`Review Mode`（`staged` / `branch` / `session`）、`审查范围`、`Verdict`、`Confidence`、`Impact Status`、`Verification Coverage`
- 所有 material findings 必须含 `Evidence` 与 `Verification`
- P0/P1 必须 `verified`，含完整 `Impact`、`Fix Scope`、`Regression Verification`
- 保留 `Source` 归属与统计

## Review Loop

Verdict = `INCORRECT` 时只提供问句式修复入口；未收到用户 `fix` 前不得进入修复循环。

### Blocking finding 最小内容

- **问题描述**：为什么成立
- **影响范围**：哪些文件 / module / contract / 用户行为
- **修复范围（Fix Scope）**：改什么、不要误伤什么
- **回归验证（Regression Verification）**：必须重查的测试 / 场景 / 调用链

### 报告尾部提示

> 发现 X 个 P0/P1 问题，修复方案如上。是否按以上方案执行修复？输入 `fix` 执行，输入 `skip` 跳过。

### 循环workflow

```text
REVIEW → 报告(含影响面与方案) → 用户 fix → 按方案执行 → 重新 REVIEW → ...
                                  ↓                                   ↓
                               用户 skip                         无 P0/P1 问题
                                  ↓                                   ↓
                                结束                                 结束
```

### 每轮

1. **修复阶段**：用户输入 `fix` 后，按报告方案按 P0 → P1 逐问题修改，完成后输出修复摘要
2. **重新review**：对修复后代码重跑完整workflow（重新获取 diff → 检查上轮 `Regression Verification` / `Validation scope` → 完整review → 新报告）
3. **循环判定**：
   - Verdict = `CORRECT` → 结束
   - `INCORRECT` → 再次询问
   - 连续 3 轮仍有 → 强制停止，输出剩余问题清单

### 纪律

- **最小化**：只改报告指出的问题
- **逐问题**：不批量修改
- **修复后验证**：检查上下文，不引入新问题
- **复审优先级**：先 impact scope，再修改行

## Exit Criteria

- 已明确review范围并在报告用自然语言描述
- 已执行 candidate discovery（Codex + 当前模型）
- 最终 findings 经 verification，需要的 impact analysis 已完成
- Summary 含 `Review Mode`、`审查范围`、`Verdict`、`Confidence`、`Impact Status`、`Verification Coverage`
- `INCORRECT` 时每个 blocking finding 含 `Fix Scope` + `Regression Verification`

Verdict = `INCORRECT` 时默认停在"等待用户 `fix` / `skip`"，不得当自动继续阶段。
