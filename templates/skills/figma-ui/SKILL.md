---
name: figma-ui
description: "REQUIRED workflow for Figma-to-code UI restoration. MUST invoke this skill IMMEDIATELY when: (1) user shares any figma.com or figma.design URL, (2) user mentions 还原/切图/设计稿/UI实现/前端开发/Figma, (3) user asks to implement/restore/build/convert UI from design. Do NOT call mcp__figma-mcp tools directly - always use this skill first."
---

# UI 还原工作流

从 Figma 设计稿到生产代码的 4 步自动化工作流。

---

## ⛔ 强制执行规则（HARD STOP）

> **以下规则违反任一条即视为严重错误，必须立即停止并修正：**

### 规则 1：资源路径必须先于 Figma MCP 调用

```
❌ 错误顺序：mcp__figma-mcp__get_design_context() → 获取资源路径
✅ 正确顺序：获取资源路径 → mcp__figma-mcp__get_design_context(dirForAssetWrites=绝对路径)
```

**检查点**：调用 `mcp__figma-mcp__get_design_context` 之前，必须已经：
1. 使用 Glob 工具扫描项目目录结构
2. 确定 `dirForAssetWrites` 的绝对路径
3. 如果无法确定，使用 AskUserQuestion 询问用户

### 规则 2：Gemini 原型生成不可跳过

```
❌ 错误：直接编写 UI 代码
✅ 正确：先调用 Gemini 获取原型 → 基于原型完善代码
```

**检查点**：在写入任何 UI 代码之前，必须已经：
1. 调用 `codeagent-wrapper --backend gemini` 获取代码原型
2. 等待 Gemini 返回完整组件代码
3. 以 Gemini 代码为基点进行适配

### 规则 3：资源清理必须在 Skill 结束前执行

```
❌ 错误：代码生成完成后直接结束
✅ 正确：代码生成 → 检查资源引用 → 删除未使用资源 → 结束
```

**检查点**：在 Skill 结束之前，必须已经：
1. 读取生成的代码文件
2. 扫描 assetsDir 中本组件相关的资源
3. 删除代码中未引用的资源文件
4. 向用户报告删除的资源列表

---

## 执行流程概览

```
┌─────────────────────────────────────────────────────────────────┐
│ 第 0 步：参数验证与资源路径获取                                    │
│ ├─ 解析 Figma URL/nodeId                                        │
│ ├─ 确定目标代码路径                                              │
│ └─ 【HARD STOP】获取 dirForAssetWrites（绝对路径）                │
├─────────────────────────────────────────────────────────────────┤
│ 第 1 步：收集设计信息                                            │
│ ├─ 调用 Figma MCP（必须带 dirForAssetWrites）                    │
│ └─ 资源重命名                                                    │
├─────────────────────────────────────────────────────────────────┤
│ 第 2 步：生成实现                                                │
│ ├─ 【HARD STOP】调用 Gemini 获取 UI 代码原型                     │
│ └─ 基于 Gemini 原型完善代码                                      │
├─────────────────────────────────────────────────────────────────┤
│ 第 3 步：质量验证与资源清理                                       │
│ ├─ Codex 代码审查                                               │
│ └─ 【HARD STOP】删除未使用的资源文件                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心流程

### 第 0 步：参数验证与资源路径获取（必须先于 Figma MCP 调用）

> **⚠️ 关键约束**：必须在调用任何 Figma MCP 工具之前完成本步骤，否则会因缺少 `dirForAssetWrites` 参数导致调用失败。

**验证逻辑**：
1. 检查是否提供 Figma URL/节点 ID
2. 检查是否提供目标代码路径
3. **获取静态资源路径**（必须）
4. 如有缺失，使用 `AskUserQuestion` 向用户询问

**静态资源路径获取顺序**：

```
1. 从目标路径推断（如 apps/reelmate/components/X.vue → apps/reelmate/public/assets）
2. 从项目配置读取（.claude/config/project-config.json）
3. 自动发现（扫描常见目录）
4. 询问用户
```

**执行步骤**：

```typescript
// Step 0.1: 从目标路径推断资源目录
function inferAssetsDirFromTarget(targetPath: string): string | null {
  // 提取项目根目录（Monorepo 场景）
  const match = targetPath.match(/^(apps\/[^\/]+|packages\/[^\/]+)/);
  if (match) {
    const projectRoot = match[1];
    // 检查常见资源目录
    const candidates = [
      `${projectRoot}/public/assets`,
      `${projectRoot}/src/assets`,
      `${projectRoot}/assets`
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
    // 返回默认目录（即使不存在，Figma MCP 会创建）
    return `${projectRoot}/public/assets`;
  }
  return null;
}

// Step 0.2: 从项目配置读取
function getAssetsDirFromConfig(): string | null {
  const configPath = ".claude/config/project-config.json";
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.customPaths?.assets || config.customPaths?.staticAssets;
  }
  return null;
}

// Step 0.3: 自动发现
async function discoverAssetsPath(): Promise<string> {
  const candidates = [
    'public/assets',
    'public/images',
    'src/assets',
    'assets',
    'static',
    'public'
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return 'public/assets';  // 默认
}

// 完整获取逻辑
async function resolveAssetsDir(targetPath: string): Promise<string> {
  // 优先从目标路径推断
  let assetsDir = inferAssetsDirFromTarget(targetPath);
  if (assetsDir) return assetsDir;

  // 其次从配置读取
  assetsDir = getAssetsDirFromConfig();
  if (assetsDir) return assetsDir;

  // 最后自动发现
  return discoverAssetsPath();
}
```

**实际执行示例**：

```
目标路径: apps/reelmate/components/MobileNotSupported.vue
↓
推断资源目录: apps/reelmate/public/assets
↓
调用 Figma MCP 时使用: dirForAssetWrites = "/absolute/path/to/apps/reelmate/public/assets"
```

---

### 第 1 步：收集设计信息（自动化）

> **前置条件**：已通过第 0 步获取到 `assetsDir`（绝对路径）

#### 1.1 获取 Figma 设计上下文

```typescript
// 确保 assetsDir 是绝对路径
const absoluteAssetsDir = path.resolve(process.cwd(), assetsDir);

// ⚠️ 关键：调用 Figma MCP 前记录现有文件列表
const existingFiles = new Set(await fs.readdir(absoluteAssetsDir).catch(() => []));

mcp__figma-mcp__get_design_context({
  nodeId: "<节点 ID>",
  clientFrameworks: "vue,nuxt",  // 或 "react" 等，根据项目
  clientLanguages: "typescript",
  dirForAssetWrites: absoluteAssetsDir  // 必须是绝对路径
})

// ⚠️ 关键：调用后对比文件列表，识别新下载的资源
const allFiles = await fs.readdir(absoluteAssetsDir);
const newlyDownloadedFiles = allFiles.filter(f => !existingFiles.has(f));
// 例如: ['7f48748b8ba283a69c9061e41bd9578c0d540f0c.svg', 'abc123def456.png']
```

**返回信息**：
- 颜色规范（主色、辅助色、状态色）
- 文字规范（字体、字号、行高）
- 间距规范（padding、margin、gap）
- 圆角和阴影规范
- 组件层级结构
- **图片/图标资源**（自动下载到 assetsDir，命名为 hash 格式如 `7f48748b8ba283a69c9061e41bd9578c0d540f0c.svg`）

#### 1.2 资源下载与重命名

Figma MCP 下载资源后，**必须对所有资源文件进行重命名**：

**支持的资源类型**：
```
图片: .png, .jpg, .jpeg, .webp, .gif, .avif
矢量: .svg
视频: .mp4, .webm
其他: .pdf, .json (Lottie 动画)
```

**重命名规则**：

```typescript
// 资源命名规则
function renameAsset(originalName: string, usage: string, componentName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const sanitizedUsage = usage.toLowerCase().replace(/\s+/g, '-');

  // 格式: <组件名>-<用途>.<扩展名>
  // 例如: mobile-not-supported-illustration.png, login-background.svg
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
  if (name.includes('illustration') || name.includes('illus')) return 'illustration';
  if (name.includes('photo') || name.includes('image')) return 'photo';
  if (name.includes('thumbnail') || name.includes('thumb')) return 'thumbnail';

  return 'asset';  // 默认
}

// 批量重命名已下载的资源
// 参数 newlyDownloadedFiles：来自 1.1 步骤对比得到的新下载文件列表
// 返回值包含：原始文件列表（用于清理）和重命名映射
interface RenameResult {
  assetMapping: Map<string, string>;  // 原名 -> 新名
  allOriginalFiles: string[];         // 所有处理过的原始文件名（包括重命名失败的）
}

async function renameDownloadedAssets(
  assetsDir: string,
  componentName: string,
  newlyDownloadedFiles: string[]  // ⚠️ 只处理本次下载的文件
): Promise<RenameResult> {
  const assetMapping = new Map<string, string>();  // 原名 -> 新名
  const allOriginalFiles: string[] = [];          // 记录所有原始文件，用于清理
  const supportedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.mp4', '.webm', '.pdf', '.json'];

  for (const file of newlyDownloadedFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!supportedExtensions.includes(ext)) continue;

    // 记录原始文件名（无论是否成功重命名）
    allOriginalFiles.push(file);

    const usage = detectAssetUsage({ name: file });
    const newName = renameAsset(file, usage, componentName);

    const oldPath = path.join(assetsDir, file);
    const newPath = path.join(assetsDir, newName);

    if (oldPath !== newPath) {
      try {
        await fs.rename(oldPath, newPath);
        assetMapping.set(file, newName);
        console.log(`✅ 重命名: ${file} -> ${newName}`);
      } catch (error) {
        console.warn(`⚠️ 重命名失败: ${file} -> ${newName}`, error);
        // 重命名失败时，记录原文件名（确保清理时能找到它）
        assetMapping.set(file, file);
      }
    } else {
      // 文件名相同，视为已处理（比如已经符合命名规范的文件）
      assetMapping.set(file, file);
    }
  }

  console.log(`📦 资源追踪: 共 ${assetMapping.size} 个文件已记录到 assetMapping`);
  return { assetMapping, allOriginalFiles };
}
```

#### 1.3 资源清理（删除未使用的资源）

> **重要**：在代码生成完成后，必须清理未被引用的资源文件。

```typescript
// 在第 2 步代码生成完成后执行
// 参数 assetMapping：来自 renameDownloadedAssets 的返回值，记录了原名->新名的映射
async function cleanupUnusedAssets(
  assetsDir: string,
  componentCode: string,
  assetMapping: Map<string, string>  // 关键：使用重命名阶段记录的映射
): Promise<string[]> {
  const deletedFiles: string[] = [];

  // 遍历所有本次下载的资源（通过 assetMapping 追踪，而非文件名模式匹配）
  for (const [originalName, currentName] of assetMapping.entries()) {
    const filePath = path.join(assetsDir, currentName);

    // 检查文件是否仍然存在
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️ 资源文件不存在，跳过: ${currentName}`);
      continue;
    }

    // 检查资源是否在代码中被引用（检查当前文件名和无扩展名版本）
    const fileNameWithoutExt = currentName.replace(/\.[^.]+$/, '');
    const isUsed = componentCode.includes(currentName) ||
                   componentCode.includes(fileNameWithoutExt);

    if (!isUsed) {
      await fs.unlink(filePath);
      deletedFiles.push(currentName);
      console.log(`🗑️ 已删除未使用的资源: ${currentName}`);
    }
  }

  return deletedFiles;
}
```

**资源清理时机**：
1. 第 2 步代码生成完成后
2. Codex Review 确认代码无误后
3. 最终交付前

#### 1.4 加载项目 UI 上下文

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

### 第 3 步：质量验证与资源清理

> **⛔ 本步骤包含强制执行的资源清理，不可跳过**

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

#### 3.2 资源清理（⛔ 强制执行）

> **此步骤必须在 Skill 结束前执行，不可跳过！**

**前置条件**：第 1 步的 `renameDownloadedAssets` 返回的 `assetMapping` 必须保留到此步骤。

**执行步骤**：

```typescript
// 步骤 3.2.1: 读取生成的代码文件
const componentCode = await Read({ file_path: 目标路径 });

// 步骤 3.2.2: 使用 assetMapping 获取本次下载的所有资源
// 注意：assetMapping 来自第 1 步 renameDownloadedAssets 的返回值
// 它记录了原始文件名到当前文件名的映射，包括：
// - 成功重命名的文件：originalName -> newName
// - 未改变名称的文件：fileName -> fileName
const unusedAssets: string[] = [];

for (const [originalName, currentName] of assetMapping.entries()) {
  const filePath = path.join(assetsDir, currentName);

  // 检查文件是否仍然存在
  if (!fs.existsSync(filePath)) continue;

  // 检查代码中是否引用了该资源
  const fileNameWithoutExt = currentName.replace(/\.[^.]+$/, '');
  const isUsed = componentCode.includes(currentName) ||
                 componentCode.includes(fileNameWithoutExt);

  if (!isUsed) {
    unusedAssets.push(filePath);
  }
}

// 步骤 3.2.3: 删除未使用的资源
for (const unusedAsset of unusedAssets) {
  await Bash({ command: `rm "${unusedAsset}"` });
  console.log(`🗑️ 已删除未使用的资源: ${path.basename(unusedAsset)}`);
}

// 步骤 3.2.4: 向用户报告
if (unusedAssets.length > 0) {
  console.log(`\n📋 资源清理报告：已删除 ${unusedAssets.length} 个未使用的资源文件`);
  unusedAssets.forEach(f => console.log(`  - ${path.basename(f)}`));
} else {
  console.log(`\n✅ 资源清理完成：所有资源均被代码引用，无需删除`);
}
```

**关键变更**：
- ❌ 旧逻辑：使用 Glob 模式 `${componentName}-*.*` 匹配文件（会遗漏未重命名的文件）
- ✅ 新逻辑：使用 `assetMapping` 追踪所有本次下载的资源（确保无遗漏）

**实际执行示例**：

```
组件: MobileNotSupported.vue
资源目录: /Users/ws/dev/project/apps/reelmate/assets/images

第 1.1 步 - Figma MCP 调用前后对比:
  调用前现有文件: [other-component-bg.png, logo.svg]
  Figma MCP 下载后: [other-component-bg.png, logo.svg, 7f48748b8ba283a69c9061e41bd9578c0d540f0c.svg, abc123def456.png]
  新下载的文件: [7f48748b8ba283a69c9061e41bd9578c0d540f0c.svg, abc123def456.png]

第 1.2 步 - 资源重命名 (只处理新下载的文件):
  7f48748b8ba283a69c9061e41bd9578c0d540f0c.svg -> mobile-not-supported-illustration.svg ✅
  abc123def456.png                              -> mobile-not-supported-icon.png ✅
  📦 资源追踪: 共 2 个文件已记录到 assetMapping

第 3 步 - 资源清理 (使用 assetMapping 追踪):
  检查 mobile-not-supported-illustration.svg → 代码中已引用 ✅
  检查 mobile-not-supported-icon.png         → 代码中未引用 ❌

执行删除:
  🗑️ 已删除未使用的资源: mobile-not-supported-icon.png

📋 资源清理报告：已删除 1 个未使用的资源文件
```

**关键优势**：
1. 通过前后对比识别新下载的文件（如 `7f48748b8ba283a69c9061e41bd9578c0d540f0c.svg`）
2. 使用 `assetMapping` 追踪资源，确保所有新下载的文件都会被正确清理
3. 不影响其他组件的资源文件

#### 3.3 生成验证报告

自动生成 `.claude/verification-report-{task_name}.md`：

**报告内容**：
- 视觉还原度评分
- 代码质量评分
- 响应式设计评分
- 可访问性评分
- 综合评分和建议
- 已知问题和改进方向
- 资源清单（保留的资源列表）
- **已删除资源清单**（清理的资源列表）

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
    console.log("⚠️ 配置文件不存在，请先运行 /scan");
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

1. **⚠️ 资源路径优先**：**必须**在调用 Figma MCP 之前获取 `dirForAssetWrites`，否则调用会失败
2. **参数验证**：缺少参数时必须询问用户
3. **路径推断**：优先从目标路径推断资源目录（Monorepo 场景）
4. **配置读取**：其次从 project-config.json 读取资源路径
5. **绝对路径**：传给 Figma MCP 的 `dirForAssetWrites` 必须是绝对路径
6. **⚠️ 文件对比**：调用 Figma MCP **前后**必须对比文件列表，识别新下载的资源（如 `7f48...svg`）
7. **资源重命名**：**所有**新下载的资源（png/jpg/jpeg/webp/gif/svg 等）都必须按规则重命名
8. **资源追踪**：使用 `assetMapping` 记录所有新下载的资源（包括重命名失败的），确保清理时无遗漏
9. **资源清理**：代码生成完成后，使用 `assetMapping` 追踪并删除未被引用的资源文件
10. **Gemini 优先**：UI 代码必须先从 Gemini 获取原型
11. **Codex Review**：编码后必须使用 Codex 执行 review
12. **简体中文**：所有注释、文档、回复必须使用简体中文

### 禁止操作

- **未获取资源路径就调用 Figma MCP**（会导致调用失败）
- **未记录现有文件就调用 Figma MCP**（无法识别新下载的资源）
- **保留未使用的资源文件**（必须清理）
- **只重命名部分资源类型**（所有图片/矢量/视频都要重命名）
- **使用 Glob 模式匹配清理资源**（会遗漏未重命名的文件，必须使用 assetMapping）
- 跳过 Gemini 直接编写 UI 代码
- 大幅修改 Gemini 的样式和布局设计
- 向 Gemini 传入后端代码或过多无关信息
- 未经 Codex review 就提交代码
- 使用英文注释或文档
- 资源放置在错误的目录
- 使用相对路径作为 `dirForAssetWrites`

---

## 相关工作流

- `/workflow-quick-dev` - 快速功能开发工作流
- `/diff-review` - 代码变更审查
- `/analyze "项目上下文"` - 上下文加载
- `/scan` - 智能项目扫描

**Figma MCP 工具**：
- `mcp__figma-mcp__get_design_context` - 获取设计上下文（含资源下载）
- `mcp__figma-mcp__get_screenshot` - 获取设计截图

**Gemini 调用**（UI 代码生成）：
- `codeagent-wrapper --backend gemini` - 前端代码原型生成
- 使用 `<ROLE>` 和 `<TASK>` 标签结构化提示词

**Codex 调用**（代码审查）：
- `codeagent-wrapper --backend codex` - 代码质量审查

---

## ⛔ Skill 完成检查清单（必须全部通过）

> **在结束 figma-ui skill 之前，必须逐项确认以下检查点：**

### 第 0 步检查
- [ ] ✅ 已使用 Glob 扫描项目目录结构
- [ ] ✅ 已确定 `dirForAssetWrites` 的绝对路径
- [ ] ✅ 首次调用 Figma MCP 时已携带 `dirForAssetWrites` 参数

### 第 1 步检查
- [ ] ✅ **调用 Figma MCP 前**已记录资源目录中的现有文件列表
- [ ] ✅ Figma MCP 调用成功返回设计上下文
- [ ] ✅ **调用后**已对比得到新下载的文件列表（如 `7f48...c.svg`）
- [ ] ✅ 资源文件已按规则重命名
- [ ] ✅ `assetMapping` 已记录所有新下载的资源（包括重命名失败的）

### 第 2 步检查
- [ ] ✅ 已调用 `codeagent-wrapper --backend gemini` 获取代码原型
- [ ] ✅ 已等待 Gemini 返回完整组件代码
- [ ] ✅ 已基于 Gemini 原型完善并写入代码

### 第 3 步检查
- [ ] ✅ 已调用 Codex 进行代码审查
- [ ] ✅ **已执行资源清理**：使用 `assetMapping` 追踪所有资源，删除未被代码引用的文件
- [ ] ✅ 已向用户报告资源清理结果（包括删除的文件列表）

**如果任一检查项未通过，必须返回对应步骤执行，不可结束 Skill。**
