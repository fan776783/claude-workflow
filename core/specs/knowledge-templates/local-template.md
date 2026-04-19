---
name: knowledge-local
description: "项目级 knowledge 定制与升级基线。记录本项目对 canonical 模板的裁剪与每次 /knowledge-update 的 Changelog。升级 canonical 模板时用此文件做合并基线。"
---

# Knowledge Local

## Template Baseline

> `/knowledge-review --check-upgrade` 通过对比这里和 canonical manifest 判断是否需要手动合并。

| Template | Baseline Version / Date | Customized? |
|----------|-------------------------|-------------|
| code-spec-template.md | {{canonical_date}} | no |
| guide-template.md | {{canonical_date}} | no |
| layer-index-template.md | {{canonical_date}} | no |
| guides-index-template.md | {{canonical_date}} | no |
| index-template.md | {{canonical_date}} | no |

## Package × Layer Customizations

### Active Packages

- [ ] {{package_name}}
  - [ ] frontend — 生成原因：{{reason_or_none}}
  - [ ] backend — 生成原因：{{reason_or_none}}

### Shared

- [x] guides — 始终生成

### Merges / Exclusions

记录本项目对默认分层的裁剪。

- {{none_yet}}

## Section Trimming

7 段 code-spec 中某些段在本项目可裁剪（例如无 DB 变更的项目可省略 Validation 表的 SQL 错误条目）。

- {{none_yet}}

## Changelog

> 每次 `/knowledge-update` 追加一条。`Type` 列对齐 Trellis 的 6 类分类（Design Decision / Convention / Pattern / Forbidden / Common Mistake / Gotcha）；bootstrap 行留 `—`。

| Date | Command | Package / Layer | Type | Title | Source |
|------|---------|-----------------|------|-------|--------|
| {{date}} | bootstrap | — | — | initial skeleton | /scan |
