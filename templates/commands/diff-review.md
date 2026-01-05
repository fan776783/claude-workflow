---
description: 快速代码审查 - 无参数时自动审查 git diff HEAD
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git *)
examples:
  - /diff-review
  - /diff-review --staged
  - /diff-review --branch main
---

# 快速代码审查

## Usage

`/diff-review [OPTIONS]`

## Behavior

- **无参数**: 自动审查 `git diff HEAD`（staged + unstaged）
- **--staged**: 仅审查已暂存变更
- **--branch <base>**: 审查相对 base 分支的变更

## Process

### Step 1: 获取 Diff

```bash
# 无参数时执行
git diff HEAD
git status --short
```

### Step 2: 审查

按以下标准识别问题：
1. 影响准确性、性能、安全性或可维护性
2. 问题具体且可操作
3. 是本次变更引入的（非预先存在）
4. 如认为破坏其他部分，必须找到具体受影响代码

**忽略**: 琐碎风格、纯格式、拼写、文档补充

### Step 3: 输出报告

## Output Format

```markdown
# Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | ✅ CORRECT / ❌ INCORRECT |
| Confidence | 0.XX |

**Explanation**: <1-3 句>

---

## Findings

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<路径>` |
| Lines | <start>-<end> |

<问题说明>

```suggestion
<可选修复代码>
```
```

## Priority

| 级别 | 含义 |
|------|------|
| P0 | 阻塞发布 |
| P1 | 应尽快处理 |
| P2 | 最终需修复 |
| P3 | 有则更好 |

## Notes

- 快速日常检查，Claude 单模型
- 重要功能/PR 提交前建议用 `/diff-review-deep`
