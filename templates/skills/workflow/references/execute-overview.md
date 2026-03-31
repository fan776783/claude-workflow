# workflow execute - 执行任务概览 (v3.2)

> 本文件为摘要层，不定义新的状态字段、触发规则或执行语义；具体行为以 `references/execute-entry.md`、`references/state-machine.md` 与 `specs/execute/*.md` 为准。
>
> 精简接口：默认治理 continuous 模式，支持自然语言控制执行模式与恢复解析

执行工作流任务。

## 参数

| 参数 | 说明 |
|------|------|
| `--phase` | 阶段模式：按治理 phase 执行并在边界暂停 |
| `--retry` | 重试模式：重试失败的任务 |
| `--skip` | 跳过模式：跳过当前任务（慎用） |

## 自然语言控制

在命令参数或对话中描述意图：

| 用户说 | 系统理解 |
|--------|----------|
| "继续" / "连续" | 连续模式（默认） |
| "下一阶段" / "单阶段" | 阶段模式 |
| "重试" | 等同 `--retry` |
| "跳过" | 等同 `--skip` |

### 恢复解析规则

- `/workflow execute`：显式进入执行器，默认按 `continuous` 模式恢复/继续。
- `/workflow execute 继续`：与默认执行一致。
- 裸自然语言“继续”：仅在存在活动 workflow（`running` / `paused` / `failed` / `blocked`）且当前对话仍处于该 workflow 任务链上时可解释为恢复当前工作流；否则提示用户使用 `/workflow execute` 或 `/workflow status`。
- 是否真正继续执行，始终先由 `ContextGovernor` 判定，而不是只看自然语言意图。

## 执行模式

| 模式 | 说明 | 语义暂停点 |
|------|------|------------|
| 阶段 | 按治理 phase 连续执行 | 治理边界变化时 |
| 连续 | 执行到质量关卡（默认） | 质量关卡 / git_commit |

> 注意：以上仅是语义暂停点；真正是否继续由 `ContextGovernor` 先决定。

> **Subagent / 并行路由**：仅在平台支持且能证明同阶段任务彼此独立时启用；是否使用 `parallel-boundaries` 由 `ContextGovernor` 与独立性检查共同决定，不能仅按任务数量自动开启。
>
> **平台映射**：
> - Claude Code / Cursor：使用 `Task` 子 agent
> - Codex：使用 `spawn_agent` / `wait` / `close_agent`
> - 其他无子 agent 平台：降级为直接模式

---

## 🔍 执行流程概览

> 自 vNext 起，`workflow execute` 采用 **budget-first** continuation governance：
> - 先判断“下一执行单元是否还能安全继续”
> - 再判断“是否应切换为 parallel-boundaries 降低主会话压力”
> - 最后才应用 `step / phase / quality_gate` 的语义暂停点

### Step 0：解析执行模式

解析命令行参数和自然语言意图：
- 检测 `--retry` / `--skip` / `--phase` 标志
- 识别自然语言模式描述（连续/阶段）
- 确定执行模式优先级：显式模式 > 自然语言意图 > `state.execution_mode` > 默认

**详细实现**: 参见 `specs/execute/execution-modes.md`

---

### Step 1：读取工作流状态

读取 `workflow-state.json`，执行状态预检查：
- 检查项目配置（`.claude/config/project-config.json`）
- 验证项目 ID 安全性
- 检查工作流状态文件是否存在
- 状态转换：`planned` → `running`
- 渐进式工作流：检查是否所有任务都被阻塞
- 失败状态：提示使用 `--retry` 或 `--skip`
- 阻塞状态：提示使用 `/workflow unblock`

#### ⚠️ 状态文件自愈（强制）

如果 `workflow-state.json` 不存在，**不得跳过状态管理**，必须立即创建最小状态文件：

```json
{
  "project_id": "<从 project-config.json 读取>",
  "status": "running",
  "current_tasks": ["<plan.md 中第一个未完成任务的 ID>"],
  "plan_file": ".claude/plans/<name>.md",
  "spec_file": ".claude/specs/<name>.md",
  "progress": { "completed": [], "failed": [], "skipped": [] },
  "updated_at": "<当前 ISO 时间>"
}
```

创建后继续执行。参见 `references/state-machine.md` → 最小必需状态。

> ⚠️ 不得因状态文件缺失而跳过整个状态管理层。缺失 = 创建，不是跳过。

---

### Step 2：路径安全校验

使用 `resolveUnder` 函数校验所有路径：
- 实施计划路径（`plan_file`）
- Spec 路径（`spec_file`）
- 确保路径在允许的目录范围内

**详细实现**: 参见 `references/shared-utils.md` 与 `scripts/path_utils.py`

---

### Step 3：上下文预算评估与执行路径候选

**上下文预算评估**：
- 估算当前主会话 token 使用量
- 估算下一执行单元的 projected token 成本（执行 + 验证 + 审查 + 安全缓冲）
- 生成当前使用率与 projected 使用率
- 产出 `ContextGovernor` 所需的 `contextMetrics`

**执行路径候选**：
- 平台检测（Claude Code / Cursor / Codex）
- 检测是否存在同阶段 2+ 可证明独立任务
- 若存在独立边界，评估 `parallel-boundaries` 是否能降低主会话压力
- 若无法证明独立，则降级为顺序执行或单子 agent 隔离执行
- 若 projected 使用率达到危险水位，则优先暂停或 handoff，而不是继续吞下后续任务

**详细实现**: 参见 `specs/execute/execution-modes.md`、`../../../specs/workflow/subagent-routing.md`、`../dispatching-parallel-agents/SKILL.md` 与 `references/shared-utils.md`

---

### Step 4：提取当前任务

从 `plan.md` 中提取当前任务信息：
- 任务 ID 格式校验（防止正则注入）
- 解析任务标题（支持状态 emoji）
- 提取任务字段（阶段、文件、依赖、验收项等）
- 检查任务是否已完成，如是则移动到下一个

**详细实现**: 参见 `references/shared-utils.md`

---

### Step 5：显示任务上下文

显示当前任务的详细信息：
- 任务 ID 和名称
- 阶段和文件
- 需求描述
- 设计参考（如有）
- 可复用组件（如有）
- 依赖任务（如有）
- 验收项（如有）
- 全局约束（从 `plan.md` 提取）

---

### Step 6：执行任务动作

根据任务的 `actions` 字段执行相应动作：

**支持的动作**：
- `create_file`: 创建新文件
- `edit_file`: 编辑现有文件
- `run_tests`: 运行测试
- `quality_review`: 两阶段代码审查（shared review loop contract 的 execution adapter）
- `git_commit`: Git 提交

**执行方式**：
- **Subagent 模式**：单任务可直接按平台路由到 `Task` 或 `spawn_agent`；仅在需要并行分派同阶段独立任务时，先读取并应用 `../dispatching-parallel-agents/SKILL.md`
- **直接模式**：在当前上下文中执行

**详细实现**: 参见 `specs/execute/actions/` 目录

---

### Post-Execution Pipeline（统一管线）

**铁律：没有新鲜验证证据，不得标记任务为 completed。**

每个 task 执行完成后，必须依次完成以下 6 步管线。**详细步骤和 checklist 参见 `references/execution-checklist.md`（唯一权威源）。**

```
Task 完成 → ①验证 → ②自审查/合规检查 → ③更新 plan.md → ④更新 state.json → ⑤审查（条件） → ⑥Journal 记录（条件） → 下一 Task
```

| 步骤 | 名称 | 关键规则 |
|------|------|----------|
| ① | 验证（Verification） | 失败 → 标记 `failed`，后续步骤全部跳过 |
| ② | 自审查 + 规格合规检查 | 建议性，永不阻塞 |
| ③ | 更新 plan.md | 逐 task 立即更新，禁止批量回写 |
| ④ | 更新 workflow-state.json | 更新 progress + current_tasks + updated_at |
| ⑤ | 审查触发检查 | quality_review → 完整两阶段审查；每 3 个常规 task → 轻量合规；最后 task → 全量审查 |
| ⑥ | Journal 记录 | 在质量关卡/暂停/完成时调用 `journal.py add` 记录会话进展 |

> ⚠️ 跳过 ① ~ ⑤ 中任何一步即为执行违规。⑥ 为建议性步骤，在以下时机自动触发：
> - 质量关卡审查完成后
> - `ContextGovernor` 决定暂停时（`pause-budget` / `pause-governance` / `handoff-required`）
> - 工作流完成时（`status: completed`）

#### ⑥ Journal 记录（跨 Session 记忆）

使用 `scripts/journal.py` 持久化会话进展，确保新 Session 启动时可恢复上下文：

```bash
python3 scripts/journal.py add \
  --title "完成 T1-T3 任务" \
  --workflow-id "<project-id>" \
  --tasks-completed "T1,T2,T3" \
  --summary "实现了用户认证模块，通过质量关卡审查" \
  --decisions "选择 JWT 而非 session 方案,API 路径采用 /api/v1 前缀" \
  --next-steps "T4 需要等待后端接口,T5 可继续"
```

**记录内容**：已完成的任务 ID、关键决策、遇到的问题、下一步计划。
**恢复使用**：新 Session 启动时可通过 `journal.py list` 查看最近进展，或 `journal.py search` 检索特定上下文。

**详细实现**: 参见 `specs/execute/execution-modes.md` → Post-Execution Pipeline

---

### Step 7：更新任务状态

完成 Post-Execution Pipeline 后确认最终状态：
- 确认任务已标记为 `completed`（Pipeline 操作 ④⑤ 已完成）
- 记录上下文使用历史与 projected 预算信息
- 更新连续执行计数（仅作为节奏控制，不再单独决定 continuation）

---

### Step 8：ContextGovernor 决定下一步

完成 Post-Execution Pipeline 与 Step 7 后，不再直接按 `execution_mode` 决定是否继续，而是先调用 `ContextGovernor`：

**决策顺序**：
1. 检查是否存在硬停止条件（failed / blocked / retry hard stop / 缺少验证证据）
2. 计算下一执行单元的 projected 成本
3. 检查是否存在同阶段 2+ 独立边界，且是否适合 `parallel-boundaries`
4. 判断是否达到 `warning / danger / hard handoff` 水位
5. 仅当以上都允许继续时，才应用 `phase / quality_gate` 的语义暂停规则

**Continuation actions**：
- `continue-direct`：直接继续顺序执行
- `continue-parallel-boundaries`：按边界并行分派
- `pause-budget`：因预算压力暂停
- `pause-governance`：因治理 phase 边界暂停
- `pause-quality-gate`：在质量关卡前暂停
- `pause-before-commit`：在提交任务前暂停
- `handoff-required`：达到硬水位，生成 continuation artifact 并建议新会话恢复

---

## 特殊模式

### Retry 模式（`--retry`）

重试失败的任务：
1. 检查工作流状态是否为 `failed`
2. 启动结构化调试协议（四阶段：根因调查 → 模式分析 → 假设验证 → 实施修复）
3. 修复后重新执行当前任务
4. 连续 3 次失败触发 Hard Stop，质疑架构

**详细实现**: 参见 `specs/execute/execution-modes.md`

### Skip 模式（`--skip`）

跳过当前任务（慎用）：
1. 标记当前任务为 `skipped`
2. 更新 `plan.md` 与 `workflow-state.json`
3. 移动到下一个任务
4. 按原执行模式继续工作流

> `skip` 属于例外路径，不是“task 完成”路径；因此不执行实现验证、Step ② 本地检查或完整完成流水线。

**详细实现**: 参见 `specs/execute/execution-modes.md`

---

## 质量关卡处理

当遇到质量关卡任务时，执行 shared review loop contract 对齐后的两阶段代码审查：

1. **Review Subject**：先把聚合 diff 窗口归一化为 `ReviewSubject(kind='diff_window')`
2. **Stage 1：规格合规审查** — 验证实现是否完整匹配需求（当前模型，确定性）
3. **Stage 2：代码质量审查** — 验证架构、DRY、错误处理、安全性（平台感知 reviewer 子 agent）
4. Stage 2 必须在 Stage 1 通过后才能启动
5. 两阶段共享 4 次总预算，耗尽则标记失败
6. execution side 的结果写入 `state.quality_gates[task.id]`，但 artifact 语义与 planning side 的 review loop 保持一致：`subject / attempt / last_decision / next_action / overall_passed`

问题严重级别：Critical（必须修复）/ Important（应当修复）/ Minor（建议修复）

**详细实现**: 参见 `specs/execute/actions/quality-review.md`

---

## 渐进式工作流

当工作流处于渐进式模式（`mode: progressive`）时：
- 自动跳过被阻塞的任务（`blocked_by` 依赖未解除）
- 只执行可执行的任务
- 当所有任务都被阻塞时，转为 `blocked` 状态
- 用户使用 `/workflow unblock <dep>` 解除依赖后继续

**详细实现**: 参见 `references/external-deps.md`、`references/state-machine.md` 与 `scripts/dependency_checker.py`

---

## 上下文感知机制

**Token 估算**：
- 实施计划内容：按字符数 / 4 估算
- Spec 内容：按字符数 / 4 估算
- 最近 diff：最多 50000 字符，按字符数 / 4 估算

**动态限制**：
- 简单任务：最多连续执行 8 个
- 中等任务：最多连续执行 5 个
- 复杂任务：最多连续执行 3 个
- 上下文使用率 > 70%：减少 3 个
- 上下文使用率 > 50%：减少 1 个

**可视化进度条**：
```
[🟩🟩🟩🟩🟩🟩🟩🟩🟨🟨🟨🟨░░░░░░░░] 60%
```

**详细实现**: 参见 `references/shared-utils.md`

---

## 📚 详细实现规格

所有详细的函数实现、数据结构定义、算法细节请参见 `specs/execute/` 目录：

- `execution-modes.md` - 执行模式详情（阶段/连续/重试/跳过）
- `actions/` - 各个 action 的详细实现
  - `create-file.md` - 创建文件
  - `edit-file.md` - 编辑文件
  - `run-tests.md` - 运行测试
  - `quality-review.md` - 两阶段代码审查
  - `git-commit.md` - Git 提交
- `helpers.md` - 辅助函数（任务查找、状态更新、完成检查等）

---

## 🔄 相关命令

```bash
# 继续执行（默认治理 continuous 模式）
/workflow execute

# 连续执行到质量关卡
/workflow execute 连续

# 重试失败的任务
/workflow execute --retry

# 跳过当前任务（慎用）
/workflow execute --skip

# 查看状态
/workflow status

# 解除阻塞依赖
/workflow unblock api_spec
/workflow unblock external

# 查询式状态机（借鉴 Trellis）
/workflow next                          # 查询下一步
/workflow advance T3                    # 完成 + 推进
/workflow advance T3 --journal "摘要"   # 推进 + 记录
/workflow context                       # 聚合启动上下文
/workflow journal list                  # 最近会话记录
```
