---
name: figma-data
description: "Use when 用户提供 Figma URL 但只是要读取/查看/提取设计数据而不写代码; or 说「读取设计稿」「看下设计」「提取 token」「导出资源」「设计稿结构」「节点分析」; or 被 figma-ui 委托执行 Phase A 数据获取。当无法判断用户是否需要代码实现时,默认先触发本 skill 完成数据获取。不要在用户明确要求实现/还原/写代码时使用——那属于 figma-ui。"
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

<!-- snapshot 2026-05-15 — Figma Desktop MCP Server v1.0.0 exposes 6 tools (get_design_context / get_screenshot / get_metadata / get_variable_defs / get_figjam / create_design_system_rules). refresh: `node cli/figma.mjs list-tools --refresh` and `diff-tools` for drift detection. See ADR-0001 Decision 1/2. -->

CLI 封装 Figma Desktop MCP Server（`http://127.0.0.1:3845/mcp`）全部工具，替代原生 MCP tool 调用，并自动管理资产临时目录和差集计算。

**Design Package** 输出含 `schemaVersion: "1.0"`（ADR-0001 Decision 6）；下游 `figma-ui` Phase A Gate 0 必须 assert。`get_design_context` 不可用时自动降级到 `screenshot + get_metadata` 只读模式，输出 `mode: "read-only-fallback"`。

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

## Design Package 输出 contract

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

## 执行模式

根据调用意图选择执行路径：

| 调用方式 | 执行路径 | 产出 |
|---------|---------|------|
| 用户直接触发（读取/查看/提取） | **Read-only 模式** — 只执行 Step 1 + screenshot + get_metadata | 截图 + 节点结构描述 |
| figma-ui 委托 Phase A | **Full 模式** — 执行全部 Step 1-8 | 完整 Design Package |
| 用户明确要求 token/资源导出 | **Full 模式** | 完整 Design Package |

**Read-only 模式**不需要 `assetsDir`，不调用 `design` 命令，因此不会触发 Allowed directories 报错。

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

**始终单条标准调用**保持上面的形式（单条、不拆分、不重定向）。`design` 依赖本地 Figma MCP（`127.0.0.1:3845`），响应慢时 harness 会把这条命令自动转后台，返回 `Command running in background with ID: … Output is being written to: …/<id>.output`。这**不是空结果**：被转后台的 `design` 要等 MCP 返回 + 3s 资产写入才把 JSON 落到 `.output`。正确做法 —— **等完成通知后再 `Read` 那个 `.output`**，或一开始就显式 `run_in_background: true` 再等通知。**后台命令在完成前 `.output` 必为空 / 非 JSON，这是 pending，不算"确实为空"，不得据此进下面的 fallback。**

禁止（以下全是失败会话里的缠斗副产物，是症状不是解法）：
- ❌ `sleep N; wc -c …` 轮询 `.output` —— 会被 harness Blocked，用 `Read` / 等完成通知代替
- ❌ 重定向到自建文件（`> /tmp/x.json`）或 `cd /tmp` 并行拆分多个 `design` 调用
- ❌ 改动 / 截断 URL（如把文件名段替成 `x`）—— URL 原样传

**确实返回为空或被截断**（已排除上面的后台消息）时：
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
- **慢命令转后台 → Read `.output`，不轮询** — `design` 被 harness 自动转后台时返回的 background 提示不是空结果；`Read` 那个 `.output` 路径取 JSON。禁止 `sleep; wc -c` 轮询、禁止重定向到 /tmp 或拆分并行、禁止改/截断 URL（详见 Step 3）
- **当前模型执行** — 不调用外部模型处理数据获取和分诊
- **AskUserQuestion enum 来自 cache 时强制 refresh**（ADR-0001 Decision 8）— 让用户从 enum 候选（如节点类型选项）选择前，若候选取自 schema cache，先跑 `list-tools --refresh` 或 `get_metadata` 内省避免 server 漂移导致选中已废值

## 降级：dirForAssetWrites 不可用

当 `design` 命令返回 "Cannot write to this directory" 时（Full 模式）：

1. **告知用户**：需要在 Figma Desktop → Preferences → Dev Mode MCP → Allowed directories 添加项目资产目录
2. **立即降级**到 Read-only 模式（不再尝试其他路径）：
   ```bash
   node cli/figma.mjs screenshot --url <url>
   node cli/figma.mjs get_metadata --nodeId <nodeId> --fileKey <fileKey>
   ```
3. 从 screenshot + metadata 提供设计稿结构描述（尺寸、层级、文本内容）
4. **禁止**：读 CLI 源码寻找绕过、尝试其他目录路径、重试 get_design_context

降级产出**不含** AssetPlan 和 designContext 代码，figma-ui 的 Phase B Gate 不满足——需用户修复配置后重新执行。

## Red Flags

| 念头 | 修正 |
|------|------|
| "先把 Design Package 交出去，AssetPlan 后面补" | 回 Step 6 |
| "复合图形先标 promote，让下游自己处理" | 回 Step 7，执行 `refetch-parent` |
| "先用 hash 文件名，最后统一改" | 回 Step 8 资源命名 |
| "design 返回 286b/空，赶紧拆 node 重试" | 先看是不是 `Command running in background` 提示，是就 `Read` 那个 `.output` |
| "sleep 20; wc -c 看 `.output` 写完没" | 会被 Blocked，改用 `Read` / 等完成通知 |
| "URL 太长先截一段 / 重定向到 /tmp 再读" | URL 原样传，结果走 `.output`，不重定向 |

## 参考文档

- [`references/figma-tools.md`](references/figma-tools.md) — 底层 MCP 参数 + Image Source 机制
- [`references/troubleshooting.md`](references/troubleshooting.md) — 连接配置 + 故障排查
