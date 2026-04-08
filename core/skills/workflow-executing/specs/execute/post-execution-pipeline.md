# Post-Execution Pipeline

> 从 `execution-modes.md` 拆分。所有执行模式共享的后置管线。

## 快速导航

- 想看 6 步总管线：看开头总览
- 想看验证铁律：看 Step 6.5
- 想看 plan/state 更新顺序：看步骤表与后续章节
- 想看审查触发：结合 `../../workflow-reviewing/specs/execute/subagent-review.md` 与 `../../references/execution-checklist.md`

## 何时读取

- 需要确认 task 完成后必须按什么顺序做后置动作时
- 需要实现或审查 executeTask() 的完成路径时

> ⚠️ 跳过任何一步即为执行违规。

每个任务执行完成后，必须依次经过以下 6 步。**权威定义参见 `../../references/execution-checklist.md`。**

```
executeTask() → ①验证（Step 6.5）→ ②自审查/合规检查（Step 6.6-6.7）→ ③更新 plan.md → ④更新 state.json → ⑤审查（条件触发）→ ⑥Journal（条件）→ 下一 Task
```

| 步骤 | 对应实现 | 说明 |
|------|---------|------|
| ① 验证 | Step 6.5 | 失败 → 标记 `failed`，后续步骤全部跳过 |
| ② 自审查 + 合规检查 | Step 6.6 + 6.7 | 建议性，永不阻塞 |
| ③ 更新 plan.md | `task_parser.update_task_status_in_markdown()` | 单次只改一个 task block 的状态语义，禁止批量回写 |
| ③→④ Checkpoint 原子性 | — | ③ 成功 ④ 失败时触发恢复协议（见下方） |
| ④ 更新 state.json | Step 7 | 更新 progress + current_tasks + updated_at |
| ⑤ 审查（条件触发） | — | quality_review → 完整两阶段审查（子 Agent）；每 3 个常规 task → 轻量合规；最后 task → 全量审查 |
| ⑥ Journal（条件） | — | 质量关卡/暂停/完成时记录 |

**适用范围**：直接模式和 Subagent 模式均适用。所有完成型执行路径（continuous / phase / retry 中真正完成 task 的情况）在调用 `executeTask()` / `executeTaskInSubagent()` 后，都必须经过完整 6 步管线。Step 6.5 → 6.6 → 6.7 为内联检查（建议性，不阻塞）；步骤 ⑤ 的完整两阶段审查由子 Agent 执行（或降级为角色切换），仅在满足触发条件时执行（详见 `specs/execute/subagent-review.md`）。并行执行时，每个并行任务独立经过此管线；具体 dispatch / wait / cleanup / conflict fallback 规则遵循 `../../dispatching-parallel-agents/SKILL.md`。`skip` 为显式例外路径，仅更新 plan/state 并标记 `skipped`，不进入完整完成流水线。

---

## Step 6.5：完成验证（Verification Iron Law）

**铁律：没有新鲜验证证据，不得标记任务为 completed。**

### 验证证据格式

每次验证必须产生结构化证据记录：

```typescript
interface VerificationEvidence {
  command: string;       // 执行的验证命令
  exit_code: number;     // 退出码
  output_summary: string; // 输出摘要（截取关键行，≤ 500 字符）
  timestamp: string;     // ISO 8601 时间戳
  passed: boolean;       // 是否通过
  artifact_ref?: string; // 关联产物引用（如 quality_gates.T8）
}
```

### 验证命令映射

根据任务 action 类型确定验证方式：

| Action | 验证命令 | 通过条件 |
|--------|----------|----------|
| `create_file` / `edit_file` | 运行相关测试 或 语法检查 | 测试通过 或 无语法错误 |
| `run_tests` | 读取测试输出 | 全部通过，exit_code = 0 |
| `quality_review` | 读取两阶段审查结果 | `quality_gates[taskId].overall_passed === true` |
| `git_commit` | `git log -1 --format="%H %s"` | commit hash 存在且消息匹配 |

### 执行流程

1. **识别验证命令**：根据任务 action 类型查表
2. **执行验证命令**：实际运行命令
3. **读取输出**：必须读取命令输出（禁止忽略）
4. **步骤级验证**：逐项检查 `steps[]` 中每个步骤的预期结果是否满足
5. **生成证据**：填充 `VerificationEvidence`
6. **判定结果**：
   - 通过 → 继续 Step 6.6
   - 失败 → 标记 `failed`，记录 `failure_reason`，禁止标记 `completed`

### 硬性 Gate：证据完整性校验

在 Gate Function 执行完毕后、进入 Step 6.6 之前，必须校验 `VerificationEvidence` 的完整性。**缺失任一必填字段 = 验证未完成，禁止进入 Step 6.6+。**

```typescript
function assertEvidenceComplete(evidence: VerificationEvidence): void {
  // 必填字段校验
  const required: (keyof VerificationEvidence)[] = [
    'command', 'exit_code', 'output_summary', 'timestamp', 'passed'
  ];
  for (const field of required) {
    if (evidence[field] === undefined || evidence[field] === null) {
      throw new Error(`验证证据不完整：缺少 ${field}，禁止进入 Step 6.6+`);
    }
  }

  // 新鲜度校验：timestamp 必须为本次执行期间（≤ 15 分钟内，兼容长时间测试）
  const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;
  const age = Date.now() - new Date(evidence.timestamp).getTime();
  if (age > FRESHNESS_WINDOW_MS) {
    throw new Error(`验证证据过期：timestamp 距今 ${Math.round(age / 1000)}s，必须使用本次运行的新鲜结果`);
  }

  // 一致性校验：passed 与 exit_code 必须逻辑一致
  if (evidence.passed && evidence.exit_code !== 0) {
    throw new Error(`验证证据矛盾：passed=true 但 exit_code=${evidence.exit_code}`);
  }
  if (!evidence.passed && evidence.exit_code === 0) {
    // quality_review / artifact_ref 类验证允许 exit_code=0 + passed=false（审查未通过但命令本身执行成功）
    if (!evidence.artifact_ref) {
      throw new Error(`验证证据矛盾：passed=false 但 exit_code=0 且无 artifact_ref`);
    }
  }
}
```

**验证类型分类**：
- **Shell 验证**（`create_file`、`edit_file`、`run_tests`、`git_commit`）：`command` 必须为实际执行的 shell 命令（如 `git log -1 --format="%H %s"`）
- **Artifact 验证**（`quality_review`）：`command` 字段可为描述性文本（如 `"two-stage code review"`），但 `artifact_ref` 必须存在且指向有效产物（如 `quality_gates.T8`）

> 注意：`git_commit` 属于 shell 验证，不属于 artifact 验证。其验证命令为 `git log -1 --format="%H %s"`，通过条件为 commit hash 存在且消息匹配。

### 验证门控函数（Gate Function）

在声称任何状态前，必须通过此门控：

```
1. IDENTIFY：什么命令能证明此声明？
2. RUN：执行完整命令（新鲜的、完整的）
3. READ：完整输出，检查退出码，计数失败
4. VERIFY：输出是否确认了声明？
5. ASSERT_COMPLETE：调用 assertEvidenceComplete() 校验证据完整性
6. ONLY THEN：发表声明
```

| 声明 | 需要的证据 | 不充分的证据 |
|------|-----------|-------------|
| "测试通过" | 测试命令输出：0 failures | 之前的运行、"应该通过" |
| "Lint 干净" | Linter 输出：0 errors | 部分检查、推测 |
| "构建成功" | 构建命令：exit 0 | Linter 通过 ≠ 构建通过 |
| "Bug 已修复" | 原始症状测试通过 | "代码改了" |
| "需求已满足" | 逐项对照 Spec 验收标准 | 测试通过 ≠ 需求满足 |

### 红旗清单

出现以下情况说明在跳过验证：

**模糊措辞**：
- 使用"应该没问题"、"看起来正确"、"大概通过了"
- 使用"应该"、"可能"、"似乎"等不确定措辞
- 在验证前表达满意（"好了！"、"完成！"）

**验证缺失**：
- 没有运行任何命令就标记完成
- 只运行了部分验证就声称全部通过
- 引用之前的测试结果而非本次运行结果
- 验证命令的输出没有被读取就声称通过

**过早满足**：
- 代码编译通过就声称完成（编译 ≠ 正确）
- Linter 通过就声称构建成功（Linter ≠ 编译器）
- 单元测试通过就声称需求已满足（测试通过 ≠ 需求覆盖）

**信任代理报告**：
- 信任 subagent 的成功报告而不独立验证
- 信任外部工具的"success"输出而不检查细节

**以上任何一条触发：运行验证命令，读取输出，然后才能声称结果。**

---

## Step 6.6：自审查（Self-Review Checklist）

> 单次建议性检查。在验证通过后、规格合规检查前捕获明显问题，减少后续审查循环。

**适用条件**：`create_file` 和 `edit_file` 类型任务
**跳过条件**：`run_tests`、`quality_review`、`git_commit` 类型任务

### 自审查清单

| 类别 | 检查项 |
|------|--------|
| **完整性** | 每个新函数/方法都有测试？ |
| **完整性** | 边界条件和错误路径都有覆盖？ |
| **正确性** | 测试用例的失败原因是功能缺失（非语法错误）？ |
| **正确性** | 每个测试都观察到了红-绿转换？ |
| **质量** | 代码中无硬编码的魔法数字/字符串？ |
| **质量** | 错误处理覆盖了所有外部调用？ |
| **质量** | 无重复代码（DRY）？ |
| **安全** | 用户输入都有验证和清理？ |
| **安全** | 无敏感信息硬编码？ |
| **一致性** | 命名风格与项目现有代码一致？ |
| **一致性** | 实现与 `spec_ref` / `plan_ref` 指向的规范与计划一致？ |

### 执行方式

- 单次通过，运行一次即结束
- 输出未通过项的警告
- **永不阻塞**：无论结果如何，始终继续 Step 6.7
- 目的：提前发现明显问题，减少外部审查循环次数

---

## Step 6.7：规格合规检查（Spec Compliance Check）

对 `create_file` 和 `edit_file` 类型的任务，在验证通过后执行只读规格合规检查。

**跳过条件**：
- `run_tests`、`git_commit` 类型的任务跳过
- `quality_review` 类型任务跳过（由两阶段审查的 Stage 1 接管，详见 `../../workflow-reviewing/specs/execute/actions/quality-review.md`）
- 任务无 `acceptance_criteria` 时跳过

**检查内容**：

1. **验收项覆盖**：任务关联的验收项是否都被实现覆盖
2. **规范与计划一致**：实现是否与 `spec_ref` 指向的规范章节、`plan_ref` 指向的计划步骤一致
3. **需求完整性**：`steps[]` 描述的执行意图是否完整实现

**执行方式**：
- 当前模型直接检查（不调用外部模型，保持轻量）
- 读取任务的验收项内容，逐项比对实现代码

**检查结果**：

| 结果 | 处理 |
|------|------|
| 全部覆盖 | 输出通过结果，继续 Step 7 |
| 存在偏差 | 输出偏差列表，建议补充 task 或回看 spec，当前 task 仍按验证结果保持完成 |
| 严重偏差（缺失核心功能） | 输出严重偏差警告，并要求在后续质量关卡或人工审查中处理；当前步骤本身不单独将 task 标记为 `failed` |

---

## Step ③→④：Checkpoint 原子性守卫

`plan.md`（Step ③）和 `workflow-state.json`（Step ④）必须视为一个逻辑 checkpoint。当 ③ 成功但 ④ 失败时，系统处于不一致状态，必须执行恢复协议。

### 单 Task Block 约束

一次状态推进只允许改变一个 canonical task block（`## Tn:`）的状态语义。若检测到单次写入导致多个 task 的状态同时变更，**拒绝该写入**并要求逐 task 执行。

### 部分成功恢复协议

```typescript
async function checkpointTaskCompletion(taskId: string, planPath: string, statePath: string): Promise<void> {
  // Step ③：更新 plan.md
  const planUpdated = await updatePlanTaskStatus(taskId, planPath);
  if (!planUpdated) {
    throw new Error(`Plan 更新失败：${taskId}，task 保持当前状态，不进入 Step ④`);
  }

  // Step ④：更新 workflow-state.json
  try {
    await updateWorkflowState(taskId, statePath);
  } catch (stateError) {
    // ③ 成功但 ④ 失败 = 不一致状态
    // 恢复协议：回滚 plan.md 中该 task 的状态标记
    await revertPlanTaskStatus(taskId, planPath);
    throw new Error(
      `State 更新失败（${stateError.message}），已回滚 plan.md 中 ${taskId} 的状态。` +
      `请检查 ${statePath} 的写入权限和文件完整性后重试。`
    );
  }
}
```

### 不一致检测（恢复启动时）

执行器在 Step 1 读取状态时，应检测 plan.md 与 workflow-state.json 之间的一致性：
- 若 plan.md 标记某 task 为 completed 但 state.json 的 `progress.completed` 不包含该 ID → 以 state.json 为权威，将 plan.md 回滚
- 若 state.json 包含某 completed ID 但 plan.md 未标记 → 以 state.json 为权威，更新 plan.md

### 双重故障处理

若 `revertPlanTaskStatus()` 本身也失败（即 ③ 已写入、④ 写入失败、③ 回滚也失败），进入**双重故障**状态：

1. 输出双重故障警告，包含 plan.md 和 state.json 的当前不一致详情
2. 将不一致记录写入 `~/.claude/workflows/{projectId}/inconsistency.log`（追加模式）
3. 终止当前执行，要求用户手动检查并修复后重启

> 注意：`checkpointTaskCompletion()` 描述的是执行器应遵循的行为协议。当前权威 helper（`task_manager.js`）尚未实现回滚能力，执行器需在调用 helper 之上自行实现回滚逻辑（重新读取 plan.md 并撤销标记变更）。
