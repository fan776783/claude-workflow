---
name: figma-ui
description: "Implements UI from a Figma node. Use when given a Figma URL, asked to restore a design draft, or asked to turn a Figma frame into production code."
---
# Figma UI 实现工作流

默认主路径：先完成设计获取与资源分诊，再编码，最后用视觉审查结果决定是否允许交付。
⚠️ 不要绕开本 skill 直接裸调 `mcp__figma-mcp`。本 skill 负责处理 `assetsDir`、临时目录、资源分诊和交付门禁。

---

## 执行铁律
- 未完成 Phase A 并产出 `ElementManifest`、`AssetPlan`、`newlyDownloadedFiles` 之前，不得开始编码。
- `AssetPlan` 中只要存在 `refetch-parent`，就必须先回退到父节点重取资源，不得继续实现。
- 未完成 Visual Review 并拿到结构化审查结果前，不得宣称完成、通过或可交付。
- `visualFidelity < 90` 时，不得按“已完成”收口；优先修复，再重新审查。
- 修复循环最多 3 轮；超过 3 轮仍未过线时，停止推进并请求用户判断。
- `figma-ui` 默认由当前模型直接实现与审查，不调用外部模型代写 UI。

---

## Entry Gate
进入本 skill 后，先完成下面 4 件事，再进入 Phase A：
1. 解析 Figma URL 或确认当前选中节点，拿到 `nodeId`
2. 解析 `assetsDir`
3. 创建当前任务临时目录 `assetsDir/.figma-ui/tmp/${taskId}`
4. 准备 `get_design_context` 所需参数，尤其是 `dirForAssetWrites`

在 Entry Gate 完成前，禁止发生以下行为：
- 直接开始写组件或样式
- 提前决定正式资源目录结构
- 直接引用旧资源或其他目录下的现成文件
- 跳过 `dirForAssetWrites` 去裸调 MCP

---

## 关键门禁
| 约束 | 要求 |
|------|------|
| **assetsDir 必传** | 调用 `get_design_context` 前必须先获取 |
| **Asset Triage 前置** | `get_design_context` 之后先分诊资源，再开始编码 |
| **视觉优先** | 像素级还原设计稿，不做"优化" |
| **截图按需** | `figma-ui` 不主动把 `get_screenshot` 作为常规主流程 |
| **Visual Review** | 验证阶段必须执行视觉审查，不可跳过 |
| **还原度门控** | `visualFidelity ≥ 90` 才能交付 |

参考文档：
- [figma-tools.md](references/figma-tools.md) - MCP 工具速查
- [visual-review.md](references/visual-review.md) - 视觉审查维度
- [troubleshooting.md](references/troubleshooting.md) - 故障排查

---

## Phase A: 设计获取 + 资源分诊
### 输入
- Figma URL 或当前选中节点
- `assetsDir`
- 当前任务 `taskId`

### 目标
把“这次设计实际下载了什么资源、哪些资源可以进入实现、哪些资源必须回退重取”在编码前全部定清楚。没有完成这个阶段时，不得进入 Phase B。

### A.1 解析 URL
从 `https://figma.com/design/:fileKey/:fileName?node-id=1-2` 提取：
- `nodeId`: `node-id` 参数（`1-2` 在 MCP 调用时转为 `1:2`）

无 URL 时使用 Figma 桌面端当前选中节点。

### A.2 获取 assetsDir
```typescript
// 1. 尝试读取缓存
const uiConfig = await readJson('.claude/config/ui-config.json');
if (uiConfig?.assetsDir) return uiConfig.assetsDir;

// 2. 缓存未命中 → 使用默认值或询问用户
return 'public/images';
```

### A.3 调用 Figma MCP
```typescript
const taskAssetsDir = `${assetsDir}/.figma-ui/tmp/${taskId}`;
await Bash({ command: `mkdir -p "${taskAssetsDir}"` });

const beforeFiles = await listFiles(taskAssetsDir);
const designContext = await mcp__figma-mcp__get_design_context({
  nodeId,
  dirForAssetWrites: taskAssetsDir,
});
const afterFiles = await listFiles(taskAssetsDir);
const newlyDownloadedFiles = diffFiles(beforeFiles, afterFiles);

// ⚠️ 不主动调用 get_screenshot
// 如需截图，仅作为人工排查或本地比对的辅助手段
```
目录职责：
- `assetsDir/.figma-ui/tmp/${taskId}`：当前任务的原始下载与分诊工作区

### A.4 提取 ElementManifest
遍历 `designContext`，按类型分类：

| 类型 | 优先级 | 说明 |
|------|--------|------|
| 容器/布局 | P0 | 核心结构 |
| 文本/按钮/输入框 | P0 | 交互元素 |
| 图片/图标 | P1 | 视觉元素 |
| 装饰图形/分隔线 | P2 | 可选元素 |

输出：`ElementManifest` 作为覆盖率 checklist。

### A.5 执行 Asset Triage
在编码前完成资源判断，避免把“是否需要资源”“如何命名”“哪些文件应清理”拖到流程末尾。
```typescript
const assetMapping = newlyDownloadedFiles.map(file => ({
  originalFile: file,
  decision: 'pending',
  sourceNode: nodeId,
  sourceLayer: inferLayerName(file),
}));
```
分诊目标：
1. 明确本次 `get_design_context` 实际下载了哪些文件
2. 判断哪些资源真的需要保留
3. 先完成分组和命名，再开始编码
4. 明确哪些文件属于当前任务、哪些可在收口时删除

### A.6 产出 AssetPlan
`AssetPlan` 至少包含：

| 字段 | 说明 |
|------|------|
| `sourceNode` | 来源节点 ID |
| `sourceLayer` | 来源图层 / 语义元素 |
| `originalFile` | 本次下载的原始文件名 |
| `decision` | `inline` / `promote` / `discard` / `refetch-parent` |
| `group` | 资源分组，如 `hero` / `empty-state` / `icon` |
| `targetName` | 进入正式目录前的语义化文件名 |
| `targetDir` | 目标目录（位于 `assetsDir` 下） |

决策矩阵：

| 场景 | 决策 | 说明 |
|------|------|------|
| 纯布局 / 文本 / 简单边框 / 简单渐变 | `inline` | 直接代码实现，不保留资源 |
| 复杂插画 / 位图 / 照片 | `promote` | 纳入正式资源计划 |
| 明显无用或重复下载 | `discard` | 仅视为本次任务临时文件 |
| 疑似错误粒度的子图层导出 | `refetch-parent` | 停止编码，先导出父节点 |

命名原则：
- 先语义化，再编码引用
- 避免把 hash 文件名直接带入正式目录
- 推荐模式：`{feature}-{role}.{ext}`

### A.7 复合图形识别（前置强制检查）
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

### 必需产物
- `ElementManifest`
- `AssetPlan`
- `newlyDownloadedFiles`
- `assetMapping`

### Phase A 禁止项
- 还没完成 `AssetPlan` 就开始写组件
- 把 hash 文件名直接当正式资源名
- 遇到复合图形还继续按子图层拼接实现
- 用“先做页面后面再整理资源”的方式跳过分诊

### Phase A 放行条件
只有同时满足以下条件，才允许进入 Phase B：
- `ElementManifest` 已生成，且 P0 / P1 元素已可用于后续覆盖率检查
- `newlyDownloadedFiles` 已锁定为“本次任务实际下载文件”
- `AssetPlan` 中每个下载文件都有明确决策：`inline` / `promote` / `discard` / `refetch-parent`
- 不存在未处理的 `refetch-parent`

---

## Phase B: 编码
**⚠️ 不调用外部模型，当前模型直接编码**

### 输入
- Phase A 的 `ElementManifest`
- Phase A 的 `AssetPlan`
- 已完成分诊的设计上下文

### 编码规范
| 规范 | 说明 |
|------|------|
| **视觉优先** | 像素级还原，不做主观"优化" |
| **保留原值** | 使用 Figma 原始值 + CSS 变量 fallback |
| **最小包装** | 避免不必要的组件包装层 |
| **Mock 数据** | 使用设计稿原文，跳过 i18n |

### 样式策略
```css
/* ✅ 推荐：保留原值 + fallback */
background: var(--fill-light-02, rgba(194, 204, 241, 0.08));
border-radius: 16px;
padding: 32px 24px 24px;

/* ❌ 避免：强制映射到可能不准确的 Token */
background: var(--fills-light-8);  /* 映射可能有偏差 */
```

### 组件复用判断
```text
现有组件完全匹配设计 → 复用
需要大量覆盖样式 → 新建（避免样式冲突）
```

### 资源消费约束
编码阶段只允许消费两类结果：
1. `AssetPlan.decision = inline`：直接用代码表达
2. `AssetPlan.decision = promote`：引用已分组、已命名的计划资源

不要在编码阶段再做这些事：
- 临时决定是否保留某个下载文件
- 直接引用 hash 文件名作为正式资源名
- 从 `.figma-ui/tmp/${taskId}` 之外的目录“借用”资源
- 带着 `refetch-parent` 状态的资源继续编码

### 编码收口
编码完成后，只提升 `AssetPlan.decision = promote` 的资源到正式目录。
```typescript
for (const asset of assetPlan.filter(a => a.decision === 'promote')) {
  const targetDir = resolveUnder(assetsDir, asset.targetDir);
  await ensureDir(targetDir);
  await moveFile(
    `${taskAssetsDir}/${asset.originalFile}`,
    `${targetDir}/${asset.targetName}`
  );
}
```
收口规则：
- 最终目录只接收 `AssetPlan` 中明确登记的资源
- `discard` 与未纳入计划的本次下载文件，仍视为当前任务临时文件
- 清理应围绕“本次下载文件 + AssetPlan”执行，不再依赖后置 `usedAssets` 猜测

### Phase B 放行条件
只有同时满足以下条件，才允许进入 Phase C：
- P0 / P1 元素已经在实现中出现，可进入覆盖率检查
- 正式资源目录只接收 `promote` 资源
- 临时目录中未被提升的文件仍保持任务态，不混入正式交付目录
- 实现中没有遗留 hash 文件名、未闭合资源决策或 `refetch-parent` 残留状态

---

## Phase C: 验证 + 修复（核心价值）
### 输入
- Phase B 的最终实现代码
- `ElementManifest`
- `AssetPlan`
- `get_design_context` 返回的结构化设计信息

### C.1 覆盖率检查
对照 `ElementManifest`，确保 P0/P1 元素 100% 实现。
```typescript
const missing = elementManifest.elements.filter(
  e => e.priority !== 'P2' && e.status === 'pending'
);
if (missing.length > 0) {
  // 返回 Phase B 补充实现
}
```

### C.2 Visual Review（⛔ 必须执行）
当前模型按以下 JSON 格式自行审查 UI 实现与设计稿的视觉一致性。

审查内容：
- 设计参考：`get_design_context` 返回的结构化设计信息
- 实现代码：组件代码

返回 JSON：
```json
{
  "visualFidelity": {
    "score": "0-100",
    "issues": [
      {
        "element": "元素名称",
        "category": "spacing|color|typography|layout|border|shadow",
        "expected": "设计稿值",
        "actual": "实现值",
        "severity": "P0|P1|P2",
        "suggestion": "修复建议"
      }
    ]
  },
  "accessibility": {
    "score": "0-100",
    "issues": []
  },
  "codeQuality": {
    "score": "0-100",
    "issues": []
  },
  "overall": "0-100"
}
```

审查重点（按权重排序）：
1. 视觉还原度 (60%)：间距、颜色、字体、布局、边框、阴影
2. 可访问性 (25%)：语义标签、ARIA、键盘支持
3. 代码质量 (15%)：结构清晰、样式隔离

### C.3 修复循环
```text
visualFidelity < 90 → 修复视觉问题（优先）
accessibility < 70 → 修复可访问性
最多 3 轮，超过请求用户指导
```
修复优先级：
1. P0 视觉问题（布局错位、颜色明显偏差）
2. P1 视觉问题（间距微调、字体细节）
3. P0 可访问性（缺少语义标签）
4. 其他问题

### C.4 交付决策
| 条件 | 决策 |
|------|------|
| `visualFidelity ≥ 90` | ✅ 通过 |
| `visualFidelity ≥ 80` | ⚠️ 需人工审查 |
| `visualFidelity < 80` | ❌ 请求指导 |

### Phase C 禁止项
- 只凭“看起来差不多”就跳过结构化审查
- `visualFidelity < 90` 仍按“已完成”收口
- 审查结果缺少问题列表，却直接进入交付摘要
- 审查未执行完，就先声明通过

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
│ Visual Review│ visualFidelity: XX/100                     │
│ Accessibility│ XX/100                                     │
│ Overall      │ XX/100                                     │
├──────────────┼────────────────────────────────────────────┤
│ 临时目录     │ ✅ 当前任务临时资源已收口                  │
└──────────────┴────────────────────────────────────────────┘
```

### Phase C 放行条件
只有同时满足以下条件，才允许给出“通过 / 已完成 / 可交付”结论：
- 覆盖率检查已完成，P0 / P1 元素无遗漏
- Visual Review 已输出结构化 JSON
- `visualFidelity ≥ 90`
- 若曾进入修复循环，当前轮次已重新审查并得到最新结果

### C.6 可选：人工截图排查
当 Visual Review 仍无法解释问题时，可选地手工获取截图做人工比对，但这不是独立 skill，也不属于常规交付路径。
```text
可选场景：
- 需要人工核对复杂阴影、渐变、模糊效果
- 需要在本地对比实现页面与设计稿截图
- 需要进一步确认某个元素是否应该保留为资源
```
说明：
- `figma-ui` 默认交付路径到 Visual Review / 修复循环即结束
- 如需截图，`get_screenshot` 仅作为排查辅助手段

---

## Red Flags
如果出现下面这些念头，说明正在偏离流程，应立即回到对应阶段：
- “先把页面写出来，AssetPlan 后面再补。” → 回到 Phase A
- “这个复合图形先用几个 SVG 拼一下。” → 回到 Phase A，执行 `refetch-parent`
- “先引用 hash 文件名，最后再统一改。” → 回到 Phase A 或 Phase B 资源命名步骤
- “目测已经很像了，不必正式做 Visual Review。” → 回到 Phase C
- “先说完成，回头再补审查结果。” → 回到 Phase C
- “这次赶时间，先把低于 90 的版本交掉。” → 停在 Phase C，按门控处理

---

## Exit Criteria
满足以下条件后，才允许把任务表述为“已完成”或“可交付”：
- `ElementManifest`、`AssetPlan`、`newlyDownloadedFiles` 都已产出并用于实现
- 不存在未解决的 `refetch-parent`
- 正式资源目录只包含 `promote` 资源
- 已完成结构化 Visual Review
- `visualFidelity ≥ 90`
- 已给出交付摘要，说明资源收口与审查结果

任何一项不满足，都只能报告当前状态，不能使用完成态措辞。

---

## 降级方案
### 审查不可用时
当前模型按相同 JSON 格式自行审查，交付摘要注明：
```text
Visual Review: visualFidelity: XX/100
```

### 复杂页面
对于复杂页面（多个独立区块），可分块实现：
1. `get_metadata` 获取结构概览
2. 按区块分别 `get_design_context`
3. 各区块独立执行 Asset Triage
4. 分块编码 + 分块验证

---

## 快速参考
### MCP 必传参数
| 工具 | 必传参数 |
|------|----------|
| `get_design_context` | `nodeId`, `dirForAssetWrites` |
| `get_screenshot` | `nodeId`（不属于常规主流程，仅在人工排查时按需使用） |
| `get_metadata` | `nodeId` |

### 流程图
```text
Phase A: 设计获取 + 资源分诊
    │
    ├─ 解析 URL → nodeId
    ├─ 获取 assetsDir
    ├─ get_design_context（不主动 get_screenshot）
    ├─ 提取 ElementManifest
    ├─ file-list-diff → newlyDownloadedFiles
    ├─ Asset Triage → AssetPlan / assetMapping
    └─ 必要时 refetch parent
    │
Phase B: 编码
    │
    ├─ 遵循编码规范
    ├─ 保留 Figma 原始值
    ├─ 只消费 inline / promote 资源
    └─ 按 AssetPlan 收口正式资源
    │
Phase C: 验证 + 修复
    │
    ├─ 覆盖率检查
    ├─ Visual Review ← 核心价值
    ├─ 修复循环（最多 3 轮）
    ├─ 交付决策 + 摘要
    └─ [可选] 人工截图排查
```

### 故障排查
见 [troubleshooting.md](references/troubleshooting.md)
