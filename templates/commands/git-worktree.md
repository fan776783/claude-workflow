---
description: 管理 Git worktree，支持智能路径、IDE 集成和内容迁移
allowed-tools: Bash(git *, which, basename, dirname, cp, ls)
examples:
  - /git-worktree add feature-ui
    从 main/master 创建新分支 'feature-ui'
  - /git-worktree add feature-ui -o
    创建并直接用 IDE 打开
  - /git-worktree list
    显示所有 worktree 状态
  - /git-worktree migrate feature-ui --from main
    迁移未提交内容
---

# Git Worktree 管理

管理 Git worktree，使用结构化的 `../.ccg/项目名/` 路径。

---

## Usage

```bash
# 基本操作
/git-worktree add <path>                    # 从 main/master 创建新分支
/git-worktree add <path> -b <branch>        # 创建指定名称的新分支
/git-worktree add <path> -o                 # 创建并用 IDE 打开
/git-worktree list                          # 显示所有 worktree
/git-worktree remove <path>                 # 删除 worktree
/git-worktree prune                         # 清理无效记录

# 内容迁移
/git-worktree migrate <target> --from <source>  # 迁移未提交内容
/git-worktree migrate <target> --stash          # 迁移 stash 内容
```

### Options

| 选项 | 说明 |
|------|------|
| `add [<path>]` | 在 `../.ccg/项目名/<path>` 添加 worktree |
| `migrate <target>` | 迁移内容到指定 worktree |
| `list` | 列出所有 worktree 及状态 |
| `remove <path>` | 删除指定 worktree |
| `prune` | 清理无效引用 |
| `-b <branch>` | 创建新分支并检出 |
| `-o, --open` | 创建后用 IDE 打开 |
| `--from <source>` | 指定迁移源路径 |
| `--stash` | 迁移 stash 内容 |
| `--track` | 跟踪远程分支 |
| `--detach` | 创建分离 HEAD |

---

## 执行流程

### 1. 环境检查
- `git rev-parse --is-inside-work-tree` 验证 Git 仓库
- 检测是否在主仓库或现有 worktree 中

### 2. 智能路径管理
```bash
# 核心路径计算逻辑
get_main_repo_path() {
  local git_common_dir=$(git rev-parse --git-common-dir)
  local current_toplevel=$(git rev-parse --show-toplevel)

  if [[ "$git_common_dir" != "$current_toplevel/.git" ]]; then
    # 在 worktree 中，推导主仓库路径
    dirname "$git_common_dir"
  else
    # 在主仓库中
    echo "$current_toplevel"
  fi
}

MAIN_REPO_PATH=$(get_main_repo_path)
PROJECT_NAME=$(basename "$MAIN_REPO_PATH")
WORKTREE_BASE="$MAIN_REPO_PATH/../.ccg/$PROJECT_NAME"
```

### 3. Worktree 操作
- **add**：创建新 worktree，智能分支/路径默认
- **list**：显示所有 worktree 的分支和状态
- **remove**：安全删除并清理引用
- **prune**：清理孤立记录

### 4. 环境文件处理
- 自动检测 `.gitignore` 中的 `.env` 模式
- 智能复制（排除 `.env.example`）
- 保持原始权限和时间戳

### 5. IDE 集成
- 自动检测：VS Code → Cursor → WebStorm → Sublime → Vim
- `-o` 标志跳过询问直接打开
- 可通过 git config 自定义

---

## 目录结构

```
parent-directory/
├── your-project/            # 主项目
│   ├── .git/
│   └── src/
└── .ccg/                    # worktree 管理
    └── your-project/
        ├── feature-ui/      # 功能分支
        ├── hotfix/          # 修复分支
        └── debug/           # 调试 worktree
```

---

## 内容迁移

```bash
# 迁移未提交改动
/git-worktree migrate feature-ui --from main

# 迁移 stash 内容
/git-worktree migrate feature-ui --stash
```

**迁移流程**：
1. 验证源有未提交内容
2. 确保目标 worktree 干净
3. 显示即将迁移的改动
4. 安全迁移
5. 确认结果

---

## IDE 配置

```bash
# 配置自定义 IDE
git config worktree.ide.custom.sublime "subl %s"
git config worktree.ide.preferred "sublime"

# 控制自动检测
git config worktree.ide.autodetect true
```

---

## 安全特性

- **路径冲突防护**：创建前检查目录
- **分支检出验证**：确保分支未被使用
- **绝对路径强制**：防止嵌套问题
- **删除时自动清理**：同时清理目录和引用

---

## 注意事项

- **性能**：worktree 共享 `.git` 目录，节省空间
- **迁移限制**：仅限未提交改动，已提交用 `git cherry-pick`
- **IDE 要求**：命令行工具必须在 PATH 中
- **跨平台**：支持 Windows、macOS、Linux
