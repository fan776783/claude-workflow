# 共享工具函数 (v3.0)

工作流系统中多处使用的共享函数。

## 路径安全

```typescript
/**
 * 安全解析相对路径（防止路径遍历攻击）
 */
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
```

## 状态 Emoji 处理

```typescript
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

function getStatusEmoji(status: string): string {
  if (status.includes('completed')) return ' ✅';
  if (status.includes('in_progress')) return ' ⏳';
  if (status.includes('failed')) return ' ❌';
  if (status.includes('skipped')) return ' ⏭️';
  return '';
}
```

## 通用工具

```typescript
/**
 * 数组去重添加
 */
function addUnique<T>(arr: T[], item: T): void {
  if (!arr.includes(item)) arr.push(item);
}

/**
 * 正则转义
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析质量关卡标记
 */
function parseQualityGate(body: string): boolean {
  const match = body.match(/\*\*质量关卡\*\*:\s*(true|false)/i);
  if (!match) return false;
  return match[1].toLowerCase() === 'true';
}

/**
 * 提取字段值
 */
function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*\`?([^\`\\n]+)\`?`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}
```

## 上下文感知

```typescript
interface ContextMetrics {
  maxContextTokens: number;
  estimatedTokens: number;
  projectedNextTurnTokens: number;
  reservedExecutionTokens: number;
  reservedVerificationTokens: number;
  reservedReviewTokens: number;
  reservedSafetyBufferTokens: number;
  usagePercent: number;
  projectedUsagePercent: number;
  warningThreshold: number;      // 默认 60
  dangerThreshold: number;       // 默认 80
  hardHandoffThreshold: number;  // 默认 90
  maxConsecutiveTasks: number;   // 节奏控制，不再单独主导 continuation
  history: Array<{
    taskId: string;
    phase: string;
    preTaskTokens: number;
    postTaskTokens: number;
    tokenDelta: number;
    executionPath: 'direct' | 'single-subagent' | 'parallel-boundaries';
    triggeredVerification: boolean;
    triggeredReview: boolean;
    timestamp: string;
  }>;
}

function estimateContextTokens(contents: Array<string | null | undefined>): number {
  let totalChars = 0;
  for (const content of contents) {
    if (content) totalChars += content.length;
  }
  return Math.round(totalChars / 4);
}

function calculateDynamicMaxTasks(
  taskComplexity: 'simple' | 'medium' | 'complex',
  usagePercent: number
): number {
  const baseLimit = taskComplexity === 'simple' ? 8 :
                    taskComplexity === 'medium' ? 5 : 3;
  if (usagePercent >= 80) return 1;
  if (usagePercent >= 70) return Math.max(2, baseLimit - 3);
  if (usagePercent >= 50) return Math.max(3, baseLimit - 1);
  return baseLimit;
}

function detectTaskComplexity(task: WorkflowTaskV2): 'simple' | 'medium' | 'complex' {
  const actions = task.actions.length;
  const fileCount = [
    ...(task.files.create || []),
    ...(task.files.modify || []),
    ...(task.files.test || [])
  ].length;
  const isQualityGate = !!task.quality_gate;
  const hasStructuredSteps = task.steps.length > 0;

  if (isQualityGate || hasStructuredSteps || fileCount > 1) return 'complex';
  if (actions > 2) return 'medium';
  return 'simple';
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
```

> `shared-utils` 中的上下文结构必须与 `templates/specs/shared/context-awareness.md` 保持一致。任何继续执行判断都应以 projected budget 为准，而不是只看当前 usagePercent。

## 任务解析

> `tasks.md` 仅使用 V2 任务模型。状态页、执行链路、delta 流程都直接消费 `files{}`、`actions[]`、`steps[]`、`spec_ref`、`plan_ref`、`acceptance_criteria` 等字段，不再维护旧任务格式的映射层。

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
  status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  actions: Array<'create_file' | 'edit_file' | 'run_tests' | 'quality_review' | 'git_commit'>;
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

function extractTaskBlock(content: string, taskId: string): string {
  const escapedId = escapeRegExp(taskId);
  const taskRegex = new RegExp(`##+ ${escapedId}:[\\s\\S]*?(?=\\n##+ T\\d+:|$)`, 'm');
  return content.match(taskRegex)?.[0] || '';
}

function extractListField(body: string, fieldName: string): string[] {
  const value = extractField(body, fieldName);
  return value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function parseTaskFiles(body: string): WorkflowTaskV2['files'] {
  return {
    create: extractListField(body, '创建文件'),
    modify: extractListField(body, '修改文件'),
    test: extractListField(body, '测试文件')
  };
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
      status: (titleStatus || extractField(body, '状态') || 'pending') as WorkflowTaskV2['status'],
      actions: extractListField(body, 'actions') as WorkflowTaskV2['actions'],
      steps: extractStepsFromTaskBlock(content, taskId),
      verification: parseTaskVerification(body)
    };
  });
}

function findNextTask(content: string, progress: Progress): string | null {
  const tasks = parseWorkflowTasksV2FromMarkdown(content);

  for (const task of tasks) {
    if (!progress.completed.includes(task.id) &&
        !progress.skipped.includes(task.id) &&
        !progress.failed.includes(task.id) &&
        !progress.blocked?.includes(task.id)) {
      return task.id;
    }
  }

  return null;
}

function countTasks(content: string): number {
  return parseWorkflowTasksV2FromMarkdown(content).length;
}
```


## Markdown 状态更新

```typescript
function updateTaskStatusInMarkdown(filePath: string, taskId: string, newStatus: string) {
  let content = readFile(filePath);
  const escapedId = escapeRegExp(taskId);

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

  const statusFieldRegex = /(- \*\*状态\*\*:\s*)([^\n]+)/;
  if (statusFieldRegex.test(taskBlock)) {
    updatedBlock = taskBlock.replace(statusFieldRegex, (_, prefix) => prefix + newStatus);
  } else {
    const titleLineRegex = new RegExp(
      `(##+ ${escapedId}:\\s*)(.+?)(\\s*\\n)`,
      'm'
    );
    const statusEmoji = getStatusEmoji(newStatus);
    updatedBlock = taskBlock.replace(titleLineRegex, (_, prefix, title, suffix) => {
      const cleanTitle = title.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();
      return `${prefix}${cleanTitle}${statusEmoji}${suffix}`;
    });
  }

  content = content.replace(taskBlock, updatedBlock);
  writeFile(filePath, content);
}
```
