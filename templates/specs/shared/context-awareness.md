# Context Awareness 模块

上下文感知系统，用于监控和管理 Claude 会话的 token 使用量，避免上下文溢出。

## 数据结构

```typescript
const MAX_CONTEXT_TOKENS = 200000;  // Claude 最大上下文

interface ContextMetrics {
  estimatedTokens: number;          // 估算的 token 数
  warningThreshold: number;         // 警告阈值 (默认 60%)
  dangerThreshold: number;          // 危险阈值 (默认 80%)
  maxConsecutiveTasks: number;      // 动态计算的最大连续任务数
  usagePercent: number;             // 当前使用率
  history: ContextHistoryEntry[];   // 历史记录
}

interface ContextHistoryEntry {
  taskId: string;
  phase: string;
  tokens: number;
  timestamp: string;
}
```

## 核心函数

### Token 估算

```typescript
/**
 * 估算内容的 token 数
 * 使用字符数 / 4 的近似算法（对中英文混合内容较准确）
 *
 * @param contents 要估算的内容数组
 * @returns 估算的 token 数
 */
function estimateContextTokens(contents: (string | null)[]): number {
  let totalChars = 0;
  for (const content of contents) {
    if (content) {
      totalChars += content.length;
    }
  }
  return Math.round(totalChars / 4);
}

// 使用示例
const tokens = estimateContextTokens([
  tasksContent,
  techDesignContent,
  recentDiff?.substring(0, 50000)  // 限制 diff 大小
]);
```

### 动态任务上限计算

```typescript
type TaskComplexity = 'simple' | 'medium' | 'complex';
type PhaseComplexity = 'light' | 'medium' | 'heavy';

/**
 * 根据任务复杂度和上下文使用率计算最大连续任务数
 *
 * 基础限制：
 * - simple: 8 个任务
 * - medium: 5 个任务
 * - complex: 3 个任务
 *
 * 动态调整：
 * - 使用率 > 70%: 减少 3 个
 * - 使用率 > 50%: 减少 1 个
 */
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

  if (usagePercent > 70) return Math.max(2, baseLimit - 3);
  if (usagePercent > 50) return Math.max(3, baseLimit - 1);
  return baseLimit;
}
```

### 任务复杂度检测

```typescript
/**
 * 检测任务复杂度
 *
 * 判断依据：
 * - complex: 质量关卡、有设计引用、多文件
 * - medium: 多个 actions
 * - simple: 其他
 */
function detectTaskComplexity(task: {
  actions?: string;
  file?: string;
  quality_gate?: boolean;
  design_ref?: string;
}): TaskComplexity {
  const actions = (task.actions || '').split(',').length;
  const hasMultipleFiles = (task.file || '').includes(',');
  const isQualityGate = task.quality_gate;
  const hasDesignRef = !!task.design_ref;

  if (isQualityGate || hasDesignRef || hasMultipleFiles) return 'complex';
  if (actions > 2) return 'medium';
  return 'simple';
}

/**
 * 检测阶段复杂度（用于 OpenSpec 集成）
 */
function detectPhaseComplexity(phase: string): PhaseComplexity {
  const heavyPhases = ['spec-plan', 'spec-impl', 'implement', 'verify'];
  const lightPhases = ['spec-init', 'spec-review', 'design', 'deliver'];

  if (heavyPhases.some(p => phase.includes(p))) return 'heavy';
  if (lightPhases.some(p => phase.includes(p))) return 'light';
  return 'medium';
}
```

### 进度条生成

```typescript
/**
 * 生成上下文使用率进度条
 *
 * 颜色编码：
 * - 🟩 绿色: 0% - warningThreshold
 * - 🟨 黄色: warningThreshold - dangerThreshold
 * - 🟥 红色: dangerThreshold - 100%
 * - ░ 灰色: 未使用
 */
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
```

### 警告生成

```typescript
/**
 * 根据上下文状态生成警告信息
 *
 * @returns 警告信息，无警告时返回 null
 */
function generateContextWarning(metrics: ContextMetrics): string | null {
  if (metrics.usagePercent > metrics.dangerThreshold) {
    return `
🚨 **上下文使用率 ${metrics.usagePercent}% - 危险**

${generateContextBar(metrics.usagePercent, metrics.warningThreshold, metrics.dangerThreshold)}

**强烈建议**：执行 \`/clear\` 或 **新开会话** 继续执行
当前已连续执行 ${metrics.history.length} 个任务
`;
  }

  if (metrics.usagePercent > metrics.warningThreshold) {
    return `
⚠️ **上下文使用率 ${metrics.usagePercent}%**

${generateContextBar(metrics.usagePercent, metrics.warningThreshold, metrics.dangerThreshold)}

**建议**：完成当前阶段后新开会话
动态任务上限：${metrics.maxConsecutiveTasks}
`;
  }

  return null;
}
```

## 状态管理

### 初始化

```typescript
function initContextMetrics(): ContextMetrics {
  return {
    estimatedTokens: 0,
    warningThreshold: 60,
    dangerThreshold: 80,
    maxConsecutiveTasks: 5,
    usagePercent: 0,
    history: []
  };
}
```

### 更新

```typescript
function updateContextMetrics(
  state: { contextMetrics?: ContextMetrics },
  newTokens: number,
  taskId: string,
  phase: string
): ContextMetrics {
  const metrics = state.contextMetrics || initContextMetrics();

  // 更新 token 估算
  metrics.estimatedTokens = newTokens;
  metrics.usagePercent = Math.round(newTokens / MAX_CONTEXT_TOKENS * 100);

  // 记录历史（最多保留 10 条）
  metrics.history.push({
    taskId,
    phase,
    tokens: newTokens,
    timestamp: new Date().toISOString()
  });
  if (metrics.history.length > 10) {
    metrics.history = metrics.history.slice(-10);
  }

  // 动态计算任务上限
  const complexity = detectPhaseComplexity(phase);
  metrics.maxConsecutiveTasks = calculateDynamicMaxTasks(complexity, metrics.usagePercent);

  return metrics;
}
```

## 决策函数

### 是否应该暂停

```typescript
interface PauseDecision {
  shouldPause: boolean;
  reason: string;
  severity: 'info' | 'warning' | 'danger';
}

/**
 * 判断是否应该暂停执行
 */
function shouldPauseExecution(
  metrics: ContextMetrics,
  consecutiveCount: number,
  nextTaskIsQualityGate: boolean,
  nextTaskIsCommit: boolean
): PauseDecision {
  // 危险阈值：强制暂停
  if (metrics.usagePercent > metrics.dangerThreshold) {
    return {
      shouldPause: true,
      reason: `上下文使用率 ${metrics.usagePercent}% 超过危险阈值`,
      severity: 'danger'
    };
  }

  // 达到动态任务上限
  if (consecutiveCount >= metrics.maxConsecutiveTasks) {
    const reason = metrics.usagePercent > metrics.warningThreshold
      ? `上下文使用率 ${metrics.usagePercent}%（连续 ${consecutiveCount} 任务）`
      : `连续任务数达到动态上限 (${metrics.maxConsecutiveTasks})`;
    return {
      shouldPause: true,
      reason,
      severity: 'warning'
    };
  }

  // 质量关卡前暂停
  if (nextTaskIsQualityGate) {
    return {
      shouldPause: true,
      reason: '质量关卡',
      severity: 'info'
    };
  }

  // git_commit 前暂停
  if (nextTaskIsCommit) {
    return {
      shouldPause: true,
      reason: '提交前确认',
      severity: 'info'
    };
  }

  return {
    shouldPause: false,
    reason: '',
    severity: 'info'
  };
}
```

## 集成示例

### workflow-execute.md 集成

```typescript
// Step 2: 读取状态后
const tasksContent = readFile(tasksPath);
const techDesignContent = techDesignPath ? readFile(techDesignPath) : null;
const recentDiff = await Bash({ command: 'git diff HEAD --stat 2>/dev/null || echo ""' });

// 估算 token
const estimatedTokens = estimateContextTokens([
  tasksContent,
  techDesignContent,
  recentDiff.stdout?.substring(0, 50000)
]);

// 更新上下文指标
state.contextMetrics = updateContextMetrics(
  state,
  estimatedTokens,
  state.current_tasks?.[0] || currentTask.id,
  currentTask.phase
);

// 显示状态
console.log(`📊 上下文使用率：${generateContextBar(
  state.contextMetrics.usagePercent,
  state.contextMetrics.warningThreshold,
  state.contextMetrics.dangerThreshold
)}`);

const warning = generateContextWarning(state.contextMetrics);
if (warning) console.log(warning);

// Step 7: 判断是否继续
const pauseDecision = shouldPauseExecution(
  state.contextMetrics,
  state.consecutive_count || 0,
  nextTask.quality_gate,
  nextTask.actions?.includes('git_commit')
);

if (pauseDecision.shouldPause) {
  state.consecutive_count = 0;  // 重置计数
  writeFile(statePath, JSON.stringify(state, null, 2));
  console.log(`⏸️ **已暂停**（${pauseDecision.reason}）`);
} else {
  state.consecutive_count = (state.consecutive_count || 0) + 1;
  // 继续执行...
}
```

### OpenSpec 命令集成

```typescript
// spec-impl.md Step 9: Context Checkpoint

const contextContents = [
  tasksContent,
  specContent,
  await readFile(`openspec/changes/${proposalId}/specs/*.md`)
];

const estimatedTokens = estimateContextTokens(contextContents);
const usagePercent = Math.round(estimatedTokens / MAX_CONTEXT_TOKENS * 100);

const metrics: ContextMetrics = {
  estimatedTokens,
  usagePercent,
  warningThreshold: 60,
  dangerThreshold: 80,
  maxConsecutiveTasks: calculateDynamicMaxTasks(
    detectPhaseComplexity('spec-impl'),
    usagePercent
  ),
  history: state.context_history || []
};

const warning = generateContextWarning(metrics);
if (warning) {
  console.log(warning);
  console.log(`\n继续下一阶段：\`/ccg:spec-impl\`（建议新开会话）`);
}
```

## 最佳实践

1. **阶段切换时检查**：每个阶段完成时评估上下文使用率
2. **质量关卡前检查**：执行重要操作前确保有足够上下文空间
3. **渐进披露**：简洁模式只显示进度条，`--detail` 显示完整历史
4. **历史追踪**：保留最近 10 条记录用于趋势分析
5. **动态调整**：根据实时使用率调整连续任务上限
