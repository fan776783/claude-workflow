# workflow execute - 执行任务概览 (v3.0)

> 精简接口：默认阶段模式，支持自然语言控制执行模式

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

| 模式 | 说明 | 中断点 |
|------|------|--------|
| 单步 | 每个任务后暂停 | 每个任务 |
| 阶段 | 按大阶段连续执行（默认） | 阶段变化时 |
| 连续 | 执行到质量关卡 | 质量关卡 / git_commit |

> **Subagent 模式**：平台支持时自动启用（或任务数 > 5），每个任务在独立 subagent 中执行，避免上下文膨胀。

---

## 🔍 执行流程概览

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
- 任务清单路径（`tasks_file`）
- 技术方案路径（`tech_design`）
- 确保路径在允许的目录范围内

**详细实现**: 参见 `specs/shared/path-utils.md`

---

### Step 3：上下文感知与 Subagent 决策

**上下文估算**：
- 估算当前 token 使用量（任务清单 + 技术方案 + 最近 diff）
- 计算使用率百分比
- 生成可视化进度条

**Subagent 决策**：
- 平台检测（Claude Code / Cursor / Windsurf / Augment）
- 启用条件：
  1. 用户显式配置 `state.use_subagent`
  2. 平台支持 + 上下文压力高（> 60%）
  3. 平台支持 + 任务数量多（> 5）

**详细实现**: 参见 `specs/shared/context-awareness.md`

---

### Step 4：提取当前任务

从 `tasks.md` 中提取当前任务信息：
- 任务 ID 格式校验（防止正则注入）
- 解析任务标题（支持状态 emoji）
- 提取任务字段（阶段、文件、依赖、验收项等）
- 检查任务是否已完成，如是则移动到下一个

**详细实现**: 参见 `specs/workflow/task-parser.md`

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
- 全局约束（从任务清单提取）

---

### Step 6：执行任务动作

根据任务的 `actions` 字段执行相应动作：

**支持的动作**：
- `create_file`: 创建新文件
- `edit_file`: 编辑现有文件
- `run_tests`: 运行测试
- `codex_review`: Codex 代码审查
- `git_commit`: Git 提交

**执行方式**：
- **Subagent 模式**：使用 Task tool 在独立 subagent 中执行
- **直接模式**：在当前上下文中执行

**详细实现**: 参见 `specs/execute/actions/` 目录

---

### Step 7：更新任务状态

执行完成后更新任务状态：
- 标记任务为已完成（`completed`）
- 更新 `tasks.md` 中的任务状态（添加 ✅ emoji）
- 更新 `workflow-state.json` 中的进度
- 记录上下文使用历史
- 增加连续执行计数

---

### Step 8：决定下一步

根据执行模式决定是否继续：

**单步模式**：
- 每个任务后暂停
- 提示用户执行 `/workflow execute` 继续

**阶段模式**（默认）：
- 检查下一个任务的阶段
- 如果阶段相同，继续执行
- 如果阶段不同，暂停并提示

**连续模式**：
- 执行到质量关卡或 git_commit
- 遇到质量关卡时暂停
- 遇到 git_commit 且 `pause_before_commit=true` 时暂停

**兜底机制**：
- 连续执行任务数达到上限时强制暂停
- 上下文使用率超过危险阈值时强制暂停

---

## 特殊模式

### Retry 模式（`--retry`）

重试失败的任务：
1. 检查工作流状态是否为 `failed`
2. 重新执行当前任务
3. 成功后继续工作流

**详细实现**: 参见 `specs/execute/execution-modes.md`

### Skip 模式（`--skip`）

跳过当前任务（慎用）：
1. 标记当前任务为 `skipped`
2. 移动到下一个任务
3. 继续工作流

**详细实现**: 参见 `specs/execute/execution-modes.md`

---

## 质量关卡处理

当遇到质量关卡任务时：
1. 执行 Codex 代码审查
2. 检查评分是否达到阈值（默认 80）
3. 如果未达标，标记为失败并暂停
4. 如果达标，继续执行

**详细实现**: 参见 `specs/workflow/quality-gate.md`

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
- 任务清单内容：按字符数 / 4 估算
- 技术方案内容：按字符数 / 4 估算
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

**详细实现**: 参见 `specs/shared/context-awareness.md`

---

## 📚 详细实现规格

所有详细的函数实现、数据结构定义、算法细节请参见 `specs/execute/` 目录：

- `execution-modes.md` - 执行模式详情（单步/阶段/连续/重试/跳过）
- `actions/` - 各个 action 的详细实现
  - `create-file.md` - 创建文件
  - `edit-file.md` - 编辑文件
  - `run-tests.md` - 运行测试
  - `codex-review.md` - Codex 代码审查
  - `git-commit.md` - Git 提交
- `helpers.md` - 辅助函数（任务查找、状态更新、完成检查等）

---

## 🔄 相关命令

```bash
# 继续执行（默认阶段模式）
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
/workflow unblock design_spec
```
