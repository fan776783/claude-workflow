# 状态 Emoji 处理

## 常量定义

```typescript
const STATUS_EMOJI_REGEX = /(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;
const STRIP_STATUS_EMOJI_REGEX = /\s*(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;
```

## 函数

### extractStatusFromTitle

从标题中提取状态。

```typescript
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
```

### getStatusEmoji

根据状态返回对应的 Emoji。

```typescript
function getStatusEmoji(status: string): string {
  if (status.includes('completed')) return ' ✅';
  if (status.includes('in_progress')) return ' ⏳';
  if (status.includes('failed')) return ' ❌';
  if (status.includes('skipped')) return ' ⏭️';
  return '';
}
```

## 状态映射表

| Emoji | 状态 |
|-------|------|
| ✅ | completed |
| ⏳ | in_progress |
| ❌ | failed |
| ⏭️ | skipped |
