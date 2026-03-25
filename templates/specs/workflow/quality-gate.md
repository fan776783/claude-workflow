# 质量关卡

## 定义

质量关卡是工作流中的检查点，确保阶段性产出达标后才能继续。

## 任务标记

在 tasks.md 中标记质量关卡：

```markdown
## T5: 单元测试
- **阶段**: P1
- **actions**: run_tests
- **质量关卡**: true
- **阈值**: 80
```

## 检测逻辑

```typescript
function parseQualityGate(body: string): boolean {
  const match = body.match(/\*\*质量关卡\*\*:\s*(true|false)/i);
  if (!match) return false;
  return match[1].toLowerCase() === 'true';
}
```

## 中断行为

当遇到质量关卡任务时：

1. **step 模式**: 正常执行后暂停
2. **phase 模式**: 正常执行后暂停
3. **all 模式**: 执行后**强制暂停**等待用户确认

## 判定机制

质量关卡任务按 action 类型判定结果：

| 类型 | 通过条件 | 失败条件 |
|------|----------|----------|
| `run_tests` | 测试命令通过 | 测试失败或退出码非 0 |
| `quality_review` | Stage 1 + Stage 2 全部通过 | 任一阶段失败或预算耗尽 |

## 常见质量关卡

| 类型 | actions | 阈值建议 |
|------|---------|----------|
| 单元测试 | run_tests | 80% |
| 两阶段代码审查 | quality_review | 通过 Stage 1/Stage 2 |
| 集成测试 | run_tests | 90% |
| 类型检查 | type_check | 100% |
