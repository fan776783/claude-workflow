---
name: code-specs-local
description: "项目级 code-specs 定制记录与 /spec-update Changelog。模板漂移治理已迁移至 .template-hashes.json + manifests/。"
---

# Code Specs Local

<!--
v2.2 重构说明：

- **模板漂移治理** 改由 `.template-hashes.json`（记录本次 bootstrap 使用的模板 sha256）+ `core/specs/spec-templates/manifests/` 承载，本文件不再维护 Template Baseline 表。
- **Topic Coverage Snapshot** 已移除；贯彻渐进填充理念，覆盖率不是核心指标。
- 本文件只保留两类信息：
  1. 项目对默认规范的显式裁剪（如某个 package 不走 frontend）
  2. /spec-update 的 Changelog（时间线）
-->

## Customizations

<!-- 显式的项目裁剪记录，例如"reelmate 包不需要 backend layer"。无则保留 (none yet)。 -->

- (none yet)

## Changelog

<!--
每次 /spec-update 追加一条。
Type 列使用 6 类语义标签（Design Decision / Convention / Pattern / Forbidden / Common Mistake / Gotcha），仅作阅读辅助，不约束段落位置。
bootstrap 行的 Type 留 —。
-->

| Date | Command | Package / Layer | Type | Title |
|------|---------|-----------------|------|-------|
| {{date}} | bootstrap | — | — | initial skeleton |
