---
name: figma-data
description: "Figma MCP 数据获取层：连接 Figma Desktop/Remote MCP，提取设计上下文、截图、资源文件，执行 Asset Triage，产出标准化 Design Package。被 figma-ui 等还原类 skill 内部调用；用户直接触发场景：只需提取设计数据/资产而不写代码、需要设计 token 导出、需要节点结构分析。"
---

# Figma Data — 设计数据获取 + 资源分诊

> 本 skill 是 Figma 还原体系的数据层。负责 MCP 连接管理、设计数据获取、资源下载与分诊，产出标准化 **Design Package** 供下游 skill（`figma-ui` 等）消费。
>
> ⚠️ 不要绕开本 skill 直接裸调 MCP 或 CLI。本 skill 负责 `assetsDir`、临时目录、资源分诊的完整性。

## 运行入口

CLI 路径（相对本 skill）：`cli/figma.mjs`，Node >= 18，无需安装依赖。

调用形式：
```bash
node <skill-root>/figma-data/cli/figma.mjs <subcommand> [args...]
```

CLI 封装 Figma Desktop MCP Server（`http://127.0.0.1:3845/mcp`）全部工具，替代原生 MCP tool 调用，并自动管理资产临时目录和差集计算。

### 高频命令

```bash
# 获取设计上下文 + 自动管理资产目录（推荐入口）
node cli/figma.mjs design --url "https://figma.com/design/xxx/Name?node-id=42-15"
node cli/figma.mjs design --nodeId 42:15 --taskId my-task

# 获取截图
node cli/figma.mjs screenshot --url "https://figma.com/design/xxx/Name?node-id=42-15"

# 获取节点结构（分块场景）
node cli/figma.mjs get_metadata --nodeId 0:1

# 获取 Design Token
node cli/figma.mjs get_variable_defs --nodeId 42:15

# 清理任务临时目录
node cli/figma.mjs cleanup --taskId my-task
node cli/figma.mjs cleanup  # 清理全部 tmp

# 连通性检查
node cli/figma.mjs doctor
```

### `design` 命令详解

`design` 是最核心的高层命令，自动完成：
1. 创建 `${assetsDir}/.figma-ui/tmp/${taskId}` 临时目录
2. 调用 `get_design_context` 并传入 `dirForAssetWrites`
3. 等待异步资产写入（3s）
4. 计算目录差集得到 `newlyDownloadedFiles`
5. 输出 JSON（含 designContext + newlyDownloadedFiles + screenshot 路径）

输出示例：
```json
{
  "taskId": "a1b2c3d4",
  "taskDir": "/project/public/images/.figma-ui/tmp/a1b2c3d4",
  "newlyDownloadedFiles": ["6e134c6c...svg", "e0e0f6ac...png"],
  "totalFilesInDir": 2,
  "screenshot": "/project/public/images/.figma-ui/tmp/a1b2c3d4/_screenshot.png",
  "designContext": "..."
}
```

### URL 便利参数

所有命令支持 `--url`，自动提取 `fileKey` + `nodeId`：
- 标准 URL：`/design/:fileKey/:name?node-id=42-15` → `fileKey` + `nodeId=42:15`
- Branch URL：`/design/:fileKey/branch/:branchKey/:name` → 用 `branchKey` 作为 fileKey

### 环境变量

| 变量 | 说明 |
|------|------|
| `FIGMA_MCP_URL` | 覆盖 MCP endpoint（默认 `http://127.0.0.1:3845/mcp`） |

## Skill Boundaries

| 任务 | 用哪个 skill |
|------|------------|
| 获取 Figma 设计数据 + 资源分诊 → Design Package | **本 skill** |
| Design Package → Web 代码实现 + 验证 | `figma-ui` |
| 在 Figma 画布上 create / edit / delete 节点 | `figma-use` |
| 从代码或描述生成完整页面设计稿 | `figma-generate-design` |
| 生成 Code Connect 映射 | `figma-code-connect` |
| 生成 design system 规则(CLAUDE.md / AGENTS.md) | `figma-create-design-system-rules` |

## Prerequisites

- Figma Desktop MCP Server 运行中（`node cli/figma.mjs doctor` 验证）
- Image Source 设为 **Download**（Figma Desktop → Preferences → Dev Mode MCP）
- 用户提供 Figma URL 或使用桌面端当前选中节点

连接失败或首次配置 → 见 [`references/troubleshooting.md`](references/troubleshooting.md)。

## Design Package 输出契约

本 skill 的最终产出是一个 **Design Package**，供下游 skill 消费：

| 字段 | 说明 |
|------|------|
| `taskId` | 任务标识 |
| `taskDir` | 临时工作目录路径 |
| `screenshot` | 设计截图路径 |
| `designContext` | MCP 返回的原始设计上下文 |
| `ElementManifest` | P0/P1/P2 元素分类 checklist |
| `DesignAnchors` | 根容器数值属性（仅 CHANGE_ARTIFACT） |
| `AssetPlan` | 每个资源的 decision + targetName + targetDir |

下游 skill 从 Design Package 开始工作，不需要直接调用 MCP。

## 执行步骤

### Step 1: 解析 URL

从 `https://figma.com/design/:fileKey/:fileName?node-id=1-2` 提取：
- `fileKey`: `/design/` 之后的路径段
- `nodeId`: `node-id` 查询参数（`1-2` 在 MCP 调用时转为 `1:2`）

无 URL 时使用 Figma 桌面端当前选中节点。

### Step 2: 获取 assetsDir

检查 `.claude/config/ui-config.json` 中的 `assetsDir` 字段。未找到则默认 `public/images` 或询问用户。

### Step 3: 调用 Figma CLI

```bash
node cli/figma.mjs design --url "<figma-url>" --taskId <taskId>
```

返回 JSON 含 `taskDir`、`newlyDownloadedFiles`、`designContext`、`screenshot`。

**返回为空或被截断**时：
1. `node cli/figma.mjs get_metadata --nodeId <nodeId>` 获取节点结构概览
2. 从 metadata 识别关键子节点
3. 按子节点分别 `node cli/figma.mjs design --nodeId <childNodeId> --taskId <taskId>`

### Step 4: 提取 ElementManifest

遍历 `designContext`，按类型分类：

| 类型 | 优先级 | 说明 |
|------|--------|------|
| 容器/布局 | P0 | 核心结构 |
| 文本/按钮/输入框 | P0 | 交互元素 |
| 图片/图标 | P1 | 视觉元素 |
| 装饰图形/分隔线 | P2 | 可选元素 |

### Step 5: 提取 Design Anchors（CHANGE_ARTIFACT 必做）

修改已有组件时，从设计数据中提取根容器及关键子容器的数值属性：

| 属性 | 示例 |
|------|------|
| width / height | `900px` / `720px` |
| padding | `32px 24px 24px` |
| border-radius | `16px` |
| 主要 gap | `16px` |

同时读取现有代码中对应的 CSS 值，一并记录为 `DesignAnchors`。

### Step 6: Asset Triage

为每个 `newlyDownloadedFiles` 标记决策：

| 场景 | 决策 |
|------|------|
| 纯布局 / 文本 / 简单边框 / 简单渐变 | `inline`（直接代码实现） |
| 复杂插画 / 位图 / 照片 | `promote`（纳入正式资源） |
| 明显无用或重复下载 | `discard` |
| 疑似错误粒度的子图层导出 | `refetch-parent`（阻断，先导出父节点） |

### Step 7: 复合图形识别

多个 SVG 在同一位置叠加（背景 + 图标 + 装饰）→ 误提取了子节点。

处理：
1. 当前子资源标记为 `refetch-parent`
2. 获取父 Frame 的 `nodeId`
3. 重新导出为单张图片
4. 更新 AssetPlan

### Step 8: 产出 AssetPlan

每个资源必须有：

| 字段 | 说明 |
|------|------|
| `originalFile` | 原始文件名 |
| `decision` | `inline` / `promote` / `discard` / `refetch-parent` |
| `targetName` | 语义化文件名（仅 `promote`） |
| `targetDir` | 目标目录（仅 `promote`） |

命名原则：`{feature}-{role}.{ext}`。

**Gate**: AssetPlan 完成且无未处理的 `refetch-parent` → Design Package 就绪。

## Core Rules

- **先分诊再交付** — `get_design_context` 返回后先做 Asset Triage 再宣告 Design Package 就绪
- **refetch-parent 阻断** — AssetPlan 中存在 `refetch-parent` 时 Design Package 未就绪
- **通过 CLI `design` 命令调用** — CLI 自动管理 `dirForAssetWrites`；直接 raw call 时必须手动传
- **当前模型执行** — 不调用外部模型处理数据获取和分诊

## Red Flags

| 念头 | 修正 |
|------|------|
| "先把 Design Package 交出去，AssetPlan 后面补" | 回 Step 6 |
| "复合图形先标 promote，让下游自己处理" | 回 Step 7，执行 `refetch-parent` |
| "先用 hash 文件名，最后统一改" | 回 Step 8 资源命名 |

## 参考文档

- [`references/figma-tools.md`](references/figma-tools.md) — 底层 MCP 参数 + Image Source 机制
- [`references/troubleshooting.md`](references/troubleshooting.md) — 连接配置 + 故障排查
