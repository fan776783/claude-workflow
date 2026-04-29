# 任务完成检查清单（每个 Task 完成后强制执行）

> 每个 **已完成实现并准备声明 completed 的 task**，在进入下一个 task 之前，必须依次完成以下检查。
>
> ⚠️ 跳过 ①~④ 中的任意一项即为执行违规。⑤ Journal 为条件步骤，仅在列出的触发场景下执行。
>
> `completed` 是 workflow runtime 中的显式状态推进，不是“仓库里已经有代码”这一类现象判断；不得通过扫描源码、diff、测试文件存在与否来单独推断 task 已完成。

## ✅ 必做项（按顺序执行）

### 1. 验证（Verification）

- [ ] 运行 task 指定的验证命令（或项目默认 build/test/lint 命令）
- [ ] **读取验证输出**，确认无错误
- [ ] 验证失败 → 修复后重新验证，不得跳过
- [ ] ⚠️ 验证必须在 plan/state 更新之前完成（Verification Iron Law）

### 2. 自review & 规格合规检查（强制输出）

- [ ] 对 `create_file` / `edit_file` 类型任务执行自review（建议性）
- [ ] 对有 `acceptance_criteria` 的任务执行规格合规检查（只读）
- [ ] 以上检查内容均为建议性，不阻塞后续步骤
- [ ] **必须输出执行证据**（复制模板填充）：`自审查：X/Y 项通过` 或 `自审查：已跳过（{原因}）`。静默省略即为管线违规

> Code-specs 沉淀不在本步骤内执行。发现值得沉淀的内容，完成workflow后用 `/spec-update` 捕获，由 `workflow-review` Stage 1 兜底。

### 3. Plan 更新（Plan Checkpoint）

- [ ] 在 `plan.md` 中找到当前 task 对应块（canonical 格式为 `## Tn:` 的 WorkflowTaskV2 任务块）
- [ ] 单次写入只改变一个 task block 的状态语义，禁止多 task 批量delta
- [ ] 更新该 task 的进度标记为已完成（如状态字段、任务标题标记或convention的完成标识）
- [ ] **保存文件**
- [ ] ⚠️ 必须逐 task 更新，禁止最后批量回写

### 4. 状态文件更新（State Update — HARD-GATE #4）

- [ ] 读取 `~/.claude/workflows/{projectId}/workflow-state.json`
- [ ] 将当前 task ID 添加到 `progress.completed` 数组
- [ ] 更新 `current_tasks` 为下一个 task ID（或清空）
- [ ] 更新 `updated_at` 为当前时间
- [ ] **保存文件**
- 💡 **状态转换自愈**：`workflow_cli.js advance` 在 `state.status === 'planned'` 时会自动升为 `running` 并在返回载荷里带 `status_transition: "planned->running"`；无需手动 patch state.json，也不要为此再写 `node -e`

### 3→4. Checkpoint 输出（强制）

- [ ] 步骤 3 和 4 完成后，必须输出 checkpoint 行（格式见 SKILL.md Step 6 ③→④）
- [ ] 步骤 3 成功但步骤 4 失败时：回滚 plan.md 中该 task 的状态标记

### 5. Journal 记录（跨 Session 记忆 — 条件执行）

满足以下**任一条件**时记录会话进展：

| 条件 | 记录内容 |
|------|----------|
| ContextGovernor 决定暂停时 | 已完成任务 + 暂停原因 + 下一步计划 |
| 所有 task 完成（进入 review_pending）时 | 全部任务摘要 + 最终产物 |

- [ ] 调用 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js journal add --title "..." --tasks-completed "..." --summary "..." --decisions "..." --next-steps "..."`
- [ ] 确认 journal 记录包含：已完成任务 ID、关键决策、遇到的问题、Next Steps

不满足以上条件时，跳过 journal 记录。

---

## ❌ 禁止项

- ❌ **批量回写 plan.md** — 必须逐 task 更新
- ❌ **跳过验证直接标记 completed** — 必须有验证证据
- ❌ **先更新 plan/state 再验证** — 验证必须在状态更新之前（Iron Law）
- ❌ **跳过状态文件更新** — 即使快速执行也必须更新
- ❌ **使用过时验证结果** — 必须使用本次运行的新鲜结果
- ❌ **通过仓库代码现状猜测 completed** — task 完成态必须经过验证 + plan/state 更新管线
- ❌ **覆盖其他workflow的状态文件** — 发现 projectId 不匹配时，不得覆写其他 projectId 的 `workflow-state.json`
- ❌ **批量化管线** — 最后一个 task 后一次性更新所有 task 的 plan.md / state.json。每个 task 完成后必须立即输出 checkpoint 行
- ❌ **绕过 review_pending** — 所有 task 完成后不得直接标记 completed，必须先设为 `review_pending` 并提示用户执行 `/workflow-review`

---

## 📝 快速参考

```
Task 完成 → ①验证 → ②自审查（输出证据） → ③更新 plan.md → ④更新 state.json → 输出 checkpoint 行 → ⑤Journal（条件） → 下一 Task
所有 Task 完成 → 生成实施报告 → 设 review_pending → 提示 /workflow-review
```

