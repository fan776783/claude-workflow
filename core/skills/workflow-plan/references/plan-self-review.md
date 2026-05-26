# Plan Self-Review

> Plan 扩写完成后调 `node workflow_cli.js plan-review`,CLI 自动跑所有 lint + 算 confidence。本文档只描述 ready 判定矩阵与各 lint 含义。
> 语义正确性验证(task 是否真的解决需求)推迟到执行阶段的 Verification Iron Law。

## CLI 入口

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js plan-review
```

返回 JSON:`{ ready, lints, coverage, confidence, summary, plan_file, spec_file }`。

`confidence` = `{ score, level, breakdown{prd_coverage,patterns,verification,test_task}, hints[] }`。**confidence 偏低时直接读 `hints`**——每个未达标/被封顶维度给一行可执行提升项(如 `patterns=0` → "需 ≥3 个 `### 标题` 各紧跟一行 `// SOURCE: <file>`")。不要 grep `plan_composer.js` 的 `scoreConfidence` 逆向打分公式;rubric 是实现细节,以 `hints` 为准。`test_task=0` 的 hint 为中性提示,纯手动验证 plan 可忽略,**不要为凑分造测试任务**。

## ready 判定矩阵

| Lint | 硬 block ready? | 计入 confidence? |
|------|-------------|------------------|
| `lints.placeholder.hits`(`TBD` / `TODO` / 中文占位 / 模板残留) | ✅ 是 | — |
| `coverage.uncovered_ids`(spec 有 plan 无) | ✅ 是 | — |
| `coverage.partial_ids`(spec 多处提及 plan 仅 1 task) | ❌ 否 | ✅ PRD 维度扣 1 分 |
| `lints.anchor_integrity`(v2 plan,orphans + missing,Phase B 后启用) | ✅ 是 | — |
| `lints.anchor_integrity`(v1 plan 无锚点) | ❌ 否 | ❌ 不挡 |
| `lints.mandatory_reading`(声明区块且有不合规行,Phase C) | ✅ 是 | — |
| `lints.mandatory_reading`(完全无该区块) | ❌ 否 | ❌ 不挡(小 plan 合法) |
| `lints.command_syntax.issues`(Phase C) | ❌ 否 | ✅ verification 维度封顶,无加分 |
| `lints.pattern_fidelity.unresolved`(Phase C) | ❌ 否 | ✅ patterns 维度封顶,无加分 |
| `lints.type_consistency.pairs`(Phase C) | ❌ 否 | ❌ 完全不进 rubric(假阳性后患) |
| `lints.atomicity.warnings` | ❌ 否 | ❌ 不扣 |

## 各 lint 含义

- **placeholder** — 见 [`no-placeholders.md`](no-placeholders.md)
- **coverage** — spec 内 `R-\d{3,}` ID 集合 vs plan 内 task `需求 ID:` 字段引用集合
- **anchor_integrity** — `<!-- WF:ANCHOR:<id>:(begin|end) -->` 配对完整性
- **mandatory_reading** — 仅校验 Mandatory Reading 表行的 `Lines` 列格式（不查文件存在性，那是 `pattern_fidelity` 的事）。`file:lineStart-lineEnd` 行号**可选**（implementer 自读定位，planner 不必为补行号去读源码）：留空 = 合规，仅当 Lines 列填了非空值且格式不是 `N` / `N-M` 才算违规。缺行号不挡 ready
- **command_syntax** — `验证命令` 字段语法校验(括号/管道闭合);路径在 Files to Change 表里
- **pattern_fidelity** — `Patterns to Mirror` 区块的 `// SOURCE: file:lines` 引用存在性
- **type_consistency** — 跨 task 类似命名符号(`clearLayers` vs `clearFullLayers`)。预过滤短符号 / 大小写等价 / 词序重排 / 数字结尾。
- **atomicity** — Task N≥5 子项必拆 sub-task 规则

## 修复后

`ready=true` 后,Step 3 直接 paste `summary` + `confidence` + `coverage` 字段给用户。无需人工扫 plan。
