# Review Loop 共享规范

## 目的

为 `workflow` 内部所有审查节点提供统一的 loop contract、预算语义、产物落盘方式与升级规则。

本规范只定义 **workflow 内部共享原语**，不定义独立的用户可调用 skill。

## 适用范围

当前覆盖三类审查节点：

- `MachineReviewLoop`：机器审查、允许在限定预算内自动修订并重审
- `HumanGovernanceGate`：人工治理关口，负责范围、边界与方向主权确认
- `ConditionalHumanGate`：先做机器一致性检查，仅在命中条件时进入人工确认

## 当前映射

| 节点 | 类型 | 产物 sink |
|------|------|-----------|
| Phase 1.2 Spec / Traceability Review | `MachineReviewLoop` | `state.review_status.spec_review` + `state.review_status.traceability_review` |
| Phase 1.4 User Spec Review | `HumanGovernanceGate` | `state.review_status.user_spec_review` |
| Phase 1.5 Intent Review | `ConditionalHumanGate` | `state.review_status.intent_review` |
| Phase 2.5 Plan Review | `MachineReviewLoop` | `state.review_status.plan_review` |
| execute / `quality_review` | `MachineReviewLoop` 的 execution adapter | `state.quality_gates[task.id]` |

## 设计原则

### 1. 真相源冻结

进入 planning side machine review loop 后：

- `requirement-baseline.md` 与 `requirement-baseline.json` 视为冻结真相源
- loop 内允许修订设计文档、plan 文档与 review artifact
- loop 内**不允许**回写 requirement truth source
- 若发现需求本身需要变更，必须退出当前 loop，交由人工处理

### 2. 有界收敛

所有 machine loop 必须声明：

- 最大尝试次数
- 允许修订边界
- 升级条件
- 每轮产物记录位置

禁止开放式无限重写。

### 3. 审查与修订解耦

reviewer 负责输出结构化问题与决策；修订步骤负责按边界修复；下一轮 reviewer 重新基于完整对象复审。

### 4. 共享但不强行同构

planning side 使用 `review_status.*`；execution side 使用 `quality_gates.*`。

两者共享 contract 语义，但不强制使用完全一致的数据结构，以避免破坏现有执行逻辑。

## 核心接口

```typescript
interface ReviewSubject {
  kind: 'document' | 'task' | 'diff_window' | 'change_set';
  ref: string;
  requirement_ids?: string[];
  critical_constraints?: string[];
}

interface ReviewOutcome {
  decision: 'pass' | 'revise' | 'split' | 'rejected';
  issues: string[];
  next_action?: string;
  blocking_issues?: string[];
}

interface ReviewLoopArtifact {
  review_type: string;
  review_mode: 'machine_loop' | 'human_gate' | 'conditional_human_gate';
  subject: ReviewSubject;
  attempt: number;
  max_attempts: number;
  decision: ReviewOutcome['decision'];
  overall_passed: boolean;
  issues: string[];
  blocking_issues?: string[];
  next_action?: string;
  reviewed_at: string;
  reviewer: 'user' | 'subagent' | 'system';
}

interface ReviewLoopPolicy {
  max_attempts: number;
  freeze_truth_sources?: string[];
  allowed_revision_scope?: string[];
  escalate_on: Array<'budget_exhausted' | 'split' | 'human_direction_change'>;
}
```

## 共享原语

### Review Subject Resolver

负责把待审对象归一化为 `ReviewSubject`：

- planning side 通常是 `document`
- execution side 通常是 `diff_window`
- delta / change 场景可使用 `change_set`

### Context Packer

负责最小化封装审查上下文，至少包含：

- 当前待审对象
- 上游真相源引用
- `requirement_ids`
- `critical_constraints`
- 当前尝试次数与预算
- 当前节点允许修订边界

### Budget Policy

- planning side 默认 `max_attempts = 3`
- execution side 的 `quality_review` 继续使用共享总预算 `maxTotalLoops = 4`
- 预算耗尽必须落盘 artifact，并显式返回失败或升级人工

### Artifact Sink

- planning side：写入 `state.review_status.*`
- execution side：写入 `state.quality_gates.*`
- 允许同时落地独立文档或 JSON 产物，但状态机 sink 必须始终更新

## Machine Review Loop 标准流程

```typescript
async function runMachineReviewLoop(
  subject: ReviewSubject,
  policy: ReviewLoopPolicy
): Promise<ReviewLoopArtifact> {
  let attempt = 0;

  while (attempt < policy.max_attempts) {
    attempt += 1;
    const outcome = await review(subject, attempt);

    if (outcome.decision === 'pass') {
      return toArtifact(subject, policy, attempt, outcome, true);
    }

    if (outcome.decision === 'split') {
      return toArtifact(subject, policy, attempt, outcome, false);
    }

    await reviseWithinBoundary(subject, outcome.issues, policy.allowed_revision_scope);
  }

  return toArtifact(subject, policy, policy.max_attempts, {
    decision: 'rejected',
    issues: ['review loop budget exhausted'],
    next_action: 'escalate_to_human'
  }, false);
}
```

## Planning Side 约束

### Phase 1.2

- 允许修订：`tech-design.md` 的结构、追溯、关键约束覆盖
- 不允许修订：Requirement Baseline 真相源
- `split` 不继续自动 loop，直接升级人工范围拆分

### Phase 2.5

- 允许修订：coverage、constraints、verification、step decomposition
- 不允许修订：scope、执行目标、需求真相源
- `revise` 返回 Plan Generation 后重审

## Human Gate 语义

### HumanGovernanceGate

特征：

- 不追求机器自动收敛
- 不自动修文后重跑
- 决策直接表达主权意图

适用于 `Phase 1.4 User Spec Review`。

### ConditionalHumanGate

特征：

- 先做机器一致性检查
- 仅在命中条件时把 `state.status` 切换为等待人工
- 若无需人工确认，则在状态中记录 auto-pass artifact 后继续

适用于 `Phase 1.5 Intent Review`。

## 为什么暂不抽成独立 skill

当前 review loop 仍然强耦合以下 workflow 私有对象：

- `workflow-state.json`
- `review_status`
- `quality_gates`
- `WorkflowTaskV2`
- requirement baseline / traceability contracts

因此当前最佳复用边界是：

- 在 `workflow` 内部复用同一份 review loop contract
- 各 phase spec 与 execution action 直接引用本规范

只有在满足以下条件时再考虑 skill 化：

- `workflow` 外出现 2 到 3 个稳定复用场景
- reviewer routing 与 artifact contract 已稳定
- 对 workflow 私有状态的耦合显著下降
- 能形成清晰的独立入口与调用协议
