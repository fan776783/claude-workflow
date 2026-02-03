# 上下文边界调度

Subagent 按上下文边界划分任务，而非按角色划分。

## 核心原则

```
✓ 按上下文边界划分：
  - Subagent 1: 用户域代码 (models, services, UI)
  - Subagent 2: 认证授权 (middleware, session, tokens)
  - Subagent 3: 基础设施 (configs, deployments)

✗ 禁止按角色划分：
  - "架构师 agent"、"安全专家 agent"、"测试 agent"
```

**原因**：
1. 上下文边界自包含，减少跨边界通信
2. 边界内任务可安全并行执行
3. 避免角色重叠导致的冲突决策

## 数据结构

```typescript
interface ContextBoundary {
  id: string;                          // 边界标识
  name: string;                        // 显示名称
  patterns: {
    files: RegExp[];                   // 文件路径匹配
    keywords: RegExp[];                // 任务名称关键词
  };
  preferredModel: 'codex' | 'gemini' | 'auto';  // 推荐模型
  description: string;                 // 边界说明
}

interface BoundaryScheduling {
  enabled: boolean;                    // 是否启用边界调度
  currentBoundary: string | null;      // 当前执行的边界
  boundaryProgress: Record<string, {
    completed: string[];               // 已完成任务 ID
    pending: string[];                 // 待执行任务 ID
    preferredModel: string;            // 使用的模型
  }>;
}
```

## 边界定义

```typescript
const CONTEXT_BOUNDARIES: ContextBoundary[] = [
  {
    id: 'user-domain',
    name: '用户域',
    patterns: {
      files: [
        /models\/(?!auth)/,
        /entities\/(?!auth)/,
        /services\/(?!auth)/,
        /components\/user/,
        /pages\/(?!auth|login)/
      ],
      keywords: [
        /用户|profile|account|user|个人|设置/i
      ]
    },
    preferredModel: 'auto',
    description: '用户相关的业务逻辑、数据模型、UI 组件'
  },
  {
    id: 'auth-domain',
    name: '认证授权',
    patterns: {
      files: [
        /auth\//,
        /middleware\/.*auth/,
        /guards\//,
        /session/,
        /token/,
        /permission/,
        /role/
      ],
      keywords: [
        /认证|授权|登录|登出|权限|角色|token|session|auth|login|permission/i
      ]
    },
    preferredModel: 'codex',  // 安全相关优先 Codex
    description: '认证、授权、会话管理、权限控制'
  },
  {
    id: 'data-domain',
    name: '数据层',
    patterns: {
      files: [
        /repositories\//,
        /database\//,
        /migrations\//,
        /schemas\//,
        /models\/.*\.sql/,
        /prisma\//,
        /typeorm\//
      ],
      keywords: [
        /数据库|迁移|schema|repository|query|sql|orm|prisma/i
      ]
    },
    preferredModel: 'codex',  // 数据相关优先 Codex
    description: '数据库操作、迁移、ORM 配置'
  },
  {
    id: 'api-domain',
    name: 'API 层',
    patterns: {
      files: [
        /controllers\//,
        /routes\//,
        /api\//,
        /handlers\//,
        /endpoints\//
      ],
      keywords: [
        /api|接口|路由|controller|handler|endpoint|restful|graphql/i
      ]
    },
    preferredModel: 'codex',  // 后端 API 优先 Codex
    description: 'HTTP 接口、路由、控制器'
  },
  {
    id: 'ui-domain',
    name: 'UI 层',
    patterns: {
      files: [
        /components\/(?!user)/,
        /pages\//,
        /views\//,
        /layouts\//,
        /\.vue$/,
        /\.tsx$/,
        /\.jsx$/,
        /styles\//,
        /\.css$/,
        /\.scss$/
      ],
      keywords: [
        /组件|页面|界面|样式|布局|ui|component|page|view|style|css/i
      ]
    },
    preferredModel: 'gemini',  // UI 相关优先 Gemini
    description: '前端组件、页面、样式'
  },
  {
    id: 'infra-domain',
    name: '基础设施',
    patterns: {
      files: [
        /config\//,
        /deploy\//,
        /docker/,
        /\.env/,
        /ci\//,
        /\.github\//,
        /scripts\//,
        /webpack/,
        /vite\.config/,
        /tsconfig/
      ],
      keywords: [
        /配置|部署|环境|构建|打包|infra|deploy|config|docker|ci|cd/i
      ]
    },
    preferredModel: 'codex',
    description: '配置、部署、CI/CD、构建工具'
  },
  {
    id: 'test-domain',
    name: '测试',
    patterns: {
      files: [
        /__tests__\//,
        /\.test\./,
        /\.spec\./,
        /tests\//,
        /cypress\//,
        /playwright\//
      ],
      keywords: [
        /测试|test|spec|单元|集成|e2e|cypress|playwright/i
      ]
    },
    preferredModel: 'auto',
    description: '单元测试、集成测试、E2E 测试'
  }
];
```

## 核心函数

### 任务分类

```typescript
/**
 * 将任务分配到上下文边界
 *
 * 匹配优先级：
 * 1. 文件路径匹配
 * 2. 任务名称关键词匹配
 * 3. 默认：用户域
 */
function classifyTaskToBoundary(task: {
  name: string;
  file?: string;
}): ContextBoundary {
  for (const boundary of CONTEXT_BOUNDARIES) {
    // 检查文件路径
    if (task.file) {
      for (const pattern of boundary.patterns.files) {
        if (pattern.test(task.file)) {
          return boundary;
        }
      }
    }

    // 检查任务名称
    for (const pattern of boundary.patterns.keywords) {
      if (pattern.test(task.name)) {
        return boundary;
      }
    }
  }

  // 默认：用户域
  return CONTEXT_BOUNDARIES[0];
}
```

### 任务分组

```typescript
/**
 * 按边界分组任务（用于并行执行）
 */
function groupTasksByBoundary(
  tasks: Task[]
): Map<string, { boundary: ContextBoundary; tasks: Task[] }> {
  const groups = new Map<string, { boundary: ContextBoundary; tasks: Task[] }>();

  for (const task of tasks) {
    const boundary = classifyTaskToBoundary(task);
    const existing = groups.get(boundary.id);

    if (existing) {
      existing.tasks.push(task);
    } else {
      groups.set(boundary.id, { boundary, tasks: [task] });
    }
  }

  return groups;
}
```

### 模型选择

```typescript
/**
 * 为边界选择执行模型
 *
 * auto 模式下根据任务内容智能选择：
 * - 后端关键词 → Codex
 * - 前端关键词 → Gemini
 * - 其他 → Codex（默认）
 */
function selectModelForBoundary(
  boundary: ContextBoundary,
  tasks: Task[]
): 'codex' | 'gemini' {
  if (boundary.preferredModel !== 'auto') {
    return boundary.preferredModel;
  }

  // auto 模式：根据任务内容判断
  const backendKeywords = /后端|api|service|database|server|backend/i;
  const frontendKeywords = /前端|组件|样式|ui|frontend|component|style/i;

  let backendScore = 0;
  let frontendScore = 0;

  for (const task of tasks) {
    if (backendKeywords.test(task.name)) backendScore++;
    if (frontendKeywords.test(task.name)) frontendScore++;
  }

  return frontendScore > backendScore ? 'gemini' : 'codex';
}
```

## 执行模式

### --boundary 模式

```bash
/workflow execute --boundary   # 按上下文边界并行执行同阶段任务
```

**执行流程**：

1. 获取当前阶段的所有待执行任务
2. 按边界分组
3. 边界内任务串行执行
4. 不同边界可并行执行（如果模型不同）

```typescript
async function executeBoundaryMode(
  tasks: Task[],
  state: WorkflowState
): Promise<void> {
  // 1. 获取当前阶段任务
  const currentPhase = extractPhaseFromTask(tasks.find(t => t.id === state.current_task));
  const phaseTasks = tasks.filter(t =>
    extractPhaseFromTask(t) === currentPhase &&
    !state.progress.completed.includes(t.id) &&
    !state.progress.blocked?.includes(t.id)
  );

  if (phaseTasks.length === 0) {
    console.log('当前阶段无待执行任务');
    return;
  }

  // 2. 按边界分组
  const boundaryGroups = groupTasksByBoundary(phaseTasks);

  console.log(`
🎯 **上下文边界划分**

${[...boundaryGroups.entries()].map(([id, { boundary, tasks }]) => {
  const model = selectModelForBoundary(boundary, tasks);
  return `- **${boundary.name}** (${tasks.length} 任务): ${tasks.map(t => t.id).join(', ')}
  文件: ${tasks.map(t => t.file).filter(Boolean).join(', ') || '(无)'}
  推荐模型: ${model}`;
}).join('\n\n')}
  `);

  // 3. 初始化边界进度
  if (!state.boundaryScheduling) {
    state.boundaryScheduling = {
      enabled: true,
      currentBoundary: null,
      boundaryProgress: {}
    };
  }

  for (const [boundaryId, { boundary, tasks: boundaryTasks }] of boundaryGroups) {
    const model = selectModelForBoundary(boundary, boundaryTasks);
    state.boundaryScheduling.boundaryProgress[boundaryId] = {
      completed: [],
      pending: boundaryTasks.map(t => t.id),
      preferredModel: model
    };
  }

  // 4. 按边界执行（同模型的边界并行）
  const codexBoundaries = [...boundaryGroups.entries()]
    .filter(([, { boundary, tasks }]) => selectModelForBoundary(boundary, tasks) === 'codex');
  const geminiBoundaries = [...boundaryGroups.entries()]
    .filter(([, { boundary, tasks }]) => selectModelForBoundary(boundary, tasks) === 'gemini');

  // Codex 边界并行
  if (codexBoundaries.length > 0) {
    console.log(`\n🤖 **Codex 执行** (${codexBoundaries.length} 个边界)\n`);
    await Promise.all(
      codexBoundaries.map(([boundaryId, { boundary, tasks }]) =>
        executeBoundaryTasks(boundaryId, boundary, tasks, 'codex', state)
      )
    );
  }

  // Gemini 边界并行
  if (geminiBoundaries.length > 0) {
    console.log(`\n🎨 **Gemini 执行** (${geminiBoundaries.length} 个边界)\n`);
    await Promise.all(
      geminiBoundaries.map(([boundaryId, { boundary, tasks }]) =>
        executeBoundaryTasks(boundaryId, boundary, tasks, 'gemini', state)
      )
    );
  }
}
```

### 边界内执行

```typescript
async function executeBoundaryTasks(
  boundaryId: string,
  boundary: ContextBoundary,
  tasks: Task[],
  model: 'codex' | 'gemini',
  state: WorkflowState
): Promise<void> {
  state.boundaryScheduling.currentBoundary = boundaryId;

  for (const task of tasks) {
    console.log(`  📍 ${task.id}: ${task.name}`);

    try {
      // 使用指定模型执行任务
      await executeTaskWithModel(task, model, state);

      // 更新进度
      const progress = state.boundaryScheduling.boundaryProgress[boundaryId];
      progress.completed.push(task.id);
      progress.pending = progress.pending.filter(id => id !== task.id);
      state.progress.completed.push(task.id);

      console.log(`  ✅ ${task.id} 完成`);
    } catch (error) {
      console.log(`  ❌ ${task.id} 失败: ${error}`);
      state.progress.failed.push(task.id);
      break;  // 边界内串行，失败即停止
    }
  }

  state.boundaryScheduling.currentBoundary = null;
}
```

## 与其他模式对比

| 模式 | 参数 | 并行策略 | 适用场景 |
|------|------|----------|----------|
| 单步 | `--step` | 无并行 | 精细控制、调试 |
| 阶段 | `--phase` | 阶段内串行 | 常规开发 |
| 边界 | `--boundary` | 边界间并行 | 大任务集、跨栈开发 |
| 连续 | `--all` | 到质量关卡 | 自动化流程 |

## 最佳实践

1. **任务数 > 10 时启用边界模式**：自动按边界分组执行
2. **跨栈任务优先边界模式**：前后端任务可并行
3. **避免边界内依赖**：同边界任务应相互独立
4. **尊重推荐模型**：安全相关用 Codex，UI 用 Gemini
5. **配合 Context Awareness**：边界切换时检查上下文使用率
