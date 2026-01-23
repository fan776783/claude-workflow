---
description: 检查工作流当前状态并推荐下一步操作
allowed-tools: Read(*), Glob(*)
---

# 工作流状态检查（v2）

读取 workflow-state.json + tasks.md，生成进度报告。

---

## 共享工具函数

```typescript
// ═══════════════════════════════════════════════════════════════
// Util 1: 统一路径安全函数
// ═══════════════════════════════════════════════════════════════

function resolveUnder(baseDir: string, relativePath: string): string | null {
  if (!relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.includes('..')) {
    return null;
  }
  if (!/^[a-zA-Z0-9_\-\.\/]+$/.test(relativePath)) {
    return null;
  }
  if (/^\/|\/\/|\/\s*$/.test(relativePath)) {
    return null;
  }
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);
  if (resolved !== normalizedBase &&
      !resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }
  return resolved;
}

// ═══════════════════════════════════════════════════════════════
// Util 2: 统一状态 Emoji 处理
// ═══════════════════════════════════════════════════════════════

const STATUS_EMOJI_REGEX = /(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;
const STRIP_STATUS_EMOJI_REGEX = /\s*(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;

function extractStatusFromTitle(title: string): string | null {
  const match = title.match(STATUS_EMOJI_REGEX);
  if (!match) return null;
  const emoji = match[0].trim();
  if (emoji === '✅') return 'completed';
  if (emoji === '⏳') return 'in_progress';
  if (emoji === '❌') return 'failed';
  if (emoji.startsWith('⏭')) return 'skipped';
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Util 3: 正则转义 + 质量关卡解析
// ═══════════════════════════════════════════════════════════════

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseQualityGate(body: string): boolean {
  const match = body.match(/\*\*质量关卡\*\*:\s*(true|false)/i);
  if (!match) return false;
  return match[1].toLowerCase() === 'true';
}
```

---



## 🔍 检查逻辑

### Step 1：定位工作流目录

```typescript
const cwd = process.cwd();
const configPath = '.claude/config/project-config.json';

if (!fileExists(configPath)) {
  console.log(`
❌ 未发现项目配置

当前路径：${cwd}

💡 请先执行扫描命令：/scan
  `);
  return;
}

const projectConfig = JSON.parse(readFile(configPath));
const projectId = projectConfig.project?.id;

if (!projectId) {
  console.log(`🚨 项目配置缺少 project.id，请重新执行 /scan`);
  return;
}

// 路径安全校验：projectId 只允许字母数字和连字符
if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
  console.log(`🚨 项目 ID 包含非法字符: ${projectId}`);
  return;
}

const workflowDir = path.join(os.homedir(), '.claude/workflows', projectId);
const statePath = path.join(workflowDir, 'workflow-state.json');

if (!fileExists(statePath)) {
  console.log(`
❌ 未发现工作流任务

当前项目：${projectConfig.project.name}
项目 ID：${projectId}
预期路径：${statePath}

💡 开始新的工作流：
  /workflow-start "功能需求描述"
  /workflow-start --backend "PRD文档路径"
  `);
  return;
}

console.log(`
📂 工作流目录：${workflowDir}
🆔 项目 ID：${projectId}
`);
```

---

### Step 2：读取工作流状态

```typescript
const state = JSON.parse(readFile(statePath));

// 使用统一路径安全函数校验 tasks_file
const tasksPath = resolveUnder(workflowDir, state.tasks_file);
if (!tasksPath) {
  console.log(`🚨 任务文件路径不安全: ${state.tasks_file}`);
  return;
}

// 检查任务文件
if (!fileExists(tasksPath)) {
  console.log(`
⚠️ 任务清单不存在：${tasksPath}

状态文件存在，但任务清单缺失。
可能是工作流创建过程中断。

💡 建议：重新启动工作流
  /workflow-start "原始需求"
  `);
  return;
}

const tasksContent = readFile(tasksPath);

// 解析任务
const tasks = parseTasksFromMarkdown(tasksContent);
const totalTasks = tasks.length;

// 如果没有解析到任务，输出诊断信息
if (totalTasks === 0) {
  console.log(`
⚠️ 无法解析任务清单

任务文件：${tasksPath}
可能原因：
- 文件格式不符合预期（需要 ## T1: 或 ### T1: 格式的标题）
- 文件内容为空

💡 请检查文件格式是否符合 tasks.md 模板
  `);
  return;
}

// 统计各状态
const completed = state.progress.completed.length;
const skipped = state.progress.skipped.length;
const failed = state.progress.failed.length;
const blocked = state.progress.blocked?.length || 0;  // 渐进式工作流：阻塞任务
const pending = totalTasks - completed - skipped - failed - blocked;

// 计算进度（安全版本：防止 NaN）
const progressPercent = totalTasks > 0
  ? Math.round((completed + skipped) / totalTasks * 100)
  : 0;

// 渐进式工作流：获取已解除的依赖
const unblocked = state.unblocked || [];
const isProgressive = state.mode === 'progressive';
```

---

### Step 3：生成状态报告

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **工作流状态报告**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**任务名称**：{{state.task_name}}
**状态**：{{state.status}}
{{#if isProgressive}}**工作模式**：渐进式{{/if}}
**启动时间**：{{state.started_at}}
**最后更新**：{{state.updated_at}}

{{#if isProgressive}}
---

## 🔗 依赖状态

| 依赖类型 | 状态 |
|---------|------|
| api_spec (后端接口) | {{unblocked.includes('api_spec') ? '✅ 已就绪' : '⏳ 等待中'}} |
| design_spec (设计稿) | {{unblocked.includes('design_spec') ? '✅ 已就绪' : '⏳ 等待中'}} |

{{#if (unblocked.length < 2)}}
💡 **解除阻塞**：
\`\`\`bash
{{#unless unblocked.includes('api_spec')}}/workflow-unblock api_spec    # 后端接口已就绪{{/unless}}
{{#unless unblocked.includes('design_spec')}}/workflow-unblock design_spec # 设计稿已就绪{{/unless}}
\`\`\`
{{/if}}
{{/if}}

---

## 📈 进度概览

**总进度**：{{progressPercent}}%（{{completed + skipped}} / {{totalTasks}}）

{{generateProgressBar(progressPercent)}}

{{#if state.contextMetrics}}
**上下文使用率**：{{state.contextMetrics.usagePercent}}%

{{generateContextBar(state.contextMetrics.usagePercent, state.contextMetrics.warningThreshold, state.contextMetrics.dangerThreshold)}}

{{#if (state.contextMetrics.usagePercent > state.contextMetrics.dangerThreshold)}}
🚨 **上下文使用率过高！** 强烈建议新开会话继续执行。
{{else if (state.contextMetrics.usagePercent > state.contextMetrics.warningThreshold)}}
⚠️ 上下文使用率较高，建议减少连续执行任务数或新开会话。
{{/if}}
{{/if}}

| 状态 | 数量 |
|------|------|
| ✅ 已完成 | {{completed}} |
| ⏭️ 已跳过 | {{skipped}} |
| ❌ 失败 | {{failed}} |
{{#if blocked}}| ⏳ 阻塞中 | {{blocked}} |{{/if}}
| ⏸️ 待执行 | {{pending}} |

---

## 📄 设计文档

📐 **技术方案**：`{{state.tech_design}}`

---

## 📋 任务清单

📝 **任务文件**：`{{tasksPath}}`

{{#each tasks}}
{{statusIcon(this.status)}} **{{this.id}}**: {{this.name}}
   {{#if this.file}}文件: `{{this.file}}`{{/if}}
   {{#if this.blocked_by}}⏳ 等待: `{{this.blocked_by.join(', ')}}`{{/if}}
   阶段: {{this.phase}}
{{/each}}

---

## 📍 当前任务

{{#if state.status === 'completed'}}
🎉 **工作流已完成！**

所有 {{totalTasks}} 个任务已执行完毕。

{{else}}
{{#with currentTask}}
**任务 {{id}}**：{{name}}
**阶段**：{{phase}}
**状态**：{{status}}
{{#if file}}**文件**：`{{file}}`{{/if}}
{{#if leverage}}**复用**：`{{leverage}}`{{/if}}
{{#if design_ref}}**设计参考**：{{design_ref}}{{/if}}

**需求**：{{requirement}}
**动作**：`{{actions}}`

{{#if quality_gate}}
⚠️ **这是质量关卡**：评分需 ≥ {{threshold}}
{{/if}}
{{/with}}
{{/if}}

---

## 🎯 质量关卡

{{#each state.quality_gates}}
**{{@key}}**：
- 任务ID：{{task_id}}
- 阈值：{{threshold}}
- 评分：{{actual_score || '待执行'}}
- 状态：{{passed === true ? '✅ 通过' : (passed === false ? '❌ 失败' : '⏸️ 待执行')}}
{{/each}}

{{#if hasFailedGates}}
⚠️ **存在未通过的质量关卡，需要修复后重试**
{{/if}}

---

## 📦 产物文件

| 类型 | 路径 |
|------|------|
| 技术方案 | `{{state.tech_design}}` |
| 任务清单 | `{{tasksPath}}` |
{{#each state.artifacts}}
| {{@key}} | `{{this}}` |
{{/each}}

---

## 🚀 下一步操作

{{#if state.status === 'completed'}}
### 🎉 工作流已完成

**总任务数**：{{totalTasks}}
**已完成**：{{completed}}
**已跳过**：{{skipped}}

**产物文件**：
- 技术方案：`{{state.tech_design}}`
- 任务清单：`{{tasksPath}}`

{{else if state.status === 'planned'}}
### 📋 规划完成，等待执行

工作流已完成规划阶段，请审查技术方案和任务清单后开始执行。

{{#if isProgressive}}
🔄 **工作模式**：渐进式

| 依赖类型 | 状态 |
|---------|------|
| api_spec (后端接口) | {{unblocked.includes('api_spec') ? '✅ 已就绪' : '⏳ 等待中'}} |
| design_spec (设计稿) | {{unblocked.includes('design_spec') ? '✅ 已就绪' : '⏳ 等待中'}} |

{{#if blocked}}
**阻塞的任务**：{{blocked}} 个（等待依赖解除后可执行）
{{/if}}
{{/if}}

**技术方案**：`{{state.tech_design}}`
**任务清单**：`{{tasksPath}}`

**开始执行**：
\```bash
/workflow-execute
\```

{{#if isProgressive}}
💡 渐进式工作流：可先执行无阻塞的任务，阻塞任务需等待依赖就绪后通过 `/workflow-unblock` 解除。
{{else}}
💡 执行后将自动复用规划阶段的模型会话上下文。
{{/if}}

{{else if state.status === 'blocked'}}
### ⏳ 工作流等待依赖

当前所有可执行任务均被阻塞，等待外部依赖解除。

**阻塞的任务**：{{state.progress.blocked.join(', ')}}

**解除阻塞**：
\```bash
{{#unless unblocked.includes('api_spec')}}/workflow-unblock api_spec    # 后端接口已就绪{{/unless}}
{{#unless unblocked.includes('design_spec')}}/workflow-unblock design_spec # 设计稿已就绪{{/unless}}
\```

{{else if hasFailedTask}}
### ⚠️ 存在失败任务

**失败任务**：{{failedTaskId}}
**失败原因**：{{failedReason}}

**建议操作**：
1. 查看失败原因并修复
2. 重试当前步骤：`/workflow-retry-step`
3. 或跳过（慎用）：`/workflow-skip-step`

{{else}}
### ✅ 准备就绪

**下一个任务**：{{currentTask.id}} - {{currentTask.name}}
**阶段**：{{currentTask.phase}}

**执行命令**：
\```bash
/workflow-execute
\```

{{#if currentTask.quality_gate}}
💡 **提示**：下一步是质量关卡，评分需达到 {{currentTask.threshold}} 分
{{/if}}
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 📦 辅助函数

```typescript
function parseTasksFromMarkdown(content: string): Task[] {
  const tasks: Task[] = [];

  // 新正则：捕获完整标题，后续处理 emoji
  const regex = /##+ (T\d+):\s*(.+?)\s*\n(?:\s*<\!-- id: T\d+[^>]*-->\s*\n)?([\s\S]*?)(?=\n##+ T\d+:|$)/gm;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const [, id, rawTitle, body] = match;

    // 从标题提取状态
    const titleStatus = extractStatusFromTitle(rawTitle);
    const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();

    // 解析阻塞依赖（渐进式工作流）
    const blockedByField = extractField(body, '阻塞依赖');
    const blocked_by = blockedByField
      ? blockedByField.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    tasks.push({
      id,
      name,
      phase: extractField(body, '阶段'),
      file: extractField(body, '文件'),
      leverage: extractField(body, '复用'),
      design_ref: extractField(body, '设计参考'),
      requirement: extractField(body, '需求') || extractField(body, '内容'),
      actions: extractField(body, 'actions'),
      depends: extractField(body, '依赖'),
      blocked_by,  // 渐进式工作流：任务的阻塞依赖
      quality_gate: parseQualityGate(body),
      threshold: parseInt(extractField(body, '阈值') || '80'),
      status: titleStatus || extractField(body, '状态') || 'pending'
    });
  }

  return tasks;
}

function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*\`?([^\`\\n]+)\`?`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

function generateProgressBar(percent: number): string {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

function generateContextBar(usagePercent: number, warningThreshold: number, dangerThreshold: number): string {
  const filled = Math.round(usagePercent / 5);
  let bar = '';
  for (let i = 0; i < 20; i++) {
    if (i < filled) {
      if (i >= dangerThreshold / 5) bar += '🟥';
      else if (i >= warningThreshold / 5) bar += '🟨';
      else bar += '🟩';
    } else {
      bar += '░';
    }
  }
  return `[${bar}] ${usagePercent}%`;
}

function statusIcon(status: string): string {
  // 归一化状态字符串
  // 1. 移除所有 emoji（包括变体选择符 U+FE0F）
  // 2. 移除括号内容（如失败原因）
  const normalized = status
    .replace(/[\u{1F300}-\u{1F9FF}]|\u{2705}|\u{274C}|\u{23ED}\uFE0F?|\u{23F8}\uFE0F?|\u{1F504}/gu, '')  // 移除常见 emoji
    .replace(/\uFE0F/g, '')            // 移除残留的变体选择符
    .replace(/\s*\([^)]*\)$/, '')      // 移除括号内容
    .trim()
    .toLowerCase();

  switch (normalized) {
    case 'completed':
      return '✅';
    case 'skipped':
      return '⏭️';
    case 'failed':
      return '❌';
    case 'in_progress':
      return '🔄';
    case 'blocked':
      return '⏳';
    case 'pending':
    default:
      return '⏸️';
  }
}
```

---

## 🔄 相关命令

```bash
# 执行下一步
/workflow-execute

# 重试当前步骤
/workflow-retry-step

# 跳过当前步骤（慎用）
/workflow-skip-step

# 启动新工作流
/workflow-start "功能需求描述"
```
