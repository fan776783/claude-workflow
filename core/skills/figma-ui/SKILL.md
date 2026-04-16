---
name: figma-ui
description: "Implements UI from a Figma node with 1:1 visual fidelity. Use when given a Figma URL, asked to implement/restore a design, turn a Figma frame into production code, build components matching Figma specs, or when user says things like '还原设计稿', '照着 Figma 写', 'convert this design to code'. For Figma canvas operations (create/edit/delete nodes), switch to figma-use skill."
---
# Figma UI 实现工作流

默认主路径：先完成设计获取与资源分诊，再编码，最后用视觉审查结果决定是否允许交付。
⚠️ 不要绕开本 skill 直接裸调 `mcp__figma-mcp`。本 skill 负责处理 `assetsDir`、临时目录、资源分诊和交付门禁。

---

## Skill Boundaries

- 本 skill 的交付物是**用户仓库中的代码**。当 Figma URL 或设计稿被要求转为组件、页面或模块代码时使用。
- 如需在 Figma 画布上创建 / 编辑 / 删除节点，切换到 `figma-use` skill。
- 如需从代码或描述生成完整页面设计稿，切换到 `figma-generate-design` skill。
- 如需生成 Code Connect 映射，切换到 `figma-code-connect` skill。
- 如需生成 design system 规则（CLAUDE.md / AGENTS.md），切换到 `figma-create-design-system-rules` skill。

---

## Core Rules

每条规则附带理由，帮助在边界情况下自行判断。

- **先分诊再编码**：`get_design_context` 返回后先完成 Asset Triage，再写组件。跳过这步容易把临时 hash 文件名带进正式目录，后续无法追溯来源。
- **refetch-parent 阻断**：AssetPlan 中存在 `refetch-parent` 时必须先回退重取。直接用子图层拼接复合图形会导致 CSS 定位脆弱、维护困难。
- **promote-only 到正式目录**：正式资源目录只接收 AssetPlan 中 `promote` 的资源。防止临时文件和 hash 文件名污染项目资源。
- **视觉优先**：尽量精确还原设计稿，不做主观"优化"。当项目令牌与 Figma 值冲突时，优先使用项目令牌保持一致性，但微调间距/尺寸来维持视觉还原度。
- **assetsDir + dirForAssetWrites 必传**：调用 `get_design_context` 前必须准备好。缺少这个参数会导致资源下载到不可预期的位置。
- **审查后交付**：未完成 Visual Review 不宣称完成。自检是发现间距/颜色偏差的最后一道关卡。
- **P0 问题阻断交付**：审查后仍有 P0 问题时不按"已完成"收口。P0 表示布局错位或颜色明显偏差，用户一眼能看出来。
- **修复上限 3 轮**：超过 3 轮仍有 P0 时停止推进并请求用户判断。避免无限循环消耗 token。
- **当前模型直接实现**：不调用外部模型代写 UI。保持实现与审查的一致性。

---

## Prerequisites
- Figma MCP server 已连接并可访问
- 用户提供 Figma URL（格式 `https://figma.com/design/:fileKey/:fileName?node-id=1-2`），或使用 Figma 桌面端当前选中节点
- 项目有现成的设计系统或组件库（推荐，非必须）

参考文档：
- [figma-tools.md](references/figma-tools.md) - MCP 工具速查
- [visual-review.md](references/visual-review.md) - 视觉审查维度
- [troubleshooting.md](references/troubleshooting.md) - 故障排查

---

## Phase A: 设计获取 + 资源分诊

### 目标
把"这次设计实际下载了什么资源、哪些可以进入实现、哪些必须回退重取"在编码前全部定清楚。

### A.1 解析 URL
从 `https://figma.com/design/:fileKey/:fileName?node-id=1-2` 提取：
- `fileKey`: `/design/` 之后的路径段
- `nodeId`: `node-id` 查询参数（`1-2` 在 MCP 调用时转为 `1:2`）

无 URL 时使用 Figma 桌面端当前选中节点（桌面端 MCP 自动使用当前打开文件，无需 `fileKey`）。

示例：
- URL: `https://figma.com/design/kL9xQn2VwM8pYrTb4ZcHjF/DesignSystem?node-id=42-15`
- fileKey: `kL9xQn2VwM8pYrTb4ZcHjF`
- nodeId: `42-15`（MCP 调用时用 `42:15`）

### A.2 获取 assetsDir
检查 `.claude/config/ui-config.json` 中的 `assetsDir` 字段。未找到则默认 `public/images` 或询问用户。

### A.3 调用 Figma MCP
1. 创建任务临时目录 `${assetsDir}/.figma-ui/tmp/${taskId}`
2. 记录目录中已有的文件列表
3. 调用 MCP：
   ```
   get_design_context(fileKey, nodeId, dirForAssetWrites: taskAssetsDir)
   ```
4. 再次列出目录文件，与步骤 2 的列表做差集，得到 `newlyDownloadedFiles`

目录职责：`assetsDir/.figma-ui/tmp/${taskId}` 是当前任务的原始下载与分诊工作区。

**如果返回为空或被截断**（节点过于复杂）：
1. 调用 `get_metadata(fileKey, nodeId)` 获取节点结构概览
2. 从 metadata 中识别关键子节点
3. 按子节点分别调用 `get_design_context`

### A.4 获取视觉参考
```
get_screenshot(fileKey, nodeId)
```
截图作为整个实现过程中的视觉基准，用于 Phase B 编码对照和 Phase C 验证比对。

### A.5 提取 ElementManifest
遍历 `designContext`，按类型分类：

| 类型 | 优先级 | 说明 |
|------|--------|------|
| 容器/布局 | P0 | 核心结构 |
| 文本/按钮/输入框 | P0 | 交互元素 |
| 图片/图标 | P1 | 视觉元素 |
| 装饰图形/分隔线 | P2 | 可选元素 |

输出：`ElementManifest` 作为覆盖率 checklist。

### A.5.1 提取 Design Anchors（CHANGE_ARTIFACT 必做）

当任务是修改已有组件（而非从零新建）时，从设计数据中提取根容器及关键子容器的数值属性，记录为 `DesignAnchors`：

| 属性 | 示例 |
|------|------|
| width / height | `900px` / `720px` |
| padding | `32px 24px 24px` |
| border-radius | `16px` |
| 主要 gap | `16px` |

同时读取现有代码中对应的 CSS 值，一并记录。这组数据是 Phase C Anchor Verification 的比对基准。

提取 DesignAnchors 的目的：`get_design_context` 返回的数据量大，容器尺寸容易被淹没在代码建议和图层细节中。对于修改已有组件的任务，模型倾向于信任现有代码的结构性属性（宽高、圆角），只关注细节差异。显式提取并记录后，Phase C 有具体数字可以机械比对，不再依赖目测判断。

> ⚠️ 跳过这步直接进入编码，是 CHANGE_ARTIFACT 场景下最常见的尺寸还原失败根因。

### A.6 执行 Asset Triage
为每个新下载的文件标记初始状态 `pending`，结合文件名和来源节点推断其语义角色。

### A.7 产出 AssetPlan

**核心字段**（每个资源必须有）：

| 字段 | 说明 |
|------|------|
| `originalFile` | 本次下载的原始文件名 |
| `decision` | `inline` / `promote` / `discard` / `refetch-parent` |
| `targetName` | 语义化文件名（仅 `promote` 需要） |
| `targetDir` | 目标目录，位于 `assetsDir` 下（仅 `promote` 需要） |

**可选字段**（复杂页面推荐补充）：

| 字段 | 说明 |
|------|------|
| `sourceNode` | 来源节点 ID |
| `sourceLayer` | 来源图层 / 语义元素 |
| `group` | 资源分组，如 `hero` / `empty-state` / `icon` |

决策矩阵：

| 场景 | 决策 | 说明 |
|------|------|------|
| 纯布局 / 文本 / 简单边框 / 简单渐变 | `inline` | 直接代码实现，不保留资源 |
| 复杂插画 / 位图 / 照片 | `promote` | 纳入正式资源计划 |
| 明显无用或重复下载 | `discard` | 仅视为本次任务临时文件 |
| 疑似错误粒度的子图层导出 | `refetch-parent` | 停止编码，先导出父节点 |

命名原则：先语义化再编码引用，避免把 hash 文件名直接带入正式目录。推荐模式：`{feature}-{role}.{ext}`。

> ⚠️ 还没完成 AssetPlan 就开始写组件，是最常见的流程偏离。资源决策拖到后面处理时，hash 文件名很可能已经散落在代码各处。

资源处理规则：
- Figma MCP 返回的 `localhost` URL 直接使用，不转换
- 不引入新的图标包，所有资源来自 Figma
- 有 `localhost` 源时不使用占位符

### A.8 复合图形识别
当导出资源包含多个叠加图层时，说明误提取了子节点，应在进入编码前获取父节点作为完整图片。

识别特征：
- 多个 SVG 在同一位置叠加（背景 + 图标 + 装饰）
- 典型场景：空状态图、品牌图标、徽章、插画

处理方式：
1. 将当前子资源标记为 `refetch-parent`
2. 获取父 Frame 的 `nodeId`
3. 重新导出为单张图片
4. 更新 `AssetPlan`
5. 再进入编码

```text
设计稿结构：
├── EmptyState (Frame)     ← 应获取此节点
│   ├── blur-bg.svg        ✗ 误提取
│   ├── search-icon.svg    ✗ 误提取
│   └── stars.svg          ✗ 误提取

✅ 正确：导出 EmptyState 父节点为单张图片
❌ 错误：分别引用 3 个 SVG 并用 CSS 定位叠加
```

> ⚠️ 遇到复合图形时继续按子图层拼接是第二常见的偏离。拼接出来的结果在不同屏幕尺寸下容易错位。

---

## Phase B: 编码

### 输入
- Phase A 的 `ElementManifest`、`AssetPlan`、设计上下文、截图

### 项目适配原则
Figma MCP 输出通常是 React + Tailwind 格式，需转换为项目实际的框架和约定：
- 将 Tailwind 工具类替换为项目偏好的样式方案或设计令牌
- 复用项目现有组件（按钮、输入框、排版、图标包装器），不重复造轮子
- 使用项目的颜色体系、字体规范和间距令牌
- 遵循项目的路由、状态管理和数据获取模式

### 设计系统集成
| 场景 | 策略 |
|------|------|
| 项目组件完全匹配设计 | 直接复用 |
| 项目组件大致匹配，需微调 | 扩展现有组件，添加变体 |
| 需要大量覆盖样式 | 新建组件（避免样式冲突） |
| 项目无对应组件 | 按项目设计系统规范新建 |

设计令牌映射：
- 优先将 Figma 变量映射到项目已有的设计令牌
- 当项目令牌与 Figma 值冲突时，优先使用项目令牌，但微调间距/尺寸以保持视觉一致
- 无法映射时保留 Figma 原值 + CSS 变量 fallback

### 编码规范
| 规范 | 说明 |
|------|------|
| **视觉优先** | 像素级还原，不做主观"优化" |
| **保留原值** | 使用 Figma 原始值 + CSS 变量 fallback |
| **最小包装** | 避免不必要的组件包装层 |
| **Mock 数据** | 使用设计稿原文，跳过 i18n |

代码质量的详细检查标准见 [visual-review.md](references/visual-review.md#代码质量)。

### 样式策略
优先使用 Tailwind 工具类，保留 Figma 原始值。在 class 定义中使用 `@apply` 复用 Tailwind 类：
```html
<!-- ✅ 推荐：Tailwind 工具类 + Figma 原值 -->
<div class="bg-[rgba(194,204,241,0.08)] rounded-2xl pt-8 px-6 pb-6">

<!-- ✅ 有项目令牌时优先使用 -->
<div class="bg-fill-light-02 rounded-2xl pt-8 px-6 pb-6">

<!-- ❌ 避免：硬编码近似值 -->
<div class="bg-gray-900/10 rounded-xl p-6">
```
```css
/* ✅ 在 class 定义中用 @apply 复用 Tailwind */
.card-container {
  @apply bg-[rgba(194,204,241,0.08)] rounded-2xl pt-8 px-6 pb-6;
}

/* ❌ 避免：脱离 Tailwind 手写原始 CSS */
.card-container {
  background: rgba(194, 204, 241, 0.08);
  border-radius: 16px;
  padding: 32px 24px 24px;
}
```

### 资源消费约束
编码阶段只允许消费两类结果：
1. `AssetPlan.decision = inline`：直接用代码表达
2. `AssetPlan.decision = promote`：引用已分组、已命名的计划资源

不要在编码阶段临时决定资源去留、直接引用 hash 文件名或从任务目录外"借用"资源。

### 编码收口
编码完成后，只提升 `promote` 资源到正式目录：
1. 遍历 AssetPlan 中 `decision = promote` 的条目
2. 在 `assetsDir` 下创建 `targetDir`
3. 将 `originalFile` 移动并重命名为 `targetName`

---

## Phase C: 验证 + 修复
### 输入
- Phase B 的最终实现代码
- `ElementManifest`、`AssetPlan`、`DesignAnchors`（如有）、设计上下文、截图

### C.1 覆盖率检查
对照 `ElementManifest`，确保 P0/P1 元素已实现。有遗漏则返回 Phase B 补充。

### C.1.5 Anchor Verification（有 DesignAnchors 时必做）

逐条比对 `DesignAnchors` 中的设计值与代码中的实际值，输出比对表：

```text
| 属性           | 设计值              | 代码值              | 判定 |
|----------------|---------------------|---------------------|------|
| width          | 900px               | 880px               | ❌ P0 |
| height         | 720px               | (未设置)            | ❌ P0 |
| padding        | 32px 24px 24px      | 32px 24px 24px      | ✅    |
| border-radius  | 16px                | 16px                | ✅    |
```

width/height 不匹配直接标记为 P0；padding、border-radius、gap 等属性参照 visual-review.md 已有分级阈值判定 severity（如 padding 偏差 4-8px 为 P1，>8px 为 P0）。这一步是机械比对，不依赖截图目测，专门防止"看起来差不多但数值不对"的问题。

### C.2 Visual Review
对照设计数据和截图，审查实现与设计稿的视觉一致性。

输出**问题清单**，按严重程度分级：

| 严重程度 | 含义 | 交付影响 |
|----------|------|----------|
| **P0** | 布局错位、颜色明显偏差、关键元素缺失 | **必须修复才能交付** |
| **P1** | 间距微调（2-8px）、字体细节、透明度偏差 | 应修复，不阻塞交付 |
| **P2** | 装饰细节、可简化的样式、命名规范 | 建议修复 |

每个问题包含：元素名称、问题类别（spacing / color / typography / layout / border / shadow / accessibility）、设计稿值、实现值、修复建议。

审查重点：
1. 视觉还原度：间距、颜色、字体、布局、边框、阴影
2. 可访问性：语义标签、ARIA、键盘支持
3. 代码质量：结构清晰、样式隔离

### C.3 修复循环
```text
有 P0 问题 → 必须修复
有 P1 问题 → 应修复（每轮优先处理 P0，再处理 P1）
最多 3 轮，超过则请求用户指导
```

### C.4 交付决策
| 条件 | 决策 |
|------|------|
| 无 P0 问题 | ✅ 可交付 |
| 仅剩 P1 问题 | ⚠️ 可交付，摘要中列出未修复的 P1 |
| 仍有 P0 问题 | ❌ 不可交付，请求用户指导 |

### C.5 交付摘要
```text
┌──────────────┬────────────────────────────────────────────┐
│     项目     │                    内容                    │
├──────────────┼────────────────────────────────────────────┤
│ 新建文件     │ components/xxx/ComponentName.vue           │
│ 修改文件     │ pages/test/index.vue（添加入口）           │
│ 资源目录     │ public/images/xxx/                         │
│ AssetPlan    │ promote: N / inline: N / discard: N       │
├──────────────┼────────────────────────────────────────────┤
│ 审查结果     │ P0: 0 / P1: N / P2: N                    │
│ 未修复 P1    │ （如有，逐条列出）                         │
├──────────────┼────────────────────────────────────────────┤
│ 临时目录     │ ✅ 当前任务临时资源已收口                  │
└──────────────┴────────────────────────────────────────────┘
```

---

## Examples

### 示例 1：实现按钮组件

用户提供：`https://figma.com/design/kL9xQn2VwM8pYrTb4ZcHjF/DesignSystem?node-id=42-15`

执行流程：
1. 解析 URL → fileKey=`kL9xQn2VwM8pYrTb4ZcHjF`, nodeId=`42-15`
2. `get_design_context(fileKey, nodeId, dirForAssetWrites)` 获取按钮设计数据
3. `get_screenshot(fileKey, nodeId)` 获取视觉参考
4. 从 assets endpoint 下载按钮图标（如有）
5. 检查项目是否有现成按钮组件 → 有则扩展变体，无则按项目规范新建
6. 将 Figma 颜色映射到项目设计令牌（如 `primary-500`、`primary-hover`）
7. 对照截图验证 padding、border-radius、字体

结果：按钮组件与 Figma 设计一致，已集成到项目设计系统。

### 示例 2：实现 Dashboard 页面

用户提供：`https://figma.com/design/pR8mNv5KqXzGwY2JtCfL4D/Dashboard?node-id=10-5`

执行流程：
1. 解析 URL → fileKey=`pR8mNv5KqXzGwY2JtCfL4D`, nodeId=`10-5`
2. `get_metadata(fileKey, nodeId)` 获取页面结构概览
3. 识别主要区块（header、sidebar、content area、cards）及其子节点 ID
4. 按区块分别 `get_design_context` + Asset Triage
5. `get_screenshot(fileKey, nodeId)` 获取整页截图
6. 下载所有资源（logo、图标、图表），完成 AssetPlan
7. 使用项目布局原语搭建结构，尽量复用现有组件
8. 验证响应式行为，对照截图逐项检查

结果：完整 Dashboard 页面，资源已分诊收口，视觉审查通过。

---

## Best Practices

### 先获取上下文，再动手
不要基于假设实现。始终先调用 `get_design_context` 和 `get_screenshot`，拿到设计数据和视觉基准后再编码。

### 边做边验证
实现过程中频繁对照截图验证，不要等到最后才发现偏差。

### 复用优先于新建
编码前检查项目是否已有匹配的组件。跨代码库的一致性比精确复制 Figma 更重要。

### 设计系统优先
当 Figma 设计与项目设计系统有冲突时，优先遵循项目设计系统的模式。

### 记录偏差
如果因可访问性或技术约束必须偏离设计稿，在代码注释中说明原因。

---

## Red Flags
如果出现下面这些念头，说明正在偏离流程：
- "先把页面写出来，AssetPlan 后面再补。" → 回到 Phase A
- "这个复合图形先用几个 SVG 拼一下。" → 回到 Phase A，执行 `refetch-parent`
- "先引用 hash 文件名，最后再统一改。" → 回到资源命名步骤
- "目测已经很像了，不必做审查。" → 回到 Phase C
- "先说完成，回头再补审查结果。" → 回到 Phase C

---

## Exit Criteria
满足以下条件后，才允许把任务表述为"已完成"或"可交付"：
- 已完成视觉审查，无 P0 问题
- 若曾进入修复循环，修复后已重新审查并以最新结果判定
- 不存在未解决的 `refetch-parent`
- 正式资源目录只包含 `promote` 资源
- 已给出交付摘要

---

## 降级方案
### 复杂页面
对于复杂页面（多个独立区块），可分块实现：
1. `get_metadata` 获取结构概览
2. 按区块分别 `get_design_context`
3. 各区块独立执行 Asset Triage
4. 分块编码 + 分块验证

### 设计偏差处理
当项目设计令牌与 Figma 值不一致时：
- 优先使用项目令牌保持一致性
- 微调间距和尺寸以保持视觉还原度
- 在代码注释中记录偏差原因

---

## 快速参考
### MCP 参数
| 工具 | 必传参数 | 说明 |
|------|----------|------|
| `get_design_context` | `nodeId`, `dirForAssetWrites`; 远程 MCP 加传 `fileKey` | 获取结构化设计数据 + 下载资源 |
| `get_screenshot` | `nodeId`; 远程 MCP 加传 `fileKey` | 获取视觉参考截图 |
| `get_metadata` | `nodeId`; 远程 MCP 加传 `fileKey` | 获取节点结构概览（用于分块获取） |

### 流程图
```text
Phase A: 设计获取 + 资源分诊
    │
    ├─ A.1 解析 URL → fileKey + nodeId
    ├─ A.2 获取 assetsDir
    ├─ A.3 get_design_context（含资源下载）
    ├─ A.4 get_screenshot（视觉参考基准）
    ├─ A.5 提取 ElementManifest
    ├─ A.6 Asset Triage
    ├─ A.7 产出 AssetPlan
    └─ A.8 复合图形识别（必要时 refetch parent）
    │
Phase B: 编码
    │
    ├─ 项目适配（框架 + 设计系统 + 令牌映射）
    ├─ 遵循编码规范
    ├─ 保留 Figma 原始值
    ├─ 只消费 inline / promote 资源
    └─ 按 AssetPlan 收口正式资源
    │
Phase C: 验证 + 修复
    │
    ├─ 覆盖率检查
    ├─ Visual Review（对照截图 + 设计数据）
    ├─ 修复循环（最多 3 轮）
    └─ 交付决策 + 摘要
```

### 故障排查
见 [troubleshooting.md](references/troubleshooting.md)

---

## Additional Resources

- [Figma MCP Server Documentation](https://developers.figma.com/docs/figma-mcp-server/)
- [Figma MCP Server Tools and Prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- [Figma Variables and Design Tokens](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma)
