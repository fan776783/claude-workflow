---
name: figma-ui
description: |
  Figma 设计稿到生产代码的工作流，专注视觉还原度验证。
  触发条件：Figma URL (figma.com/design/...)、设计稿/还原/切图/UI实现 等关键词。
  ⚠️ 不要直接调用 mcp__figma-mcp 工具 - 本 skill 会处理 assetsDir 等必传参数。
---

# Figma UI 实现工作流

轻量 3 阶段：设计获取 → 自由编码 → 验证修复

**核心理念**：Skill 是**质量守门人**，不是过程控制者。编码阶段给予最大自由度，验证阶段严格把关。

---

## 关键约束

| 约束 | 要求 |
|------|------|
| **assetsDir 必传** | 调用 `get_design_context` 前必须先获取 |
| **视觉优先** | 像素级还原设计稿，不做"优化" |
| **Gemini Review** | 验证阶段必须调用，不可跳过 |
| **还原度门控** | visualFidelity ≥ 85 才能交付 |

**参考文档**：
- [figma-tools.md](references/figma-tools.md) - MCP 工具速查
- [visual-review.md](references/visual-review.md) - 视觉审查维度
- [troubleshooting.md](references/troubleshooting.md) - 故障排查

---

## Phase A: 设计获取

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

const designContext = await mcp__figma-mcp__get_design_context({
  nodeId,
  dirForAssetWrites: taskAssetsDir,  // ⚠️ 必传
});

// 获取视觉参考
await mcp__figma-mcp__get_screenshot({ nodeId });
```

### A.4 提取 ElementManifest

遍历 designContext，按类型分类：

| 类型 | 优先级 | 说明 |
|------|--------|------|
| 容器/布局 | P0 | 核心结构 |
| 文本/按钮/输入框 | P0 | 交互元素 |
| 图片/图标 | P1 | 视觉元素 |
| 装饰图形/分隔线 | P2 | 可选元素 |

**输出**：ElementManifest 作为验证 checklist。

---

## Phase B: 编码

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

```
现有组件完全匹配设计 → 复用
需要大量覆盖样式 → 新建（避免样式冲突）
```

### 资源处理

```typescript
// 1. 编码完成后，移动已使用资源到正式目录
for (const asset of usedAssets) {
  await moveFile(
    `${figmaTmpDir}/${asset}`,
    `${assetsDir}/${componentName}/${asset}`
  );
}

// 2. 清理 Figma 临时目录
await Bash({ command: `rm -rf "${figmaTmpDir}"` });
```

**⚠️ 不调用外部模型，当前模型直接编码**

---

## Phase C: 验证 + 修复（核心价值）

### C.1 覆盖率检查

对照 ElementManifest，确保 P0/P1 元素 100% 实现。

```typescript
const missing = elementManifest.elements.filter(
  e => e.priority !== 'P2' && e.status === 'pending'
);
if (missing.length > 0) {
  // 返回 Phase B 补充实现
}
```

### C.2 Gemini Visual Review（⛔ 必须调用）

```bash
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/reviewer.md

审查 UI 实现与设计稿的视觉一致性。

设计参考：[附上 get_screenshot 获取的截图]
实现代码：[附上组件代码]

返回 JSON：
{
  "visualFidelity": {
    "score": 0-100,
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
    "score": 0-100,
    "issues": [...]
  },
  "codeQuality": {
    "score": 0-100,
    "issues": [...]
  },
  "overall": 0-100
}
EOF
```

**审查重点**（按权重排序）：
1. **视觉还原度 (60%)**：间距、颜色、字体、布局、边框、阴影
2. **可访问性 (25%)**：语义标签、ARIA、键盘支持
3. **代码质量 (15%)**：结构清晰、样式隔离

### C.3 修复循环

```
visualFidelity < 85 → 修复视觉问题（优先）
accessibility < 70 → 修复可访问性
最多 3 轮，超过请求用户指导
```

**修复优先级**：
1. P0 视觉问题（布局错位、颜色明显偏差）
2. P1 视觉问题（间距微调、字体细节）
3. P0 可访问性（缺少语义标签）
4. 其他问题

### C.4 交付决策

| 条件 | 决策 |
|------|------|
| visualFidelity ≥ 85 | ✅ 通过 |
| visualFidelity ≥ 75 | ⚠️ 需人工审查 |
| visualFidelity < 75 | ❌ 请求指导 |

### C.5 交付摘要

```
┌──────────────┬─────────────────────────────────────┐
│     项目     │                内容                 │
├──────────────┼─────────────────────────────────────┤
│ 新建文件     │ components/xxx/ComponentName.vue    │
│ 修改文件     │ pages/test/index.vue（添加入口）    │
│ 资源目录     │ public/images/xxx/                  │
├──────────────┼─────────────────────────────────────┤
│ Visual Review│ Gemini visualFidelity: XX/100       │
│ Accessibility│ XX/100                              │
│ Overall      │ XX/100                              │
├──────────────┼─────────────────────────────────────┤
│ 清理状态     │ ✅ Figma 临时资源已清理             │
└──────────────┴─────────────────────────────────────┘
```

### C.6 可选：像素级对比验证

交付摘要输出后，**询问用户**是否需要进行像素级对比验证：

```
是否需要运行 visual-diff 进行像素级对比验证？
- 需要启动开发服务器并提供测试页面 URL
- 将截图实现页面与设计稿进行叠加对比
- 输出差异图片 + 双模型验证报告

选项：
1. 运行 visual-diff（需提供页面 URL）
2. 跳过，直接完成
```

**用户选择运行时**：
```typescript
// 调用 visual-diff skill
// 设计稿截图已缓存在 .claude/cache/figma-ui/{nodeId}/design.png
await visualDiff({
  url: userProvidedUrl,  // 用户提供的测试页面 URL
  design: designScreenshotPath,
  selector: componentSelector  // 可选
});
```

**输出**：差异图片 + 综合报告（像素差异 + Gemini + Claude 双模型验证）

---

## 降级方案

### Gemini 不可用时

当前模型按相同 JSON 格式自行审查，交付摘要注明：
```
Visual Review: 降级 visualFidelity: XX/100 (原因: Gemini 超时)
```

### 复杂页面

对于复杂页面（多个独立区块），可分块实现：
1. `get_metadata` 获取结构概览
2. 按区块分别 `get_design_context`
3. 分块编码 + 分块验证

---

## 快速参考

### MCP 必传参数

| 工具 | 必传参数 |
|------|----------|
| `get_design_context` | `nodeId`, `dirForAssetWrites` |
| `get_screenshot` | `nodeId` |
| `get_metadata` | `nodeId` |

### 流程图

```
Phase A: 设计获取
    │
    ├─ 解析 URL → nodeId
    ├─ 获取 assetsDir
    ├─ get_design_context + get_screenshot
    └─ 提取 ElementManifest
    │
Phase B: 编码（自由发挥）
    │
    ├─ 遵循编码规范
    ├─ 保留 Figma 原始值
    └─ 清理临时资源
    │
Phase C: 验证 + 修复
    │
    ├─ 覆盖率检查
    ├─ Gemini Visual Review ← 核心价值
    ├─ 修复循环（最多 3 轮）
    ├─ 交付决策 + 摘要
    │
    └─ [可选] 询问用户 → 运行 visual-diff？
                            │
                            ├─ 是 → 像素级对比 + 双模型验证
                            └─ 否 → 完成
```

### 故障排查

见 [troubleshooting.md](references/troubleshooting.md)
