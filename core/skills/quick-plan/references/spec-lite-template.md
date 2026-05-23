# Spec-Lite Template

`/grill` 产出或用户要求"整理成需求文档"时的产出格式。比 workflow-spec 轻(无状态机),比 plan-template 重(含 user stories + 决策)。

```markdown
# Spec: [功能名称]

## Problem

[用户视角的问题,1-3 句]

## Solution

[用户视角的方案,1-3 句]

## User Stories

每条:`As a <actor>, I want <feature>, so that <benefit>`。覆盖所有 user-facing 行为(正常 + 异常 + 边界),不限数量,无则不写。


## Implementation Decisions

来自 grill 质询结论:模块划分 / 接口形状 / schema 变更 / 技术选型 / 架构决策 + 原因。不含文件路径(易过期)。例外:prototype 产出的 code snippet 编码了决策(state machine / type shape)时 inline 并标注来源。

## Testing Decisions

列实际会写的测试。不写的层级不列(unit/integration/e2e 不必凑齐),只测行为不测实现。

## Out of Scope

明确不做的事。

## Open Questions

仍未解决且影响实施的问题,附 self-recommended 答案。
```

## 额外规则

- **Implementation Decisions**:主动寻找 deep module 机会(小 interface + 大 behaviour)
- **Out of Scope**:`.out-of-scope/` 有命中项 → 引用
