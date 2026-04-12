---
name: scan
description: "智能项目扫描 - 检测技术栈、生成配置文件和项目上下文报告。触发条件：用户调用 /scan，或首次使用工作流前需要初始化项目配置，或项目架构变更后需要更新配置。输出 project-config.json 和 repo-context.md。"
---

# 智能项目扫描

自动检测项目结构、技术栈，并通过语义代码检索生成项目上下文报告。

## 用法

```bash
/scan                  # 完整扫描
/scan --init           # 仅生成 projectId 和最小配置（空项目适用）
/scan --config-only    # 仅生成配置文件（跳过语义分析）
/scan --context-only   # 仅生成上下文报告（需已有配置）
/scan --force          # 强制覆盖（不询问确认）
```

## 输出产物

根据扫描模式，产出文件不同：

| 模式 | 产出文件 |
|------|----------|
| `--init` 或空项目自动触发（最小初始化） | `.claude/config/project-config.json` |
| `--config-only` | `.claude/config/project-config.json`、`.claude/config/ui-config.json` |
| `--context-only` | `.claude/repo-context.md`（需已有配置） |
| 完整扫描（默认） | `.claude/config/project-config.json`、`.claude/config/ui-config.json`、`.claude/repo-context.md` |

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
  "designTokens": {
    "colors": { "primary": "#1890ff", "error": "#ff4d4f" },
    "spacing": { "xs": "4px", "sm": "8px", "md": "16px" },
    "typography": { "base": "14px", "lg": "16px" }
  },
  "componentsDir": "src/components",
  "existingComponents": ["Button", "Modal", "Table", "Form"],
  "generatedAt": "2026-02-03T00:00:00Z"
}
```

> **独立文件原因**：UI 配置变更频率高于项目元数据，且为 figma-ui 等 UI skill 专用。

## 执行流程

```
Part 0: 空项目检测与 --init 快速路径（新增）
Part 1: 技术栈检测（文件系统）
Part 2: 语义代码检索（MCP 深度分析）
Part 3: 生成报告
Part 4: 产出完整性检查（新增）
```

## Part 0: 空项目检测与 --init 快速路径

**目的**：当项目目录为空或用户指定 `--init` 时，生成最小 `project-config.json`，确保 projectId 可用。

```typescript
const isInitMode = flags.includes('--init');
const sourceFiles = listFiles('.', {
  ignore: ['.git', '.claude', 'node_modules', '.vscode', '.idea', '.cursor']
});
const isEmpty = sourceFiles.length === 0;

if (isInitMode || isEmpty) {
  const projectId = generateStableProjectId(process.cwd());
  const projectName = path.basename(process.cwd());

  const minimalConfig = {
    project: {
      id: projectId,
      name: projectName,
      type: 'single',
      bkProjectId: null
    },
    tech: {
      packageManager: 'unknown',
      buildTool: 'unknown',
      frameworks: []
    },
    workflow: { enableBKMCP: false },
    _scanMode: 'init'  // init | full
  };

  ensureDir('.claude/config');
  writeFile('.claude/config/project-config.json', JSON.stringify(minimalConfig, null, 2));

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 最小项目配置已生成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 项目 ID: ${projectId}
📁 项目名: ${projectName}
📄 配置文件: .claude/config/project-config.json

${isEmpty ? '📝 检测到空项目，已跳过技术栈检测和语义分析。' : ''}
💡 项目有代码后可随时执行 /scan --force 更新完整配置。

📚 下一步：
  /workflow-plan "需求描述"
   `);
  return;  // 跳过 Part 1~3
}
```

### generateStableProjectId

基于目录绝对路径生成确定性 ID（同目录同 ID）：

```typescript
function generateStableProjectId(cwd: string): string {
  return crypto.createHash('md5')
    .update(cwd.toLowerCase())  // 大小写不敏感（Windows 兼容）
    .digest('hex')
    .substring(0, 12);
}
```

## Part 1: 技术栈检测

### 1.1 检查现有配置

```bash
CONFIG_PATH=".claude/config/project-config.json"

if [ -f "$CONFIG_PATH" ]; then
  # 显示现有配置摘要
  cat "$CONFIG_PATH" | jq '{project: .project.name, tech: .tech}'
  # 询问是否覆盖（除非 --force）
fi
```

### 1.2 运行检测脚本

执行 [scripts/detect-tech-stack.sh](scripts/detect-tech-stack.sh) 检测：
- 项目类型（Monorepo/Single）
- 包管理器（pnpm/npm/yarn/go/cargo/pip）
- 构建工具（vite/turbo/webpack/next/nuxt）
- 框架（React/Vue/Angular/Go/Python/Rust）
- 微前端框架（Wujie/Qiankun）
- 可观测性工具（Sentry/Bugsnag）

### 1.3 生成配置文件

```bash
mkdir -p ".claude/config"
# 写入 project-config.json
```

## Part 1.5: 蓝鲸项目关联

首次执行 `/scan` 时，询问用户是否需要关联蓝鲸项目。若用户确认，自动查找并写入蓝鲸项目 ID。

**流程**：

1. 询问用户是否需要关联蓝鲸项目（已有 `project.bkProjectId` 时跳过询问）

2. 用户确认后，使用项目名称作为关键字调用 `mcp__mcp-router__search_projects`：
   ```
   search_projects(keyword: "<PROJECT_NAME>", limit: 5)
   ```

3. 展示匹配结果供用户选择：
   ```
   找到以下蓝鲸项目：
   | # | 项目 ID | 项目名称 |
   |---|---------|----------|
   | 1 | v10125  | PIC-ReelMateWeb |
   | 2 | v10130  | PIC-ReelMateAPI |

   请选择关联的项目编号（输入序号），或输入 "skip" 跳过。
   ```

4. 用户选择后，将蓝鲸项目 ID 写入 `project-config.json` 的 `project.bkProjectId`：
   ```json
   {
     "project": {
       "id": "a1b2c3d4e5f6",
       "name": "...",
       "type": "...",
       "bkProjectId": "v10125"
     }
   }
   ```

5. 无匹配结果时提示用户手动输入项目 ID 或跳过。

**跳过条件**：用户选择不关联，或已有 `project.bkProjectId`（除非 `--force`）。

## Part 2: 语义代码检索

使用 `mcp__auggie-mcp__codebase-retrieval` 进行深度分析。

详见 [references/semantic-queries.md](references/semantic-queries.md)

**查询维度**：
1. 项目入口与启动流程
2. API 路由与端点
3. 数据模型与数据库 Schema
4. 前端组件结构
5. 核心业务逻辑
6. 测试覆盖情况

**降级策略**：MCP 不可用时仅执行 Part 1。

## Part 3: 生成报告

将语义分析结果写入 `.claude/repo-context.md`。

输出模板详见 [references/context-template.md](references/context-template.md)

## 完成输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 项目扫描完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 生成的文件：
  • 配置文件: .claude/config/project-config.json
  • UI 配置: .claude/config/ui-config.json
  • 上下文报告: .claude/repo-context.md

📚 下一步：
  1. 查看上下文报告: cat .claude/repo-context.md
  2. 启动工作流: /workflow-plan "功能需求描述"
  3. UI 还原: /figma-ui <figma-url>（自动读取 ui-config.json）
```

## Part 4: 产出完整性检查

扫描结束前检查**当前模式下**预期产出文件是否全部生成。

> ⚠️ 本检查仅适用于完整扫描和 `--config-only` 模式。`--init` 路径在 Part 0 已 return，不会执行到此处。

```typescript
// 按扫描模式确定预期产出
const expectedOutputsByMode: Record<string, string[]> = {
  full: [
    '.claude/config/project-config.json',
    '.claude/config/ui-config.json',
    '.claude/repo-context.md'
  ],
  'config-only': [
    '.claude/config/project-config.json',
    '.claude/config/ui-config.json'
  ],
  'context-only': [
    '.claude/repo-context.md'
  ]
  // 注意：init 模式在 Part 0 已 return，不会到达此处
};

const scanMode = flags.includes('--config-only') ? 'config-only'
               : flags.includes('--context-only') ? 'context-only'
               : 'full';
const expectedOutputs = expectedOutputsByMode[scanMode];

const missing = expectedOutputs.filter(f => !fileExists(f));

if (missing.length > 0) {
  console.log(`
⚠️ 扫描完成（模式: ${scanMode}）但以下文件未生成：
${missing.map(f => `  ❌ ${f}`).join('\n')}

可能原因：
- MCP 工具不可用 → 仅影响 repo-context.md
- 项目结构无法识别
  `);
}
```

## 与其他命令的关系

```bash
/scan                           # 首次使用或架构变更后
/workflow-plan "功能需求"      # 自动读取 repo-context.md
```
