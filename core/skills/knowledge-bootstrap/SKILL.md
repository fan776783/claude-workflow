---
name: knowledge-bootstrap
description: "初始化项目级 knowledge 目录骨架。触发条件：用户调用 /knowledge-bootstrap，或 /scan 在检测到未初始化时引导调用。根据 project-config.json 的 monorepo.packages 与 tech.frameworks 生成 {pkg}/{layer}/index.md 与 guides/index.md，并创建 local.md 记录模板基线。"
---

# /knowledge-bootstrap

在项目中建立 `.claude/knowledge/` 骨架，结构对齐 Trellis：`{package}/{layer}/` 二维布局 + 共享 `guides/`。

## 职责

- 生成根 `index.md`
- 按 `monorepo.packages` 生成 `{pkg}/{layer}/index.md`（含 4 段：Overview / Guidelines Index / Pre-Development Checklist / Quality Check）
- 生成 `guides/index.md`（6 段：Overview / Thinking Triggers / Pre-Modification Rule / Guides Catalog / How to Use This Directory / Contributing）
- 创建 `local.md`（canonical 模板基线 + 项目裁剪 + Changelog）
- 更新 `project-config.json` 的 `knowledge.bootstrapStatus`
- 不负责填充具体 code-spec（那是 `/knowledge-update` 的职责）

## 布局

### Monorepo（`project-config.json.monorepo.packages` 存在）

```
.claude/knowledge/
├── index.md
├── {pkg-a}/
│   ├── frontend/index.md
│   └── backend/index.md
├── {pkg-b}/
│   ├── frontend/index.md
│   └── backend/index.md
├── guides/index.md
└── local.md
```

### 单包项目（无 monorepo 声明）

仍走单例 package 布局（对齐 Trellis 单包写法）：

```
.claude/knowledge/
├── index.md
├── {project-name}/
│   ├── frontend/index.md
│   └── backend/index.md
├── guides/index.md
└── local.md
```

`project-name` 依次取自 `project-config.json.project.name` → `package.json.name` → 仓库目录名。

## 流程

1. 读取 `.claude/config/project-config.json`，取 `project.type`、`monorepo.packages` 与 `tech.frameworks`
2. 若无配置，提示用户先执行 `/scan --init`
3. 决定 package 列表：
   - `config.monorepo.packages` 存在 → 直接使用
   - 否则 `project.type === 'monorepo'` → 自动扫 `pnpm-workspace.yaml` / `package.json#workspaces` / `lerna.json` 里的 workspace 名作为 package 列表
   - 以上都拿不到时报错退出（`monorepo_packages_unresolved`），让用户在 `project-config.json` 里显式写 `monorepo.packages`
   - `project.type` 非 monorepo → 使用 `project.name` → `package.json.name` → 仓库目录名，走单例布局
4. 根据 framework 决定生成哪些 layer：
   - 命中前端框架 → 各 package 下生成 `frontend/`
   - 命中后端框架 → 各 package 下生成 `backend/`
   - `guides/` 始终生成
5. 若检测到旧版 `.claude/knowledge/{frontend,backend}/` 顶层布局：
   - **不做自动迁移**
   - 报错并提示用户确认无重要数据后用 `--reset` 重建
6. 调用 CLI：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/knowledge_bootstrap.js init \
     --project-root "$(pwd)" \
     --frameworks "react,express"
   ```
7. **Post-bootstrap Audit**（空模板审计）：
   - CLI `init` 返回值中包含 `generated`（本次生成的文件列表）与 `emptyTemplateAudit`（仅扫 `generated`，自动排除 `local.md`）。
   - 输出一行计数：
     ```
     📋 Post-bootstrap audit: {withPlaceholders}/{total} 个骨架文件仍含占位符
     ```
   - **不**直接引导用户去跑 `/knowledge-update`——骨架刚生成就立刻沉淀过于激进。用户想填时自然会调用。
   - 与 `/scan` Part 5 的 bootstrap 提示语义不同：`/scan` 判断"是否需要 bootstrap"，本步判断"刚 bootstrap 出来的文件是否仍为空模板"。
   - 与 `/knowledge-review` 的 draft 检测也不冲突：review 盯长期存量，本步只看本次生成。
   - `CLAUDE_NON_INTERACTIVE=1`：仍打一行计数，不追问。

8. 告知下一步：
   - `/knowledge-update` 捕获第一条规范
   - `git add .claude/knowledge/ && git commit` 版本化骨架

## 用法

```
/knowledge-bootstrap              # 按 project-config 自动判断 packages × layers
/knowledge-bootstrap --force      # 即使没有检测到框架也生成 frontend + backend
/knowledge-bootstrap --reset      # 清空已有 .claude/knowledge/ 并重建（用于切换到新布局）
```

## 与其他命令的关系

- `/scan` 在检测到未初始化时会引导调用本命令，或用户选择跳过（`bootstrapStatus: "skipped"`）
- `/knowledge-update` 在第一次写入 code-spec 时会要求骨架已存在
- `/knowledge-review` 检查骨架完整性、7 段合约完整性、canonical 模板升级差异

## 注意

- 默认**幂等**：已存在的文件不会被覆盖
- `--reset` 是**破坏性操作**，会删除整个 `.claude/knowledge/` 目录并重建，执行前需要交互确认
- 不提供旧布局 → 新布局的自动迁移脚本；新项目一次到位，旧项目由用户人工迁移关键内容后再 `--reset`
