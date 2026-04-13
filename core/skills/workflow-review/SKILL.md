---
name: workflow-review
description: "workflow-review 入口。独立的全量完成审查步骤 — execute 完成后手动执行 /workflow-review 触发。"
---

# workflow-review

> 本 skill 是 workflow 全量完成审查的完整行动指南。在 `workflow-execute` 完成所有 task 后，工作流进入 `review_pending` 状态，用户通过 `/workflow-review` 手动触发本 skill。

<HARD-GATE>
四条不可违反的规则：
1. **Stage 1 优先**：Stage 1（规格合规）未通过，不得启动 Stage 2（代码质量）
2. **修复铁律**：Critical/Important 问题未修复，不得标记审查通过
3. **CLI 接管**：审查结果必须通过 CLI 写入 state，不得手动构造 JSON
4. **预算硬停**：两阶段共享 4 次总预算耗尽 → 标记任务 `failed`，不得继续尝试
</HARD-GATE>

> 审查结果的写入者始终是 CLI/runtime；workflow hooks 不承担状态写入职责。

## Checklist（按序执行）

1. ☐ 前置检查（review_pending 校验）
2. ☐ Stage 1：规格合规审查
3. ☐ Stage 2：代码质量审查
4. ☐ 记录审查结果（CLI）
5. ☐ 处理审查反馈（条件）
6. ☐ 状态推进（completed 或回退 running）

```
前置检查 → Stage 1（合规）→ 通过？ → Stage 2（质量）→ 通过？ → CLI 记录 → completed
                ↓ 不通过              ↓ 不通过
           修复 → 重审           修复 → 重审（消耗共享预算）
                                      ↓ 预算耗尽
                                 回退 running → 用户处理
```

---

## Step 0: 前置检查

**必须首先执行**。校验工作流是否处于可审查状态。

```bash
node core/utils/workflow/workflow_cli.js status
```

| 检查项 | 预期 | 不满足时处理 |
|--------|------|-------------|
| `state.status` | `review_pending` | 拒绝执行。提示：`当前状态为 {status}，不是 review_pending。请先完成执行。` |
| `progress.completed` | 包含所有 plan task | 拒绝执行。提示：`仍有未完成任务：{pending_tasks}` |

> ⚠️ 如果 status 为 `running`、`paused`、`failed` 等，说明 execute 尚未完成，不应进入审查。

---

## Step 1: 确定审查范围

本 skill 仅执行**全量完成审查**——验证整个工作流的实现是否完整、一致且可合并。

### Diff 窗口基线

- 首次审查：从 `state.initial_head_commit` 开始
- 查询基线：`node core/utils/workflow/quality_review.js budget`

---

## Step 2: Stage 1 — 规格合规审查

**执行者**：当前模型（主任务直接执行，不分派子 Agent）。

> 🔑 Stage 1 是结构化对照检查（spec 条目 → 代码实现），属于客观事实验证，不需要子 Agent 的隔离开销。
> 本 skill 作为独立入口（`/workflow-review`），与 execute 阶段天然隔离，已满足审查独立性要求。
> Stage 2（主观代码质量判断）仍通过子 Agent 执行，确保深度审查的独立视角。

**独立验证规则**（补偿非子 Agent 执行的隔离损失）：
- **禁止引用 execute 阶段的记忆**：不得使用"我之前实现了 X"作为验证依据
- **强制读取源文件**：每个 spec 需求必须通过 `view_file` / `grep` 独立读取对应代码文件验证
- **逐条输出证据**：每个需求的验证结论必须附带具体文件路径和行号

**审查标准**：

| 维度 | 检查内容 |
|------|----------|
| **需求覆盖** | spec 中每个需求是否都有代码实现 |
| **行为匹配** | 代码实际行为是否与 spec 描述一致 |
| **约束遵循** | spec Constraints 章节中的约束是否被正确实现 |
| **范围控制** | 是否有超出 spec 范围的额外实现（over-building） |
| **验收对齐** | 实现是否满足 spec Acceptance Criteria |
| **页面分层** | 单文件是否承载过多独立功能模块 |
| **路由结构** | spec 中规划的多页面是否实现了路由/导航 |

**关键规则**：
- 独立读取代码验证，不信任实现者自述
- 逐条对照所有任务的 `steps[]` 与 `acceptance_criteria`
- 发现偏差必须列出具体文件和行号

**校准规则**（只标记会在实际使用中造成问题的偏差）：
- 不匹配 spec = 必须修复
- 超出 spec 但有价值 = 标记为建议
- 超出 spec 且无价值 = 建议删除
- 风格偏好 = 不标记

### 执行流程

1. 读取 spec 全文 + 所有 plan task 定义
2. 获取变更文件列表（`git diff --name-only {baseCommit}..HEAD`）
3. 逐条检查每个 spec 需求：
   - 通过 `view_file` 读取对应实现代码
   - 验证：需求覆盖、行为匹配、约束遵循、验收对齐
4. 检查范围控制（是否有超出 spec 的额外实现）
5. 输出结果：

```
**Status:** Compliant | Issues Found
**Issues (if any):**
- [文件:行号]: [偏差描述] — [为什么和 spec 不一致] — [建议修复方式]
**Spec Coverage Checklist:**
- [x] 需求 X 已实现 ✅
- [ ] 需求 Y 未实现 ❌ — [原因]
```

### 审查未通过

修复 → 重新审查。每次尝试消耗 1 次共享预算（总计 4 次）。

---

## Step 3: Stage 2 — 代码质量审查

**前置条件**：Stage 1 必须通过。

**执行者**：优先使用 `Task` 工具分派独立子 Agent（单 reviewer）。CLI 自动处理 reviewer profile 解析（`state.context_injection.execution.quality_review_stage2`），无需手动构造。不支持 `Task` 时降级为当前会话内角色切换。

通过 `Task` 工具分派审查子 Agent，审查清单参见 [`references/stage2-review-checklist.md`](references/stage2-review-checklist.md)。

子 Agent 的平台路由遵循 `../dispatching-parallel-agents/SKILL.md` 的平台检测规则，但 Stage 2 走的是**单 reviewer 子 agent 路径**，不使用并行分派。

### 判定

| 结果 | 处理 |
|------|------|
| `Approved` | 关卡通过，进入 Step 4 记录结果 |
| `Issues Found`（Critical/Important） | 修复 → 重新审查（消耗共享预算） |
| `Rejected` | 关卡失败，标记任务 `failed`，不可修复 |

### Stage 2 修复后触发轻量 Stage 1 复核

仅在 Stage 2 产生了代码修复时触发。确保修复未引入新的 spec 偏差。

### 降级执行（不支持子 Agent）

1. 输出分隔符：`━━━ 切换角色：代码质量审查员 ━━━`
2. 按 [`references/stage2-review-checklist.md`](references/stage2-review-checklist.md) 逐项检查
3. 只标记 Critical 和 Important 级别问题
4. 输出 Status + Issues
5. 输出分隔符：`━━━ 退出代码质量审查员角色 ━━━`

---

## Step 4: 记录审查结果

**所有审查结果通过 CLI 写入 state**，不得手动构造 JSON：

```bash
# 审查通过
node core/utils/workflow/quality_review.js pass <taskId> \
  --base-commit <baseCommit> --current-commit <currentCommit> \
  --from-task <fromTask> --to-task <toTask> --files-changed <n> \
  --stage1-attempts <n> --stage2-attempts <n> \
  --project-id <projectId>

# 审查未通过
node core/utils/workflow/quality_review.js fail <taskId> \
  --failed-stage <stage1|stage2|stage1_recheck> \
  --base-commit <baseCommit> --total-attempts <n> \
  --last-result-json '<json>' \
  --project-id <projectId>

# 查询审查结果
node core/utils/workflow/quality_review.js read <taskId> --project-id <projectId>
```

> ⚠️ **HARD-GATE #3 强制执行**：必须输出以下 checkpoint 行证明已通过 CLI 写入：
> ```
> 📝 Review recorded: quality_review.js pass {taskId} → overall_passed={true|false}
> ```
> 若上方 CLI 调用失败（如缺少 base-commit），则必须尝试以下降级路径：
> ```bash
> # 降级：当 base-commit 不可用时
> node core/utils/workflow/quality_review.js pass <taskId> \
>   --base-commit HEAD --current-commit HEAD \
>   --from-task <fromTask> --to-task <toTask> --files-changed <n> \
>   --stage1-attempts 1 --stage2-attempts 1 \
>   --project-id <projectId>
> ```
> 降级仍失败 → 在 checkpoint 行标注 `(CLI unavailable, manual write)` 并记录原因。

### 审查模式标注

记录结果前，先标注本次执行模式：
```
📋 Review mode: hybrid | degraded-inline
```

- `hybrid`：Stage 1 在主任务内执行，Stage 2 通过子 Agent 分派（默认模式）
- `degraded-inline`：两个 Stage 均在当前会话内执行（Stage 2 也无法分派子 Agent 时）

### 预算遥测

每次审查未通过后输出：`审查预算：attempt ${current}/${max}，剩余 ${remaining} 次`

预算耗尽时：`审查预算耗尽（4/4），阻塞问题：[列表]，建议：手动修复后重新执行 /workflow-review`

---

## Step 5: 处理审查反馈

收到审查反馈（两阶段审查、外部审查）后，按结构化协议处理。详见 [`references/review-feedback-protocol.md`](references/review-feedback-protocol.md)。

---

## Step 6: 状态推进

根据审查结果推进工作流状态：

### 审查通过

```bash
# 更新 state.status 为 completed
node core/utils/workflow/workflow_cli.js advance --review-passed
```

> ⚠️ **禁止绕过此 CLI 命令直接写 state.json**。
> `advance --review-passed` 内部调用 `completeWorkflow()`，会同时：
> - 设置 `status: "completed"` + `completed_at`
> - 生成完成摘要
>
> 若 CLI 不可用（极端情况），手动写入必须同时设置 `status`、`completed_at` 两个字段，
> 并在输出中标注 `(manual advance, CLI unavailable)`。

输出：
```
✅ 全量完成审查通过。工作流已标记为 completed。
可执行 /workflow-archive 归档工作流。
```

### 审查失败

```bash
# 回退 state.status 为 running，标记失败的 task
node core/utils/workflow/workflow_cli.js advance --review-failed --failed-tasks "T3,T5"
```

输出：
```
❌ 审查发现问题。状态已回退为 running。
失败任务：T3, T5
请执行 /workflow-execute --retry 修复后重新审查。
```

### 预算耗尽

```
🛑 审查预算耗尽（4/4 次）。
阻塞问题：[列表]
建议：手动修复后重新执行 /workflow-review
```

---

## 红旗清单

出现以下行为即为执行违规：
- 在 Stage 1 未通过时跳到 Stage 2
- 信任实现者自述而不独立验证代码
- 将 Critical 问题降级为 Minor
- 预算耗尽后继续尝试
- 跳过审查因为"改动很简单"
- diff 窗口为空但仍标记通过
- 在非 `review_pending` 状态下执行审查
- 绕过 `quality_review.js` CLI 直接写入 quality_gates JSON
- 绕过 `workflow_cli.js advance` 直接写入 state.json 的 status

---

## 协同关系

| 关联 | 路径 |
|------|------|
| 执行引擎 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| 并行分派（平台路由） | [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md) |
| CLI 入口 | `core/utils/workflow/quality_review.js` |

## 推荐入口顺序

```
/workflow-plan → /workflow-execute → /workflow-review → /workflow-archive
```
