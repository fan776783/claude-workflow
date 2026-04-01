# quality_review Action：两阶段代码审查 (v3.5.0)

> 借鉴 Superpowers subagent-driven-development 的两阶段审查机制，升级质量关卡审查。
>
> 本文档同时把 `quality_review` 明确定位为 **shared review loop contract 的 execution adapter**：planning side 使用 `review_status.*`，execution side 使用 `quality_gates.*`，两者共享 review subject / budget / artifact / sink 语义，但不强制同构。

## 快速导航

- 想看 quality_review 在执行阶段的定位：看“概述”
- 想看 shared review loop contract 对齐点：看“与 shared review loop contract 的对齐”
- 想看两阶段审查流程：看“执行流程”
- 想看 Stage 1 / Stage 2 的输入输出：看各阶段章节

## 何时读取

- 当前 task 的 `actions` 包含 `quality_review`
- 需要确认质量关卡如何写入 `quality_gates.*` 并驱动审查循环时

## 概述

`quality_review` action 在质量关卡（`quality_gate = true`）任务中执行，替代原有的“单次代码审查 + 评分阈值”逻辑。审查对象是**聚合 diff 窗口**——上次通过的质量关卡到当前关卡之间的所有代码变更。

## 与 shared review loop contract 的对齐

### Review Subject

```typescript
const reviewSubject: ReviewSubject = {
  kind: 'diff_window',
  ref: `${diffWindow.base_commit}..HEAD`,
  requirement_ids: task.requirement_ids,
  critical_constraints: task.critical_constraints
};
```

### Review Policy

```typescript
const QUALITY_REVIEW_POLICY: ReviewLoopPolicy = {
  max_attempts: 4,
  allowed_revision_scope: [
    'current diff window',
    'task-required files',
    'tests and verification artifacts'
  ],
  escalate_on: ['budget_exhausted']
};
```

### Artifact Sink

- planning side：`state.review_status.*`
- execution side：`state.quality_gates[task.id]`
- 本 action 继续写入 `quality_gates`，但输出语义与 shared contract 对齐：`subject / attempt / decision / overall_passed / next_action`

## 执行流程

```
quality_review action
  ├─ 计算聚合 diff 窗口
  ├─ 归一化为 ReviewSubject(diff_window)
  ├─ Stage 1：规格合规审查（当前模型，确定性）
  │   └─ 未通过 → 修复 → 重审（共享总预算）
  ├─ Stage 2：代码质量审查（平台感知 reviewer 子 agent）
  │   └─ 未通过 → 修复 → 重审（共享总预算）
  ├─ Stage 2 若产生修复 → 触发轻量 Stage 1 recheck
  └─ 记录 QualityGateResult → state.quality_gates
```

## Diff 窗口计算

```typescript
function computeDiffWindow(state: WorkflowState): DiffWindow {
  const lastApprovedGate = findLastApprovedGate(state.quality_gates);
  const baseCommit = lastApprovedGate?.commit_hash ?? state.initial_head_commit;

  // 基线：上次通过的关卡记录的 commit hash，或工作流启动时的 HEAD
  // 范围：基线到当前 HEAD 的所有变更
  return {
    from_task: lastApprovedGate?.gate_task_id ?? null,
    to_task: state.current_tasks?.[0] ?? null,
    base_commit: baseCommit,
    diff: getGitDiff(baseCommit),           // git diff <commit>..HEAD
    files_changed: countChangedFiles(baseCommit),
  };
}
```

**基线规则**：
- 首个质量关卡：diff 窗口从 `state.initial_head_commit`（工作流启动时记录的 HEAD commit）开始
- 后续质量关卡：从上次 `overall_passed = true` 的关卡的 `commit_hash` 开始
- 并行任务批次：合并所有并行任务的变更
- 手动编辑：包含在 git diff 中，自动覆盖
- `initial_head_commit` 在 `/workflow execute` 首次执行时写入 state（`git rev-parse HEAD`）

## Stage 1：规格合规审查

**执行者**：当前模型（确定性检查，无外部调用）

**审查内容**：

| 检查维度 | 说明 |
|----------|------|
| **需求缺失** | diff 窗口内的任务需求是否都有对应实现？ |
| **需求多余** | 是否有未被要求的功能？过度工程化？ |
| **需求误解** | 对需求的理解是否有偏差？ |
| **验收项覆盖** | 任务关联的验收项是否被实现覆盖？ |
| **设计/计划一致** | 实现是否与 `spec_ref` / `plan_ref` 指向内容一致？ |

**注意**：Stage 1 整合了 Step 6.7（规格合规检查）的全部逻辑。quality_gate 任务的 Step 6.7 由 Stage 1 接管，不再独立执行。

**关键规则**：
- 独立读取代码验证，不信任实现者自述
- 逐条对照 diff 窗口内所有任务的 `steps[]` 与 `acceptance_criteria`
- 发现偏差必须列出具体文件和行号

**输出格式**：

```typescript
interface SpecComplianceResult {
  passed: boolean;
  missing: SpecIssue[];           // 缺失的需求
  extra: SpecIssue[];             // 多余的实现
  misunderstandings: SpecIssue[]; // 误解的需求
  coverage_gaps: SpecIssue[];     // 验收项未覆盖
  decision: 'pass' | 'revise' | 'rejected';
  next_action?: string;
}

interface SpecIssue {
  description: string;            // 问题描述
  requirement_ref: string;        // 对应的需求条目或验收项 ID
  file_line?: string;             // 文件:行号
}
```

## Stage 2：代码质量审查

**前置条件**：Stage 1 必须通过。禁止在 Stage 1 未通过时启动 Stage 2。

**执行者**：平台感知的代码质量审查子 agent。

在启动 reviewer 子 agent 前，不需要调用 `../../../../dispatching-parallel-agents/SKILL.md`；Stage 2 走的是**单 reviewer 子 agent**路径，而不是多问题域并行分派。这里只直接复用平台路由与最小上下文封装原则即可。
- Claude Code / Cursor：使用 `Task` 以 reviewer 角色审查 diff 窗口
- Codex：使用 `spawn_agent` / `wait` / `close_agent` 运行 reviewer 子 agent
- 无子 agent 平台：退化为当前会话只读审查，但仍遵守同样的输出结构

**审查内容**：

| 检查维度 | 说明 |
|----------|------|
| **架构设计** | 关注点分离、可扩展性、性能 |
| **代码质量** | DRY 原则、错误处理、类型安全 |
| **测试质量** | 测试逻辑而非 mock、边界覆盖 |
| **安全性** | 输入验证、权限检查、数据泄露 |
| **代码复用** | 参考 `specs/guides/code-reuse-checklist.md` |
| **跨层完整性** | 参考 `specs/guides/cross-layer-checklist.md`（跨 3+ 层时） |

> **Thinking Guides 集成**：Stage 2 审查必须参考 `.claude/specs/guides/` 中的思维指南。
> 特别地，对所有 CRITICAL / WARNING 级发现，必须执行 `ai-review-false-positive-guide.md` 中的
> 验证流程（LOCATE → TRACE → CONTEXT → VERIFY → DECIDE），过滤误报后才计入最终结果。
> 预算：约 35% 的 AI 审查发现为误报。

**问题严重级别**：

```typescript
interface CodeQualityResult {
  strengths: string[];
  issues: {
    critical: ReviewIssue[];      // 必须修复：bug、安全漏洞、数据丢失风险
    important: ReviewIssue[];     // 应当修复：架构问题、缺失功能、错误处理不足
    minor: ReviewIssue[];         // 建议修复：代码风格、优化机会
  };
  assessment: 'approved' | 'needs_fixes' | 'rejected';
  decision: 'pass' | 'revise' | 'rejected';
  next_action?: string;
  reasoning: string;
}

interface ReviewIssue {
  file_line: string;              // 文件:行号
  description: string;            // 问题描述
  why_it_matters: string;         // 为什么重要
  fix_suggestion?: string;        // 修复建议
}
```

**判定**：

| assessment | contract decision | 处理 |
|-----------|-------------------|------|
| `approved` | `pass` | 关卡通过，记录结果 |
| `needs_fixes` | `revise` | 修复 critical + important 后重审（消耗预算） |
| `rejected` | `rejected` | 关卡失败，标记任务 `failed` |

## 预算控制

```typescript
const GATE_BUDGET = {
  maxTotalLoops: 4,              // 两阶段合计最大尝试次数
  maxDiffContextChars: 50000,    // 发送给审查者的 diff 上下文上限
  cacheStage1: true,             // 代码未变时缓存 Stage 1 结果
};
```

**预算分配规则**：
- 两阶段共享 4 次总预算（不是每阶段独立 3 次）
- Stage 1 通过耗 1 次；Stage 2 每次尝试耗 1 次
- 示例：Stage 1 通过 (1) + Stage 2 尝试 3 次 (3) = 总计 4 次
- 示例：Stage 1 尝试 2 次 (2) + Stage 2 尝试 2 次 (2) = 总计 4 次
- 预算耗尽：标记任务 `failed`，向用户报告剩余问题

**性能优化**：
- Stage 1 由当前模型执行（无外部调用，低成本）
- Stage 2 对 Claude Code / Cursor 使用单次 `Task` reviewer，对 Codex 使用单次 `spawn_agent` reviewer，并限制 diff 上下文（≤50000 字符）
- Stage 2 属于单 reviewer 子 agent 路径，不使用 `../../../../dispatching-parallel-agents/SKILL.md`
- 代码未变时（修复未产生新 diff），Stage 1 结果可缓存复用

## 实现

```typescript
async function executeQualityReview(
  task: WorkflowTaskV2,
  state: WorkflowState
): Promise<VerificationEvidence> {
  let diffWindow = computeDiffWindow(state);
  let totalAttempts = 0;
  let stage1Attempts = 0;
  const budget = GATE_BUDGET.maxTotalLoops;

  const reviewSubject: ReviewSubject = {
    kind: 'diff_window',
    ref: `${diffWindow.base_commit}..HEAD`,
    requirement_ids: task.requirement_ids,
    critical_constraints: task.critical_constraints
  };

  // ── Stage 1：规格合规审查 ──
  let specResult: SpecComplianceResult;
  let cachedSpecResult: SpecComplianceResult | null = null;

  do {
    totalAttempts++;
    stage1Attempts++;

    // 预算守卫：在审查前检查，防止溢出
    if (totalAttempts > budget) {
      return markGateFailed(task, state, reviewSubject, diffWindow, 'stage1', specResult, stage1Attempts, totalAttempts);
    }

    if (cachedSpecResult && !hasNewDiff()) {
      specResult = cachedSpecResult;
    } else {
      specResult = await runSpecComplianceReview(task, diffWindow, state);
      cachedSpecResult = specResult;
    }

    if (!specResult.passed) {
      await fixSpecIssues(specResult);
      diffWindow = computeDiffWindow(state); // 修复后重算 diff 窗口
    }
  } while (!specResult.passed);

  // ── Stage 2：代码质量审查（仅在 Stage 1 通过后）──
  let qualityResult: CodeQualityResult;
  let stage2HadFixes = false;

  do {
    totalAttempts++;

    // 预算守卫
    if (totalAttempts > budget) {
      return markGateFailed(task, state, reviewSubject, diffWindow, 'stage2', qualityResult, stage1Attempts, totalAttempts);
    }

    // 平台感知的 reviewer 审查
    qualityResult = await runCodeQualityReview(task, diffWindow, state);

    if (qualityResult.assessment === 'rejected') {
      return markGateFailed(task, state, reviewSubject, diffWindow, 'stage2', qualityResult, stage1Attempts, totalAttempts);
    }

    if (qualityResult.assessment === 'needs_fixes') {
      await fixQualityIssues(qualityResult);
      diffWindow = computeDiffWindow(state); // 修复后重算 diff 窗口
      stage2HadFixes = true;
    }
  } while (qualityResult.assessment === 'needs_fixes');

  // ── Stage 2 修复后：轻量 Stage 1 复核 ──
  // 仅在 Stage 2 产生了代码修复时触发（不消耗 totalAttempts 预算）
  if (stage2HadFixes) {
    const recheckResult = await runSpecComplianceReview(task, diffWindow, state);
    if (!recheckResult.passed) {
      return markGateFailed(task, state, reviewSubject, diffWindow, 'stage1_recheck', recheckResult, stage1Attempts, totalAttempts);
    }
  }

  // ── 记录结果 ──
  const currentCommit = getCurrentHeadCommit(); // git rev-parse HEAD
  const stage2Attempts = totalAttempts - stage1Attempts;

  const gateResult: QualityGateResult = {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: task.id,
    subject: reviewSubject,
    max_attempts: budget,
    attempt: totalAttempts,
    last_decision: 'pass',
    next_action: 'continue_execution',
    commit_hash: currentCommit,
    diff_window: {
      from_task: diffWindow.from_task,
      to_task: diffWindow.to_task,
      files_changed: diffWindow.files_changed,
    },
    stage1: {
      passed: true,
      attempts: stage1Attempts,
      issues_found: specResult.missing.length + specResult.extra.length + specResult.misunderstandings.length,
      completed_at: new Date().toISOString(),
    },
    stage2: {
      passed: true,
      attempts: stage2Attempts,
      assessment: 'approved',
      critical_count: qualityResult.issues.critical.length,
      important_count: qualityResult.issues.important.length,
      minor_count: qualityResult.issues.minor.length,
      completed_at: new Date().toISOString(),
    },
    overall_passed: true,
    reviewed_at: new Date().toISOString(),
    reviewer: 'subagent'
  };

  if (!state.quality_gates) state.quality_gates = {};
  state.quality_gates[task.id] = gateResult;

  return {
    command: 'two-stage code review',
    exit_code: 0,
    output_summary: `Stage 1 passed (${stage1Attempts} attempts), Stage 2: approved (${stage2Attempts} attempts, ${qualityResult.issues.minor.length} minor issues)`,
    timestamp: new Date().toISOString(),
    passed: true,
    artifact_ref: `quality_gates.${task.id}`,
  };
}

// ── 失败态记录 ──
function markGateFailed(
  task: WorkflowTaskV2,
  state: WorkflowState,
  subject: ReviewSubject,
  diffWindow: DiffWindow,
  failedStage: 'stage1' | 'stage2' | 'stage1_recheck',
  lastResult: SpecComplianceResult | CodeQualityResult,
  stage1Attempts: number,
  totalAttempts: number
): VerificationEvidence {
  const budgetExhausted = totalAttempts > GATE_BUDGET.maxTotalLoops;
  const terminalDecision = budgetExhausted || failedStage === 'stage2' ? 'rejected' : 'revise';
  const nextAction = terminalDecision === 'rejected'
    ? 'mark_task_failed_or_escalate'
    : 'fix_and_retry_or_escalate';

  const gateResult: QualityGateResult = {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: task.id,
    subject,
    max_attempts: GATE_BUDGET.maxTotalLoops,
    attempt: totalAttempts,
    last_decision: terminalDecision,
    next_action: nextAction,
    blocking_issues: collectBlockingIssues(lastResult),
    reviewed_at: new Date().toISOString(),
    reviewer: 'subagent',
    commit_hash: getCurrentHeadCommit(),
    diff_window: {
      from_task: diffWindow.from_task,
      to_task: diffWindow.to_task,
      files_changed: diffWindow.files_changed
    },
    stage1: {
      passed: failedStage !== 'stage1',
      attempts: stage1Attempts,
      issues_found: extractIssueCount(lastResult),
      completed_at: new Date().toISOString(),
    },
    ...(failedStage !== 'stage1' ? {
      stage2: {
        passed: false,
        attempts: totalAttempts - stage1Attempts,
        assessment: (lastResult as CodeQualityResult).assessment ?? 'rejected',
        critical_count: (lastResult as CodeQualityResult).issues?.critical?.length ?? 0,
        important_count: (lastResult as CodeQualityResult).issues?.important?.length ?? 0,
        minor_count: (lastResult as CodeQualityResult).issues?.minor?.length ?? 0,
        completed_at: new Date().toISOString(),
      }
    } : {}),
    overall_passed: false,
  };

  if (!state.quality_gates) state.quality_gates = {};
  state.quality_gates[task.id] = gateResult;

  return {
    command: 'two-stage code review',
    exit_code: 1,
    output_summary: `Failed at ${failedStage}`,
    timestamp: new Date().toISOString(),
    passed: false,
    artifact_ref: `quality_gates.${task.id}`,
  };
}
```

## 与 Step 6.5 的关系

`quality_review` action 完成后，Step 6.5 验证其结果：
- 验证命令：读取 `state.quality_gates[taskId]`
- 通过条件：`overall_passed === true`
- `artifact_ref` 字段指向具体关卡产物

## 审查反馈处理

收到 Stage 2 反馈后的处理流程，参见 [references/review-feedback-protocol.md](../../../references/review-feedback-protocol.md)。

## 红旗清单

- 在 Stage 1 未通过时跳到 Stage 2
- 信任实现者的自述而不独立验证代码
- 将 Critical 问题降级为 Minor
- 预算耗尽后继续尝试（应标记失败）
- 跳过审查因为“改动很简单”
- diff 窗口为空但仍标记通过（无变更不需要关卡）
