# Subagent 执行模式

## 概述

Subagent 模式将任务委托给独立的 subagent 执行，主会话只接收结果摘要，避免上下文膨胀。

## 启用条件

| 条件 | 行为 |
|------|------|
| `--subagent` 参数 | 强制启用 |
| `--no-subagent` 参数 | 强制禁用 |
| 任务数 > 5 | 自动启用 |
| 任务数 ≤ 5 | 不自动启用 |

## 执行流程

```typescript
const subagentResult = await Task({
  subagent_type: 'general-purpose',
  description: `执行 ${task.id}: ${task.name}`,
  prompt: `
你是工作流任务执行器。请执行以下任务：

## 任务信息
- **ID**: ${task.id}
- **名称**: ${task.name}
- **阶段**: ${task.phase}
- **文件**: ${task.file || '无指定'}
- **需求**: ${task.requirement}
- **动作**: ${task.actions}

## 执行要求
1. 先用 mcp__auggie-mcp__codebase-retrieval 获取相关代码上下文
2. 根据 actions 执行操作
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
`
});
```

## 结果解析

采用 **Fail-Closed** 策略：宁可误报失败也不要误报成功。

```typescript
const jsonMatch = resultStr.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);

if (!jsonMatch) {
  throw new Error('Subagent 未返回 JSON 格式结果');
}

const parsed = JSON.parse(jsonMatch[1]);

if (typeof parsed.success !== 'boolean') {
  throw new Error('Invalid schema: success 必须是 boolean 类型');
}

if (parsed.success === true) {
  // 成功处理
} else {
  throw new Error(parsed.error || 'Subagent 报告失败');
}
```

## 错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| 无 JSON 输出 | 标记失败 |
| JSON 解析错误 | 标记失败 |
| schema 不符 | 标记失败 |
| success: false | 标记失败，记录 error |

## 优势

1. **上下文隔离**: 每个任务独立执行，不污染主会话
2. **可扩展性**: 支持连续执行多个阶段
3. **错误隔离**: 单个任务失败不影响其他任务状态
