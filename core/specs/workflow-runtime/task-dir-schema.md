# task-dir Schema (v2)

> 📌 **Canonical Source**：机器 task 源（task-dir）的写入 contract。`workflow-plan` 经 CLI 写、`workflow-execute`/`workflow-delta` 读。CLI 实现见 `core/utils/workflow/task_store.js` `normalizeTaskRecord`——**本文件即 contract，不要读 task_store.js 源码反推**。

机器 task 源 = `~/.claude/workflows/{pid}/tasks/{Tn}/`，每个 task 一个目录：

```text
tasks/
├── T1/
│   ├── task.json       # 元数据 + v2 rich 执行字段（本文件 schema）
│   ├── task.md         # v2 人读执行正文（从 task.json 渲染，execute 逐字注入 implementer；不回解析）
│   └── context.jsonl   # 可选 per-task 背包，每行 {file,reason}
└── T2/ ...
```

> **v1 → v2**：v2 把执行所需 rich 正文（`files`/`patterns`/`mandatory_reading`/`constraints`/`task_text`）收进 task.json 结构化字段（取代旧版散在 plan.md 锚点、execute 期 task-bundle 解析的脆弱路径）。`schema_version` 标记版本：**execute 入口对 `< 2` 的 task-dir 硬阻断**（`reason: task_dir_schema_v1`），引导 `workflow_cli plan --force` 全量重 plan 或 archive——本版本不兼容 v1 task-dir，无回退路径。只读命令（status/list）不受影响。
>
> **可执行 readiness**：`schema_version=2` 只代表结构版本，不代表已经完成 `/workflow-plan` 现写。spec-approve 落下的 metadata 壳也可能是 v2；execute / Task 派发还要求每个 task 的 `task_text` 非空，否则返回 `task_dir_not_executable`，提示先运行 `/workflow-plan` 经 `task-write` 写入最终 task-dir。

## 写入正路（唯一）

planner 不直接 Write task.json / context.jsonl，也**不读引擎源码自写 `.cjs`**。两条 CLI 命令即正路：

```bash
CLI=~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js

# 整集写 task.json（原子 tmp→rename 替换 + 自动清孤儿目录）。输入 = task 记录数组，或 {tasks:[...]}。
node "$CLI" task-write --from-file <tasks.json>      # 或 --from-file -  读 stdin

# 写单 task 的 context.jsonl 背包（覆盖式）。
node "$CLI" context-curate --id T1 --from-file <ctx.jsonl>   # 或 -
```

`<cmd> --help` 打印参数签名。CLI 不满足需求时 **halt 报错让用户介入**，禁止读 `task_store.js` / `plan_composer.js` 等引擎源码逆向函数自写脚本（PreToolUse `guard-engine-source` hook 会 deny）。

## task.json 字段（v2，对齐 normalizeTaskRecord）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `schema_version` | number | — | 写侧盖章 `2` | task-dir schema 版本。读侧缺省视为 `1`。**execute 入口对 `< 2` 阻断**（v1 不兼容，须重 plan） |
| `id` | string | ✅ | — | `T<number>`（T1/T2…）。非法 id 写入即报错 |
| `name` | string | ✅(实务) | `''` | task 标题。空 → plan-review warning |
| `phase` | string | — | `implement` | `implement` / `test` / `config` |
| `package` | string | — | `''` | monorepo 目标 package，可空 |
| `target_layer` | string | — | `''` | `frontend` / `backend` / 空（package 级） |
| `depends` | string[] | — | `[]` | 前置 task id，如 `["T1"]`。execute 据此排序 + 门控 |
| `blocked_by` | string[] | — | `[]` | 外部阻塞原因，如 `["backend:subtree-check"]`。reconcileBlockedTasks 消费 |
| `status` | string | — | `pending` | 枚举：`pending` `blocked` `in_progress` `completed` `failed` `skipped`。越界 → plan-review 挡 ready |
| `acceptance` | string[] | — | `[]` | 验收信号。空 → plan-review warning |
| `verification` | object | — | `null` | `{commands:string[], expected_output?, notes?}`。execute 注 `<verification-commands>` |
| `interaction` | string | — | `AFK` | 交互模式 |
| `files` | string[] | — | `[]` | **v2** task 写作用域（implementer `allowed_write_paths` 来源） |
| `constraints` | string[] | — | `[]` | **v2** 关键约束（implementer 护栏文本） |
| `patterns` | object[] | — | `[]` | **v2** Patterns to Mirror，每项 `{file, line?, note}`。plan-review `lintPatternFidelity` 校验 file 存在 |
| `mandatory_reading` | object[] | — | `[]` | **v2** Mandatory Reading，每项 `{path, reason, symbols[], line_hint}`。plan-review `lintMandatoryReading` 校验 |
| `task_text` | string | — | `''` | **v2** 执行正文，渲染进 `task.md` 逐字注入 implementer |
| `requirement_ids` | string[] | ✅(实务) | `[]` | 本 task 承接的 spec §2.1 R-ID（`R-NNN`）。plan-review coverage 比对 + confidence PRD 维度数据源；spec-approve 壳已按 1:1 预填，task-write 重切时**必须承接**（缺失 → coverage 全 uncovered、PRD 维度 0 分，advisory 不挡 ready） |
| `quality_gate` | boolean | — | `false` | commit 边界 marker（spec-approve 由需求 `must_preserve` 预填）。代码质量 review 由 per-task reviewer 默认覆盖，与本字段解耦 |

未知扩展字段必须在读写 / status 更新中透传保留，避免 planner、delta 或未来 runtime 写入的 metadata 被 normalization 意外丢弃。写侧仍必须覆盖 `schema_version=2`；手写旧文件缺省才视为 v1。

### 最小示例

```json
[
  { "id": "T1", "name": "store 树缓存重构", "package": "reelmate", "target_layer": "frontend",
    "status": "pending", "acceptance": ["懒加载子树"], "requirement_ids": ["R-001"],
    "verification": { "commands": ["pnpm --filter reelmate lint"] } },
  { "id": "T2", "name": "删除文件夹守卫", "depends": ["T1"], "blocked_by": ["backend:dir-subtree-asset-check"],
    "status": "blocked", "acceptance": ["子树有资产 → 拒删并 toast"], "requirement_ids": ["R-002"] }
]
```

## context.jsonl 字段

每行一个 JSON 对象 `{file, reason}`：

```jsonl
{"file": "docs/workflows/specs/xxx.md", "reason": "需求来源"}
{"file": "research/api-notes.md", "reason": "接口调研"}
```

- **仅 spec/research 路径**。code 扩展名（`.js/.ts/.py/...`）行被 `context-curate` 自动丢弃——源码复用面走 contract-digest，implementer 执行期自读。
- execute 期 `pre-execute-inject` 在 active task scope 展开为 `<context-pack>`，注入 implementer/check subagent。

## task.md（v2 执行正文）

`task.md` 是 workflow-plan 从 task.json（主要 `task_text` + 结构化 rich 字段）渲染的人读执行切片：

- **只读注入**：execute 期 controller 逐字注入 implementer prompt，**不回解析**——结构化语义一律读 task.json 对应字段，task.md 仅承载叙述正文，避免重蹈旧版 markdown 解析的脆弱性。
- **可重生**：缺失非致命（`readTaskMd` 返回 `''`），可由 task.json 重渲染。
- 写入走 `task_store.writeTaskMd`（planner 现写阶段）；整集 `task-write` 替换时按新 task.json 重渲染 task.md。不要保留旧 task.md，避免渲染产物和 canonical task.json 分叉。

## 完整性门控

`plan-review` 的 `lints.task_schema`：
- **hard（挡 ready）**：非法 id 目录 / task.json 缺失或解析失败 / status 越界枚举 / task 源整体为空（`empty_task_source`，非 legacy workflow；execute 期 `assertTaskSourcePresent` 也会兜底，但 plan-review 作为 handoff 前的权威门须对称挡空）/ resume 锚点孤儿（`current_tasks_orphaned`：`state.current_tasks` 含不在 task 源中的 id）/ 锚点缺失（`current_tasks_empty`：源仍有未终结 task 而 `current_tasks` 为空，兜 legacy 未 seed 存量；unfinished 不含 `completed`/`skipped`，`failed`/`blocked` 算未终结，重导会回退锚到 retry/unblock 目标）。两者修复均跑 `repair-anchor` 或重跑 `task-write`。
- **warning（不挡）**：`name` 空 / `acceptance` 空。

`current_tasks[0]` = task 源 `firstTaskId()`（数字序首个），整集重写后必须仍解析到一个存在的 task（resume 三元组不可断）。锚点重导/修复语义（task-write 自动重导、repair-anchor 修锚、回报字段 `current_tasks_reseeded`/`stale_progress_ids`/`reseed_error`）见 `core/specs/shared/workflow-cli.md` § task-write 的 resume 锚点重导 / § repair-anchor；残留孤儿由 `plan-review` 的 `current_tasks_orphaned` hard issue 挡 ready。
