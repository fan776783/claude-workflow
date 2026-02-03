# Quick Review Mode (--quick)

适用于日常快速检查，Claude 单模型审查。

## 流程

### Step 1: 获取 Diff

```bash
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

```markdown
# Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | CORRECT / INCORRECT |
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
```

## Verdict 规则

| 场景 | Verdict |
|------|---------|
| 无 P0/P1 | CORRECT |
| 任一 P0 | INCORRECT |
| 多个 P1 | INCORRECT |
