# Phase 0.3: UX 设计审批（HARD-GATE）

## 目的

在 Spec 生成前，强制完成用户操作流程图设计和页面分层规划，避免功能堆砌和信息架构缺失。

> 本阶段属于 **HARD-GATE**。设计未经用户批准不得进入 Spec 生成。
> 借鉴 superpowers/brainstorming 的设计审批机制 + Trellis 的 spec 分层体系。

## 执行时机

**条件执行**：Phase 0.2 需求讨论完成后，Phase 1 Spec 生成之前。

### 触发条件

```typescript
function shouldRunUXDesignGate(
  requirementContent: string,
  analysisResult: AnalysisResult,
  discussionArtifact: DiscussionArtifact | null
): boolean {
  // 1. 需求包含 UI/页面/交互关键词
  const uiKeywords = /页面|界面|表单|列表|面板|弹窗|导航|路由|仪表盘|编辑器|sidebar|tab|modal|dashboard|GUI|桌面|desktop|窗口|window/i;
  if (uiKeywords.test(requirementContent)) return true;

  // 2. 代码分析检测到前端框架
  const hasFrontend = analysisResult.patterns.some(p =>
    /react|vue|angular|svelte|tauri|electron|next\.?js|nuxt|vite/i.test(p.name)
  );
  if (hasFrontend) return true;

  // 3. 需求讨论中涉及交互行为或边界场景
  if (discussionArtifact?.clarifications.some(c =>
    c.dimension === 'behavior' || c.dimension === 'edge-case'
  )) return true;

  // 4. 不满足触发条件（CLI 工具、纯后端等）
  return false;
}
```

> **跳过情况**：纯后端服务、CLI 工具、库/SDK 等不涉及用户界面的项目自动跳过。

## 实现细节

### Step 1: 生成用户操作流程图

基于需求内容和讨论工件，生成覆盖完整用户旅程的 Mermaid 流程图。

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 Phase 0.3: UX 设计审批
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// ── 生成用户操作流程图 ──
const flowchart = generateUserFlowchart(requirementContent, analysisResult, discussionArtifact);

console.log(`
## 用户操作流程图

\`\`\`mermaid
${flowchart.mermaidCode}
\`\`\`

**覆盖场景**：
${flowchart.scenarios.map(s => `- ${s.name}: ${s.description}`).join('\n')}
`);
```

**流程图必须覆盖**：

| 场景 | 说明 | 示例 |
|------|------|------|
| 首次使用 | 新用户第一次打开时的引导路径 | 工作区配置向导 |
| 核心操作 | 从入口到完成核心功能的操作路径 | 创建 → 编辑 → 保存 → 同步 |
| 异常/边界 | 操作失败、数据为空、权限不足等 | 同步失败 → 重试 / 回退 |
| 返回/取消 | 中途取消、返回上一步 | 编辑取消 → 确认弃改 |

```typescript
interface UserFlowchart {
  mermaidCode: string;
  scenarios: Array<{
    name: string;         // 首次使用 / 核心操作 / 异常处理 / 返回取消
    description: string;
    coveredNodes: string[];
  }>;
}

function generateUserFlowchart(
  requirement: string,
  analysis: AnalysisResult,
  discussion: DiscussionArtifact | null
): UserFlowchart {
  // 从需求中提取用户角色、操作动词、目标对象
  const actors = extractActors(requirement);
  const actions = extractActions(requirement);
  const objects = extractObjects(requirement);

  // 基于讨论工件中的澄清结果补充边界场景
  const edgeCases = discussion?.clarifications
    .filter(c => c.dimension === 'edge-case' || c.dimension === 'behavior')
    .map(c => c.answer) ?? [];

  // 生成 Mermaid 流程图
  // ... 实现逻辑
}
```

### Step 2: 页面分层设计

生成页面信息架构表，明确每个功能放在哪个层级。

```typescript
// ── 生成页面分层设计 ──
const pageHierarchy = generatePageHierarchy(requirementContent, analysisResult, discussionArtifact);

console.log(`
## 页面信息架构

| 层级 | 页面/区域 | 包含功能 | 导航方式 |
|------|----------|---------|---------|
${pageHierarchy.pages.map(p =>
  `| ${p.level} | ${p.name} | ${p.features.join('、')} | ${p.navigation} |`
).join('\n')}

**功能分布**：
- 首页/总览：${pageHierarchy.pages.filter(p => p.level === 'L0').flatMap(p => p.features).length} 个功能
- 功能页：${pageHierarchy.pages.filter(p => p.level === 'L1').length} 个页面
- 辅助面板：${pageHierarchy.pages.filter(p => p.level === 'L2').length} 个面板
`);
```

**分层规则**：

| 层级 | 定义 | 功能模块上限 | 说明 |
|------|------|-------------|------|
| L0 首页 | 用户打开应用后看到的第一个页面 | ≤ 4 | 总览、快速操作、状态摘要 |
| L1 功能页 | 需要路由/导航切换才能访问的独立页面 | ≤ 6 | 编辑器、设置、列表 |
| L2 辅助面板 | 内嵌在 L1 页面中的辅助区域 | ≤ 3 | 校验、日志、属性面板 |

```typescript
interface PageHierarchy {
  pages: PageDefinition[];
  navigation: NavigationStructure;
}

interface PageDefinition {
  level: 'L0' | 'L1' | 'L2';
  name: string;
  features: string[];
  navigation: string;      // 侧边栏 / 标签页 / 路由 / 内嵌面板
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface NavigationStructure {
  type: 'sidebar' | 'tabs' | 'router' | 'hybrid';
  routes: string[];
}
```

### Step 3: 自动工作目录探测

检测并建议关联的 agent 工作目录（仅在需求涉及多 agent 同步时触发）。

```typescript
// ── 工作目录探测（条件执行） ──
const needsWorkspaceDetection = /同步|sync|agent|workspace|工作区|目录/i.test(requirementContent);

let detectedWorkspaces: AgentWorkspace[] = [];

if (needsWorkspaceDetection) {
  detectedWorkspaces = detectAgentWorkspaces();

  if (detectedWorkspaces.length > 0) {
    console.log(`
## 检测到的 Agent 工作目录

${detectedWorkspaces.map(w =>
  `- **${w.agent}**: \`${w.path}\` ${w.detected ? '✅ 已检测到' : '❌ 未找到'}`
).join('\n')}

> 建议在 Spec 的 Constraints 章节中预设这些路径，避免用户手动输入。
    `);
  }
}

interface AgentWorkspace {
  agent: string;       // claude-code / cursor / codex
  path: string;
  detected: boolean;
}

function detectAgentWorkspaces(): AgentWorkspace[] {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const workspaces: AgentWorkspace[] = [];

  // Claude Code
  const claudeDir = path.join(os.homedir(), '.claude');
  workspaces.push({
    agent: 'claude-code',
    path: claudeDir,
    detected: fs.existsSync(claudeDir)
  });

  // Cursor
  const cursorPaths = [
    path.join(os.homedir(), '.cursor'),
    ...(process.platform === 'win32'
      ? [path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor')]
      : [path.join(os.homedir(), '.config', 'Cursor')])
  ];
  const cursorDetected = cursorPaths.find(p => fs.existsSync(p));
  workspaces.push({
    agent: 'cursor',
    path: cursorDetected || cursorPaths[0],
    detected: !!cursorDetected
  });

  // Codex
  const codexDir = path.join(os.homedir(), '.codex');
  workspaces.push({
    agent: 'codex',
    path: codexDir,
    detected: fs.existsSync(codexDir)
  });

  return workspaces;
}
```

### Step 4: HARD-GATE 用户批准

```typescript
// ── HARD-GATE：用户必须批准才能继续 ──
let designApproved = false;

while (!designApproved) {
  const uxChoice = await AskUserQuestion({
    questions: [{
      question: '请确认用户操作流程和页面分层设计是否合理？',
      header: 'UX 设计审批 (HARD-GATE)',
      multiSelect: false,
      options: [
        { label: '设计合理，继续', description: '进入 Spec 生成' },
        { label: '需要调整流程', description: '修改操作流程后重新审批' },
        { label: '需要调整页面分层', description: '修改信息架构后重新审批' },
        { label: '需要补充场景', description: '添加遗漏的用户场景' }
      ]
    }]
  });

  if (uxChoice === '设计合理，继续') {
    designApproved = true;
  } else if (uxChoice === '需要调整流程') {
    const flowRevision = await AskUserQuestion({
      questions: [{
        question: '请描述需要调整的操作流程：',
        header: '流程调整'
      }]
    });
    // 基于用户反馈重新生成流程图
    Object.assign(flowchart, regenerateFlowchart(flowchart, flowRevision));
    console.log(`\n\`\`\`mermaid\n${flowchart.mermaidCode}\n\`\`\`\n`);
  } else if (uxChoice === '需要调整页面分层') {
    const hierarchyRevision = await AskUserQuestion({
      questions: [{
        question: '请描述需要调整的页面分层：',
        header: '分层调整'
      }]
    });
    Object.assign(pageHierarchy, regenerateHierarchy(pageHierarchy, hierarchyRevision));
    // 重新展示页面分层表
  } else if (uxChoice === '需要补充场景') {
    const additionalScenario = await AskUserQuestion({
      questions: [{
        question: '请描述需要补充的用户场景：',
        header: '补充场景'
      }]
    });
    // 将新场景添加到流程图
    Object.assign(flowchart, addScenarioToFlowchart(flowchart, additionalScenario));
    console.log(`\n\`\`\`mermaid\n${flowchart.mermaidCode}\n\`\`\`\n`);
  }
}
```

### Step 5: 持久化设计工件

```typescript
// ── 持久化 UX 设计工件 ──
const uxDesignArtifact: UXDesignArtifact = {
  timestamp: new Date().toISOString(),
  flowchart: flowchart,
  pageHierarchy: pageHierarchy,
  detectedWorkspaces: detectedWorkspaces,
  approvedAt: new Date().toISOString()
};

ensureDir(workflowDir);
const uxArtifactPath = path.join(workflowDir, 'ux-design-artifact.json');
writeFile(uxArtifactPath, JSON.stringify(uxDesignArtifact, null, 2));

console.log(`
✅ UX 设计审批通过

🎨 操作流程：${flowchart.scenarios.length} 个场景
📐 页面分层：${pageHierarchy.pages.length} 个页面/区域
${detectedWorkspaces.length > 0 ? `🔍 工作目录：${detectedWorkspaces.filter(w => w.detected).length} 个已检测到` : ''}
📄 设计工件：${uxArtifactPath}
`);
```

## 数据结构

```typescript
interface UXDesignArtifact {
  timestamp: string;
  flowchart: UserFlowchart;
  pageHierarchy: PageHierarchy;
  detectedWorkspaces: AgentWorkspace[];
  approvedAt: string;
}
```

## 与后续阶段的衔接

UX 设计工件通过结构化传递给 Phase 1 Spec 生成：

```typescript
// Phase 1: Spec 生成时消费 UX 设计工件
// generateSpec(requirementContent, analysisResult, discussionArtifact, uxDesignArtifact)
//   → spec 的 "User-facing Behavior" 章节包含流程图
//   → spec 的 "Architecture and Module Design" 章节包含页面分层
//   → spec 的 "Constraints" 章节包含预设工作目录
```

## 强制规则

- 流程图必须覆盖至少 3 个场景（首次使用、核心操作、异常处理）
- 页面分层中 L0 首页不得超过 4 个功能模块
- HARD-GATE 未通过时不得进入 Phase 1 Spec 生成
- 设计工件必须持久化为 JSON 文件，供后续阶段消费和审计
