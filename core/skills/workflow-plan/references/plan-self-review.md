# Plan Self-Review

> Plan 扩写完成后调 `node workflow_cli.js plan-review`,CLI 自动跑所有 lint + 算 confidence。本文档只描述 ready 判定矩阵与各 lint 含义。
> 语义正确性验证(task 是否真的解决需求)推迟到执行阶段的 Verification Iron Law。

## CLI 入口

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js plan-review
```

返回 JSON:`{ ready, lints, coverage, confidence, summary, plan_file, spec_file, spec_status, project_id }`。`spec_status`（`ok` 之外的值挡 ready）。

`confidence` = `{ score, level, breakdown{prd_coverage,patterns,verification,test_task}, hints[] }`。**confidence 偏低时直接读 `hints`**——每个未达标/被封顶维度给一行可执行提升项(如 `patterns=0` → "需 ≥3 条 task.json `patterns[]`")。`test_task=0` 的 hint 为中性提示,纯手动验证 plan 可忽略,**不要为凑分造测试任务**。

> ⛔ **禁逆向引擎**(HARD-GATE #4):不要 Read/grep `core/utils/workflow/*.js`(`plan_composer.js` 的 `scoreConfidence` 打分公式、`task_store.js` 的写函数等)——rubric / 写入实现都是细节。打分提升以 `hints` 为准,写 task-dir 用 `task-write`/`context-curate`(schema 见 [`../../../specs/workflow-runtime/task-dir-schema.md`](../../../specs/workflow-runtime/task-dir-schema.md)),查签名用 `<cmd> --help`。CLI 不满足 → halt 报错,不自写 `.cjs` 绕过(`guard-engine-source` hook 会 deny)。

## ready 判定矩阵

| Lint | 硬 block ready? | 计入 confidence? |
|------|-------------|------------------|
| `lints.placeholder.hits`(plan.md 内 `TBD` / `TODO` / 中文占位 / 模板残留) | ✅ 是 | — |
| `lints.spec_placeholder.hits`(spec.md approve 后复检,防 approve 与 plan-review 之间 spec 被编辑引入占位) | ✅ 是 | — |
| `coverage.uncovered_ids`(spec 有 plan 无) | ❌ 否(advisory,T8/FR-7 降级) | ✅ PRD 维度计分 |
| `coverage.partial_ids`(spec 多处提及 plan 仅 1 task) | ❌ 否 | ✅ PRD 维度扣 1 分 |
| `lints.anchor_integrity`(v2 plan,orphans + missing) | ✅ 是 | — |
| `lints.anchor_integrity`(v1 plan 无锚点) | ❌ 否 | ❌ 不挡 |
| `lints.mandatory_reading`(已声明 `mandatory_reading[]` 且有不合规 `line_hint`) | ✅ 是 | — |
| `lints.mandatory_reading`(无任何 task 声明 `mandatory_reading[]`) | ❌ 否 | ❌ 不挡(小 plan 合法) |
| `lints.command_syntax.issues` | ❌ 否 | ✅ verification 维度封顶,无加分 |
| `lints.pattern_fidelity.unresolved` | ❌ 否 | ✅ patterns 维度封顶,无加分 |
| `lints.atomicity.warnings` | ❌ 否 | ❌ 不扣 |
| `lints.task_schema.issues`(task-dir:非法 id 目录 / task.json 不可解析 / status 越界 / `empty_task_source` 空源 / `current_tasks_orphaned` resume 锚点孤儿 / `current_tasks_empty` 锚点缺失而源有未终结 task(failed/blocked 算未终结;repair-anchor/task-write 重导会回退锚到 retry/unblock 目标)) | ✅ 是 | — |
| `lints.task_schema.warnings`(`name` 空 / `acceptance` 空) | ❌ 否 | ❌ 不挡(兼容 spec-approve 落壳未填态;**task-write 之后仍非空 = task 现写漏项,回 `task-write` 补全再重跑 plan-review,不得带 warnings 交付 Step 3**) |

## 各 lint 含义

- **placeholder** — 见 [`no-placeholders.md`](no-placeholders.md)
- **coverage** — spec 内 `R-\d{3,}` ID 集合 vs plan 内 task `需求 ID:` 字段引用集合
- **anchor_integrity** — `<!-- WF:ANCHOR:<id>:(begin|end) -->` 配对完整性
- **mandatory_reading** — 校验 task.json `mandatory_reading[]` 各项 `line_hint` 格式（不查文件存在性，那是 `pattern_fidelity` 的事）。行号**可选**（implementer 自读定位，planner 不必为补行号去读源码）：留空 = 合规，仅当 `line_hint` 填了非空值且格式不是 `N` / `N-M` 才算违规。缺行号不挡 ready
- **command_syntax** — task.json `verification.commands` 轻量语法校验(括号/引号/管道闭合)
- **pattern_fidelity** — task.json `patterns[]` 的 `file` 引用存在性 + `line` 范围校验(行号可选,填了才查)
- **atomicity** — Task N≥5 子项必拆 sub-task 规则

## 修复后

`ready=true` 后,Step 3 直接 paste `summary` + `confidence` + `coverage` 字段给用户。无需人工扫 plan。
