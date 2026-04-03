# ContextGovernor

> 从 `execution-modes.md` 拆分。所有执行模式共享的 continuation 治理决策器。

## 快速导航

- 想看决策优先级：看“决策顺序”
- 想看输出动作类型：看“决策输出”
- 想看 budget / pause / handoff 的判定：看后续阈值与示例
- 想看并行边界与 subagent 决策：结合 `subagent-routing.md`

## 何时读取

- 需要判断 execute 是否应该继续、暂停、handoff 或切到 parallel-boundaries 时

`ContextGovernor` 不是"兜底机制"，而是决定下一步的第一优先级调度器。

## 决策顺序

```text
1. 检查硬停止条件
   - failed / blocked
   - retry hard stop
   - 缺少验证证据
   - quality_review 预算耗尽

2. 评估下一执行单元的主治理信号
   - 任务独立性（是否存在可证明独立边界）
   - 上下文污染风险（是否会向主会话注入低价值上下文）

3. 先产出建议执行路径
   - 高独立 + 高污染 → 优先 parallel-boundaries / 隔离执行
   - 低独立 + 高污染 → 优先 pause-governance 或单任务隔离
   - 低污染任务 → 可继续 direct

4. 应用治理语义
   - quality gate
   - before commit
   - phase boundary

5. 最后应用 budget backstop
   - warning：仅作为提示/偏置信号
   - danger：当建议路径仍会扩张主会话时触发 pause-budget
   - hard handoff：生成 continuation artifact 并要求新会话恢复
```


## 决策输出

```typescript
type ContinuationAction =
  | 'continue-direct'
  | 'continue-parallel-boundaries'
  | 'pause-budget'
  | 'pause-governance'
  | 'pause-quality-gate'
  | 'pause-before-commit'
  | 'handoff-required';
```

## 节奏控制信号

`consecutive_count` 与 `maxConsecutiveTasks` 继续保留，但它们只作为节奏控制信号：
- 不能覆盖 danger / hard handoff 水位
- 不能覆盖独立边界并行机会
- 不能绕过质量关卡或验证门控

## 预算暂停与交接语义

```typescript
if (state.contextMetrics.projectedUsagePercent >= state.contextMetrics.hardHandoffThreshold) {
  writeContinuationArtifact(state);
  state.continuation = {
    strategy: 'context-first',
    last_decision: {
      action: 'handoff-required',
      reason: 'hard-handoff-threshold',
      budgetBackstopTriggered: true,
      budgetLevel: 'hard_handoff'
    },
    handoff_required: true,
    artifact_path: continuationArtifactPath
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}

if (state.contextMetrics.projectedUsagePercent >= state.contextMetrics.dangerThreshold) {
  state.continuation = {
    strategy: 'context-first',
    last_decision: {
      action: 'pause-budget',
      reason: 'context-danger',
      budgetBackstopTriggered: true,
      budgetLevel: 'danger'
    },
    handoff_required: false,
    artifact_path: null
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}
```

---

## 决策优先级

`execution_mode` 仍保留原优先级，但它只在 `ContextGovernor` 判定允许继续时生效。

**执行治理优先级（从高到低）**：
1. **硬停止 / 验证阻断 / review budget 耗尽**
2. **任务独立性与上下文污染风险判断**
3. **治理语义边界（quality gate / before commit / phase）**
4. **budget backstop 覆盖**
5. **命令行参数**：`/workflow execute --phase`
6. **state 配置**：`state.execution_mode`
7. **默认值**：`continuous`

```typescript
const executionMode = executionModeOverride || state.execution_mode || 'continuous';
const decision = evaluateContinuationDecision(...);

if (decision.action !== 'continue-direct') {
  // ── 决策通知协议 ──
  // 正常暂停 → 简短通知；覆盖性暂停 → 完整 3 要素解释
  notifyGovernorDecision(decision, executionMode, state.contextMetrics);
  applyDecision(decision);
  return;
}
```

### Governor 决策通知协议

Governor 的非 `continue-direct` 决策分为两类，通知详细程度不同：

**正常暂停通知**（简短提示，不需要完整解释）：
- `pause-quality-gate`：质量关卡触发，属于正常流程
- `pause-before-commit`：git_commit 前确认，属于正常流程
- `pause-governance`：治理 phase 边界暂停，属于正常流程
- `continue-parallel-boundaries`：路由到并行执行，属于正常优化

**覆盖性暂停解释**（当 Governor 覆盖了用户请求的执行模式时，必须包含 3 要素）：
- `pause-budget`、`handoff-required`

覆盖性解释的 3 要素：
1. **覆盖原因**：具体数据（如 `projectedUsagePercent: 82%, dangerThreshold: 80%`）
2. **原模式保留**：用户请求的模式在恢复后自动继续（`state.execution_mode` 不变）
3. **建议动作**：用户下一步该做什么

```typescript
function notifyGovernorDecision(
  decision: { action: ContinuationAction; reason: string },
  requestedMode: string,
  metrics: ContextMetrics
): void {
  // 正常暂停：简短通知
  const normalPauses: ContinuationAction[] = [
    'pause-quality-gate', 'pause-before-commit', 'pause-governance', 'continue-parallel-boundaries'
  ];
  if (normalPauses.includes(decision.action)) {
    console.log(`ℹ️ ${decision.action}：${decision.reason}`);
    return;
  }

  // 覆盖性暂停：完整 3 要素解释
  console.log(
    `⚠️ ContextGovernor 覆盖 ${requestedMode} 模式\n` +
    `   原因：${decision.reason}（当前 ${metrics.projectedUsagePercent}%, 阈值 ${metrics.dangerThreshold}%）\n` +
    `   模式保留：恢复后自动继续 ${requestedMode} 模式\n` +
    `   建议：${decision.action === 'handoff-required'
      ? '启动新会话执行 /workflow execute 恢复'
      : '等待预算释放后 /workflow execute 继续'}`
  );
}
```

## Python 脚本实现

> 以上决策逻辑的确定性部分已实现于 `../../../../utils/workflow/execution_sequencer.py`：
> - `decide_governance_action()` — 纯阈值比较 + 决策输出
> - `apply_governance_decision()` — 写入 continuation 状态
