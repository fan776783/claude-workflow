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

## 评分机制

质量关卡任务需要评估结果：

| 评分 | 结果 |
|------|------|
| ≥ threshold | 通过，继续执行 |
| < threshold | 失败，进入 failed 状态 |

## 常见质量关卡

| 类型 | actions | 阈值建议 |
|------|---------|----------|
| 单元测试 | run_tests | 80% |
| 代码审查 | codex_review | 70 |
| 集成测试 | run_tests | 90% |
| 类型检查 | type_check | 100% |
