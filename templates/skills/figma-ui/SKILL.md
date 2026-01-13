---
name: figma-ui
description: "REQUIRED workflow for Figma-to-code UI restoration. MUST invoke this skill IMMEDIATELY when: (1) user shares any figma.com or figma.design URL, (2) user mentions 还原/切图/设计稿/UI实现/前端开发/Figma, (3) user asks to implement/restore/build/convert UI from design. Do NOT call mcp__figma-mcp tools directly - always use this skill first."
---

# UI 还原工作流（优化版 v2）

从 Figma 设计稿到生产代码的 **5 阶段**自动化工作流，采用 **Gemini + Claude** 双模型协作机制。

> **模型分工**：Gemini 专注 UI/样式/响应式/多模态视觉验证，Claude 专注整合/API设计/最佳实践。

> **⚠️ 核心目标**：**高保真还原设计稿**——布局、间距、尺寸、颜色、字体、内容与设计稿一致，**优先使用 Design Token**。

---

## ⛔ 强制执行规则（HARD STOP）

> **以下规则违反任一条即视为严重错误，必须立即停止并修正：**

### 规则 1：并行初始化不可跳过

```
❌ 错误：串行执行参数验证和上下文检索
✅ 正确：并行启动两个 Subagent → 收集精炼结果 → 合并后进入下一阶段
```

**检查点**：在调用 Figma MCP 之前，必须已经：
1. 并行完成参数验证（Subagent A）和上下文检索（Subagent B）
2. 收到精炼的 JSON 格式结果（非全量文本）

### 规则 2：用户确认不可跳过（Hard Stop）

```
❌ 错误：分析完成后直接开始编码
✅ 正确：展示实施计划 → 输出 "Shall I proceed with this plan? (Y/N)" → 等待用户确认
```

**检查点**：在进入原型生成阶段之前，必须已经：
1. 展示双模型分析结果和实施计划
2. 以**加粗文本**输出：**"Shall I proceed with this plan? (Y/N)"**
3. 等待用户明确确认

### 规则 3：双模型原型生成不可跳过

```
❌ 错误：直接编写 UI 代码
✅ 正确：并行调用 Gemini + Claude → 交叉验证 → 集成最优方案
```

### 规则 4：任务隔离目录强制使用

```
❌ 错误：dirForAssetWrites = assetsDir（直接使用项目资源目录）
✅ 正确：dirForAssetWrites = assetsDir/.figma-ui/tmp/<taskId>/
```

**目的**：避免并发任务资源污染，支持安全清理

### 规则 5：Token-First 策略（Design System 优先）

```
❌ 错误：使用设计稿精确色值 #3B82F6
✅ 正确：优先映射到 Design Token（如 colors.primary.500），无 Token 时才用原始值
```

**检查点**：每个样式值必须先查找匹配的 Token

### 规则 6：双模型审计 + 多模态视觉验证不可跳过

```
❌ 错误：仅通过代码文本审计
✅ 正确：获取 Figma 设计截图 → Gemini 多模态对比 → 代码审计
```

---

## 执行流程概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Phase 1：并行初始化（Subagent 模式）                                      │
│ ├─ 快速提取基本参数（URL、nodeId、targetPath）                            │
│ ├─ Subagent A：参数验证 + 资源目录扫描 ────┐                             │
│ ├─ Subagent B：上下文检索 + 摘要提取 ──────┼─→ 精炼 JSON 合并            │
│ └─ 验证合并结果，生成 taskId                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 2：收集设计信息                                                    │
│ ├─ 创建任务隔离目录：assetsDir/.figma-ui/tmp/<taskId>/                   │
│ ├─ 调用 Figma MCP（dirForAssetWrites = 隔离目录）                        │
│ ├─ 资源下载与规范化命名                                                  │
│ └─ 保存检查点状态                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 3：双模型协作分析                                                  │
│ ├─ 并行调用 Gemini + Claude 分析实现方案                                  │
│ ├─ 输出格式：结构化 JSON                                                 │
│ ├─ Token 映射：设计值 → Design Token                                     │
│ ├─ 展示分析结果和实施计划                                                │
│ └─ 【HARD STOP】输出 "Shall I proceed with this plan? (Y/N)"            │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 4：双模型原型获取 + 编码实施                                        │
│ ├─ Gemini：UI 样式、布局、响应式设计、可访问性                            │
│ ├─ Claude：组件 API、代码组织、整合、最佳实践                             │
│ ├─ 交叉验证，集成最优方案                                                │
│ ├─ 【核心】Token-First：优先使用 Design Token                            │
│ ├─ 资源引用检查 + 安全清理                                               │
│ └─ 保存检查点状态                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 5：双模型审计与交付（多模态验证）                                    │
│ ├─ 获取 Figma 设计截图                                                   │
│ ├─ Gemini：多模态视觉对比 + 响应式 + 可访问性                             │
│ ├─ Claude：集成正确性、API 设计、可维护性                                 │
│ ├─ 综合评分与决策                                                        │
│ └─ 生成验证报告                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 状态管理（可恢复检查点）

### 工作流状态对象

```typescript
interface WorkflowState {
  taskId: string;                    // 唯一任务 ID
  targetPath: string;                // 目标文件路径
  figma: { url: string; nodeId: string };

  // 阶段状态
  phaseStatus: {
    phase1: 'pending' | 'completed' | 'failed';
    phase2: 'pending' | 'completed' | 'failed';
    phase3: 'pending' | 'completed' | 'failed';
    phase4: 'pending' | 'completed' | 'failed';
    phase5: 'pending' | 'completed' | 'failed';
  };

  // Phase 1 输出
  phase1: {
    config: ConfigResult;
    context: ContextResult;
  };

  // Phase 2 输出
  phase2: {
    taskAssetsDir: string;           // 任务隔离目录
    assetMapping: Record<string, string>;
    designContext: object;
  };

  // Phase 3 输出
  phase3: {
    geminiAnalysis: object;
    claudeAnalysis: object;
    tokenMapping: Record<string, string>;  // 设计值 → Token
    userApproved: boolean;
  };

  // Phase 4 输出
  phase4: {
    writtenFiles: string[];
    usedAssets: string[];
    deletedAssets: string[];
  };

  // Phase 5 输出
  phase5: {
    scores: { gemini: number; claude: number; total: number };
    decision: 'pass' | 'review' | 'reject';
    reportPath: string;
  };
}
```

### 检查点恢复

```typescript
// 加载或创建状态
const state = await loadOrCreateState(taskId);

// 从中断点恢复
if (state.phaseStatus.phase2 === 'completed') {
  console.log('Phase 1-2 已完成，从 Phase 3 恢复');
  // 直接进入 Phase 3
}

// 每个 Phase 完成时保存
await saveCheckpoint(state);
```

---

## 核心流程

### Phase 1：并行初始化（Subagent 模式）

> **⚠️ 关键优化**：使用并行 Subagent 执行，返回精炼 JSON，节省 ~80% 上下文

#### 1.1 快速提取基本参数

```typescript
// 在启动 Subagent 前快速提取
const basicParams = {
  figmaUrl: extractFigmaUrl(userInput),
  nodeId: extractNodeId(userInput),
  targetPath: extractTargetPath(userInput)
};
```

#### 1.2 并行启动双 Subagent

使用 Task 工具并行调用两个 Explore agent：

**Subagent A：参数验证 + 资源目录扫描**

```typescript
Task({
  subagent_type: 'Explore',
  description: '扫描项目配置',
  prompt: `
    快速扫描项目配置，返回精炼 JSON（max 500 tokens）：
    - targetPath: ${basicParams.targetPath}

    任务：
    1. 确定 assetsDir（静态资源目录）
    2. 检测框架（vue/react/nuxt/next）
    3. 检测 CSS 框架（tailwind/scss/css-modules）
    4. 读取响应式断点配置
    5. 检测 Design Token 路径

    OUTPUT FORMAT (JSON only):
    {
      "assetsDir": "/absolute/path/to/assets",
      "framework": "vue" | "react" | "nuxt" | "next",
      "cssFramework": "tailwind" | "scss" | "css-modules",
      "breakpoints": { "sm": "640px", "md": "768px", ... },
      "tokenPaths": { "colors": "path", "spacing": "path" }
    }
  `
})
```

**Subagent B：上下文检索 + 摘要提取**

```typescript
Task({
  subagent_type: 'Explore',
  description: '检索项目上下文',
  prompt: `
    检索 UI 还原相关上下文，返回精炼 JSON（max 1500 tokens）：
    - targetPath: ${basicParams.targetPath}

    任务：
    1. 识别组件库（element-plus/ant-design/custom）
    2. 提取常用 Design Tokens（colors、spacing、typography）
    3. 找到类似组件的实现模式（max 3 个）
    4. 识别项目样式模式（如 BEM、utility-first）

    OUTPUT FORMAT (JSON only):
    {
      "componentLibrary": "element-plus" | "custom" | ...,
      "designTokens": {
        "colors": { "primary-500": "#3B82F6", ... },
        "spacing": { "4": "1rem", ... },
        "typography": { "body": { "size": "14px", "weight": 400 } }
      },
      "similarComponents": [
        { "path": "src/components/X.vue", "pattern": "Flex + Card 布局" }
      ],
      "stylePatterns": ["tailwind-utility", "scoped-css"]
    }
  `
})
```

#### 1.3 合并结果 + 生成 taskId

```typescript
// 使用 TaskOutput 收集两个 Subagent 结果
const [configResult, contextResult] = await Promise.all([
  TaskOutput({ task_id: subagentA_id }),
  TaskOutput({ task_id: subagentB_id })
]);

// 生成 taskId
const taskId = generateTaskId(); // e.g., "figma-ui-20240115-abc123"

// 合并为 Phase 1 输出
const phase1Result: Phase1Result = {
  config: parseJSON(configResult),
  context: parseJSON(contextResult)
};

// 保存检查点
await saveCheckpoint({ taskId, phase1: phase1Result, phaseStatus: { phase1: 'completed' } });
```

#### 1.4 精炼输出 Schema

```typescript
interface ConfigResult {
  assetsDir: string;
  framework: 'vue' | 'react' | 'nuxt' | 'next';
  cssFramework: 'tailwind' | 'scss' | 'css-modules';
  breakpoints: Record<string, string>;
  tokenPaths: { colors?: string; spacing?: string; typography?: string };
}

interface ContextResult {
  componentLibrary: string;
  designTokens: {
    colors: Record<string, string>;
    spacing: Record<string, string>;
    typography: Record<string, object>;
  };
  similarComponents: Array<{ path: string; pattern: string }>;
  stylePatterns: string[];
}
```

---

### Phase 2：收集设计信息

> **前置条件**：已完成 Phase 1

#### 2.1 创建任务隔离目录

```typescript
// ⚠️ 关键：使用任务隔离目录，避免并发污染
const taskAssetsDir = path.join(
  phase1Result.config.assetsDir,
  '.figma-ui',
  'tmp',
  taskId
);

await fs.mkdir(taskAssetsDir, { recursive: true });
```

#### 2.2 获取 Figma 设计上下文

```typescript
const designContext = await mcp__figma-mcp__get_design_context({
  nodeId: figma.nodeId,
  clientFrameworks: phase1Result.config.framework,
  clientLanguages: "typescript",
  dirForAssetWrites: taskAssetsDir  // 使用任务隔离目录
});
```

#### 2.3 资源规范化命名

```typescript
// 扫描任务目录中的新资源
const downloadedAssets = await fs.readdir(taskAssetsDir);

// 规范化命名（内容寻址）
const assetMapping: Record<string, string> = {};
for (const asset of downloadedAssets) {
  const hash = await getFileHash(path.join(taskAssetsDir, asset));
  const ext = path.extname(asset);
  const newName = `${componentName}-${hash.slice(0, 8)}${ext}`;

  await fs.rename(
    path.join(taskAssetsDir, asset),
    path.join(taskAssetsDir, newName)
  );

  assetMapping[asset] = newName;
}
```

#### 2.4 保存检查点

```typescript
await saveCheckpoint({
  ...state,
  phase2: { taskAssetsDir, assetMapping, designContext },
  phaseStatus: { ...state.phaseStatus, phase2: 'completed' }
});
```

---

### Phase 3：双模型协作分析（⛔ Hard Stop）

> **前置条件**：已完成 Phase 2

#### 3.1 并行调用双模型分析

使用 `run_in_background: true` 并行执行：

```bash
# Gemini - 前端 UI 视角（结构化 JSON 输出）
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
<ROLE>
# Gemini Role: Frontend Developer (UI Analysis)
> For: figma-ui Phase 3 - Implementation Analysis

## CRITICAL CONSTRAINTS
- ZERO file system write permission
- OUTPUT FORMAT: Structured JSON only
</ROLE>

<TASK>
## 设计上下文
${designContext}

## 项目上下文
${JSON.stringify(phase1Result.context)}

## 分析要求
返回以下 JSON 结构：

{
  "layoutStrategy": {
    "type": "flex" | "grid",
    "direction": "row" | "column",
    "alignment": { "justify": "...", "align": "..." }
  },
  "responsiveStrategy": {
    "approach": "mobile-first" | "desktop-first",
    "breakpoints": ["sm", "md", "lg"]
  },
  "tokenMapping": {
    "#3B82F6": "colors.primary.500",
    "16px": "spacing.4",
    ...
  },
  "accessibilityRequirements": [
    { "element": "button", "requirement": "aria-label" }
  ],
  "interactionStates": ["hover", "focus", "active", "disabled"],
  "animationSuggestions": []
}
</TASK>

OUTPUT: JSON only, no markdown, no explanation.
EOF
```

```bash
# Claude - 整合视角（结构化 JSON 输出）
codeagent-wrapper --backend claude - ${workdir} <<'EOF'
<ROLE>
# Claude Role: Full-Stack Architect (UI Analysis)
> For: figma-ui Phase 3 - Implementation Analysis

## CRITICAL CONSTRAINTS
- ZERO file system write permission
- OUTPUT FORMAT: Structured JSON only
</ROLE>

<TASK>
## 设计上下文
${designContext}

## 项目上下文
${JSON.stringify(phase1Result.context)}

## 分析要求
返回以下 JSON 结构：

{
  "componentApi": {
    "props": [
      { "name": "variant", "type": "string", "default": "primary" }
    ],
    "emits": ["click", "change"],
    "slots": ["default", "icon"]
  },
  "stateManagement": {
    "localState": ["isOpen", "selectedValue"],
    "externalState": []
  },
  "integrationPoints": [
    { "component": "Button", "usage": "提交操作" }
  ],
  "fileStructure": {
    "mainFile": "ComponentName.vue",
    "styleFile": null,
    "testFile": "ComponentName.spec.ts"
  },
  "typeDefinitions": "interface Props { ... }"
}
</TASK>

OUTPUT: JSON only, no markdown, no explanation.
EOF
```

#### 3.2 合并分析结果 + Token 映射

```typescript
const [geminiAnalysis, claudeAnalysis] = await Promise.all([
  TaskOutput({ task_id: gemini_task_id }),
  TaskOutput({ task_id: claude_task_id })
]);

// 合并 Token 映射
const tokenMapping = {
  ...parseJSON(geminiAnalysis).tokenMapping,
  // 补充从项目 context 中提取的 token
};
```

#### 3.3 展示计划并等待确认（⛔ Hard Stop）

**必须**向用户展示：
1. 双模型分析要点摘要
2. Token 映射表（设计值 → Design Token）
3. 统一的实施计划

**必须**以加粗文本输出：

**"Shall I proceed with this plan? (Y/N)"**

**必须**立即终止当前回复，等待用户确认后再继续。

---

### Phase 4：双模型原型获取 + 编码实施

> **前置条件**：用户已确认实施计划（回复 Y）

#### 4.1 并行调用双模型生成原型

使用 `run_in_background: true` 并行执行：

```bash
# Gemini - UI 样式原型（结构化输出）
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
<ROLE>
# Gemini Role: Frontend Developer (Prototype Generation)
> For: figma-ui Phase 4 - Prototype Generation

## CRITICAL CONSTRAINTS
- ZERO file system write permission
- OUTPUT FORMAT: Complete component code focusing on UI/STYLE
- TOKEN-FIRST: Use Design Tokens from tokenMapping, not raw values
</ROLE>

<TASK>
## Token 映射（必须使用）
${JSON.stringify(tokenMapping)}

## 设计规范
${designContext}

## 生成要求
1. 使用 Token 而非硬编码值
2. 精确还原布局（Flex/Grid 方向、对齐）
3. 响应式设计（mobile-first）
4. 交互状态样式（hover、active、focus、disabled）
5. 可访问性支持（ARIA、键盘导航）

## 视觉属性检查清单
- [ ] 布局：display、flex-direction、justify-content、align-items、gap
- [ ] 间距：margin、padding（使用 spacing token）
- [ ] 尺寸：width、height、min/max
- [ ] 颜色：background、color、border-color（使用 color token）
- [ ] 字体：font-family、font-size、font-weight、line-height
- [ ] 圆角：border-radius
- [ ] 阴影：box-shadow
- [ ] 层叠：z-index
- [ ] 透明度：opacity
- [ ] 滤镜：backdrop-filter
- [ ] 溢出：overflow、text-overflow
- [ ] 对象适应：object-fit

## 目标文件
${targetPath}

## 资源路径
${JSON.stringify(assetMapping)}
</TASK>

OUTPUT: Complete component code with Token-First styling.
EOF
```

```bash
# Claude - 整合原型
codeagent-wrapper --backend claude - ${workdir} <<'EOF'
<ROLE>
# Claude Role: Full-Stack Architect (Prototype Generation)
> For: figma-ui Phase 4 - Prototype Generation

## CRITICAL CONSTRAINTS
- ZERO file system write permission
- OUTPUT FORMAT: Complete component code with INTEGRATION focus
</ROLE>

<TASK>
## 组件 API 设计
${JSON.stringify(claudeAnalysis.componentApi)}

## 类型定义
${claudeAnalysis.typeDefinitions}

## 生成要求
1. 清晰的组件 API 设计（props、emits、slots）
2. 完整的 TypeScript 类型定义
3. 状态管理逻辑
4. 与现有组件的无缝集成
5. 代码可读性和可维护性

## 目标文件
${targetPath}
</TASK>

OUTPUT: Complete component code with Integration focus.
EOF
```

#### 4.2 交叉验证 + 集成最优方案

| 维度 | Gemini 原型 | Claude 原型 | 采用 |
|------|-------------|-------------|------|
| Token 使用 | ✅ | - | Gemini |
| 响应式设计 | ✅ | - | Gemini |
| 交互状态 | ✅ | - | Gemini |
| 类型定义 | - | ✅ | Claude |
| API 设计 | - | ✅ | Claude |
| 代码组织 | - | ✅ | Claude |

#### 4.3 编码实施（Token-First）

```typescript
// 写入代码时验证 Token 使用
const code = mergePrototypes(geminiProto, claudeProto);

// 验证没有硬编码的设计值
for (const [rawValue, token] of Object.entries(tokenMapping)) {
  if (code.includes(rawValue) && !code.includes(token)) {
    console.warn(`⚠️ 发现硬编码值 ${rawValue}，应使用 ${token}`);
  }
}

// 写入文件
if (await fileExists(targetPath)) {
  await Edit({ file_path: targetPath, old_string: ..., new_string: code });
} else {
  await Write({ file_path: targetPath, content: code });
}
```

#### 4.4 资源安全清理

```typescript
// ⚠️ 安全清理：仅在任务隔离目录中操作
const taskAssetsDir = state.phase2.taskAssetsDir;

// 验证路径前缀
if (!taskAssetsDir.includes('.figma-ui/tmp/')) {
  throw new Error('安全检查失败：不允许在非隔离目录中清理资源');
}

// 检查资源引用
const code = await Read({ file_path: targetPath });
const usedAssets: string[] = [];
const unusedAssets: string[] = [];

for (const [original, current] of Object.entries(assetMapping)) {
  const isUsed = code.includes(current) ||
                 code.includes(current.replace(/\.[^.]+$/, ''));

  if (isUsed) {
    usedAssets.push(current);
    // 移动到正式目录
    await fs.rename(
      path.join(taskAssetsDir, current),
      path.join(state.phase1.config.assetsDir, current)
    );
  } else {
    unusedAssets.push(current);
  }
}

// 清理整个任务临时目录（O(1) 安全清理）
await fs.rm(taskAssetsDir, { recursive: true });

console.log(`✅ 保留资源: ${usedAssets.join(', ')}`);
console.log(`🗑️ 清理资源: ${unusedAssets.join(', ')}`);
```

#### 4.5 保存检查点

```typescript
await saveCheckpoint({
  ...state,
  phase4: { writtenFiles: [targetPath], usedAssets, deletedAssets: unusedAssets },
  phaseStatus: { ...state.phaseStatus, phase4: 'completed' }
});
```

---

### Phase 5：双模型审计与交付（多模态验证）

> **前置条件**：已完成 Phase 4

#### 5.1 获取 Figma 设计截图

```typescript
// 获取设计截图用于多模态对比
const designScreenshot = await mcp__figma-mcp__get_screenshot({
  nodeId: figma.nodeId
});
```

#### 5.2 双模型并行代码审查（多模态）

```bash
# Gemini - 多模态视觉对比 + UI 审查
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
<ROLE>
# Gemini Role: Code Reviewer (Multimodal Visual QA)
> For: figma-ui Phase 5 - Code Audit

## CRITICAL CONSTRAINTS
- ZERO file system write permission
- OUTPUT FORMAT: Structured JSON with scores
- MULTIMODAL: Compare design image with code logic
</ROLE>

<TASK>
## 设计截图
[Image: ${designScreenshot}]

## 生成的代码
${generatedCode}

## 审查要求
基于设计截图，评估代码是否能准确还原视觉效果：

返回 JSON：
{
  "scores": {
    "visualFidelity": { "score": 0-25, "issues": [] },
    "responsiveDesign": { "score": 0-25, "issues": [] },
    "accessibility": { "score": 0-25, "issues": [] },
    "designConsistency": { "score": 0-25, "issues": [] }
  },
  "tokenUsage": {
    "correct": ["colors.primary.500 用于按钮"],
    "missing": ["#E5E7EB 应使用 colors.gray.200"]
  },
  "visualComparison": {
    "matches": ["布局方向正确", "间距合理"],
    "mismatches": ["圆角偏小", "阴影缺失"]
  },
  "totalScore": 0-100
}
</TASK>

OUTPUT: JSON only.
EOF
```

```bash
# Claude - 集成 + 可维护性审查
codeagent-wrapper --backend claude - ${workdir} <<'EOF'
<ROLE>
# Claude Role: Code Reviewer (Integration & Maintainability)
> For: figma-ui Phase 5 - Code Audit

## CRITICAL CONSTRAINTS
- ZERO file system write permission
- OUTPUT FORMAT: Structured JSON with scores
</ROLE>

<TASK>
## 生成的代码
${generatedCode}

## 项目上下文
${JSON.stringify(phase1Result.context)}

## 审查要求
评估代码的集成质量和可维护性：

返回 JSON：
{
  "scores": {
    "integration": { "score": 0-25, "issues": [] },
    "apiDesign": { "score": 0-25, "issues": [] },
    "maintainability": { "score": 0-25, "issues": [] },
    "bestPractices": { "score": 0-25, "issues": [] }
  },
  "typeCheck": {
    "errors": [],
    "warnings": []
  },
  "suggestions": [],
  "totalScore": 0-100
}
</TASK>

OUTPUT: JSON only.
EOF
```

#### 5.3 整合审查结果

```typescript
const [geminiReview, claudeReview] = await Promise.all([
  TaskOutput({ task_id: gemini_review_id }),
  TaskOutput({ task_id: claude_review_id })
]);

const geminiScore = parseJSON(geminiReview).totalScore;
const claudeScore = parseJSON(claudeReview).totalScore;
const totalScore = (geminiScore + claudeScore) / 2;

// 决策规则
let decision: 'pass' | 'review' | 'reject';
if (totalScore >= 90) {
  decision = 'pass';
} else if (totalScore >= 80) {
  decision = 'review';
} else {
  decision = 'reject';
}
```

#### 5.4 生成验证报告

自动生成 `.claude/verification-report-{taskId}.md`：

```markdown
# UI 还原验证报告

## 任务信息
- Task ID: ${taskId}
- 目标文件: ${targetPath}
- Figma 节点: ${figma.nodeId}

## 评分汇总

| 维度 | Gemini | Claude | 说明 |
|:-----|:-------|:-------|:-----|
| 视觉还原 | XX/25 | - | ... |
| 响应式设计 | XX/25 | - | ... |
| 可访问性 | XX/25 | - | ... |
| 设计一致性 | XX/25 | - | ... |
| 集成正确性 | - | XX/25 | ... |
| API 设计 | - | XX/25 | ... |
| 可维护性 | - | XX/25 | ... |
| 最佳实践 | - | XX/25 | ... |

**综合评分**: ${totalScore}/100
**决策**: ${decision}

## Token 使用情况
- 正确使用: ${tokenUsage.correct}
- 待改进: ${tokenUsage.missing}

## 多模态视觉对比
- 匹配项: ${visualComparison.matches}
- 差异项: ${visualComparison.mismatches}

## 资源清单
- 保留: ${usedAssets}
- 已删除: ${deletedAssets}

## 改进建议
${suggestions}
```

---

## 资源矩阵

| Phase | 功能 | 执行模式 | 输出约束 |
|:------|:-----|:---------|:---------|
| **Phase 1** | 并行初始化 | Subagent A + B 并行 | 精炼 JSON |
| **Phase 2** | 设计信息收集 | Figma MCP | 设计规范 + 隔离资源 |
| **Phase 3** | 双模型分析 | Gemini + Claude 并行 | 结构化 JSON |
| **Phase 4** | 原型 + 编码 | Gemini + Claude → 合并 | Token-First 代码 |
| **Phase 5** | 多模态审计 | Gemini(视觉) + Claude | JSON 评分 + 报告 |

---

## 错误处理与恢复

### 单模型失败策略

```typescript
async function runDualModel(geminiTask, claudeTask) {
  const results = await Promise.allSettled([geminiTask, claudeTask]);

  const failed = results.filter(r => r.status === 'rejected');

  if (failed.length === 2) {
    // 两个都失败：终止任务
    throw new Error('双模型调用均失败，请检查网络或配额');
  }

  if (failed.length === 1) {
    // 单个失败：重试 2 次
    const failedModel = failed[0].reason.model;
    for (let i = 0; i < 2; i++) {
      try {
        const retry = await retryTask(failedModel);
        return mergeResults(results, retry);
      } catch (e) {
        console.warn(`重试 ${i + 1}/2 失败`);
      }
    }

    // 重试耗尽：询问用户
    const userChoice = await AskUserQuestion({
      question: `${failedModel} 模型调用失败，是否允许单模型继续？`,
      options: [
        { label: '继续等待重试', description: '继续尝试调用失败的模型' },
        { label: '单模型继续', description: '使用成功模型的结果继续（标记为例外）' },
        { label: '终止任务', description: '停止当前工作流' }
      ]
    });

    // 根据用户选择处理
  }

  return results;
}
```

### 检查点恢复

```typescript
// CLI 恢复命令
// claude-workflow resume <taskId>

async function resumeWorkflow(taskId: string) {
  const state = await loadState(taskId);

  // 找到第一个未完成的阶段
  const pendingPhase = Object.entries(state.phaseStatus)
    .find(([_, status]) => status !== 'completed');

  if (!pendingPhase) {
    console.log('工作流已完成');
    return;
  }

  console.log(`从 ${pendingPhase[0]} 恢复执行`);
  await executeFromPhase(state, pendingPhase[0]);
}
```

---

## ⛔ Skill 完成检查清单（必须全部通过）

### Phase 1 检查
- [ ] ✅ 已并行启动 Subagent A（配置扫描）和 Subagent B（上下文检索）
- [ ] ✅ 收到精炼 JSON 结果（非全量文本）
- [ ] ✅ 已生成 taskId 并保存检查点

### Phase 2 检查
- [ ] ✅ 已创建任务隔离目录：`assetsDir/.figma-ui/tmp/<taskId>/`
- [ ] ✅ Figma MCP 调用使用隔离目录
- [ ] ✅ 资源已规范化命名
- [ ] ✅ 已保存检查点

### Phase 3 检查
- [ ] ✅ 已**并行**调用 Gemini + Claude 进行分析
- [ ] ✅ 收到结构化 JSON 输出
- [ ] ✅ 已生成 Token 映射表（设计值 → Design Token）
- [ ] ✅ 已向用户展示实施计划
- [ ] ✅ 已输出 **"Shall I proceed with this plan? (Y/N)"**
- [ ] ✅ 已收到用户确认（Y）

### Phase 4 检查
- [ ] ✅ 已**并行**调用 Gemini + Claude 生成原型
- [ ] ✅ 已进行交叉验证，识别各模型优势
- [ ] ✅ **Token-First**：代码优先使用 Design Token
- [ ] ✅ 视觉属性检查：布局、间距、尺寸、颜色、字体、圆角、阴影、z-index、opacity、overflow
- [ ] ✅ 资源安全清理（路径前缀验证 + 整目录清理）
- [ ] ✅ 已保存检查点

### Phase 5 检查
- [ ] ✅ 已获取 Figma 设计截图
- [ ] ✅ 已**并行**调用 Gemini（多模态视觉对比）+ Claude 审查
- [ ] ✅ 收到结构化 JSON 评分
- [ ] ✅ 已计算综合评分并做出决策
- [ ] ✅ 已生成验证报告

**如果任一检查项未通过，必须返回对应阶段执行，不可结束 Skill。**
