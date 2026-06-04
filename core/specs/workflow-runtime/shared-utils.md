# 共享工具函数 (v4.0)

workflow系统中多处使用的共享函数。**所有逻辑已实现为 Node.js 脚本**，执行时直接调用脚本，不依赖伪代码。

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
| `status` | 快速workflow状态 | Step 1-2 of status.md |
| `list` | 列出所有任务 | `parseWorkflowTasksV2FromMarkdown()` |
| `progress` | 进度统计 | `calculateProgress()` |
| `journal list` | 最近会话记录 | — |

### 底层脚本（按需直接调用）

| 脚本 | 功能 | CLI 用法 |
|------|------|---------|
| `path_utils.js` | 路径安全校验 | `node utils/workflow/path_utils.js resolve <base> <path>` |
| `task_parser.js` | Markdown 任务解析 | `node utils/workflow/task_parser.js parse <file>` |
| `task_manager.js` | 任务状态管理 | `node utils/workflow/task_manager.js complete T3` |
| `state_manager.js` | 状态文件读写 | `node utils/workflow/state_manager.js --project-id <id> read` |
| `status_utils.js` | Emoji / 状态工具 | `node utils/workflow/status_utils.js emoji completed` |
| `dependency_checker.js` | 依赖检查 | `node utils/workflow/dependency_checker.js classify --name <n> --files <f>` |
| `journal.js` | 会话日志管理 | `node utils/workflow/workflow_cli.js journal add --title "..." --summary "..."` |
| `verification.js` | 验证辅助 | `node utils/workflow/verification.js info edit_file` |

---

## 数据模型参考

### 任务模型

**canonical task 模型 = task-dir 的 task.json，字段 contract 见 [`task-dir-schema.md`](task-dir-schema.md)。** `task_parser.js` 的 `createWorkflowTaskV2()` 仅是 legacy plan.md 解析形状（`LegacyPlanMdSource` 兜底路径用），不要以它为新 task 的字段参考。

### 状态 Emoji 映射

| 状态 | Emoji | Node.js 函数 |
|------|-------|------------|
| completed | ✅ | `status_utils.getStatusEmoji("completed")` |
| in_progress | ⏳ | `status_utils.getStatusEmoji("in_progress")` |
| failed | ❌ | `status_utils.getStatusEmoji("failed")` |
| skipped | ⏭️ | `status_utils.getStatusEmoji("skipped")` |

### 上下文预算（已退役）

> ⚠️ `contextMetrics` / `continuation` 字段已随 ContextGovernor 退役：`workflow_types.ensureStateDefaults` 读时丢弃，全仓无写入方，不参与任何执行期决策——context 压力仅剩 workflow-execute Step 6 的启发式 banner。历史字段形状如需考古，看 git history。

---

## 注意事项

- `workflow-state.json` 只能位于 `~/.claude/workflows/{projectId}/workflow-state.json`
- 项目目录 `.claude/` 仅承载项目配置与 spec/plan 等工件，禁止作为 runtime state 存储位置
- 统一状态操作优先使用 `workflow_cli.js`，底层 `state_manager.js` 不接受项目本地 state path
- "继续"与 `/workflow-execute` 的共享入口解析已收敛到 `utils/workflow/workflow_cli.js`，但仅适用于 execution-phase resume，不包含 planning human gate
- 任务解析只使用 V2 模型，不再维护旧格式映射
- 上下文结构必须与共享上下文convention保持一致；如需仓库级扩展说明，应在打包环境中确认对应共享文档可达
- workflow hooks 只承担 runtime guardrails：上下文注入、前置条件校验与 worktree/并发安全
- workflow hooks 不得私自决定 planning / execute / delta / archive 的阶段流转；主workflow唯一入口仍是 command + skill + state machine
- `SessionStart` / `PreToolUse(Task)` hooks 只能提示或阻断，不得绕过 `/workflow-execute` shared resolver、写入主状态或另造第二套状态机
