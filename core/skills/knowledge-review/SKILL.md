---
name: knowledge-review
description: "审查 knowledge 库的过期、冲突、覆盖率，并检查 canonical 模板升级。触发条件：用户调用 /knowledge-review，或定期维护 knowledge 库时。输出可读的 review 报告，不直接修改文件。"
---

# /knowledge-review

只读的 knowledge 库审查命令。对 knowledge 做三类检查，输出清单让用户决定后续动作。

## 检查维度

### 1. 过期检测

对 `frontend/` 和 `backend/` 下的每个 code-spec 文件：

```bash
git log -1 --format=%ct -- <file>
```

- 超过 30 天未更新 → `⚠️ stale`
- 超过 90 天未更新 → `🛑 very stale`
- 模板占位 `{{...}}` 或 `(To be filled)` 未清理 → `📝 draft`

### 2. 冲突检测

扫描所有 `## Machine-checkable Rules` 块：

- 两条规则 `id` 相同 → `conflict:duplicate-id`
- 两条 `kind: forbid` 的规则 pattern 互相包含 → `conflict:overlap`
- `kind: require` 与 `kind: forbid` 针对同一 `applies_to` 的 pattern 互斥 → `conflict:contradict`

### 3. Canonical 模板升级

读取 `.claude/knowledge/local.md` 中的 Template Baseline，与 `core/specs/knowledge-templates/` 当前版本做对比：

- 对比方式：模板文件 hash / mtime
- 有差异 → 输出需要用户审视的变更摘要
- 不自动合并，只提示

### 4. 覆盖率统计

- 各层 `index.md` 中标记 Filled / Draft 的文件数
- Guides 指向的 code-spec 是否都存在
- 本次工作流涉及的文件类型（`.ts`, `.py` 等）是否有对应 code-spec

## 流程

1. 扫描 `.claude/knowledge/**/*.md`（排除 `guides/` 的机读部分）
2. 依次跑 4 类检查
3. 生成 Markdown 报告：

```
# Knowledge Review — {{date}}

## Summary
- Rules loaded: N
- Stale files: M
- Conflicts: K
- Template upgrades pending: U

## Stale Files
| File | Last Updated | Age (days) | Status |
| ...  | ...          | ...        | stale  |

## Conflicts
- [conflict:overlap] frontend/components.md:forbid-any overlaps backend/api.md:no-any

## Template Upgrades
- code-spec-template.md: baseline 2026-01-01 → canonical 2026-04-10，需 review

## Coverage
- frontend: 3 filled / 1 draft
- backend: 0 filled / 2 draft
- guides: 1 pointer broken (points to deleted file)
```

4. 输出报告路径 `.claude/reports/knowledge-review-{{date}}.md`
5. 不修改任何 knowledge 文件

## 用法

```
/knowledge-review             # 全量审查，生成报告
```

## 与其他命令的关系

- 审查结果中的 stale / draft 由用户 `/knowledge-update` 手动更新
- 模板升级由用户手动对比 canonical 模板后 `/knowledge-update` 修改或直接编辑 `local.md`
- 不与 `quality_review.js` 硬卡口相关（硬卡口走 `/knowledge-check`）
