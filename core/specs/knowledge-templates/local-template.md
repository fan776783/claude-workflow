---
name: knowledge-local
description: "项目级 knowledge 定制与升级基线。记录本项目对 canonical 模板的裁剪、扩展的机读规则语法，以及每次 /knowledge-update 的 Changelog。升级 canonical 模板时用此文件做合并基线。"
---

# Knowledge Local

## Template Baseline

> `/knowledge-review --check-upgrade` 通过对比这里和 canonical 模板判断是否需要手动合并。

| Template | Baseline Version / Date | Customized? |
|----------|-------------------------|-------------|
| code-spec-template.md | {{canonical_date}} | no |
| guide-template.md | {{canonical_date}} | no |
| guideline-template.md | {{canonical_date}} | no |
| layer-index-template.md | {{canonical_date}} | no |
| index-template.md | {{canonical_date}} | no |

## Layer Customizations

### Active Layers

- [ ] frontend — 生成原因：{{reason_or_none}}
- [ ] backend — 生成原因：{{reason_or_none}}
- [x] guides — 始终生成

### Merges / Exclusions

记录本项目对默认分层的裁剪，例如"合并 backend 到 frontend，因为没有独立后端"。

- {{none_yet}}

## Extended Rule Syntax

项目扩展的机读规则字段或 kind，需在 `knowledge_compliance.js` 里存在对应支持才生效。

- {{none_yet}}

## Changelog

> 每次 `/knowledge-update` 追加一条。

| Date | Command | Layer | Title | Source |
|------|---------|-------|-------|--------|
| {{date}} | bootstrap | — | initial skeleton | /scan |
