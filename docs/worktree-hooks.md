# Worktree 串行化 Hook

## 问题背景

Claude Code 的 `isolation: "worktree"` 功能让每个 subagent 在独立的 git worktree 中运行，避免多个 agent 同时修改同一个文件。

然而，当多个 subagent **并行启动**时，多个 `git worktree add` 命令会竞争 `.git/config.lock`，导致创建失败：

```
error: could not lock config file .git/config: File exists
error: unable to write upstream branch configuration
```

**上游 Bug**：[anthropics/claude-code#34645](https://github.com/anthropics/claude-code/issues/34645)

## 解决方案

通过 Claude Code 的 `WorktreeCreate` / `WorktreeRemove` 生命周期钩子，在 `git worktree add` 执行前获取排他锁，确保同一时刻只有一个 worktree 创建操作在进行。

### 核心机制

| 组件 | 作用 |
|------|------|
| `worktree-serialize.js` | `WorktreeCreate` 事件 hook，使用 mkdir 原子锁串行化创建 |
| `worktree-cleanup.js` | `WorktreeRemove` 事件 hook，执行 `git worktree prune`、回收 `.claude/worktrees/` 下的孤立目录并释放锁 |

### 锁设计

- **位置**：`<git-common-dir>/worktree-serialize.lock/`（目录锁）
- **原子性**：`mkdir` 在所有平台上都是原子操作
- **过期策略**：锁创建后 10 秒自动过期（覆盖一次 `git worktree add`）
- **总超时**：30 秒后强制放行，避免永久阻塞
- **退避策略**：指数退避 + 随机抖动（300ms ~ 2s）
- **PID 检测**：同机器时检查持锁进程是否存活

## 安装

### 自动安装（推荐）

运行全局安装（如 `agent-workflow sync` 默认全局模式）时会自动：
1. 将 hook 脚本同步到 Claude Code 托管目录下的 `.agent-workflow/hooks/`
2. 注入配置到 `~/.claude/settings.json`
3. 若检测到历史遗留的旧 hook 路径（如 `~/.claude/hooks/...`），会自动修正为当前托管路径

> `WorktreeCreate` / `WorktreeRemove` hooks 属于默认自动注入能力。
> workflow hooks 请参考单独文档：[`workflow-hooks.md`](workflow-hooks.md)

### 项目级安装

项目级安装会同步 hook 脚本目录，但**默认跳过** `settings.json` 注入。
这是因为 Claude Code 的 Worktree hooks 读取的是用户级 `~/.claude/settings.json`；
项目级安装不应擅自修改全局用户配置。

如需启用，请按下方“手动安装”步骤自行添加。

### 手动安装

如果自动注入未生效，手动添加到 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"$HOME/.claude/.agent-workflow/hooks/worktree-serialize.js\""
        }]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"$HOME/.claude/.agent-workflow/hooks/worktree-cleanup.js\""
        }]
      }
    ]
  }
}
```

> **注意**：路径必须使用 `$HOME` 或绝对路径（如 `/Users/你的用户名/...`），不能使用 `~`。
> 因为 `node "~/.../file.js"` 中 `~` 在双引号内不会被 Shell 展开，会导致路径解析失败。

如需启用 workflow hooks，请参考单独文档：[`workflow-hooks.md`](workflow-hooks.md)

### 孤立目录回收

`WorktreeRemove` hook 不会强制删除任意传入路径；它只会：

1. 执行 `git worktree prune`
2. 回收仓库内 `.claude/worktrees/` 下**未被 Git 注册**的孤立目录
3. 释放串行化锁

这样可以降低残留目录概率，同时避免误删用户手动创建或非 Claude Code 默认托管位置的 worktree。

## 故障排查

### 检查 hook 是否注册

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

### 清理残留锁

如果 worktree 创建被阻塞：

```bash
# 查找 git common dir
git rev-parse --git-common-dir

# 删除锁目录
rm -rf $(git rev-parse --git-common-dir)/worktree-serialize.lock

# 清理孤立 worktree
git worktree prune
```

### 检查 worktree 状态

```bash
git worktree list
```

### 日志

hook 的诊断信息输出到 stderr，可在 Claude Code 的日志中查看：

- `[worktree-serialize] 获取锁超时(30000ms)，强制放行` — 超时放行
- `[worktree-cleanup] 错误: ...` — 清理失败

## 移除

从 `~/.claude/settings.json` 中删除 `WorktreeCreate` 和 `WorktreeRemove` 条目即可。

## 技术细节

本方案是上游 Bug 的 **workaround**，待 Anthropic 修复 [#34645](https://github.com/anthropics/claude-code/issues/34645) 后可移除。

参考实现：[fredericboyer/dev-team#482](https://github.com/fredericboyer/dev-team/pull/482)
