---
name: workflow-ui-restore
description: UI 还原工作流 - 从 Figma 设计稿快速生成生产代码。当用户需要根据 Figma 设计稿还原 UI、创建组件、或提供 Figma 链接要求生成代码时触发。
---

# UI 还原工作流

从 Figma 设计稿到生产代码的 3 步自动化工作流。

## 核心流程

### 第 0 步：参数验证与配置加载

**触发条件**：用户未提供完整参数

**验证逻辑**：
1. 检查是否提供 Figma URL/节点 ID
2. 检查是否提供目标代码路径
3. 加载项目配置，获取静态资源路径
4. 如有缺失，使用 `AskUserQuestion` 向用户询问

**配置加载**：

```typescript
// 读取项目配置
const configPath = ".claude/config/project-config.json";
let assetsDir = null;

if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assetsDir = config.customPaths?.assets || config.customPaths?.staticAssets;
}

// 如果配置中没有资源路径，自动发现
if (!assetsDir) {
  assetsDir = await discoverAssetsPath();
  // 写入配置
  await updateProjectConfig('customPaths.assets', assetsDir);
}
```

**静态资源路径自动发现**：

```typescript
async function discoverAssetsPath() {
  // 按优先级检查常见资源目录
  const candidates = [
    'public/assets',
    'public/images',
    'src/assets',
    'src/assets/images',
    'assets',
    'static',
    'public',
    // Monorepo 项目
    'apps/*/public/assets',
    'apps/*/src/assets',
    'packages/ui/assets'
  ];

  for (const pattern of candidates) {
    const matches = await glob(pattern);
    if (matches.length > 0) {
      return matches[0];
    }
  }

  // 未找到则创建默认目录
  const defaultDir = 'public/assets';
  await fs.ensureDir(defaultDir);
  return defaultDir;
}
```

---

### 第 1 步：收集设计信息（自动化）

#### 1.1 获取 Figma 设计上下文

```typescript
mcp__figma-mcp__get_design_context({
  nodeId: "<节点 ID>",
  clientFrameworks: "react",
  clientLanguages: "typescript",
  dirForAssetWrites: assetsDir  // 使用配置的资源路径
})
```

**返回信息**：
- 颜色规范（主色、辅助色、状态色）
- 文字规范（字体、字号、行高）
- 间距规范（padding、margin、gap）
- 圆角和阴影规范
- 组件层级结构
- **图片/图标资源**（自动下载到 assetsDir）

#### 1.2 资源下载与重命名

Figma MCP 下载资源后，按以下规则重命名：

```typescript
// 资源命名规则
function renameAsset(originalName: string, usage: string, componentName: string): string {
  const ext = path.extname(originalName);
  const sanitizedUsage = usage.toLowerCase().replace(/\s+/g, '-');

  // 格式: <组件名>-<用途>.<扩展名>
  // 例如: user-profile-avatar.png, login-background.svg
  return `${componentName.toLowerCase()}-${sanitizedUsage}${ext}`;
}

// 资源用途检测
function detectAssetUsage(node: FigmaNode): string {
  const name = node.name.toLowerCase();

  if (name.includes('icon')) return 'icon';
  if (name.includes('avatar')) return 'avatar';
  if (name.includes('bg') || name.includes('background')) return 'background';
  if (name.includes('logo')) return 'logo';
  if (name.includes('banner')) return 'banner';
  if (name.includes('illustration')) return 'illustration';

  return 'image';  // 默认
}
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

---

### 第 2 步：生成实现（Gemini Gate）

**重要**：本步骤必须以 Gemini 的前端设计（原型代码）为最终的前端代码基点。

#### 2.1 向 Gemini 索要 UI 代码原型

```typescript
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
- Assets directory: ${assetsDir}

## Target
- File path: ${目标路径}
- Operation: ${新建 or 修改}
- Special requirements: ${用户描述}

## Asset References
Use the following asset paths in your code:
${资源路径列表}

## Requirements
1. Provide complete component code (not diff/patch)
2. Prioritize reusing existing project components
3. Use project styling framework (Tailwind preferred)
4. Implement responsive design (mobile-first)
5. Full TypeScript type definitions
6. Semantic HTML with accessibility support
7. Cover all interaction states: hover, active, focus, disabled
8. Reference assets using the provided paths
</TASK>

OUTPUT: Return the complete component code ready for production use.
EOF`,
  run_in_background: true
});
```

**注意事项**：
- Gemini 上下文有效长度**仅为 32k**，避免传入过多无关信息
- 仅传入与 UI 相关的设计规范和组件信息
- **Gemini 的代码原型是前端实现的基点**，必须以此为基础

#### 2.2 基于 Gemini 原型完善代码

以 Gemini 的代码为基点，结合项目规范进行适配和完善：

```typescript
if (文件存在) {
  Edit({ file_path: 目标路径, old_string: ..., new_string: ... })
} else {
  Write({ file_path: 目标路径, content: ... })
}
```

**代码规范**：
- 优先级：复用组件 > 样式框架 > 扩展配置 > 自定义 CSS
- 响应式：移动优先（mobile-first）
- 交互状态：hover、active、focus、disabled 全覆盖
- 可访问性：语义化 HTML、alt、label、键盘导航

---

### 第 3 步：质量验证（Codex Review）

#### 3.1 Codex 代码审查

```typescript
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
6. 资源引用路径是否正确？
</TASK>

OUTPUT: 请按照 UI REVIEW REPORT 格式输出评分和具体建议。
EOF`,
  run_in_background: true
});
```

#### 3.2 生成验证报告

自动生成 `.claude/verification-report-{task_name}.md`：

**报告内容**：
- 视觉还原度评分
- 代码质量评分
- 响应式设计评分
- 可访问性评分
- 综合评分和建议
- 已知问题和改进方向
- 资源清单（下载的资源列表）

**决策规则**：
- 综合评分 ≥ 90 分 → 通过
- 综合评分 < 80 分 → 退回修改
- 80-89 分 → 仔细审阅后决策

---

## 配置更新

### 静态资源路径配置

如果项目配置中没有静态资源路径，本 skill 会：

1. **自动发现**：扫描常见资源目录
2. **写入配置**：将发现的路径写入 `project-config.json`

```typescript
async function updateProjectConfig(fieldPath: string, value: string) {
  const configPath = ".claude/config/project-config.json";

  if (!fs.existsSync(configPath)) {
    console.log("⚠️ 配置文件不存在，请先运行 /init-project-config");
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // 设置嵌套字段
  const keys = fieldPath.split('.');
  let obj = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;

  // 更新时间戳
  config.metadata.lastUpdated = new Date().toISOString();

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`✅ 已更新配置: ${fieldPath} = ${value}`);
}
```

### project-config.json 资源路径字段

```json
{
  "customPaths": {
    "assets": "public/assets",
    "staticAssets": "public/assets",
    "images": "public/assets/images",
    "icons": "public/assets/icons"
  }
}
```

---

## 核心原则

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

### 3. 资源引用规范

```tsx
// 正确的资源引用方式
import userAvatar from '@/assets/user-profile-avatar.png';
// 或
<img src="/assets/user-profile-avatar.png" alt="用户头像" />
```

---

## 注意事项

### 必须做到

1. **参数验证**：缺少参数时必须询问用户
2. **配置读取**：优先从 project-config.json 读取资源路径
3. **路径自动发现**：配置缺失时自动扫描并写入配置
4. **Gemini 优先**：UI 代码必须先从 Gemini 获取原型
5. **资源重命名**：下载的资源按用途重命名
6. **Codex Review**：编码后必须使用 Codex 执行 review
7. **简体中文**：所有注释、文档、回复必须使用简体中文

### 禁止操作

- 跳过 Gemini 直接编写 UI 代码
- 大幅修改 Gemini 的样式和布局设计
- 向 Gemini 传入后端代码或过多无关信息
- 未经 Codex review 就提交代码
- 使用英文注释或文档
- 资源放置在错误的目录

---

## 相关工作流

- `/workflow-quick-dev` - 快速功能开发工作流
- `/diff-review` - 代码变更审查
- `/analyze "项目上下文"` - 上下文加载
- `/init-project-config` - 初始化项目配置

**Figma MCP 工具**：
- `mcp__figma-mcp__get_design_context` - 获取设计上下文（含资源下载）
- `mcp__figma-mcp__get_screenshot` - 获取设计截图

**Gemini 调用**（UI 代码生成）：
- `codeagent-wrapper --backend gemini` - 前端代码原型生成
- 使用 `<ROLE>` 和 `<TASK>` 标签结构化提示词

**Codex 调用**（代码审查）：
- `codeagent-wrapper --backend codex` - 代码质量审查
