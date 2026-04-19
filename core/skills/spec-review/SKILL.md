---
name: spec-review
description: "审查 code-specs 库的 7 段合约完整性、过期、冲突与 canonical 版本对账。触发条件：用户调用 /spec-review，或定期维护 code-specs 库时。输出可读的 review 报告，不直接修改文件。"
---

# /spec-review

只读的 code-specs 库审查命令。对齐 Trellis 的声明式审查模型：按 7 段合约 lint + 过期 / 冲突 / canonical 对账，输出报告供用户决定后续动作。

## 检查维度

### 1. 7 段合约完整性 Lint（主要卡口）

遍历所有 `{pkg}/{layer}/*.md`（排除 `index.md` 与 `guides/`）：

- 必须含 7 段：`## 1. Scope / Trigger` / `## 2. Signatures` / `## 3. Contracts` / `## 4. Validation & Error Matrix` / `## 5. Good / Base / Bad Cases` / `## 6. Tests Required` / `## 7. Wrong vs Correct`
- 任一段缺失 → `❌ missing-section`
- 段内仍有占位符 `{{...}}` 或 `(To be filled)` → `📝 draft`
- Signatures / Contracts / Tests Required 三段仍是抽象描述（无具体路径 / 字段名 / 测试名）→ `⚠️ abstract-content`

**不阻塞**（对齐 Trellis 声明式模型），仅输出清单。

### 2. 过期检测

```bash
git log -1 --format=%ct -- <file>
```

- 超过 30 天未更新 → `⚠️ stale`
- 超过 90 天未更新 → `🛑 very stale`

### 3. 冲突与指针断裂

- `guides/*.md` 中指向的 code-spec 文件是否存在 → 不存在 → `broken-pointer`
- 两条 code-spec 的 Contracts 字段对同一 API 有冲突声明 → `conflict:contract-mismatch`
- layer-index 的 Guidelines Index 列出的文件是否实际存在 → `index-mismatch`

### 4. Canonical 模板 / Manifest 对账

读取 `.claude/code-specs/local.md` 的 Template Baseline，与 `core/specs/spec-templates/` 当前版本做对比，同时读取 `core/specs/spec-templates/manifests/` 下最新 manifest 判断是否存在迁移项：

- 模板文件 hash / mtime 有差异 → 输出需要用户审视的变更摘要
- manifest 中的 `migrations[]` 按 type 分类列出：
  - `rename` / `rename-dir` — 自动应用建议
  - `safe-file-delete` — hash 匹配则自动删除建议，否则提示
  - `delete` — 需要人工确认
  - `protected_paths` 内路径 — 不动
- 不自动合并，只提示

## 流程

1. 扫描 `.claude/code-specs/**/*.md`
2. 依次跑 4 类检查
3. 生成 Markdown 报告：

```
# Spec Review — {{date}}

## Summary
- Code-specs scanned: N
- Missing sections: M
- Draft / abstract: K
- Stale files: S
- Broken pointers: P
- Canonical updates pending: U

## 7-Section Lint
| File | Missing | Draft | Abstract |
| ...  | ...     | ...   | ...      |

## Stale Files
| File | Last Updated | Age (days) | Status |

## Conflicts & Broken Pointers
- [broken-pointer] guides/api.md → {pkg}/backend/deleted-spec.md
- [index-mismatch] {pkg}/frontend/index.md lists missing.md

## Canonical & Manifest
- code-spec-template.md: baseline 2026-01-01 → canonical 2026-04-10，需 review
- manifests/v3.2.0.json: 1 rename, 2 safe-file-delete, 0 delete
```

4. 输出报告路径 `.claude/reports/spec-review-{{date}}.md`
5. 不修改任何 code-specs 文件

## 用法

```
/spec-review                     # 全量审查
/spec-review --check-upgrade     # 仅做 canonical / manifest 对账
```

## 与其他命令的关系

- 审查结果中的 missing / draft / stale 由用户 `/spec-update` 手动补齐
- canonical 升级差异由用户手动合并或编辑 `local.md` 记录"已审视"
- 不再有机读规则 / 硬卡口；`workflow-review` Stage 1 走人工对照
