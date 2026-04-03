# 任务完成检查清单（每个 Task 完成后强制执行）

> 每个 **已完成实现并准备声明 completed 的 task**，在进入下一个 task 之前，必须依次完成以下检查。
>
> ⚠️ 跳过 ①~⑤ 中的任意一项即为执行违规。⑥ Journal 为条件步骤，仅在列出的触发场景下执行。

## ✅ 必做项（按顺序执行）

### 1. 验证（Verification）

- [ ] 运行 task 指定的验证命令（或项目默认 build/test/lint 命令）
- [ ] **读取验证输出**，确认无错误
- [ ] 验证失败 → 修复后重新验证，不得跳过
- [ ] ⚠️ 验证必须在 plan/state 更新之前完成（Verification Iron Law）

### 2. 自审查 & 规格合规检查（建议性，不阻塞）

- [ ] 对 `create_file` / `edit_file` 类型任务执行自审查（建议性）
- [ ] 对有 `acceptance_criteria` 的任务执行规格合规检查（只读）
- [ ] 以上均为建议性，不阻塞后续步骤

### 3. Plan 更新（Plan Checkpoint）

- [ ] 在 `plan.md` 中找到当前 task 对应块（canonical 格式为 `## Tn:` 的 WorkflowTaskV2 任务块）
- [ ] 单次写入只改变一个 task block 的状态语义，禁止多 task 批量变更
- [ ] 更新该 task 的进度标记为已完成（如状态字段、任务标题标记或约定的完成标识）
- [ ] **保存文件**
- [ ] ⚠️ 必须逐 task 更新，禁止最后批量回写

### 3→4. Checkpoint 原子性守卫

- [ ] 若 Step 3 成功但 Step 4 失败：回滚 plan.md 中该 task 的状态标记
- [ ] 恢复启动时检测 plan.md 与 state.json 的一致性（以 state.json 为权威）
- [ ] 详见 `../specs/execute/post-execution-pipeline.md` → Step ③→④

### 4. 状态文件更新（State Update）

- [ ] 读取 `~/.claude/workflows/{projectId}/workflow-state.json`
- [ ] 将当前 task ID 添加到 `progress.completed` 数组
- [ ] 更新 `current_tasks` 为下一个 task ID（或清空）
- [ ] 更新 `updated_at` 为当前时间
- [ ] **保存文件**

### 5. 审查（Review — 条件执行）

满足以下**任一条件**时执行审查：

| 条件 | 审查级别 | 操作 |
|------|---------|------|
| 当前 task 的 `actions` 含 `quality_review` | **完整两阶段审查** | 执行 Spec 合规 + 代码质量审查（参见 `../../workflow-reviewing/specs/execute/subagent-review.md`） |
| 自上次审查以来已连续完成 **3 个** 常规 task | **轻量合规检查** | 读取 spec 对应章节，检查最近 3 个 task 的实现是否覆盖 spec 需求 |
| 当前 task 是 plan 中的**最后一个** task | **全量完成审查** | 检查所有 spec 需求是否被完整实现 |

不满足以上任何条件时，跳过审查，直接进入下一步。

### 6. Journal 记录（跨 Session 记忆 — 条件执行）

满足以下**任一条件**时记录会话进展：

| 条件 | 记录内容 |
|------|----------|
| 质量关卡审查完成后 | 已完成任务 + 审查结果 + 关键决策 |
| ContextGovernor 决定暂停时 | 已完成任务 + 暂停原因 + 下一步计划 |
| 工作流完成时 | 全部任务摘要 + 最终产物 |

- [ ] 调用 `python3 ../../../utils/workflow/workflow_cli.py journal add --title "..." --tasks-completed "..." --summary "..." --decisions "..." --next-steps "..."`
- [ ] 确认 journal 记录包含：已完成任务 ID、关键决策、遇到的问题、Next Steps

不满足以上条件时，跳过 journal 记录。

---

## ❌ 禁止项

- ❌ **批量回写 plan.md** — 必须逐 task 更新
- ❌ **跳过验证直接标记 completed** — 必须有验证证据
- ❌ **先更新 plan/state 再验证** — 验证必须在状态更新之前（Iron Law）
- ❌ **跳过状态文件更新** — 即使快速执行也必须更新
- ❌ **在质量关卡 task 后跳过审查** — quality_review action 强制触发审查
- ❌ **使用过时验证结果** — 必须使用本次运行的新鲜结果

---

## 📝 快速参考

```
Task 完成 → ①验证 → ②自审查/合规检查 → ③更新 plan.md → ④更新 state.json → ⑤审查（条件） → ⑥Journal 记录（条件） → 下一 Task
```
