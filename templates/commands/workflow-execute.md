---
description: 执行工作流下一步 - 读取任务定义并执行
argument-hint: "[--step | --phase | --all]"
allowed-tools: SlashCommand(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), Task(*), TaskOutput(*), AskUserQuestion(*), TodoWrite(*)
---

# 智能工作流执行（v2.1）

读取 tasks.md 中的当前任务段落，支持多种执行模式。

## 规格引用

详细的实现规格已模块化，可按需查阅：

| 模块 | 路径 | 说明 |
|------|------|------|
| 路径安全 | `specs/shared/path-utils.md` | resolveUnder 函数 |
| 状态 Emoji | `specs/shared/status-emoji.md` | 状态解析与显示 |
| 任务解析 | `specs/workflow/task-parser.md` | extractCurrentTask 等 |
| 状态机 | `specs/workflow/state-machine.md` | 状态定义与转换 |
| 质量关卡 | `specs/workflow/quality-gate.md` | 关卡检测逻辑 |
| Subagent | `specs/workflow/subagent-mode.md` | 子代理执行模式 |

---

## 共享工具函数

> 详见 `specs/shared/path-utils.md` 和 `specs/shared/status-emoji.md`

```typescript
// 路径安全函数 - 详见 specs/shared/path-utils.md
function resolveUnder(baseDir: string, relativePath: string): string | null;

// 状态 Emoji 处理 - 详见 specs/shared/status-emoji.md
const STATUS_EMOJI_REGEX = /(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;
function extractStatusFromTitle(title: string): string | null;
function getStatusEmoji(status: string): string;

// 工具函数
function addUnique<T>(arr: T[], item: T): void;
function escapeRegExp(str: string): string;
function parseQualityGate(body: string): boolean;

// ═══════════════════════════════════════════════════════════════
// Context Awareness 函数 (v2.1)
// ═══════════════════════════════════════════════════════════════

interface ContextMetrics {
  estimatedTokens: number;
  warningThreshold: number;      // 默认 60
  dangerThreshold: number;       // 默认 80
  maxConsecutiveTasks: number;   // 动态计算
  usagePercent: number;          // 当前使用率
  history: { taskId: string; tokens: number; timestamp: string }[];
}

const MAX_CONTEXT_TOKENS = 200000;  // Claude 最大上下文

function estimateContextTokens(
  tasksContent: string,
  techDesignContent: string | null,
  recentDiff: string | null
): number {
  let totalChars = 0;
  totalChars += tasksContent.length;
  if (techDesignContent) totalChars += techDesignContent.length;
  if (recentDiff) totalChars += Math.min(recentDiff.length, 50000);
  return Math.round(totalChars / 4);
}

function calculateDynamicMaxTasks(
  taskComplexity: 'simple' | 'medium' | 'complex',
  usagePercent: number
): number {
  const baseLimit = taskComplexity === 'simple' ? 8 :
                    taskComplexity === 'medium' ? 5 : 3;
  if (usagePercent > 70) return Math.max(2, baseLimit - 3);
  if (usagePercent > 50) return Math.max(3, baseLimit - 1);
  return baseLimit;
}

function detectTaskComplexity(task: Task): 'simple' | 'medium' | 'complex' {
  const actions = (task.actions || '').split(',').length;
  const hasMultipleFiles = (task.file || '').includes(',');
  const isQualityGate = task.quality_gate;
  const hasDesignRef = !!task.design_ref;

  if (isQualityGate || hasDesignRef || hasMultipleFiles) return 'complex';
  if (actions > 2) return 'medium';
  return 'simple';
}

function generateContextBar(usagePercent: number, warningThreshold: number, dangerThreshold: number): string {
  const filled = Math.round(usagePercent / 5);
  const warning = Math.round(warningThreshold / 5);
  const danger = Math.round(dangerThreshold / 5);

  let bar = '';
  for (let i = 0; i < 20; i++) {
    if (i < filled) {
      if (i >= danger / 5 * 4) bar += '🟥';
      else if (i >= warning / 5 * 4) bar += '🟨';
      else bar += '🟩';
    } else {
      bar += '░';
    }
  }
  return `[${bar}] ${usagePercent}%`;
}
```

---

## 执行模式

| 模式 | 参数 | 说明 | 中断点 |
|------|------|------|--------|
| 单步 | `--step` | 每个任务后暂停 | 每个任务 |
| 阶段 | `--phase` | 按大阶段连续执行 | 阶段变化时 (P0→P1) |
| 连续 | `--all` | 执行到质量关卡 | 质量关卡 / git_commit |

### Subagent 模式

| 参数 | 说明 |
|------|------|
| `--subagent` | 强制启用 subagent 模式 |
| `--no-subagent` | 强制禁用 subagent 模式 |
| _(无参数)_ | **自动检测**：任务数 > 5 时自动启用 |

> **Subagent 模式优势**：每个任务在独立 subagent 中执行，主会话只接收结果摘要，避免上下文膨胀，支持连续执行多个阶段。

**默认模式**：从 `workflow-state.json` 的 `execution_mode` 读取（由 `/workflow-start` 创建时设置为 `phase`）。

---

## 🔍 执行流程

### Step 0：解析执行模式

```typescript
const args = $ARGUMENTS.join(' ');

// 解析命令行参数
let executionModeOverride: string | null = null;
let useSubagentOverride: boolean | null = null;

if (args.includes('--step')) executionModeOverride = 'step';
else if (args.includes('--phase')) executionModeOverride = 'phase';
else if (args.includes('--all')) executionModeOverride = 'quality_gate';

// subagent 模式可与其他模式组合
if (args.includes('--subagent')) useSubagentOverride = true;
else if (args.includes('--no-subagent')) useSubagentOverride = false;
```

---

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

// 状态预检查：如果处于 planned 状态，转换为 running
if (state.status === 'planned') {
  state.status = 'running';
  state.phase = 'execute';
  state.updated_at = new Date().toISOString();

  // 渐进式工作流：检查是否所有任务都被阻塞
  if (state.mode === 'progressive') {
    const tasksPath = resolveUnder(workflowDir, state.tasks_file);
    if (tasksPath && fileExists(tasksPath)) {
      const tasksContent = readFile(tasksPath);
      const nextTask = findNextTask(tasksContent, state.progress);

      // 如果没有可执行的任务，转为 blocked 状态
      if (!nextTask && state.progress?.blocked?.length > 0) {
        state.status = 'blocked';
        writeFile(statePath, JSON.stringify(state, null, 2));

        const blockedDeps = [];
        if (!state.unblocked?.includes('api_spec')) blockedDeps.push('api_spec');
        if (!state.unblocked?.includes('design_spec')) blockedDeps.push('design_spec');

        console.log(`
📋 工作流规划完成，但所有任务需要等待依赖

🔄 **工作模式**：渐进式
⏳ **状态**：等待依赖解除

**阻塞的任务**：${state.progress.blocked.join(', ')}

**解除阻塞**：
\`\`\`bash
${blockedDeps.map(d => `/workflow-unblock ${d}`).join('\n')}
\`\`\`

💡 当后端接口或设计稿就绪后，执行上述命令解除相应依赖。
        `);
        return;
      }
    }
  }

  writeFile(statePath, JSON.stringify(state, null, 2));

  console.log(`
✅ 开始执行工作流

📋 任务名称：${state.task_name}
📊 任务数量：${countTasks(readFile(resolveUnder(workflowDir, state.tasks_file)))}
${state.mode === 'progressive' ? `🔄 工作模式：渐进式` : ''}
`);
}

// 状态预检查：如果处于失败状态，提示用户使用 retry
if (state.status === 'failed') {
  console.log(`
📂 工作流目录：${workflowDir}
📄 任务清单：${state.tasks_file}
📍 当前任务：${state.current_task}

⚠️ 当前工作流处于失败状态

失败任务：${state.current_task}
失败原因：${state.failure_reason || '未知'}

请使用以下命令：
- 重试当前步骤：/workflow-retry-step
- 跳过当前步骤：/workflow-skip-step（慎用）
  `);
  return;
}

// 渐进式工作流：如果处于 blocked 状态，提示用户解除阻塞
if (state.status === 'blocked') {
  const blockedDeps = [];
  if (!state.unblocked?.includes('api_spec')) blockedDeps.push('api_spec');
  if (!state.unblocked?.includes('design_spec')) blockedDeps.push('design_spec');

  console.log(`
📂 工作流目录：${workflowDir}
📄 任务清单：${state.tasks_file}
${state.mode === 'progressive' ? '🔄 工作模式：渐进式' : ''}

⏳ **工作流等待依赖解除**

当前所有可执行任务均被阻塞，等待外部依赖。

${state.progress?.blocked?.length > 0 ? `**阻塞的任务**：${state.progress.blocked.join(', ')}` : ''}

**解除阻塞**：
\`\`\`bash
${blockedDeps.map(d => `/workflow-unblock ${d}`).join('\n')}
\`\`\`

💡 当后端接口或设计稿就绪后，执行上述命令解除相应依赖。
  `);
  return;
}
```

---

### Step 2：路径安全校验

```typescript
// 使用统一路径安全函数校验 tasks_file
const tasksPath = resolveUnder(workflowDir, state.tasks_file);
if (!tasksPath) {
  console.log(`🚨 任务文件路径不安全: ${state.tasks_file}`);
  return;
}

if (!fileExists(tasksPath)) {
  console.log(`❌ 任务清单不存在：${tasksPath}`);
  return;
}

// 校验 tech_design 路径（相对于项目根目录）
let techDesignPath: string | null = null;
if (state.tech_design) {
  techDesignPath = resolveUnder(cwd, state.tech_design);
  if (!techDesignPath) {
    console.log(`🚨 技术方案路径不安全: ${state.tech_design}`);
    return;
  }
}

// 安全读取任务文件
const tasksContent = readFile(tasksPath);
const totalTaskCount = countTasks(tasksContent);

// 确定执行模式（命令行参数 > state 配置 > 默认 step）
const executionMode = executionModeOverride || state.execution_mode || 'step';
const pauseBeforeCommit = state.pause_before_commit !== false; // 默认 true

// ═══════════════════════════════════════════════════════════════
// Context Awareness: 估算 token 使用量
// ═══════════════════════════════════════════════════════════════

// 读取技术方案内容用于估算
let techDesignContent: string | null = null;
if (techDesignPath && fileExists(techDesignPath)) {
  techDesignContent = readFile(techDesignPath);
}

// 获取最近 diff（用于估算）
const recentDiff = await Bash({ command: 'git diff HEAD --stat 2>/dev/null || echo ""', timeout: 5000 });

// 估算当前上下文 token 数
const estimatedTokens = estimateContextTokens(
  tasksContent,
  techDesignContent,
  recentDiff.stdout
);
const usagePercent = Math.round(estimatedTokens / MAX_CONTEXT_TOKENS * 100);

// 初始化或更新 contextMetrics
if (!state.contextMetrics) {
  state.contextMetrics = {
    estimatedTokens,
    warningThreshold: 60,
    dangerThreshold: 80,
    maxConsecutiveTasks: 5,
    usagePercent,
    history: []
  };
}

state.contextMetrics.estimatedTokens = estimatedTokens;
state.contextMetrics.usagePercent = usagePercent;

// 连续任务计数（用于兜底机制，避免上下文溢出）
const consecutiveCount = state.consecutive_count || 0;

// 确定是否使用 subagent 模式
const autoSubagent = totalTaskCount > 5;
const useSubagent = useSubagentOverride ?? state.use_subagent ?? autoSubagent;

console.log(`
📂 工作流目录：${workflowDir}
📄 任务清单：${state.tasks_file}
📍 当前任务：${state.current_task}
⚡ 执行模式：${executionMode}${useSubagent ? ' (subagent)' : ''}
📊 上下文使用率：${generateContextBar(usagePercent, state.contextMetrics.warningThreshold, state.contextMetrics.dangerThreshold)}
${usagePercent > state.contextMetrics.warningThreshold ? `⚠️ 上下文使用率较高，建议减少连续执行任务数` : ''}
${useSubagent && autoSubagent && useSubagentOverride === null ? '💡 已自动启用 subagent 模式（任务数 > 5）' : ''}
`);
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

  const escapedId = escapeRegExp(taskId);

  // 新正则：捕获完整标题（包含可能的 emoji），后续再处理
  const regex = new RegExp(
    `##+ ${escapedId}:\\s*(.+?)\\s*\\n` +              // 标题（捕获完整内容）
    `(?:\\s*<!-- id: ${escapedId}[^>]*-->\\s*\\n)?` +  // 可选的 ID 注释
    `([\\s\\S]*?)` +                                     // 内容
    `(?=\\n##+ T\\d+:|$)`,                               // 下一个任务或结束
    'm'
  );

  const match = content.match(regex);
  if (!match) return null;

  // 从标题中提取状态 emoji 和纯标题
  const rawTitle = match[1].trim();
  const titleStatus = extractStatusFromTitle(rawTitle);
  const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();
  const body = match[2];

  // 解析字段（兼容 `- **字段**:` 和 `**字段**:` 两种格式）
  return {
    id: taskId,
    name: name,
    phase: extractField(body, '阶段'),
    file: extractField(body, '文件'),
    leverage: extractField(body, '复用'),
    design_ref: extractField(body, '设计参考'),
    requirement: extractField(body, '需求') || extractField(body, '内容'),
    actions: extractField(body, 'actions'),
    depends: extractField(body, '依赖'),
    quality_gate: parseQualityGate(body),
    threshold: parseInt(extractField(body, '阈值') || '80'),
    // 优先使用标题状态，其次使用字段状态
    status: titleStatus || extractField(body, '状态') || 'pending'
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

  addUnique(state.progress.failed, currentTask.id);
  state.status = 'failed';
  state.failure_reason = 'Missing actions field';
  state.updated_at = new Date().toISOString();
  writeFile(statePath, JSON.stringify(state, null, 2));
  updateTaskStatusInMarkdown(tasksPath, currentTask.id, '❌ failed (缺少 actions)');
  return;
}

// ═══════════════════════════════════════════════════════════════
// Subagent 模式：委托给独立 subagent 执行，避免上下文膨胀
// ═══════════════════════════════════════════════════════════════
if (useSubagent) {
  console.log(`🤖 **Subagent 模式**：委托任务 ${currentTask.id} 执行...\n`);

  try {
    const subagentResult = await Task({
      subagent_type: 'general-purpose',
      description: `执行 ${currentTask.id}: ${currentTask.name}`,
      prompt: `
你是工作流任务执行器。请执行以下任务：

## 任务信息
- **ID**: ${currentTask.id}
- **名称**: ${currentTask.name}
- **阶段**: ${currentTask.phase}
- **文件**: ${currentTask.file || '无指定'}
- **需求**: ${currentTask.requirement}
- **动作**: ${currentTask.actions}

## 上下文
- 项目根目录: ${cwd}
- 技术方案: ${techDesignPath || '无'}

## 设计参考
${currentTask.design_ref ? `参见技术方案中的 "${currentTask.design_ref}" 章节` : '无'}

## 约束
${extractConstraints(tasksContent).map(c => '- ' + c).join('\n')}

## 执行要求
1. 先用 mcp__auggie-mcp__codebase-retrieval 获取相关代码上下文
2. 根据 actions 执行操作（create_file/edit_file/run_tests/codex_review）
3. 遵循多模型协作流程（如适用）

## 输出格式要求（必须遵守）
完成后请在响应末尾输出 JSON 格式的结果：
\`\`\`json
{
  "success": true,
  "changed_files": ["file1.ts", "file2.ts"],
  "summary": "简要说明执行结果"
}
\`\`\`

如果执行失败，输出：
\`\`\`json
{
  "success": false,
  "error": "失败原因说明"
}
\`\`\`
`
    });

    // ═══════════════════════════════════════════════════════════
    // 解析结构化结果 - Fail-Closed 策略
    // 宁可误报失败也不要误报成功
    // ═══════════════════════════════════════════════════════════

    const resultStr = String(subagentResult);

    // 宽容匹配：支持 json/JSON/无标注，大小写不敏感
    const jsonMatch = resultStr.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);

    let parseError: string | null = null;
    let isSuccess = false;

    if (!jsonMatch) {
      parseError = 'Subagent 未返回 JSON 格式结果';
    } else {
      try {
        const parsed = JSON.parse(jsonMatch[1]);

        // 严格 schema 校验
        if (typeof parsed.success !== 'boolean') {
          parseError = 'Invalid schema: success 必须是 boolean 类型';
        } else if (parsed.success === true) {
          isSuccess = true;
          console.log(`✅ Subagent 完成: ${currentTask.id}`);
          if (parsed.changed_files?.length > 0) {
            console.log(`   修改文件: ${parsed.changed_files.join(', ')}`);
          }
          if (parsed.summary) {
            console.log(`   摘要: ${parsed.summary}`);
          }
        } else {
          // success === false - 容错处理 error 字段
          parseError = parsed.error ? String(parsed.error) : 'Subagent 报告失败（无详细原因）';
        }
      } catch (e) {
        parseError = `JSON 解析错误: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (!isSuccess) {
      throw new Error(parseError || 'Unknown subagent error');
    }

    // 成功：继续进入 Step 6 更新状态

  } catch (error) {
    // ═══════════════════════════════════════════════════════════
    // 与直接执行路径一致的失败处理
    // ═══════════════════════════════════════════════════════════

    const errorMessage = (error instanceof Error ? error.message : String(error))
      .replace(/[\r\n]+/g, ' ')
      .substring(0, 200);

    addUnique(state.progress.failed, currentTask.id);
    state.status = 'failed';
    state.failure_reason = errorMessage;
    state.updated_at = new Date().toISOString();
    writeFile(statePath, JSON.stringify(state, null, 2));
    updateTaskStatusInMarkdown(tasksPath, currentTask.id, `❌ failed (${errorMessage.substring(0, 50)})`);

    console.log(`
🛑 **Subagent 执行失败**

任务：${currentTask.id} - ${currentTask.name}
原因：${errorMessage}

💡 修复后执行：/workflow-retry-step
    `);
    return;
  }
} else {
  // ═══════════════════════════════════════════════════════════════
  // 直接执行模式（原有逻辑）
  // ═══════════════════════════════════════════════════════════════
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

// 更新连续任务计数
state.consecutive_count = (state.consecutive_count || 0) + 1;

state.current_task = findNextTask(tasksContent, state.progress);
state.updated_at = new Date().toISOString();

if (!state.current_task) {
  // 检查是否有被阻塞的任务（渐进式工作流）
  if (state.mode === 'progressive' && state.progress?.blocked?.length > 0) {
    state.status = 'blocked';
  } else {
    state.status = 'completed';
    state.completed_at = new Date().toISOString();
  }
  state.consecutive_count = 0;  // 重置计数
} else {
  state.status = 'running';
}

writeFile(statePath, JSON.stringify(state, null, 2));

// 2. 更新 tasks.md 中的状态标记（双向同步）
updateTaskStatusInMarkdown(tasksPath, currentTask.id, '✅ completed');

console.log(`
✅ 任务完成：${currentTask.id} - ${currentTask.name}
`);
```

---

### Step 7：判断是否继续执行

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

// 判断是否应该继续执行
function shouldContinueExecution(
  currentTask: Task,
  nextTask: Task,
  executionMode: string,
  pauseBeforeCommit: boolean,
  consecutiveCount: number,  // 本轮已连续执行的任务数
  contextMetrics: ContextMetrics  // 上下文感知指标
): { continue: boolean; reason?: string } {
  // 单步模式：始终暂停
  if (executionMode === 'step') {
    return { continue: false, reason: '单步模式' };
  }

  // ═══════════════════════════════════════════════════════════════
  // Context Awareness: 动态计算连续任务上限
  // ═══════════════════════════════════════════════════════════════
  const taskComplexity = detectTaskComplexity(nextTask);
  const dynamicMaxTasks = calculateDynamicMaxTasks(taskComplexity, contextMetrics.usagePercent);

  // 更新 contextMetrics 中的动态上限
  contextMetrics.maxConsecutiveTasks = dynamicMaxTasks;

  // 动态兜底机制：根据任务复杂度和上下文使用率调整
  if (consecutiveCount >= dynamicMaxTasks) {
    const reason = contextMetrics.usagePercent > contextMetrics.warningThreshold
      ? `上下文使用率 ${contextMetrics.usagePercent}%（连续 ${consecutiveCount} 任务）`
      : `连续任务数达到动态上限 (${dynamicMaxTasks})`;
    return { continue: false, reason };
  }

  // 上下文危险阈值：强制暂停
  if (contextMetrics.usagePercent > contextMetrics.dangerThreshold) {
    return { continue: false, reason: `上下文使用率 ${contextMetrics.usagePercent}% 超过危险阈值` };
  }

  // git_commit 前暂停确认
  if (pauseBeforeCommit && nextTask.actions?.includes('git_commit')) {
    return { continue: false, reason: '提交前确认' };
  }

  // 质量关卡暂停
  if (nextTask.quality_gate) {
    return { continue: false, reason: '质量关卡' };
  }

  // 阶段模式：阶段变化时暂停
  if (executionMode === 'phase') {
    const currentPhase = extractPhaseFromTask(currentTask);
    const nextPhase = extractPhaseFromTask(nextTask);
    if (currentPhase !== nextPhase) {
      return { continue: false, reason: `阶段变化 (${currentPhase} → ${nextPhase})` };
    }
  }

  // 连续模式（quality_gate）：只在质量关卡暂停（已在上面处理）
  return { continue: true };
}

/**
 * 细粒度阶段定义 - 与 workflow-start.md 保持同步
 *
 * 阶段划分原则：
 * - 每个阶段理想任务数：3-5 个
 * - 超过 5 个任务的大阶段应拆分为子阶段
 *
 * 阶段定义：
 * - design: 接口设计、架构设计、类型定义
 * - infra: 基础设施、Store、工具函数、指令、守卫
 * - ui-layout: 页面布局、路由、菜单配置
 * - ui-display: 展示组件（卡片、表格、列表）
 * - ui-form: 表单组件（弹窗、输入、选择器）
 * - ui-integrate: 组件集成、注册、组装
 * - test: 单元测试、集成测试
 * - verify: 代码审查、质量关卡
 * - deliver: 提交、发布、文档
 */
function extractPhaseFromTask(task: Task): string {
  // 优先使用任务的 phase 字段
  if (task.phase) return task.phase;

  const name = task.name.toLowerCase();
  const file = (task.file || '').toLowerCase();

  // 1. 设计阶段
  if (/接口|设计|interface|架构|architecture|类型|type/.test(name)) return 'design';

  // 2. 基础设施阶段（Store、工具、指令、守卫）
  if (/store|composable|hook|工具|util|helper|指令|directive|守卫|middleware|guard/.test(name) ||
      /stores\/|composables\/|utils\/|directives\/|middleware\//.test(file)) return 'infra';

  // 3. UI 布局阶段（页面、路由、菜单）
  if (/页面|page|路由|route|菜单|menu|布局|layout|主页|index/.test(name) ||
      /pages\/.*index|pages\/.*\.vue$/.test(file)) return 'ui-layout';

  // 4. UI 展示组件（卡片、表格、列表）
  if (/卡片|card|表格|table|列表|list|展示|display|筛选|filter/.test(name)) return 'ui-display';

  // 5. UI 表单组件（弹窗、表单、选择器）
  if (/弹窗|modal|dialog|表单|form|选择|select|输入|input|编辑|edit|创建|create/.test(name) ||
      /modals\/|dialogs\//.test(file)) return 'ui-form';

  // 6. UI 集成（注册、扩展、改造）
  if (/注册|register|集成|integrate|扩展|extend|改造|refactor|provider/.test(name)) return 'ui-integrate';

  // 7. 测试阶段
  if (/测试|test|单元|unit|集成|integration/.test(name)) return 'test';

  // 8. 验证阶段
  if (/审查|review|验证|verify|验收|qa|确认|check/.test(name)) return 'verify';

  // 9. 交付阶段
  if (/提交|commit|发布|release|部署|deploy|文档|doc/.test(name)) return 'deliver';

  // 默认：根据文件路径进一步判断
  if (/components\//.test(file)) return 'ui-display';

  return 'implement';  // 兜底
}

const decision = shouldContinueExecution(currentTask, nextTask, executionMode, pauseBeforeCommit, consecutiveCount, state.contextMetrics);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **进度**: ${state.progress.completed.length} / ${countTasks(tasksContent)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 已完成：${currentTask.id} - ${currentTask.name}
🚀 下一任务：${nextTask.id} - ${nextTask.name}
**阶段**: ${nextTask.phase || extractPhaseFromTask(nextTask)}
${nextTask.file ? `**文件**: \`${nextTask.file}\`` : ''}
`);

if (decision.continue) {
  console.log(`
⏩ **连续执行中**（模式: ${executionMode}）

正在自动执行下一个任务...
`);
  // 连续执行：继续执行下一个任务
  // Claude 将自动继续执行 Step 3-7 的逻辑
  // [CONTINUE_EXECUTION]
} else {
  // 暂停时重置连续任务计数
  state.consecutive_count = 0;

  // 记录 context history
  state.contextMetrics.history.push({
    taskId: currentTask.id,
    tokens: state.contextMetrics.estimatedTokens,
    timestamp: new Date().toISOString()
  });

  // 保持 history 最近 10 条
  if (state.contextMetrics.history.length > 10) {
    state.contextMetrics.history = state.contextMetrics.history.slice(-10);
  }

  writeFile(statePath, JSON.stringify(state, null, 2));

  // 阶段切换或上下文警告时建议新开会话
  const isPhaseChange = decision.reason.includes('阶段变化');
  const isConsecutiveLimit = decision.reason.includes('连续') || decision.reason.includes('动态上限');
  const isContextWarning = decision.reason.includes('上下文使用率');

  let sessionHint = '';
  if (isContextWarning) {
    sessionHint = `
⚠️ **上下文使用率较高**
📊 当前：${generateContextBar(state.contextMetrics.usagePercent, state.contextMetrics.warningThreshold, state.contextMetrics.dangerThreshold)}
💡 **强烈建议**：执行 \`/clear\` 或 **新开会话** 继续执行
`;
  } else if (isPhaseChange || isConsecutiveLimit) {
    sessionHint = `
💡 **建议**：${isPhaseChange ? '阶段已完成' : '已连续执行多个任务'}，推荐 **新开会话** 继续执行以避免上下文压缩。
`;
  }

  console.log(`
⏸️ **已暂停**（${decision.reason}）
${sessionHint}
**继续执行**：
\`\`\`bash
/workflow-execute
\`\`\`
`);
}
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

  // SESSION_ID 复用：检查是否有之前的 codex 会话
  const codexSessionId = state.sessions?.codex;
  if (codexSessionId) {
    console.log(`📎 复用 Codex 会话: ${codexSessionId.substring(0, 8)}...`);
  }

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

  // 构建命令：如果有 SESSION_ID 则使用 resume 模式
  const codexCommand = codexSessionId
    ? `codeagent-wrapper --backend codex resume ${codexSessionId} - "${process.cwd()}" < "${tempFile}"`
    : `codeagent-wrapper --backend codex - "${process.cwd()}" < "${tempFile}"`;

  const codexResult = await Bash({
    command: codexCommand,
    run_in_background: true
  });

  const output = await TaskOutput({ task_id: codexResult.task_id, block: true });

  // 清理临时文件
  await Bash({ command: `rm -f "${tempFile}"` });

  // 提取并存储 SESSION_ID（用于后续复用）
  const sessionMatch = output.match(/SESSION_ID:\s*([0-9a-f-]{36})/i);
  if (sessionMatch) {
    if (!state.sessions) state.sessions = { codex: null, gemini: null, claude: null };
    state.sessions.codex = sessionMatch[1];
    console.log(`💾 保存 Codex SESSION_ID: ${sessionMatch[1].substring(0, 8)}...`);
  }

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

  // 使用共享的 escapeRegExp 函数
  const escapedId = escapeRegExp(taskId);

  // 兼容 ## 和 ### 格式
  const taskRegex = new RegExp(
    `(##+ ${escapedId}:[\\s\\S]*?)(?=\\n##+ T\\d+:|$)`,
    'm'
  );
  const taskMatch = content.match(taskRegex);

  if (!taskMatch) {
    console.log(`⚠️ 未找到任务 ${taskId}`);
    return;
  }

  const taskBlock = taskMatch[1];
  let updatedBlock = taskBlock;

  // 尝试方式1: 更新 `- **状态**:` 字段
  const statusFieldRegex = /(- \*\*状态\*\*:\s*)([^\n]+)/;
  if (statusFieldRegex.test(taskBlock)) {
    updatedBlock = taskBlock.replace(statusFieldRegex, (_, prefix) => prefix + newStatus);
  }
  // 尝试方式2: 更新标题中的状态 emoji
  else {
    // 使用 escapedId 而非写死 T\d+
    const titleLineRegex = new RegExp(
      `(##+ ${escapedId}:\\s*)(.+?)(\\s*\\n)`,
      'm'
    );

    const statusEmoji = getStatusEmoji(newStatus);

    updatedBlock = taskBlock.replace(titleLineRegex, (_, prefix, title, suffix) => {
      // 移除旧的状态 emoji（使用共享正则）
      const cleanTitle = title.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();
      return `${prefix}${cleanTitle}${statusEmoji}${suffix}`;
    });
  }

  content = content.replace(taskBlock, updatedBlock);
  writeFile(filePath, content);
}

function findNextTask(content: string, progress: Progress): string | null {
  // 找到所有任务 ID（兼容 ## 和 ### 格式）
  const taskIds = [...content.matchAll(/##+ (T\d+):/g)].map(m => m[1]);

  // 找到第一个未完成且未阻塞的任务
  for (const id of taskIds) {
    if (!progress.completed.includes(id) &&
        !progress.skipped.includes(id) &&
        !progress.failed.includes(id) &&
        !progress.blocked?.includes(id)) {  // 跳过被阻塞的任务
      return id;
    }
  }

  return null;
}

function countTasks(content: string): number {
  return (content.match(/##+ T\d+:/g) || []).length;
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
  const escapedRef = escapeRegExp(sectionRef);
  const regex = new RegExp(
    `## ${escapedRef}[\\s\\S]*?(?=\\n## |$)`,
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
  addUnique(state.progress.failed, task.id);
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
