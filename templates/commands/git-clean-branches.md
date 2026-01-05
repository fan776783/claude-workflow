---
description: 安全查找并清理已合并或过期的 Git 分支
allowed-tools: Bash(git *)
examples:
  - /git-clean-branches --dry-run
    预览将要清理的分支
  - /git-clean-branches --base release/v2.1 --stale 90
    清理已合并到 release 且超过 90 天的分支
  - /git-clean-branches --remote --yes
    清理远程分支（自动确认）
---

# 安全分支清理

识别并清理**已合并**或**长期未更新**的 Git 分支。默认以**只读预览**模式运行。

---

## Usage

```bash
# [最安全] 预览将要清理的分支
/git-clean-branches --dry-run

# 清理已合并到 main 且超过 90 天未动的本地分支
/git-clean-branches --stale 90

# 清理已合并到 release/v2.1 的本地与远程分支
/git-clean-branches --base release/v2.1 --remote --yes

# [危险] 强制删除未合并的本地分支
/git-clean-branches --force outdated-feature
```

### Options

| 选项 | 说明 |
|------|------|
| `--base <branch>` | 基准分支（默认 main/master） |
| `--stale <days>` | 清理超过指定天数未提交的分支 |
| `--remote` | 同时清理远程分支 |
| `--dry-run` | **默认行为**，仅列出不执行 |
| `--yes` | 跳过确认直接删除 |
| `--force` | 强制删除（即使未合并） |

---

## 执行流程

### 1. 配置与安全预检
- `git fetch --all --prune` 更新分支状态
- 读取保护分支配置
- 确定基准分支

### 2. 分析识别
- **已合并分支**：`git branch --merged <base>`
- **过期分支**：最后提交超过 N 天
- **排除保护分支**：从待清理列表移除

### 3. 报告预览
- 列出"将要删除的已合并分支"
- 列出"将要删除的过期分支"
- 若无 `--yes`，等待用户确认

### 4. 执行清理
- 本地：`git branch -d <branch>`
- 远程：`git push origin --delete <branch>`
- 强制：`git branch -D <branch>`

---

## 配置保护分支

```bash
# 保护 develop 分支
git config --add branch.cleanup.protected develop

# 保护所有 release/ 开头的分支
git config --add branch.cleanup.protected 'release/*'

# 查看所有保护分支
git config --get-all branch.cleanup.protected
```

---

## 最佳实践

- **优先 `--dry-run`**：先预览再执行
- **活用 `--base`**：维护 release 分支时指定基准
- **谨慎 `--force`**：除非确定分支无用
- **团队协作**：清理远程分支前先通知团队
- **定期运行**：每月或每季度运行一次

---

## 安全特性

- ✅ 默认只读预览
- ✅ 可配置的保护分支列表
- ✅ 支持自定义基准分支
- ✅ 逐一确认或批量确认
- ✅ 清晰的删除报告
