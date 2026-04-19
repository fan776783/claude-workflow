---
description: /knowledge-review - 审查 knowledge 库的 7 段完整性、过期、冲突与 canonical 对账
argument-hint: "[--check-upgrade]"
---

# /knowledge-review

路由到 `knowledge-review` skill 执行只读审查。

## 用法

```
/knowledge-review                  # 全量审查，生成报告到 .claude/reports/
/knowledge-review --check-upgrade  # 仅做 canonical / manifest 对账
```

## 输出

- 7-Section Lint（missing / draft / abstract 段级检查）
- Stale files（>30 天、>90 天）
- Conflicts 与 broken pointers（guides 指向失效 / layer index 错配 / 字段冲突）
- Canonical & Manifest 升级差异

## 与相关命令的关系

- 不修改文件
- 结果建议驱动 `/knowledge-update` 补全段内容或 `/knowledge-bootstrap --reset` 重建
