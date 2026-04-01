---
name: workflow
description: "智能工作流系统 - 需求讨论、Spec 规划与自动化执行。显式调用：/workflow action [args]。Actions: start（启动规划）、execute（执行任务）、delta（增量变更/API同步）、status（查看状态）、archive（归档）。此 skill 不会自动触发，需用户明确调用。支持子 Agent 驱动的两阶段代码审查（Spec 合规 + 代码质量）、交互式需求讨论（Phase 0.2）、结构化调试协议和 TDD 执行纪律。"
---

# 智能工作流系统

> 本文件为入口/路由层，不定义新的状态字段、触发规则或执行语义；具体行为以 `references/` 与 `specs/` 中的文档为准。

workflow 将需求推进为三层工件：`spec.md`（规范）→ `plan.md`（可执行步骤）→ 代码实现（执行 + 审查）。

## 快速导航

- 想启动新工作流：读 [references/start-overview.md](references/start-overview.md)
- 想恢复/继续执行：读 [references/execute-overview.md](references/execute-overview.md)
- 想处理 PRD / API 变更：读 [references/delta-overview.md](references/delta-overview.md)
- 想查看运行时状态结构：读 [references/state-machine.md](references/state-machine.md)
- 想确认 task 完成后必须做什么：读 [references/execution-checklist.md](references/execution-checklist.md)
- 想了解统一 CLI / Python 脚本入口：读 [references/shared-utils.md](references/shared-utils.md)
- 同阶段存在 2+ 独立任务需要并行分派：先读 [../dispatching-parallel-agents/SKILL.md](../dispatching-parallel-agents/SKILL.md)

## 核心调用方式

```bash
/workflow start "需求描述"
/workflow start docs/prd.md
/workflow start --no-discuss docs/prd.md

/workflow execute
/workflow execute --phase
/workflow execute --retry
/workflow execute --skip

/workflow status
/workflow status --detail

/workflow delta
/workflow delta docs/prd-v2.md
/workflow delta 新增导出功能，支持 CSV 格式

/workflow archive
```

## 最小执行契约

执行 `/workflow execute` 时，至少必须满足以下约束；详细定义以引用文档为准：

1. **状态文件先行**：先确认 `~/.claude/workflows/{projectId}/workflow-state.json` 存在；缺失则创建最小状态文件。详见 [references/state-machine.md](references/state-machine.md)。
2. **逐 task 更新计划**：每个 task 完成后立即更新 `plan.md` 对应的 `WorkflowTaskV2` 任务块。详见 [references/execution-checklist.md](references/execution-checklist.md)。
3. **验证后才能 completed**：必须运行并读取验证结果，未验证不得标记完成。详见 [references/execution-checklist.md](references/execution-checklist.md)。
4. **审查不可跳过**：质量关卡 task 必须进入两阶段审查；每连续 3 个常规 task 需做轻量合规检查。详见 [references/execute-overview.md](references/execute-overview.md) 与 [specs/execute/subagent-review.md](specs/execute/subagent-review.md)。
5. **讨论/设计需持久化**：Phase 0.2 和 Phase 0.3 的结果必须写入各自 artifact，而不是只留在对话里。详见 [references/start-overview.md](references/start-overview.md)。

## 工作流总览

```text
需求 → 代码分析 → 需求讨论（条件） → UX 设计审批（条件 HARD-GATE）
   → spec.md → User Review → plan.md → 执行 + 审查
```

- `spec.md`：需求范围、约束、架构设计、用户行为、验收标准
- `plan.md`：原子步骤、文件清单、完整代码块、验证命令
- 执行阶段：按 plan 实施，并在质量关卡/末尾通过审查闭环保证 spec 合规与代码质量

## Action 路由

### start

`/workflow start` 负责从需求进入规划阶段：
- Phase 0：代码分析
- Phase 0.2：需求讨论（条件执行）
- Phase 0.3：UX 设计审批（条件 HARD-GATE）
- Phase 1：Spec 生成
- Phase 1.1：User Spec Review
- Phase 2：Plan 生成

先读：
- [references/start-overview.md](references/start-overview.md)
- [specs/start/phase-0-code-analysis.md](specs/start/phase-0-code-analysis.md)
- [specs/start/phase-0.2-requirement-discussion.md](specs/start/phase-0.2-requirement-discussion.md)
- [specs/start/phase-0.3-ux-design-gate.md](specs/start/phase-0.3-ux-design-gate.md)
- [specs/start/phase-1-spec-generation.md](specs/start/phase-1-spec-generation.md)
- [specs/start/phase-1.1-spec-user-review.md](specs/start/phase-1.1-spec-user-review.md)
- [specs/start/phase-2-plan-generation.md](specs/start/phase-2-plan-generation.md)

### execute

`/workflow execute` 负责恢复/继续任务执行；`execution_mode` 只定义语义暂停偏好，真正是否继续由 `ContextGovernor` 决定。

先读：
- [references/execute-overview.md](references/execute-overview.md)
- [references/execute-entry.md](references/execute-entry.md)
- [references/execution-checklist.md](references/execution-checklist.md)
- [specs/execute/execution-modes.md](specs/execute/execution-modes.md)
- [specs/execute/context-governor.md](specs/execute/context-governor.md)
- [specs/execute/post-execution-pipeline.md](specs/execute/post-execution-pipeline.md)
- [specs/execute/subagent-review.md](specs/execute/subagent-review.md)
- [specs/execute/tdd-enforcement.md](specs/execute/tdd-enforcement.md)

### delta

`/workflow delta` 统一处理需求更新、PRD 变化与 API 同步。

先读：
- [references/delta-overview.md](references/delta-overview.md)
- [specs/delta/impact-analysis.md](specs/delta/impact-analysis.md)
- [specs/delta/api-sync.md](specs/delta/api-sync.md)

### status / archive

- `status`：查看运行时状态与当前下一步。读 [references/status.md](references/status.md)
- `archive`：归档已完成工作流与变更记录。读 [references/archive.md](references/archive.md)

## 自然语言恢复语义

- `/workflow execute`：显式恢复执行器，默认 `continuous`
- `/workflow execute 继续`：与默认执行一致
- 裸“继续”：仅在存在活动 workflow 且当前对话仍处于该 workflow 任务链上时，才可解释为恢复执行

权威规则见 [references/execute-entry.md](references/execute-entry.md)。

## 统一脚本与状态入口

- 运行时状态文件：`~/.claude/workflows/{projectId}/workflow-state.json`
- 项目工件：`.claude/specs/*.md`、`.claude/plans/*.md`
- Python 工具入口：优先读 [references/shared-utils.md](references/shared-utils.md)
- 统一 CLI：`scripts/workflow_cli.py`

## References

### 概览层

| 模块 | 路径 | 说明 |
|------|------|------|
| start | [references/start-overview.md](references/start-overview.md) | 启动工作流概览 |
| execute | [references/execute-overview.md](references/execute-overview.md) | 执行任务概览 |
| delta | [references/delta-overview.md](references/delta-overview.md) | 增量变更概览 |
| status | [references/status.md](references/status.md) | 查看状态 |
| archive | [references/archive.md](references/archive.md) | 归档工作流 |
| state-machine | [references/state-machine.md](references/state-machine.md) | 运行时状态结构 |
| execution-checklist | [references/execution-checklist.md](references/execution-checklist.md) | task 完成后的强制检查 |
| execute-entry | [references/execute-entry.md](references/execute-entry.md) | 执行入口与恢复解析 |
| shared-utils | [references/shared-utils.md](references/shared-utils.md) | 统一 CLI 入口 + 数据模型参考 |
| traceability | [references/traceability.md](references/traceability.md) | 需求追溯模型 |
| external-deps | [references/external-deps.md](references/external-deps.md) | 外部依赖与 API 同步语义 |

### 详细规格

**start**：
- [specs/start/phase-0-code-analysis.md](specs/start/phase-0-code-analysis.md)
- [specs/start/phase-0.2-requirement-discussion.md](specs/start/phase-0.2-requirement-discussion.md)
- [specs/start/phase-0.3-ux-design-gate.md](specs/start/phase-0.3-ux-design-gate.md)
- [specs/start/phase-1-spec-generation.md](specs/start/phase-1-spec-generation.md)
- [specs/start/phase-1.1-spec-user-review.md](specs/start/phase-1.1-spec-user-review.md)
- [specs/start/phase-2-plan-generation.md](specs/start/phase-2-plan-generation.md)

**execute**：
- [specs/execute/execution-modes.md](specs/execute/execution-modes.md)
- [specs/execute/continuous-mode.md](specs/execute/continuous-mode.md)
- [specs/execute/phase-mode.md](specs/execute/phase-mode.md)
- [specs/execute/retry-debugging.md](specs/execute/retry-debugging.md)
- [specs/execute/skip-mode.md](specs/execute/skip-mode.md)
- [specs/execute/context-governor.md](specs/execute/context-governor.md)
- [specs/execute/subagent-routing.md](specs/execute/subagent-routing.md)
- [specs/execute/post-execution-pipeline.md](specs/execute/post-execution-pipeline.md)
- [specs/execute/subagent-review.md](specs/execute/subagent-review.md)
- [specs/execute/tdd-enforcement.md](specs/execute/tdd-enforcement.md)
- [specs/execute/helpers.md](specs/execute/helpers.md)

**delta**：
- [specs/delta/impact-analysis.md](specs/delta/impact-analysis.md)
- [specs/delta/api-sync.md](specs/delta/api-sync.md)

## 前置条件

执行 `/workflow start` 前需确保：
1. 推荐先有项目配置（可由 `/scan` 自动生成）
2. 需求描述或 PRD 足够清晰
3. 用户可接受 Spec 审查与阶段性 Hard Stop
4. 项目在 git 仓库中；若缺失则需初始化或降级执行
