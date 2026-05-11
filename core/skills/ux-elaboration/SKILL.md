---
name: ux-elaboration
description: "Use when 用户说「补充前端设计」「UX 深化」「页面流程图」「布局提取」「补 §4.4」, or workflow-spec Step 5 确认需要前端设计深化, or 已有 Spec 需要补充 User Flow / Page Hierarchy / Layout Anchors。与 figma-ui 的区别：本 skill 产出布局级锚点写入 Spec §4.4，figma-ui 负责执行阶段像素级还原。"
---

# ux-elaboration

> 前端设计深化——在已有 Spec §4.1-4.3 基础上生成 §4.4 UX & UI Design。

<HARD-GATE>
1. 必须有已扩写的 Spec（含 §4.1-4.3）作为输入
2. 子 Agent 只输出 LayoutAnchor JSON，不写项目文件
3. 布局提取只做区域级别识别，不做像素级还原
</HARD-GATE>

## Checklist

1. ☐ 定位 Spec 文件 + 验证前置章节
2. ☐ § 4.4.1 User Flow（Mermaid 流程图）
3. ☐ § 4.4.2 Page Hierarchy（页面层级表）
4. ☐ 设计稿关联（收集 DesignSourceMap）
5. ☐ § 4.4.3 Page Layout Summary（子 Agent 提取布局锚点）
6. ☐ Self-Review（UX 一致性检查）

---

## Step 1: 定位 Spec + 验证前置

**输入来源**（按优先级）：
1. 活跃 workflow → 读取 `workflow-state.json` 中的 `spec_file`
2. 用户指定路径 → `/ux-elaboration path/to/spec.md`
3. 无参数 → 搜索 `~/.claude/workflows/{projectId}/specs/` 下最新 spec

**验证**：
- §4.1 Primary Flow 非空（推导 User Flow 的依据）
- §5.1 Module Responsibilities 非空（确认 module 划分）
- §4.4 章节为空或仅含模板占位（避免覆盖已有内容）

验证失败 → 告知用户缺少前置内容，建议先完成 Spec 核心章节。

## Step 2: § 4.4.1 User Flow

主会话生成 Mermaid 用户操作流程图，≥ 3 个场景：

| 场景 | 必须覆盖 |
|------|---------|
| 首次使用 | 新用户引导路径、空状态处理 |
| 核心操作 | 入口到完成核心功能 |
| 异常/边界 | 操作失败、数据为空、权限不足 |

Edit 写入 spec.md § 4.4.1。

## Step 3: § 4.4.2 Page Hierarchy

填写页面层级表，L0 模块不超过 4 个。

输出格式：

```markdown
| 层级 | 模块 | 页面 | 变更类型 | 说明 |
|------|------|------|---------|------|
| L0 | Dashboard | DashboardPage | new | 数据概览 |
| L1 | Dashboard | DetailPanel | new | 详情面板 |
```

Edit 写入 spec.md § 4.4.2。

## Step 4: 设计稿关联

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

## Step 5: § 4.4.3 布局锚点提取

**关键原则**：布局提取涉及大量设计数据，**不在主会话执行**——通过子 Agent 隔离。

| 来源类型 | 执行方式 | 并行 |
|---------|---------|------|
| `figma` | 子 Agent（只读 Task） | 多页并行 |
| `screenshot` | 子 Agent（只读 Task） | 多页并行 |
| `infer` | 主会话内联 | 串行 |

### Figma 子 Agent 步骤

1. 调用 `get_design_context(fileKey, nodeId, dirForAssetWrites: "/tmp/layout-{pageId}")`
2. 调用 `get_screenshot(fileKey, nodeId)`
3. 提取：主要区域（名称+排列）、布局模式（Flex/Grid）、关键尺寸、响应式断点、关键组件类型
4. 只输出 `LayoutAnchor` JSON

### 截图子 Agent 步骤

1. 读取截图，识别视觉区域
2. 尺寸用比例估算（非精确像素），响应式标记 `unknown`
3. 只输出 `LayoutAnchor` JSON

### LayoutAnchor 结构

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

### 主会话回收

合并为 Markdown 表格 Edit 写入 spec.md § 4.4.3：

```markdown
| 页面 | 变更 | 主要区域 | 布局模式 | 关键组件 | 来源 |
|------|------|---------|---------|---------|------|
| DashboardPage | new | Header + Sidebar(280px) + Content(grid-3col) | Flex | StatCard, ChartPanel | Figma |
```

### 降级

子 Agent 超时/失败 → 降为 infer，不阻塞主流程。

## Step 6: Self-Review（UX 一致性）

设计深化完成后立即执行，发现问题直接修复：

- **流程完整性** — User Flow 每个步骤在 § 4.1-4.3 有对应描述
- **场景覆盖** — flowchart scenarios ≥ 3（首次使用、核心操作、异常/边界）
- **层级约束** — L0 module ≤ 4 个
- **布局对齐** — § 4.4.3 Page Layout 与 § 4.4.2 Page Hierarchy 页面一一对应
- **与架构一致** — § 4.4 涉及的页面在 § 6 File Structure 有对应文件

---

## 与其他 skill 的关系

| skill | 关系 |
|-------|------|
| `workflow-spec` | 上游调用方；Step 5 确认需要前端深化后委托本 skill |
| `figma-ui` | 下游消费方；执行阶段按 § 4.4.3 布局锚点做像素级还原 |
| `system-design` | 平行 skill；后端设计深化独立执行 |
