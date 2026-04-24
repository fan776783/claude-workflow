# Phase 7 协调分支重建

`bug-batch` Phase 7 的 git 操作与边界处理细节。

## 1. 为什么是重建而不是 revert

Phase 5.5.2 已经把每个 FixUnit 以独立 `[bug-batch-stage] <unit_id>:` commit 落在协调分支上。用户在 Phase 7 拒绝某个单元时，直觉做法是 `git revert`，但这样不安全：

当 FU-002 修改的代码依赖 FU-001 的修改时，单独 revert FU-001 会抹掉 FU-002 所依赖的上下文，让 FU-002 运行失败或产生未定义行为。FixUnit 之间可能有隐性顺序依赖，revert 不知道这些依赖。

真正安全的做法是"从物化前的基线重建"——从 `pre_bug_batch_base`（首个 stage commit 之前的协调分支 HEAD）拉一条临时分支，只把确认单元 cherry-pick 上去，未确认单元天然不在其中。

`pre_bug_batch_base` 必须在 5.5.2 物化开始**之前**就记录下来，Phase 7 依赖这个值。

## 2. 重建步骤

顺序严格，任一步失败进入对应 Hard Stop。

### Step 1 — 备份协调分支

- 记录当前 HEAD SHA 到 `coord_branch_before_rebuild`
- 创建备份引用 `refs/backup/bug-batch-<timestamp>`，重建失败可以从这里恢复

### Step 2 — 拉临时重建分支

从 `pre_bug_batch_base` 创建 `bug-batch/rebuild-<timestamp>` 并切到该分支。

### Step 3 — 按序 cherry-pick 确认单元

按 `confirmed_units` 的原 `materialization_order`，逐个 cherry-pick 对应的 `[bug-batch-stage] <unit_id>:` commit。

- 冲突或验证失败触发 `[HARD-STOP:REBUILD-CONFLICT]`，展示冲突文件、FixUnit 对、关联缺陷，让用户在"放弃冲突方 / 手动解决 / 整体放弃"中选一个
- 选择"放弃冲突方"时：若该冲突单元是其他单元的 `covered_by_unit`，必须先执行 coverage-graph.md 第 3 节的失败级联，再从 `confirmed_units` 移除
- 每次 cherry-pick 成功后运行 `validation_scope` 中可自动化的验证命令

### Step 4 — squash 为单一 commit

```
git reset --soft <pre_bug_batch_base>
git commit -m "fix: <issue_numbers> 修复了 <摘要>"
```

### Step 5 — 改写前审计

改写协调分支引用之前强制校验三项，任一不满足立即 `[HARD-STOP:BRANCH-REWRITE]`：

- **提交集合审计**：`pre_bug_batch_base..coord_branch_before_rebuild` 之间的 commit 集合必须**完全等于** `materialization_order` 记录的 stage commit 集合；出现任何非 `[bug-batch-stage]` 的额外 commit（他人在 Phase 5 期间推入）→ Hard Stop，把额外 commit 清单展示给用户
- **工作区干净**：工作区有未提交改动 / 未跟踪文件 / 未合并冲突 → Hard Stop，由用户手动清理后重试；禁止 auto-stash 绕过
- **分支保护**：协调分支受保护（保护规则、需 linear history、已推送到远端 main 等）→ Hard Stop，由用户决定手动 push 策略

### Step 6 — 改写协调分支引用

审计全部通过才执行。**本地和远端视为一个整体事务，但回滚策略按失败位置条件执行**——不是所有失败都能安全地自动回滚本地。

#### 6a. 本地 CAS ref 更新

```
git update-ref refs/heads/<coord_branch> <rebuild_branch_HEAD> <coord_branch_before_rebuild>
```

命令对本地 ref 原子。本地 tip 已漂移会返回非零 → 直接 `[HARD-STOP:BRANCH-REWRITE]`，无需回滚（本地还没改）。

#### 6b. 判断是否需要推送

协调分支是纯本地分支，或用户显式选择稍后手动 push → 跳过 6c，直接到 6e。

#### 6c. 远端 lease push

```
git push --force-with-lease=refs/heads/<coord_branch>:<coord_branch_before_rebuild> \
         <remote> <rebuild_branch_HEAD>:refs/heads/<coord_branch>
```

- `<remote>` 必须显式写出（通常是 `origin`），不得依赖 `push.default` / upstream 配置
- `--force-with-lease` 的 refspec 必须是完整的 `refs/heads/<coord_branch>:<coord_branch_before_rebuild>`，约束远端旧 tip 没有前进
- 推送源是本地 `<rebuild_branch_HEAD>` 对象（SHA），目标是远端 `refs/heads/<coord_branch>`

**成功** → 进入 6e。

**失败** → push 返回失败不代表远端没更新（网络断开或服务端写入后连接中断都会这样）。先用 `git ls-remote <remote> refs/heads/<coord_branch>` 核对远端真实 tip：远端仍是 `<coord_branch_before_rebuild>` → 反向 `update-ref` 回滚本地后 `[HARD-STOP:BRANCH-REWRITE]`；远端已是 `<rebuild_branch_HEAD>` → 伪失败，保留本地继续 6e；其它或读不到 → `[HARD-STOP:BRANCH-REWRITE]` 让用户人工确认，**不要自动回滚**，以免本地远端都被改乱。

反向回滚命令：`git update-ref refs/heads/<coord_branch> <coord_branch_before_rebuild> <rebuild_branch_HEAD>`。若连反向 update-ref 都失败（本地 ref 被并发修改），触发 `[HARD-STOP:BRANCH-REWRITE]`，让用户从 `refs/backup/bug-batch-<timestamp>` 手动恢复。

#### 6d. 禁止项

- `git branch -f` / `git reset --hard` / `git push --force` 等非原子或非 lease 的写操作
- "失败就无条件回滚"——没有读取远端真实状态之前不能动本地 ref

#### 6e. 工作树同步

前面步骤全部成功后：

```
git checkout <coord_branch>
git reset --hard HEAD
```

### Step 7 — 清理

- 删除 `bug-batch/rebuild-<timestamp>` 临时分支
- 保留 `refs/backup/bug-batch-<timestamp>` 至 Phase 8 结束后 7 天

### Step 8 — 追溯记录

所有 `[bug-batch-stage]` commit SHA（含未确认单元的）和备份引用名写入 Phase 8 汇总，供人工追溯。

## 3. `[HARD-STOP:BRANCH-REWRITE]` 触发清单

完整触发条件：

- `pre_bug_batch_base..coord_branch_before_rebuild` 范围内存在非 `[bug-batch-stage]` 的额外 commit
- stage commit 集合与 `materialization_order` 不完全一致（多或少）
- 工作区不干净（有未提交改动、未跟踪文件、未合并冲突）
- 协调分支受保护或已推送到远端且远端策略禁止强推
- 协调分支不是当前仓库 HEAD 指向，或正处于 detached HEAD 状态
- 本地 `git update-ref` 返回非零（本地 tip 已前进）
- 远端 `git push --force-with-lease` 被拒绝且远端真实状态无法确认

## 4. Commit message 格式

```
fix: <issue_number_1> <issue_number_2> ... 修复了 <问题摘要>
```

- 固定前缀 `fix:`
- 缺陷编号列表：仅包含实际进入本次 commit 的 `confirmed_units` 所覆盖的 `included_issues` 与 `duplicate_issues` 的 `issue_number`，空格分隔
- 问题摘要：一句话概括本次批量修复内容

示例：

```
fix: p328_7489 p328_7488 p328_7490 修复了登录态刷新失效和会话过期问题
```
