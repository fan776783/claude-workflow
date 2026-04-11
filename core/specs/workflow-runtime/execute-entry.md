# workflow execute 入口与恢复解析

## 目标

统一 `/workflow execute`、`/workflow execute 继续` 与裸自然语言“继续”的入口语义，避免不同文档对后续执行范围产生冲突理解。

## 单一规则

### 1. 显式命令入口

- `/workflow execute`：显式进入执行器，默认使用 `continuous` 模式。
- `/workflow execute --phase`：显式进入执行器，使用 `phase` 模式。
- `/workflow execute --retry`：进入 retry 流程。
- `/workflow execute --skip`：进入 skip 流程。

### 2. 命令内自然语言意图

- `/workflow execute 继续` / `/workflow execute 连续` → `continuous`
- `/workflow execute 下一阶段` / `/workflow execute 单阶段` → `phase`
- `/workflow execute 重试` → `retry`
- `/workflow execute 跳过` → `skip`
- 未识别的自然语言意图：不得静默覆盖已知偏好；应返回 warning，并回退到 `execution_mode`（若存在）或 `continuous`

### 3. 裸自然语言“继续”

仅在以下条件全部满足时，允许将裸“继续”解释为恢复当前 workflow：

1. 存在活动工作流状态文件
2. `state.status` 属于 `running` / `paused` / `failed` / `blocked`
3. 当前对话上下文仍在 workflow 任务链上

若不满足上述条件，禁止猜测进入执行器，应提示用户：

- `/workflow status` 查看当前状态
- `/workflow execute` 显式恢复执行

## 恢复后的共享执行路径

无论入口来自：

- `/workflow execute`
- `/workflow execute 继续`
- 裸自然语言“继续”（满足恢复条件时）

都必须先进入同一个 execute resolver，再执行以下顺序：

1. 读取并校验 `workflow-state.json`
2. 解析 execution mode / retry / skip
3. 读取 `continuation.last_decision`
4. 调用 `ContextGovernor`
5. 决定 `continue-direct` / `continue-parallel-boundaries` / `pause-*` / `handoff-required`

**模式优先级**：`explicit_mode` > `intent` > `execution_mode` > `continuous`

## 重要约束

- “继续”不是无条件继续跑下一个 task，而是“尝试恢复执行器”。
- 真正是否继续，始终以 `ContextGovernor`、验证证据、质量关卡和阻塞状态为准。
- `phase` 与 `continuous` 只定义语义暂停偏好，不绕过预算与验证治理。
- `continue-parallel-boundaries` 只表示 workflow 内部的并行执行建议；即使识别到 2+ 独立任务，也不得自动切入 `/team`。
- workflow hooks 与普通 agent launch 只允许消费 workflow runtime，不得继承或透传 active team runtime 的 `team_id` / `team_name` / `team_phase`。
- `SessionStart` / `PreToolUse(Task)` 属于默认 base hooks，quality gate hook (`PostToolUse`) 属于可选 strict hook；它们只能注入上下文或阻断非法继续，不能替代 shared execute resolver 决定恢复路径。
