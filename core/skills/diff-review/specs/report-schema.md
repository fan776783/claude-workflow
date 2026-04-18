# diff-review 报告结构规范

> 定义 `diff-review` 的增强型报告结构。目标是在保持现有 Summary / Findings / Verdict 阅读习惯的同时，引入 verification 与 impact-aware 字段，并让终端流式输出的"最后一屏"直接落在结论上。

## 何时读取

- `core/skills/diff-review/SKILL.md` 进入报告汇总阶段时
- `references/deep-mode.md` 合并 Codex / Claude 候选问题并输出最终报告时
- Review Loop 为 P0/P1 生成修复建议时

## 设计目标

1. 终端流式输出场景下，用户视线第一落点在底部；结论、blocking 清单、fix/skip 提示必须压轴
2. 让每个 material finding 都有可验证证据，而不仅是主观判断
3. 让 blocking finding 天然携带 impact-aware remediation scope
4. 保留来源归属（Codex / Claude / Both）与统计信息
5. 元数据单行化，禁用 ASCII box-drawing 表格

## 输出模板：Terminal vs Artifact

根据报告将出现的场景选择模板：

| 模板 | 适用场景 | 结论位置 |
|---|---|---|
| `terminal`（默认） | 交互式终端、Claude Code 会话 | **底部**（last-write-wins） |
| `artifact` | 写入文件、PR 评论、静态查看 | **顶部**（TL;DR） |

两种模板共享相同的字段定义，只调整块顺序。

## Terminal 模板顶层结构（默认）

```markdown
# Deep Review Report

## Summary
...

## Findings Matrix
...

## 🔴 Critical Issues (P0-P1)
...

## 🟡 Other Issues (P2-P3)
...

## Statistics
...

---

## Verdict
<TL;DR + blocking 清单 + fix/skip 提示>
```

## Artifact 模板顶层结构

```markdown
# Deep Review Report

## TL;DR
<Verdict + blocking 清单>

## Summary
...

## Findings Matrix
...

## 🔴 Critical Issues (P0-P1)
...

## 🟡 Other Issues (P2-P3)
...

## Statistics
...

## Verdict
<详细裁决 + fix/skip 提示>
```

## Summary 字段

Summary 至少包含以下字段，使用 pipe table（禁止 box-drawing）：

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

Summary 不展开 Explanation；结论留给底部 Verdict 块。

## Findings Matrix

紧跟 Summary，一行一个 finding，用于快速导航：

```markdown
## Findings Matrix
| ID | Sev | Title | File | Source |
|---|---|---|---|---|
| F-01 | 🔴 P1 | <短标题> | `path/to/file.ts` | Codex |
| F-02 | 🟡 P2 | <短标题> | `path/to/other.ts` | Both |
```

严重度图标：`🔴 P0` / `🔴 P1` / `🟡 P2` / `🟢 P3`。

## Findings 分组

- `## 🔴 Critical Issues (P0-P1)`
- `## 🟡 Other Issues (P2-P3)`

P0/P1 在前；每组内按 ID 升序。

## 单个 Finding 的渲染格式

元数据走单行 chip，不再使用表格。字段紧凑列出：

```markdown
### F-01 · <Title>

`P1` · `path/to/file.ts:10-24` · Source: Codex · **verified**

<一句话说明"若不修复会怎样" — 等同于 If Unfixed 的浓缩版>

**Evidence**
- <为什么它是问题>

**Impact**
- Blast radius: local / module / cross-module / systemic
- Regression risk: low / medium / high
- Affected modules / contracts: ...
- Gap: <现有测试未覆盖的路径，可选>

**Fix Scope**
- <改什么>
- <不要误伤什么>

**Regression Verification**
- <修复后必须验证的测试 / 场景 / 调用链>
```

### 多文件情况

File 字段不塞入 chip 行，改为块前列表：

```markdown
### F-04 · <Title>

`P2` · Source: Codex · **verified**

涉及文件：
- `path/a.ts:100-117`
- `path/b.ts:134-250`

<一句话说明若不修复会怎样>

**Evidence**
...
```

### 必填字段矩阵

| Field | P0/P1 | P2（跨模块/共享状态） | P2 局部 | P3 |
|---|---|---|---|---|
| ID / Severity / Title / File / Source / Verification | 必填 | 必填 | 必填 | 必填 |
| 一句话 If Unfixed | 必填 | 必填 | 必填 | 可选 |
| Evidence | 必填 | 必填 | 必填 | 必填 |
| Impact（完整） | 必填 | 必填 | 轻量版 | 轻量版 |
| Fix Scope | 必填 | 必填 | 可选 | 可选 |
| Regression Verification | 必填 | 必填 | 可选 | 可选 |

轻量版 Impact：

```markdown
**Impact**
- Scope: local only
- Reason: <局部原因>
- Validation scope: <最小验证面>
```

## Verification 字段要求

chip 行末尾的 `verified` / `partially_verified` / `rejected` 必须反映当前模型是否已对 finding 执行校验：

```text
verified            = 问题已被代码库证据明确确认，可按影响面进入最终 severity 判断
partially_verified  = 问题大体成立，但 impact / applicability 仍有部分不确定；仅可作为 P2/P3 或不确定性说明进入报告，不能单独阻断 Verdict，也不能作为最终 P0/P1
rejected            = 候选问题不成立，不得进入最终 findings
```

如果候选问题被拒绝：
- 不应出现在最终 findings；
- 如需解释，可在 Summary 附注或 Statistics 下方说明"已过滤误报 / 不适用建议"。

## 最终 severity 对 Verification 的依赖

- 最终 P0/P1 finding 的 verification 必须为 `verified`
- `partially_verified` finding 只能作为 P2/P3 或附注保留，不能单独支撑 `INCORRECT` verdict

## Statistics

紧跟 Other Issues，使用紧凑横表：

```markdown
## Statistics
| Codex | Claude | Verified | Consensus | Rejected |
|---|---|---|---|---|
| X | X | X | X | X |
```

区分"候选问题数量"与"最终通过验证进入报告的问题数量"。

## Verdict（底部压轴块）

Terminal 模板下，Verdict 是输出完成后用户第一眼看到的内容，必须同时承担 TL;DR 与交互提示两个职责：

```markdown
---

## Verdict

**🔴 INCORRECT** · Confidence 0.92 · 阻塞发布

<1-2 句总体判断：为什么 INCORRECT / CORRECT，核心风险或确认点>

**Blocking 清单**
- F-01 · <短标题>
- F-02 · <短标题>
- F-03 · <短标题>

> 发现 X 个 P0/P1 问题，修复方案如上。输入 `fix` 执行，输入 `skip` 跳过。
```

如果 Verdict = `CORRECT`，省略 Blocking 清单和 fix/skip 提示，只保留一段简短确认。

## Verdict 判定规则

- 无 P0/P1 → `CORRECT`
- 任一 P0 → `INCORRECT`
- 达到阻塞阈值的 P1 组合 → `INCORRECT`
- Codex 调用失败且无 P0 → `CORRECT (degraded)`，在 Verdict 段里说明 degrade 原因

报告 schema 不负责重新定义判定阈值，但要求所有阻塞性结论都必须有 verification + impact evidence 支撑。

## Review Loop 集成要求

若 Verdict = `INCORRECT`，报告中每个 P0/P1 finding 必须直接给出：
- `Fix Scope`
- `Regression Verification`

并在底部 Verdict 块保留 fix/skip 提示句。

## 渲染禁区

- 禁用 box-drawing 字符（`┌ ─ ┬ │ └ ┘` 等），统一使用 pipe table。box-drawing 依赖终端等宽字体和列宽估算，不同终端或换行宽度下经常错位；pipe table 在终端和 markdown 渲染器中都更稳定。
- 元数据不再用 4 行单列表格包裹，一律走 chip 单行
- 不在 finding 标题下重复写出 Summary 已含的字段

## 兼容性要求

- 保持 `Summary / Findings / Verdict / fix-skip` 主体结构
- 保持 `CORRECT / INCORRECT` verdict 语义
- 在此基础上做增量增强，而不是完全替换旧报告风格
- 历史按旧 schema 生成的报告仍视为有效归档，不回溯改写；新产生的报告一律按本 schema（默认 terminal 模板）生成
