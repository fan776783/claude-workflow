---
description: /knowledge-update - 交互式捕获学到的内容到 .claude/knowledge/
---

# /knowledge-update

路由到 `knowledge-update` skill 执行显式 knowledge 沉淀流程。

## 用法

```
/knowledge-update              # 交互式走 7 段 code-spec 或 thinking guide 流程
```

## 何时用

- 实现完特性后，想沉淀契约
- 修复 bug 发现隐含约束
- 做了有 tradeoff 的技术决策
- 建立了命名 / 组织约定

## 写入位置

| 类型 | 位置 | 内容形态 |
|------|------|---------|
| Code-Spec（怎么写） | `{pkg}/{layer}/*.md` | 7 段合约：Scope / Signatures / Contracts / Validation & Error Matrix / Good-Base-Bad Cases / Tests Required / Wrong vs Correct |
| Thinking Guide（写代码前想什么） | `guides/*.md` | 检查清单 + 指向 code-spec |

## 与相关命令的关系

写入后可 `/knowledge-review` 跑一次 7 段 lint，确认各段都填充完整。
