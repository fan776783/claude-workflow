# Phase 0: 代码分析详情

## 目的

在设计前充分理解代码库，避免重复造轮子，确保新功能与现有架构一致。

## 执行时机

**强制执行**：每次启动工作流时必须执行

## 实现细节

### Step 1: 参数解析

```typescript
const args = $ARGUMENTS.join(' ');
let requirement = '';
let forceOverwrite = false;   // --force / -f: 强制覆盖已有文件

// 解析标志
const flags = args.match(/--force|-f/g) || [];
forceOverwrite = flags.some(f => f === '--force' || f === '-f');

// 移除标志，获取需求内容
requirement = args
  .replace(/--force|-f/g, '')
  .replace(/^["']|["']$/g, '')
  .trim();

if (!requirement) {
  console.log(`
❌ 请提供需求描述

用法：
  /workflow start "实现用户认证功能"
  /workflow start docs/prd.md        # 自动检测 .md 文件
  /workflow start -f "强制覆盖已有文件"
  `);
  return;
}

// 自动检测：.md 结尾且文件存在 → 文件模式
let requirementSource = 'inline';
let requirementContent = requirement;

if (requirement.endsWith('.md') && fileExists(requirement)) {
  requirementSource = requirement;
  requirementContent = readFile(requirement);
  console.log(`📄 需求文档：${requirement}\n`);
} else {
  console.log(`📝 需求描述：${requirement}\n`);
}
```

### Step 2: 使用 codebase-retrieval 分析

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Phase 0: 代码分析
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 使用 codebase-retrieval 分析相关代码
const codeContext = await mcp__auggie-mcp__codebase-retrieval({
  information_request: `
    分析与以下需求相关的代码：

    需求：${requirementContent}

    请提供：
    1. 相关现有实现文件（可复用或需修改）
    2. 可继承的基类、可复用的工具类
    3. 相似功能的实现参考（作为模式参考）
    4. 技术约束（数据库、框架、规范、错误处理模式）
    5. 需要注意的依赖关系
  `
});
```

### Step 3: 解析分析结果

```typescript
// 解析代码分析结果
const analysisResult = {
  relatedFiles: extractRelatedFiles(codeContext),
  reusableComponents: extractReusableComponents(codeContext),
  patterns: extractPatterns(codeContext),
  constraints: extractConstraints(codeContext),
  dependencies: extractDependencies(codeContext)
};

console.log(`
✅ 代码分析完成

📁 相关文件：${analysisResult.relatedFiles.length} 个
🔧 可复用组件：${analysisResult.reusableComponents.length} 个
📐 架构模式：${analysisResult.patterns.length} 个
⚠️ 技术约束：${analysisResult.constraints.length} 个
`);
```

## 数据结构

### AnalysisResult

```typescript
interface AnalysisResult {
  relatedFiles: RelatedFile[];
  reusableComponents: ReusableComponent[];
  patterns: Pattern[];
  constraints: string[];
  dependencies: Dependency[];
}

interface RelatedFile {
  path: string;
  purpose: string;
  reuseType: 'modify' | 'reference' | 'extend';
}

interface ReusableComponent {
  path: string;
  description: string;
  purpose: string;
}

interface Pattern {
  name: string;
  description: string;
}

interface Dependency {
  name: string;
  type: 'internal' | 'external';
  reason: string;
}
```

## 辅助函数

### extractRelatedFiles

从 codebase-retrieval 结果中提取相关文件列表。

```typescript
function extractRelatedFiles(codeContext: string): RelatedFile[] {
  // 解析 codeContext，提取文件路径和用途
  // 返回 RelatedFile 数组
}
```

### extractReusableComponents

从 codeContext 中提取可复用组件。

```typescript
function extractReusableComponents(codeContext: string): ReusableComponent[] {
  // 识别基类、工具类、通用组件
  // 返回 ReusableComponent 数组
}
```

### extractPatterns

从 codeContext 中提取架构模式。

```typescript
function extractPatterns(codeContext: string): Pattern[] {
  // 识别常见模式：MVC、Repository、Factory 等
  // 返回 Pattern 数组
}
```

### extractConstraints

从 codeContext 中提取技术约束。

```typescript
function extractConstraints(codeContext: string): string[] {
  // 提取约束：数据库类型、框架版本、编码规范等
  // 返回约束字符串数组
}
```

### extractDependencies

从 codeContext 中提取依赖关系。

```typescript
function extractDependencies(codeContext: string): Dependency[] {
  // 识别内部依赖和外部依赖
  // 返回 Dependency 数组
}
```

## 输出

分析结果将用于后续阶段：
- Phase 0.5: 需求结构化提取（提供代码上下文）
- Phase 0.6: 验证清单生成（提供验证参考）
- Phase 0.7: 实现指南生成（提供技术栈信息）
- Phase 1: 技术方案生成（填充"代码分析结果"章节）
- Phase 2: 任务生成（识别可复用组件、确定依赖关系）
- 约束系统初始化（提取技术约束）
