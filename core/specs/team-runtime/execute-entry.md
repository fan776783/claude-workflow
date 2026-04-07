# `/team execute` 入口

`/team execute` 不是重写执行器，而是在现有 workflow execution/runtime helpers 外包一层 team orchestrator。

## 入口职责

1. 读取 `team-state.json`
2. 识别当前 `team_phase`
3. 在 `team-exec` 中决定：顺序推进 / 单子 agent / 并行批次
4. 汇总验证结果，进入 `team-verify`
5. 若存在失败边界，则进入 `team-fix`
6. 只重投失败边界，直到 `completed`、`failed` 或人工中断

## 与并行分派的关系

- team runtime 自己负责多实例编排、边界任务板与阶段推进
- `dispatching-parallel-agents` 只作为规则来源：独立性检查、边界分组、冲突降级
- `ContextGovernor` 返回 `continue-parallel-boundaries` 时，只能解释为当前 team-exec 的执行建议
- 在普通 `/workflow execute` 中，`parallel-boundaries` 仍只是 workflow 执行路径优化，不等于 team mode

## 复用优先级

优先复用：
- `workflow-executing`
- `workflow-reviewing`
- `dispatching-parallel-agents`（只复用独立性检查 / 边界分组 / 冲突降级规则）
- workflow runtime shared helpers
