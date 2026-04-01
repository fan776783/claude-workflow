# 执行模式详情（路由索引）

## 概述

workflow execute 支持两种执行模式：**连续模式**（默认）和**单 phase 模式**（可选），以及 **retry** / **skip** 特殊模式。

> 审查结果读取：新实现只写入并优先读取 `state.quality_gates[taskId]`。旧字段 `execution_reviews` 的兼容规则和归一化读取 helper 参见 `references/state-machine.md` → `execution_reviews` 迁移策略。已实现于 `scripts/state_manager.py` → `get_review_result()`。

> 核心设计：连续模式执行到质量关卡完成后自动暂停，提示用户审查质量结果。这确保代码质量始终受人工监督，同时最大化自动化执行效率。

> 执行链路直接消费 `WorkflowTaskV2`：任务提取使用 `extractCurrentTaskV2()`，动作判断使用 `actions[]`，实现语义读取 `steps[]`。
>
> 自 vNext 起，执行阶段采用 **budget-first** continuation governance：
> - `execution_mode` 只定义语义上的暂停偏好
> - `ContextGovernor` 负责 continue / pause / parallel-boundaries / handoff-required 的真实决策
> - 所有模式都必须先通过预算、安全、独立性与验证条件检查，才能继续执行

## 模式类型

| 模式 | 文件 | 说明 |
|------|------|------|
| 连续（默认） | [continuous-mode.md](continuous-mode.md) | 连续执行到质量关卡，暂停提示审查 |
| 单 phase | [phase-mode.md](phase-mode.md) | 按 phase 执行，边界暂停 |
| 重试 | [retry-debugging.md](retry-debugging.md) | 重试失败任务 + 结构化调试协议 |
| 跳过 | [skip-mode.md](skip-mode.md) | 跳过当前任务（例外路径） |

## 共享机制

| 机制 | 文件 | 说明 |
|------|------|------|
| ContextGovernor | [context-governor.md](context-governor.md) | 所有模式共享的 continuation 治理决策器 |
| Subagent 路由 | [subagent-routing.md](subagent-routing.md) | 平台感知的子 Agent 路由与并行执行 |
| Post-Execution Pipeline | [post-execution-pipeline.md](post-execution-pipeline.md) | 6 步后置管线（验证→自审查→更新 Plan→更新 State→审查→Journal） |
| TDD 执行纪律 | [tdd-enforcement.md](tdd-enforcement.md) | Red-Green-Refactor 循环 |

## 加载策略

AI Agent 先读取本索引，根据当前执行模式和上下文需要按需加载具体子文件：

```
1. 确定 execution_mode → 加载对应模式文件
2. 每个 task 完成后 → 加载 post-execution-pipeline.md
3. ContextGovernor 决策 → 加载 context-governor.md
4. 需要子 Agent → 加载 subagent-routing.md
5. 代码产出任务 → 加载 tdd-enforcement.md
```
