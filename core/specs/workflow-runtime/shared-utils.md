# 共享工具函数 (v4.0)

工作流系统中多处使用的共享函数。**所有逻辑已实现为 Node.js 脚本**，执行时直接调用脚本，不依赖伪代码。

## 快速导航

- 想找统一入口：看“统一入口”
- 想按脚本查命令：看“底层脚本（按需直接调用）”
- 想看路径/状态/任务解析能力分别在哪：看对应表格
- 想确认运行时与项目工件边界：结合 `state-machine.md`

## 何时读取

- 需要确定 workflow Node.js 工具该如何调用时
- 需要确认统一 CLI、底层脚本与数据模型引用关系时

## Node.js 工具库

> ⚠️ 以下为**唯一权威实现**。MD 中不再保留伪代码副本。

### 统一入口

```bash
node utils/workflow/workflow_cli.js <command>    # 统一 CLI 入口（推荐）
```

| 命令 | 功能 | 等效旧伪代码 |
|------|------|-------------|
| `next` | 查询下一步该做什么 | `findNextTask()` |
| `advance T3` | 完成 + 推进 + 可选 journal | — |
| `context` | 聚合启动上下文 | — |
| `status` | 快速工作流状态 | Step 1-2 of status.md |
| `list` | 列出所有任务 | `parseWorkflowTasksV2FromMarkdown()` |
| `progress` | 进度统计 | `calculateProgress()` |
| `parallel` | 查找可并行任务 | `classifyTaskDependencies()` |
| `budget` | 上下文预算评估 | `evaluateBudgetThresholds()` |
| `journal list` | 最近会话记录 | — |

### 底层脚本（按需直接调用）

| 脚本 | 功能 | CLI 用法 |
|------|------|---------|
| `path_utils.js` | 路径安全校验 | `node utils/workflow/path_utils.js resolve <base> <path>` |
| `task_parser.js` | Markdown 任务解析 | `node utils/workflow/task_parser.js parse <file>` |
| `task_manager.js` | 任务状态管理 | `node utils/workflow/task_manager.js complete T3` |
| `state_manager.js` | 状态文件读写 | `node utils/workflow/state_manager.js --project-id <id> read` |
| `status_utils.js` | Emoji / 状态工具 | `node utils/workflow/status_utils.js emoji completed` |
| `context_budget.js` | 上下文预算计算 | `node utils/workflow/context_budget.js budget --projected-usage 65` |
| `dependency_checker.js` | 依赖检查 | `node utils/workflow/dependency_checker.js classify --name <n> --files <f>` |
| `journal.js` | 会话日志管理 | `node utils/workflow/workflow_cli.js journal add --title "..." --summary "..."` |
| `verification.js` | 验证辅助 | `node utils/workflow/verification.js info edit_file` |

---

## 数据模型参考

### WorkflowTaskV2

任务模型定义在 `utils/workflow/task_parser.js` 的 `createWorkflowTaskV2()` 输出结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | str | 任务 ID（T1, T2, ...） |
| `name` | str | 任务名称 |
| `phase` | str | 阶段（implement / test / review） |
| `files` | TaskFiles | 创建/修改/测试文件集合 |
| `leverage` | list[str] | 可复用组件 |
| `spec_ref` | str | Spec 章节引用 |
| `plan_ref` | str | Plan 章节引用 |
| `acceptance_criteria` | list[str] | 验收条件 |
| `depends` | list[str] | 任务依赖 |
| `blocked_by` | list[str] | 阻塞依赖（外部） |
| `quality_gate` | bool | 是否为质量关卡 |
| `status` | str | pending / in_progress / completed / failed / skipped / blocked |
| `actions` | list[str] | create_file / edit_file / run_tests / quality_review / git_commit |
| `steps` | list[TaskStep] | 步骤列表 |
| `verification` | TaskVerification | 验证命令和预期输出 |

### 状态 Emoji 映射

| 状态 | Emoji | Node.js 函数 |
|------|-------|------------|
| completed | ✅ | `status_utils.getStatusEmoji("completed")` |
| in_progress | ⏳ | `status_utils.getStatusEmoji("in_progress")` |
| failed | ❌ | `status_utils.getStatusEmoji("failed")` |
| skipped | ⏭️ | `status_utils.getStatusEmoji("skipped")` |

### 上下文预算阈值

| 阈值 | 默认值 | 含义 |
|------|--------|------|
| warning | 60% | 警告区，优化执行路径 |
| danger | 80% | 危险区，优先暂停 |
| hard_handoff | 90% | 硬停止，生成 continuation artifact |

### ContextMetrics（workflow-state.json 中的上下文预算指标）

状态文件中 `contextMetrics` 字段的完整定义，供构建和读取时参考：

| 字段 | 类型 | 说明 |
|------|------|------|
| `maxContextTokens` | number | 平台最大上下文容量 |
| `estimatedTokens` | number | 当前预估 token 用量 |
| `projectedNextTurnTokens` | number | 预估下一轮 token 用量 |
| `reservedExecutionTokens` | number | 执行预留 |
| `reservedVerificationTokens` | number | 验证预留 |
| `reservedReviewTokens` | number | 审查预留 |
| `reservedSafetyBufferTokens` | number | 安全缓冲预留 |
| `usagePercent` | number | 当前使用百分比 |
| `projectedUsagePercent` | number | 预估使用百分比（continuation 决策依据） |
| `warningThreshold` | number | 警告阈值（默认 60） |
| `dangerThreshold` | number | 危险阈值（默认 80） |
| `hardHandoffThreshold` | number | 硬停止阈值（默认 90） |
| `maxConsecutiveTasks` | number | 最大连续执行任务数（节奏控制） |
| `history[]` | array | 每次任务执行的 token 用量记录 |
| `history[].taskId` | string | 任务 ID |
| `history[].preTaskTokens` | number | 执行前 token |
| `history[].postTaskTokens` | number | 执行后 token |
| `history[].tokenDelta` | number | token 增量 |
| `history[].executionPath` | `direct / single-subagent / parallel-boundaries` | 执行路径 |

> 动态任务上限由 `context_budget.js:calculateMaxTasks()` 根据 `usagePercent` + 任务复杂度计算。continuation 决策以 `projectedUsagePercent`（而非 `usagePercent`）为准。

---

## 注意事项

- `workflow-state.json` 只能位于 `~/.claude/workflows/{projectId}/workflow-state.json`
- 项目目录 `.claude/` 仅承载项目配置与 spec/plan 等工件，禁止作为 runtime state 存储位置
- 统一状态操作优先使用 `workflow_cli.js`，底层 `state_manager.js` 不接受项目本地 state path
- "继续"与 `/workflow execute` 的共享入口解析已收敛到 `utils/workflow/workflow_cli.js`，但仅适用于 execution-phase resume，不包含 planning human gate
- 任务解析只使用 V2 模型，不再维护旧格式映射
- 上下文结构必须与共享上下文约定保持一致；如需仓库级扩展说明，应在打包环境中确认对应共享文档可达
- 任何继续执行判断都以 projected budget 为准，而非只看当前 usagePercent
- workflow hooks 只承担 runtime guardrails：上下文注入、前置条件校验、验证证据检查、质量关卡阻断与 worktree/并发安全
- workflow hooks 不得私自决定 planning / execute / delta / archive 的阶段流转；主流程唯一入口仍是 command + skill + state machine
- `SessionStart` / `PreToolUse(Task)` 属于默认 base hooks；`PostToolUse` 质量关卡 hook 属于可选 strict hook
- 若启用这些 hooks，它们只能提示或阻断，不得绕过 `/workflow execute` shared resolver、写入主状态或另造第二套状态机
