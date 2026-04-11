# Skill 稳定性待办

记录已识别但暂不在本轮修改的 skill 协议问题。

## fix-bug

### P0：与 bug-batch 的确认协议冲突

当前 `fix-bug` 在 Phase 2 要求 Hard Stop，用户确认前“立即终止”，但 `bug-batch` 已经在批量层做过一次确认后，还会在 Phase 5 启动 `fix-bug` 子 agent 执行 `FixUnit`。

需要补一个显式输入契约，至少区分：

- `standalone`：单缺陷场景，保留当前 Hard Stop
- `batch-approved`：由 `bug-batch` 编排并已批量确认的 FixUnit，可跳过单元级重复确认

建议增加字段：

- `confirmation_mode: standalone | batch-approved`
- 或 `batch_confirmed: true | false`

没有这个字段时，`fix-bug` 与 `bug-batch` 的执行协议不闭合，子 agent 只能卡住或偷跳确认门禁。

### P1：description 仍是流程摘要

当前 frontmatter 把完整流程和状态流转写进 description，容易让模型把前 1 行当捷径，不继续读正文。

建议改成纯触发条件，例如：

- 何时用来处理单个缺陷
- 何时作为 `bug-batch` 的底层修复协议使用

### P1：关键 gate 没有前置成铁律

当前关键约束分散在：

- Phase 1 根因追溯
- Phase 2 Hard Stop
- Phase 4 `status_transition_ready`

建议前置成显式铁律：

- 未确认根因前不得改代码
- 未获得确认前不得实施修复
- 未验证通过前不得给出 `status_transition_ready = true`

## bug-batch

### P0：并行独立性判断不够保守

当前 Phase 5 主要按 `affected_scope` 是否有文件交集决定并行。这个条件偏乐观，容易把“不确定是否独立”的 FixUnit 也放进并行。

建议改成更保守的协议：

- 只有在能够证明独立时才允许并行
- 只要 `affected_scope` 不完整、关系判断仍模糊、或共享依赖未查清，就必须串行

可直接补一句硬约束：

- `cannot prove independence => serialize`

### P0：调用 fix-bug 时缺少批量确认透传字段

当前传给 `fix-bug` 的上下文里没有“该单元已在批量层确认”的显式字段，导致下层协议无法区分是否应该再次 Hard Stop。

这项需要和 `fix-bug` 一起联动改。

### P1：description 仍是流程摘要

当前 description 把“先分析、再编排、再修复、再流转”整套流程都压进 frontmatter，容易弱化正文里的 Hard Stop 和状态门禁。

建议改成纯触发条件：

- 什么时候使用批量缺陷修复
- 什么时候适合先统一分析共享根因，而不是逐条修

### P1：Phase 5 缺少不确定性停机条款

当前 Phase 3 会产出 `needs_manual_judgement`，但 Phase 5 没有把“未解决的人工裁决项不得进入并行修复”写成显式 gate。

建议补：

- 只要存在未裁决的 `needs_manual_judgement`，对应 FixUnit 不得进入并行层
- 未裁决单元只能保持 `manual_intervention` 或停留在确认前状态
