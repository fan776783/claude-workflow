# 质量关卡

## 定义

质量关卡是workflow中的检查点，确保阶段性产出达标后才能继续。

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
3. **quality_gate / 连续模式**: 默认执行到质量关卡后暂停；若下一步是 `git_commit` 且 `pause_before_commit=true`，则也会在提交前暂停

## 判定机制

质量关卡任务按 action 类型判定结果：

| 类型 | 通过条件 | 失败条件 |
|------|----------|----------|
| `run_tests` | 测试命令通过 | 测试失败或退出码非 0 |
| `quality_review` | Stage 1 + Stage 2 全部通过 | 任一阶段失败或预算耗尽 |

`quality_review` 现被视为 shared review loop contract 的 execution adapter：
- review对象会先归一化为 `ReviewSubject(kind='diff_window')`
- execution side 结果写入 `state.quality_gates[task.id]`
- 产物语义与 planning side 对齐，至少包含 `review_mode / subject / attempt / max_attempts / last_decision / next_action / overall_passed`

`quality_review` 的 Stage 2 虽然会使用单 reviewer subagent，但它不属于 `dispatching-parallel-agents` 的并行分派场景；后者仅用于 2+ 独立问题域 / 任务域的并行执行。

## 质量关卡验证

质量关卡的验证和阻断完全由 skill 指令（`workflow-execute` / `workflow-review`）和 CLI 驱动：

- `run_tests` 类 gate 以命令退出码为准
- `quality_review` 类 gate 以 `state.quality_gates[taskId].overall_passed === true` 为准
- 验证 evidence 由 CLI/runtime 写入，skill 按 Post-Execution Pipeline 的 ① 验证步骤执行
- 若下一步是 `git_commit` 且 `pause_before_commit=true`，由 execute governance 决定是否继续

## 常见质量关卡

| 类型 | actions | 阈值建议 |
|------|---------|----------|
| 单元测试 | run_tests | 80% |
| 两阶段代码review（execution adapter） | quality_review | 通过 Stage 1/Stage 2 |
| 集成测试 | run_tests | 90% |
| 类型检查 | type_check | 100% |
