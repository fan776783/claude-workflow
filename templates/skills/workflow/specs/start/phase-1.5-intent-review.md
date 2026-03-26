# Phase 1.5: Intent Review 详情

## 目的

在生成 `plan.md` 与 `tasks.md` 前，基于稳定的 `spec.md` 生成 Intent 文档，并先做机器一致性检查，再决定是否需要用户进行方向治理确认。

> 本阶段属于 **ConditionalHumanGate**，显式依赖 `templates/specs/workflow/review-loop.md` 中定义的 shared review loop contract。
>
> 它被拆分为两个子步骤：
> - `IntentConsistencyCheck`：机器一致性检查
> - `ConditionalHumanIntentReview`：仅在命中条件时进入人工关口

## 执行时机

**强制执行**：Phase 1.4 User Spec Review 通过后，Phase 2 Plan Generation 开始前。

## Gate Policy

```typescript
const INTENT_GATE_POLICY = {
  review_mode: 'conditional_human_gate',
  attempt: 1,
  max_attempts: 1,
  triggerConditions: [
    'delta/change 场景',
    '高风险或高影响范围',
    '跨多个 domain / owner',
    '用户在 spec 审查阶段留下方向性备注'
  ]
};
```

## 输入

- `spec.md`
- `requirementContent`
- `analysisResult`
- `discussion-artifact.json`（如有）
- `state.review_status.user_spec_review`

## 实现细节

### Step 1: 创建 changes 目录结构

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Phase 1.5: Intent Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

ensureDir(workflowDir);

const changeId = nextChangeId(state);
const changesDir = path.join(workflowDir, 'changes', changeId);
ensureDir(changesDir);
```

### Step 2: 生成 Intent 文档

```typescript
const intentContent = generateIntentSummary({
  requirement: requirementContent,
  spec: readFile(specPath),
  specPath,
  analysisResult,
  taskName,
  changeId
});

const intentPath = path.join(changesDir, 'intent.md');
writeFile(intentPath, intentContent);

console.log(`
📄 Intent 文档已生成：${intentPath}

**变更概要**：
- 变更 ID: ${changeId}
- 触发类型: ${isDeltaWorkflow ? 'delta_change' : 'new_requirement'}
- Spec 引用: ${specPath}
- 影响范围: ${analysisResult.relatedFiles.length} 个文件
`);
```

### Step 3: 运行 IntentConsistencyCheck

```typescript
const intentSubject: ReviewSubject = {
  kind: 'change_set',
  ref: intentPath,
  requirement_ids: extractRequirementIdsFromSpec(readFile(specPath))
};

const intentCheck = runIntentConsistencyCheck({
  specContent: readFile(specPath),
  intentContent,
  analysisResult,
  userSpecReview: state.review_status.user_spec_review,
  isDeltaWorkflow,
  relatedFiles: analysisResult.relatedFiles || []
});

state.review_status.intent_review = {
  status: intentCheck.needsHumanGate ? 'pending' : 'passed',
  review_mode: 'conditional_human_gate',
  reviewed_at: new Date().toISOString(),
  reviewer: 'system',
  attempt: 1,
  max_attempts: 1,
  last_decision: intentCheck.needsHumanGate ? 'revise' : 'pass',
  next_action: intentCheck.needsHumanGate
    ? 'await_user_intent_confirmation'
    : 'continue_to_plan_generation',
  blocking_issues: intentCheck.reasons,
  notes: intentCheck.notes
};
```

### Step 4: auto-pass 分支（无需人工 gate）

```typescript
if (!intentCheck.needsHumanGate) {
  state.status = 'planned';

  writeFile(
    path.join(changesDir, 'review-status.json'),
    JSON.stringify({
      change_id: changeId,
      review_mode: 'conditional_human_gate',
      reviewed_at: new Date().toISOString(),
      status: 'auto_passed',
      reviewer: 'system',
      attempt: 1,
      max_attempts: 1,
      last_decision: 'pass',
      next_action: 'continue_to_plan_generation',
      spec_ref: specPath,
      reasons: intentCheck.reasons
    }, null, 2)
  );

  writeFile(statePath, JSON.stringify(state, null, 2));
  console.log('✅ IntentConsistencyCheck auto-pass，无需人工确认，继续生成计划');
  return;
}
```

### Step 5: 命中条件时进入 ConditionalHumanIntentReview

```typescript
state.status = 'intent_review';
state.delta_tracking = state.delta_tracking || {};
state.delta_tracking.current_change = changeId;

writeFile(
  path.join(changesDir, 'review-status.json'),
  JSON.stringify({
    change_id: changeId,
    review_mode: 'conditional_human_gate',
    reviewed_at: new Date().toISOString(),
    status: 'pending',
    reviewer: 'system',
    attempt: 1,
    max_attempts: 1,
    last_decision: 'revise',
    next_action: 'await_user_intent_confirmation',
    spec_ref: specPath,
    reasons: intentCheck.reasons,
    notes: intentCheck.notes
  }, null, 2)
);

writeFile(statePath, JSON.stringify(state, null, 2));
```

### Step 6: Hard Stop - 仅在需要时请求用户确认

```typescript
const intentChoice = await AskUserQuestion({
  questions: [{
    question: 'IntentConsistencyCheck 认为该变更需要人工方向确认，是否继续按当前 Intent 推进？',
    header: 'Intent Human Gate',
    multiSelect: false,
    options: [
      { label: '意图正确', description: '继续生成计划与任务清单' },
      { label: '需要调整', description: '暂停，手动编辑 intent.md 或 spec.md 后重新执行' },
      { label: '取消', description: '放弃本次变更' }
    ]
  }]
});
```

### Step 7: 处理人工 gate 结论

```typescript
if (intentChoice === '取消') {
  console.log(`
❌ 变更已取消

将删除本次 Intent Review 生成的临时工件：${changesDir}
已归档的历史变更不会受影响。
  `);
  await Bash({ command: `rm -rf "${changesDir}"` });
  state.status = 'idle';
  if (state.delta_tracking) {
    state.delta_tracking.current_change = null;
  }
  state.review_status.intent_review = {
    status: 'rejected',
    review_mode: 'conditional_human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    attempt: 1,
    max_attempts: 1,
    last_decision: 'rejected',
    next_action: 'abort_change',
    blocking_issues: intentCheck.reasons,
    notes: ['用户取消当前变更']
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}

if (intentChoice === '需要调整') {
  console.log(`
⏸️ 工作流已暂停

请编辑文档后重新执行：
  1. 规范文档：${specPath}
  2. 意图文档：${intentPath}
  3. 重新启动：/workflow start "${requirementContent}"
  `);
  state.status = 'paused';
  state.review_status.intent_review = {
    status: 'revise_required',
    review_mode: 'conditional_human_gate',
    reviewed_at: new Date().toISOString(),
    reviewer: 'user',
    attempt: 1,
    max_attempts: 1,
    last_decision: 'revise',
    next_action: 'revise_spec_or_intent_then_restart',
    blocking_issues: intentCheck.reasons,
    notes: ['用户要求调整 Intent 或 Spec']
  };
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}

state.status = 'planned';
state.review_status.intent_review = {
  status: 'approved',
  review_mode: 'conditional_human_gate',
  reviewed_at: new Date().toISOString(),
  reviewer: 'user',
  attempt: 1,
  max_attempts: 1,
  last_decision: 'pass',
  next_action: 'continue_to_plan_generation',
  blocking_issues: [],
  notes: intentCheck.notes
};

writeFile(
  path.join(changesDir, 'review-status.json'),
  JSON.stringify({
    change_id: changeId,
    review_mode: 'conditional_human_gate',
    reviewed_at: new Date().toISOString(),
    status: 'approved',
    reviewer: 'user',
    attempt: 1,
    max_attempts: 1,
    last_decision: 'pass',
    next_action: 'continue_to_plan_generation',
    spec_ref: specPath,
    reasons: intentCheck.reasons,
    notes: intentCheck.notes
  }, null, 2)
);

writeFile(statePath, JSON.stringify(state, null, 2));
console.log('✅ Intent Human Gate 已批准，继续生成计划');
```

## IntentConsistencyCheck 结果结构

```typescript
interface IntentConsistencyCheckResult {
  needsHumanGate: boolean;
  reasons: string[];
  notes: string[];
  riskSignals: Array<'delta_change' | 'high_impact' | 'cross_domain' | 'user_direction_note'>;
}
```

## 一致性检查函数

```typescript
function runIntentConsistencyCheck(params: {
  specContent: string;
  intentContent: string;
  analysisResult: any;
  userSpecReview?: ReviewCheckpointBase;
  isDeltaWorkflow?: boolean;
  relatedFiles?: Array<{ path: string; domain?: string }>;
}): IntentConsistencyCheckResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  const riskSignals: IntentConsistencyCheckResult['riskSignals'] = [];

  if (params.isDeltaWorkflow) {
    reasons.push('当前变更属于 delta/change 场景，需要人工确认方向是否与既有实现兼容');
    riskSignals.push('delta_change');
  }

  const impactedDomains = new Set(
    (params.relatedFiles || [])
      .map(file => file.domain)
      .filter(Boolean)
  );
  if (impactedDomains.size >= 2) {
    reasons.push('影响范围跨多个 domain，需要人工确认总体变更方向');
    riskSignals.push('cross_domain');
  }

  if ((params.analysisResult.relatedFiles || []).length >= 8) {
    reasons.push('影响文件较多，属于高影响面变更');
    riskSignals.push('high_impact');
  }

  const userDirectionNotes = params.userSpecReview?.notes || [];
  if (userDirectionNotes.some(note => /方向|意图|边界|谨慎|确认/.test(note))) {
    reasons.push('用户在 Spec 治理阶段留下了方向性备注，需要人工再次确认');
    riskSignals.push('user_direction_note');
  }

  notes.push(`Spec 与 Intent 已完成基础对齐检查，命中风险信号数：${riskSignals.length}`);

  return {
    needsHumanGate: riskSignals.length > 0,
    reasons,
    notes,
    riskSignals
  };
}
```

## Intent 文档结构

```markdown
# Intent: 任务名称

## Change ID: CHG-001

## 触发

- **类型**: new_requirement / delta_change
- **来源**: docs/prd.md

## Spec 引用

- **spec_ref**: `.claude/specs/{task-name}.md`
- **规范摘要**: 本次变更以 Spec 中定义的范围、模块边界和验收映射为准

## 变更意图

以稳定 Spec 为准，说明本次变更希望达成的能力、对现有系统的影响面，以及执行阶段应保持不变的方向约束。

## 影响分析

### 涉及文件

- `src/models/User.ts` — 用户数据模型
- `src/services/AuthService.ts` — 认证服务

### 技术约束

- 使用 TypeScript 4.9+
- 遵循 ESLint 规范

### 可复用组件

- `src/utils/validation.ts` — 验证工具函数

## 审查状态

- **状态**: pending / auto_passed / approved / revise_required / rejected
- **审查模式**: conditional_human_gate
- **审查人**: system / user
- **审查时间**: -
```

## 审查状态文件

**路径**: `~/.claude/workflows/{projectId}/changes/{changeId}/review-status.json`

**结构**:
```json
{
  "change_id": "CHG-001",
  "review_mode": "conditional_human_gate",
  "reviewed_at": "2026-03-24T10:00:00Z",
  "status": "auto_passed",
  "reviewer": "system",
  "attempt": 1,
  "max_attempts": 1,
  "last_decision": "pass",
  "next_action": "continue_to_plan_generation",
  "spec_ref": ".claude/specs/task-name.md",
  "reasons": []
}
```

## 状态值

- `pending`: 已命中条件，等待人工关口
- `auto_passed`: 机器检查通过且无需人工确认
- `approved`: 人工关口已批准
- `revise_required`: 用户要求调整后再继续
- `rejected`: 用户拒绝或取消

## 变更 ID 生成规则

```typescript
function nextChangeId(state: any): string {
  const counter = (state.delta_tracking?.change_counter || 0) + 1;
  state.delta_tracking = state.delta_tracking || {};
  state.delta_tracking.change_counter = counter;
  return `CHG-${String(counter).padStart(3, '0')}`;
}
```

## 输出

Intent 文档和审查状态将用于：
- 条件化 Hard Stop：仅在命中条件时请求用户确认
- Phase 2：计划生成（记录 `spec_ref`）
- Phase 3：任务编译（继承 changeId）
- Delta Tracking：变更历史追踪
- Genesis Change：初始变更记录

**取消分支约定**：若用户在 Intent Human Gate 中选择“取消”，当前 `changes/{changeId}` 下的临时 Intent 工件会被清理；只有后续完成归档的变更才会进入 `archive/`。
