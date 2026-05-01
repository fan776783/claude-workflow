# 设计深化 — 前端分支（§ 4.4 UX & UI Design）

> 本文件从 `design-elaboration.md` 拆分，专注前端设计深化流程。

## § 4.4.1 User Flow

主会话生成 Mermaid 用户操作流程图，≥ 3 个场景：

| 场景 | 必须覆盖 |
|------|---------|
| 首次使用 | 新用户引导路径、空状态处理 |
| 核心操作 | 入口到完成核心功能 |
| 异常/边界 | 操作失败、数据为空、权限不足 |

## § 4.4.2 Page Hierarchy

填写页面层级表，L0 模块不超过 4 个。

## 设计稿关联交互

Page Hierarchy 完成后，收集设计稿来源。

**≤ 3 个页面**（逐页询问）：

```
question: "页面 '{pageName}'（{changeType}）的设计稿来源？"
options:
  - figma_url:   "Figma 设计稿 URL"
  - screenshot:  "截图/图片文件"
  - skip:        "跳过，从交互图推断"
```

- 选 `figma_url` → 追问 Figma URL（含 node-id）
- 选 `screenshot` → 追问图片路径

**> 3 个页面**（批量选项）：

```
question: "检测到 {N} 个需要布局识别的页面，选择关联方式？"
options:
  - one_by_one:  "逐页关联"
  - batch:       "批量关联（粘贴映射表）"
  - all_skip:    "全部跳过"
  - all_figma:   "所有页面共用一个 Figma 文件"
```

选 `batch` 格式：`页面名 | Figma URL 或图片路径`（每行一个）。
选 `all_figma` → 调用 `get_metadata(fileKey)` 列出顶层 frame，按名称自动匹配。

**产出 DesignSourceMap**（内存对象）：

```typescript
type DesignSource =
  | { type: 'figma'; fileKey: string; nodeId: string; url: string }
  | { type: 'screenshot'; imagePath: string }
  | { type: 'infer' };
```

## § 4.4.3 布局锚点提取（子 Agent）

**关键原则**：布局提取涉及大量设计数据，**不在主会话执行**——通过子 Agent 隔离。

| 来源类型 | 执行方式 | 并行 |
|---------|---------|------|
| `figma` | 子 Agent（只读 Task） | 多页并行 |
| `screenshot` | 子 Agent（只读 Task） | 多页并行 |
| `infer` | 主会话内联 | 串行 |

**Figma 子 Agent** 执行步骤：
1. 调用 `get_design_context(fileKey, nodeId, dirForAssetWrites: "/tmp/layout-{pageId}")`
2. 调用 `get_screenshot(fileKey, nodeId)`
3. 提取：主要区域（名称+排列）、布局模式（Flex/Grid）、关键尺寸、响应式断点、关键组件类型
4. 只输出 `LayoutAnchor` JSON

**截图子 Agent** 执行步骤：
1. 读取截图，识别视觉区域
2. 尺寸用比例估算（非精确像素），响应式标记 `unknown`
3. 只输出 `LayoutAnchor` JSON

**LayoutAnchor 结构**：

```json
{
  "pageId": "DashboardPage",
  "regions": [
    { "name": "Header", "layout": "flex-row", "height": "64px" },
    { "name": "Sidebar", "layout": "flex-column", "width": "280px" },
    { "name": "Content", "layout": "grid-3col", "gap": "24px" }
  ],
  "dimensions": { "maxWidth": "1440px", "padding": "24px" },
  "responsive": { "breakpoint": "1024px", "behavior": "collapse-sidebar" },
  "keyComponents": ["StatCard", "ChartPanel", "DataTable"],
  "sourceType": "figma"
}
```

**主会话回收**后合并为 Markdown 表格 Edit 写入 spec.md § 4.4.3：

```markdown
| 页面 | 变更 | 主要区域 | 布局模式 | 关键组件 | 来源 |
|------|------|---------|---------|---------|------|
| DashboardPage | new | Header + Sidebar(280px) + Content(grid-3col) | Flex | StatCard, ChartPanel | Figma |
```

**降级**：子 Agent 超时/失败 → 降为 infer，不阻塞主流程。

## 与 figma-ui 的关系

Step 4.D 只做**布局级别识别**（区域划分、尺寸锚点），不做像素级还原。执行阶段的像素级还原仍由 `figma-ui` skill 完整负责。
