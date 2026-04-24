# Preflight 预检模块

> 从 workflow-plan 提取的共享基础设施预检。可被 `/workflow-plan`、`/quick-plan` 等命令复用。

## 预检流程

参数解析后立即执行以下 3 步预检。

---

## Step 1: Git 状态检查（强制）

确认 git 仓库已初始化且有初始提交。

**为什么需要 Git**：需要写隔离的子代理（如 Spec 合规审查、代码质量审查）依赖 git worktree 进行隔离执行。明确只读的分析/审查型子代理可以无 worktree 运行，但写隔离场景不允许静默降级。

**检查项**：
1. 当前目录是否在 git 仓库中（`git rev-parse --is-inside-work-tree`）
2. 是否有至少一次提交（`git log --oneline -1`）

**未通过时**：调用 `AskUserQuestion` 收集决策，`question` 写"Git 仓库未就绪，如何继续？"，`options` 给两条：

- `init_git` — 我来初始化 git：暂停工作流，用户执行 `git init && git add . && git commit -m "Initial commit"` 后重试
- `continue_without_subagent` — 无子代理继续：⚠️ 用户显式选择降级。写隔离审查降级为主会话内执行，只读分析不受影响。记录 `git_status.user_acknowledged_degradation = true`

> 不得静默跳过 Git 检查。用户必须通过 AskUserQuestion 显式确认降级。

---

## Step 2: 项目配置检查（强制）

确保 `project-config.json` 存在，保障 `project.id` 可用，状态机可初始化。

**配置文件路径**：`.claude/config/project-config.json`

**行为**：
- **存在且有效** → 加载配置，直接使用 `project.id`，不再重新计算
- **存在但 id 无效或缺失** → 报错并提示执行 `/scan --force`
- **不存在** → 报错并提示执行 `/scan`（空项目使用 `/scan --init`）

**projectId 生成规则（仅 /scan 内部使用）**：格式 `{name-slug}-{12位 hash}`；slug 取目录名 ASCII 部分并 lowercase 统一 `-`，slug 为空时退回纯 hash。必须通过 CLI 计算：
```bash
node -e "const {stableProjectId}=require('./core/utils/workflow/lifecycle_cmds');console.log(stableProjectId(process.cwd()))"
```
禁止手动 shell 哈希，禁止在运行时入口（cmdPlan、buildExecuteEntry、resolveWorkflowRuntime 等）重新计算 —— 任何运行时重算都会在 worktree / 子目录 / symlink 场景引发 projectId 漂移。

**Legacy 迁移**：v5.2.x 及之前的纯 12 位 hex id（如 `8c5fd4f4930b`）由 `/scan` Part -1 检测并提示迁移，用户确认后改写 config 并 `mv` `~/.claude/workflows/{旧id}/` 为新 id 目录。

> 不再自动生成最小配置。缺失配置视为用户显式操作前置不足，必须先跑 `/scan`。

---

## Step 3: 检测现有工作流（条件执行）

检查 `~/.claude/workflows/{projectId}/workflow-state.json` 是否存在未归档的工作流。

> 此步骤仅在 `/workflow-plan` 中执行，`/quick-plan` 等轻量命令跳过。

**决策树**：

```
检测到 workflow-state.json？
│
├─ 不存在 → 继续（新建工作流）
│
└─ 存在 → 读取 status 字段
   │
   ├─ status: completed
   │   → 提示用户先归档：`/workflow-archive`
   │   → 归档完成后自动继续
   │
   ├─ status: running / paused
   │   → 调用 AskUserQuestion（见下）
   │
   ├─ status: failed / blocked
   │   → 调用 AskUserQuestion（见下）
   │
   └─ status: archived
       → 等同于"不存在"，继续
```

**AskUserQuestion 选项**：

`running` / `paused`，`question` 写"检测到进行中的工作流，如何处理？"，`options`：

- `resume` — 恢复当前工作流（使用 `/workflow-execute`）
- `archive_and_new` — 归档并新建（调用 `/workflow-archive` 后继续）
- `force_overwrite` — 强制覆盖（等同 `--force`；备份现状到 `workflow-state.backup-{timestamp}.json` 后覆盖）

`failed` / `blocked`，`question` 写"上次工作流未正常结束，如何处理？"，`options`：

- `retry` — 重试（使用 `/workflow-execute --retry`）
- `archive_and_new` — 归档并新建

> 覆盖时必须要求 `--force` 标志或用户通过 AskUserQuestion 显式确认，防止误删进行中的工作流。备份路径：`~/.claude/workflows/{projectId}/workflow-state.backup-{timestamp}.json`。
