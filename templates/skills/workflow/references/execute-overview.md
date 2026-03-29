# workflow execute - 执行任务概览 (v3.1)

> 精简接口：默认治理 phase 模式，支持自然语言控制执行模式

执行工作流任务。

## 参数

| 参数 | 说明 |
|------|------|
| `--retry` | 重试模式：重试失败的任务 |
| `--skip` | 跳过模式：跳过当前任务（慎用） |

## 自然语言控制

在命令参数或对话中描述意图：

| 用户说 | 系统理解 |
|--------|----------|
| "单步执行" / "step" | 单步模式 |
| "继续" / "下一阶段" | 阶段模式（默认） |
| "连续" / "执行到质量关卡" | 连续模式 |
| "重试" | 等同 `--retry` |
| "跳过" | 等同 `--skip` |

## 执行模式

| 模式 | 说明 | 语义暂停点 |
|------|------|------------|
| 单步 | 每个执行单元后暂停 | 每个执行单元 |
| 阶段 | 按治理 phase 连续执行（默认） | 治理边界变化时 |
| 连续 | 执行到质量关卡 | 质量关卡 / git_commit |

> 注意：以上仅是语义暂停点；真正是否继续由 `ContextGovernor` 先决定。

> **Subagent 模式**：平台支持时自动启用（或任务数 > 5），每个任务在独立 subagent 中执行，避免上下文膨胀。
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
- 检测 `--retry` / `--skip` 标志
- 识别自然语言模式描述（单步/连续/阶段）
- 确定执行模式优先级：命令行参数 > state 配置 > 默认

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

---

### Step 2：路径安全校验

使用 `resolveUnder` 函数校验所有路径：
- 实施计划路径（`plan_file`）
- Spec 路径（`spec_file`）
- 确保路径在允许的目录范围内

**详细实现**: 参见 `specs/shared/path-utils.md`

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

**详细实现**: 参见 `specs/execute/execution-modes.md`、`specs/workflow/subagent-routing.md`、`../dispatching-parallel-agents/SKILL.md` 与 `references/shared-utils.md`

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

### Step 6.5：完成验证（Verification Iron Law）

**铁律：没有新鲜验证证据，不得标记任务为 completed。**

根据任务 action 类型执行对应验证命令，生成结构化证据（命令、退出码、输出摘要、时间戳）。验证失败则标记 `failed`，禁止继续。

**详细实现**: 参见 `specs/execute/execution-modes.md` → Post-Execution Pipeline

---

### Step 6.6：自审查（Self-Review Checklist）

对 `create_file` / `edit_file` 类型任务，在验证通过后执行单次建议性自审查：完整性（测试覆盖）、正确性（红绿转换）、质量（DRY、错误处理）、安全（输入验证）、一致性（设计对齐）。永不阻塞，始终继续 Step 6.7。

**详细实现**: 参见 `specs/execute/execution-modes.md` → Step 6.6

---

### Step 6.7：规格合规检查（Spec Compliance Check）

对 `create_file` / `edit_file` 类型且有 `acceptance_criteria` 的任务，只读检查验收项覆盖情况。发现偏差输出列表，不自动修复。`quality_review` 类型任务跳过（由 shared review loop contract 对齐后的两阶段审查 Stage 1 接管）。

**详细实现**: 参见 `specs/execute/execution-modes.md` → Post-Execution Pipeline

---

### Step 7：更新任务状态

执行完成后更新任务状态：
- 标记任务为已完成（`completed`）
- 更新 `plan.md` 中的任务状态（添加 ✅ emoji）
- 更新 `workflow-state.json` 中的进度
- 记录上下文使用历史与 projected 预算信息
- 更新连续执行计数（仅作为节奏控制，不再单独决定 continuation）

---

### Step 8：ContextGovernor 决定下一步

完成 Step 6.5 / 6.6 / 6.7 与 Step 7 后，不再直接按 `execution_mode` 决定是否继续，而是先调用 `ContextGovernor`：

**决策顺序**：
1. 检查是否存在硬停止条件（failed / blocked / retry hard stop / 缺少验证证据）
2. 计算下一执行单元的 projected 成本
3. 检查是否存在同阶段 2+ 独立边界，且是否适合 `parallel-boundaries`
4. 判断是否达到 `warning / danger / hard handoff` 水位
5. 仅当以上都允许继续时，才应用 `step / phase / quality_gate` 的语义暂停规则

**Continuation actions**：
- `continue-direct`：直接继续顺序执行
- `continue-parallel-boundaries`：按边界并行分派
- `pause-budget`：因预算压力暂停
- `pause-governance`：因 `step` 或治理 phase 边界暂停
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
2. 移动到下一个任务
3. 继续工作流

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

**详细实现**: 参见 `specs/workflow/progressive-workflow.md`

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

- `execution-modes.md` - 执行模式详情（单步/阶段/连续/重试/跳过）
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
# 继续执行（默认治理 phase 模式）
/workflow execute

# 单步执行
/workflow execute step

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
```
