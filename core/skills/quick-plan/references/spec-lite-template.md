# Spec-Lite Template

`/grill` 产出或用户要求"整理成需求文档"时的产出格式。比 workflow-spec 轻(无状态机),比 plan-template 重(含 user stories + 决策)。

```markdown
# Spec: [功能名称]

## Problem

[用户视角的问题,1-3 句]

## Solution

[用户视角的方案,1-3 句]

## User Stories

1. As a <actor>, I want <feature>, so that <benefit>
2. ...

覆盖所有 user-facing 行为。宁多不少。

## Implementation Decisions

- [模块划分 / 接口形状 / schema 变更 / 技术选型]
- [质询中确认的约束]
- [架构决策 + 原因]

不含具体文件路径(易过期)。例外:prototype 产出的 code snippet 如果编码了一个决策(state machine / type shape),inline 并标注来源。

## Testing Decisions

- 哪些 module 需要测试
- 测试层级(unit / integration / e2e)
- 代码库中类似测试的参考位置

## Out of Scope

- [明确不做的事]

## Open Questions

- [仍未解决的问题,附 self-recommended 答案]
```

## 填充规则

- **User Stories**:必须广,覆盖正常 + 异常 + 边界。不是 3 条走形式,是真正的行为清单。
- **Implementation Decisions**:来自 `/grill` 质询的结论直接搬入。主动寻找 deep module 机会(小 interface + 大 behaviour)。
- **Testing Decisions**:和用户确认哪些 module 需要测试;只测行为不测实现。
- **Out of Scope**:grill 中明确排除的 + 方向性不做的(如有 `.out-of-scope/` 命中项,引用之)。
- **Open Questions**:grill 中未完全确认的点,附推荐答案。
