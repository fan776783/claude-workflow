# 任务解析器

## 核心函数

### validateTaskId

```typescript
function validateTaskId(taskId: string): boolean {
  return /^T\d+$/.test(taskId);
}
```

### extractCurrentTask

从 tasks.md 中提取指定任务。

```typescript
function extractCurrentTask(content: string, taskId: string): Task | null {
  if (!validateTaskId(taskId)) {
    console.log(`❌ 无效的任务 ID 格式: ${taskId}，期望格式: T1, T2, ...`);
    return null;
  }

  const escapedId = escapeRegExp(taskId);
  const regex = new RegExp(
    `##+ ${escapedId}:\\s*(.+?)\\s*\\n` +
    `(?:\\s*<!-- id: ${escapedId}[^>]*-->\\s*\\n)?` +
    `([\\s\\S]*?)` +
    `(?=\\n##+ T\\d+:|$)`,
    'm'
  );

  const match = content.match(regex);
  if (!match) return null;

  const rawTitle = match[1].trim();
  const titleStatus = extractStatusFromTitle(rawTitle);
  const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();
  const body = match[2];

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
    status: titleStatus || extractField(body, '状态') || 'pending'
  };
}
```

### extractField

提取字段值，兼容两种格式。

```typescript
function extractField(body: string, fieldName: string): string | null {
  // 兼容 `- **字段**:` 和 `**字段**:` 两种格式
  const regex = new RegExp(`(?:- )?\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}
```

### parseQualityGate

```typescript
function parseQualityGate(body: string): boolean {
  const match = body.match(/\*\*质量关卡\*\*:\s*(true|false)/i);
  if (!match) return false;
  return match[1].toLowerCase() === 'true';
}
```

## Task 接口

```typescript
interface Task {
  id: string;
  name: string;
  phase: string | null;
  file: string | null;
  leverage: string | null;
  design_ref: string | null;
  requirement: string | null;
  actions: string | null;
  depends: string | null;
  quality_gate: boolean;
  threshold: number;
  status: string;
}
```
