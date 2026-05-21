---
name: spec-review
description: "Use when 用户调用 /spec-review, or 需要检查 .claude/code-specs/ 库内容是否过期、冲突或模板漂移。"
---

<CONTEXT>
Read `core/specs/shared/glossary.md`。冲突检测和 drift 识别需要 canonical glossary。
</CONTEXT>

# /spec-review

只读的 code-specs 库review命令。走声明式review模型：按文件类型分档 lint + 过期 + 冲突 + 模板漂移对账，输出报告供用户决定后续动作。

## 文件类型识别

扫描每个 `{pkg}/{layer}/*.md`（排除 `index.md` 与 `guides/`）时，按内容特征分档：

- 含 `## 1. Scope / Trigger` 或 `## 2. Signatures` → **contract 文件**（走 7 段 lint）
- 否则 → **convention 文件**（走必备 4 段 lint）

## 检查维度

### 1. Contract 文件 Lint（7 段）

- 必须含 7 段：Scope / Signatures / Contracts / Validation & Error Matrix / Good/Base/Bad Cases / Tests Required / Wrong vs Correct
- 任一段缺失 → `❌ missing-section`
- 段内仍有 `{{...}}` 或 `(To be filled)` → `📝 draft`
- Signatures / Contracts / Tests Required 仍是抽象描述 → `⚠️ abstract-content`

### 2. Convention 文件 Lint（必备 4 段 + v2.2 新维度）

**必备段存在性**：

- 必须含 `## Overview` / `## Rules` / `## DO / DON'T` / `## Common Mistakes` 四段（标题不区分大小写与连字符变体）
- 任一缺失 → `❌ missing-section`
- 必备段内占位符 → `📝 draft`

**v2.2 新维度 no-examples**：

- Rules 段或 Common Mistakes 段内**无任何代码块**（无 ` ``` ` fenced block） → `⚠️ no-examples`
- 核心原则：每条 guideline 至少 2-3 条真实代码示例

**v2.2 新维度 no-rationale**：

- Rules 段内**无 `**Why**:` 行**（也接受 `Why：` / `原因：` 变体） → `⚠️ no-rationale`
- 核心原则：每条规则都要说明 Why

**可选扩展段不做强制检查**：Patterns / Examples / Quick Reference / Reference Tables / Strategy / Checklist 存在与否不影响 lint。

### 3. 空 layer（v2.2 改 advisory）

- `{pkg}/{layer}/` 下除 `index.md` 外无任何主题文件 → `ℹ️ empty-layer`（**advisory**，不计入问题数）
- 贯彻渐进填充理念：有空 layer 不是问题，只是提醒

### 4. 过期检测

```bash
git log -1 --format=%ct -- <file>
```

- 超过 30 天未更新 → `⚠️ stale`
- 超过 90 天未更新 → `🛑 very stale`

### 5. 冲突与指针断裂

- `guides/*.md` 中指向的主题文件是否存在 → `broken-pointer`
- layer-index 的 Guidelines Index 列出的文件是否实际存在 → `index-mismatch`
- 跨包同名主题内容 diff（如多个包都有 `error-handling.md`）声明不一致 → `⚠️ cross-package-drift`（advisory，建议考虑上提，但不要求）

### 6. 模板漂移对账（v2.2 改走 .template-hashes.json）

读取 `.claude/code-specs/.template-hashes.json`，与当前 `core/specs/spec-templates/` 的模板 sha256 对比：

- baseline hash ≠ 当前 hash → 输出"模板已升级"清单（不自动合并）
- 同时读 `core/specs/spec-templates/manifests/` 最新 manifest，按 `migrations[]` 分类列出建议（rename / safe-file-delete / delete / protected_paths）
- **不再读** `local.md` 的 Template Baseline 表（已废弃）

### 7. Snapshot 时间戳过期（ADR-0001 Decision 3，advisory）

扫描所有 `core/skills/**/SKILL.md` 和 `core/skills/**/references/*.md` 中形如 `<!-- snapshot YYYY-MM-DD ... -->` 的注释：

- 当前日期 - snapshot 日期 > 90 天 → `⚠️ snapshot-stale`，按注释中 `refresh via:` 提示提醒用户跑对应命令复核硬编码 enum / 工具清单
- > 180 天 → `🛑 snapshot-very-stale`

注释格式 convention：`<!-- snapshot YYYY-MM-DD — <说明>. refresh via: <命令>. See ADR-0001 Decision 3. -->`

这是抓 MCP 服务端动态 enum 漂移的唯一被动防线（运行时 fresh introspection 是主动防线）。spec-review 是 review-only，只提示不修复——用户拿命令自查后再决定要不要 `/spec-update` 更新注释 + 内容。

### 8. 冗余检测（v2.3 新增，advisory）

定性判断，不设数字阈值——spec-review 是声明式 LLM review，无机读引擎，措辞一律用"明显 / 疑似重复"。四类：

- **同文件自重复**（R3）：同一段 fenced 代码块、或同一条 `**Why**:` 文本，在单文件内明显重复出现（典型：Rules 段与 Common Mistakes 段各写了一遍完整 Bad/Good + Why）→ `⚠️ intra-file-dup`
- **包内跨文件重复**（R2/R4）：`index.md` 的 Overview 与某 convention 文件 Overview 在讲同一身份定义；或同一 fenced 目录树在 `component-guidelines.md` 与 `directory-structure.md` 各画一遍 → `⚠️ intra-package-dup`
- **跨包重复**（R5）：同一规则正文在多个包逐字 / 近逐字出现，且 `guides/` 无对应承载条目 → `⚠️ cross-package-dup`（建议上提 guides/，各包改指针）
- **样板重复**（R1）：多个 layer-index 文件之间存在大段逐字相同的通用样板（如 Quality Check 清单）→ `⚠️ boilerplate-dup`（建议收敛到根 `index.md`，layer-index 改指针）

全部 advisory，不计入阻塞问题数。修复属用户决策（见"与其他命令的关系"）。

## workflow

1. 扫描 `.claude/code-specs/**/*.md`，按文件类型分档
2. 依次跑 8 类检查（contract/convention lint、空 layer advisory、过期、冲突、模板漂移、snapshot 过期、冗余检测）
3. 生成 Markdown 报告：

```
# Spec Review — {{date}}

## Summary
- Convention files scanned: N₁
- Contract files scanned: N₂
- Missing sections: M
- Draft: K₁
- no-examples: K₂      (convention only)
- no-rationale: K₃     (convention only)
- Stale files: S
- Broken pointers: P
- Advisories: empty-layer × E, cross-package-drift × D
- Snapshot stale: > 90d × Q₁, > 180d × Q₂
- Redundancy advisories: intra-file × R₁, intra-package × R₂, cross-package × R₃, boilerplate × R₄
- Template drift pending: U

## Convention Lint
| File | Missing | Draft | no-examples | no-rationale |
|------|---------|-------|-------------|--------------|

## Contract Lint
| File | Missing | Draft | Abstract |

## Stale Files
| File | Last Updated | Age (days) | Status |

## Advisories（非阻塞）
- [empty-layer] {pkg}/{layer}/ 下暂无主题文件
- [cross-package-drift] error-handling.md 在 pkg-a / pkg-b 规则声明不一致

## Redundancy（非阻塞）
- [intra-file-dup] {pkg}/{layer}/component-guidelines.md Rules 与 Common Mistakes 重复同一 Bad/Good
- [intra-package-dup] {pkg}/{layer}/index.md 与 component-guidelines.md Overview 重述同一身份
- [cross-package-dup] "export * 污染" 规则在 pkg-a / pkg-b / pkg-c 逐字重复 → 建议上提 guides/
- [boilerplate-dup] N 个 layer-index 的 Quality Check 段逐字相同 → 建议收敛到根 index.md

## Snapshot Stale (ADR-0001 Decision 3)
| File | Snapshot | Age (days) | Status | Refresh command |
|------|----------|------------|--------|-----------------|

## Conflicts & Broken Pointers
- [broken-pointer] guides/api.md → {pkg}/backend/deleted-spec.md
- [index-mismatch] {pkg}/frontend/index.md lists missing.md

## Template Drift
- convention-template.md: baseline sha256:abc → current sha256:def（已升级）
- manifests/v5.2.0.json: 0 rename, 0 safe-file-delete, 0 delete
```

4. 输出报告路径 `~/.claude/workflows/{pid}/reports/spec-review-{{date}}.md`
5. 不修改任何 code-specs 文件

## 用法

```
/spec-review                     # 全量审查
/spec-review --check-upgrade     # 仅做模板漂移 / manifest 对账
```

## 与其他命令的关系

- review结果中的 missing / draft / no-examples / no-rationale 由用户 `/spec-update` 手动补齐
- 冗余 advisory（intra-file / intra-package / cross-package / boilerplate-dup）由用户走 `/quick-plan` 或人工清理；spec-review 保持只读，不自动 dedup —— 哪份是 canonical、各包特有差异要不要留都是人类判断
- 模板漂移由用户手动合并（不自动应用 migrations）
- `workflow-review` Stage 1 走人工对照

## v2.2 对齐说明

- **不**依赖 `local.md` 的 Template Baseline 表（已废弃），模板漂移治理走 `.template-hashes.json`
- **不**把覆盖率（filled/total）作为核心指标（贯彻渐进填充理念）
- 空 layer 改 advisory（不阻塞渐进填充）
- 新增 no-examples / no-rationale 两个维度，锁定"2-3 real examples + Why"硬标准

## v2.3 对齐说明

- 新增第 7 类检查"冗余检测"（intra-file / intra-package / cross-package / boilerplate-dup），全 advisory、定性判断、不设数字阈值
- 检测维度落地，修复仍走人工 / `/quick-plan`；spec-update 侧加轻量预防（fuzzy 扩兄弟文件 + 跨包上提提示 + R3/R4 比对）
