---
description: UI 还原工作流 - 从 Figma 设计稿快速生成生产代码
argument-hint: "\"<Figma URL 或节点 ID>\" \"<目标代码路径>\" [可选描述]"
allowed-tools: SlashCommand(*), Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), mcp__figma-mcp__(*), mcp__gemini__(*), mcp__codex__(*), AskUserQuestion(*)
examples:
  - /workflow-ui-restore
    "https://www.figma.com/file/xxxxx?node-id=123:456" "apps/agent/src/components/UserProfile.tsx"
  - /workflow-ui-restore
    "node-id=789:012" "apps/agent/src/components/Settings/ProfileCard.tsx" "更新头像显示样式"
  - /workflow-ui-restore
---

# UI 还原工作流

从 Figma 设计稿到生产代码的 3 步自动化工作流。

**适用场景**：
- ✅ 有明确的 Figma 设计稿
- ✅ 需要高保真还原设计
- ✅ 注重组件复用和代码质量

**关键特性**：
- 🎨 自动提取 Figma 设计规范
- 🤖 **Gemini 生成前端代码原型**（前端设计的代码基点）
- 📐 智能识别可复用组件
- ✅ Codex 自动化质量验证

**配置依赖**：`.claude/config/project-config.json`

**工作目录**：从配置自动读取（`project.rootDir`）

---

## 📋 使用方法

### 命令格式

```bash
/workflow-ui-restore "<Figma URL 或节点 ID>" "<目标代码路径>" [可选描述]
```

### 参数说明

**必需参数**：
1. **Figma URL 或节点 ID**：设计稿来源
   - 完整 URL：`https://www.figma.com/file/xxxxx?node-id=123:456`
   - 节点 ID：`node-id=123:456`

2. **目标代码路径**：组件保存位置（相对于项目根目录）
   - 新建组件：`src/components/NewComponent.tsx` 或 `apps/应用名/src/components/NewComponent.tsx`
   - 修改现有：`src/components/ExistingCard.tsx` 或 `apps/应用名/src/components/ExistingCard.tsx`

**可选参数**：
3. **描述**：补充说明（如"更新头像显示样式"）

### 使用示例

```bash
# 示例 1：新建用户资料组件
/workflow-ui-restore \
  "https://figma.com/file/xxx?node-id=123:456" \
  "src/components/UserProfile.tsx"

# 示例 2：修改现有卡片组件（Monorepo 项目）
/workflow-ui-restore \
  "node-id=789:012" \
  "apps/应用名/src/components/Settings/ProfileCard.tsx" \
  "根据新设计稿更新布局和样式"

# 示例 3：移动端页面还原
/workflow-ui-restore \
  "https://figma.com/file/yyy" \
  "src/pages/mobile/ChatPage.tsx"
```

---

## 🚀 执行流程（3 步）

### 第 0 步：参数验证（自动）⭐

**触发条件**：用户未提供完整参数

**验证逻辑**：
1. 检查是否提供 Figma URL/节点 ID
2. 检查是否提供目标代码路径
3. 如有缺失，使用 `AskUserQuestion` 向用户询问

**示例询问**：

```typescript
// 缺少 Figma URL
AskUserQuestion({
  questions: [{
    question: "请提供 Figma 设计稿的 URL 或节点 ID？",
    header: "设计稿来源",
    multiSelect: false,
    options: [
      {
        label: "输入完整 Figma URL",
        description: "例如：https://www.figma.com/file/xxxxx?node-id=123:456"
      },
      {
        label: "输入节点 ID",
        description: "例如：123:456（如果已在 Figma 文件中）"
      }
    ]
  }]
})

// 缺少目标路径
AskUserQuestion({
  questions: [{
    question: "请提供组件的目标保存路径？",
    header: "代码路径",
    multiSelect: false,
    options: [
      {
        label: "新建组件",
        description: "创建新的组件文件（请在「其他」中输入完整路径）"
      },
      {
        label: "修改现有组件",
        description: "修改已有组件（请在「其他」中输入文件路径）"
      }
    ]
  }]
})
```

**重要**：
- ✅ 必须获得完整参数后才能继续执行
- ✅ 路径必须是绝对路径或相对于项目根目录的路径
- ✅ 自动判断是新建还是修改（通过检查文件是否存在）

---

### 第 1 步：收集设计信息（自动化）

#### 1.1 获取 Figma 设计上下文

使用 Figma MCP 获取设计规范：

```typescript
// 调用 Figma MCP 获取设计上下文
mcp__figma-mcp__get_design_context({
  figma_url: "<用户提供的 URL>",
  node_id: "<可选节点 ID>"
})
```

**返回信息**：
- 颜色规范（主色、辅助色、状态色）
- 文字规范（字体、字号、行高）
- 间距规范（padding、margin、gap）
- 圆角和阴影规范
- 组件层级结构

#### 1.2 获取设计截图（推荐）

```typescript
// 获取高清截图用于对比
mcp__figma-mcp__get_screenshot({
  node_id: "<节点 ID>",
  scale: 2  // 2x 高清
})
```

#### 1.3 加载项目 UI 上下文

```bash
/analyze "UI 还原：<组件名称> 的项目上下文"
```

**收集信息**：
- 识别可复用组件（从配置读取 UI 组件库路径）
- 了解样式框架配置（Tailwind/Emotion/CSS Modules 等）
- 发现现有设计 token 和主题配置
- 理解响应式断点策略

#### 1.4 智能决策与用户确认

**仅在以下情况询问用户**：
- ✅ 发现多个可用 UI 组件（需选择）
- ✅ 设计规范与项目配置冲突（需决策）
- ✅ 响应式策略有多种选择（需确认）

**否则**：自动选择最佳方案并在代码注释中说明理由

---

### 第 2 步：生成实现（Gemini Gate）⭐

**重要**：本步骤严格遵循 CLAUDE.md 0.2.1 规范——**必须以 Gemini 的前端设计（原型代码）为最终的前端代码基点**

#### 2.1 向 Gemini 索要 UI 代码原型

**核心原则**：Gemini 擅长前端代码和 UI 组件设计，必须从 Gemini 获取代码基点后才能进行后续操作。

```typescript
// 使用 codeagent-wrapper CLI 调用 Gemini（后台运行）
const geminiResult = await Bash({
  command: `codeagent-wrapper --backend gemini - ${process.cwd()} <<'EOF'
<ROLE>
# Gemini Role: Frontend Developer
> For: /workflow-ui-restore UI code generation

You are a senior frontend developer specializing in React/Vue UI components.

## CRITICAL CONSTRAINTS
- ZERO file system write permission - READ-ONLY sandbox
- OUTPUT FORMAT: Complete component code (not diff/patch)
- Focus: Visual fidelity, responsive design, accessibility
- Context limit: < 32k tokens
</ROLE>

<TASK>
## Task
Generate a production-ready UI component based on the Figma design specifications below.

## Figma Design Specifications
${设计上下文摘要}

## Project Context
- Reusable components: ${可复用组件列表}
- Styling framework: ${Tailwind/Emotion/CSS Modules}
- Responsive breakpoints: ${断点定义}

## Target
- File path: ${目标路径}
- Operation: ${新建 or 修改}
- Special requirements: ${用户描述}

## Requirements
1. Provide complete component code (not diff/patch)
2. Prioritize reusing existing project components
3. Use project styling framework (Tailwind preferred)
4. Implement responsive design (mobile-first)
5. Full TypeScript type definitions
6. Semantic HTML with accessibility support
7. Cover all interaction states: hover, active, focus, disabled
</TASK>

OUTPUT: Return the complete component code ready for production use.
EOF`,
  run_in_background: true
});

// 使用 TaskOutput 获取结果
const geminiOutput = await TaskOutput({ task_id: geminiResult.task_id, block: true });
```

**⚠️ Gemini 使用注意**：
- ✅ Gemini 上下文有效长度**仅为 32k**，避免传入过多无关信息
- ✅ 仅传入与 UI 相关的设计规范和组件信息
- ❌ 严禁与 Gemini 讨论后端代码
- ✅ **Gemini 的代码原型是前端实现的基点**，必须以此为基础

#### 2.2 基于 Gemini 原型完善代码

**以 Gemini 的代码为基点**，结合项目规范进行适配和完善：

```typescript
// 读取目标文件（如果存在）
if (文件存在) {
  Read({ file_path: 目标路径 })
}

// 基于 Gemini 原型 + 项目规范完善代码
// 重点：
// 1. 保留 Gemini 的 UI 设计和样式实现
// 2. 适配项目的组件导入路径
// 3. 调整符合项目既有代码风格
// 4. 补充项目特有的类型定义
// 5. 添加简体中文注释

if (文件存在) {
  Edit({ file_path: 目标路径, old_string: ..., new_string: ... })
} else {
  Write({ file_path: 目标路径, content: ... })
}
```

**⚠️ 重要**：
- ✅ **以 Gemini 的 UI 代码为基点**，不要大幅重构其设计
- ✅ 仅做必要的项目适配（导入路径、类型、命名规范）
- ❌ 不要质疑 Gemini 的样式和布局决策（除非明显错误）

**代码规范**：
- ✅ 优先级：复用组件 > 样式框架 > 扩展配置 > 自定义 CSS
- ✅ 响应式：移动优先（mobile-first）
- ✅ 交互状态：hover、active、focus、disabled 全覆盖
- ✅ 可访问性：语义化 HTML、alt、label、键盘导航

---

### 第 3 步：质量验证（Codex Review）

#### 3.1 Codex 代码审查

```typescript
// 使用 codeagent-wrapper CLI 调用 Codex（后台运行）
const codexResult = await Bash({
  command: `codeagent-wrapper --backend codex - ${process.cwd()} <<'EOF'
<ROLE>
# Codex Role: UI Code Reviewer
> For: /workflow-ui-restore quality verification

You are a senior frontend code reviewer specializing in UI component quality.

## CRITICAL CONSTRAINTS
- ZERO file system write permission - READ-ONLY sandbox
- OUTPUT FORMAT: Structured review with scores
- Focus: Visual fidelity, code quality, accessibility

## Scoring Format
UI REVIEW REPORT
================
Visual Fidelity: XX/20 - [reason]
Code Quality: XX/20 - [reason]
Responsive Design: XX/20 - [reason]
Accessibility: XX/20 - [reason]
Component Reuse: XX/20 - [reason]
─────────────────────────
TOTAL SCORE: XX/100
</ROLE>

<TASK>
审查以下 UI 组件实现：

## 文件路径
${目标路径}

## 审查要点
1. 是否符合 Figma 设计稿？
2. 是否复用了项目组件？
3. Tailwind 使用是否规范？
4. 响应式设计是否完整？
5. 代码可读性和可维护性如何？
</TASK>

OUTPUT: 请按照 UI REVIEW REPORT 格式输出评分和具体建议。
EOF`,
  run_in_background: true
});

// 使用 TaskOutput 获取结果
const codexOutput = await TaskOutput({ task_id: codexResult.task_id, block: true });
```

#### 3.3 生成验证报告

自动生成 `.claude/verification-report-{task_name}.md`：

**报告内容**：
- ✅ 视觉还原度评分
- ✅ 代码质量评分
- ✅ 响应式设计评分
- ✅ 可访问性评分
- ✅ 综合评分和建议
- ✅ 已知问题和改进方向

**决策规则**：
- 综合评分 ≥ 90 分 → 通过
- 综合评分 < 80 分 → 退回修改
- 80-89 分 → 仔细审阅后决策

---

## 📊 核心原则

### 1. 样式使用优先级

```
1. 复用现有组件（从配置读取 UI 组件库路径）
2. 使用样式框架（Tailwind/Emotion/CSS Modules 等，从配置读取）
3. 扩展样式框架配置（设计 token）
4. 自定义 CSS（仅必要时）
```

### 2. 响应式设计原则

```tsx
// 移动优先布局（示例：Tailwind）
<div className="
  flex flex-col gap-4 p-4           // 移动端默认
  md:flex-row md:gap-6 md:p-6      // 平板
  lg:gap-8 lg:p-8                  // 桌面
">
```

### 3. 组件结构设计

```
页面/容器组件
  ├── 布局组件（Layout/Grid）
  │   ├── 可复用组件（从配置读取路径）
  │   └── 自定义组件
  └── 交互组件（Button/Modal）
```

### 4. 代码质量要求

- ✅ TypeScript 类型完整
- ✅ 简体中文注释
- ✅ 语义化 HTML
- ✅ 可访问性支持
- ✅ 性能优化

---

## ⚠️ 重要提醒

### 必须做到

1. **参数验证**：缺少参数时必须询问用户
2. **Gemini 优先**：UI 代码必须先从 Gemini 获取原型，以此为基点
3. **Gemini 32k 限制**：注意上下文长度，仅传入 UI 相关信息
4. **Codex Review**：编码后必须使用 Codex 执行 review
5. **简体中文**：所有注释、文档、回复必须使用简体中文

### 禁止操作

- ❌ 跳过 Gemini 直接编写 UI 代码
- ❌ 大幅修改 Gemini 的样式和布局设计
- ❌ 向 Gemini 传入后端代码或过多无关信息
- ❌ 未经 Codex review 就提交代码
- ❌ 使用英文注释或文档

---

## 📚 扩展阅读

**详细指南**：[docs/ui-restoration-guide.md](../../docs/ui-restoration-guide.md)
- Tailwind 最佳实践
- 响应式设计模式详解
- 完整示例代码
- 常见问题解答
- 质量检查清单

**相关工作流**：
- `/workflow-quick-dev` - 快速功能开发工作流
- `/diff-review` - 代码变更审查
- `/analyze "项目上下文"` - 上下文加载

**项目规范**：
- [CLAUDE.md](../../CLAUDE.md) - 项目开发规范
- [README.md](../../README.md) - 项目概述

---

**Figma MCP 工具**：
- `mcp__figma-mcp__get_design_context` - 获取设计上下文
- `mcp__figma-mcp__get_screenshot` - 获取设计截图

**Gemini 调用**（UI 代码生成）：
- `codeagent-wrapper --backend gemini` - 前端代码原型生成（⚠️ 32k 上下文限制）
- 使用 `<ROLE>` 和 `<TASK>` 标签结构化提示词
- 使用 `run_in_background: true` 后台运行

**Codex 调用**（代码审查）：
- `codeagent-wrapper --backend codex` - 代码质量审查（只读模式）
- 使用 `<ROLE>` 和 `<TASK>` 标签结构化提示词
- 使用 `TaskOutput` 获取结果
