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
let noDiscuss = false;        // --no-discuss: 跳过需求分析讨论

// 解析标志
const flags = args.match(/--force|-f|--no-discuss/g) || [];
forceOverwrite = flags.some(f => f === '--force' || f === '-f');
noDiscuss = flags.some(f => f === '--no-discuss');

// 移除标志，获取需求内容
requirement = args
  .replace(/--force|-f|--no-discuss/g, '')
  .replace(/^["']|["']$/g, '')
  .trim();

if (!requirement) {
  console.log(`
❌ 请提供需求描述

用法：
  /workflow start "实现用户认证功能"
  /workflow start docs/prd.md           # 自动检测 .md 文件
  /workflow start -f "强制覆盖已有文件"
  /workflow start --no-discuss docs/prd.md  # 跳过需求讨论
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


### Step 1.3: 项目配置检查与自愈（强制）

**目的**：确保 `project-config.json` 存在，保障 projectId 可用，状态机可初始化。

```typescript
// 
// Step 1.3: 项目配置检查与自愈
// 
const configPath = '.claude/config/project-config.json';

if (fileExists(configPath)) {
  const config = JSON.parse(readFile(configPath));
  const projectId = config.project.id;
  if (!validate_project_id(projectId)) {
    console.log(' project-config.json 中的项目 ID 无效，请重新执行 /scan');
    return;
  }
  console.log(` 项目配置已加载: ${config.project.name} (${projectId})`);
} else {
  console.log(' 未找到 project-config.json，正在自动生成最小配置');
  const projectId = generateStableProjectId(process.cwd());
  const projectName = path.basename(process.cwd());
  const minimalConfig = {
    project: { id: projectId, name: projectName, type: 'single', bkProjectId: null },
    tech: { packageManager: 'unknown', buildTool: 'unknown', frameworks: [] },
    workflow: { enableBKMCP: false },
    _scanMode: 'auto-healed'
  };
  ensureDir('.claude/config');
  writeFile(configPath, JSON.stringify(minimalConfig, null, 2));
  console.log(` 最小配置已生成 (projectId: ${projectId})`);
  console.log(' 后续可执行 /scan --force 更新完整配置');
}

function generateStableProjectId(cwd: string): string {
  return crypto.createHash('md5').update(cwd.toLowerCase()).digest('hex').substring(0, 12);
}
```

> **关键变更**：`/workflow start` 不再因缺少 `project-config.json` 而阻塞。自动生成最小配置，确保 projectId 始终可用。

---


### Step 1.5: Git 状态检查（强制）

```typescript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 1.5: Git 状态检查
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 子代理（Spec 合规审查、代码质量审查）依赖 git worktree 进行隔离执行。
// 如果没有 git 仓库，子代理将无法创建。不允许静默降级。

interface GitStatus {
  ready: boolean;
  reason?: 'not_git_repo' | 'no_commits';
  message?: string;
}

function checkGitStatus(): GitStatus {
  try {
    const isGitRepo = execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim() === 'true';

    if (!isGitRepo) {
      return {
        ready: false,
        reason: 'not_git_repo',
        message: '当前项目不在 git 仓库中。子代理需要 git worktree 进行隔离。'
      };
    }

    const hasCommits = execSync('git log --oneline -1', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().length > 0;

    if (!hasCommits) {
      return {
        ready: false,
        reason: 'no_commits',
        message: 'Git 仓库没有初始提交。请先提交一次后再启动工作流。'
      };
    }

    return { ready: true };
  } catch {
    return {
      ready: false,
      reason: 'not_git_repo',
      message: '无法检测 git 状态。请确认项目在 git 仓库中。'
    };
  }
}

const gitStatus = checkGitStatus();

if (!gitStatus.ready) {
  console.log(`
⚠️ Git 状态检查未通过

${gitStatus.message}

推荐操作：
${gitStatus.reason === 'not_git_repo'
  ? '  git init && git add . && git commit -m "Initial commit"'
  : '  git add . && git commit -m "Initial commit"'}

原因：workflow 的子代理（Spec 合规审查、代码质量审查）依赖 git worktree
进行隔离执行。如果没有 git 仓库，子代理将无法创建，导致所有审查降级为
主会话内执行，损失审查独立性。
  `);

  // HARD-GATE: 不允许静默降级
  const gitChoice = await AskUserQuestion({
    questions: [{
      question: '请选择如何处理：',
      header: 'Git 状态检查',
      multiSelect: false,
      options: [
        { label: '我来初始化 git', description: '暂停工作流，手动执行 git init + commit 后重试' },
        { label: '无子代理继续', description: '⚠️ 放弃子代理隔离，所有审查在主会话执行' }
      ]
    }]
  });

  if (gitChoice === '我来初始化 git') {
    console.log('⏸️ 请初始化 git 仓库后重新执行 /workflow start');
    return;
  }

  // 用户显式选择了降级，记录到状态
  state.git_status = {
    initialized: false,
    subagent_available: false,
    user_acknowledged_degradation: true
  };
  console.log('⚠️ 用户选择无子代理模式。所有审查将在主会话中执行。');
} else {
  state.git_status = {
    initialized: true,
    subagent_available: true,
    user_acknowledged_degradation: false
  };
}
```

---

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
- Phase 0.2: 需求分析讨论（识别需求与现有架构的冲突、发现缺失项）
- Phase 0.3: UX 设计审批（为前端/GUI 需求补充页面结构与导航约束）
- Phase 1: Spec 生成（填充架构设计、文件结构与约束章节）
- Phase 2: Plan 生成（识别可复用组件、确定实施顺序与任务文件清单）
- Execute: 任务执行与并行分组（注入依赖、blocked_by 与任务级引用）
- 约束系统初始化（提取技术约束）
