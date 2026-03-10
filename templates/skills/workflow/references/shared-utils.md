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

## 任务解析

```typescript
interface Task {
  id: string;
  name: string;
  phase: string;
  file: string | null;
  leverage: string | null;
  design_ref: string | null;
  requirement: string;
  actions: string;
  depends: string | null;
  blocked_by: string[] | null;
  quality_gate: boolean;
  status: string;
}

function parseTasksFromMarkdown(content: string): Task[] {
  const tasks: Task[] = [];
  const regex = /##+ (T\d+):\s*(.+?)\s*\n(?:\s*<\!-- id: T\d+[^>]*-->\s*\n)?([\s\S]*?)(?=\n##+ T\d+:|$)/gm;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const [, id, rawTitle, body] = match;
    const titleStatus = extractStatusFromTitle(rawTitle);
    const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();

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
      blocked_by,
      quality_gate: parseQualityGate(body),
      status: titleStatus || extractField(body, '状态') || 'pending'
    });
  }

  return tasks;
}

function findNextTask(content: string, progress: Progress): string | null {
  const taskIds = [...content.matchAll(/##+ (T\d+):/g)].map(m => m[1]);

  for (const id of taskIds) {
    if (!progress.completed.includes(id) &&
        !progress.skipped.includes(id) &&
        !progress.failed.includes(id) &&
        !progress.blocked?.includes(id)) {
      return id;
    }
  }

  return null;
}

function countTasks(content: string): number {
  return (content.match(/##+ T\d+:/g) || []).length;
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
