---
name: scan
description: "智能项目扫描 - 检测技术栈、生成配置文件和项目上下文报告。触发条件：用户调用 /scan，或首次使用workflow前需要初始化项目配置，或项目架构delta后需要更新配置。输出 project-config.json 和 repo-context.md。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:本 skill 自己产出 project-config.json / repo-context.md,首次运行时 pre-flight 第 1-2 步缺失属预期——第 4 步 glossary 仍须读,让产出使用 canonical 术语。
</PRE-FLIGHT>

# 智能项目扫描

自动检测项目结构、技术栈，并通过语义代码检索生成项目上下文报告。

## 用法

```bash
/scan                  # 完整扫描
/scan --init           # 仅生成 projectId 和最小配置（空项目适用）
/scan --config-only    # 仅生成配置文件（跳过语义分析）
/scan --context-only   # 仅生成上下文报告（需已有配置）
/scan --migrate        # 仅跑 legacy projectId 迁移（见 scripts/migrate-project-id.sh）
/scan --force          # 强制覆盖（不询问确认）
```

## 产出文件

| 模式 | 产出 |
|------|------|
| `--init` / 空项目自动 | `.claude/config/project-config.json` |
| `--config-only` | `project-config.json` + `ui-config.json` |
| `--context-only` | `repo-context.md`（需已有配置） |
| 默认（完整） | `project-config.json` + `ui-config.json` + `repo-context.md` |

### project-config.json 结构

```json
{
  "project": { "id": "a1b2c3d4e5f6", "name": "...", "type": "monorepo|single", "bkProjectId": "v10125" },
  "tech": { "packageManager": "pnpm", "buildTool": "vite", "frameworks": ["vue"] },
  "workflow": { "enableBKMCP": true }
}
```

### ui-config.json 结构

```json
{
  "assetsDir": "public/images",
  "cssFramework": "tailwind",
  "designTokensFile": "tailwind.config.ts",
  "designTokens": { "colors": {...}, "spacing": {...}, "typography": {...} },
  "componentsDir": "src/components",
  "existingComponents": ["Button", "Modal", "Table", "Form"],
  "generatedAt": "<ISO>"
}
```

UI 配置delta频率高于项目元数据，独立文件供 figma-ui 等 UI skill 专用。

## 执行workflow

```
Part 0: Legacy 迁移检测 + 空项目快速路径
Part 1: 技术栈检测（文件系统）
Part 2: 语义代码检索（MCP 深度分析）
Part 3: 生成报告
Part 4: 产出完整性检查
Part 5: Code Specs 初始化提示（非阻塞）
```

## Part 0: Legacy 迁移 + 空项目

### Legacy projectId 迁移

`project-config.json` 存在 + `project.id` 匹配 `/^[a-f0-9]{12}$/` → legacy 格式。用户确认后迁移到 `{name-slug}-{hash}` 新格式，同时重命名 `~/.claude/workflows/{旧id}/` 目录。

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js migrate-project-id \
  --project-root "$(pwd)"      # 检测 plan（needed: false 时静默跳过）

node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js migrate-project-id \
  --project-root "$(pwd)" --apply    # 用户确认后执行
```

返回 `target_state_dir_exists` 时提示用户手动处理冲突，不自动合并。拒绝迁移保留旧 id，不阻塞。

### 空项目 / --init 快速路径

目录为空（忽略 `.git` / `.claude` / `node_modules` / `.vscode` / `.idea` / `.cursor`）或 `--init` → 生成最小配置并 **return**，跳过 Part 1-3：

```typescript
const projectId = generateStableProjectId(process.cwd());
const minimalConfig = {
  project: { id: projectId, name: path.basename(cwd), type: 'single', bkProjectId: null },
  tech: { packageManager: 'unknown', buildTool: 'unknown', frameworks: [] },
  workflow: { enableBKMCP: false },
  _scanMode: 'init'
};
writeFile('.claude/config/project-config.json', JSON.stringify(minimalConfig, null, 2));
```

输出摘要后告知用户代码就位后可 `/scan --force` 更新完整配置。

**generateStableProjectId 实现**：新格式 `{name-slug}-{12位 hash}`，slug 从 `path.basename(cwd)` 取 ASCII + lowercase；全非 ASCII 目录名 slug 为空时退回纯 hash。必须通过 CLI 计算（路径规范化差异）：

```bash
node -e "const {stableProjectId}=require('./core/utils/workflow/lifecycle_cmds');console.log(stableProjectId(process.cwd()))"
```

## Part 1: 技术栈检测

### 1.1 现有配置检查

```bash
if [ -f ".claude/config/project-config.json" ]; then
  cat .claude/config/project-config.json | jq '{project: .project.name, tech: .tech}'
  # 除非 --force，询问是否覆盖
fi
```

### 1.2 运行检测脚本

执行 [scripts/detect-tech-stack.sh](scripts/detect-tech-stack.sh) 检测：项目类型（Monorepo/Single）/ 包管理器 / 构建工具 / 框架 / 微前端（Wujie/Qiankun）/ 可观测性（Sentry/Bugsnag）。

### 1.3 写入 project-config.json

```bash
mkdir -p .claude/config
# 写入检测结果
```

### 1.4 蓝鲸项目关联（条件）

首次扫描 + `project.bkProjectId` 空 + 未走 `--force` 跳过 → 询问：

> 是否需要关联蓝鲸项目？关联后可用 `/bug-batch` 拉取项目缺陷。
> - 跳过：稍后用 `/bk` skill 手动 `project set <v开头ID>` 配置
> - 关联：需要你告诉我项目 ID（形如 `v10125`）或任意一条该项目 issue_number（形如 `p328_8729`，用于反查）

收到用户输入后调用 `bk` skill 的 `project set` workflow（见 `core/skills/bk/SKILL.md § 场景 B`），不在 scan 里复写交互。

## Part 2: 语义代码检索

使用 `mcp__auggie-mcp__codebase-retrieval` 深度分析。详见 [references/semantic-queries.md](references/semantic-queries.md)。

**维度**：项目入口 / API 路由 / 数据模型 / 前端组件 / 核心业务逻辑 / 测试覆盖。

**降级**：MCP 不可用时仅执行 Part 1。

## Part 3: 生成报告

将语义分析写入 `.claude/repo-context.md`。模板见 [references/context-template.md](references/context-template.md)。

## Part 4: 产出完整性检查

按扫描模式预期产出：

```typescript
const expectedOutputsByMode = {
  full: ['.claude/config/project-config.json', '.claude/config/ui-config.json', '.claude/repo-context.md'],
  'config-only': ['.claude/config/project-config.json', '.claude/config/ui-config.json'],
  'context-only': ['.claude/repo-context.md']
  // init 在 Part 0 已 return，不会到达此处
};

const missing = expectedOutputs.filter(f => !fileExists(f));
if (missing.length > 0) {
  // 告诉用户缺失文件 + 可能原因（MCP 不可用仅影响 repo-context.md）
}
```

## Part 5: Code Specs 初始化提示（非阻塞）

`full` / `config-only` 模式 + `.claude/code-specs/index.md` 不存在 + `codeSpecs.bootstrapStatus !== 'skipped'` → 输出一行提示：

> 💡 本项目尚未建立 code-specs（`.claude/code-specs/`）。code-specs 用于沉淀编码convention、架构决策、常见错误。如需初始化运行 `/spec-bootstrap`；已有规范想对照请用 `/spec-review`。

**不在 scan 里直接调用 spec-bootstrap CLI**——交给独立 skill。已有 code-specs 时输出一行摘要：

> 📚 code-specs: {N} files ({filled} filled / {draft} draft)

## 完成输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 项目扫描完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 生成的文件：
  • 配置文件: .claude/config/project-config.json
  • UI 配置: .claude/config/ui-config.json
  • 上下文报告: .claude/repo-context.md

📚 code-specs: <状态摘要 或 未初始化提示>

📚 下一步：
  1. 查看上下文: cat .claude/repo-context.md
  2. 启动工作流: /workflow-plan "功能需求描述"
  3. 需要更轻的规划: /quick-plan
  4. UI 还原: /figma-ui <figma-url>
  5. 沉淀规范: /spec-bootstrap（首次）或 /spec-update（增量）
```

## 与其他命令的关系

```bash
/scan                  # 首次使用 / 架构变更后
/spec-bootstrap        # 初始化 code-specs（scan 跳过后的手动入口）
/spec-update           # 沉淀规范（7 段 code-spec 或 thinking guide）
/spec-review           # 审查 code-specs 过期 / 完整性
/bk project set <id>   # 蓝鲸项目关联（scan Part 1.4 跳过后的手动入口）
/workflow-plan         # 自动读取 repo-context.md + code-specs/
```
