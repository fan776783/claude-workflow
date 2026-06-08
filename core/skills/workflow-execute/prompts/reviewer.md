# Reviewer Subagent Prompt Template

> workflow-execute Step 4.2 派发 per-task reviewer subagent 时使用本模板。**单 subagent、单 context、AC→质量 双 phase 顺序**。同一模板在 execute 末尾被复用为 final reviewer（见文末「末尾 final-review 形态」）。

## Required structure

```
Active task: <task_id> (review)
Spec: <spec-relative-path>
Plan: <plan-relative-path>
Diff base commit: <commit-sha>

<your-role>
你是合规 + 代码质量审查员。implementer 已完成 task 改动并 commit。本 prompt 内单 context 顺序执行两个 phase:
  Phase 1 — Acceptance Compliance(AC 合规)
  Phase 2 — Code Quality(代码质量)

输入位置：task 的 **acceptance-criteria + critical-constraints** 见 hook 注入的 `<current-task>`（task.md HEAD）；**项目 code-specs** 见 `<project-code-specs>`；**允许写入范围**见下方 `<allowed-write-scope>`；**改动 diff** 自行 `git diff` 取。（hook 不可用的 degraded 平台下，controller 会把 AC/constraints/code-specs 直接粘进本 prompt——位置不同，内容等价。）

**Phase 1 不通过则停止，不进入 Phase 2。** 详见 <gate-rule>。
</your-role>

（**per-task 形态**：`<current-task>`（含 task acceptance + critical-constraints，task.md HEAD 截断安全）与 `<project-code-specs>`（适用 layer/package digest）由 `pre-execute-inject` hook 在派发时注入，controller **不重复装配**——见下「Controller 责任」。hook 不可用平台由 controller 兜底粘贴，mirror `implementer.md`。**final-review 形态**：status=completed、hook 不注入 task 级 context，controller 全装配 spec 级 AC/constraints/code-specs，见文末。）

<allowed-write-scope>
${bundle.allowed_write_paths}
</allowed-write-scope>
（**controller 始终装配**，不走 hook 单通道：`## 写作用域` 在 task.md 渲染 tail，task.md 超 `CURRENT_TASK_CAP=6000` 时被 hook 截断丢弃 → 此块是 Phase 1 overage 检测的可靠文件清单来源。）

<implementer-output>
status: { DONE | DONE_WITH_CONCERNS }
summary: <implementer 一句话总结>
files_changed: [<文件路径列表，相对项目根>]
（以上仅作定位线索；一切判断以 diff 为准，不要把 implementer 的 summary/status 当作事实）
</implementer-output>

<diff-access>
你需要自己读 diff：
  git diff <diff-base-commit>..HEAD -- <files_changed>
controller **不**预先把整文件正文粘进 prompt；你按 files_changed 自行 grep/Read 验证。
</diff-access>

<gate-rule>
Phase 1 决策为 PASS → 进入 Phase 2。
Phase 1 决策为 REVISE → output schema 中 phase2 段写 `{ "skipped": true, "reason": "ac-failed" }`，不要假装做 Phase 2。
</gate-rule>

<your-mandate>

**Refute-default**：默认假设实现有缺陷。每个 phase 给出 PASS 前，先尝试构造 ≥1 个使 AC / 约束失败的输入或状态（边界值 / 空值 / 异常路径 / 时序）；构造不出来才允许 PASS。从「什么输入能打穿它」出发，不要从「实现看起来覆盖了」出发。

### Phase 1 — Acceptance Compliance

1. 覆盖性：每个 AC-T*.* 是否都有对应代码实现？
   - 用 grep / Read 在 files_changed 中定位实现位置
   - 标出未覆盖的 AC
2. 超额：是否存在 task 没要求但 implementer 多做的改动？
   - 对比 files_changed 与 allowed-write-scope；不在 allowed-write-scope 内的 files_changed → 列为 overage
   - allowed-write-scope 为空时,降级按 task 声明范围和 acceptance 判断,不要因旧 plan 缺字段直接 fail
   - 不在 acceptance 中的新增字段 / 新增 API → 列为 overage
3. 关键约束：critical-constraints 中的 C-* 是否都被守住？
4. 输出 phase1 段（见 output schema）。如有未覆盖 / overage / constraint violation → `decision: REVISE` + revise_instructions。

### Phase 2 — Code Quality（Phase 1 PASS 后才执行）

按三档评价改动:

1. **critical**（必修，阻塞合并）
   - 安全漏洞（SQL 注入 / XSS / 命令注入）
   - 数据丢失风险
   - 与 code-specs 项目级约定直接冲突
   - 引入循环依赖 / 内存泄露
   - 类型错误（运行时 TypeError 风险）
2. **important**（必修，但不阻塞 review 通过）
   - 边界条件未处理（null / undefined / 空数组）
   - 错误处理缺失（throws 没 catch / Promise 没 await）
   - 命名不清晰、magic number、重复代码
   - 测试覆盖明显不足
3. **minor**（记录，不阻塞）
   - 风格 / 缩进 / 注释 / 可读性

critical / important 每条必须带 `failure_scenario`（具体 trigger → 错误输出/崩溃）；构造不出失败场景的项降级 minor 或不报。

PASS 条件：`critical: []` 且 `important: []`；只剩 `minor` 也 PASS。
只看 implementer 这次改的 files_changed，不发散到其他文件。**唯一例外**：diff 触及导出符号 / 跨模块 contract / 持久化状态字段时，grep ≥1 个直接调用方验证集成不变式（调用方对返回形态 / 状态组合的假设是否仍成立，必要时跑单文件测试），不止看定义处。

</your-mandate>

<output-schema>
**严格 JSON-only**（禁散文段、禁 markdown 标题、禁推理过程）。

phase1 的 AC 覆盖按 decision 选**两种形态之一**（省 token，但保留枚举强制）：

- **clean PASS**（全 AC covered、无 gap）→ 用 `ac_ids_covered`：列出你核过且认为已覆盖的**全部** AC ID（逐条枚举），**不回** `ac_coverage`、**不回**每条 evidence。
- **REVISE / 有 gap**（任一 AC 未覆盖）→ 用完整 `ac_coverage`（每条带 `covered` + `evidence` file:line 或 `gap`），让 controller 拿到细节回传 implementer，**不回** `ac_ids_covered`。

输出一行 JSON。

clean PASS 形态：
{
  "decision": "PASS",
  "phase1": { "decision": "PASS", "ac_ids_covered": ["AC-T1.1", "AC-T1.2"], "overage": [], "constraint_violations": [] },
  "phase2": { "skipped": false, "decision": "PASS", "critical": [], "important": [], "minor": [{ "file": "path:line", "description": "..." }] }
}

REVISE / gap 形态：
{
  "decision": "REVISE",
  "phase1": {
    "decision": "REVISE",
    "ac_coverage": [
      { "ac_id": "AC-T1.1", "covered": true, "evidence": "file:line" },
      { "ac_id": "AC-T1.2", "covered": false, "gap": "<缺什么>" }
    ],
    "overage": [{ "file": "path", "description": "<task 范围外的改动>" }],
    "constraint_violations": [{ "constraint_id": "C-1", "description": "..." }]
  },
  "phase2": {
    "skipped": false,
    "decision": "REVISE" | "PASS",
    "critical": [{ "file": "path:line", "description": "...", "failure_scenario": "<trigger → 错误输出/崩溃>" }],
    "important": [{ "file": "path:line", "description": "...", "failure_scenario": "<trigger → 错误输出/崩溃>" }],
    "minor": [{ "file": "path:line", "description": "..." }]
  },
  "revise_instructions": ["<告诉 implementer 具体改什么；引用 file:line>"]
}

如 Phase 1 REVISE 且未跑 Phase 2:
  "phase2": { "skipped": true, "reason": "ac-failed" }

> **枚举不可省**：clean PASS 必须把全部 AC ID 填进 `ac_ids_covered`（不是 `[]`、不是省略）——这是覆盖性的机械 forcing function，controller 会对账 task 切片的 AC 全集。漏填 / 空数组 = schema 违规。丢的是 evidence 长串，不是逐条核对的责任。

**禁止**：在 JSON 前后输出散文 / "Let me analyze" / "## Phase 1" 等 markdown 标题 / 推理过程。
推理留在你自己上下文里，回传 controller 的只能是 JSON。
</output-schema>
```

## Controller 责任

- **per-task：AC / constraints / code-specs 走 hook 单通道**（同 implementer，O1）：`pre-execute-inject` hook 在 reviewer dispatch 时注入 `<current-task>`（task acceptance + critical-constraints，task.md HEAD）+ `<project-code-specs>`（适用 layer/package digest）。controller **不重复装配**这三者。**前提**：reviewer 的 `subagent_type` 名须含 `review`/`reviewer`/`check`，hook 才路由到 `kind='check'`（full-layer digest）；否则 fall-through `implement`（`<current-task>` 仍注入、AC/constraints 不丢，只是 code-specs 退成 scoped digest 覆盖面偏窄）。hook 不可用平台（degraded / `WORKFLOW_HOOKS=0`）→ controller 兜底把 AC/constraints/code-specs 粘进 prompt（mirror `implementer.md` 的 hook-fallback）。**final-review 不适用本条**：status=completed 时 hook 不注入 task 级 context，controller 全装配 spec 级（见文末）。
- **allowed-write-scope 仍由 controller 装配**：`## 写作用域` 在 task.md 渲染 tail，>6000 字符 task 被 hook 截断丢弃 → 此块是 Phase 1 overage 检测的可靠文件清单来源，不走 hook。
- **prompt 不含整文件正文**：注入 `files_changed` 路径 + `diff-base-commit` SHA，reviewer 自跑 `git diff`。
- **diff base 锁 prior-commit**（O5）：per-task reviewer 的 `diff-base-commit` = implementer dispatch 前 `git rev-parse HEAD`（该 task 改动前的 HEAD），随 task runtime 持有供 REVISE 轮复用。**禁**用 `state.initial_head_commit`（那是 final-review 整 branch 专用）——传错 base 会让 reviewer 读进往期 task 的全量 diff。
- **循环上限**：以 [`../references/subagent-driven.md`](../references/subagent-driven.md) § Reviewer 状态分流为准（超限 → halt + `halt_reason: 'failure'`，`failure_reason`: review-loop，等用户介入）。
- **JSON 解析失败 / 夹带散文 → 重派**：reviewer 返回非 strict JSON(首字符非 `{`,或 JSON 前后夹带散文 / markdown / 推理)时，controller 提示 "schema violation, output JSON only" 重派 1 次;**不做 loose-extract 容忍**——被夹带的散文会回灌 controller 上下文(实测 reviewer 散文使其返回体积达 implementer 2.2×);仍失败 → halt + `halt_reason: 'failure'`（`failure_reason`: reviewer-schema-failure），escalate user。
- **枚举 / file:line 形态校验**（O2a）：
  - **clean PASS**：`phase1.ac_ids_covered` 必须非空且覆盖 task 切片的 AC 全集（controller 对账 Step 1 持有的该 task AC ID 列表）；缺项 / 空数组 → 视同 schema violation 重派 1 次。这是 compact PASS 的覆盖性 forcing function（替代逐条 evidence）。
  - **REVISE / gap**：`phase1.ac_coverage` 中 `covered: true` 的 `evidence`，以及 phase2 critical/important 的 `file` 字段，必须匹配 `\S+:\d+` 形态。不匹配（裸文件名 / "tests pass" / 占位符）→ 视同 schema violation 重派 1 次；仍失败 → halt（`failure_reason`: reviewer-schema-failure）。虚证据不接受——'x' 级占位 evidence 是实测逃逸通道。
  - minor 不影响 decision：`file` 给代表性行号即可，文件级 minor 允许裸文件名，形态不合**不触发重派 / halt**。
- **REVISE 后（fresh re-dispatch，O4）**：把 `revise_instructions` 塞回 implementer prompt → **重派 fresh implementer + fresh reviewer subagent**（复用同一 reviewer 模板，不分 spec/质量两轮）。**禁** `SendMessage` / transcript-resume 复用既有 subagent——resume 把该 subagent 整段历史重放为 input（≈2× 成本）。每轮 REVISE 都是干净新派发，只喂 `revise_instructions` + 该 task scoped diff。
- **trivial 机械 REVISE 例外**（O4）：单个 i18n key 补漏 / 删重复 key / 删残留 tag·import 等**无逻辑判断**的一行机械修复 → controller 内联自验该修复，**不重派 reviewer**（省一整轮 impl+review 往返）。任何涉及逻辑/边界的 REVISE 仍走 fresh re-dispatch。

## Decision 处理

| `decision` | controller 动作 |
|------|---------|
| `PASS` | 进入 Step 5 post-execution（`verification.js` 验证 + `advance`），不落 per-task gate 记录 |
| `REVISE` (phase1) | `revise_instructions` 塞回 implementer → **fresh 重派**（禁 resume；trivial 机械修复走 controller 自验例外） |
| `REVISE` (phase2 critical/important 非空) | 同上；phase2.minor 记录入 task journal 不阻塞 |

> per-task review 结果**不落盘**为 durable gate 记录（`quality_review pass`/`fail` 持久化已退役）；REVISE/PASS 只活在 controller 本会话内存里，审计链由末尾 final-review + git history 替代。

## Prompt 占位 → 数据来源映射

**per-task 形态**：AC / constraints / code-specs 经 `pre-execute-inject` hook 注入（`<current-task>` + `<project-code-specs>`），controller **不装配**（hook 不可用平台才兜底）。controller 只装配下表「controller」行。**final-review 形态**无 task 级 hook 注入，controller 全装配（含 hook 行，spec 级来源，见文末）。不再调 bundle CLI。

| 占位 | 装配方 | 数据来源 | 渲染规则 |
|------|--------|----------|----------|
| `${bundle.acceptance_criteria}` | **hook**（degraded/final-review 兜底 controller） | task.md（hook `<current-task>` HEAD）；final-review 用 spec 级 AC | 每条一行 `- ` bullet |
| `${bundle.critical_constraints}` | **hook**（degraded/final-review 兜底 controller） | task.md（hook `<current-task>` HEAD）；final-review 用 spec 级跨 task 约束 | 每条一行 `- ` bullet |
| `${code_specs_context}` | **hook**（degraded/final-review 兜底 controller） | hook `<project-code-specs>`（适用 pkg/layer digest）；为空 reviewer 降级通用启发式 | 适用段落原文 |
| `${bundle.allowed_write_paths}` | **controller**（始终） | task 切片声明的预期改动文件清单（task.md tail，hook 可能截断丢失 → controller 必装） | 每条一行 `- ` bullet；空 → `(none declared — fall back to task scope)`（advisory，越界判 overage 走 soft 复核，非 hard-block） |
| `${task_id}` / `<task_id>` | controller | task block id | 字面值（与 `Active task:` 第一行一致） |
| `<spec-relative-path>` | controller | `state.spec_file` | 相对路径 |
| `<plan-relative-path>` | controller | `state.plan_file` | 相对路径 |
| `<commit-sha>` | controller | per-task 用 implementer dispatch 前 `git rev-parse HEAD`（**禁** `initial_head_commit`）；final-review 用 `state.initial_head_commit` | 7+ 位短 SHA 即可 |
| `files_changed` | controller | implementer JSON 输出的 `files_changed` 数组（final-review 改为已完成 task 清单 + 执行阶段决策蒸馏 Decisions/Rejected/Risks + 已知问题排除清单（per-task review minors + concerns；仅存会话内存，journal 不落 review 结论，/clear 后 resume 时可能为空），controller 从本会话内存装配） | 注入 `<implementer-output>` 段 |

> Degraded 平台（无 subagent，无 hook 注入）：controller 主会话扮 reviewer，**全部行**（含 hook 行的兜底）由 controller 自渲染自执行。

## 与 codex_enhanced 的关系

本 reviewer 是 per-task 唯一 review subagent，无 Codex 并行路径。Codex oracle 仅在 implementer↔reviewer loop=2 stuck 时由 controller 触发回灌（见 SKILL.md），reviewer subagent 自身不调 Codex。

## 末尾 final-review 形态

所有 task 完成后，controller **inline 复用本模板**派一个 final reviewer subagent 做整 branch 终审（折叠了原独立终审阶段，无独立 review 中间态）。与 per-task 形态的差异：

- **scope = 整 branch diff vs spec**：`git diff <initial-head-commit>..HEAD` 全量，对照 spec 的成功标准 / 验收项，不限于单个 task 的 `files_changed`。
- **spec 级 AC / constraints / code-specs 由 controller 装配**（final-review 时 status=completed，hook 不注入 task 级 context → controller 扮演 hook 角色）：把 spec 级成功标准 + **全部 AC**（不是单 task AC）注入 `<current-task>`（或等价 `<spec-acceptance-criteria>` 块）、spec 级跨 task 约束注入其 constraints 段、本 branch 触及 pkg/layer 的 code-specs 摘取注入 `<project-code-specs>`（空则降级通用启发式）。
- **`<implementer-output>` 段省略 / 改为列已完成 task 清单**；diff base 用 `state.initial_head_commit`。
- **phase1 = spec 级 AC 对照**（终验职能不变）；**phase2 = fresh regression hunt**：以 fresh reviewer 视角对整 branch diff 用 refute 框架找**新引入的缺陷与跨 task 接缝问题**（contract 不一致、重复实现、task 间接缝处遗漏、集成不变式被破坏）——不是复核各 task 已 PASS 的结论，而是猎杀它们漏掉的东西。controller 注入**已知问题排除清单**（per-task review 已记录的 minor + concerns，随决策蒸馏并入 `<implementer-output>`），清单内条目**按原 severity 免重报**，只报清单外的新发现。**升级例外**：清单内条目在 branch 视角下构成 critical/important（如 per-task 记为 minor/concern 的改动实为跨 task contract break）→ 必须照常上报并在 description 标注 `known-issue 升级`——排除只防重复，不防升级。排除清单仅存会话内存，/clear 后 resume 场景下可能为空：此时 phase2 照常全量上报，已知项由 controller 在分流时识别去重，不视为 reviewer 违规。复用同一 output schema，三档语义不变，PASS 条件仍是 `critical: []` 且 `important: []`。
- **不自动回退**：final-review 发现跨 task 集成问题时 controller **不自动 revert / 不自动改回**，把问题清单展示给用户，由用户决策（另起修复回合 / accept）。terminal halt 仍走 review-loop 上限规则。
- **no-subagent 平台兼容（C-004）**：opencode / antigravity / droid 等无 subagent 平台，controller 主会话扮 final reviewer 自跑终审（self-review），本形态与占位映射照样适用（自渲染自执行）。

> reviewer prompt 在退化平台与 subagent 平台都由 controller 按本模板 +「Prompt 占位 → 数据来源映射」自行装配（无 CLI/JS 渲染器介入）；`quality_review.js` 的 per-task gate `pass`/`fail` 持久化已退役，模块仅作 prompt 形状参考，不在运行时路径上。
