# {{layer_name}} Code Specs

> {{layer_description}}

## Overview

说明本 layer 的范围与核心理念，例如：

- 覆盖哪些目录 / module
- 本层的职责边界
- 与其它 layer 的协作关系

## Guidelines Index

<!--
表头严格三列（Guide / Description / Status），不要自定义列。
Status 合法值：Not Started / Draft / Done
-->

| Guide | Description | Status |
|-------|-------------|--------|

## Pre-Development Checklist

开工前必读清单，每条指向具体 guideline 文件：

- [ ] (To be filled) — 指向具体 `.md` 文件
- [ ] (To be filled) — 指向具体 `.md` 文件

跨层需要读的：

- [ ] 共享 guides: `../../guides/index.md`

## Task Profiles

<!--
可选段，用于按任务类型收窄 Pre-Development Checklist 的预读范围。
读本 index 时若能识别当前任务对应的 slug / alias，只展开命中 Profile 的"必读 + 可选"主题；
未命中时退回全读并列出可选 slug。

每条 Profile 三字段：
- slug: 稳定标识（英文 kebab-case），不要改
- aliases: 其他常用叫法（中英皆可，逗号分隔）
- 必读 / 可选: Guideline 文件名（可省略 .md 后缀），对应本层 Guidelines Index 中的条目
-->

### Profile: 新增功能

- slug: add-feature
- aliases: feature, new-feature, 新功能
- 必读: (To be filled)
- 可选: (To be filled)

### Profile: Bug 修复

- slug: bug-fix
- aliases: bugfix, fix, hotfix, Bug 修复
- 必读: (To be filled)
- 可选: (To be filled)

### Profile: 性能优化

- slug: performance
- aliases: perf, optimize, 性能优化
- 必读: (To be filled)
- 可选: (To be filled)

## Quality Check

完成后自检清单，每条指向具体检查项与可执行命令：

- [ ] 运行 `git diff --name-only` 确认改动范围
- [ ] 对照相关 guideline 文件逐条核对（指向 Guidelines Index）
- [ ] 运行 lint / type-check / test：`(填入具体命令)`
- [ ] 补齐测试：新 pure function → unit test；bug fix → regression test；init/update → integration test
