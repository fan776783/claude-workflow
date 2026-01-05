---
description: 交互式回滚 Git 分支到历史版本，支持 reset/revert 模式
allowed-tools: Bash(git *)
examples:
  - /git-rollback
    全交互模式，dry-run
  - /git-rollback --branch dev
    直接选 dev 分支，其他交互
  - /git-rollback --branch dev --target v1.2.0 --mode reset --yes
    一键执行（危险）
---

# 交互式 Git 回滚

安全、可视地将指定分支回滚到旧版本。默认处于 **只读预览 (`--dry-run`)**。

---

## Usage

```bash
# 纯交互：列分支 → 选分支 → 列版本 → 选目标 → 选模式 → 确认
/git-rollback

# 指定分支，其他交互
/git-rollback --branch feature/calculator

# 指定分支与目标，用 hard-reset 一键执行（危险）
/git-rollback --branch main --target 1a2b3c4d --mode reset --yes

# 生成 revert 提交（非破坏式），预览
/git-rollback --branch release/v2.1 --target v2.0.5 --mode revert --dry-run
```

### Options

| 选项 | 说明 |
|------|------|
| `--branch <branch>` | 要回滚的分支，缺省时交互选择 |
| `--target <rev>` | 目标版本（commit/tag/reflog） |
| `--mode reset\|revert` | reset：硬回滚；revert：反向提交 |
| `--depth <n>` | 列出最近 n 个版本（默认 20） |
| `--dry-run` | **默认开启**，只预览命令 |
| `--yes` | 跳过确认直接执行 |

---

## 交互流程

1. **同步远端** → `git fetch --all --prune`
2. **列分支** → `git branch -a`（过滤受保护分支）
3. **选分支** → 用户输入或传参
4. **列版本** → `git log --oneline -n <depth>` + `git tag --merged` + `git reflog`
5. **选目标** → 用户输入 commit hash / tag
6. **选模式** → `reset` 或 `revert`
7. **最终确认**（除非 `--yes`）
8. **执行回滚**
   - reset：`git switch <branch> && git reset --hard <target>`
   - revert：`git switch <branch> && git revert --no-edit <target>..HEAD`
9. **推送建议** → 提示 `--force-with-lease`（reset）或普通 push（revert）

---

## 安全护栏

- **备份**：执行前自动在 reflog 记录当前 HEAD
- **保护分支**：检测到 main/master/production 时要求额外确认
- **--dry-run 默认开启**：防止误操作
- **禁止 --force**：如需强推，请手动执行

---

## reset vs revert

| 特性 | reset | revert |
|------|-------|--------|
| 历史 | 改变历史 | 保留历史 |
| 推送 | 需要强推 | 普通推送 |
| 协作影响 | 影响其他人 | 安全 |
| 适用场景 | 本地分支、紧急回滚 | 共享分支、保留记录 |

---

## 适用场景

| 场景 | 调用示例 |
|------|---------|
| 热修补丁上线后发现 bug | `/git-rollback --branch release/v1 --target v1.2.0 --mode reset` |
| 误推 debug 日志，需反向提交 | `/git-rollback --branch main --target 3f2e7c9 --mode revert` |
| 调研历史，浏览分支 | `/git-rollback`（全交互，dry-run） |

---

## 注意事项

- **reset** 会改变历史，需要强推，谨慎使用
- **revert** 更安全，生成新提交保留历史
- 回滚前确保 LFS/子模块状态一致
- 回滚后可能触发 CI 流水线
