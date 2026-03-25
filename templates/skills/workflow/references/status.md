# workflow status - 查看工作流状态 (v3.0)

读取 workflow-state.json + tasks.md，生成进度报告。

## 渐进披露模式

| 参数 | 说明 |
|------|------|
| _(无参数)_ | 简洁模式：只显示核心进度和下一步操作 |
| `--detail` | 详细模式：显示完整的约束、审计、产物信息 |
| `--json` | JSON 模式：输出原始状态数据供脚本处理 |

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
// ═══════════════════════════════════════════════════════════════
// Step 0: 解析渐进披露模式
// ═══════════════════════════════════════════════════════════════

const args = ($ARGUMENTS || []).join(' ');
const isDetailMode = args.includes('--detail') || args.includes('-d');
const isJsonMode = args.includes('--json');

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
  /workflow start "功能需求描述"
  /workflow start docs/prd.md
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
const preTaskStatuses = ['planned', 'spec_review', 'intent_review'];

// 在 Task Compilation 之前，planned / spec_review / intent_review 阶段可能尚未生成 tasks_file
const tasksFile = state.tasks_file || '';
const tasksPath = tasksFile ? resolveUnder(workflowDir, tasksFile) : null;
if (tasksFile && !tasksPath) {
  console.log(`🚨 任务文件路径不安全: ${state.tasks_file}`);
  return;
}

let tasksContent = '';
let tasks: WorkflowTaskV2[] = [];
let totalTasks = 0;

if (tasksPath) {
  if (!fileExists(tasksPath)) {
    console.log(`
⚠️ 任务清单不存在：${tasksPath}

状态文件存在，但任务清单缺失。
可能是工作流创建过程中断。

💡 建议：重新启动工作流
  /workflow start "原始需求"
  `);
    return;
  }

  tasksContent = readFile(tasksPath);
  tasks = parseWorkflowTasksV2FromMarkdown(tasksContent);
  totalTasks = tasks.length;

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
} else if (!preTaskStatuses.includes(state.status)) {
  console.log(`
⚠️ 当前状态缺少任务清单引用

当前状态：${state.status}

💡 建议：检查工作流是否完整生成，或重新执行 /workflow start
  `);
  return;
}

// 统计各状态
const completed = state.progress.completed.length;
const skipped = state.progress.skipped.length;
const failed = state.progress.failed.length;
const blocked = state.progress.blocked?.length || 0;  // 渐进式工作流：阻塞任务
const pending = Math.max(0, totalTasks - completed - skipped - failed - blocked);

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

```typescript
// ═══════════════════════════════════════════════════════════════
// JSON 模式：直接输出原始状态
// ═══════════════════════════════════════════════════════════════

if (isJsonMode) {
  console.log(JSON.stringify({
    ...state,
    _meta: {
      tasksPath,
      workflowDir,
      totalTasks,
      progressPercent
    }
  }, null, 2));
  return;
}

// ═══════════════════════════════════════════════════════════════
// 简洁模式 vs 详细模式
// ═══════════════════════════════════════════════════════════════
```

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
| external (第三方服务) | {{unblocked.includes('external') ? '✅ 已就绪' : '⏳ 等待中'}} |

{{#if (unblocked.length < 2)}}
💡 **解除阻塞**：
\`\`\`bash
{{#unless unblocked.includes('api_spec')}}/workflow unblock api_spec    # 后端接口已就绪{{/unless}}
{{#unless unblocked.includes('external')}}/workflow unblock external    # 第三方服务/SDK 已就绪{{/unless}}
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

## 📄 规划产物

📐 **技术方案**：`{{state.tech_design}}`
{{#if state.spec_file}}📘 **Spec**：`{{state.spec_file}}`{{/if}}
{{#if state.plan_file}}🧭 **Plan**：`{{state.plan_file}}`{{/if}}

---

## 📋 任务清单

{{#if tasksPath}}
📝 **任务文件**：`{{tasksPath}}`

{{#each tasks}}
{{statusIcon(this.status)}} **{{this.id}}**: {{this.name}}
   {{#if this.files.create}}创建: `{{this.files.create.join(', ')}}`{{/if}}
   {{#if this.files.modify}}修改: `{{this.files.modify.join(', ')}}`{{/if}}
   {{#if this.files.test}}测试: `{{this.files.test.join(', ')}}`{{/if}}
   {{#if this.blocked_by}}⏳ 等待: `{{this.blocked_by.join(', ')}}`{{/if}}
   阶段: {{this.phase}}
{{/each}}
{{else}}
⏳ 当前阶段尚未生成 `tasks.md`，将在 Plan Review 通过后进入 Task Compilation。
{{/if}}

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
{{#if files.create}}**创建文件**：`{{files.create.join(', ')}}`{{/if}}
{{#if files.modify}}**修改文件**：`{{files.modify.join(', ')}}`{{/if}}
{{#if files.test}}**测试文件**：`{{files.test.join(', ')}}`{{/if}}
{{#if leverage}}**复用**：`{{leverage}}`{{/if}}
{{#if spec_ref}}**Spec 参考**：{{spec_ref}}{{/if}}
{{#if plan_ref}}**Plan 参考**：{{plan_ref}}{{/if}}

**步骤摘要**：{{#each steps}}`{{id}}` {{description}}{{#unless @last}}；{{/unless}}{{/each}}
**动作**：`{{actions.join(', ')}}`

{{#if quality_gate}}
⚠️ **这是质量关卡**：两阶段代码审查（规格合规 + 代码质量）
{{/if}}
{{/with}}
{{/if}}

---

## 🎯 质量关卡

{{#each state.quality_gates}}
**{{@key}}**：
- 任务ID：{{gate_task_id}}
- diff 窗口：{{diff_window.from_task || '起点'}} → {{diff_window.to_task}}（{{diff_window.files_changed}} 个文件）
- Stage 1（规格合规）：{{stage1.passed ? '✅ 通过' : '❌ 未通过'}}（{{stage1.attempts}} 次尝试）
{{#if stage2}}- Stage 2（代码质量）：{{stage2.passed ? '✅ ' + stage2.assessment : '❌ ' + stage2.assessment}}（{{stage2.attempts}} 次尝试，Critical: {{stage2.critical_count}} / Important: {{stage2.important_count}} / Minor: {{stage2.minor_count}}）{{else}}- Stage 2（代码质量）：⏸️ 未执行（Stage 1 未通过）{{/if}}
- 总体：{{overall_passed ? '✅ 通过' : '❌ 未通过'}}
{{/each}}

{{#if hasFailedGates}}
⚠️ **存在未通过的质量关卡，需要修复后重试**
{{/if}}

---

{{#if isDetailMode}}
## 📦 约束系统 (v2.1)

{{#if state.constraints}}
### 硬约束（必须满足）

{{#if state.constraints.hard.length}}
| ID | 描述 | 类别 | 来源 | 已验证 |
|----|------|------|------|--------|
{{#each state.constraints.hard}}
| {{id}} | {{description}} | {{category}} | {{sourceModel}} | {{#if verified}}✅{{else}}⏳{{/if}} |
{{/each}}
{{else}}
_（无硬约束）_
{{/if}}

### 软约束（建议满足）

{{#if state.constraints.soft.length}}
| ID | 描述 | 类别 | 来源 |
|----|------|------|------|
{{#each state.constraints.soft}}
| {{id}} | {{description}} | {{category}} | {{sourceModel}} |
{{/each}}
{{else}}
_（无软约束）_
{{/if}}

### 成功标准

{{#if state.constraints.successCriteria.length}}
{{#each state.constraints.successCriteria}}
- [ ] {{this}}
{{/each}}
{{else}}
_（未定义成功标准）_
{{/if}}

{{#if state.constraints.openQuestions.length}}
### ⚠️ 待澄清问题

{{#each state.constraints.openQuestions}}
- ❓ {{this}}
{{/each}}
{{/if}}
{{/if}}

---

## 🔍 Zero-Decision 审计

{{#if state.zeroDecisionAudit}}
{{#if state.zeroDecisionAudit.passed}}
✅ **审计通过** ({{state.zeroDecisionAudit.auditedAt}})

任务清单明确无歧义，可安全执行。
{{else}}
{{#if state.zeroDecisionAudit.passed === null}}
⏳ **审计未执行**

首次执行时将自动进行 Zero-Decision 审计。
{{else}}
❌ **审计失败** ({{state.zeroDecisionAudit.auditedAt}})

存在以下问题需要在执行前解决：

{{#if state.zeroDecisionAudit.antiPatterns.length}}
| 任务 | 问题 | 严重性 |
|------|------|--------|
{{#each state.zeroDecisionAudit.antiPatterns}}
| {{taskId}} | {{description}} | {{#if (eq severity 'error')}}❌ 错误{{else}}⚠️ 警告{{/if}} |
{{/each}}
{{/if}}

{{#if state.zeroDecisionAudit.remainingAmbiguities.length}}
**其他模糊项**：
{{#each state.zeroDecisionAudit.remainingAmbiguities}}
- {{this}}
{{/each}}
{{/if}}

💡 请修复上述问题后重新启动工作流。
{{/if}}
{{/if}}
{{else}}
⏳ **审计未执行**

首次执行时将自动进行 Zero-Decision 审计。
{{/if}}
{{/if}}
{{/if}}

{{#unless isDetailMode}}
---

💡 **查看详细信息**：`/workflow status --detail`
{{/unless}}

---

## 📦 产物文件

| 类型 | 路径 |
|------|------|
| 技术方案 | `{{state.tech_design}}` |
{{#if state.spec_file}}| Spec | `{{state.spec_file}}` |
{{/if}}{{#if state.plan_file}}| Plan | `{{state.plan_file}}` |
{{/if}}{{#if tasksPath}}| 任务清单 | `{{tasksPath}}` |
{{/if}}{{#if state.delta_tracking.current_change}}| 当前变更 | `changes/{{state.delta_tracking.current_change}}/intent.md` |
{{/if}}{{#each state.artifacts}}
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
{{#if state.spec_file}}- Spec：`{{state.spec_file}}`
{{/if}}{{#if state.plan_file}}- Plan：`{{state.plan_file}}`
{{/if}}{{#if tasksPath}}- 任务清单：`{{tasksPath}}`
{{/if}}
{{else if state.status === 'planned'}}
### 📋 规划完成，等待执行

工作流已完成规划阶段，请审查技术方案、Spec、Plan 和任务清单后开始执行。

{{#if isProgressive}}
🔄 **工作模式**：渐进式

| 依赖类型 | 状态 |
|---------|------|
| api_spec (后端接口) | {{unblocked.includes('api_spec') ? '✅ 已就绪' : '⏳ 等待中'}} |
| external (第三方服务) | {{unblocked.includes('external') ? '✅ 已就绪' : '⏳ 等待中'}} |

{{#if blocked}}
**阻塞的任务**：{{blocked}} 个（等待依赖解除后可执行）
{{/if}}
{{/if}}

**技术方案**：`{{state.tech_design}}`
{{#if state.spec_file}}**Spec**：`{{state.spec_file}}`
{{/if}}{{#if state.plan_file}}**Plan**：`{{state.plan_file}}`
{{/if}}{{#if tasksPath}}**任务清单**：`{{tasksPath}}`
{{else}}**任务清单**：尚未生成
{{/if}}

**开始执行**：
\```bash
/workflow execute
\```

{{#if isProgressive}}
💡 渐进式工作流：可先执行无阻塞的任务，阻塞任务需等待依赖就绪后通过 `/workflow unblock` 解除。
{{else}}
💡 执行后将自动复用规划阶段的模型会话上下文。
{{/if}}

{{else if state.status === 'spec_review'}}
### 🧾 等待 Spec 确认

当前工作流停在 Spec 审查阶段，请先确认范围、模块边界和验收映射。

{{#if state.spec_file}}**Spec**：`{{state.spec_file}}`
{{/if}}**技术方案**：`{{state.tech_design}}`

**建议操作**：
1. 审查 `spec.md` 是否准确反映本次需求
2. 如需回退，修改 Spec 或技术方案后重新进入 `/workflow start`
3. 确认无误后继续后续 Hard Stop

{{else if state.status === 'intent_review'}}
### 🔍 等待 Intent 确认

当前工作流停在 Intent Review，请先确认本次变更方向。

{{#if state.delta_tracking.current_change}}**当前变更**：`{{state.delta_tracking.current_change}}`
{{/if}}{{#if state.spec_file}}**Spec**：`{{state.spec_file}}`
{{/if}}

💡 若在 Intent Review 中选择“取消”，当前 `changes/{changeId}` 下的临时 Intent 工件会被清理，不会进入归档目录。

{{else if state.status === 'paused'}}
### ⏸️ 工作流已暂停

当前工作流暂停，通常表示等待用户处理文档、确认质量关卡，或决定下一步操作。

{{#if state.spec_file}}**Spec**：`{{state.spec_file}}`
{{/if}}{{#if state.plan_file}}**Plan**：`{{state.plan_file}}`
{{/if}}{{#if tasksPath}}**任务清单**：`{{tasksPath}}`
{{else}}**任务清单**：尚未生成
{{/if}}

**继续方式**：根据当前阶段处理文档后，再执行 `/workflow execute` 或重新进入 `/workflow start`。

{{else if state.status === 'blocked'}}
### ⏳ 工作流等待依赖

当前所有可执行任务均被阻塞，等待外部依赖解除。

**阻塞的任务**：{{state.progress.blocked.join(', ')}}

**解除阻塞**：
\```bash
{{#unless unblocked.includes('api_spec')}}/workflow unblock api_spec    # 后端接口已就绪{{/unless}}
{{#unless unblocked.includes('external')}}/workflow unblock external    # 第三方服务/SDK 已就绪{{/unless}}
\```

{{else if state.status === 'archived'}}
### 📦 工作流已归档

当前工作流已经结束并进入归档状态，活动执行链路已关闭。

{{#if state.delta_tracking.current_change}}**最后变更**：`{{state.delta_tracking.current_change}}`
{{/if}}💡 如需继续新需求，请重新执行 `/workflow start`。

{{else if hasFailedTask || state.status === 'failed'}}
### ⚠️ 存在失败任务

**失败任务**：{{failedTaskId}}
**失败原因**：{{failedReason}}

**建议操作**：
1. 查看失败原因并修复
2. 重试当前步骤：`/workflow execute --retry`
3. 或跳过（慎用）：`/workflow execute --skip`

{{else}}
### ✅ 准备就绪

**下一个任务**：{{currentTask.id}} - {{currentTask.name}}
**阶段**：{{currentTask.phase}}

**执行命令**：
\```bash
/workflow execute
\```

{{#if currentTask.quality_gate}}
💡 **提示**：下一步是质量关卡（两阶段代码审查）
{{/if}}
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 📦 辅助函数

```typescript
interface WorkflowTaskV2 {
  id: string;
  name: string;
  phase: string;
  files: {
    create?: string[];
    modify?: string[];
    test?: string[];
  };
  leverage?: string[];
  spec_ref: string;
  plan_ref: string;
  acceptance_criteria?: string[];
  depends?: string[];
  blocked_by?: string[];
  quality_gate?: boolean;
  status: string;
  actions: string[];
  steps: Array<{
    id: string;
    description: string;
    expected: string;
    verification?: string;
  }>;
  verification?: {
    commands?: string[];
    expected_output?: string[];
    notes?: string[];
  };
}

function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*\`?([^\`\\n]+)\`?`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

function extractTaskBlock(content: string, taskId: string): string {
  const escapedId = escapeRegExp(taskId);
  const taskRegex = new RegExp(`##+ ${escapedId}:[\\s\\S]*?(?=\\n##+ T\\d+:|$)`, 'm');
  return content.match(taskRegex)?.[0] || '';
}

function extractListField(body: string, fieldName: string): string[] {
  const value = extractField(body, fieldName);
  return value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function extractAcceptanceCriteriaFromTaskBlock(content: string, taskId: string): string[] {
  const raw = extractField(extractTaskBlock(content, taskId), '验收项');
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function extractStepsFromTaskBlock(content: string, taskId: string): WorkflowTaskV2['steps'] {
  const taskBlock = extractTaskBlock(content, taskId);
  const stepsSection = taskBlock.match(/- \*\*步骤\*\*:[\s\S]*$/)?.[0] || '';
  const stepMatches = [...stepsSection.matchAll(/-\s+([A-Z]\d+):\s+(.+?)\s+→\s+(.+?)(?:（验证：(.*?)）)?$/gm)];
  return stepMatches.map(match => ({
    id: match[1],
    description: match[2],
    expected: match[3],
    verification: match[4] || undefined
  }));
}

function parseTaskFiles(body: string): WorkflowTaskV2['files'] {
  return {
    create: extractListField(body, '创建文件'),
    modify: extractListField(body, '修改文件'),
    test: extractListField(body, '测试文件')
  };
}

function parseTaskVerification(body: string): WorkflowTaskV2['verification'] {
  const commands = extractListField(body, '验证命令');
  const expected_output = extractListField(body, '验证期望');
  const notes = extractListField(body, '验证备注');
  return commands.length || expected_output.length || notes.length
    ? { commands, expected_output, notes }
    : undefined;
}

function parseWorkflowTasksV2FromMarkdown(content: string): WorkflowTaskV2[] {
  const taskIds = [...content.matchAll(/##+ (T\d+):/g)].map(m => m[1]);
  return taskIds.map(taskId => {
    const body = extractTaskBlock(content, taskId);
    const titleMatch = body.match(/##+ (T\d+):\s*(.+?)\s*\n/m);
    const rawTitle = titleMatch?.[2] || taskId;
    const titleStatus = extractStatusFromTitle(rawTitle);
    const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();

    return {
      id: taskId,
      name,
      phase: extractField(body, '阶段') || 'implement',
      files: parseTaskFiles(body),
      leverage: extractListField(body, '复用'),
      spec_ref: extractField(body, 'Spec 参考') || '§Unknown',
      plan_ref: extractField(body, 'Plan 参考') || 'P-UNKNOWN',
      acceptance_criteria: extractAcceptanceCriteriaFromTaskBlock(content, taskId),
      depends: extractListField(body, '依赖'),
      blocked_by: extractListField(body, '阻塞依赖'),
      quality_gate: parseQualityGate(body),
      status: titleStatus || extractField(body, '状态') || 'pending',
      actions: extractListField(body, 'actions'),
      steps: extractStepsFromTaskBlock(content, taskId),
      verification: parseTaskVerification(body)
    };
  });
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
/workflow execute

# 重试当前步骤
/workflow execute --retry

# 跳过当前步骤（慎用）
/workflow execute --skip

# 启动新工作流
/workflow start "功能需求描述"
```
