# {{layer_name}} Code Specs

> {{layer_description}}

## Overview

说明本 layer 的范围与核心理念，例如：

- 覆盖哪些目录 / 模块
- 本层的职责边界
- 与其它 layer 的协作关系

## Guidelines Index

<!--
表头对齐 Trellis live（见 .trellis/spec/cli/backend/index.md）：严格三列，不要自定义列。
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
`/spec-before-dev --change-type <slug-or-alias>` 会按 slug / aliases 做归一化精确匹配，
命中后只展开"必读 + 可选"里列出的主题文件；未命中时退回全读并列出可选 slug。

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
