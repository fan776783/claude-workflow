# Parallel Dispatch（workflow-execute 视角）

> 本文件聚焦 **workflow-execute 何时、如何启用并行**。分派本身的平台检测、结果回收、冲突降级详见 `../../dispatching-parallel-agents/SKILL.md`。

## 触发门槛

平台支持并行、且能证明同阶段任务彼此独立时才启用。两个硬门槛来自 `batch_orchestrator.js config`：

- `enabled: false` → 跳过并行，走单任务串行
- `maxConcurrency <= 1` → 同上

门槛任一不满足直接回单任务路径，不需要进入后续判定。

## 前置约束

含 `git_commit` 或 `quality_review` action 的任务**禁止**编入并行批次。原因是这两类动作会写共享状态（git 历史、state.json 的 `quality_gates.*`），并行会产生真正的竞争；`batch_orchestrator select-batch` 的 `filtered` 字段已在底层做了排除，但 workflow-execute 层仍需把这一点当作显式规则对待。

## 批次判定流程

### 1. 读取并行配置

```bash
node ~/.agents/agent-workflow/core/utils/workflow/batch_orchestrator.js config --project-root <root>
```

返回字段：`enabled`、`maxConcurrency`、`platform`。其中 `enabled` / `maxConcurrency` 是前置门槛；`platform` 告诉后续分派层在哪个 AI 编码工具下运行。

### 2. 选出可并行批次

```bash
node ~/.agents/agent-workflow/core/utils/workflow/batch_orchestrator.js select-batch \
  --tasks-file <plan-path> --state-file <state-path> --max-concurrency <n>
```

关注的返回字段：

- `batch_viable: true` — 存在可并行批次
- `filtered` — 已被排除的任务 ID（含 `git_commit`/`quality_review` 等）
- `batch` — 选中的任务列表（数组）
- `groupId` — 批次唯一标识

`batch_viable: false` 时直接走串行，不再进入后续 step。

### 3. 只读 fan-out（分析 / 审查）

任务 action 属于 analysis / review 且可拆分 ≥ 2 子任务时：

- 调用 `batch_orchestrator.dispatchReadonlyBatch(...)`
- 底层复用 `dispatching-parallel-agents` 的 `dispatch_runner.dispatchGroup(tasks, groupId, platform, useWorktree=false)`
- 子 agent 产物写到 `~/.claude/workflows/{projectId}/artifacts/{groupId}/{taskId}.json`
- 任一子 agent 失败 → 结果为空，降级为串行分析；工作流状态不受影响

只读批次不 provision worktree。

### 4. 写文件批次（worktree 路径）

独立性复检通过后：

- 调用 `dispatch_runner.dispatchGroup(tasks, groupId, platform, useWorktree=true)`
- 分派内部 provision worktree + registerAgent，然后由主 agent **并行**启动 subagent
- 各 subagent 在各自 worktree 内完成，合流汇聚到一个 **集成 worktree**
- stage2 审查在集成 worktree 中进行，通过后才 merge 到主分支
- stage2 失败则丢弃集成 worktree，任务回 pending

集成 worktree 的创建 / 合流 / 丢弃由 `core/utils/workflow/merge_strategist.js` 的 `createIntegrationWorktree`、`mergeWorktreeBranches`、`finalMergeToMain`、`discardIntegrationWorktree` 负责。详细流程见 `../../dispatching-parallel-agents/SKILL.md` 的 Step 6a-8。

## 诊断接口（旧）

下列命令保留为人工诊断用途，batch_orchestrator 已取代它在运行时的角色：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js parallel
```

主要用于手动确认 `parallel_group` 字段是否正确填入 plan，怀疑 batch_orchestrator 结果异常时可以交叉验证。
