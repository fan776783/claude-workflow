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

**未通过时**：提示用户选择：
- **"我来初始化 git"** → 暂停工作流，用户执行 `git init && git add . && git commit -m "Initial commit"` 后重试
- **"无子代理继续"** → ⚠️ 用户显式选择降级。写隔离审查降级为主会话内执行，只读分析不受影响。记录 `git_status.user_acknowledged_degradation = true`

> 不得静默跳过 Git 检查。用户必须显式确认降级。

---

## Step 2: 项目配置检查与自愈（强制）

确保 `project-config.json` 存在，保障 `project.id` 可用，状态机可初始化。

**配置文件路径**：`.claude/config/project-config.json`

**行为**：
- **存在且有效** → 加载配置，使用 `project.id`
- **存在但 id 无效** → 提示用户重新执行 `/scan`
- **不存在** → 自动生成最小配置：
  - `project.id`：必须通过 CLI 计算，禁止手动 shell 命令（如 `echo | md5sum`）拼接。CLI 内部对路径执行 `path.resolve()` + `.toLowerCase()` 后再取 MD5 前 12 位，手动计算极易因路径规范化差异产生不一致。自动生成最小配置时使用：
    ```bash
    node -e "const {stableProjectId}=require('./core/utils/workflow/lifecycle_cmds');console.log(stableProjectId(process.cwd()))"
    ```
  - `project.name`：当前目录名
  - `tech`：全部标记为 `unknown`
  - `_scanMode`：标记为 `auto-healed`
  - 提示用户后续可执行 `/scan --force` 更新完整配置

> 不再因缺少配置而阻塞。自动生成最小配置确保 workflow 可启动。

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
   │   → 提示用户选择：
   │     a) 恢复当前工作流：`/workflow-execute`
   │     b) 归档并新建：`/workflow-archive` + 继续
   │     c) 强制覆盖（需 --force）
   │
   ├─ status: failed / blocked
   │   → 提示用户选择：
   │     a) 重试：`/workflow-execute --retry`
   │     b) 归档并新建
   │
   └─ status: archived
       → 等同于"不存在"，继续
```

> 覆盖时必须要求 `--force` 标志或用户显式确认，防止误删进行中的工作流。备份路径：`~/.claude/workflows/{projectId}/workflow-state.backup-{timestamp}.json`。
