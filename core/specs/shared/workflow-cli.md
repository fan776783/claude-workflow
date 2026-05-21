# Workflow CLI 路径 convention

所有 `workflow-*` skill 调用的 CLI 都在固定公共路径下,**`npm install` 后始终存在**,不做动态解析:

```
~/.agents/agent-workflow/core/utils/workflow/
├── workflow_cli.js         # planning + execution 状态机的唯一写入口
├── execution_sequencer.js  # 治理决策、retry、skip
├── quality_review.js       # workflow-review 用的 stage1/stage2 写入
└── task_parser.js          # 单 task 解析
```

CLI 调用统一用完整路径写命令,不要引入未导出的 shell 别名。

## CLI 写入 contract

`workflow_cli.js` 是 planning 与 execution 状态机的**唯一写入口**。绕过它手写 spec / plan / state.json 会让 `workflow-state.json` 缺失,下一会话无法恢复。`init` 子命令仅执行期自愈(状态丢失重建),规划期禁用。

`spec-review --choice` 仅接受 5 个 canonical 字符串(精确匹配,来自 `planning_gates.js`):

| canonical 字符串 | 含义 |
|---|---|
| `Spec 正确，生成 Plan` | approve,生成 plan.md 骨架并推到 `planned` |
| `Spec 正确，继续` | approve,继续 workflow |
| `需要修改 Spec` | 回到 spec 扩写(含设计修订) |
| `缺少需求细节` | 回到 spec 扩写,保留需求细节 |
| `需要拆分范围` | 拒绝,状态回 `idle` |

**禁止把用户原话直接塞给 `--choice`**,必须先归一化为以上字符串之一。

## plan-review

`plan-review` 跑所有 lint 并算 confidence,返回 `{ ready, lints, coverage, confidence, summary, plan_file, spec_file, spec_status }`。

```
node workflow_cli.js plan-review
```

ready 判定矩阵见 [`../../skills/workflow-plan/references/plan-self-review.md`](../../skills/workflow-plan/references/plan-self-review.md)。

## plan-edit

`plan-edit` 是 v2 plan(`version: 2` front matter)锚点级 section 替换的唯一写入口,绕过 OS 级整文件覆盖以保护 `<!-- WF:ANCHOR:<id>:(begin|end) -->` 配对。

```
node workflow_cli.js plan-edit --anchor <id> --content-file <path> \
  [--mode replace_between|replace_full] \
  [--allow-legacy] [--allow-anchor-change]
```

| 参数 | 含义 |
|---|---|
| `--anchor <id>` | 必填。目标锚点 ID(如 `tasks` / `task:T3` / `file_structure`) |
| `--content-file <path>` | 必填。替换内容文件(避免 shell 参数注入与 `$&` metachar 展开) |
| `--mode replace_between` | 默认。仅替换 `begin` / `end` 之间的内容,保留锚点行 |
| `--mode replace_full` | 连同锚点行整段替换;必须带 `--allow-anchor-change` |
| `--allow-legacy` | v1 plan(无 `version:2`)整文件覆盖,失去锚点保护;默认拒绝 |
| `--allow-anchor-change` | 显式确认 `replace_full` 模式 |

写入前校验:锚点配对完整性 / `state.current_tasks` 不被孤立 / CRLF 兼容。任一失败拒绝写入并返回错误码,不静默 no-op。
