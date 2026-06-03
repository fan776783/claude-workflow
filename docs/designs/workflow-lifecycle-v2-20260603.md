# workflow 生命周期优化方案 v2（修正版）

> 日期：2026-06-03 · 状态：待评审 · 类型：跨 skill + runtime 架构调整
> 前置：本方案为对初版「workflow 生命周期优化方案」的代码核对修正，并经一轮 grill 锁定 5 项决策。所有诊断均已对照 `core/utils/workflow/*.js` / `core/skills/workflow-*/SKILL.md` / `core/specs/` 验证，文末附证据行号。

## 已锁决策（grill 2026-06-03）

| # | 决策 | 取值 |
|---|---|---|
| 1 | 本轮 scope | **全量 P0-P4 同一 /workflow-spec 走完**，不分批 |
| 2 | rich 正文形态 | **结构化进 `task.json` v2**（唯一权威）；`task.md` 仅渲染产物，execute 逐字注入、lint 读 json，**不回解析 markdown** |
| 3 | 末任务终审 gate | **留 execute SKILL Step 7 inline prose**，`advance` 契约不改；不进 CLI |
| 4 | v1 task-dir 兼容 | **不兼容**：execute 入口检测 `schema_version < 2` → 报错引导重 plan / archive；无双路径、无 task-bundle 回退 |
| 5 | delta 废弃任务 | **移出 task 集合彻底消失**（`replaceAllTasks` 清孤儿）；变更留痕只在 `changes/CHG-*`，task 源不留 deprecated 态 |

## 修正后的问题陈述

机器 task 源声明为 task-dir（`state-machine.md:150`），但 task-dir 物理只承载 `normalizeTaskRecord` 的 11 项 metadata；执行所需的 rich 正文（task_text / critical_constraints / Patterns to Mirror / Mandatory Reading / files）由 planner 经 `plan-edit` 写进 **plan.md 锚点**，并由 `plan_composer` 的 lint / confidence 套件解析 plan.md。

真实 break 不是「execute 还在调 task-bundle」——`workflow-execute/SKILL.md:61,169` **已声明**从 `TaskSource.listTasks()` 取全切片、不调 task-bundle。break 是 **task-dir 根本没有 SKILL 承诺的那些字段**（`TaskDirSource.listTasks()` → `taskStore.normalizeTaskRecord` 不含 constraints/patterns/mandatory/task_text/files）→ 按 SKILL 走，implementer 静默丢护栏。这是「文档超前于数据」的漂移，外加三处旧模型残留：

1. **delta 改动到不了 task-dir**：`workflow-delta/SKILL.md:166-169` 手动 Edit plan.md；`cmdDeltaApply` 唯一 task 写入走 `state.plan_file`（写 plan.md/tasks.md）且被恒空的 `task_deltas` 门住（`delta_archive_cmds.js:171-180` + `plan_delta.js:42`）= 死代码 → delta 新任务对执行不可见。
2. **archive 漏清 task-dir**：`cmdArchive:428-429` 只 snapshot `tasks.md`；`finalizeArchiveCommit:359-374` 不删根 `tasks/` → 残留 task-dir 按 project-id 泄漏给下个 workflow（幽灵 task）。
3. **status 文档谎报**：`cmdList` 无 `actions` 字段（`workflow-status/SKILL.md:37` 谎报）；`migrate-state` 命令不存在（`SKILL.md:47` 指向幽灵命令）。

**目标**：task-dir 成为名副其实的唯一机器源（含正文），plan-review lint 改读 task-dir，plan.md 真正降为叙述，delta / archive 收口到 task-dir，legacy plan.md 保兼容读。

---

## 关键设计决策

### D1：rich 字段进 task.json v2 结构化，task.md 仅作「渲染产物」不回解析（锁定 2）

反对初版「全塞 markdown task.md」——那把 `task_bundle.js` 那 200+ 行脆弱正则（`parsePatternBullet` / `parseMandatoryReadingBullet` / `extractBulletSection`）请回来，违背 task-dir 取代 plan.md 解析的初衷。改为：

- `task.json` 新增结构化字段：`files[]`、`patterns[]`（`{file,line,note}`）、`mandatory_reading[]`（`{path,reason,symbols[],line_hint}`）、`constraints[]`（string）、`task_text`（正文 string）。机器消费者（lint / write-scope guard / 注入）一律读结构化字段。
- `task.md` = workflow-plan 从 task.json 渲染的人类可读切片，execute **逐字注入** implementer prompt，**不回解析**。缺失可由 task.json 重渲染 → 非致命。
- 净效果：彻底删除 markdown → fields 的解析路径；plan-review lint 改读 task.json（见 P3）。

### D2：delta 改 task 走 `task-write` 整集重写，删 cmdDeltaApply 死写入（锁定 5）

现状 `cmdDeltaApply` 的 task 变更走 `state.plan_file`（写 plan.md）且被恒空的 `task_deltas` 门住 = 死代码（`delta_archive_cmds.js:171-180` + `plan_delta.js:42`）。改为：workflow-delta SKILL 计算更新后的**完整 task 数组** → `task-write --from-file`（`replaceAllTasks` 已原子 + 保活 context.jsonl + 清孤儿）；`delta apply` 只留审计推进 + blocked 反查（已正确读 task-dir，`delta_archive_cmds.js:32-35`）。废弃任务 = 不在新集合里 → `replaceAllTasks` 自动清孤儿（含其 context.jsonl）彻底消失，不引入 `deprecated` 状态；变更留痕只在 `changes/CHG-*`。`task_deltas` 降为审计计数或移除。

### D3：末任务终审 gate 留 SKILL prose，advance 契约不改（锁定 3）

CLI 无法真核验终审是否发生（`--evidence` 只是个串，是假强制）。本轮**不动 `advance`**：末任务 → completed 的终审继续由 execute SKILL Step 7 inline review 把守（`quality-gate` 的 in-session 确认语义不变）。

CLI 侧只做一项写入口收敛——`fail`（P0.3）：把验证失败 / reviewer schema failure / review-loop 失败的写入口统一到主 CLI。`accept-deviation` 已接好（`workflow_cli.js:812-820`，带 `--confirmed` hard stop）且已隐藏，无需改 CLI；execute SKILL 终审分支补「用户 accept 残留偏离时调它」的 prose 即可。

---

## Scope 排序

| 阶段 | 内容 | 风险 | 依赖 | 可独立合入 |
|---|---|---|---|---|
| **P0 清洁项** | archive 清 task-dir、status 文档修正、`fail` proxy、hook guard 放开 | 低 | 无 | ✅ 各自独立 |
| **P1 schema v2** | task.json v2 字段 + task.md 读写 + 版本标记 + v1 execute 阻断 | 中 | 无 | ✅ |
| **P2 plan/execute 闭环** | planner 写 v2、execute 读 task.md 切片、task-bundle 收窄 legacy | 中 | P1 | ❌ 依 P1 |
| **P3 lint 迁移** | lintMandatoryReading / lintPatternFidelity / confidence 改读 task.json | 中高 | P1,P2 | ❌ 依 P2 |
| **P4 delta 收口** | workflow-delta SKILL 改 task-write、删死写入 | 中 | P1 + P2.1 | ❌ 依 P1 + P2.1 |

本轮全量走完（锁定 1）。P0 各项独立可先合止血。P1 → P2 → P3 为主链，必须同批，否则 confidence 门控失效。P4 依赖 P1 + P2.1 的 v2 authoring 约定（delta 也要结构化作者 rich 字段），不能在 P2.1 前并行。

---

## P0：清洁项（低风险，优先合入）

### P0.1 archive 清 task-dir
- `delta_archive_cmds.js:cmdArchive` Phase 1：snapshot 时把根 `tasks/` 目录整体 copy 进归档目标 `destDir/tasks/`（与 `tasks.md`/`changes/` 并列）。归档落点为代码实际的 `history/{yearMonth}/{slug}-{timestamp}/`（注：glossary `archive` 条目写的 `archive/` 与代码不符，属 glossary 漂移，单独修）。
- `finalizeArchiveCommit:359-374`：在删 state/tasks.md/changes 后，新增删根 `workflowDir/tasks/`。
- `cmdArchive` summary（`:448`）增 `已归档 task-dir 任务数`。
- **验收**：archive 后 `getTasksRoot(pid)` 不存在；同 pid 新建 workflow 时 `createTaskSource` 返回 null（无幽灵 task）；归档目录含 `tasks/{Tn}/task.json`。

### P0.2 status 文档修正
- `workflow-status/SKILL.md:37`：删 `actions`，改为实际字段 `id / name / phase / status / emoji / target_layer / package`。
- `SKILL.md:47`：删 `workflow_cli.js migrate-state`（命令不存在）。如需旧文件升级，改述「CLI 读取时自动投影 legacy 状态，无需手动迁移」。
- **验收**：文档字段与 `cmdList` 输出（`task_manager.js:184+`）逐项一致。

### P0.3 `fail` 收口到 workflow_cli.js
- `workflow_cli.js` dispatch 加 `else if (command === 'fail')` → 代理 `cmdFail(args[0], option(args,'--reason'), pid, projectRoot)`（`cmdFail` 已存在 `task_manager.js:261`，目前仅经次级 CLI `task_manager.js` 可达）。
- 加进 `TOP_LEVEL_USAGE` + `SUBCOMMAND_HELP`。统一验证失败 / reviewer schema failure / review-loop 失败写入口。
- **验收**：`fail T3 --reason "..."` 把 task 置 `failed` + workflow 入 `halted/failure`（与 task_manager.js 行为一致）；`workflow-cli.md` 契约补 `fail`。

### P0.4 pre-execute-inject guard 放开
- `pre-execute-inject.js:276-277`：`!state.plan_file` 硬 block 改为「无 task 源（`createTaskSource` 返回 null）才 block」。plan.md 既已可选，不得因 plan_file=null 拦 task-dir-only 流程。
- **验收**：task-dir-only（plan_file=null）workflow 能正常注入执行上下文，不被拦。

---

## P1：task.json schema v2 + task.md

### P1.1 schema 升级（`task_store.js`）
- `normalizeTaskRecord` 加 `schema_version`（v1 缺省视为 1，写入恒 2）+ 新字段 `files[]` / `patterns[]` / `mandatory_reading[]` / `constraints[]` / `task_text`，各自带 normalize（结构化、缺省退化为 `[]`/`''`，不破坏 shell 形态）。
- unknown 字段透传保留（测试要求「不误丢」）。
- **验收**：v2 round-trip 读写一致；`schema_version:2` 且 task.md + 结构化字段全缺 → 明确 error（非静默）。

### P1.2 task.md 读写（`task_store.js`）
- 新增 `getTaskMdPath` / `writeTaskMd` / `readTaskMd`（原子写，缺失返回 `''` 容错）。task.md 不进 `normalizeTaskRecord`，是独立正文文件。
- **验收**：写后可读；缺失不抛。

### P1.3 v1 task-dir execute 阻断（锁定 4：不兼容，强制重 plan）
- **读写隔离**：`createTaskSource` / `cmdList` / `cmdStatus` / `cmdProgress` 等只读命令照常读 v1 task-dir（让用户看到要重 plan 的内容）。
- **阻断单点**：v1 检测只放在 execute 唯一入口 `buildExecuteEntry`（`execution_sequencer.js:89`）——检测 `schema_version < 2` → 返回结构化 blocker `{error:'task_dir_schema_v1', hint:'本版本不兼容 v1 task-dir，请用 workflow_cli plan --force 全量重 plan（会重置已完成 task 的 progress）或 /workflow-archive'}`，不进 implementer 派发。`pre-execute-inject` hook **不重复判 schema**，只沿用 P0.4 的「无 task 源才 block」（避免 hook + CLI 双写易漂移）。
- **升级路径**：唯一可靠的 v1→v2 全量升级是 `plan --force`（`plan_composer.js:953` 对 running 状态需 `--force`，全量重生 task-dir）。**不指 /workflow-delta**——delta 只重写变更涉及的 task，未变更的仍 v1，无法整集升级。
- **不做** v1→plan.md 的 task-bundle 回退、不做双 execute 路径。
- **已知代价**：`plan --force` 全量重生 task-dir → 已完成 task 的 status/progress 重置；部署时机自控、在途量可控。
- **验收**：v1 task-dir 走 execute → 拿到 `task_dir_schema_v1` blocker（仅 `buildExecuteEntry` 产出，hook 不产）；status/list 仍能列出 v1 task；`plan --force` 后产出 v2 task-dir 可正常执行。

---

## P2：plan / execute 闭环

### P2.1 planner 写 v2（`plan_composer.js` + `workflow-plan/SKILL.md`）
- **planner SKILL 流程重写（blocker）**：`workflow-plan/SKILL.md:116` 现指示「生成 Patterns to Mirror / Mandatory Reading 区块」写进 plan.md 锚点（经 plan-edit）；`:64,90` 的 `task-write` 只写 metadata。v2 必须改为：rich 内容（patterns/mandatory/constraints/files/task_text）随 metadata 一起进 `task-write` 的 JSON 整集（task.json v2 字段），并渲染 task.md；plan-edit 退为可选叙述扩写。**否则 planner 仍往 plan.md 写、task.json 仍是空壳，P2/P3 全部落空。**
- `plan_composer.js`：`createTaskShellsFromCoverage`（`:780`）输出对齐 v2 schema；`task-write` 帮助文本（`workflow_cli.js:623-631`）+ `cmdTaskWrite` 校验补 v2 5 字段（`normalizeTaskRecord` 接住后透明转发）。
- plan.md `{{tasks}}` 体（`buildNarrativeTasksBody:808`）保持纯叙述（已是）。
- **验收**：plan 完成后 task.json 含 patterns/mandatory/constraints/files/task_text；plan.md 无结构化 task block；plan-review 仍 `ready:true`。

### P2.2 execute 读 task.md 切片（`workflow-execute/SKILL.md` + `pre-execute-inject.js`）
- Step 1 controller 从 task-dir 取全切片（含 task.md 正文 + 结构化字段），SKILL prose 与实际字段对齐（删除「从 listTasks 拿 constraints/patterns」的失真描述，明确来源 = task.json v2 + task.md）。
- implementer prompt 注入 task.md 正文 + 结构化 patterns/mandatory（`prompts/implementer.md` 模板）。
- **验收**：v2 流程 implementer 收到 constraints/patterns/mandatory，全程不读 plan.md、不调 task-bundle。

### P2.3 task-bundle 收窄到仅 legacy plan.md（`task_bundle.js` + `workflow_cli.js`）
- `task-bundle` 输出加 `legacy:true`；检测到 task-dir（v2）时返回提示并不参与执行路径。
- 从 `TOP_LEVEL_USAGE:675` 的标准路径描述移除/标注 legacy；execute SKILL Step 5.1.0 引用清理。
- 仅 `LegacyPlanMdSource`（无 task-dir 的旧 plan.md workflow）保留可用（其 rich 正文仍靠 plan.md，本轮不动）。
- **验收**：v2 workflow 调 task-bundle 得 legacy 提示；legacy plan.md workflow 仍可用。

---

## P3：plan-review lint 迁移（最易漏，必须同批）

### P3.1 lint 改读 task.json（`plan_composer.js`）
- `lintMandatoryReading`（T16, `:1369-1426`）：从解析 plan.md `## Mandatory Reading` 改为遍历 task.json `mandatory_reading[]`，校验 `line_hint` 格式。
- `lintPatternFidelity`（T18, `:1426+`）：从 plan.md `// SOURCE: file:lines` 改为校验 task.json `patterns[].file`/`line` 引用真实存在。
- confidence breakdown（`:698-704`）：patterns/mandatory 维度打分改读 task.json 计数。
- `plan-review` 输出的 `lints.task_schema` 扩展校验 v2 新字段。
- **golden 时序**：迁移**前**先快照现 plan.md-based 的 confidence/ready 输出为 golden 基准（P2 末执行），P3 改完逐项比对，避免无基准误判等价。
- **验收**：plan-review 对 v2 task-dir 给出与旧 plan.md 等价的 confidence/ready 矩阵（golden 对比）；patterns=0 / mandatory 缺失 hint 仍触发。

> ⚠️ 此阶段是初版把「review 代码」当 unrelated 推迟的盲区。lint 不迁 = confidence 门控读空叙述 plan.md，恒过/恒低，readiness gate 失效。**不可省。**

---

## P4：delta 收口 task-dir

### P4.1 workflow-delta SKILL 改写（`workflow-delta/SKILL.md:166-169`）
- Step 6.1：新增/修改/废弃任务从「Edit plan.md task block」改为「计算更新后完整 task 数组 → `task-write --from-file`」。**废弃 = 移出集合**（`replaceAllTasks` 自动清孤儿，含 context.jsonl），不置 deprecated 态。
- delta 算「完整 task 数组」时同样要结构化作者 patterns/mandatory/constraints（复用 P2.1 的 v2 authoring 约定），否则 task-write 出的 task.json 缺 rich 字段，execute 退化 → 故 P4 依赖 P2.1。
- plan.md 叙述同步为**可选**，失败不影响机器源。
- **验收**：delta 新增/修改后 `next/list/progress/execute` 立即读到变化；废弃任务从 task 源消失、仅 `changes/CHG-*` 留痕。

### P4.2 删 cmdDeltaApply 死写入（`delta_archive_cmds.js:171-180` + `plan_delta.js:42`）
- 移除 `resolveStateAndTasks` → 写 `tasksPath` 的 plan.md task 变更分支（恒空死代码）。`delta apply` 只保留审计推进 + blocked 反查（`listSourceTasks` 已读 task-dir，不动）。
- `task_deltas` 字段：降为 impact 审计计数或删除。
- **验收**：`delta apply` 不再触碰 plan.md/tasks.md；blocked 恢复逻辑不回归。

---

## 受影响文件清单

| 文件 | P | 改动 |
|---|---|---|
| `core/utils/workflow/task_store.js` | P1 | v2 字段 + normalize + task.md 读写 + schema_version |
| `core/utils/workflow/task_source.js` | P1 | 返回完整 slice；不加 v1 回退 |
| `core/utils/workflow/execution_sequencer.js` | P1 | `buildExecuteEntry` 检测 `schema_version<2` 阻断（**v1 唯一阻断点**） |
| `core/utils/workflow/plan_composer.js` | P2,P3 | 写 v2 + 渲染 task.md + lint/confidence 改读 task.json |
| `core/utils/workflow/task_bundle.js` | P2 | `legacy:true`，仅服务 legacy plan.md |
| `core/utils/workflow/workflow_cli.js` | P0,P2 | `fail` proxy + task-bundle help legacy + task-write help 补 v2 字段（**advance 不改**；v1 阻断在 execution_sequencer） |
| `core/utils/workflow/delta_archive_cmds.js` | P0,P4 | archive 清 task-dir + 删 delta 死写入 |
| `core/utils/workflow/plan_delta.js` | P4 | `task_deltas` 降级/移除 |
| `core/utils/workflow/task_manager.js` | P0 | （`cmdFail` 已存在，仅被 workflow_cli 复用） |
| `core/hooks/pre-execute-inject.js` | P0,P2 | guard 放开（无 task 源才 block，不判 schema）+ 注入 task.md 正文 |
| `core/skills/workflow-plan/SKILL.md` | P2 | **现写阶段 rich 内容改 `task-write` 入 task.json（非 plan.md 锚点，`:116`）+ 渲染 task.md** |
| `core/skills/workflow-execute/SKILL.md` | P2 | prose 对齐真实 slice + 终审分支调 accept-deviation（gate 仍 inline） |
| `core/skills/workflow-delta/SKILL.md` | P4 | Step 6.1 改 task-write、废弃=移出集合 |
| `core/skills/workflow-status/SKILL.md` | P0 | 删 actions / migrate-state |
| `core/specs/workflow-runtime/state-machine.md` | P1 | task.json v2 + task.md schema + v1 不兼容说明 |
| `core/specs/workflow-runtime/task-dir-schema.md` | P1 | **升级到 v2**（文件已存在）：补 v2 5 字段 + schema_version + execute v1 阻断规则 |
| `core/specs/shared/workflow-cli.md` | P0,P2 | `fail` 契约 / task-bundle legacy（advance 不变） |

---

## 测试矩阵

- **P1 schema**：v2 round-trip；unknown 字段不丢；`schema_version:2` 且 task.md + 结构化字段全缺 → 明确 error。
- **P1 v1 阻断**：v1 task-dir 走 execute → `task_dir_schema_v1` blocker；status/list 对 v1 仍正常列出（读写隔离）。
- **P2 闭环**：plan → task.json 含 rich 字段；execute v2 流程 implementer 收齐 constraints/patterns/mandatory 且不读 plan.md；plan → execute → 末任务 Step 7 终审 PASS → completed → archive 后根 `tasks/` 清干净、归档目录含 task-dir。
- **P3 lint**：同一 task 集，task.json 路径与旧 plan.md 路径产出等价 confidence/ready（golden）；patterns/mandatory 缺失 hint 触发。
- **P4 delta**：add/modify 后 `next/list/progress/execute` 读到变化；废弃任务从 task 源消失、`changes/CHG-*` 留痕；`delta apply` 不写 plan.md；blocked 恢复不回归。
- **写入口**：`fail T3 --reason` → `halted/failure`。
- **legacy 兼容**：无 task-dir 的 plan.md workflow 仍经 `LegacyPlanMdSource` 执行（task-bundle 仅此场景可用）。

---

## 兼容与回滚

- **两类源并存**：v2 task-dir（task.json v2 + task.md，唯一前进路径）/ legacy plan.md（`LegacyPlanMdSource`，冻结兼容读）。**v1 task-dir 不作为可执行源**——execute 入口阻断、引导重 plan。探测优先级：task-dir 非空 → 读 `schema_version`（execute 时 <2 阻断）；空 → legacy plan.md；皆无 → `task_source_missing`。
- **advance 契约不变**：末任务行为、终审 gate 全留 SKILL 层；无 CLI 契约变更、无调用方/测试回归面（相比初版砍掉一处风险）。
- **回滚**：P0 各项独立可单独 revert；P1-P3 同批 revert（schema 与 lint 绑定）；P4 独立。`schema_version` 让旧 CLI 读 v2 task.json 时新字段被忽略（向后读安全）。

---

## 本轮明确不做

- review / journal / budget 中与 task 源**无耦合**的旧兼容代码。
- task.md 富语法 / 双向编辑（task.md 只读注入，不回解析）。
- legacy plan.md → task-dir 的自动迁移工具，及 v1 task-dir → v2 的自动升级器（v1 一律重 plan）。
- `advance` final-review 的 CLI 强制门（终审留 SKILL prose）。

---

## 附：诊断证据索引

| 论断 | 证据 |
|---|---|
| task-dir 只存 metadata，无 rich 正文 | `task_store.js:50-64`（`normalizeTaskRecord` 字段集）、`plan_composer.js:775-803`（薄壳写入） |
| rich 正文只在 plan.md | `task_bundle.js:301-312`（从 plan.md block 抠 constraints/patterns/mandatory） |
| execute SKILL 已超前声明 | `workflow-execute/SKILL.md:61,169,385` |
| delta 写 plan.md / task_deltas 死代码 | `delta_archive_cmds.js:171-180`、`plan_delta.js:42`、`workflow-delta/SKILL.md:166-169` |
| archive 漏清 task-dir | `delta_archive_cmds.js:428-429`（snapshot）、`:359-374`（finalize 不删 tasks/） |
| status 文档谎报 | `cmdList`（`task_manager.js:184+`，无 actions）、`workflow-status/SKILL.md:37,47`、`workflow_cli.js` dispatch 无 migrate-state |
| accept-deviation 已接好且已隐藏 | `workflow_cli.js:812-820`、`TOP_LEVEL_USAGE:662` / `SUBCOMMAND_HELP:577` 均无 |
| fail 已存在但仅次级 CLI 可达 | `task_manager.js:261,389`、`shared-utils.md:44`；`workflow_cli.js` dispatch 无 fail |
| hook 硬卡 plan_file | `pre-execute-inject.js:276-277` |
| 机器源声明 = task-dir | `state-machine.md:150` |
| task.md 全仓无引用（确属新增） | `grep -rln 'task\.md' core` 无果 |
| task-dir-schema.md **已存在**（v1），P1 升级 v2 | `core/specs/workflow-runtime/task-dir-schema.md`（4177B）；`workflow-plan/SKILL.md:8,18` + `workflow_cli.js:631` 引用 |
| planner 现写 rich 内容入 plan.md 锚点（blocker 锚点） | `workflow-plan/SKILL.md:116`（生成 Patterns/Mandatory 区块）、`:64,90`（task-write 仅 metadata） |
| glossary archive 路径与代码不符 | glossary `archive` 条目写 `archive/`，`cmdArchive` 实际落 `history/{yearMonth}/` |
