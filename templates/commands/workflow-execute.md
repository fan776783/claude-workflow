---
description: 执行工作流下一步 - 读取任务定义并执行
allowed-tools: SlashCommand(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), Task(*), TaskOutput(*), AskUserQuestion(*), TodoWrite(*)
---

# 智能工作流执行（v2）

读取 tasks.md 中的当前任务段落，直接执行。

---

## 🔍 执行流程

### Step 1：读取工作流状态

```typescript
const cwd = process.cwd();
const configPath = '.claude/config/project-config.json';

// 检查项目配置
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

// 检查状态文件是否存在
if (!fileExists(statePath)) {
  console.log(`
❌ 未发现工作流任务

当前项目：${projectConfig.project.name}
项目 ID：${projectId}
预期路径：${statePath}

💡 请先启动工作流：
  /workflow-start "功能需求描述"
  `);
  return;
}

// 读取精简状态
const state = JSON.parse(readFile(statePath));

// 状态预检查：如果处于失败状态，提示用户使用 retry
if (state.status === 'failed') {
  console.log(`
⚠️ 当前工作流处于失败状态

失败任务：${state.current_task}
失败原因：${state.failure_reason || '未知'}

请使用以下命令：
- 重试当前步骤：/workflow-retry-step
- 跳过当前步骤：/workflow-skip-step（慎用）
  `);
  return;
}

console.log(`
📂 工作流目录：${workflowDir}
📄 任务清单：${state.tasks_file}
📍 当前任务：${state.current_task}
`);
```

---

### Step 2：读取任务文件

```typescript
// 校验 tasks_file 路径安全性
if (!state.tasks_file ||
    state.tasks_file.includes('..') ||
    path.isAbsolute(state.tasks_file) ||
    !/^[a-zA-Z0-9_\-\.]+$/.test(state.tasks_file)) {
  console.log(`🚨 任务文件路径不安全: ${state.tasks_file}`);
  return;
}

const tasksPath = path.join(workflowDir, state.tasks_file);

// 二次校验：确保最终路径在 workflowDir 内
if (!tasksPath.startsWith(workflowDir)) {
  console.log(`🚨 路径穿越检测: ${tasksPath}`);
  return;
}

if (!fileExists(tasksPath)) {
  console.log(`❌ 任务清单不存在：${tasksPath}`);
  return;
}

const tasksContent = readFile(tasksPath);
```

---

### Step 3：提取当前任务

```typescript
// taskId 格式校验函数
function validateTaskId(taskId: string): boolean {
  return /^T\d+$/.test(taskId);
}

// 从 tasks.md 中提取当前任务段落
function extractCurrentTask(content: string, taskId: string): Task | null {
  // 校验 taskId 格式，防止正则注入
  if (!validateTaskId(taskId)) {
    console.log(`❌ 无效的任务 ID 格式: ${taskId}，期望格式: T1, T2, ...`);
    return null;
  }

  // 使用更宽松的正则匹配任务段落（允许可选空行和灵活空格）
  const regex = new RegExp(
    `## ${taskId}:\\s*([^\\n]+)\\n` +    // 标题
    `\\s*<!-- id: ${taskId}[^>]*-->\\s*\\n` +  // ID 注释（允许前后空格）
    `([\\s\\S]*?)` +                     // 内容
    `(?=\\n## T\\d+:|$)`,                // 下一个任务或结束
    'm'
  );

  const match = content.match(regex);
  if (!match) return null;

  const name = match[1].trim();
  const body = match[2];

  // 解析字段
  return {
    id: taskId,
    name: name,
    phase: extractField(body, '阶段'),
    file: extractField(body, '文件'),
    leverage: extractField(body, '复用'),
    design_ref: extractField(body, '设计参考'),
    requirement: extractField(body, '需求'),
    actions: extractField(body, 'actions'),
    depends: extractField(body, '依赖'),
    quality_gate: body.includes('质量关卡**: true'),
    threshold: parseInt(extractField(body, '阈值') || '80'),
    status: extractField(body, '状态')
  };
}

const currentTask = extractCurrentTask(tasksContent, state.current_task);

if (!currentTask) {
  console.log(`❌ 无法找到任务 ${state.current_task}`);
  return;
}

// 检查任务是否已完成，如是则移动到下一个
if (state.progress.completed.includes(currentTask.id)) {
  const nextTaskId = findNextTask(tasksContent, state.progress);
  if (!nextTaskId) {
    completeWorkflow(state, statePath, tasksPath);
    return;
  }
  state.current_task = nextTaskId;
  writeFile(statePath, JSON.stringify(state, null, 2));
  // 重新提取当前任务
  const nextTask = extractCurrentTask(tasksContent, nextTaskId);
  if (!nextTask) {
    console.log(`❌ 无法找到下一个任务 ${nextTaskId}`);
    return;
  }
  Object.assign(currentTask, nextTask);
}
```

---

### Step 4：显示任务上下文

```typescript
// 同时加载全局约束
const constraints = extractConstraints(tasksContent);

// 校验 tech_design 路径安全性
function validateTechDesignPath(techDesign: string, workflowDir: string): boolean {
  if (!techDesign) return false;
  if (techDesign.includes('..')) return false;
  if (path.isAbsolute(techDesign) && !techDesign.startsWith(workflowDir + path.sep)) return false;
  return true;
}

const techDesignPath = state.tech_design;
if (!validateTechDesignPath(techDesignPath, workflowDir)) {
  console.log(`🚨 技术方案路径不安全: ${techDesignPath}`);
  return;
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 **当前任务**: ${currentTask.id} - ${currentTask.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**阶段**: ${currentTask.phase}
${currentTask.file ? `**文件**: \`${currentTask.file}\`` : ''}
${currentTask.leverage ? `**复用**: \`${currentTask.leverage}\`` : ''}
${currentTask.design_ref ? `**设计参考**: ${techDesignPath} § ${currentTask.design_ref}` : ''}
**需求**: ${currentTask.requirement}
**执行动作**: ${currentTask.actions}

${currentTask.quality_gate ? `
⚠️ **这是质量关卡**：评分需 ≥ ${currentTask.threshold}
` : ''}

**全局约束**：
${constraints.map(c => `- ${c}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
```

---

### Step 5：根据任务属性执行

```typescript
// 校验 actions 字段
const actionsRaw = currentTask.actions;

if (!actionsRaw || actionsRaw.trim().length === 0) {
  console.log(`
⚠️ **任务缺少 actions 定义**

任务：${currentTask.id} - ${currentTask.name}
请在 tasks.md 中添加 \`- **actions**: create_file\` 等字段

💡 支持的 actions：create_file, edit_file, run_tests, codex_review, git_commit
  `);

  state.progress.failed.push(currentTask.id);
  state.status = 'failed';
  state.failure_reason = 'Missing actions field';
  state.updated_at = new Date().toISOString();
  writeFile(statePath, JSON.stringify(state, null, 2));
  updateTaskStatusInMarkdown(tasksPath, currentTask.id, '❌ failed (缺少 actions)');
  return;
}

const actions = actionsRaw.split(',').map(a => a.trim()).filter(Boolean);

try {
  for (const action of actions) {
    switch (action) {
      case 'create_file':
        await executeCreateFile(currentTask, state);
        break;

      case 'edit_file':
        await executeEditFile(currentTask, state);
        break;

      case 'run_tests':
        await executeRunTests(currentTask, state);
        break;

      case 'codex_review':
        const reviewResult = await executeCodexReview(currentTask, state);
        if (!reviewResult.passed) {
          handleQualityGateFailure(
            currentTask, state, statePath, tasksPath,
            reviewResult.score, reviewResult.output
          );
          return;
        }
        break;

      case 'git_commit':
        await executeGitCommit(currentTask, state);
        break;

      default:
        throw new Error(`未知的 action 类型: ${action}。支持的类型: create_file, edit_file, run_tests, codex_review, git_commit`);
    }
  }
} catch (error) {
  // 统一错误消息提取
  const errorMessage = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, ' ')  // 单行化
    .substring(0, 200);        // 截断长度

  // 失败处理（去重添加）
  addUnique(state.progress.failed, currentTask.id);
  state.status = 'failed';
  state.failure_reason = errorMessage;
  state.updated_at = new Date().toISOString();
  writeFile(statePath, JSON.stringify(state, null, 2));
  updateTaskStatusInMarkdown(tasksPath, currentTask.id, `❌ failed (${errorMessage.substring(0, 50)})`);

  console.log(`
🛑 **任务执行失败**

任务：${currentTask.id} - ${currentTask.name}
原因：${errorMessage}

💡 修复后执行：/workflow-retry-step
  `);
  return;
}
```

---

### Step 6：更新状态（双向同步）

```typescript
// 辅助函数：数组去重添加
function addUnique(arr: string[], item: string): void {
  if (!arr.includes(item)) arr.push(item);
}

// 1. 更新 workflow-state.json
addUnique(state.progress.completed, currentTask.id);

// 自愈：如果任务之前在 failed 列表中，移除它
state.progress.failed = state.progress.failed.filter(id => id !== currentTask.id);

// 清理失败状态
delete state.failure_reason;

state.current_task = findNextTask(tasksContent, state.progress);
state.updated_at = new Date().toISOString();

if (!state.current_task) {
  state.status = 'completed';
  state.completed_at = new Date().toISOString();
} else {
  state.status = 'in_progress';
}

writeFile(statePath, JSON.stringify(state, null, 2));

// 2. 更新 tasks.md 中的状态标记（双向同步）
updateTaskStatusInMarkdown(tasksPath, currentTask.id, '✅ completed');

console.log(`
✅ 任务完成：${currentTask.id} - ${currentTask.name}
`);
```

---

### Step 7：显示下一步

```typescript
if (state.status === 'completed') {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 **工作流已完成！**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**任务名称**：${state.task_name}
**总任务数**：${state.progress.completed.length}

**产物文件**：
- 技术方案：${state.tech_design}
- 任务清单：${tasksPath}
  `);
  return;
}

const nextTask = extractCurrentTask(tasksContent, state.current_task);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **进度**: ${state.progress.completed.length} / ${countTasks(tasksContent)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **下一个任务**: ${nextTask.id} - ${nextTask.name}
**阶段**: ${nextTask.phase}
${nextTask.file ? `**文件**: \`${nextTask.file}\`` : ''}

执行命令：
\`\`\`bash
/workflow-execute
\`\`\`
`);
```

---

## 🔧 动作执行函数

### create_file / edit_file

```typescript
async function executeCreateFile(task: Task, state: State) {
  console.log(`
📝 **创建/编辑文件**

**目标文件**: ${task.file}
${task.leverage ? `**复用模式**: ${task.leverage}` : ''}
**需求**: ${task.requirement}

请按照以上要求实现代码。完成后自动标记任务完成。
  `);

  // 如果有设计参考，读取相关章节
  if (task.design_ref && state.tech_design) {
    const techDesign = readFile(state.tech_design);
    const section = extractSection(techDesign, task.design_ref);
    if (section) {
      console.log(`
📐 **设计参考** (${task.design_ref}):

${section}
      `);
    }
  }

  // 实际编码由 AI 执行
  // 这里只是提供上下文
}

async function executeEditFile(task: Task, state: State) {
  // 与 create_file 类似，但针对已有文件
  await executeCreateFile(task, state);
}
```

### run_tests

```typescript
async function executeRunTests(task: Task, state: State) {
  console.log(`🧪 执行测试...\n`);

  // 从项目配置读取测试命令
  const configPath = '.claude/config/project-config.json';
  let testCommand = null;

  if (fileExists(configPath)) {
    const config = JSON.parse(readFile(configPath));
    testCommand = config.scripts?.test;
  }

  // 如果没有配置测试命令，跳过测试
  if (!testCommand) {
    console.log(`⏭️ 跳过测试：项目未配置测试命令

💡 如需启用测试，请在 .claude/config/project-config.json 中添加：
{
  "scripts": {
    "test": "npm test"  // 或其他测试命令
  }
}
    `);
    return;
  }

  // 运行测试命令
  const result = await Bash({
    command: testCommand,
    timeout: 120000
  });

  if (result.exitCode !== 0) {
    console.log(`
❌ 测试失败

${result.stderr || result.stdout}

请修复测试后重新执行 /workflow-execute
    `);
    throw new Error('Tests failed');
  }

  console.log(`✅ 测试通过\n`);
}
```

### codex_review

```typescript
interface ReviewResult {
  passed: boolean;
  score: number;
  output: string;
}

async function executeCodexReview(task: Task, state: State): Promise<ReviewResult> {
  console.log(`🔍 Codex 代码审查...\n`);

  // 获取 diff（git diff HEAD 已包含 staged + unstaged）
  const diffResult = await Bash({ command: 'git diff HEAD' });
  const untrackedFiles = await Bash({ command: 'git ls-files --others --exclude-standard' });

  let diffContent = diffResult.stdout || '';

  // 处理新文件（安全版本：避免 shell 注入）
  if (untrackedFiles.stdout?.trim()) {
    const SENSITIVE_PATTERNS = [
      /\.env(\..*)?$/,
      /\.(key|pem|p12|pfx|crt)$/i,
      /credentials\./,
      /secrets?\./i,
      /package-lock\.json$/,
      /yarn\.lock$/,
      /pnpm-lock\.yaml$/
    ];

    const newFiles = untrackedFiles.stdout.trim().split('\n')
      .filter(file => {
        // 过滤危险文件名（包含 shell 特殊字符）
        if (/[`$"'\\]/.test(file) || file.includes('\n')) {
          console.log(`⚠️ 跳过不安全文件名: ${file}`);
          return false;
        }
        // 排除敏感文件
        if (SENSITIVE_PATTERNS.some(p => p.test(file))) {
          console.log(`⚠️ 跳过敏感文件: ${file}`);
          return false;
        }
        return true;
      })
      .slice(0, 5);  // 限制最多5个新文件

    for (const file of newFiles) {
      try {
        // 使用 Read 工具代替 Bash，避免 shell 注入
        const content = readFile(file, { limit: 200 });
        if (content) {
          diffContent += `\n--- /dev/null\n+++ b/${file}\n${content.split('\n').map(l => '+' + l).join('\n')}`;
        }
      } catch (e) {
        // 静默跳过读取失败的文件
      }
    }
  }

  if (!diffContent.trim()) {
    console.log(`⚠️ 没有代码变更需要审查`);
    return { passed: true, score: 100, output: '无变更' };
  }

  // 使用临时文件避免 heredoc 注入
  const tempFile = `/tmp/codex-review-${Date.now()}.txt`;
  const reviewPrompt = `ROLE_FILE: ~/.claude/prompts/codex/reviewer.md

<TASK>
请审查以下代码变更：

## 技术方案
${readFile(state.tech_design)}

## 代码变更
${diffContent}

请按以下格式评分：
CODE REVIEW REPORT
==================
Design Compliance: XX/20
Code Quality: XX/20
Error Handling: XX/20
Security: XX/20
Test Coverage: XX/20
─────────────────────────
TOTAL SCORE: XX/100

然后提供具体的问题和建议。
</TASK>

OUTPUT: CODE REVIEW REPORT 格式。`;
  writeFile(tempFile, reviewPrompt);

  const codexResult = await Bash({
    command: `codeagent-wrapper --backend codex - "${process.cwd()}" < "${tempFile}"`,
    run_in_background: true
  });

  const output = await TaskOutput({ task_id: codexResult.task_id, block: true });

  // 清理临时文件
  await Bash({ command: `rm -f "${tempFile}"` });

  // 持久化审查结果
  const reviewArtifact = path.join(workflowDir, `review-${task.id}-${Date.now()}.txt`);
  writeFile(reviewArtifact, output);
  if (!state.artifacts) state.artifacts = {};
  state.artifacts[`review_${task.id}`] = reviewArtifact;

  const score = extractScore(output);

  // 更新质量关卡
  const gateKey = Object.keys(state.quality_gates || {}).find(
    k => state.quality_gates[k].task_id === task.id
  );
  if (gateKey) {
    state.quality_gates[gateKey].actual_score = score;
    state.quality_gates[gateKey].passed = score >= task.threshold;
  }

  if (score < task.threshold) {
    return { passed: false, score, output };
  }

  console.log(`
✅ **质量关卡通过**

评分：${score} / 100

${output}
  `);
  return { passed: true, score, output };
}
```

### git_commit

```typescript
async function executeGitCommit(task: Task, state: State) {
  console.log(`📦 准备提交代码...\n`);

  // 获取变更文件
  const status = await Bash({ command: 'git status --short' });

  if (!status.stdout.trim()) {
    console.log(`⚠️ 没有需要提交的变更\n`);
    return;
  }

  console.log(`变更文件：\n${status.stdout}\n`);

  // 生成 commit message（转义特殊字符）
  const safeTaskName = state.task_name.replace(/[`$"'\\]/g, '');
  const safeDesign = state.tech_design.replace(/[`$"'\\]/g, '');
  const safeCompleted = state.progress.completed.map(t => t.replace(/[`$"'\\]/g, '')).join(', ');

  const commitMsg = `feat(${safeTaskName}): 完成功能实现

- 基于技术方案: ${safeDesign}
- 完成任务: ${safeCompleted}`;

  // 强制用户确认
  const confirm = await AskUserQuestion({
    questions: [{
      question: `确认提交以下变更？\n\n${status.stdout}\n\nCommit message:\n${commitMsg}`,
      header: "Git Commit",
      multiSelect: false,
      options: [
        { label: "确认提交", description: "执行 git add -A && git commit" },
        { label: "取消", description: "跳过本次提交" }
      ]
    }]
  });

  if (!confirm || confirm.includes('取消')) {
    console.log(`⏭️ 用户取消提交\n`);
    return;
  }

  // 使用临时文件避免 shell 注入
  const tempMsgFile = `/tmp/commit-msg-${Date.now()}.txt`;
  writeFile(tempMsgFile, commitMsg);

  await Bash({ command: 'git add -A' });
  const commitResult = await Bash({ command: `git commit -F "${tempMsgFile}"` });

  // 清理临时文件
  await Bash({ command: `rm -f "${tempMsgFile}"` });

  if (commitResult.exitCode !== 0) {
    throw new Error(`Git commit failed: ${commitResult.stderr}`);
  }

  console.log(`✅ 代码已提交\n`);
}
```

---

## 📦 辅助函数

```typescript
function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*\`?([^\`\\n]+)\`?`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

function updateTaskStatusInMarkdown(filePath: string, taskId: string, newStatus: string) {
  let content = readFile(filePath);

  // 转义 taskId 防止 regex 注入
  const escapedId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 先提取该任务段落
  const taskRegex = new RegExp(
    `(## ${escapedId}:[\\s\\S]*?)(?=\\n## T\\d+:|$)`,
    'm'
  );
  const taskMatch = content.match(taskRegex);

  if (!taskMatch) {
    console.log(`⚠️ 无法找到任务 ${taskId} 进行状态更新`);
    return;
  }

  // 在段落内替换状态
  const taskBlock = taskMatch[1];
  const statusRegex = /(- \*\*状态\*\*: )([^\n]+)/;

  if (!statusRegex.test(taskBlock)) {
    console.log(`⚠️ 任务 ${taskId} 缺少状态字段`);
    return;
  }

  // 使用 replacer 函数避免 newStatus 中的 $ 被解释为替换 token
  const updatedBlock = taskBlock.replace(statusRegex, (_, prefix) => prefix + newStatus);
  content = content.replace(taskBlock, updatedBlock);
  writeFile(filePath, content);
}

function findNextTask(content: string, progress: Progress): string | null {
  // 找到所有任务 ID
  const taskIds = [...content.matchAll(/## (T\d+):/g)].map(m => m[1]);

  // 找到第一个未完成的
  for (const id of taskIds) {
    if (!progress.completed.includes(id) &&
        !progress.skipped.includes(id) &&
        !progress.failed.includes(id)) {
      return id;
    }
  }

  return null;
}

function countTasks(content: string): number {
  return (content.match(/## T\d+:/g) || []).length;
}

function extractConstraints(content: string): string[] {
  const match = content.match(/## 约束[^\n]*\n([\s\S]*?)(?=##|---)/);
  if (!match) return [];

  return match[1]
    .split('\n')
    .filter(line => line.trim().startsWith('-'))
    .map(line => line.replace(/^-\s*/, '').trim());
}

function extractSection(techDesign: string, sectionRef: string): string | null {
  // 从 tech-design.md 中提取指定章节
  const regex = new RegExp(
    `## ${sectionRef.replace('.', '\\.')}[^#]*`,
    'm'
  );
  const match = techDesign.match(regex);
  return match ? match[0].trim() : null;
}

function extractScore(output: string): number {
  const match = output.match(/TOTAL SCORE:\s*(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

function completeWorkflow(state: State, statePath: string, tasksPath: string): void {
  state.status = 'completed';
  state.completed_at = new Date().toISOString();
  writeFile(statePath, JSON.stringify(state, null, 2));

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 **工作流已完成！**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**任务名称**：${state.task_name}
**总任务数**：${state.progress.completed.length}

**产物文件**：
- 技术方案：${state.tech_design}
- 任务清单：${tasksPath}
  `);
}

function handleQualityGateFailure(
  task: Task,
  state: State,
  statePath: string,
  tasksPath: string,
  score: number,
  output: string
): void {
  state.progress.failed.push(task.id);
  state.status = 'failed';
  state.failure_reason = `质量关卡评分 ${score} 低于阈值 ${task.threshold}`;
  state.updated_at = new Date().toISOString();
  writeFile(statePath, JSON.stringify(state, null, 2));
  updateTaskStatusInMarkdown(tasksPath, task.id, `❌ failed (评分: ${score})`);

  console.log(`
🛑 **质量关卡未通过**

评分：${score} / 100
阈值：${task.threshold}
差距：${task.threshold - score} 分

${output}

💡 请根据审查意见修改后执行 /workflow-retry-step
  `);
}

```

---

## 🔄 相关命令

```bash
# 查看状态
/workflow-status

# 重试当前步骤
/workflow-retry-step

# 跳过当前步骤（慎用）
/workflow-skip-step
```
