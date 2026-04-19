# {{layer_name}} Knowledge

> {{layer_description}}

## Overview

说明本 layer 的范围与核心理念，例如：

- 覆盖哪些目录 / 模块
- 本层的职责边界
- 与其它 layer 的协作关系

## Guidelines Index

| 文件 | 用途 | 何时读 |
|------|------|--------|
| (To be filled) | | |

## Pre-Development Checklist

开工前必读清单，每条指向具体 guideline 文件：

- [ ] (To be filled) — 指向具体 `.md` 文件
- [ ] (To be filled) — 指向具体 `.md` 文件

跨层需要读的：

- [ ] 共享 guides: `../../guides/index.md`

## Quality Check

完成后自检清单，每条指向具体检查项与可执行命令：

- [ ] 运行 `git diff --name-only` 确认改动范围
- [ ] 对照相关 guideline 文件逐条核对（指向 Guidelines Index）
- [ ] 运行 lint / type-check / test：`(填入具体命令)`
- [ ] 补齐测试：新 pure function → unit test；bug fix → regression test；init/update → integration test
