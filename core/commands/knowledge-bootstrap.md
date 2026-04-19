---
description: /knowledge-bootstrap - 初始化项目级 knowledge 骨架（.claude/knowledge/）
argument-hint: "[--force] [--reset]"
---

# /knowledge-bootstrap

路由到 `knowledge-bootstrap` skill 执行骨架生成流程。

## 用法

```
/knowledge-bootstrap              # 根据 project-config.json monorepo.packages × tech.frameworks 生成 {pkg}/{layer}/ 布局；project.type=monorepo 但未写 monorepo.packages 时，自动从 pnpm-workspace.yaml / package.json workspaces / lerna.json 解析 workspace 列表
/knowledge-bootstrap --force      # 即使无框架匹配，也同时生成 frontend + backend
/knowledge-bootstrap --reset      # 破坏性：清空已有 .claude/knowledge/ 并重建（用于切换到新布局）
```

## 与相关命令的关系

| 命令 | 用途 |
|------|------|
| `/scan` | 首次扫描时自动引导调用本命令 |
| `/knowledge-bootstrap` | 建立骨架 |
| `/knowledge-update` | 写入具体 7 段 code-spec 或 thinking guide |
| `/knowledge-review` | 审查 7 段完整性、过期、冲突、canonical 对账 |
