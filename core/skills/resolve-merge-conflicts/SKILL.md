---
name: resolve-merge-conflicts
description: "Resolve git merge conflicts hunk-by-hunk. Use when git reports merge conflicts (merge / rebase / cherry-pick 中出现 CONFLICT), or user says '解决冲突' / 'merge conflict' / '合并冲突' / 'rebase 卡住了' / 'cherry-pick 冲突'. 保留双方意图,不发明新行为,永不 --abort。"
---

<CONTEXT>
纯 git 操作,不强制读 code-specs / glossary。涉及架构级冲突(接口签名 / 模块边界)时 Read `core/specs/shared/architecture-language.md`。
</CONTEXT>

# Resolve Merge Conflicts

逐 hunk 解决 git merge 冲突。核心纪律:**保留双方意图,不发明新行为,永不 `--abort`**。

## workflow

### 1. 看状态

跑 `git status` 确认:
- 是 merge / rebase / cherry-pick 哪种?
- 哪些文件有冲突(unmerged paths)?
- 有没有已经解决的?

### 2. 找每个冲突的主源

对每个冲突文件,用 `git log --oneline --merge` 或 `git log --left-right` 找出冲突 hunk 各自来自哪个分支 / commit。理解**双方各自想干什么**——不是看代码猜,是看 commit message + diff 理解意图。

### 3. 逐 hunk 解决

对每个 `<<<<<<<` ... `=======` ... `>>>>>>>` 块:

- **保留双方意图** — 两边都要的东西都留;一边要的东西只留那一边
- **不发明新行为** — 只解决冲突,不顺手重构 / 加功能 / 改逻辑
- **冲突是语义不是语法** — 标记块是工具,真相在意图里。两边语义矛盾时问用户,不要瞎选

解决后删掉所有冲突标记。

**禁止**:
- `git merge --abort` / `git rebase --abort`(放弃 = 丢失工作)
- `git checkout --theirs` / `--ours` 批量选边(跳过理解)
- 解决冲突时夹带私货(重构 / 改名 / 加注释)

### 4. 跑自动检查

解决完所有冲突后:
- `git add <已解决文件>`
- 跑项目的自动检查(test / lint / build,看项目配置)
- 检查失败 → 回 Step 3 修,不 force

### 5. 完成

- merge → `git commit`(用默认 merge message 或按项目规范写)
- rebase → `git rebase --continue`
- cherry-pick → `git cherry-pick --continue`
- 跑一次最终检查确认无遗留冲突标记: `git diff --check`

## 何时问用户

- 冲突双方语义真正矛盾(不是格式差异)→ 问用户要哪边
- 冲突涉及超过 3 个文件且跨多个领域 → 先汇报全貌再动手
- 自动检查反复失败且原因不在冲突本身 → 停下汇报
