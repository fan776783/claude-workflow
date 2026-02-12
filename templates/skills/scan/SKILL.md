---
name: scan
description: "智能项目扫描 - 检测技术栈、生成配置文件和项目上下文报告。触发条件：用户调用 /scan，或首次使用工作流前需要初始化项目配置，或项目架构变更后需要更新配置。输出 project-config.json 和 repo-context.md。"
---

# 智能项目扫描

自动检测项目结构、技术栈，并通过语义代码检索生成项目上下文报告。

## 用法

```bash
/scan                  # 完整扫描
/scan --config-only    # 仅生成配置文件（跳过语义分析）
/scan --context-only   # 仅生成上下文报告（需已有配置）
/scan --force          # 强制覆盖（不询问确认）
```

## 输出产物

- `.claude/config/project-config.json` — 项目配置文件
- `.claude/config/ui-config.json` — UI 设计系统配置（供 figma-ui 等 UI skill 读取）
- `.claude/repo-context.md` — 项目上下文报告

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
Part 1: 技术栈检测（文件系统）
Part 2: 语义代码检索（MCP 深度分析）
Part 3: 生成报告
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
  2. 启动工作流: /workflow start "功能需求描述"
  3. UI 还原: /figma-ui <figma-url>（自动读取 ui-config.json）
```

## 与其他命令的关系

```bash
/scan                           # 首次使用或架构变更后
/workflow start "功能需求"      # 自动读取 repo-context.md
```
