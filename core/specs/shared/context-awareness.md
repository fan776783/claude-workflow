# Context Awareness 模块

上下文感知系统用于监控和治理执行期上下文压力，避免在长链路执行中因为主会话膨胀而导致推理退化、无意义暂停或错误继续执行。

> 自 vNext 起，`workflow execute` 采用 **budget-first** continuation governance：
> - `execution_mode` 仅定义用户偏好的**语义暂停点**
> - `ContextGovernor` 定义系统层面的**继续执行准入规则**
> - 当存在可证明独立的同阶段任务边界时，`ContextGovernor` 可优先建议 `parallel-boundaries` 以降低主会话上下文压力

## 核心原则

1. **预算优先**：先判断“下一步是否还能安全执行”，再判断“按什么模式继续”
2. **治理优先于模式**：`step / phase / quality_gate` 是软语义边界，不覆盖硬预算约束
3. **并行是治理策略**：在规划工件稳定、独立性可证明时，边界并行属于上下文减压手段，不只是性能优化
4. **无法证明安全，就暂停**：无法证明剩余预算足够、无法证明并行独立、无法证明验证可隔离时，一律暂停或降级为顺序执行
5. **没有新鲜验证证据，不得标记完成**：预算治理不会绕过执行后的验证铁律

## 数据结构

```typescript
interface ContextHistoryEntry {
  taskId: string;
  phase: string;
  preTaskTokens: number;
  postTaskTokens: number;
  tokenDelta: number;
  executionPath: 'direct' | 'single-subagent' | 'parallel-boundaries';
  triggeredVerification: boolean;
  triggeredReview: boolean;
  timestamp: string;
}

interface ContextMetrics {
  maxContextTokens: number;      // 运行时上下文上限，禁止写死 200k
  estimatedTokens: number;       // 当前主会话估算 token
  projectedNextTurnTokens: number; // 下一执行单元的预计总成本
  reservedExecutionTokens: number;
  reservedVerificationTokens: number;
  reservedReviewTokens: number;
  reservedSafetyBufferTokens: number;
  usagePercent: number;
  projectedUsagePercent: number;
  maxConsecutiveTasks: number;
  history: ContextHistoryEntry[];
  warningThreshold: number;
  dangerThreshold: number;
  hardHandoffThreshold: number;
}

interface ContinuationDecision {
  action:
    | 'continue-direct'
    | 'continue-parallel-boundaries'
    | 'pause-budget'
    | 'pause-governance'
    | 'pause-quality-gate'
    | 'pause-before-commit'
    | 'handoff-required';
  reason:
    | 'mode-step'
    | 'mode-phase-boundary'
    | 'quality-gate'
    | 'commit-gate'
    | 'context-warning'
    | 'context-danger'
    | 'projected-overflow'
    | 'hard-handoff-threshold'
    | 'parallel-boundaries-preferred';
  severity: 'info' | 'warning' | 'danger';
  nextTaskIds: string[];
  boundaryGroupId?: string;
  suggestedExecutionPath: 'direct' | 'single-subagent' | 'parallel-boundaries';
}
```

## 核心函数

### Token 估算

```typescript
/**
 * 估算上下文 token 数。
 *
 * 说明：
 * - 仍允许使用 chars / 4 的近似算法作为基础实现
 * - 但估算对象不再仅限 tasks.md + tech design + recent diff
 * - 必须把“下一执行单元”的主会话成本纳入估算
 */
function estimateContextTokens(contents: Array<string | null | undefined>): number {
  let totalChars = 0;
  for (const content of contents) {
    if (content) totalChars += content.length;
  }
  return Math.round(totalChars / 4);
}
```

**估算对象至少包含**：
- 当前 `tasks.md` / `spec` / `brief` / `tech design` 中本轮必需片段
- 当前主会话的必要摘要，而不是整段历史回放
- 当前任务或下一执行单元的 `steps[]`
- 预期验证命令与验证输出摘要成本
- 若下一步是 `quality_review`，则包含审查成本预留
- 若下一步是 `parallel-boundaries`，则包含主会话回收摘要成本，而不是把所有子 agent 上下文算进主会话

### 动态任务上限计算

```typescript
type TaskComplexity = 'simple' | 'medium' | 'complex';

type PhaseComplexity = 'light' | 'medium' | 'heavy';

function calculateDynamicMaxTasks(
  complexity: TaskComplexity | PhaseComplexity,
  usagePercent: number
): number {
  const baseLimit = {
    simple: 8,
    light: 8,
    medium: 5,
    complex: 3,
    heavy: 3
  }[complexity] || 5;

  if (usagePercent >= 80) return 1;
  if (usagePercent >= 70) return Math.max(2, baseLimit - 3);
  if (usagePercent >= 50) return Math.max(3, baseLimit - 1);
  return baseLimit;
}
```

> `maxConsecutiveTasks` 仍保留，但它只作为节奏控制信号，不再单独承担 continuation 主决策职责。

### 复杂度检测

```typescript
function detectTaskComplexity(task: {
  actions?: string[];
  files?: { create?: string[]; modify?: string[]; test?: string[] };
  quality_gate?: boolean;
  spec_ref?: string;
  plan_ref?: string;
  steps?: Array<unknown>;
}): TaskComplexity {
  const actions = task.actions?.length || 0;
  const files = [
    ...(task.files?.create || []),
    ...(task.files?.modify || []),
    ...(task.files?.test || [])
  ];

  if (task.quality_gate || task.spec_ref || files.length > 1 || (task.steps?.length || 0) > 1) {
    return 'complex';
  }
  if (actions > 2) return 'medium';
  return 'simple';
}

function detectPhaseComplexity(phase: string): PhaseComplexity {
  const heavyPhases = ['implement', 'integration', 'verify'];
  const lightPhases = ['design', 'review', 'deliver'];

  if (heavyPhases.some(p => phase.includes(p))) return 'heavy';
  if (lightPhases.some(p => phase.includes(p))) return 'light';
  return 'medium';
}
```

### 进度条与警告

```typescript
function generateContextBar(
  usagePercent: number,
  warningThreshold: number = 60,
  dangerThreshold: number = 80
): string {
  const filled = Math.round(usagePercent / 5);
  const warningStart = Math.round(warningThreshold / 5);
  const dangerStart = Math.round(dangerThreshold / 5);

  let bar = '';
  for (let i = 0; i < 20; i++) {
    if (i < filled) {
      if (i >= dangerStart) bar += '🟥';
      else if (i >= warningStart) bar += '🟨';
      else bar += '🟩';
    } else {
      bar += '░';
    }
  }
  return `[${bar}] ${usagePercent}%`;
}

function generateContextWarning(metrics: ContextMetrics): string | null {
  if (metrics.projectedUsagePercent >= metrics.hardHandoffThreshold) {
    return `
🚨 **上下文预计到达 ${metrics.projectedUsagePercent}% - 需要交接**

${generateContextBar(metrics.projectedUsagePercent, metrics.warningThreshold, metrics.dangerThreshold)}

**要求**：生成 continuation artifact 并新开会话继续
`;
  }

  if (metrics.projectedUsagePercent >= metrics.dangerThreshold) {
    return `
🚨 **上下文预计到达 ${metrics.projectedUsagePercent}% - 危险**

${generateContextBar(metrics.projectedUsagePercent, metrics.warningThreshold, metrics.dangerThreshold)}

**建议**：暂停当前治理边界；优先考虑 parallel-boundaries 或新开会话
`;
  }

  if (metrics.projectedUsagePercent >= metrics.warningThreshold) {
    return `
⚠️ **上下文预计到达 ${metrics.projectedUsagePercent}%**

${generateContextBar(metrics.projectedUsagePercent, metrics.warningThreshold, metrics.dangerThreshold)}

**建议**：优先评估 parallel-boundaries，避免主会话顺序吞下多个独立任务
`;
  }

  return null;
}
```

## 状态管理

### 初始化

```typescript
function initContextMetrics(maxContextTokens: number): ContextMetrics {
  return {
    maxContextTokens,
    estimatedTokens: 0,
    projectedNextTurnTokens: 0,
    reservedExecutionTokens: 0,
    reservedVerificationTokens: 0,
    reservedReviewTokens: 0,
    reservedSafetyBufferTokens: 0,
    usagePercent: 0,
    projectedUsagePercent: 0,
    maxConsecutiveTasks: 5,
    history: [],
    warningThreshold: 60,
    dangerThreshold: 80,
    hardHandoffThreshold: 90
  };
}
```

### 更新

```typescript
function updateContextMetrics(
  state: { contextMetrics?: ContextMetrics },
  params: {
    currentTokens: number;
    projectedNextTurnTokens: number;
    reservedExecutionTokens: number;
    reservedVerificationTokens: number;
    reservedReviewTokens: number;
    reservedSafetyBufferTokens: number;
    taskId: string;
    phase: string;
    executionPath: 'direct' | 'single-subagent' | 'parallel-boundaries';
    triggeredVerification: boolean;
    triggeredReview: boolean;
    maxContextTokens: number;
  }
): ContextMetrics {
  const metrics = state.contextMetrics || initContextMetrics(params.maxContextTokens);
  const previousTokens = metrics.estimatedTokens;

  metrics.maxContextTokens = params.maxContextTokens;
  metrics.estimatedTokens = params.currentTokens;
  metrics.projectedNextTurnTokens = params.projectedNextTurnTokens;
  metrics.reservedExecutionTokens = params.reservedExecutionTokens;
  metrics.reservedVerificationTokens = params.reservedVerificationTokens;
  metrics.reservedReviewTokens = params.reservedReviewTokens;
  metrics.reservedSafetyBufferTokens = params.reservedSafetyBufferTokens;
  metrics.usagePercent = Math.round(params.currentTokens / metrics.maxContextTokens * 100);
  metrics.projectedUsagePercent = Math.round(params.projectedNextTurnTokens / metrics.maxContextTokens * 100);

  metrics.history.push({
    taskId: params.taskId,
    phase: params.phase,
    preTaskTokens: previousTokens,
    postTaskTokens: params.currentTokens,
    tokenDelta: params.currentTokens - previousTokens,
    executionPath: params.executionPath,
    triggeredVerification: params.triggeredVerification,
    triggeredReview: params.triggeredReview,
    timestamp: new Date().toISOString()
  });

  if (metrics.history.length > 20) {
    metrics.history = metrics.history.slice(-20);
  }

  const complexity = detectPhaseComplexity(params.phase);
  metrics.maxConsecutiveTasks = calculateDynamicMaxTasks(complexity, metrics.projectedUsagePercent);

  return metrics;
}
```

## 决策函数

### Continuation Governance

```typescript
interface BoundaryCandidateGroup {
  id: string;
  taskIds: string[];
  independent: boolean;
  samePhase: boolean;
  continuationSafe: boolean;
}

function evaluateContinuationDecision(params: {
  metrics: ContextMetrics;
  executionMode: 'step' | 'phase' | 'quality_gate';
  consecutiveCount: number;
  nextTaskIds: string[];
  nextTaskIsQualityGate: boolean;
  nextTaskIsCommit: boolean;
  nextTaskStartsNewGovernancePhase: boolean;
  parallelCandidates: BoundaryCandidateGroup[];
}): ContinuationDecision {
  const {
    metrics,
    executionMode,
    consecutiveCount,
    nextTaskIds,
    nextTaskIsQualityGate,
    nextTaskIsCommit,
    nextTaskStartsNewGovernancePhase,
    parallelCandidates
  } = params;

  if (metrics.projectedUsagePercent >= metrics.hardHandoffThreshold) {
    return {
      action: 'handoff-required',
      reason: 'hard-handoff-threshold',
      severity: 'danger',
      nextTaskIds,
      suggestedExecutionPath: 'direct'
    };
  }

  if (metrics.projectedUsagePercent >= metrics.dangerThreshold) {
    return {
      action: 'pause-budget',
      reason: 'context-danger',
      severity: 'danger',
      nextTaskIds,
      suggestedExecutionPath: 'direct'
    };
  }

  const preferredParallelGroup = parallelCandidates.find(group =>
    group.independent && group.samePhase && group.continuationSafe
  );

  if (
    preferredParallelGroup &&
    metrics.projectedUsagePercent >= metrics.warningThreshold
  ) {
    return {
      action: 'continue-parallel-boundaries',
      reason: 'parallel-boundaries-preferred',
      severity: 'warning',
      nextTaskIds: preferredParallelGroup.taskIds,
      boundaryGroupId: preferredParallelGroup.id,
      suggestedExecutionPath: 'parallel-boundaries'
    };
  }

  if (consecutiveCount >= metrics.maxConsecutiveTasks) {
    return {
      action: 'pause-budget',
      reason: 'context-warning',
      severity: 'warning',
      nextTaskIds,
      suggestedExecutionPath: 'direct'
    };
  }

  if (nextTaskIsQualityGate) {
    return {
      action: 'pause-quality-gate',
      reason: 'quality-gate',
      severity: 'info',
      nextTaskIds,
      suggestedExecutionPath: 'direct'
    };
  }

  if (nextTaskIsCommit) {
    return {
      action: 'pause-before-commit',
      reason: 'commit-gate',
      severity: 'info',
      nextTaskIds,
      suggestedExecutionPath: 'direct'
    };
  }

  if (executionMode === 'step') {
    return {
      action: 'pause-governance',
      reason: 'mode-step',
      severity: 'info',
      nextTaskIds,
      suggestedExecutionPath: 'direct'
    };
  }

  if (executionMode === 'phase' && nextTaskStartsNewGovernancePhase) {
    return {
      action: 'pause-governance',
      reason: 'mode-phase-boundary',
      severity: 'info',
      nextTaskIds,
      suggestedExecutionPath: 'direct'
    };
  }

  return {
    action: 'continue-direct',
    reason: 'mode-phase-boundary',
    severity: 'info',
    nextTaskIds,
    suggestedExecutionPath: 'direct'
  };
}
```

## 集成示例

### workflow execute 集成

```typescript
const tasksContent = readFile(tasksPath);
const nextTask = extractCurrentTaskV2(tasksContent, findNextTask(tasksContent, state.progress));
const parallelCandidates = findBoundaryParallelCandidates(tasksContent, state.progress);

const currentTokens = estimateContextTokens([
  currentTaskSummary,
  nextTaskSummary,
  relevantSpecSlice,
  relevantBriefSlice,
  relevantTechDesignSlice,
  recentDiffSummary
]);

const projectedNextTurnTokens = estimateContextTokens([
  currentTaskSummary,
  nextTaskSummary,
  relevantSpecSlice,
  relevantBriefSlice,
  relevantTechDesignSlice,
  recentDiffSummary,
  projectedVerificationPayload,
  projectedReviewPayload,
  safetyBufferSummary
]);

state.contextMetrics = updateContextMetrics(state, {
  currentTokens,
  projectedNextTurnTokens,
  reservedExecutionTokens: estimateContextTokens([nextTaskSummary]),
  reservedVerificationTokens: estimateContextTokens([projectedVerificationPayload]),
  reservedReviewTokens: estimateContextTokens([projectedReviewPayload]),
  reservedSafetyBufferTokens: estimateContextTokens([safetyBufferSummary]),
  taskId: currentTask.id,
  phase: currentTask.phase,
  executionPath: 'direct',
  triggeredVerification: true,
  triggeredReview: !!nextTask?.quality_gate,
  maxContextTokens: runtimeMaxContextTokens
});

const decision = evaluateContinuationDecision({
  metrics: state.contextMetrics,
  executionMode,
  consecutiveCount: state.consecutive_count || 0,
  nextTaskIds: nextTask ? [nextTask.id] : [],
  nextTaskIsQualityGate: !!nextTask?.quality_gate,
  nextTaskIsCommit: normalizeTaskActions(nextTask || { actions: [] }).includes('git_commit'),
  nextTaskStartsNewGovernancePhase: nextTask?.phase !== currentTask.phase,
  parallelCandidates
});

switch (decision.action) {
  case 'continue-parallel-boundaries':
    dispatchParallelBoundaries(decision.boundaryGroupId);
    break;
  case 'pause-budget':
  case 'pause-governance':
  case 'pause-quality-gate':
  case 'pause-before-commit':
  case 'handoff-required':
    pauseWorkflow(decision);
    break;
  default:
    continueSequentialExecution();
}
```

## 最佳实践

1. **先看 projected，再看 current**：真正要拦的是“下一执行单元是否安全”，不是“当前看起来还能凑合”
2. **把 mode 当成软规则**：任何 `step / phase / quality_gate` 都不得绕过硬预算判断
3. **优先边界并行而非主会话顺序吞任务**：当工件稳定、边界独立、上下文已告警时，优先 `parallel-boundaries`
4. **同边界默认串行**：并行只发生在不同上下文边界之间
5. **高水位必须 handoff**：超过硬阈值时，不再只提示“继续执行”，而应生成 continuation artifact 并建议新会话恢复
