---
name: spec-bootstrap
description: "初始化项目级 code-specs 骨架（v2.2）。按 codeSpecs.packages.include 决定 package 范围，按栈模板（--stack）拷贝 core 主题文件，生成 .template-hashes.json 与 00-bootstrap-guidelines 首任务。"
---

# /spec-bootstrap

在项目中建立 `.claude/code-specs/` 骨架，采用 `{package}/{layer}/` 二维布局 + 共享 `guides/`。

## 职责

- 生成根 `index.md`
- 按 `codeSpecs.packages.include` 生成 `{pkg}/{layer}/` 目录树
- 若指定 `--stack <name>`，从 `core/specs/stack-templates/<name>/` 拷贝 core 主题文件（含 convention 模板段落），让 00-task 有真实文件靶子
- 生成 `guides/index.md`
- 生成 `local.md`（只保留 Customizations + Changelog；模板漂移治理已切到 `.template-hashes.json`）
- 生成 `.template-hashes.json`（记录本次使用的模板 sha256 + canonical version，用于模板漂移治理）
- 生成 `.claude/tasks/00-bootstrap-guidelines.md` 首任务
- 更新 `project-config.json` 的 `codeSpecs.bootstrapStatus`
- 不负责填充具体规范内容（那是 00-task + `/spec-update` 的职责）

## 布局

### Monorepo（`project-config.json.monorepo.packages` 存在）

```
.claude/code-specs/
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

仍走单例 package 布局：

```
.claude/code-specs/
├── index.md
├── {project-name}/
│   ├── frontend/index.md
│   └── backend/index.md
├── guides/index.md
└── local.md
```

`project-name` 依次取自 `project-config.json.project.name` → `package.json.name` → 仓库目录名。

## 流程

1. 读取 `.claude/config/project-config.json`
2. 若无配置，提示用户先执行 `/scan --init`
3. 决定 package 列表（v2.2 优先级）：
   - `config.codeSpecs.packages.include` 显式声明 → 直接使用（最高优先级）
   - 历史字段 `config.monorepo.packages` → 向后兼容使用
   - monorepo 且未声明 include → 自动扫 workspace，再应用默认过滤器：
     - `structure.archivedApps[]` / `structure.auxiliaryApps[]`（取自 config）
     - `codeSpecs.packages.configPackagePatterns` 匹配的配置包（默认 `*-config` / `*-preset` / `tsconfig*`）
     - 默认过滤器可通过 `codeSpecs.packages.skipDefaultFilters: true` 关闭
   - single-package → 自动推断 `project.name` → `package.json.name` → 仓库目录名
   - `codeSpecs.packages.exclude` 永远作为后置过滤（支持 `*` glob）
   - 若 CLI 返回 `pendingPackages`（含 `included` + `autoExcluded`），skill 应先用 `AskUserQuestion` 向用户展示"建议纳管 / 自动过滤"清单并让其确认，再把确认后的列表写回 `project-config.json.codeSpecs.packages.include`，以免下次再次命中自动过滤逻辑。
4. 决定 layer（v2.2 bootstrap 期）：
   - `--stack <name>` 且栈模板的 `manifest.json` 声明了 layers → 用栈模板声明
   - 否则按 `tech.frameworks` 推断（命中前端框架 → `frontend`，后端 → `backend`）
   - fallback：`['frontend']`
5. 栈模板决策（v2.2）：
   - 优先级：`--no-stack` 显式跳过 > `--stack <name>` 显式指定 > `tech.frameworks` 推断（vue/nuxt → vue-nuxt；react/next → react-next；express/fastify/nest → node-express） > 空骨架
   - CLI 会在返回里带上 `stackSource`（`explicit` / `inferred` / `fallback` / `none` / `disabled`），skill 需要把推断结果原话反馈给用户（例如"已自动选择栈 vue-nuxt（来自 tech.frameworks），要空骨架请加 --no-stack"）
   - 若 `--stack` 有效 → 从 `core/specs/stack-templates/<name>/<layer>/` 拷贝主题文件
   - 拷贝范围由 `--scope` 决定：`core`（默认，仅 manifest.core）/ `full`（core + optional）/ `minimal`（仅 index.md）
   - 目标路径已存在文件不会被覆盖
6. 旧布局保护：检测到 `.claude/code-specs/{frontend,backend}/` 顶层目录 → 报错，要求 `--reset` 重建
7. 调用 CLI：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/spec_bootstrap.js init \
     --project-root "$(pwd)" \
     --frameworks "vue,nuxt" \
     --stack vue-nuxt
   ```
8. 副产物（v2.2 新增 + v3 A3 增量）：
   - `.template-hashes.json` 自动写入（记录模板 sha256 + canonical version；取代 local.md Template Baseline）
   - `.claude/tasks/00-bootstrap-guidelines.md` 自动生成（引导用户 Document Reality；若已有 workflow 任务则放 `spec-bootstrap/` 子目录避免冲突）
   - v3：monorepo 且未声明 `codeSpecs.runtime.scope` 时，自动写 `"active_task"`（让会话启动 hook 默认按当前 task 收窄注入）；单包项目不写。已有值（含 null）不覆盖
9. **Post-bootstrap Audit**（空模板审计）：
   - 输出一行计数：`📋 Post-bootstrap audit: {withPlaceholders}/{total} 个骨架文件仍含占位符`
   - 审计自动排除 `local.md` / `.template-hashes.json` / `00-bootstrap-guidelines.md`
   - 渐进填充理念：有占位符是正常起点，由 00-task 引导逐步落实，不强推 `/spec-update`
10. 告知下一步：
    - 打开 `.claude/tasks/00-bootstrap-guidelines.md` 按步骤填充
    - `git add .claude/code-specs/ .claude/tasks/ && git commit` 版本化

## Final Output Format

CLI `init` 返回里带有 `nextActions` 字段（`primary` / `firstTargetFile` / `grepHint` / `estimatedTimePerFile` / `commitHint` / `remainingPackages`），skill 完成 bootstrap 后把它们组织成结构化收尾消息，至少覆盖以下要点：

```
✅ 骨架已生成（N 个文件），应用栈：{stack or "空骨架"}
📋 Post-bootstrap audit: {withPlaceholders}/{total} 个骨架文件仍含占位符（正常起点）

▶ 下一步
  1. 打开 {nextActions.primary.path}（含具体步骤）
  2. 首个靶子：{nextActions.firstTargetFile}
  3. 找代码样本：{nextActions.grepHint}
  4. 预计 {nextActions.estimatedTimePerFile}/文件
  5. 填完第一个再把剩余 {remainingPackages.length} 个包按类似节奏处理
  6. 完成后：{nextActions.commitHint}
```

若 CLI 返回了 `pendingPackages.autoExcluded`，在结尾前追加一段"自动过滤详情"供用户确认。

## 用法

```
/spec-bootstrap                         # 默认 core 主题；frameworks 命中时自动推断栈
/spec-bootstrap --stack vue-nuxt        # 显式指定栈模板（覆盖推断结果）
/spec-bootstrap --no-stack              # 显式跳过栈模板，生成空骨架
/spec-bootstrap --stack vue-nuxt --full # core + optional 主题都生成
/spec-bootstrap --stack vue-nuxt --minimal  # 仅 index.md，不拷贝主题
/spec-bootstrap --force                 # 忽略 frameworks，生成 frontend + backend
/spec-bootstrap --reset                 # 清空已有 .claude/code-specs/ 重建
```

## 与其他命令的关系

- `/scan` 在检测到未初始化时会引导调用本命令，或用户选择跳过（`bootstrapStatus: "skipped"`）
- `00-bootstrap-guidelines` 任务是本命令的主要后续动作，引导用户按 Document Reality 原则逐步填充骨架
- `/spec-update` 在第一次写入 code-spec 时会要求骨架已存在
- `/spec-review` 检查骨架完整性、convention 必备段 lint、`.template-hashes.json` 漂移

## 注意

- 默认**幂等**：已存在的文件不会被覆盖
- `--reset` 是**破坏性操作**，会删除整个 `.claude/code-specs/` 目录并重建，执行前需要交互确认
- 不提供旧布局 → 新布局的自动迁移脚本；新项目一次到位，旧项目由用户人工迁移关键内容后再 `--reset`

## codeSpecs.runtime.scope 说明（v3 Stage A3）

用于让 `session-start` hook 与 `pre-execute-inject` hook 在 monorepo 下按活动任务自动收窄 code-specs 读取范围，避免多包项目会话启动就读整棵 spec 树。

取值：

| 值 | 行为 |
|----|------|
| `"active_task"` | 有 active task 时用 task.package；无 task 时 `scopeDenied` |
| `["pkg-a", "pkg-b"]` allowlist | 当前 task.package 命中才认可；未命中 `scopeDenied` |
| `null` / 未设 | 保持历史行为（由 task → project.name → package.json → repo-dir 兜底） |

bootstrap 默认在 monorepo 首次落地时写 `"active_task"`；单包项目不写。用户可以手工改成 allowlist 或显式 `null`。`scopeDenied` 时 reader 不回退全树，调用方（hook / skill）各自决定输出 paths-only / 空段 / 提示文案。

## 设计原则（v2.2）

经 3 轮 Codex review 收敛后的设计原则：

- **有** `{package}/{layer}/` + `guides/` 分层布局
- **无** frontmatter 驱动的模板分型（主题文件直接 H1 起头）
- **有** 栈模板完整目录 + 00-bootstrap 任务引导渐进填充
- **有** `.template-hashes.json` 模板漂移治理
- **无** `shared/` 默认生成（避免 phantom 目录）
- **无** Topic Coverage Snapshot（贯彻渐进填充理念）
