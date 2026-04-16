# Figma MCP 工具速查

## 核心工具

| 工具 | 用途 | 必传参数 | 可选参数 |
|------|------|----------|----------|
| `get_design_context` | 获取结构化设计数据 + 代码 + 下载资源 | `nodeId`, `dirForAssetWrites` | `fileKey`（远程 MCP 必传） |
| `get_screenshot` | 获取节点截图用于视觉验证 | `nodeId` | `fileKey`（远程 MCP 必传） |
| `get_metadata` | 获取节点 XML 结构概览 | `nodeId` | `fileKey`（远程 MCP 必传） |

> **桌面端 MCP vs 远程 MCP**：桌面端 MCP 自动使用当前打开文件，`fileKey` 可省略；远程 MCP 必须传 `fileKey`。

## 标准工作流

```text
1. get_design_context  ─── 获取设计数据（必传 dirForAssetWrites）
         │
         ├─ 正常返回 ──────────────────────────────────────────────┐
         │                                                        │
         └─ 返回空/截断 ─→ get_metadata ─→ 分块重新获取 ───────────┤
                                                                  │
2. get_screenshot  ──────── 获取视觉参考基准 ─────────────────────┤
                                                                  │
3. Asset Triage  ─────── 识别 newlyDownloadedFiles / AssetPlan ───┤
                                                                  │
4. 开始编码（仅消费 inline / promote 资源）                        │
                                                                  │
5. Visual Review（对照截图 + 设计数据验证）                        ┘
```

## 调用示例

从 URL 提取 fileKey 和 nodeId：
- URL: `https://figma.com/design/kL9xQn2VwM8pYrTb4ZcHjF/DesignSystem?node-id=42-15`
- fileKey: `kL9xQn2VwM8pYrTb4ZcHjF`
- nodeId: `42:15`

### 获取设计上下文

```
get_design_context(fileKey="kL9xQn2VwM8pYrTb4ZcHjF", nodeId="42:15", dirForAssetWrites="public/images/.figma-ui/tmp/task-1")
```

调用前后分别列出 `dirForAssetWrites` 目录内容，做差集得到 `newlyDownloadedFiles`。

### 获取视觉参考截图

```
get_screenshot(fileKey="kL9xQn2VwM8pYrTb4ZcHjF", nodeId="42:15")
```

### 复杂节点分块获取

当 `get_design_context` 返回为空或被截断时：

1. 调用 `get_metadata(fileKey, nodeId)` 获取节点结构概览
2. 从返回的 XML 中识别关键子节点的 nodeId
3. 对每个子节点分别调用 `get_design_context`，合并结果

## 资源处理规则

| 规则 | 说明 |
|------|------|
| localhost URL | 直接使用，不转换 |
| 禁止新增图标包 | 所有资源来自 Figma |
| 禁止占位符 | 有 localhost URL 时必须使用 |
| 先分诊再编码 | 先输出 `AssetPlan`，再决定资源如何进入正式目录 |
| 只处理本次下载文件 | 通过调用前后目录差集锁定当前任务范围 |
| 优先语义化命名 | 避免把 hash 文件名直接带入正式目录 |

## 输出转换

Figma MCP 默认输出 React + Tailwind，需要转换为项目框架：

1. **框架适配**：React → Vue/Nuxt 等
2. **设计令牌映射**：优先将 Figma 变量映射到项目已有令牌；无法映射时保留原值 + fallback
3. **组件复用**：识别并复用项目现有组件；匹配时扩展，冲突时新建
4. **资源分诊**：先判断 `inline` / `promote` / `discard` / `refetch-parent`
