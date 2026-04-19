---
description: /knowledge-before-dev - 动手前显式读一遍当前 package / layer 的 knowledge 检查清单
argument-hint: "[--package <name>] [--layer <frontend|backend>] [--change-type <cross-layer|reuse|cross-platform>] [--quiet]"
---

# /knowledge-before-dev

路由到 `knowledge-before-dev` skill，对齐 Trellis `$before-dev` 的"写代码前显式读一遍"习惯。

## 用法

```
/knowledge-before-dev                                # 自动 scope：按当前 task 的 Package 或单包项目推断
/knowledge-before-dev --package <name>               # 显式指定 package
/knowledge-before-dev --package <name> --layer backend
/knowledge-before-dev --change-type cross-layer     # 顺带匹配指定 trigger 对应的 guide
/knowledge-before-dev --quiet                        # 机器模式，只输出 digest
```

## 何时用

- 一次会话刚开始，准备写这个 package 的代码
- 切换到另一个 package / layer
- 进入"跨层改动"或"常量修改"这类容易"忘了搜一遍"的动作前

## 不做的事

- 不写入 workflow 状态
- 不阻断 `/workflow-execute`
- 不强制每次切 package 都跑（自觉触发）

## 与相关命令的关系

| 命令 | 用途 |
|------|------|
| `/knowledge-before-dev` | **动手前**：读一遍现有约定 |
| `/knowledge-update` | **动手后**：沉淀新约定到 code-spec / guide |
| `/knowledge-review` | 定期体检：7 段完整性、过期、冲突 |
