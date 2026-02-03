---
name: figma-ui
description: "Translate Figma designs into production-ready code with 1:1 visual fidelity using Figma MCP workflow (design context, screenshots, assets, project-convention translation) and dual-model collaboration (Gemini + Codex) with automated visual validation. Trigger when user provides Figma URLs or node IDs, mentions 还原/切图/设计稿/UI实现, or asks to implement UI from design. Requires Figma MCP server connection."
---

# Figma UI 实现工作流

Figma 设计稿到生产代码的 3 阶段工作流，采用双模型协作 + 自动化视觉验证。

---

## ⚠️ STRICT MODE - 必读

**你必须严格按 Phase A → B → C 的步骤顺序执行。**

| 约束 | 要求 |
|------|------|
| **顺序执行** | 每一步完成并验证后，才能进入下一步 |
| **禁止跳步** | 不得跳过任何步骤，即使认为"不需要" |
| **失败即停** | 步骤失败时必须修复或回退，不得绕过继续 |
| **断言检查** | 每个 Phase 结束时必须执行 CHECKPOINT，全部通过才能继续 |
| **依赖顺序** | A.2.1 必须在 A.2.2 之前完成（assetsDir 是后续步骤的依赖） |

**违反以上任一约束将导致最终交付失败。**

---

## 强制规则

| 规则 | 要求 |
|------|------|
| MCP 优先 | 先检查 Figma MCP 连接，失败则引导配置 |
| 元素追踪 | 提取 ElementManifest，追踪 P0/P1/P2 实现状态 |
| 复用优先 | 检查项目现有组件，扩展而非新建 |
| Token-First | 映射到 Design Token，禁止硬编码值 |
| 用户确认 | 展示 BuildPlan → "Shall I proceed?" → 等待确认 |
| 覆盖率门控 | P0/P1 覆盖率 < 100% 时阻止交付 |
| 视觉验证 | Chrome-MCP 截图 → Gemini 多模态对比 |

## 执行流程

```
Phase A: 设计获取
├─ A.0 MCP 连接检查
├─ A.1 解析 URL（fileKey + nodeId）
├─ A.2.1 【先】Explore agent 获取项目配置（含 assetsDir）
├─ A.2.2 【后】Figma MCP 获取设计上下文（依赖 assetsDir）
├─ A.2.3 条件检查（designContext 为空 → 执行 A.3）
├─ A.3 大节点分拆（如需要）
├─ A.4 提取 ElementManifest
└─ A.5 获取视觉参考截图
→ CHECKPOINT A

Phase B: 分析 + 编码
├─ B.1 双模型并行分析
├─ B.2 生成 BuildPlan
├─ B.3 【HARD STOP】展示计划，等待确认
├─ B.4 项目约定转换 + 编码
└─ B.5 资源处理
→ CHECKPOINT B

Phase C: 验证 + 交付
├─ C.1 覆盖率检查（门控）
├─ C.2 验证 Checklist
├─ C.3 Chrome-MCP 视觉验证（循环修复）
└─ C.4 交付决策
→ CHECKPOINT C
```

---

## Phase A: 设计获取

### A.0 MCP 连接检查

首次调用 Figma MCP 失败时，引导用户配置：

```bash
# 1. 添加 Figma MCP
claude mcp add figma --url https://mcp.figma.com/mcp

# 2. 登录 OAuth
claude mcp login figma

# 3. 重启 Claude Code
```

配置完成后，用户需重启 Claude Code 继续。

### A.1 解析 URL

**URL 格式**：`https://figma.com/design/:fileKey/:fileName?node-id=1-2`

```typescript
const parseResult = {
  fileKey: 'kL9xQn2VwM8pYrTb4ZcHjF',  // /design/ 后的段
  nodeId: '42-15',                      // node-id 参数值
  // 注意：node-id=1-2 在 MCP 调用时转为 nodeId="1:2"
};
```

**无 URL 时**（figma-desktop MCP）：使用 Figma 桌面端当前选中的节点。

### A.2.1 【先】获取项目配置（优先读缓存）

> ⚠️ **必须先完成此步骤，获取 `assetsDir` 后才能执行 A.2.2**

**优先级**：ui-config.json 缓存 > Explore agent

```typescript
// 1. 尝试读取 /scan 生成的 UI 配置
const uiConfigPath = '.claude/config/ui-config.json';
let projectConfig = null;

if (await fileExists(uiConfigPath)) {
  const uiConfig = await readJson(uiConfigPath);
  if (uiConfig.assetsDir) {
    // ✅ 缓存命中，直接使用（0 tokens）
    projectConfig = {
      assetsDir: uiConfig.assetsDir,
      cssFramework: uiConfig.cssFramework,
      designTokens: uiConfig.designTokens,
      componentsDir: uiConfig.componentsDir,
      existingComponents: uiConfig.existingComponents
    };
    console.log('[figma-ui] 使用 ui-config.json 缓存');
  }
}

// 2. 缓存未命中时提示用户先运行 /scan
if (!projectConfig) {
  console.log('[figma-ui] 未找到 UI 配置缓存');
  console.log('建议先运行 /scan 生成配置，可节省后续扫描开销');

  // 降级：启动 Explore agent（消耗更多 tokens）
  projectConfig = await Task({
    subagent_type: 'Explore',
    prompt: '扫描项目，返回：assetsDir, cssFramework, designTokens, componentsDir, existingComponents'
  });
}

// 3. 提取 assetsDir（必须有值）
const assetsDir = projectConfig.assetsDir || 'public/images';
```

**缓存来源**：运行 `/scan` 时自动生成 `.claude/config/ui-config.json`。

### A.2.2 【后】Figma MCP 获取设计上下文

> ⚠️ **`dirForAssetWrites` 是必填参数，必须使用 A.2.1 获取的 `assetsDir`**

```typescript
// 1. 使用 A.2.1 获取的 assetsDir 构造临时目录
const taskAssetsDir = `${assetsDir}/.figma-ui/tmp/${taskId}`;

// 2. 确保目录存在（Figma MCP 不会自动创建）
await Bash({ command: `mkdir -p "${taskAssetsDir}"` });

// 3. 调用 Figma MCP（dirForAssetWrites 必填！）
const designContext = await mcp__figma-mcp__get_design_context({
  nodeId,                              // 必填
  dirForAssetWrites: taskAssetsDir     // ⚠️ 必填！来自 A.2.1
});
```

### A.2.3 条件检查（必须执行）

```
designContext 返回结果检查：
├─ 正常返回（有 code/布局信息）→ 继续 A.4
├─ 返回为空或被截断 → 必须执行 A.3 分拆
└─ 报错 → 检查 MCP 连接，修复后重试
```

**禁止在 designContext 为空时跳过 A.3 直接继续。**

### A.3 大节点分拆

**当 designContext 响应为空或被截断时，必须执行此步骤**：

```typescript
// 1. 获取节点结构
const metadata = await mcp__figma-mcp__get_metadata({ nodeId });

// 2. 识别主要子节点
const childNodes = extractChildNodeIds(metadata);

// 3. 分块获取每个子节点
for (const childId of childNodes) {
  const childContext = await mcp__figma-mcp__get_design_context({
    nodeId: childId,
    dirForAssetWrites: taskAssetsDir  // 使用同一个临时目录
  });
  mergeContext(designContext, childContext);
}
```

### A.4 提取 ElementManifest

遍历 designContext，按类型判断优先级。详见 [references/data-structures.md](references/data-structures.md)

### A.5 获取视觉参考

```typescript
await mcp__figma-mcp__get_screenshot({ nodeId });
// 保存为 ${taskAssetsDir}/design-reference.png
```

此截图作为后续验证的**视觉真相来源**。

### ✅ CHECKPOINT A（必须全部通过才能进入 Phase B）

```
□ MCP 连接正常？
  └─ 否 → 返回 A.0 引导配置

□ assetsDir 已获取？（来自 ui-config.json 或 Explore）
  └─ 否 → 检查 .claude/config/ui-config.json 或重新执行 A.2.1

□ designContext 非空且包含布局/样式信息？
  └─ 否 → 执行 A.3 分拆后重新检查

□ elementManifest 已提取？（elements.length > 0）
  └─ 否 → 返回 A.4 重新提取

□ 设计参考截图已保存？
  └─ 否 → 返回 A.5 重新获取
```

**全部通过 → 进入 Phase B**

---

## Phase B: 分析 + 编码

### B.1 双模型并行分析

**Gemini**（`run_in_background: true`）- 前端专家：
```bash
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/frontend.md
分析设计上下文，返回 JSON：
- layoutStrategy: { type, direction, alignment }
- tokenMapping: { colors, spacing, typography, radius, shadow }
- responsiveStrategy: { approach, breakpoints }
- prototypeCode: UI 样式代码

设计上下文：${designContext}
项目 Tokens：${projectTokens}
EOF
```

**Codex**（`run_in_background: true`）- 组件架构：
```bash
codeagent-wrapper --backend codex - ${workdir} <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/architect.md
分析设计上下文，返回 JSON：
- fileStructure: { mainFile, styleFile }
- componentReuse: { existing[], newRequired[] }
- prototypeCode: 组件结构代码

设计上下文：${designContext}
现有组件：${existingComponents}
元素清单：${elementManifest}
EOF
```

### B.2 生成 BuildPlan

合并双模型结果，生成构建计划。

### B.3 展示计划（HARD STOP）

向用户展示：
1. 布局策略 + 响应式方案
2. Token 映射摘要
3. 组件复用情况（复用 N 个，新建 M 个）
4. 元素统计（P0: x, P1: y, P2: z）

**输出**："Shall I proceed with this plan? (Y/N)"

**立即终止，等待用户确认后继续。**

### B.4 项目约定转换 + 编码

**UI First, Data Later** — 先实现像素级视觉还原：
- 使用 mock data 匹配设计稿，不接入真实 API
- 使用设计稿原文，跳过 i18n
- 跳过复杂状态管理，专注组件结构和样式

**转换原则**：

1. **复用优先**：查找项目组件源码和 demo，扩展现有组件而非新建
2. **Token 映射**：将 Figma 颜色/间距/字体映射到项目 Token
3. **框架适配**：Figma 输出视为设计意图，转换为项目框架约定
4. **样式一致**：使用项目 CSS 方案（Tailwind/SCSS/CSS Modules）

**编码流程**：
1. 合并双模型原型代码（Gemini 样式 + Codex 结构）
2. Token-First 检查：替换所有硬编码值
3. 更新 ElementManifest 状态
4. 写入目标文件

### B.5 资源处理

**资源规则**：
- Figma MCP 返回的 localhost 资源 URL **直接使用**
- **禁止**导入新图标包，所有资源来自 Figma
- **禁止**创建占位符

**清理流程**：
```typescript
// 移动已使用资源到项目资源目录
moveUsedAssets(taskAssetsDir, assetsDir);
// 删除临时目录
cleanup(taskAssetsDir);
```

### ✅ CHECKPOINT B（必须全部通过才能进入 Phase C）

```
□ 双模型分析结果已收集？
  └─ 否 → 等待 TaskOutput 或重新启动分析

□ BuildPlan 已生成并展示给用户？
  └─ 否 → 返回 B.2 生成计划

□ 用户已确认 "Y" 继续？
  └─ 否 → 等待用户确认，或根据反馈调整计划

□ 代码已写入目标文件？
  └─ 否 → 返回 B.4 完成编码

□ ElementManifest 状态已更新？（无 pending 的 P0/P1）
  └─ 否 → 返回 B.4 补充实现

□ 资源已清理（临时目录已删除）？
  └─ 否 → 返回 B.5 完成清理
```

**全部通过 → 进入 Phase C**

---

## Phase C: 验证 + 交付

### C.1 覆盖率检查（门控）

```typescript
const missingP0P1 = elementManifest.elements.filter(
  e => e.priority !== 'P2' && e.status === 'pending'
);
if (missingP0P1.length > 0) {
  // 阻止交付，返回 Phase B 补充实现
  throw new Error(`覆盖率不足: ${missingP0P1.map(e => e.name).join(', ')}`);
}
```

### C.2 验证 Checklist

在自动验证前，快速自检：

- [ ] **布局**：间距、对齐、尺寸匹配
- [ ] **排版**：字体、大小、粗细、行高
- [ ] **颜色**：精确匹配设计稿
- [ ] **交互**：hover/active/disabled 状态
- [ ] **响应式**：符合 Figma 约束
- [ ] **资源**：图片/图标正确渲染
- [ ] **可访问性**：符合 WCAG 标准

### C.3 Chrome-MCP 视觉验证

详见 [references/chrome-validation.md](references/chrome-validation.md)

核心步骤：
1. 确定页面访问策略（direct_url/modal/drawer）
2. 打开页面并截图
3. Gemini 多模态对比（设计稿 vs 实际页面）
4. 差异修复（最多 3 次循环）

### C.4 交付决策

| 条件 | 决策 |
|------|------|
| 覆盖率 100% + 视觉评分 ≥90 | ✅ 通过 |
| 视觉评分 ≥80 | ⚠️ 需人工审查 |
| 视觉评分 <80 或循环修复超限 | ❌ 报告差异，请求指导 |

### ✅ CHECKPOINT C（最终交付检查）

```
□ P0/P1 覆盖率 = 100%？
  └─ 否 → 返回 Phase B 补充实现

□ 验证 Checklist 全部通过？
  └─ 否 → 修复对应问题

□ Chrome-MCP 视觉验证通过（评分 ≥80）？
  └─ 否 → 循环修复（最多 3 次）或请求指导

□ 交付决策已做出？
  └─ 否 → 根据评分执行 C.4 决策
```

**全部通过 → 任务完成，输出交付摘要**

---

## 常见问题

### Figma 输出被截断
**原因**：设计过于复杂或嵌套层级过多
**方案**：使用 A.3 大节点分拆策略

### 设计 Token 与项目不一致
**原因**：项目 Token 值与 Figma 设计值不同
**方案**：优先使用项目 Token 保持一致性，微调间距/尺寸以匹配视觉

### 资源无法加载
**原因**：Figma MCP 资源端点不可访问
**方案**：确认 MCP 服务运行中，直接使用 localhost URL

---

## 快速参考

### 必传参数速查

| 工具 | 必传参数 |
|------|----------|
| `get_design_context` | `nodeId`, **`dirForAssetWrites`**（来自 A.2.1） |
| `get_screenshot` | `nodeId` |
| `get_metadata` | `nodeId` |

### 依赖顺序

```
A.2.1 读取缓存（ui-config.json）→ 命中？
         ├─ 是 → assetsDir（0 tokens）
         └─ 否 → Explore agent → assetsDir（~64k tokens）
                  ↓
A.2.2 Figma MCP（需要 assetsDir）
                  ↓
A.2.3 条件检查 → designContext 为空？ → A.3 分拆
```

> 提示：先运行 `/scan` 生成 `ui-config.json`，可将 A.2.1 开销从 ~64k tokens 降至 ~0

### Phase 流转条件

```
Phase A → CHECKPOINT A 通过 → Phase B
Phase B → CHECKPOINT B 通过 → Phase C
Phase C → CHECKPOINT C 通过 → 交付完成
```

**任一 CHECKPOINT 失败 → 返回对应阶段修复，禁止跳过。**
