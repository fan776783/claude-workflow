# Preflight 预检模块

> 从 `phase-0-code-analysis.md` 提取的共享基础设施预检。可被 `/workflow start`、`/quick-plan` 等命令复用。

## 快速导航

- Git 状态检查：Step 1
- 项目配置自愈：Step 2
- 工作流状态检测：Step 3

## 何时读取

- `/workflow start` 启动前（由 `phase-0-code-analysis.md` 引用）
- `/quick-plan` 启动前（由 `plan/SKILL.md` 引用）
- 需要确认 Git 环境、项目配置或已有工作流状态时

---

## Step 1: Git 状态检查（强制）

> 需要写隔离的子代理（如 Spec 合规审查、代码质量审查）依赖 git worktree 进行隔离执行。
> 明确只读的分析/审查型子代理可无 worktree 运行，但不允许对写隔离场景静默降级。

```typescript
interface GitStatus {
  ready: boolean;
  reason?: "not_git_repo" | "no_commits";
  message?: string;
}

function checkGitStatus(): GitStatus {
  try {
    const isGitRepo =
      execSync("git rev-parse --is-inside-work-tree", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() === "true";

    if (!isGitRepo) {
      return {
        ready: false,
        reason: "not_git_repo",
        message:
          "当前项目不在 git 仓库中。需要写隔离的子代理仍需要 git worktree。",
      };
    }

    const hasCommits =
      execSync("git log --oneline -1", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim().length > 0;

    if (!hasCommits) {
      return {
        ready: false,
        reason: "no_commits",
        message: "Git 仓库没有初始提交。请先提交一次后再启动工作流。",
      };
    }

    return { ready: true };
  } catch {
    return {
      ready: false,
      reason: "not_git_repo",
      message: "无法检测 git 状态。请确认项目在 git 仓库中。",
    };
  }
}

const gitStatus = checkGitStatus();

if (!gitStatus.ready) {
  console.log(`
⚠️ Git 状态检查未通过

${gitStatus.message}

推荐操作：
${
  gitStatus.reason === "not_git_repo"
    ? '  git init && git add . && git commit -m "Initial commit"'
    : '  git add . && git commit -m "Initial commit"'
}

原因：workflow 中需要写隔离的子代理（如 Spec 合规审查、代码质量审查）依赖 git worktree
进行隔离执行。明确只读的分析/审查型子代理可以无 worktree 运行，但写隔离场景如果没有 git 仓库，仍会导致这些审查降级为
主会话内执行，损失审查独立性。
  `);

  // HARD-GATE: 不允许静默降级
  const gitChoice = await AskUserQuestion({
    questions: [
      {
        question: "请选择如何处理：",
        header: "Git 状态检查",
        multiSelect: false,
        options: [
          {
            label: "我来初始化 git",
            description: "暂停工作流，手动执行 git init + commit 后重试",
          },
          {
            label: "无子代理继续",
            description: "⚠️ 放弃子代理隔离，所有审查在主会话执行",
          },
        ],
      },
    ],
  });

  if (gitChoice === "我来初始化 git") {
    console.log("⏸️ 请初始化 git 仓库后重新执行");
    return;
  }

  // 用户显式选择了降级，记录到状态
  state.git_status = {
    initialized: false,
    subagent_available: false,
    user_acknowledged_degradation: true,
  };
  // 降级影响说明：
  // - 写隔离审查（Spec 合规、代码质量）降级为主会话内执行，损失审查独立性
  // - 只读分析/审查型子代理不受影响，仍可正常运行
  // - 执行期并行分派是否可用取决于平台能力和任务独立性，不完全由 git 状态决定
  console.log(
    "⚠️ 用户选择无子代理模式。写隔离审查将在主会话中执行，只读分析不受影响。",
  );
} else {
  state.git_status = {
    initialized: true,
    subagent_available: true,
    user_acknowledged_degradation: false,
  };
}
```

---

## Step 2: 项目配置检查与自愈（强制）

**目的**：确保 `project-config.json` 存在，保障 `project.id` 可用，状态机可初始化。

```typescript
const configPath = ".claude/config/project-config.json";

if (fileExists(configPath)) {
  const config = JSON.parse(readFile(configPath));
  const projectId = config.project.id;
  if (!validate_project_id(projectId)) {
    console.log(" project-config.json 中的项目 ID 无效，请重新执行 /scan");
    return;
  }
  console.log(` 项目配置已加载: ${config.project.name} (${projectId})`);
} else {
  console.log(" 未找到 project-config.json，正在自动生成最小配置");
  const projectId = generateStableProjectId(process.cwd());
  const projectName = path.basename(process.cwd());
  const minimalConfig = {
    project: {
      id: projectId,
      name: projectName,
      type: "single",
      bkProjectId: null,
    },
    tech: { packageManager: "unknown", buildTool: "unknown", frameworks: [] },
    workflow: { enableBKMCP: false },
    _scanMode: "auto-healed",
  };
  ensureDir(".claude/config");
  writeFile(configPath, JSON.stringify(minimalConfig, null, 2));
  console.log(` 最小配置已生成 (projectId: ${projectId})`);
  console.log(" 后续可执行 /scan --force 更新完整配置");
}

function generateStableProjectId(cwd: string): string {
  return crypto
    .createHash("md5")
    .update(cwd.toLowerCase())
    .digest("hex")
    .substring(0, 12);
}
```

> **关键变更**：不再因缺少 `project-config.json` 而阻塞。自动生成最小配置，确保 `project.id` 始终可用。

---

## Step 3: 检测现有工作流（条件执行）

检查 `~/.claude/workflows/{projectId}/workflow-state.json` 是否存在未归档的工作流。

**决策树**：

```
检测到 workflow-state.json？
│
├─ 不存在 → 继续（新建工作流）
│
└─ 存在 → 读取 status 字段
   │
   ├─ status: completed
   │   → 提示用户先归档：`/workflow archive`
   │   → 归档完成后自动继续
   │
   ├─ status: running / paused
   │   → 提示用户选择：
   │     a) 恢复当前工作流：`/workflow execute`
   │     b) 归档并新建：`/workflow archive` + 继续
   │     c) 强制覆盖（需 --force）
   │
   └─ status: failed / blocked
       → 提示用户选择：
         a) 重试：`/workflow execute --retry`
         b) 归档并新建
```

> 此步骤仅在 `/workflow start` 中执行，`/quick-plan` 等轻量命令跳过。
