---
description: /knowledge-check - 对当前 diff 跑 knowledge 机读规则，workflow-review 硬卡口依赖
argument-hint: "[--base-commit <sha>] [--format json|text]"
---

# /knowledge-check

路由到 `knowledge-check` skill 执行硬卡口检查。

## 用法

```
/knowledge-check                              # 检查 working tree 相对 HEAD
/knowledge-check --base-commit {sha}          # 指定 diff 区间
/knowledge-check --format text                # 人类可读摘要
```

## 行为

- 扫描 `.claude/knowledge/` 下的 `## Machine-checkable Rules`
- 对比 git diff 的新增行
- blocking 违规退出码 2，compliant 退出码 0

## 与相关命令的关系

- `workflow-review` Stage 1 Step 0 自动调用
- `/knowledge-update` 新增 Forbidden 规则后可用本命令本地预演
- 无 knowledge 或无机读规则 → 总是 compliant（对新项目零摩擦）
