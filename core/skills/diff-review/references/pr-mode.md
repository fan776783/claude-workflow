# PR Review Mode (--pr)

审查 GitHub PR，复用现有 impact-aware 审查管线。

## 执行原则

- PR 模式是 Quick/Deep 的**审查对象扩展**，不是独立审查标准
- 审查管线（finding verification + impact analysis + severity calibration）完全复用
- 报告结构遵循 `../specs/report-schema.md`

## 流程

### Phase 1: PR Resolution

解析 `--pr` 参数：

| 输入                                         | 解析            |
| -------------------------------------------- | --------------- |
| `--pr 42`                                    | PR number `#42` |
| `--pr https://github.com/owner/repo/pull/42` | 提取 PR number  |

### Phase 2: PR Context Acquisition

```bash
# 获取 PR 元信息
gh pr view <number> --json title,author,baseRefName,headRefName,body,labels,reviewDecision

# 获取 PR diff
gh pr diff <number>

# 获取变更文件列表
gh pr diff <number> --name-only
```

### Phase 3: File Classification

沿用 Deep 模式的前后端分类（见 `deep-mode.md` Layer B）。

### Phase 4: Candidate Finding + Verification + Impact

根据是否附带 `--quick`，选择 Quick 或 Deep 模式的候选问题发现流程：

- **有 `--quick`**：Quick 模式候选发现（当前模型单独审查）
- **默认 / `--deep`**：Deep 模式候选发现（Codex + 当前模型并行）

之后完全复用共享管线：

- Finding Verification（5 步验证）
- Impact Analysis（遵循 `../specs/impact-analysis.md`）
- Severity Calibration

### Phase 5: Report Synthesis

按 `../specs/report-schema.md` 输出报告，Summary 新增 PR-specific 字段：

| Field       | Value              |
| ----------- | ------------------ |
| Review Mode | Quick PR / Deep PR |
| PR          | `#<number>`        |
| Author      | `<author>`         |
| Branch      | `<head> → <base>`  |

### Phase 6: Publish

通过 `gh` CLI 发布审查结论：

```bash
# Verdict = CORRECT → APPROVE
gh pr review <number> --approve --body "<审查摘要>"

# Verdict = INCORRECT → REQUEST_CHANGES
gh pr review <number> --request-changes --body "<审查报告>"

# Draft PR → 仅 COMMENT，不 approve/request
gh pr review <number> --comment --body "<审查报告>"
```

对 P0/P1 问题可添加 inline comments：

```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments \
  --field body="<问题描述>" \
  --field path="<file>" \
  --field line=<line>
```

### Phase 7: Review Loop

与本地模式相同：

- 报告输出后默认停止，等待用户显式确认并输入 `fix` 或 `skip`
- `fix` → 按方案修复 → push → 重新审查
- `skip` → 结束
- 最多 3 轮

## 前置检查

PR 模式需要 `gh` CLI 已认证：

```bash
gh auth status
```

若未认证，提示用户运行 `gh auth login` 后重试。
