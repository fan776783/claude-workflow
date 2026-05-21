# Figma MCP 工具参考

> 本文件是底层参数参考。workflow 见 SKILL.md + playbook.md，CLI 用法见 SKILL.md "运行入口"。

---

## Image Source 机制（Desktop 专属）

Figma Desktop → Preferences → Dev Mode MCP Server → Image source

### Local Server（默认）

- Desktop 启动本地 HTTP 静态资源服务 `http://127.0.0.1:3845/assets/<content-hash>.<ext>`
- session-scoped，Figma 关闭即失效
- `dirForAssetWrites` 传了也无效
- Claude Code CLI 只拿到 URL 字符串（无法 fetch 给模型看）

### Download

- `get_design_context` 调用时将资源写入 `dirForAssetWrites` 指定目录
- 下载粒度：Per-Node — 只下载该 node 生成代码中引用的资源
- 文件命名：content hash（`6e134c6c4f175a81f94018216584fd808a1b84b6.svg`）
- 异步写入：返回后文件可能还没落盘完（CLI `design` 命令已内置 3s 等待）

---

## get_design_context 完整参数

CLI `design` 命令已封装 `nodeId` + `dirForAssetWrites`，以下为进阶参数（通过 `--key value` 传递）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `artifactType` | string | `WEB_PAGE_OR_APP_SCREEN` / `COMPONENT_WITHIN_A_WEB_PAGE_OR_APP_SCREEN` / `REUSABLE_COMPONENT` / `DESIGN_SYSTEM` |
| `taskType` | string | `CREATE_ARTIFACT` / `CHANGE_ARTIFACT` / `DELETE_ARTIFACT` |
| `clientFrameworks` | string | 逗号分隔，如 `vue,tailwindcss` — 影响生成代码风格 |
| `clientLanguages` | string | 逗号分隔，如 `typescript,css` |
| `forceCode` | boolean | 节点过大时强制返回代码（慎用，可能截断） |

## get_screenshot 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `contentsOnly` | boolean | `true` = 隔离渲染（排除浮动/重叠内容）；默认 `false` 匹配画布所见 |

## get_variable_defs

返回节点关联的 Design Token。示例：`{'icon/default/secondary': #949494, 'spacing/md': 16}`

无额外参数（仅 `nodeId` / `fileKey`）。

## create_design_system_rules

| 参数 | 类型 | 说明 |
|------|------|------|
| `clientFrameworks` | string | 逗号分隔 |
| `clientLanguages` | string | 逗号分隔 |

生成设计系统规则文件（CLAUDE.md / AGENTS.md 格式），用于确保后续代码与设计系统一致。

## get_figjam

仅适用于 FigJam 文件（URL 含 `/board/`）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `includeImagesOfNodes` | boolean | 默认 `true` |

---

## Remote MCP 专属工具

以下工具仅在 Remote MCP（`mcp.figma.com/mcp`）可用，CLI 当前不支持（需 OAuth）：

| 工具 | 用途 |
|------|------|
| `generate_figma_design` | 抓取线上网页生成 Figma 设计稿 |
| `use_figma` | 通用写入工具（创建/编辑/删除 Figma 对象），beta |
| `generate_diagram` | 用 Mermaid 语法创建 FigJam 图 |
| `create_new_file` | 创建空白 Design / FigJam 文件 |
| `search_design_system` | 搜索 connected design library |
| `get_code_connect_map` / `add_code_connect_map` | Code Connect 映射 |
| `whoami` | 查询认证用户身份和 plan 信息 |

---

## fileKey 提取规则

| URL 形式 | fileKey 取值 |
|----------|-------------|
| `/design/:fileKey/:name?node-id=X` | `:fileKey` |
| `/design/:fileKey/branch/:branchKey/:name` | **`:branchKey`**（不是原始 fileKey） |

Desktop MCP 自动使用当前打开文件，`fileKey` 可省；Remote MCP 必须传。
