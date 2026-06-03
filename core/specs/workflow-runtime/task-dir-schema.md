# task-dir Schema (v1)

> 📌 **Canonical Source**：机器 task 源（task-dir）的写入 contract。`workflow-plan` 经 CLI 写、`workflow-execute`/`workflow-delta` 读。CLI 实现见 `core/utils/workflow/task_store.js` `normalizeTaskRecord`——**本文件即 contract，不要读 task_store.js 源码反推**。

机器 task 源 = `~/.claude/workflows/{pid}/tasks/{Tn}/`，每个 task 一个目录：

```text
tasks/
├── T1/
│   ├── task.json       # 元数据（本文件 schema）
│   └── context.jsonl   # 可选 per-task 背包，每行 {file,reason}
└── T2/ ...
```

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

## task.json 字段（11 项，对齐 normalizeTaskRecord）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
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

### 最小示例

```json
[
  { "id": "T1", "name": "store 树缓存重构", "package": "reelmate", "target_layer": "frontend",
    "status": "pending", "acceptance": ["懒加载子树"],
    "verification": { "commands": ["pnpm --filter reelmate lint"] } },
  { "id": "T2", "name": "删除文件夹守卫", "depends": ["T1"], "blocked_by": ["backend:dir-subtree-asset-check"],
    "status": "blocked", "acceptance": ["子树有资产 → 拒删并 toast"] }
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

## 完整性门控

`plan-review` 的 `lints.task_schema`：
- **hard（挡 ready）**：非法 id 目录 / task.json 缺失或解析失败 / status 越界枚举 / task 源整体为空（`empty_task_source`，非 legacy workflow；execute 期 `assertTaskSourcePresent` 也会兜底，但 plan-review 作为 handoff 前的权威门须对称挡空）。
- **warning（不挡）**：`name` 空 / `acceptance` 空。

`current_tasks[0]` = task 源 `firstTaskId()`（数字序首个），整集重写后必须仍解析到一个存在的 task（resume 三元组不可断）。
