---
name: workflow-review
description: "Use when state.status=review_pending, or 用户在 execute 全部 task 完成后调用 /workflow-review 做最终全量 review。"
---

> 路径约定见 [`../../specs/shared/pre-flight.md`](../../specs/shared/pre-flight.md) § Workflow CLI 路径约定。Stage 1(规格合规)直接依赖最新的 code-specs 和 glossary,即使 workflow 很小也别跳过 pre-flight。

# workflow-review

> 本 skill 只处理 `scope: workflow`(全量完成 review)。运行时还有 `scope: task`(execute 内部 per-task quality gate)和 `scope: batch`(并行批次合流后),三种共享 `quality_review.js` 底层 API,差异见文末「Batch Review 差异」。

<HARD-GATE>
1. **Stage 1 优先**:Stage 1 未通过,不得启动 Stage 2
2. **修复铁律**:Critical/Important 未修复,不得标记 review 通过
3. **CLI 接管**:review 结果必须通过 CLI 写入 state,不得手动构造 JSON
4. **预算硬停**:两阶段共享 4 次总预算耗尽 → 标记任务 `failed`,不得继续尝试
</HARD-GATE>

## Checklist

1. ☐ 前置检查(review_pending 校验)
2. ☐ Stage 1:规格合规 review
3. ☐ Stage 2:代码质量 review
4. ☐ CLI 写入 review 结果
5. ☐ 处理 review 反馈(条件)
6. ☐ 状态推进(completed 或回退 running)

```
前置检查 → Stage 1（合规）→ 通过？ → Stage 2（质量）→ 通过？ → CLI 记录 → completed
                ↓ 不通过              ↓ 不通过
           修复 → 重审           修复 → 重审（共享预算）
                                      ↓ 预算耗尽
                                 回退 running → 用户处理
```

## Step 0: 前置检查

### 0.1 提取 projectId

从 `workflow-state.json` 的 `project_id` 字段提取,**后续所有 CLI 命令必须显式传入 `--project-id {projectId}`**。

> ⚠️ **禁止依赖 `process.cwd()` 自动检测**:`/workflow-review` 执行环境 cwd 可能不在目标项目根目录下,导致 `detectProjectIdFromRoot()` 返回 null → CLI 调用失败 → 触发手动降级写入。

### 0.2 状态校验

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js --project-id {projectId} status
```

| 检查项 | 预期 | 不满足 |
|--------|------|-------|
| `state.status` | `review_pending` | 拒绝执行,提示 `当前状态为 {status},不是 review_pending。请先完成执行。` |
| `progress.completed` | 包含所有 plan task | 拒绝执行,提示 `仍有未完成任务:{pending_tasks}` |

## Step 1: 确定 review 范围

本 skill 仅执行**全量完成 review** — 验证整个 workflow 的实现是否完整、一致且可合并。

**Diff 窗口基线**:首次 review 从 `state.initial_head_commit` 开始;查询基线 `quality_review.js budget`。

## Step 2: Stage 1 — 规格合规 review

**执行者**:当前模型(主任务直接执行,不分派子 Agent)。Stage 1 是结构化对照检查(spec → 代码),属客观事实验证;`/workflow-review` 作为独立入口已与 execute 天然隔离。Stage 2 的主观判断仍通过子 Agent 执行。

**独立验证规则**(补偿非子 Agent 隔离损失):
- **禁止引用 execute 阶段记忆**:不得使用"我之前实现了 X"作为验证依据
- **强制读取源文件**:每个 spec 需求必须通过 `view_file` / `grep` 独立读取对应代码文件验证
- **逐条输出证据**:每个需求的验证结论必须附带具体文件路径和行号

### Review 维度

| 维度 | 检查内容 |
|------|----------|
| **需求覆盖** | spec 中每个需求是否都有代码实现 |
| **行为匹配** | 代码实际行为是否与 spec 描述一致 |
| **约束遵循** | spec Constraints 章节中的约束是否被正确实现 |
| **范围控制** | 是否有超出 spec 范围的额外实现(over-building) |
| **验收对齐** | 实现是否满足 spec Acceptance Criteria |
| **页面 layer** | 单文件是否承载过多独立功能 module |
| **路由结构** | spec 中规划的多页面是否实现了路由/导航 |
| **项目知识一致性** | 实现是否符合 `.claude/code-specs/` 中的 convention(advisory) |
| **Code Specs Check**(advisory) | 按 diff 文件反查 `{pkg}/{layer}/` code-spec,见 [`references/stage1-code-specs-check.md`](references/stage1-code-specs-check.md) |
| **跨层 advisory A–D** | 数据流 / 代码复用 / import 路径 / 同层一致性 4 维度 diff 启发式,见 [`references/cross-layer-checklist.md`](references/cross-layer-checklist.md) § A–D |
| **Probe E Infra 深度 gate**(阻塞) | infra 关键路径 + 关联 code-spec 7 段深度不足 → Stage 1 fail。见 [`references/cross-layer-checklist.md`](references/cross-layer-checklist.md) § E |
| **Depth Heuristics**(advisory) | H1 Deletion test / H2 Single-adapter / H3 Testing past interface,见 [`references/depth-heuristics.md`](references/depth-heuristics.md)。与 Probe E 正交(E 查文档深度,本项查代码深度) |

**校准规则**(只标记会在实际使用中造成问题的偏差):
- 不匹配 spec = 必须修复
- 超出 spec 但有价值 = 标记为建议
- 超出 spec 且无价值 = 建议删除
- 风格偏好 = 不标记

### 执行流程

1. 读取 spec 全文 + 所有 plan task 定义
2. `git diff --name-only {baseCommit}..HEAD` 获取 diff 文件列表
3. 逐条检查每个 spec 需求:`view_file` 读取实现 → 验证需求覆盖、行为匹配、约束遵循、验收对齐
4. 检查范围控制(是否超出 spec)
5. **Code Specs Check**(advisory):见 [`references/stage1-code-specs-check.md`](references/stage1-code-specs-check.md);不影响判定,只记录到 `stage1.code_specs_check`
6. **跨层 A/B/C/D**(advisory):见 [`references/cross-layer-checklist.md`](references/cross-layer-checklist.md);只产生 advisory 记录
7. **Probe E Infra 深度 gate**(阻塞):diff 命中 infra / cross-layer 关键路径且相关 code-spec 7 段深度不足 → Stage 1 fail,走 `quality_review.js fail --failed-stage stage1 --cross-layer-depth-gap true ...`;code-spec 不存在则降级为 advisory
8. **Depth Heuristics H1–H3**(advisory):见 [`references/depth-heuristics.md`](references/depth-heuristics.md);命中时写入 Stage 1 输出的 `Depth (Advisory)` 子块,不影响判定

> A–E 与 Code Specs Check、Depth H1–H3 共享同一 `git diff --name-only {baseCommit}..HEAD` 输出;base commit 复用 `quality_review.js budget` 的解析结果或直接读 `state.initial_head_commit`,不要再跑裸 `git diff` / `git status`。

### 输出格式

```
**Status:** Compliant | Issues Found
**Issues (if any):**
- [文件:行号]: [偏差描述] — [为什么和 spec 不一致] — [建议修复方式]
**Spec Coverage Checklist:**
- [x] 需求 X 已实现 ✅
- [ ] 需求 Y 未实现 ❌ — [原因]
**Code Specs Check (Advisory):**
- [src/api/foo.ts → backend/api-conventions.md]: 新增 POST /foo 未在 Signatures 中声明 → 补齐 code-spec 的 Name / File
**Cross-Layer (Advisory):**
- [A 数据流] 本次 diff 触及 3+ 层,请按 references/cross-layer-checklist.md §A 自检
**Probe E Infra Depth (Blocking, 若命中):**
- 关键路径文件:src/api/export.ts, src/migrations/20260419_add_export.sql
- 关联 code-spec:my-pkg/backend/export-api.md
- 缺失段:Validation & Error Matrix, Tests Required
- 建议:用 /spec-update 补齐对应段落后再重跑 /workflow-review
**Depth (Advisory):**
- [H1 shallow-module] src/utils/logger-wrapper.ts — 接口 8 行 / 实现 10 行、仅 1 caller;考虑内联
```

未触发任何 probe → 省略 advisory 块。Code Specs Check 执行但无发现时,仍输出块并写 "No findings."。

review 未通过 → 修复 → 重新 review。每次尝试消耗 1 次共享预算(总计 4 次)。

## Step 3: Stage 2 — 代码质量 review

**前置**:Stage 1 必须通过。

### Review 模式路由

按 `state.context_injection.signals` 选择(优先级从高到低,互斥):

| 条件 | 模式 | 说明 |
|------|------|------|
| 风险信号(`security` / `backend_heavy` / `data`)**+** scale(`large_scope` / `refactor`) | `quad_review` | Codex(Correctness) + Reuse / Quality / Efficiency 子 Agent 四路并行 |
| 任一风险信号 | `dual_reviewer` | Codex + 子 Agent 并行 |
| `large_scope` 或 `refactor`(无风险信号) | `multi_angle` | Reuse / Quality / Efficiency 三子 Agent 并行 |
| 其他 | `single_reviewer` | 子 Agent 单路径 |

路由逻辑封装在 `role_injection.js` 的 `resolveStage2ReviewMode(signals)`,直接用返回值,不在 SKILL 里做等价判断。`large_scope`:diff 文件数 ≥10 或跨 3+ 层;`refactor`:需求文本命中 `重构|refactor|cleanup|simplify|dedup|提取|抽取|rename`。

### single_reviewer(默认)

优先用 `Task` 工具分派独立子 Agent。CLI 自动处理 reviewer profile 解析(`state.context_injection.execution.quality_review_stage2`)。不支持 `Task` 时降级为当前会话内角色切换。

review 清单:[`references/stage2-review-checklist.md`](references/stage2-review-checklist.md)。子 Agent 平台路由遵循 [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md),但 Stage 2 走单 reviewer 路径,不并行分派。

### multi_angle(三角度并行)

`large_scope` 或 `refactor` 命中时启用。把 Stage 2 拆成 Reuse / Quality / Efficiency 三路子 Agent 并行,合并后走一次 CLI。

1. 生成 `review_cycle_id = {taskId}-{currentCommit短hash}-{timestamp}`
2. **串行 provision**:三路均为只读任务,**不使用 worktree**(只读分析不预置 worktree)
3. **并行 dispatch 三个子 Agent**(Task 工具),prompt 注入 [`../diff-review/specs/anti-patterns-three-angle.md`](../diff-review/specs/anti-patterns-three-angle.md) 的对应角度。每个 Agent 拿完整 diff,只负责本角度 findings
4. **Join barrier**:都完成后合并;任一 Agent 超过 5 分钟 → 降级为 `single_reviewer`(用已完成部分),review mode 标注 `(multi_angle degraded)`
5. **结果合并**:归一化为统一 finding 结构(见 [`references/stage2-review-checklist.md`](references/stage2-review-checklist.md) § 统一 Finding 结构);同 file + line range + category dedup 为 `source: "multi"`;任一角度有 verified Critical/Important → Stage 2 fail
6. **与 dual_reviewer 互斥**:走了 multi_angle 不再额外调 Codex

**预算**:三路合并后只算 1 次 attempt。4 次共享预算不变。

### dual_reviewer(Codex 增强)

风险信号匹配时,Codex 与子 Agent 并行 review 后合并:

1. 生成 `review_cycle_id`
2. **后台启动 Codex**(`--adversarial-review "working-tree"`):

   ```bash
   node ~/.agents/agent-workflow/core/skills/collaborating-with-codex/scripts/codex-bridge.mjs \
     --adversarial-review "working-tree" \
     --cd "{projectRoot}" \
     --prompt "Focus on: logic correctness, edge cases, error handling, security vulnerabilities, performance issues, concurrency, changed contracts and downstream impact. If claiming impact, specify exact code paths and callers. HARD CONSTRAINTS: (1) Ignore hypothetical scenarios without a named caller or reachable code path — trust internal code with known shape. (2) Do not recommend refactors, renames, or cleanup outside the diff. (3) Report only Critical/Important findings; collapse minor/nit items into a single advisory line, do not expand."
   ```

3. **同时 dispatch 子 Agent**(Task)
4. **Join barrier**:超时 5 分钟 → 降级为 single_reviewer 结果
5. **结果合并**:归一化 → 去重 → Codex 候选执行 LOCATE→TRACE→CONTEXT→VERIFY→DECIDE → 任一 reviewer 有 verified Critical/Important → fail;一方 approve + 另一方 verified blocker → blocker 优先
6. **降级**:Codex 失败/超时 → 仅用子 Agent 结果 + 标注 `(Codex degraded)`

**预算**:Codex 调用本身不消耗 retry 预算。合并最终判定算 1 次 attempt。

### quad_review(4 路并行,scale + 风险交集)

scale + 风险**同时**命中时启用。Codex(Correctness) + Reuse / Quality / Efficiency 四路并行,每路独占一个 category,合并后走一次 CLI。

**与 dual_reviewer / multi_angle 区别**:
- 不是叠加而是第四种**互斥**模式;路由命中 quad 后不再触发 dual / multi
- 通过 **category 独占** 规避跨路 finding 去重爆炸:Codex 只报 `correctness`(含 security subtype),三子 Agent 各报 `reuse` / `quality` / `efficiency`

1. 生成 `review_cycle_id`
2. **串行 provision**:四路均只读,不使用 worktree
3. **后台启动 Codex**(Correctness 路,独立进程,不阻塞子 Agent 派发):复用 dual_reviewer 的 `codex-bridge.mjs --adversarial-review "working-tree"`,仅替换 `--prompt` 为:

   ```
   You are the CORRECTNESS reviewer in a 4-way parallel review.
   Focus ONLY on: logic correctness, edge cases, error handling, security vulnerabilities, concurrency, changed contracts and downstream impact.
   Report ONLY findings with category="correctness" (security issues use subtype="security").
   Any observations outside correctness (reuse / quality / efficiency) MUST go into out_of_scope_observations, NOT into main findings — three other reviewers cover those angles.
   If claiming impact, specify exact code paths and callers.
   HARD CONSTRAINTS: (1) Ignore hypothetical scenarios without a named caller or reachable code path — trust internal code with known shape. (2) Do not recommend refactors, renames, or cleanup outside the diff. (3) Report only Critical/Important findings; collapse minor/nit items into a single advisory line, do not expand.
   ```

   桥接 contract 以 [`../collaborating-with-codex/SKILL.md`](../collaborating-with-codex/SKILL.md) 为准。

4. **同时通过 Task 工具并行 dispatch 三个子 Agent**(一次消息内三个 Task 调用,平台路由遵循 [`../dispatching-parallel-agents/SKILL.md`](../dispatching-parallel-agents/SKILL.md)):
   - **Reuse Agent**:注入 anti-patterns-three-angle.md § Reuse;只报 `category: reuse`
   - **Quality Agent**:注入 § Quality;只报 `category: quality`
   - **Efficiency Agent**:注入 § Efficiency;只报 `category: efficiency`
5. **Join barrier**:4 路均完成后合并;任一路超过 5 分钟 → 降级矩阵
6. **结果合并**:category 独占 → 不同 category 的同位置 finding 全部保留;同 category 兜底 dedup(重叠 ≥50%);Codex 候选仍执行 LOCATE→TRACE→CONTEXT→VERIFY→DECIDE;超域发现(`out_of_scope_observations`)由主任务裁决是否采纳为 advisory,不计入 Critical/Important;任一路 verified Critical/Important → fail
7. **互斥**:命中 quad 后不得再额外调 dual / multi

**降级矩阵**(客观事件触发,不靠模型判断):

| 失败路 | 降级结果 | review mode 标注 | `--codex-status` |
|--------|----------|-----------------|-----------------|
| Codex 超时/失败(三子 Agent 正常) | 降为 `multi_angle` | `quad-review → multi-angle (codex degraded)` | `codex_degraded` |
| 1 个子 Agent 超时/失败(Codex+其余 2 子 Agent 正常) | `quad_review` 继续(3 路合并,缺失角度标明) | `quad-review (angle degraded: {reuse\|quality\|efficiency} missing)` | `ok` |
| 2+ 子 Agent 超时/失败(Codex 正常) | 降为 `dual_reviewer`(Codex + 1 剩余视角) | `quad-review → dual-reviewer (angles degraded)` | `ok` |
| Codex + 1+ 子 Agent 失败 | 降为 `single_reviewer`(剩余 1 子 Agent 或会话内执行) | `quad-review → single-reviewer (severely degraded)` | `codex_degraded` |

降级落地:主任务在 Join barrier 侧观察每路返回状态(超时 / 非零退出 / 异常),据上表选择最终 mode。写 CLI 时 `--review-mode` 传入**降级后**的实际模式(降级到 multi 就传 `multi_angle`),`--codex-status` 传对应值。**绝不**在降级时保留 `quad_review` 作为 `--review-mode`,会破坏后续 state 审计。

**预算**:4 路合并算 1 次 attempt;Codex 调用本身不消耗 retry 预算。

### 判定

| 结果 | 处理 |
|------|------|
| `Approved` | 关卡通过,进入 Step 4 |
| `Issues Found`(Critical/Important) | 修复 → 重新 review(消耗共享预算) |
| `Rejected` | 关卡失败,标记任务 `failed`,不可修复 |

### Stage 2 修复后触发轻量 Stage 1 复核

仅在 Stage 2 产生了代码修复时触发,确保修复未引入新的 spec 偏差。

### 降级执行(不支持子 Agent)

1. 输出分隔符:`━━━ 切换角色：代码质量审查员 ━━━`
2. 按 [`references/stage2-review-checklist.md`](references/stage2-review-checklist.md) 逐项检查
3. 只标记 Critical 和 Important
4. 输出 Status + Issues
5. 输出分隔符:`━━━ 退出代码质量审查员角色 ━━━`

## Step 4: 记录 review 结果

**所有 review 结果通过 CLI 写入 state**,不得手动构造 JSON。`--project-id` 必填(见 Step 0.1)。

```bash
# 通过
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js pass <taskId> \
  --project-id {projectId} \
  --base-commit <baseCommit> --current-commit <currentCommit> \
  --from-task <fromTask> --to-task <toTask> --files-changed <n> \
  --stage1-attempts <n> --stage2-attempts <n> \
  --review-mode <single_reviewer|dual_reviewer|multi_angle|quad_review> \
  --codex-status <ok|codex_degraded|null>  # quad/dual 时必填,其他可省

# 未通过
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js fail <taskId> \
  --project-id {projectId} \
  --failed-stage <stage1|stage2|stage1_recheck> \
  --base-commit <baseCommit> --total-attempts <n> \
  --last-result-json '<json>'

# 查询
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js read <taskId> --project-id {projectId}
```

**HARD-GATE #3 强制执行**:必须输出 checkpoint 行:
```
Review recorded: quality_review.js pass {taskId} → overall_passed={true|false}
```

CLI 调用失败时按顺序恢复:① 不带 `--base-commit` 重试,让 CLI 自己 `resolveReviewBaseline` ② 仍失败且报 `缺少质量关卡基线` → 先修复 `state.initial_head_commit`(补齐或重算),再重跑 ③ **不得**用 `--base-commit HEAD --current-commit HEAD` 绕过(会变成空 diff);**不得**手动编辑 `quality_gates.*`。只有 CLI 本身不可用(node 缺失)时才允许在 checkpoint 行标注 `(CLI unavailable)` 并上报用户,不再尝试写 state。

### Review 模式标注

记录前先标注本次执行模式:
```
📋 Review mode: hybrid | dual-reviewer | multi-angle | quad-review | degraded-inline
```

- `hybrid`:Stage 1 主任务 + Stage 2 子 Agent(默认 single_reviewer)
- `dual-reviewer`:Codex + 子 Agent 并行
- `multi-angle`:Reuse / Quality / Efficiency 三子 Agent 并行
- `quad-review`:Codex + 三子 Agent 四路并行(category 独占)
- `degraded-inline`:两 Stage 均会话内执行

降级时括号注明,例如 `quad-review (codex degraded)` / `quad-review → multi-angle (codex degraded)`。

### 预算遥测

每次未通过后输出:`审查预算：attempt ${current}/${max},剩余 ${remaining} 次`
预算耗尽:`审查预算耗尽（4/4),阻塞问题：[列表],建议：手动修复后重新执行 /workflow-review`

## Step 5: 处理 review 反馈

收到 review 反馈(两阶段 review、外部 review)后按结构化协议处理。详见 [`references/review-feedback-protocol.md`](references/review-feedback-protocol.md)。

## Step 6: 状态推进

### Review 通过

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js --project-id {projectId} advance --review-passed
```

> **禁止绕过此 CLI 直接写 state.json**。`advance --review-passed` 内部调用 `completeWorkflow()`,同时设置 `status: "completed"` + `completed_at` + 生成完成摘要。`--project-id` 必传(来自 Step 0.1)。CLI 不可用时手动写入必须同时设置 `status` 和 `completed_at`,并标注 `(manual advance, CLI unavailable)`。

输出:
```
✅ 全量完成审查通过。工作流已标记为 completed。
可执行 /workflow-archive 归档工作流。
```

**Code Specs 沉淀建议**(review 通过时附在末尾):若发现值得沉淀的新模式或 convention,输出:
```
💡 建议使用 /spec-update 将本次 review 发现的约定沉淀到 .claude/code-specs/ 中对应的 code-spec。
```
无建议时省略。

### Review 失败

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js --project-id {projectId} advance --review-failed --failed-tasks "T3,T5"
```

输出:
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

## Red Flags

- Stage 1 未通过时跳到 Stage 2
- 信任实现者自述而不独立验证代码
- 将 Critical 问题降级为 Minor
- 预算耗尽后继续尝试
- 跳过 review 因为"改动很简单"
- diff 窗口为空但仍标记通过
- 在非 `review_pending` 状态下执行 review
- 绕过 `quality_review.js` CLI 直接写入 quality_gates JSON
- 绕过 `workflow_cli.js advance` 直接写入 state.json 的 status

## Batch Review 差异

`workflow-execute` 的并行批次需要 stage2 review 时(`scope: batch`),走 `batch_orchestrator` → `buildBatchPassGateResult` / `buildBatchFailedGateResult`,**不经过本 skill**。

| 维度 | scope: workflow(本 skill) | scope: batch | scope: task |
|------|------|------|------|
| 触发 | 用户手动 `/workflow-review` | 批次合流后自动 | 命中 quality gate 的任务完成后(任务 `actions` 含 `quality_review` 或 `nextTask.quality_gate` 为真) |
| 前置 | `review_pending` | `running` + 集成 worktree 合流完成 | `running` + 被 gate 任务刚完成 |
| Stage 1 | 全量逐 spec 对照 | 每任务在自己 worktree 内已跑完 | 被 gate 单任务逐 spec |
| Stage 2 | 跨所有 task diff | 跨批次 task diff(集成 worktree) | 被 gate 单任务 diff |
| rejected 处理 | 回退 `running` + 重跑 | 丢弃集成 worktree,任务回 pending | 被 gate 任务回 pending |
| 覆盖范围 | 整个 workflow 所有 task | 批次内所有 task | 仅显式命中 gate 的 task |
| CLI | `quality_review.js pass/fail` | 共享 | 共享 |

> scope: batch 入口在 `core/utils/workflow/batch_orchestrator.js`;scope: task 触发条件见 [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) Step 5、Step 6。未命中 gate 的普通任务完成后不走 scope: task review,在 workflow 全部完成时由 scope: workflow 统一覆盖。
