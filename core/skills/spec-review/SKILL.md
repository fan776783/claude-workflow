---
name: spec-review
description: "审查 code-specs 库（v2.2）。按文件类型分档 lint：convention 查必备 4 段 + 代码示例 + Why；contract 查 7 段；通用维度查过期/冲突。模板漂移走 .template-hashes.json。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**。冲突检测和 glossary drift 识别都需要先把 canonical glossary 加载到会话。
</PRE-FLIGHT>

# /spec-review

只读的 code-specs 库审查命令。走声明式审查模型：按文件类型分档 lint + 过期 + 冲突 + 模板漂移对账，输出报告供用户决定后续动作。

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

## 流程

1. 扫描 `.claude/code-specs/**/*.md`，按文件类型分档
2. 依次跑 6 类检查（contract/convention lint、空 layer advisory、过期、冲突、模板漂移）
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

## Conflicts & Broken Pointers
- [broken-pointer] guides/api.md → {pkg}/backend/deleted-spec.md
- [index-mismatch] {pkg}/frontend/index.md lists missing.md

## Template Drift
- convention-template.md: baseline sha256:abc → current sha256:def（已升级）
- manifests/v5.2.0.json: 0 rename, 0 safe-file-delete, 0 delete
```

4. 输出报告路径 `.claude/reports/spec-review-{{date}}.md`
5. 不修改任何 code-specs 文件

## 用法

```
/spec-review                     # 全量审查
/spec-review --check-upgrade     # 仅做模板漂移 / manifest 对账
```

## 与其他命令的关系

- 审查结果中的 missing / draft / no-examples / no-rationale 由用户 `/spec-update` 手动补齐
- 模板漂移由用户手动合并（不自动应用 migrations）
- `workflow-review` Stage 1 走人工对照

## v2.2 对齐说明

- **不**依赖 `local.md` 的 Template Baseline 表（已废弃），模板漂移治理走 `.template-hashes.json`
- **不**把覆盖率（filled/total）作为核心指标（贯彻渐进填充理念）
- 空 layer 改 advisory（不阻塞渐进填充）
- 新增 no-examples / no-rationale 两个维度，锁定"2-3 real examples + Why"硬标准
