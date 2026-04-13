---
name: dispatching-parallel-agents
description: "对 2+ 可证明独立的问题域 / 任务域进行并行子 agent 分派。用于 workflow execute 中识别同阶段独立任务、独立失败测试文件或独立子系统问题后，按平台能力并行执行。负责平台检测、独立性检查、最小上下文封装、结果回收、冲突检测与顺序降级。"
---

# Subagent 并行调度

将任务按**上下文边界**而非抽象角色拆分，再按平台能力路由到合适的子 agent。

> 自 vNext 起，本 skill 既是并行执行机制，也是 `ContextGovernor` 在高上下文压力下的治理策略之一：当规划工件已经稳定、同阶段存在 2+ 可证明独立边界、且主会话顺序执行会明显放大上下文时，应优先评估 `parallel-boundaries`。

## 何时使用

出现以下任一场景时，优先应用本 skill：

- `workflow execute` 在当前阶段识别出 2 个及以上可证明独立的候选任务
- 当前主会话已进入上下文 warning 区，且继续顺序执行多个独立任务会明显放大上下文压力
- `baseline / brief / spec / tech design` 已稳定，可为每个边界提供最小必要上下文
- 多个失败测试文件、多个子系统缺陷或多个问题域彼此独立，适合 `one agent per domain`
- 需要把独立调查 / 修复 / 分析任务并行分派给多个子 agent，并由主会话统一汇总
- 需要显式限制每个子 agent 只处理单一问题域，避免共享状态和上下文污染

如果只是**单个任务隔离执行**、**单个 reviewer 子 agent 审查**、或任务间仍有共享文件 / 共享状态 / 显式依赖，则不要使用本 skill，直接走普通单子 agent 或顺序执行。

## 不可违反的约束

1. **按上下文边界拆分，不按角色拆分**。
   - 合法示例：用户域、认证域、数据层、API 层、UI 层、基础设施、测试
   - 非法示例："架构师 agent"、"安全专家 agent"、"测试 agent" 同时修改同一功能
2. **每个子 agent 只接收最小必要上下文**，不得继承整段主会话历史。
3. **主会话保留代码主权**：负责验证结果、冲突检测、状态更新、下一步路由。
4. **不允许并行修改共享核心状态**：同一文件、同一 store、同一 config、同一 constants/types 目录默认视为冲突。
5. **无法证明独立，就按不独立处理**。

## 平台路由

| 平台 | 分派 | 等待 | 清理 | 说明 |
|------|------|------|------|------|
| Cursor / Claude Code | `Task` | `TaskOutput` | 无需显式清理 | 适合独立任务与并行批次 |
| Codex | `spawn_agent` | `wait` | `close_agent` | 需要回收并释放槽位 |
| 其他平台 | direct | direct | direct | 回退为当前会话顺序执行 |

```typescript
interface SubagentRouting {
  supported: boolean;
  platform: 'cursor' | 'claude-code' | 'codex' | 'other';
  dispatchTool: 'Task' | 'spawn_agent' | 'direct';
  waitTool?: 'TaskOutput' | 'wait';
  cleanupTool?: 'close_agent';
}
```

## 输入约定

默认消费 workflow V2 任务结构与运行时状态：

```typescript
interface DispatchableTask {
  id: string;
  name: string;
  actions: string[];
  depends?: string[];
  steps: Array<{ id: string; description: string; expected: string }>;
  files?: {
    create?: string[];
    modify?: string[];
    test?: string[];
  };
  requirement_ids?: string[];
  critical_constraints?: string[];
  acceptance_criteria?: string[];
}

interface DispatchState {
  use_subagent?: boolean;
  current_tasks?: string[];
  parallel_groups?: Array<{
    id: string;
    task_ids: string[];
    status: 'running' | 'completed' | 'failed';
    started_at: string;
    conflict_detected: boolean;
  }>;
  boundaryScheduling?: {
    enabled: boolean;
    currentBoundary: string | null;
    boundaryProgress: Record<string, {
      completed: string[];
      pending: string[];
      preferredModel: string;
    }>;
  };
  progress: {
    completed: string[];
    blocked: string[];
    failed: string[];
    skipped: string[];
  };
}
```

## 标准流程

### Step 1：检测是否值得启用 subagent

依次判断：

1. 平台是否支持子 agent
2. `state.use_subagent` 是否显式开启；若未显式开启，再结合上下文压力和任务量自动判断
3. 当前阶段是否存在 2 个及以上可候选任务
4. 规划工件（`baseline / brief / spec / tech design`）是否已稳定到足以支持最小上下文分派
5. 若只有 1 个任务，但任务上下文很重，也可以使用单子 agent 隔离执行

若任一关键条件不满足，则直接顺序执行。

> 当 `ContextGovernor` 已进入 warning 区时，本步骤应被视为 continuation 决策的一部分，而不是可选性能优化。

### Step 2：收集同阶段候选任务

只从**当前阶段**、**未完成**、**未阻塞**、**未失败**的任务中挑选候选项。质量关卡任务通常作为单独任务处理，不应与会写代码的任务混跑。

### Step 3：独立性检查

并行前必须逐组检查：

1. **文件独立**：`files.create/modify/test` 汇总后不能有交集
2. **依赖独立**：A 不依赖 B，B 不依赖 A，也不存在同批次链式依赖
3. **共享状态独立**：涉及 `store`、`config`、`constants`、`types`、根级入口文件时默认不并行
4. **导入独立**：同批次一个任务创建的模块若会被另一任务立即导入，则不并行
5. **验证独立**：两个任务的验证步骤若必须串行共享同一环境副作用，也不要并行

```typescript
function canRunInParallel(taskA: DispatchableTask, taskB: DispatchableTask): boolean {
  const filesA = [
    ...(taskA.files?.create || []),
    ...(taskA.files?.modify || []),
    ...(taskA.files?.test || [])
  ];
  const filesB = [
    ...(taskB.files?.create || []),
    ...(taskB.files?.modify || []),
    ...(taskB.files?.test || [])
  ];

  if (filesA.some(file => filesB.includes(file))) return false;
  if ((taskA.depends || []).includes(taskB.id) || (taskB.depends || []).includes(taskA.id)) return false;

  const sharedPath = /(store|config|constants|types|app\.(ts|js)x?|main\.(ts|js)x?)/i;
  if (filesA.some(file => sharedPath.test(file)) && filesB.some(file => sharedPath.test(file))) {
    return false;
  }

  return true;
}
```

### Step 4：按上下文边界分组

优先使用文件路径，其次使用任务名称关键词：

- `user-domain`
- `auth-domain`
- `data-domain`
- `api-domain`
- `ui-domain`
- `infra-domain`
- `test-domain`

同一边界内默认**串行**，不同边界之间才考虑**并行**。这比“按角色拆分”更能减少跨 agent 协调成本。

### Step 5：为边界选择模型/执行者

- 认证、数据、API、基础设施优先更偏后端/安全的执行者
- UI 优先更偏前端/交互的执行者
- `auto` 边界根据任务名称和文件类型动态选择

### Step 6a：串行 provisioning 与隔离准备

在真正启动并行子 agent 之前，先完成本批次的隔离准备。这里的目标不是开始执行任务，而是**只处理会触发共享 Git 元数据写入的 provisioning**。

- 若任务会写文件、修改测试或语义上无法证明只读，则默认需要 worktree
- 若任务是明确的 analysis / review / investigation / trace / diagnose / plan / document 类只读任务，可跳过 worktree
- 无法证明只读时，一律按需要 worktree 处理
- 所有 `git worktree add/remove/prune` 必须使用 repo 级串行保护，避免并发触发 `.git/config.lock` 竞争
- provisioning 完成后，再进入并行子 agent 启动阶段

### Step 6b：构造最小上下文并并行分派

每个子 agent 上下文至少包含：

- 当前任务或当前边界任务列表
- 目标文件集合
- `steps[]`
- `requirement_ids`
- `critical_constraints`
- `acceptance_criteria`
- 与当前边界直接相关的 `brief / spec / tech design` 片段
- 验证命令或验证方式
- 明确的输出契约（结果摘要 / 验证证据 / 失败原因）

不要传入与当前任务无关的历史讨论、无关 diff、或整个任务清单全文。

> 若主会话启用 `context-first` continuation governance，则此处应优先传递“边界级摘要 + 必要原文片段”，而不是转发整个 planning 链路全文。

### Step 7：结果回收与清理

- provisioning 完成后，再使用后台运行启动并行子 agent
- 主会话逐个等待结果并记录成功/失败
- Codex 类平台在回收后显式执行清理
- 每个任务完成后仍要经过 workflow 自身的验证铁律、规格合规与状态更新管线

### Step 8：冲突检测与降级

当多个写任务并行完成后：

1. 运行项目级测试或该批次要求的聚合验证
2. 若出现冲突或验证失败：
   - 标记 `parallel_groups[*].conflict_detected = true`
   - 将批次状态改为 `failed`
   - 回滚“仅因并行暂记完成”的 `progress.completed` 记录
   - 将 `current_tasks` 重置为该批次待顺序重跑的任务集合
   - 将 workflow 状态恢复到可继续执行的状态（通常为 `running`）
   - 保留子 agent 产物与诊断信息，但不保留“该批次已完成”的最终结论
   - 按原顺序重新顺序执行
3. 若仅个别任务失败：
   - 失败任务标记 `failed`
   - 其余成功任务保留结果
   - 主会话决定是否继续推进后续可运行任务

## workflow 集成要求

当 `workflow` 进入以下节点时，应主动应用本 skill：

1. `execute` 的 Step 3：识别是否存在 2+ 独立问题域 / 任务域
2. `execute` 的 ContextGovernor：主会话已进入 warning 区，且可证明边界独立时，优先评估 `parallel-boundaries`
3. `execute` 的 Step 6：先完成串行 provisioning，再把已确认独立的并行批次路由到多子 agent
4. 任意需要“one agent per domain + 并行执行 + 主会话汇总验证”的场景

如果只是单个任务的普通 subagent 执行，或 `quality_review` Stage 2 的单 reviewer 审查，则不应把它们强行归入本 skill。

## 推荐输出

完成调度后，主会话应返回结构化摘要：

```markdown
## Subagent Dispatch Summary
- routing: <platform/tool>
- mode: sequential | single-subagent | parallel-boundaries
- groups:
  - <boundary/group id>: <task ids>
- fallback: none | direct | sequential-after-conflict
- verification: <commands or evidence summary>
```

## 失败时的默认行为

- 平台不支持 → `direct`
- 独立性不明确 → 顺序执行
- 并行后冲突 → 回退顺序执行
- 任意子 agent 输出缺少验证证据 → 不得标记对应任务完成

## Node.js 工具脚本

> 以下脚本位于 `scripts/` 目录，将上述策略层的伪代码转化为可执行的工程实现：

| 脚本 | 对应步骤 | CLI 用法 |
|------|---------|---------|
| `worktree_manager.js` | Step 6a 隔离 provisioning | `create --branch <b> --task-id <t>` / `list` / `remove` / `cleanup` |
| `agent_registry.js` | Step 7 生命周期管理 | `register --task-id <t>` / `update --agent-id <id> --status <s>` / `list` |
| `dispatch_runner.js` | Step 4-6b 分组+上下文构建+分派 | `dispatch --tasks-json <f> --task-ids T3,T4` |
| `result_collector.js` | Step 7-8 回收+冲突检测 | `collect --group-id <g>` / `check-conflicts --group-id <g>` |

### 典型工作流

```bash
# 1. 解析并行组（使用 workflow 的 dependency_checker）
node ~/.agents/agent-workflow/core/utils/workflow/dependency_checker.js parallel --tasks-file tasks.json --completed T1,T2

# 2. 分派
node scripts/dispatch_runner.js dispatch --tasks-json tasks.json --task-ids T3,T4 --group-id batch1

# 3. （AI 使用 Task/spawn_agent 启动子 agent）

# 4. 回收结果
node scripts/result_collector.js collect --group-id batch1 --verify "npm test"
```

