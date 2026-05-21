---
name: workflow-review
description: "Use when state.status=review_pending, or 用户在 execute 全部 task 完成后调用 /workflow-review 做最终全量 review。"
---

> 路径 convention 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。Stage 1（规格合规 + 跨 task）Read `.claude/code-specs/{pkg}/{layer}/index.md` + `core/specs/shared/glossary.md`。

# workflow-review

> 本 skill 只处理 `scope: workflow`（全量完成 review）。其他 scope（task / batch）走不同入口，见文末「Scope 路由」。
>
> 范围：「集成 + 整需求验收 + 跨 task contract 一致性 + 终态卫生」。per-task 代码质量由 execute Step 5.2 reviewer 覆盖，本 skill 不重审（HG-5）。`codex_enhanced` 为 spec-级第二意见，按 `spec.metadata.risk_signals[]` 显式路由。

<HARD-GATE>
- **HG-1 Stage 1 优先**：Stage 1 未通过，不得启动 Stage 2
- **HG-2 修复铁律**：Critical/Important 未修复，不得标记 review 通过
- **HG-3 CLI 接管**：review 结果必须通过 `quality_review.js` / `workflow_cli.js advance` 写入 state，不得手编 `quality_gates.*` 或 `state.status`
- **HG-4 预算硬停**：两阶段共享 4 次总预算耗尽 → 标记 `failed`，不得继续尝试
- **HG-5 不重审 per-task 代码质量**：execute Step 5.2 reviewer 已覆盖 AC + critical/important 代码质量。workflow-review 不重跑同一 checklist；只补 per-task review 结构上看不到的维度（跨 task contract / 需求覆盖汇总 / 终态卫生）。
</HARD-GATE>

## Checklist

1. ☐ 前置检查(review_pending 校验)
2. ☐ Stage 1：规格合规 + 跨 task 一致性 + 需求覆盖汇总 + spec §1 验收
3. ☐ Stage 2：终态卫生（+ 可选 codex_enhanced spec-级第二意见）
4. ☐ CLI 写入 review 结果
5. ☐ 处理 review 反馈(条件)
6. ☐ 状态推进(completed 或回退 running)

```
前置检查 → Stage 1（合规+跨task+§1验收）→ 通过？ → Stage 2（终态卫生 + 可选 codex_enhanced）→ 通过？ → CLI 记录 → completed
                ↓ 不通过                              ↓ 不通过
           修复 → 重审                          修复 → 重审（共享预算）
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
| `quality_gates` | per-task review 已有记录（execute Step 5.2 落盘） | 缺失 → fail，提示 `per-task review trace 缺失，execute Step 5.2 reviewer 未落盘 quality_gate record。请先完成 execute 阶段。` |

## Step 1: 确定 review 范围

本 skill 仅执行**全量完成 review** — 验证整个 workflow 的实现是否完整、一致且可合并。

**Diff 窗口基线**:通过 `quality_review.js budget` 查询（返回 `base_commit` + `baseline_source`）;首次 review 时 CLI 自动使用 `state.initial_head_commit`。

## Step 2: Stage 1 — 规格合规 + 跨 task 一致性 + 需求覆盖汇总 + spec §1 验收

**执行者**:当前模型(主任务直接执行,不分派子 Agent)。Stage 1 是结构化对照检查(spec → 代码),属客观事实验证。

**独立验证规则**(补偿非子 Agent 隔离损失):
- **禁止引用 execute 阶段记忆**:不得使用"我之前实现了 X"作为验证依据
- **强制读取源文件**:每个 spec 需求必须通过 `view_file` / `grep` 独立读取对应代码文件验证
- **逐条输出证据**:每个需求的验证结论必须附带具体文件路径和行号

### Review 维度

**Spec 对照（保留）**：

| 维度 | 检查内容 |
|------|----------|
| **需求覆盖** | spec 中每个需求是否都有代码实现 |
| **行为匹配** | 代码实际行为是否与 spec 描述一致 |
| **约束遵循** | spec Constraints 是否被正确实现 |
| **范围控制** | 是否有超出 spec 范围的额外实现（over-building） |
| **验收对齐** | 实现是否满足 spec Acceptance Criteria |
| **结构合规** | 单文件是否承载过多功能 module / spec 规划的多页面是否落实路由 |

**跨 task 维度（per-task review 结构上看不到）**：

| 维度 | 检查内容 |
|------|----------|
| **需求覆盖汇总** | R-001…R-00N 合并是否兑现 spec §1 成功标准（per-task review 只验单 task AC，不回答整体） |
| **跨 task contract一致性** | 跨 task 共享的 JSON schema / API 形状 / 命名convention是否前后一致（例：T1 输出contract ↔ T5 SKILL.md 描述 ↔ T6 prompt ↔ T2 实际输出） |
| **Spec §1 成功标准验收** | spec §1 列出的"如何衡量成功"逐条核对，给具体证据 |

Diff probes（按需触发；共享同一 `git diff --name-only {baseCommit}..HEAD`）：

| Probe | 性质 | 引用 |
|-------|------|------|
| Code Specs Check | advisory（写 `stage1.code_specs_check`） | [`references/stage1-code-specs-check.md`](references/stage1-code-specs-check.md) |
| Cross-Layer A–D | advisory（数据流 / 复用 / import / 同层一致） | [`references/cross-layer-checklist.md`](references/cross-layer-checklist.md) § A–D |
| Probe E Infra 深度 | **阻塞**（infra 关键路径 + code-spec 7 段深度不足 → Stage 1 fail） | [`references/cross-layer-checklist.md`](references/cross-layer-checklist.md) § E |
| Depth H1–H3 | advisory（代码深度，与 Probe E 正交：E 查文档、本项查代码） | [`references/depth-heuristics.md`](references/depth-heuristics.md) |

**校准规则**：不匹配 spec = 必须修复；超出 spec 有价值 = 建议；超出 spec 无价值 = 建议删除；风格偏好 = 不标记。

### 执行 workflow

1. 读 spec 全文 + 所有 plan task；`git diff --name-only {baseCommit}..HEAD` 取 diff 文件列表
2. 逐条对照 spec 需求：`view_file` 读实现 → 验证覆盖 / 行为 / 约束 / 验收 / 范围
3. **跨 task 一致性扫描**：列出 task 间共享的contract（JSON shape / function signature / 配置 key），grep 各引用点比对
4. **§1 成功标准对照**：spec §1 逐条核对，给文件:行号或测试输出作证据
5. 跑 probes（见上表）。Probe E 命中且 code-spec 深度不足 → 走 `quality_review.js fail --failed-stage stage1 --cross-layer-depth-gap true ...`；code-spec 不存在 → 降级为 advisory

> base commit 复用 `quality_review.js budget` 的解析结果或 `state.initial_head_commit`，不要裸跑 `git diff` / `git status`。

### 输出格式

主框架：

```
**Status:** Compliant | Issues Found
**Spec Coverage Checklist:**
- [x] R-001 已实现 — file:line
- [ ] R-007 未实现 — [原因]
**Spec §1 成功标准验收:**
- [x] 标准1 — 证据
- [ ] 标准2 — 缺什么
**跨 Task contract一致性:**
- ✅ contract X: T1/T5/T6 一致
- ❌ contract Y: T2 输出与 T5 SKILL.md 描述不一致 — [file:line vs file:line]
**Issues (if any):**
- [文件:行号]: [偏差描述] — [为什么不一致] — [建议修复]
```

命中的 probe 在主框架后追加对应子块。

review 未通过 → 修复 → 重审。每次尝试消耗 1 次共享预算（总计 4 次）。

## Step 3: Stage 2 — 终态卫生（+ 可选 codex_enhanced spec-级第二意见）

**前置**: Stage 1 必须通过。

Stage 2 只补 per-task review 结构上看不到的 workflow 级维度（per-task 代码质量由 execute Step 5.2 reviewer 覆盖；HG-5）。

### 3.1 终态卫生检查（必做）

| 检查项 | 通过条件 | 不通过处理 |
|--------|----------|------------|
| `state.quality_gates` 完整性 | 每个 completed task 都有 quality_gate record（含 attempts / findings_summary） | 缺失 → fail，提示 execute Step 5.2 reviewer 未正确落盘 |
| `state.review_report_path` | 已写入（execute Step 8 通过 `set-report-path` 落盘） | 缺失 → fail，提示先跑 execute Step 8 |
| Git 状态 | 无未提交改动（或所有未提交改动已 stash / 显式说明） | 有未提交 → 列出文件，让用户决策 |
| 端到端 smoke（如配置） | spec 声明的 e2e 命令通过 | 失败 → fail |
| Over-building workflow级扫描 | 不存在 spec 未声明但被实现的"附赠功能" | 命中 → 列为 Issues，建议删除 |

### 3.2 codex_enhanced 路由（可选 — spec-级第二意见）

仅当 `spec.metadata.risk_signals[]` 显式包含以下任一时触发（不再按 task action 标签自动路由）：
- `security` — 涉及安全敏感面（认证 / 授权 / 加密 / 敏感数据）
- `backend_heavy` — 后端核心面（数据库 schema / API contract / 服务边界）
- `data` — 数据迁移 / 持久化 schema delta / 关键查询

命中 → Codex 第二意见，**只针对 spec §1 成功标准 + 跨 task contract一致性**（不重审单 task 代码质量）。

```
1. 生成 review_cycle_id = {workflow_id}-{commitHash}-{timestamp}
2. dispatch 后台 Codex (--adversarial-review, prompt 聚焦：spec §1 成功标准是否兑现 / 跨 task contract是否前后一致 / 整workflow是否引入未声明的contract变化)
3. 5 min 超时降级；缺失方 = 仅本会话 Stage 1 结论
4. 合并 Codex finding + 本会话 Stage 1 finding；verified Critical/Important 仍未修 → fail
5. 标注 codex-status: ok | codex_degraded
```

详细 prompt + finding 归一化清单：[`references/codex-spec-augmentation-checklist.md`](references/codex-spec-augmentation-checklist.md)。

**预算**：codex_enhanced 合并判定算 1 次 attempt（共享 4 次预算）。Codex 调用本身不消耗 retry 预算。

未命中 risk_signals → 直接跳过 3.2，仅做 3.1 终态卫生。

### 判定

| 结果 | 处理 |
|------|------|
| `Approved` | 关卡通过,进入 Step 4 |
| `Issues Found`(Critical/Important) | 修复 → 重新 review(消耗共享预算);修复后回 Stage 2 入口 |
| `Budget Exhausted` | 4 次共享预算耗尽 → `quality_review.js fail --failed-stage stage2` 标记终态 `rejected` |

### Stage 2 修复后触发轻量 Stage 1 复核

仅在 Stage 2 修复涉及 spec 对照面（如改了contract shape）时触发，确保修复未引入新的 spec 偏差。终态卫生类修复（写 report_path / 处理未提交改动）不触发 Stage 1 复核。

### 降级执行(不支持子 Agent / Codex 不可用)

risk_signals 命中但 Codex 不可用 → label 标 `codex_enhanced (codex_degraded)`，仅本会话 Stage 1 结论作为 Stage 2 spec-级判定。本会话执行的终态卫生 3.1 不受影响。

## Step 4: 记录 review 结果

[HG-3] 走 CLI 写入 state，不得手编 JSON。`--project-id` 必填（见 Step 0.1）。

```bash
# 通过
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js pass <taskId> \
  --project-id {projectId} \
  --base-commit <baseCommit> --current-commit <currentCommit> \
  --from-task <fromTask> --to-task <toTask> --files-changed <n> \
  --stage1-attempts <n> --stage2-attempts <n> \
  --review-mode <single_reviewer|codex_enhanced> \
  --codex-status <ok|codex_degraded|null>  # codex_enhanced 时必填

# 未通过
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js fail <taskId> \
  --project-id {projectId} \
  --failed-stage <stage1|stage2|stage1_recheck> \
  --base-commit <baseCommit> --total-attempts <n> \
  --last-result-json '<json>'

# 查询
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js read <taskId> --project-id {projectId}
```

[HG-3] checkpoint 行（强制输出）：
```
Review recorded: quality_review.js pass {taskId} → overall_passed={true|false}
```

CLI 失败按顺序恢复：

1. 去掉 `--base-commit` 重试 → 让 CLI 自己 `resolveReviewBaseline`
2. 仍报 `缺少质量关卡基线` → 修 `state.initial_head_commit`（补齐或重算）后重跑
3. node 缺失（CLI 本身不可用）→ checkpoint 行标注 `(CLI unavailable)` 并上报用户，不再尝试写 state

**禁止**：`--base-commit HEAD --current-commit HEAD`（空 diff 绕过）；手动编辑 `quality_gates.*`。

### Review 模式标注 + 预算遥测

记录前先输出 `📋 Review mode: <label>`：

| label | 含义 |
|-------|------|
| `single_reviewer` | Stage 1 主任务 + Stage 2 终态卫生（默认；risk_signals 未命中） |
| `codex_enhanced` | Stage 1 主任务 + Stage 2 终态卫生 + Codex spec-级第二意见 |
| `degraded-inline` | risk_signals 命中但 Codex 不可用，标 `codex_enhanced (codex_degraded)` |

每次未通过后输出 `审查预算：attempt ${current}/${max}，剩余 ${remaining} 次`。

## Step 5: 处理 review 反馈

收到 review 反馈(Stage 1、Stage 2、Codex)后按结构化协议处理。详见 [`references/review-feedback-protocol.md`](references/review-feedback-protocol.md)。

## Step 6: 状态推进

[HG-3] 调 CLI 推进，按返回的 `outcome` 翻译成用户消息:

```bash
# 通过 → completed
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js --project-id {projectId} advance --review-passed

# 失败 → 回退 running
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js --project-id {projectId} advance --review-failed --failed-tasks "T3,T5"
```

CLI 不可用时手动写入须同时设置 `status` + `completed_at`，标注 `(manual advance, CLI unavailable)`。

**输出模板**:
- 通过 → `✅ 审查通过，workflow 已 completed。可 /workflow-archive 归档。`
- 失败 → `❌ 状态回退为 running。失败任务：{failed_tasks}。请 /workflow-execute --retry。`
- 预算耗尽(4/4) → `🛑 审查预算耗尽。阻塞：{列表}。建议手动修复后重新 /workflow-review。`

通过路径且发现可沉淀模式时附 `💡 建议 /spec-update 沉淀到 .claude/code-specs/`。

## Red Flags

HARD-GATE 已覆盖的不重复（HG-1..HG-5）。剩余启发式反模式：

- 信任实现者自述而不独立读源码验证
- 将 Critical 问题降级为 Minor 以规避修复
- 跳过 review 因为"改动很简单"
- diff 窗口为空但仍标记通过
- 在非 `review_pending` 状态下执行 review
- **重跑 per-task 已覆盖的代码质量 checklist**（HG-5；critical/important 已由 execute Step 5.2 reviewer 把关，本 skill 只补跨 task / 终态维度）

## Scope 路由

本 skill 只处理 `scope: workflow`。`scope: task`（命中 quality gate 的任务完成后）共享 `quality_review.js` 底层 API，但走 execute Step 5.2 reviewer，**不经过本 skill**。两种 scope 对照见 [`references/scope-routing.md`](references/scope-routing.md)。
