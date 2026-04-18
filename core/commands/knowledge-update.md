---
description: /knowledge-update - 交互式捕获学到的内容到 .claude/knowledge/
---

# /knowledge-update

路由到 `knowledge-update` skill 执行显式 knowledge 沉淀流程。

## 用法

```
/knowledge-update              # 交互式走 6 类片段模板
```

## 何时用

- 实现完特性后，想沉淀契约
- 修复 bug 发现隐含约束
- 做了有 tradeoff 的技术决策
- 建立了命名/组织约定

## 片段类型

- Design Decision
- Convention
- Pattern
- Forbidden Pattern（建议同时写机读规则启用硬卡口）
- Common Mistake
- Gotcha

## 与相关命令的关系

写入后可 `/knowledge-check` 本地预演，或 `/knowledge-review` 汇总检查。
