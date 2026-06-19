# Workflow CLI 路径 convention

所有 `workflow-*` skill 调用的 CLI 都在固定公共路径下,**`npm install` 后始终存在**,不做动态解析:

```
~/.agents/agent-workflow/core/utils/workflow/
├── workflow_cli.js         # planning + execution 状态机的唯一写入口
├── execution_sequencer.js  # 治理决策、retry、skip
├── quality_review.js       # per-task reviewer + execute 末尾终审复用的 stage1/stage2 写入
└── task_parser.js          # 单 task 解析
```

CLI 调用统一用完整路径写命令,不要引入未导出的 shell 别名。

## CLI 写入 contract

`workflow_cli.js` 是 planning 与 execution 状态机的**唯一写入口**。绕过它手写 spec / plan / state.json 会让 `workflow-state.json` 缺失,下一会话无法恢复。`init` 子命令仅执行期自愈(状态丢失重建),规划期禁用。

`spec-review --choice` 仅接受 7 个 canonical 字符串(精确匹配,来自 `planning_gates.js`):

| canonical 字符串 | 含义 |
|---|---|
| `Spec 正确，生成 Plan` | approve,生成 plan.md 骨架并推到 `planned` |
| `Spec 正确，继续` | approve,继续 workflow |
| `需要修改 Spec` | 回到 spec 扩写(含设计修订) |
| `页面分层需要调整` | 回到 spec 扩写(UX 页面层级修订) |
| `缺少用户流程` | 回到 spec 扩写(补 User Flow) |
| `缺少需求细节` | 回到 spec 扩写,保留需求细节 |
| `需要拆分范围` | 拒绝,状态回 `idle` |

**禁止把用户原话直接塞给 `--choice`**,必须先归一化为以上字符串之一。

approve 路径自带 **spec 正文占位校验**(`lintPlaceholder`):spec.md 仍含 TBD/TODO/中文占位/未渲染 `{{}}` 时返回 `reason: spec_placeholder` + `placeholder_hits` 并拒绝 approve(占位防线在 CLI,skill 层不重扫;approve 后 spec 被编辑的场景由 `plan-review` 的 `lints.spec_placeholder` 复检兜底)。

approve 返回 `role_signals_source: persisted|rederived`:正常流程 `persisted`(复用 cmdPlan 落盘 signals);`rederived` 表示 state 缺 `context_injection.signals`、signals 由 spec 内容重派生,附 `role_signals_warning` 提示画像可能漂移。

## plan-review

`plan-review` 跑所有 lint 并算 confidence,返回 `{ ready, lints, coverage, confidence, summary, plan_file, spec_file, spec_status }`。`lints.spec_placeholder` 对 spec.md 复跑占位校验(approve 与 plan-review 之间 spec 被人工编辑引入占位时挡 ready)。

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

## task-write 的 resume 锚点重导

`task-write` 整集替换 task-dir 后,按**写后真实 task 源**核对锚点对象(`task.json`/`context.jsonl` 不动,本命令只校正 resume 锚点):

- **锚点无效**(孤儿 / 缺失 / 已 `completed`|`skipped`)→ **自动重导**,返回 `current_tasks_reseeded: {from, to}`。
- **锚点有效**(在源且未终结;`failed`/`blocked` 仍在源 = retry/unblock 目标,合法)→ **不写 state**(避免无谓 bump `updated_at` 打 stale 下游 handoff,`updated_at` 保持不动)。

**重导目标**(共享 `selectAnchorId`,state-aware):state 处于 `halted` 时**优先锚定 halt 目标**(`failure` → 源内未终结的 `failed` id,`dependency` → `blocked` id;与 `fail` 落锚、preflight retry/unblock 分流对齐——否则 halted 态会锚到 pending task,落出「status 要 retry、锚点却指向从未失败 task」的矛盾三元组);非 halted 时首个可派发 task(排除 `completed`/`skipped`/`failed`/`blocked`);无可派发 → 回退源内首个未终结的 `failed`(retry 目标)→ `blocked`(unblock 目标,按 progress 记录序);全部终结才置空。回退域**排除已终结 id**(`completed`/`skipped` 残留在 `failed`/`blocked` 的脏数据不可锚——锚上去会被 hook `current_tasks_finished` 阻断且修复不收敛)。重导落在 `failed`/`blocked` 目标时**同步对齐 `halted`**(`failure`/`dependency`)——重导/推进**写侧路径**不得落出 `running` + `failed`/`blocked` 锚点(pre-execute hook 状态门依赖此拦截派发;`advance` 末 task 的锚点回退同此规则)。例外:`retry` 路径(`execution_sequencer.js retry`)在重试窗口内合法存在 `running` + 锚点仍在 `progress.failed` 的状态——hook 恰不对 failed 锚点单独拦截,重试派发依赖此放行;该窗口由 task 完成时 `complete` 清 `failed` 收口。

回报字段:

- `current_tasks_reseeded: {from, to}` — 锚点被重导(见上)。
- `stale_progress_ids` — `progress` 含不在新 task 源的 id;**仅作人工裁决暴露,不自动清**(stale 的 `completed` id 会让被复用的同名 id 静默被排除出重导)。
- `reseed_error` — task 已写入但锚点重导失败(锁 / state 损坏 / 磁盘);跑 `repair-anchor` 修复或重跑 `task-write`,**不再静默吞错**。
- `requirement_ids_inherited` — incoming 记录**省略** `requirement_ids` 字段且旧同 id task 已带 R-ID → 自动承接旧值的 task id 列表(防整集替换静默丢 R-ID 链;显式传 `[]` 视为主动清空,不承接;重切产生的新 id 不承接,R-ID 重分配由 planner 负责)。
- `tasks_without_requirement_ids` — 写后仍无 `requirement_ids` 的 task id 列表(coverage 数据源缺口,不挡写入,提示补填)。

残留孤儿由 `plan-review` 的 `current_tasks_orphaned` hard issue 挡 ready。

## repair-anchor

```
node workflow_cli.js repair-anchor
```

reseed-only 幂等锚点修复:**不重写 task 集**(`task.json`/`context.jsonl` 原样保留),只在锚点损坏时重导 `state.current_tasks`——修复手编损坏 `state.current_tasks` 的最小手段,无需全量重跑 `task-write` / re-plan。legacy plan.md 源经 `createTaskSource` 同样适用。

- 锚点孤儿 / 缺失 / 已终结(`completed`|`skipped`)→ 按 `selectAnchorId` 重导(state-aware:`halted` 优先 halt 目标;非 halted 首个可派发 → 源内首个未终结 `failed`(retry 目标)→ `blocked`(unblock 目标);落 `failed`/`blocked` 时同步对齐 `halted`;语义同 § task-write 的重导目标),返回 `{repaired: true, from, to, current_tasks}`。
- 锚点有效,或重导结果与现状相同(含「空锚点 + 全部终结」)→ `{repaired: false, reason: 'anchor_valid', current_tasks}`,不写 state——幂等护栏:不可改善的状态不报 `repaired: true`、不反复 bump `updated_at`。
- **仅 `planned`/`running`/`halted` 可修**;`completed`/`archived` 等终态 → `{repaired: false, reason: 'status_not_repairable', workflow_status}`(task-dir 壳在完成后仍留盘,终态重导会凭空复活锚点、打破 status ↔ current_tasks 一致性)。

## write-handoff / read-handoff

跨阶段衔接摘要的读写入口,落 `handoff/{from}.md`(**按 from-phase 寻址**,`--to` 仅写入 header 作语义标注,不参与路由)。不入 state schema,覆盖式写;CLI 自动拼 5 行 freshness header(`from`/`to`/`state_updated_at`/`spec_file`/`plan_file`,值取当前 state 快照),正文 ≤20 行超限报错。

```
node workflow_cli.js write-handoff --from <spec|plan|execute> --to <phase> --content-file <path>
node workflow_cli.js read-handoff --from <spec|plan|execute>
```

`read-handoff` 比对 header 三键(`state_updated_at`/`spec_file`/`plan_file`)与当前 state:全等 → `{fresh:true, content}`;任一不符 → `{fresh:false, reason:'stale', fallback:'read-full', mismatch}`;文件缺失 → `{fresh:false, reason:'missing', fallback:'read-full'}`。

**不变量(C-4)**:`fresh:false` 是正常回退(下游按 `fallback` 读全文),**绝非错误**——任何分支不抛异常、不置 exitCode。skill 侧误把 `fresh:false` 当报错阻断属违反本 contract。

现役衔接对仅两段:`spec→plan`(workflow-spec Step 5 写,workflow-plan Step 1 读)、`plan→execute`(workflow-plan Step 3 写,workflow-execute Step 2 读)。execute 末尾终审为同会话 inline 派发,决策蒸馏直接拼进 final reviewer prompt,**不走 handoff 文件**。

## fail

`fail` 标记任务失败并把 workflow 推入 `halted/failure`——验证失败 / reviewer schema failure / review-loop 失败的**统一写入口**(取代散落各处的 state 手写)。

```
node workflow_cli.js fail <task-id> --reason "<失败原因>"
```

写入:task 状态 → `failed`、`state.status` → `halted`、`halt_reason` → `failure`、`failure_reason` = reason、`current_tasks` = `[task-id]`、`progress.failed` 追加 task-id(并从 `progress.completed` 移除避免双计)。task 不在 task 源中 → 返回错误且不改 state。

## archive

`archive` 把 `completed` workflow 落到 `history/{yearMonth}/{slug}-{timestamp}/`,snapshot `workflow-state.json` + `tasks.md` + canonical 机器 task 源 `tasks/`(每 task `task.json`/`context.jsonl`) + 迁入 `changes/CHG-*`,提交阶段删根 `workflow-state.json` / `tasks.md` / `tasks/` / `changes/`。两阶段 tombstone(`populating` → `committing`)保证崩溃可恢复:`populating` 崩 → 回滚 destDir,根目录完整保留;`committing` 崩 → forward-commit。归档后根 `tasks/` 必须清空,否则按 project-id 泄漏给下个 workflow。
