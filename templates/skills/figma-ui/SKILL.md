---
name: figma-ui
description: "REQUIRED workflow for Figma-to-code UI restoration. MUST invoke this skill IMMEDIATELY when: (1) user shares any figma.com or figma.design URL, (2) user mentions 还原/切图/设计稿/UI实现/前端开发/Figma, (3) user asks to implement/restore/build/convert UI from design. Do NOT call mcp__figma-mcp tools directly - always use this skill first."
---

# UI 还原工作流（v3.2 精简版）

从 Figma 设计稿到生产代码的 **3 阶段**工作流，采用 **Gemini + Claude** 双模型协作。

> **模型分工**：Gemini 专注 UI/样式/多模态视觉验证，Claude 专注整合/编码/最佳实践。

> **核心目标**：高保真还原设计稿，强制使用 Design Token + 元素覆盖率门控。

---

## 强制规则（HARD STOP）

### 规则 1：元素追踪
```
❌ 直接编码，不追踪元素
✅ 从 Figma 输出提取 ElementManifest，追踪实现状态
```

### 规则 2：用户确认
```
❌ 分析后直接编码
✅ 展示 BuildPlan → "Shall I proceed? (Y/N)" → 等待确认
```

### 规则 3：覆盖率门控
```
❌ 忽略缺失元素
✅ 覆盖率 < 100% 时阻止交付
```

### 规则 4：Token-First
```
❌ 使用硬编码色值 #3B82F6
✅ 映射到 Design Token，无 Token 时记录审计
```

### 规则 5：多模态验证
```
❌ 仅代码审计
✅ Figma 截图 → Gemini 多模态对比
```

### 规则 6：实际页面验证
```
❌ 仅静态代码对比
✅ Chrome-MCP 打开页面 → 截图 → 与设计稿对比 → 循环修复
```

---

## 执行流程（3 阶段）

```
┌─────────────────────────────────────────────────────────────┐
│ Phase A：输入获取                                            │
│ ├─ 提取参数（URL、nodeId、targetPath）                       │
│ ├─ 并行：Explore agent + Figma MCP                          │
│ ├─ 提取 ElementManifest                                     │
│ └─ 保存检查点                                                │
├─────────────────────────────────────────────────────────────┤
│ Phase B：分析 + 编码                                         │
│ ├─ Gemini：布局 + Token 映射 + 响应式                        │
│ ├─ Claude：组件结构 + 代码组织                               │
│ ├─ 生成 BuildPlan                                           │
│ ├─ 【HARD STOP】展示计划，等待确认                           │
│ ├─ 编码：Token-First + 元素清单驱动                          │
│ └─ 资源清理                                                  │
├─────────────────────────────────────────────────────────────┤
│ Phase C：验证 + 交付                                         │
│ ├─ 覆盖率检查（门控）                                        │
│ ├─ Chrome-MCP 实际页面验证（循环修复）                       │
│ ├─ Gemini 多模态视觉对比                                     │
│ ├─ 评分决策                                                  │
│ └─ 输出验证结果                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心数据结构

### ElementManifest

```typescript
interface ElementManifest {
  taskId: string;
  elements: Array<{
    nodeId: string;
    name: string;
    type: string;
    priority: 'P0' | 'P1' | 'P2';  // P0=必须, P1=重要, P2=可选
    status: 'pending' | 'implemented' | 'verified';
  }>;
  // 覆盖率仅计算 P0/P1 元素（P2 为可选，不影响门控）
  coverage: {
    requiredP0P1: number;      // P0 + P1 总数
    implementedP0P1: number;   // 已实现的 P0 + P1 数量
    ratio: number;             // implementedP0P1 / requiredP0P1
  };
}
```

### TokenMapping

```typescript
interface TokenMapping {
  colors: Record<string, string>;     // "#3B82F6" → "colors.primary.500"
  spacing: Record<string, string>;    // "16px" → "spacing.4"
  typography: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
}
```

### BuildPlan

```typescript
interface BuildPlan {
  component: { name: string; filePath: string; framework: string };
  layout: { strategy: 'flex' | 'grid'; direction: 'row' | 'column' };
  responsive: { approach: 'mobile-first' | 'desktop-first'; breakpoints: string[] };
}
```

### WorkflowState

```typescript
interface WorkflowState {
  taskId: string;
  targetPath: string;
  figma: { url: string; nodeId: string };
  taskAssetsDir: string;
  phaseStatus: Record<'A' | 'B' | 'C', 'pending' | 'completed' | 'failed'>;
  designContext: object;           // Figma MCP 原始输出
  elementManifest: ElementManifest;
  tokenMapping: TokenMapping;
  buildPlan: BuildPlan | null;
  userApproved: boolean;
  // Chrome-MCP 验证配置
  validation: ValidationConfig;
}
```

### ValidationConfig

```typescript
interface ValidationConfig {
  pageUrl: string;                  // 实际页面 URL
  designScreenshot: string;         // 设计稿截图路径（缓存）
  ignoreRegions: IgnoreRegion[];    // 忽略区域
  maxRetries: number;               // 最大修复循环次数（默认 3）
  currentRetry: number;             // 当前循环次数
  accessStrategy: PageAccessStrategy; // 页面访问策略
}

interface IgnoreRegion {
  type: 'header' | 'sidebar' | 'footer' | 'custom';
  selector?: string;                // CSS 选择器（custom 时使用）
  reason: string;                   // 忽略原因
}

interface PageAccessStrategy {
  type: 'direct_url' | 'modal' | 'drawer' | 'nested_route';
  requiresAuth: boolean;
  requiresData: boolean;
  triggerAction?: {
    navigateTo: string;             // 先导航到的页面
    clickSelector?: string;         // 点击触发元素
    waitForSelector?: string;       // 等待目标出现
  };
  mockStrategy?: {
    type: 'msw' | 'fixture' | 'test_harness';
    endpoints?: string[];           // 需要 mock 的接口
    fixtureData?: object;           // 固定数据
  };
}
```

---

## Phase A：输入获取

### A.1 提取参数

```typescript
const params = {
  figmaUrl: extractFigmaUrl(userInput),
  nodeId: extractNodeId(userInput),
  targetPath: extractTargetPath(userInput),
  taskId: `figma-ui-${Date.now().toString(36)}`
};
```

### A.2 并行执行

**Explore Agent**：扫描项目配置

```typescript
Task({
  subagent_type: 'Explore',
  prompt: `
    扫描项目，返回 JSON：
    - assetsDir: 静态资源目录
    - framework: vue/react/nuxt/next
    - cssFramework: tailwind/scss/css-modules
    - designTokens: { colors, spacing, typography, radius, shadow }
  `
})
```

**Figma MCP**：获取设计上下文

```typescript
const taskAssetsDir = `${assetsDir}/.figma-ui/tmp/${taskId}`;
const designContext = await mcp__figma-mcp__get_design_context({
  nodeId,
  dirForAssetWrites: taskAssetsDir
});
```

### A.3 提取 ElementManifest

遍历 `designContext` 节点，提取 `nodeId`、`name`、`type`，根据类型判断优先级。

### A.4 保存检查点

存储 `WorkflowState`，标记 Phase A 完成。

---

## Phase B：分析 + 编码

### B.1 双模型并行分析

**Gemini**（`run_in_background: true`）：

```bash
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
分析设计上下文，返回 JSON：
- layoutStrategy: { type, direction, alignment }
- tokenMapping: { colors, spacing, typography, radius, shadow }
- responsiveStrategy: { approach, breakpoints }
- prototypeCode: UI 样式代码

设计上下文：${designContext}
项目 Tokens：${projectTokens}
EOF
```

**Claude**（`run_in_background: true`）：

```bash
codeagent-wrapper --backend claude - ${workdir} <<'EOF'
分析设计上下文，返回 JSON：
- fileStructure: { mainFile, styleFile }
- stateManagement: { localState }
- prototypeCode: 组件结构代码

设计上下文：${designContext}
元素清单：${elementManifest}
EOF
```

### B.2 生成 BuildPlan

合并双模型分析结果。

### B.3 展示计划（HARD STOP）

向用户展示：
1. 布局策略
2. Token 映射摘要
3. 元素统计（P0/P1/P2）

**输出**：**"Shall I proceed with this plan? (Y/N)"**

**立即终止，等待用户确认。**

### B.4 编码

1. 合并双模型原型代码
2. Token-First：检查并替换硬编码值
3. 更新 ElementManifest 状态
4. 写入目标文件

### B.5 资源清理

移动已使用资源到 `assetsDir`，删除临时目录。

---

## Phase C：验证 + 交付

### C.1 覆盖率检查（门控）

```typescript
// 仅检查 P0/P1 元素的覆盖率（P2 可选，不阻塞交付）
const missingP0P1 = elementManifest.elements.filter(
  e => e.priority !== 'P2' && e.status === 'pending'
);

if (missingP0P1.length > 0) {
  throw new Error(`覆盖率不足，缺失 P0/P1 元素: ${missingP0P1.map(e => e.name).join(', ')}`);
}
```

### C.2 Chrome-MCP 实际页面验证（循环修复）

**步骤 1：缓存设计稿截图**

```typescript
// 首次执行时缓存设计稿截图（后续循环复用）
if (!validation.designScreenshot) {
  const screenshotPath = `${taskAssetsDir}/design-screenshot.png`;
  await mcp__figma-mcp__get_screenshot({ nodeId });
  validation.designScreenshot = screenshotPath;
}
```

**步骤 2：打开页面并截图**

首先分析目标页面类型，确定打开策略：

```typescript
interface PageAccessStrategy {
  type: 'direct_url' | 'modal' | 'drawer' | 'nested_route';
  requiresAuth: boolean;
  requiresData: boolean;
  triggerAction?: {
    // 弹窗/抽屉触发方式
    navigateTo: string;          // 先导航到的页面
    clickSelector?: string;      // 点击触发元素
    waitForSelector?: string;    // 等待目标出现
  };
  mockStrategy?: {
    // 数据 mock 策略
    type: 'msw' | 'fixture' | 'test_harness';
    endpoints?: string[];        // 需要 mock 的接口
    fixtureData?: object;        // 固定数据
  };
}
```

**策略 A：直接 URL 访问**

```typescript
// 简单页面，直接导航
if (strategy.type === 'direct_url' && !strategy.requiresAuth) {
  await mcp__chrome-mcp__navigate_page({
    type: 'url',
    url: validation.pageUrl
  });
}
```

**策略 B：需要认证的页面**

```typescript
// 方案 1：使用已登录的浏览器会话（推荐）
// Chrome-MCP 连接到已打开的浏览器，复用现有 session

// 方案 2：注入测试 token
await mcp__chrome-mcp__evaluate_script({
  function: `() => {
    localStorage.setItem('auth_token', '${testToken}');
    sessionStorage.setItem('user', JSON.stringify(${mockUser}));
  }`
});
await mcp__chrome-mcp__navigate_page({ type: 'reload' });
```

**策略 C：弹窗/抽屉/模态框**

```typescript
if (strategy.type === 'modal' || strategy.type === 'drawer') {
  // 1. 先导航到父页面
  await mcp__chrome-mcp__navigate_page({
    type: 'url',
    url: strategy.triggerAction.navigateTo
  });

  // 2. 等待页面加载
  await mcp__chrome-mcp__wait_for({
    text: '页面加载标识',
    timeout: 10000
  });

  // 3. 点击触发按钮
  const snapshot = await mcp__chrome-mcp__take_snapshot({});
  const triggerElement = findElementBySelector(snapshot, strategy.triggerAction.clickSelector);
  await mcp__chrome-mcp__click({ uid: triggerElement.uid });

  // 4. 等待弹窗出现
  await mcp__chrome-mcp__wait_for({
    text: strategy.triggerAction.waitForSelector,
    timeout: 5000
  });
}
```

**策略 D：需要接口数据的页面**

```typescript
if (strategy.requiresData) {
  // 方案 1：启动 Mock Server (MSW)
  await Bash({
    command: `cd ${projectDir} && npx msw start --fixture ${fixtureFile}`,
    run_in_background: true
  });

  // 方案 2：注入测试数据到页面
  await mcp__chrome-mcp__evaluate_script({
    function: `() => {
      window.__TEST_DATA__ = ${JSON.stringify(strategy.mockStrategy.fixtureData)};
      window.__MOCK_MODE__ = true;
    }`
  });

  // 方案 3：生成独立测试 HTML（最可靠）
  const testHtmlPath = await generateTestHarness({
    component: targetComponent,
    props: mockProps,
    mockData: fixtureData
  });
  await mcp__chrome-mcp__navigate_page({
    type: 'url',
    url: `file://${testHtmlPath}`
  });
}
```

**生成测试 Harness（推荐方案）**

```typescript
async function generateTestHarness(config: {
  component: string;
  props: object;
  mockData: object;
}): Promise<string> {
  const harnessContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI 验证 - ${config.component}</title>
  <!-- 引入项目样式 -->
  <link rel="stylesheet" href="${projectStylesPath}">
</head>
<body>
  <div id="app">
    <!-- 组件渲染区域 -->
  </div>
  <script type="module">
    // Mock 数据注入
    window.__MOCK_DATA__ = ${JSON.stringify(config.mockData)};

    // 动态导入并渲染组件
    import { mount } from '${frameworkMountHelper}';
    import Component from '${config.component}';

    mount(Component, {
      target: document.getElementById('app'),
      props: ${JSON.stringify(config.props)}
    });
  </script>
</body>
</html>`;

  const harnessPath = `${taskAssetsDir}/test-harness.html`;
  await writeFile(harnessPath, harnessContent);
  return harnessPath;
}
```

**策略选择流程**

```typescript
function determineAccessStrategy(designContext: object): PageAccessStrategy {
  // 1. 分析组件类型
  const componentType = designContext.componentType;  // modal/drawer/page/card

  // 2. 检查是否需要认证
  const requiresAuth = projectConfig.authRequired &&
    !designContext.isPublicPage;

  // 3. 检查数据依赖
  const requiresData = designContext.hasDynamicContent ||
    designContext.apiEndpoints?.length > 0;

  // 4. 选择策略
  if (componentType === 'modal' || componentType === 'drawer') {
    return {
      type: componentType,
      requiresAuth,
      requiresData,
      triggerAction: inferTriggerAction(designContext)
    };
  }

  if (requiresData) {
    return {
      type: 'direct_url',
      requiresAuth,
      requiresData: true,
      mockStrategy: { type: 'test_harness', fixtureData: generateMockData(designContext) }
    };
  }

  return { type: 'direct_url', requiresAuth, requiresData: false };
}
```

**截图执行**

```typescript
// 策略确定后，执行截图
const actualScreenshot = `${taskAssetsDir}/actual-screenshot-${validation.currentRetry}.png`;
await mcp__chrome-mcp__take_screenshot({
  filePath: actualScreenshot,
  fullPage: false  // 仅可视区域，与设计稿对应
});
```

**步骤 3：Gemini 视觉对比（忽略公共区域）**

```bash
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
对比两张截图，返回 JSON：
{
  "match": true/false,
  "differences": [
    {
      "location": "描述位置",
      "expected": "设计稿中的样式",
      "actual": "实际页面的样式",
      "severity": "critical|major|minor"
    }
  ],
  "ignoredRegions": ["header", "sidebar"],  // 已忽略的区域
  "overallSimilarity": 0-100
}

设计稿截图：[Image: design-screenshot.png]
实际页面截图：[Image: actual-screenshot.png]

忽略区域配置：
${JSON.stringify(validation.ignoreRegions)}

注意：
1. 忽略 header/sidebar/footer 等公共区域的差异
2. 仅关注目标组件区域的视觉保真度
3. severity 判断：
   - critical: 布局错乱、元素缺失
   - major: 颜色/间距明显偏差
   - minor: 细微样式差异
EOF
```

**步骤 4：循环修复决策**

```typescript
const compareResult = parseGeminiResult();

if (compareResult.match || compareResult.overallSimilarity >= 95) {
  // 验证通过，继续 C.3
  console.log('✅ Chrome-MCP 视觉验证通过');
} else if (validation.currentRetry >= validation.maxRetries) {
  // 达到最大重试次数，输出差异报告并询问用户
  console.log(`⚠️ 已达最大修复次数 (${validation.maxRetries})，以下差异未解决:`);
  compareResult.differences.forEach(d => console.log(`  - ${d.location}: ${d.expected} → ${d.actual}`));
  // 询问用户是否继续
  await askUser('是否接受当前结果并继续? (Y/N)');
} else {
  // 尝试修复
  validation.currentRetry++;
  console.log(`🔄 检测到差异，开始第 ${validation.currentRetry} 次修复...`);

  // 调用 Gemini 生成修复代码
  const fixPatch = await generateFixPatch(compareResult.differences);

  // 应用修复
  applyPatch(fixPatch);

  // 递归验证
  goto('C.2');  // 重新执行 C.2
}
```

**忽略区域默认配置**

```typescript
const defaultIgnoreRegions: IgnoreRegion[] = [
  { type: 'header', reason: '公共头部组件，非本次修改范围' },
  { type: 'sidebar', reason: '公共侧边栏组件，非本次修改范围' }
];

// 用户可通过参数覆盖
if (userSpecifiedTarget.includes('header')) {
  defaultIgnoreRegions = defaultIgnoreRegions.filter(r => r.type !== 'header');
}
```

### C.3 Gemini 多模态视觉对比

```bash
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
对比设计截图和生成代码，返回 JSON：
{
  "scores": {
    "visualFidelity": 0-25,
    "responsiveDesign": 0-25,
    "accessibility": 0-25,
    "designConsistency": 0-25
  },
  "matches": ["..."],
  "mismatches": ["..."],
  "totalScore": 0-100
}

设计截图：[Image]
生成代码：${code}
EOF
```

### C.4 评分决策

| 分数 | 决策 |
|------|------|
| ≥90 + 覆盖率100% | ✅ 通过 |
| ≥80 | ⚠️ 需审查 |
| <80 | ❌ 拒绝 |

### C.5 输出验证结果

控制台输出：
- 元素覆盖率
- 各维度评分
- 匹配/差异项
- 最终决策

---

## 错误处理

### 单模型失败

```typescript
const results = await Promise.allSettled([geminiTask, claudeTask]);
if (results.filter(r => r.status === 'rejected').length === 2) {
  throw new Error('双模型均失败');
}
// 单模型失败时询问用户是否继续
```

---

## 检查清单

### Phase A
- [ ] 并行启动 Explore + Figma MCP
- [ ] 提取 ElementManifest
- [ ] 创建任务隔离目录
- [ ] 保存检查点

### Phase B
- [ ] 并行调用 Gemini + Claude
- [ ] 生成 BuildPlan
- [ ] 展示计划并输出确认提示
- [ ] 收到用户确认
- [ ] Token-First 编码
- [ ] 更新元素状态
- [ ] 资源清理

### Phase C
- [ ] 覆盖率检查通过
- [ ] Chrome-MCP 页面验证
  - [ ] 页面访问策略确定（direct_url/modal/drawer）
  - [ ] 前置条件处理（认证/Mock 数据/触发操作）
  - [ ] 设计稿截图已缓存
  - [ ] 实际页面截图完成
  - [ ] 视觉对比通过（或用户确认接受差异）
- [ ] Gemini 多模态对比完成
- [ ] 输出验证结果

**任一检查项未通过，返回对应阶段执行。**
