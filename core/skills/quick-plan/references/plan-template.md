# Plan Template

quick-plan Step 3 产出的 `.claude/plans/{name}.plan.md` 模板。

```markdown
# Plan: [功能名称]

## Summary

[2-3 句概述]

## Metadata

- **Complexity**: Small | Medium | Large
- **Confidence**: N/10
- **Estimated Files**: N 个
- **Key Risk**: [主要风险]

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0       | ...  | ...   | ... |

## Patterns to Mirror

### [模式名称]

// SOURCE: [file:lines]
[代码库中的真实代码片段]

---

## Files to Change

| File           | Action        | Justification |
| -------------- | ------------- | ------------- |
| `path/to/file` | CREATE/UPDATE | 说明          |

---

## Tasks

### T1: [名称]

- **Action**: 具体操作
- **File**: `path/to/file`
- **Mirror**: [引用上方的模式]
- **Verify**: [验证命令]

### T2: [名称]

...

---

## Testing Strategy

- [测试计划]

## Risks

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| ...  | ...        | ...        |
```

## 填充规则

- **Summary**：2-3 句说"这个 plan 要做什么 + 为什么现在做"，不是功能清单
- **Mandatory Reading**：只列实施时真的要读的文件，不要为了显得认真堆无关文件。P0 = 必读，P1 = 背景。
- **Patterns to Mirror**：必须引用真实代码片段（带 `// SOURCE: file:lines`），不要生成想象中的模式
- **Tasks**：每个任务颗粒度以"一个 commit 大小"为目标；Verify 必须可执行（测试命令 / grep / 编译）
- **Risks**：列真实风险不列模板式风险（"代码可能有 bug"这种无意义项不写）
