---
description: /knowledge-bootstrap - 初始化项目级 knowledge 骨架（.claude/knowledge/）
argument-hint: "[--force]"
---

# /knowledge-bootstrap

路由到 `knowledge-bootstrap` skill 执行骨架生成流程。

## 用法

```
/knowledge-bootstrap              # 根据 project-config.json tech.frameworks 自动判分层
/knowledge-bootstrap --force      # 即使无框架匹配，也同时生成 frontend + backend
```

## 与相关命令的关系

| 命令 | 用途 |
|------|------|
| `/scan` | 首次扫描时自动引导调用本命令 |
| `/knowledge-bootstrap` | 建立骨架 |
| `/knowledge-update` | 写入具体 code-spec 或 guide |
| `/knowledge-review` | 审查库的过期、冲突、模板升级 |
| `/knowledge-check` | 对当前 diff 跑硬卡口机读规则 |
