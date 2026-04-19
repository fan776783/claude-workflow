# diff-review 报告结构规范

> 定义 `diff-review` 的增强型报告结构。目标是在保持 Summary / Findings / Verdict 阅读习惯的同时，引入 verification 与 impact-aware 字段，并让终端流式输出的"最后一屏"直接落在结论上。

## 何时读取

- `core/skills/diff-review/SKILL.md` 进入报告汇总阶段时
- `references/deep-mode.md` 合并 Codex / Claude 候选问题并输出最终报告时
- Review Loop 为 P0/P1 生成修复建议时

## 设计目标

1. 终端流式输出下，用户视线第一落点在底部；结论、blocking 清单、fix/skip 提示压轴
2. 每个 material finding 都要有可验证证据，而不仅是主观判断
3. 每个 blocking finding 都要携带 impact-aware remediation scope
4. 保留来源归属（Codex / Claude / Both）
5. 元数据单行化，禁用 ASCII box-drawing 表格

## 顶层块顺序

两种模板共享相同的字段定义，只调整块顺序。默认使用 `terminal`。

| 块                          | terminal（默认） | artifact |
| --------------------------- | ---------------- | -------- |
| TL;DR（Verdict + blocking） | —                | 顶部     |
| Summary                     | 1                | 2        |
| Findings Matrix             | 2                | 3        |
| Critical Issues (P0-P1)     | 3                | 4        |
| Other Issues (P2-P3)        | 4                | 5        |
| Statistics                  | 5                | 6        |
| Verdict                     | 底部（压轴）     | 7        |

## Summary 字段

Summary 使用 pipe table（禁止 box-drawing），至少包含：

| Field                 | 说明                                                    |
| --------------------- | ------------------------------------------------------- |
| Review Mode           | `Deep`                                                  |
| 审查范围              | 自然语言描述，如"已暂存的 3 个文件变更（登录模块重构）" |
| Verdict               | `CORRECT` / `INCORRECT`                                 |
| Confidence            | 0.00 ~ 1.00                                             |
| Impact Status         | `not_needed` / `partial` / `complete`                   |
| Verification Coverage | `none` / `partial` / `complete`                         |
| Files                 | 变更文件数与 +/- 行数                                   |
| Codex Status          | `success` / `failed` / `degraded`                       |

Summary 不展开 Explanation；结论留给底部 Verdict。

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

元数据走单行 chip，字段紧凑列出：

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

多文件情况，File 字段不进 chip 行，改为块前列表：

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

### 字段必填矩阵

| Field                                            | P0/P1 | P2（跨模块/共享状态） | P2 局部 | P3     |
| ------------------------------------------------ | ----- | --------------------- | ------- | ------ |
| ID / Severity / Title / File / Source / Verification | 必填  | 必填                  | 必填    | 必填   |
| 一句话 If Unfixed                                | 必填  | 必填                  | 必填    | 可选   |
| Evidence                                         | 必填  | 必填                  | 必填    | 必填   |
| Impact                                           | 完整  | 完整                  | 轻量    | 轻量   |
| Fix Scope                                        | 必填  | 必填                  | 可选    | 可选   |
| Regression Verification                          | 必填  | 必填                  | 可选    | 可选   |

其中 Verification 不再单独起块，而是落在 chip 行末尾的 `**verified**` / `**partially_verified**` / `**rejected**` 状态词上；不要再另起 `**Verification**` 段。

轻量 Impact：

```markdown
**Impact**
- Scope: local only
- Reason: <局部原因>
- Validation scope: <最小验证面>
```

## Verification 状态与 Severity 约束

chip 行末尾的 Verification 状态反映当前模型是否已对 finding 执行校验：

| 状态                 | 含义                       | 可进入的最终 severity                |
| -------------------- | -------------------------- | ------------------------------------ |
| `verified`           | 代码库证据已明确确认       | 任意                                 |
| `partially_verified` | 大体成立，但仍有不确定性   | 仅 P2/P3，不能单独阻断 Verdict       |
| `rejected`           | 候选问题不成立             | 不进入最终 findings                  |

被拒绝的候选问题不应出现在最终 findings；如需解释，可在 Summary 附注中说明"已过滤误报 / 不适用建议"。最终 **P0/P1 必须为 `verified`**。

## Statistics（问题摘要）

紧跟 Other Issues，先给一行合计，再用"原因 → 修复方案"的短描述浏览全部 findings。Verdict 只列 blocking；Statistics 覆盖所有进入报告的 finding，形成互补，同时承担 callers 所要求的"保留统计信息"。

```markdown
## Statistics

合计：P0 <n> · P1 <n> · P2 <n> · P3 <n> · Rejected <n>

- F-01 🔴 P1 · <原因一句话> → <修复方案一句话>
- F-02 🟡 P2 · <原因一句话> → <修复方案一句话>
- F-03 🟢 P3 · <原因一句话> → <修复方案一句话>
```

写作要点：

- 合计行必填；Rejected 计数来自 Verification = `rejected` 的候选问题，其它按最终 severity 归类
- 按 Findings Matrix 的顺序排列摘要行（P0/P1 在前）
- 原因与修复方案各控制在一句话内，避免复述 Evidence / Fix Scope 全文
- 没有 findings 时写 `合计：无问题` 并省略摘要行

## Verdict（底部压轴块）

Terminal 模板下，Verdict 是输出完成后用户第一眼看到的内容，必须同时承担 TL;DR 与交互提示：

```markdown
---

## Verdict

**🔴 INCORRECT** · Confidence 0.92 · 阻塞发布

<1-2 句总体判断：为什么 INCORRECT / CORRECT，核心风险或确认点>

**Blocking 清单**
- F-01 · <短标题>
- F-02 · <短标题>

> 发现 X 个 P0/P1 问题，修复方案如上。输入 `fix` 执行，输入 `skip` 跳过。
```

Verdict = `CORRECT` 时省略 Blocking 清单与 fix/skip 提示，只保留一段简短确认。

artifact 模板沿用相同的 Verdict 文本与 Blocking 清单，但必须省略 `> 输入 fix 执行...` 这类交互提示句——artifact 面向静态查看（文件 / PR 评论），没有 fix/skip 交互通道。

判定规则：

- 无 P0/P1 → `CORRECT`
- 任一 P0，或达到阻塞阈值的 P1 组合 → `INCORRECT`
- Codex 调用失败且无 P0 → `CORRECT (degraded)`，在 Verdict 段里说明 degrade 原因

schema 不重新定义阈值，但要求所有阻塞性结论都必须有 verification + impact evidence 支撑。

## Review Loop 集成

若 Verdict = `INCORRECT`，每个 P0/P1 finding 必须直接给出 `Fix Scope` 与 `Regression Verification`，并在底部 Verdict 块保留 fix/skip 提示句。

## 渲染禁区

- 禁用 box-drawing 字符（`┌ ─ ┬ │ └ ┘` 等），统一使用 pipe table
- 元数据不再用 4 行单列表格包裹，一律走 chip 单行
- 不在 finding 标题下重复写出 Summary 已含的字段

## 兼容性

- 保持 `Summary / Findings / Verdict / fix-skip` 主体结构与 `CORRECT / INCORRECT` verdict 语义
- 在此基础上做增量增强，而不是完全替换旧报告风格
- 历史按旧 schema 生成的报告仍视为有效归档，不回溯改写；新报告一律按本 schema（默认 terminal 模板）生成
