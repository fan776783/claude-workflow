# 任务完成检查清单（每个 Task 完成后强制执行）

> 每个 **已完成实现并准备声明 completed 的 task**，在进入下一个 task 之前，必须依次完成以下检查。
>
> ⚠️ 跳过前置项或 ①② 中的任意一项即为执行违规。③ Journal 为条件步骤，仅在列出的触发场景下执行。
>
> `completed` 是 workflow runtime 中的显式状态推进，不是"仓库里已经有代码"这一类现象判断；不得通过扫描源码、diff、测试文件存在与否来单独推断 task 已完成。

## ✅ 必做项（按顺序执行）

### 前置：per-task reviewer 终判 PASS（Step 4.2）

- [ ] Step 4.2 reviewer 终判 `PASS` → controller **内存确认放行**进入下方 ①（per-task gate 落盘已退役，不调 CLI 持久化、不回灌全文到 controller，只认 `decision: PASS`）
- [ ] reviewer 终态 FAIL → 由 Step 4.2 loop 上限 halt 处理，本清单不执行

> Code-specs 沉淀不在本步骤内执行。发现值得沉淀的内容，完成 workflow 后用 `/spec-update` 捕获，由 execute 末尾终审（Step 7）兜底。

### 1. 验证（Verification）

- [ ] 运行 task 指定的验证命令（或项目默认 build/test/lint 命令）
- [ ] **读取验证输出**，确认无错误
- [ ] 验证失败 → 修复后重新验证，不得跳过
- [ ] ⚠️ 验证必须在 `advance` 之前完成（Verification Iron Law）

### 2. Checkpoint（单条 `advance`，更新 task-dir + state.json）

- [ ] 运行 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js advance {taskId}`
- [ ] CLI 原子完成：task-dir(task.json) 状态更新 + `progress.completed` 追加 + `current_tasks` 重导 + `updated_at` 刷新
- [ ] **必须输出 checkpoint 行**（`✅ {TaskId} checkpoint: completed=[...], current=[...]`）
- [ ] ⚠️ 必须逐 task `advance`，禁止多 task 攒批回写
- 💡 **状态转换自愈**：`advance` 在 `state.status === 'planned'` 时会自动升为 `running` 并在返回载荷里带 `status_transition: "planned->running"`；无需手动 patch state.json，也不要为此再写 `node -e`
- 💡 plan.md 已退化为可选人类叙述，**不需要也不应该手动编辑 plan.md 的任务状态**（仅 legacy plan.md workflow 由 CLI 回写）

### 3. Journal 记录（跨 Session 记忆 — 条件执行）

满足以下**任一条件**时记录会话进展：

| 条件 | 记录内容 |
|------|----------|
| workflow 暂停（`halted`）时 | 已完成任务 + 暂停原因（`halt_reason`/`failure_reason`） + 下一步计划 |
| 所有 task 完成（末尾终审前）时 | 全部任务摘要 + 最终产物 |

- [ ] 调用 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal add --title "..." --tasks-completed "..." --summary "..." --decisions "..." --next-steps "..."`
- [ ] 确认 journal 记录包含：已完成任务 ID、关键决策、遇到的问题、Next Steps

不满足以上条件时，跳过 journal 记录。

---

## ❌ 禁止项

- ❌ **批量回写 task-dir / state.json** — 必须逐 task advance（仅 legacy plan.md workflow 才回写 plan.md）
- ❌ **跳过验证直接标记 completed** — 必须有验证证据
- ❌ **先 advance 再验证** — 验证必须在状态更新之前（Iron Law）
- ❌ **手动编辑 plan.md / state.json 推进任务状态** — 状态推进只走 `advance` CLI
- ❌ **使用过时验证结果** — 必须使用本次运行的新鲜结果
- ❌ **通过仓库代码现状猜测 completed** — task 完成态必须经过验证 + advance 管线
- ❌ **覆盖其他 workflow 的状态文件** — 发现 projectId 不匹配时，不得覆写其他 projectId 的 `workflow-state.json`
- ❌ **跳过末尾终审标记 completed** — 所有 task 完成后必须先跑 inline final reviewer 终审（Step 7），PASS 后才 `advance` 到 `completed`（HARD-GATE #4，无独立 review 中间态）

---

## 📝 快速参考

```
Task 实现完成 → reviewer PASS（Step 4.2，内存确认）→ ①验证 → ②advance {taskId}（task-dir + state 原子更新，输出 checkpoint 行）→ ③Journal（条件） → 下一 Task
所有 Task 完成 → inline final reviewer 末尾终审（Step 7）→ PASS → advance 到 completed（HARD-GATE #4）
```
