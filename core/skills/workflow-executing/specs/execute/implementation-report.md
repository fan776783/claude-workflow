# Implementation Report 规范

> 工作流完成时自动生成的实施报告，对比计划与实际。

## 何时生成

当所有 task 标记为 `completed`（或 `skipped`），在工作流状态变为 `completed` 之前生成。

## 输出路径

`.claude/reports/{task-name}-report.md`

## 报告结构

```markdown
# Implementation Report: [功能名称]

## Summary

[实际完成了什么]

## Assessment vs Reality

| Metric        | Plan     | Actual                             |
| ------------- | -------- | ---------------------------------- |
| Tasks         | [计划数] | [实际完成/跳过/失败]               |
| Files Changed | [计划数] | [实际数]                           |
| Duration      | —        | [首个 task 到最后 task 的时间跨度] |

## Tasks Completed

| #   | Task   | Status       | Deviations   |
| --- | ------ | ------------ | ------------ |
| T1  | [名称] | ✅ completed | —            |
| T2  | [名称] | ✅ completed | 偏离：[原因] |
| T3  | [名称] | ⏭️ skipped   | [跳过原因]   |

## Validation Summary

| Check      | Last Result        |
| ---------- | ------------------ |
| Tests      | [pass/fail + 数量] |
| Type Check | [pass/fail]        |
| Lint       | [pass/fail]        |

## Quality Gate Results

| Gate      | Verdict         | Issues Found |
| --------- | --------------- | ------------ |
| [task ID] | [passed/failed] | [问题数]     |

## Deviations from Plan

[偏差汇总，或 "None"]

## Files Changed

| File   | Action           | Lines |
| ------ | ---------------- | ----- |
| `path` | CREATED/MODIFIED | +N/-M |
```

## 数据来源

- `workflow-state.json`：task 状态、quality_gates、progress
- `plan.md`：原始任务定义
- `git diff`：实际变更统计
- Journal entries：关键决策和问题

## 注意

- 报告为只读总结，不触发新的审查或修复
- 生成后增加到 `workflow-state.json` 的 `report_path` 字段
