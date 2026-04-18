---
description: /knowledge-review - 审查 knowledge 库的过期、冲突、覆盖率及模板升级
---

# /knowledge-review

路由到 `knowledge-review` skill 执行只读审查。

## 用法

```
/knowledge-review              # 全量审查，生成报告到 .claude/reports/
```

## 输出

- Stale files（>30 天、>90 天）
- Conflicts（重复 id、pattern 重叠、kind 冲突）
- Template upgrades pending（canonical 模板变化）
- Coverage（各层 filled/draft 统计）

## 与相关命令的关系

- 不修改文件
- 结果建议驱动 `/knowledge-update` 补充或清理
- 与 `/knowledge-check` 分工：review 是只读、长周期；check 是硬卡口、每次 review 必跑
