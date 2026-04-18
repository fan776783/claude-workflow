---
name: knowledge-check
description: "对比当前 diff 与 .claude/knowledge/ 的机读规则，判断是否存在 blocking 违规。workflow-review 硬卡口依赖此命令。触发条件：用户调用 /knowledge-check，或 workflow-review Stage 1 预检自动调用。"
---

# /knowledge-check

knowledge 硬卡口的机器执行入口。本命令不修改任何文件，只返回合规性结果。

## 执行方式

```bash
node ~/.agents/agent-workflow/core/utils/workflow/knowledge_compliance.js check \
  --project-root "$(pwd)" \
  --base-commit "<sha>" \
  --format json | text
```

- 无 `--base-commit`：默认对比 HEAD 的 working tree diff
- `--format json`：结构化输出，供 workflow-review CLI 消费
- `--format text`：人类可读，供用户手动跑

## 规则来源

扫描 `.claude/knowledge/` 下所有 code-spec 文件的 `## Machine-checkable Rules` section。只有符合下列语法的规则会参与卡口：

```yaml
id: {{unique_rule_id}}
severity: blocking | warning
kind: forbid | require | warn
pattern: "{{regex}}"
applies_to: "**/*.ts"   # 可选，默认所有变更文件
message: "{{human_readable_reason}}"
```

- `forbid` + `blocking` → 命中 diff 新增行即阻塞 review
- `forbid` + `warning` / `kind: warn` → 仅警告
- `require` + `blocking` → 对 applies_to 匹配的变更文件，整体不含 pattern 即阻塞
- `guides/` 下的规则不参与（guides 只做思考清单）
- `local.md`、`index.md` 不参与

## 输出

```json
{
  "compliant": true,
  "rules_count": 5,
  "checked_files": 3,
  "violations": [
    {
      "file": "src/api.ts",
      "line": 42,
      "rule": "forbid-any-type",
      "knowledge_source": "frontend/types.md",
      "severity": "blocking",
      "message": "禁止使用 any 类型"
    }
  ],
  "warnings": [],
  "base_commit": "<sha>"
}
```

退出码：
- `0` — compliant
- `2` — 有 blocking 违规
- `1` — CLI 使用错误

## 用法

```
/knowledge-check                              # 检查当前 working tree 相对 HEAD
/knowledge-check --base-commit {sha}          # 检查指定区间
/knowledge-check --format text                # 人类可读摘要
```

## 与其他命令的关系

- `workflow-review` Stage 1 Step 0 调用本 CLI，blocking 违规会让质量关卡回 `revise`
- `/knowledge-update` 新增规则后可本地跑一次预演
- 无 knowledge 目录、无机读规则 → 永远 compliant（对新项目零摩擦）

## 注意

- 不做 AI 理解，只做 regex / 关键字匹配
- `applies_to` 使用 glob，经 `globToRegex()` 转换为正则
- 规则语法错误（非法正则、缺字段）会被静默过滤，不抛异常
