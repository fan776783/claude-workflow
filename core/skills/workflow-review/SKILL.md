---
name: workflow-review
description: "workflow 两阶段审查行动指南 — 被 workflow-execute 在质量关卡和审查触发点调用。"
---

# workflow-review

> 本 skill 是 workflow 两阶段审查的完整行动指南。被 `workflow-execute` 在质量关卡任务和审查触发点引用，不提供独立的 `/workflow` action。

<HARD-GATE>
四条不可违反的规则：
1. **Stage 1 优先**：Stage 1（规格合规）未通过，不得启动 Stage 2（代码质量）
2. **修复铁律**：Critical/Important 问题未修复，不得标记审查通过
3. **CLI 接管**：审查结果必须通过 CLI 写入 state，不得手动构造 JSON
4. **预算硬停**：两阶段共享 4 次总预算耗尽 → 标记任务 `failed`，不得继续尝试
</HARD-GATE>

> 审查结果的写入者始终是 CLI/runtime；workflow hooks 不承担状态写入职责。

## Checklist（按序执行）

1. ☐ 判断审查类型
2. ☐ Stage 1：规格合规审查
3. ☐ Stage 2：代码质量审查（条件）
4. ☐ 记录审查结果（CLI）
5. ☐ 处理审查反馈（条件）

```
判断类型 → Stage 1（合规）→ 通过？ → Stage 2（质量）→ 通过？ → CLI 记录 → 下一 Task
                ↓ 不通过              ↓ 不通过
           修复 → 重审           修复 → 重审（消耗共享预算）
```

---

## Step 1: 判断审查类型

根据触发条件确定审查模式：

| 触发条件 | 审查类型 | 说明 |
|----------|----------|------|
| 当前 task 的 `actions` 含 `quality_review` | **完整两阶段审查** | Stage 1 + Stage 2，带修复循环 |
| 当前 task 是 plan 中最后一个 task | **全量完成审查** | 验证整体实现完整性 |
| 每连续 3 个常规 task 未审查 | **轻量合规检查** | 快速 spec 需求覆盖检查，不阻塞执行 |

### Diff 窗口基线

- 首个质量关卡：从 `state.initial_head_commit` 开始
- 后续质量关卡：从上次 `overall_passed = true` 的关卡 `commit_hash` 开始
- 查询基线：`node core/utils/workflow/quality_review.js budget`

---

## Step 2: Stage 1 — 规格合规审查

**执行者**：当前模型（确定性检查，无外部调用）。

**审查标准**：

| 维度 | 检查内容 |
|------|----------|
| **需求覆盖** | spec 中本 task 对应的每个需求是否都有代码实现 |
| **行为匹配** | 代码实际行为是否与 spec 描述一致 |
| **约束遵循** | spec Constraints 章节中的约束是否被正确实现 |
| **范围控制** | 是否有超出 spec 范围的额外实现（over-building） |
| **验收对齐** | 实现是否满足 spec Acceptance Criteria |
| **页面分层** | 单文件是否承载过多独立功能模块 |
| **路由结构** | spec 中规划的多页面是否实现了路由/导航 |

**关键规则**：
- 独立读取代码验证，不信任实现者自述
- 逐条对照 diff 窗口内所有任务的 `steps[]` 与 `acceptance_criteria`
- 发现偏差必须列出具体文件和行号

**校准规则**（只标记会在实际使用中造成问题的偏差）：
- 不匹配 spec = 必须修复
- 超出 spec 但有价值 = 标记为建议
- 超出 spec 且无价值 = 建议删除
- 风格偏好 = 不标记

### 子 Agent Prompt（Stage 1）

使用 `Task` 工具（或降级模式）分派审查：

```markdown
你是一个 Spec 合规性审查员。你的唯一任务是验证实现代码是否匹配 spec 需求。

## 输入
**Spec 文件路径**: {specPath}
**本次改动范围**: {changedFiles 或 git diff}
**对应的 Plan Task**: {taskDescription}
**Spec Section Ref**: {specSectionRef}

## 校准规则
只标记会在实际使用中造成问题的偏差：
- 不匹配 spec = 必须修复
- 超出 spec 但有价值 = 标记为建议（不阻塞）
- 风格偏好 = 不标记

预期 false-positive 率 ~35%。对每个 finding 验证：
1. 是否真的和 spec 不一致（检查实际代码）
2. 是否是信任边界混淆（内部数据当外部输入检查）
3. 是否忽略了代码注释中的设计意图

## 输出
**Status:** Compliant | Issues Found
**Issues (if any):**
- [文件:行号]: [偏差描述] — [为什么和 spec 不一致] — [建议修复方式]
**Spec Coverage Checklist:**
- [x] 需求 X 已实现 ✅
- [ ] 需求 Y 未实现 ❌ — [原因]
```

### 审查未通过

修复 → 重新审查。每次尝试消耗 1 次共享预算（总计 4 次）。

### 降级执行（不支持子 Agent）

当平台不支持子 Agent 时，在当前会话中执行：
1. 输出分隔符：`━━━ 切换角色：Spec 合规审查员 ━━━`
2. 读取 spec 对应章节 + task 变更文件
3. 逐条检查：需求覆盖、行为匹配、约束遵循、验收对齐
4. 输出 Status + Issues + Coverage
5. 输出分隔符：`━━━ 退出 Spec 合规审查员角色 ━━━`

> ⚠️ 降级模式不得跳过审查。角色切换标记是强制的，用于审计追溯。

---

## Step 3: Stage 2 — 代码质量审查

**前置条件**：Stage 1 必须通过。

**执行者**：平台感知的子 Agent。CLI 自动处理 reviewer profile 解析（`state.context_injection.execution.quality_review_stage2`），无需手动构造。

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

### 预算遥测

每次审查未通过后输出：`审查预算：attempt ${current}/${max}，剩余 ${remaining} 次`

预算耗尽时：`审查预算耗尽（4/4），阻塞问题：[列表]，建议：手动修复后 --retry 或 --skip`

---

## Step 5: 处理审查反馈

收到审查反馈（两阶段审查、外部审查）后，按结构化协议处理。详见 [`references/review-feedback-protocol.md`](references/review-feedback-protocol.md)。

---

## 全量完成审查

所有 plan task 完成后，执行一次全量审查。使用以下 Prompt：

```markdown
你是最终代码审查员。验证整个实现是否完整、一致且可合并。

**Spec 文件**: {specPath}
**Plan 文件**: {planPath}
**所有改动文件**: {allChangedFiles}

## 检查内容
1. 所有 plan task 是否都已实现
2. 跨 task 的集成是否正确
3. 是否有遗漏的 spec 需求
4. 整体代码质量是否达到合并标准
5. 页面结构是否与 spec 中的信息架构一致
6. 首次使用流程是否已实现（如 spec 中有描述）
7. 是否存在功能堆砌问题（主页面 > 4 个独立模块）

## 输出
**Status:** Ready to Merge | Issues Found
**Missing Requirements:** [如果有]
**Integration Issues:** [如果有]
```

---

## 轻量合规检查（每 3 个常规 task 触发）

当连续执行 3 个常规 task（不含 `quality_review` action）后触发：

1. 读取最近 3 个 task 对应的 spec 章节
2. 读取这 3 个 task 修改的文件
3. 快速检查：spec 需求是否有对应代码实现
4. 输出结果：`轻量合规检查：通过 / N 项偏差`
5. 偏差列表（如有）通过 CLI 写入 state

> 轻量检查不阻塞执行。发现偏差时输出警告，继续下一个 task。

---

## 红旗清单

出现以下行为即为执行违规：
- 在 Stage 1 未通过时跳到 Stage 2
- 信任实现者自述而不独立验证代码
- 将 Critical 问题降级为 Minor
- 预算耗尽后继续尝试
- 跳过审查因为"改动很简单"
- diff 窗口为空但仍标记通过

---

## 协同关系

| 关联 | 路径 |
|------|------|
| 执行引擎 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| 并行分派（平台路由） | [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md) |
| CLI 入口 | `core/utils/workflow/quality_review.js` |
| Command 入口 | [`../../commands/workflow.md`](../../commands/workflow.md) |
