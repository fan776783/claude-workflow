# Phase 2: 任务清单生成详情

## 目的

将技术方案转换为可执行的任务清单，明确每个任务的目标、依赖关系和验收标准。

## 执行时机

**强制执行**：Hard Stop 1 确认后执行

## 实现细节

### Step 1: 读取技术方案

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Phase 2: 基于设计生成任务清单
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 读取完善后的技术方案
const techDesign = readFile(techDesignPath);

// 从技术方案提取实施计划
const implementationPlan = extractImplementationPlan(techDesign);
```

### Step 2: 生成任务列表

#### 任务粒度标准

生成任务前，按以下标准控制粒度：

**原子性判定**：
- 每个任务应对应一个原子操作（创建一个文件、修改一个函数、运行一次测试）
- 如果 `requirement` 描述超过 2 句话，必须拆分为多个任务

**步骤内化**：对 `create_file` / `edit_file` 类型的任务，将实现步骤编码进 `requirement` 字段，使用编号列表格式：

```markdown
- **需求**: 实现用户列表组件：
  1. 创建组件文件，实现基础结构 → 预期：文件已创建，无语法错误
  2. 实现列表渲染逻辑 → 预期：静态数据可正常渲染
  3. 接入 API 数据 → 预期：真实数据可正常展示
  4. 实现分页功能 → 预期：翻页操作正常
```

**步骤模板**（按任务类型选用）：

| 任务类型 | 推荐步骤序列 |
|----------|-------------|
| `create_file` (组件) | 创建文件 → 实现核心逻辑 → 接入数据 → 运行验证 |
| `create_file` (工具/服务) | 创建文件 → 实现接口 → 添加错误处理 → 运行验证 |
| `edit_file` | 定位修改点 → 实施修改 → 检查副作用 → 运行验证 |
| `run_tests` / `quality_review` / `git_commit` | 不需要步骤内化 |

```typescript
// 为每个任务补充详细信息（包含依赖分类 + 验证清单关联）
const tasks = implementationPlan.map((item, index) => {
  const task = {
    id: `T${index + 1}`,
    name: item.task,
    phase: determinePhase(item),
    file: item.file,
    leverage: findLeverage(item.file, analysisResult.reusableComponents),
    design_ref: item.section || `4.${index + 1}`,
    requirement: item.description || item.task,
    actions: determineActions(item),
    depends: item.depends ? `T${item.depends}` : null,
    quality_gate: item.isQualityGate || false,
    status: 'pending'
  };

  // 渐进式工作流：自动分类任务依赖
  const blockedBy = classifyTaskDependencies(task);
  if (blockedBy.length > 0) {
    task.blocked_by = blockedBy;
    task.status = 'blocked';  // 有未解除依赖时标记为 blocked
  }

  // 关联验证清单（如果已生成）
  if (acceptanceChecklist) {
    task.acceptance_criteria = mapTaskToAcceptanceCriteria(task, acceptanceChecklist);
  }

  return task;
});
```

### Step 3: 添加标准质量关卡

```typescript
// 添加标准质量关卡（如果没有）
if (!tasks.some(t => t.quality_gate)) {
  // 找到最后一个代码产出阶段的任务（不仅是 implement）
  const codeProducingPhases = ['implement', 'ui-layout', 'ui-display', 'ui-form', 'ui-integrate', 'test'];
  const lastCodeTask = tasks.filter(t => codeProducingPhases.includes(t.phase)).pop();
  if (lastCodeTask) {
    tasks.push({
      id: `T${tasks.length + 1}`,
      name: '两阶段代码审查',
      phase: 'verify',
      file: null,
      leverage: null,
      design_ref: null,
      requirement: `审查 ${lastCodeTask.id} 及之前的所有代码实现（聚合 diff 窗口）`,
      actions: 'quality_review',
      depends: lastCodeTask.id,
      quality_gate: true,
      status: 'pending'
    });
  }
}
```

### Step 4: 添加提交任务

```typescript
// 添加提交任务
tasks.push({
  id: `T${tasks.length + 1}`,
  name: '提交代码',
  phase: 'deliver',
  file: null,
  leverage: null,
  design_ref: null,
  requirement: '规范 commit message，确保 CI 通过',
  actions: 'git_commit',
  depends: `T${tasks.length}`,
  quality_gate: false,
  status: 'pending'
});
```

### Step 5: 生成 tasks.md 文件

```typescript
// 生成 tasks.md
const tasksPath = path.join(workflowDir, `tasks-${sanitizedName}.md`);

// 预渲染复杂内容
const constraintsMarkdown = analysisResult.constraints.length > 0
  ? analysisResult.constraints.map(c => `- ${c}`).join('\n')
  : '（无特殊约束）';

const acceptanceCriteria = extractAcceptanceCriteria(techDesign);
const acceptanceMarkdown = acceptanceCriteria.length > 0
  ? acceptanceCriteria.map((ac, i) => `- [ ] AC${i + 1}: ${ac}`).join('\n')
  : '- [ ] AC1: （待定义）';

// 渲染任务列表（包含验收项关联）
const tasksMarkdown = tasks.map(t => `
## ${t.id}: ${t.name}
<!-- id: ${t.id}, design_ref: ${t.design_ref || 'N/A'} -->
- **阶段**: ${t.phase}
${t.file ? `- **文件**: \`${t.file}\`` : ''}
${t.leverage ? `- **复用**: \`${t.leverage}\`` : ''}
${t.design_ref ? `- **设计参考**: tech-design.md § ${t.design_ref}` : ''}
- **需求**: ${t.requirement}
${t.acceptance_criteria && t.acceptance_criteria.length > 0 ? `- **验收项**: ${t.acceptance_criteria.join(', ')}` : ''}
- **actions**: \`${t.actions}\`
${t.depends ? `- **依赖**: ${t.depends}` : ''}
${t.blocked_by ? `- **阻塞依赖**: \`${t.blocked_by.join(', ')}\`` : ''}
${t.quality_gate ? `- **质量关卡**: true（两阶段代码审查）` : ''}
- **状态**: ${t.status}
`).join('\n');

// 尝试加载模板文件
const tasksTemplate = loadTemplate('tasks-template.md');

let tasksContent: string;

if (tasksTemplate) {
  // 使用简单变量替换
  tasksContent = replaceVars(tasksTemplate, {
    tech_design_path: techDesignPath,
    created_at: new Date().toISOString(),
    checksum: '',  // 可选：后续可添加内容校验
    last_change_id: changeId,
    task_name: taskName,
    constraints: constraintsMarkdown,
    acceptance_criteria: acceptanceMarkdown,
    tasks: tasksMarkdown
  });
} else {
  // 模板缺失时使用简洁的内联生成
  tasksContent = generateInlineTasksDoc({
    techDesignPath,
    changeId,
    taskName,
    constraintsMarkdown,
    acceptanceMarkdown,
    tasksMarkdown
  });
}

ensureDir(workflowDir);
writeFile(tasksPath, tasksContent);

console.log(`
✅ 任务清单已生成

📄 文件路径：${tasksPath}
📊 任务数量：${tasks.length}
${acceptanceChecklist ? `📋 验证清单：.claude/acceptance/${sanitizedName}-checklist.md` : ''}

${tasks.map(t => `- [ ] ${t.id}: ${t.name} (${t.phase})`).join('\n')}
`);
```

## 任务属性详解

### id

任务唯一标识符，格式：`T1`, `T2`, `T3`, ...

### name

任务名称，简洁描述任务目标。

### phase

任务阶段，用于细粒度阶段划分，避免单个 phase 任务过多导致上下文溢出。

**阶段定义**：
- `design`: 接口设计、架构设计、类型定义
- `infra`: 基础设施、Store、工具函数、指令、守卫
- `ui-layout`: 页面布局、路由、菜单配置
- `ui-display`: 展示组件（卡片、表格、列表）
- `ui-form`: 表单组件（弹窗、输入、选择器）
- `ui-integrate`: 组件集成、注册、组装
- `test`: 单元测试、集成测试
- `verify`: 代码审查、质量关卡
- `deliver`: 提交、发布、文档

### file

目标文件路径（相对于项目根目录）。

### leverage

可复用组件路径，用于提示开发者继承或引用现有代码。

### design_ref

设计文档章节引用，格式：`4.1`, `4.2`, ...

### requirement

需求描述，详细说明任务要实现的功能。

### actions

执行动作，逗号分隔，支持：
- `create_file`: 创建新文件
- `edit_file`: 编辑现有文件
- `run_tests`: 运行测试
- `quality_review`: 两阶段代码审查
- `git_commit`: Git 提交

### depends

依赖任务 ID，格式：`T1`, `T2`, ...

### blocked_by

阻塞依赖，数组格式，支持：
- `api_spec`: 等待后端接口规格
- `external`: 等待第三方服务/SDK 就绪

> `design_spec` 已移除，设计稿依赖通过 `/figma-ui` 工作流处理。

### quality_gate

是否为质量关卡（布尔值）。质量关卡执行两阶段代码审查（规格合规 + 代码质量）。

### status

任务状态：
- `pending`: 待执行
- `blocked`: 被阻塞（有未解除的 blocked_by 依赖）
- `in_progress`: 执行中
- `completed`: 已完成
- `skipped`: 已跳过
- `failed`: 失败

### acceptance_criteria

关联的验收项 ID 数组（如果生成了验证清单）。

## 辅助函数

### extractImplementationPlan

从技术方案文档中提取实施计划表格。

```typescript
function extractImplementationPlan(techDesign: string): Array<{
  task: string;
  file: string;
  depends?: number;
  section?: string;
  description?: string;
  isQualityGate?: boolean;
}> {
  // 解析技术方案中的"4. 实施计划"表格
  // 返回任务数组
}
```

### determinePhase

根据任务名称和文件路径判断任务阶段。

```typescript
function determinePhase(item: any): string {
  const name = item.task.toLowerCase();
  const file = (item.file || '').toLowerCase();

  // 1. 设计阶段
  if (/接口|设计|interface|架构|architecture|类型|type/.test(name)) return 'design';

  // 2. 基础设施阶段（Store、工具、指令、守卫）
  if (/store|composable|hook|工具|util|helper|指令|directive|守卫|middleware|guard/.test(name) ||
      /stores\/|composables\/|utils\/|directives\/|middleware\//.test(file)) return 'infra';

  // 3. UI 布局阶段（页面、路由、菜单）
  if (/页面|page|路由|route|菜单|menu|布局|layout|主页|index/.test(name) ||
      /pages\/.*index|pages\/.*\.vue$/.test(file)) return 'ui-layout';

  // 4. UI 展示组件（卡片、表格、列表）
  if (/卡片|card|表格|table|列表|list|展示|display|筛选|filter/.test(name)) return 'ui-display';

  // 5. UI 表单组件（弹窗、表单、选择器）
  if (/弹窗|modal|dialog|表单|form|选择|select|输入|input|编辑|edit|创建|create/.test(name) ||
      /modals\/|dialogs\//.test(file)) return 'ui-form';

  // 6. UI 集成（注册、扩展、改造）
  if (/注册|register|集成|integrate|扩展|extend|改造|refactor|provider/.test(name)) return 'ui-integrate';

  // 7. 测试阶段
  if (/测试|test|单元|unit|集成|integration/.test(name)) return 'test';

  // 8. 验证阶段
  if (/审查|review|验证|verify|验收|qa|确认|check/.test(name)) return 'verify';

  // 9. 交付阶段
  if (/提交|commit|发布|release|部署|deploy|文档|doc/.test(name)) return 'deliver';

  // 默认：根据文件路径进一步判断
  if (/components\//.test(file)) return 'ui-display';  // 组件默认归类为展示

  return 'implement';  // 兜底
}
```

### determineActions

根据任务阶段判断执行动作。

```typescript
function determineActions(item: any): string {
  const phase = determinePhase(item);
  switch (phase) {
    case 'design': return 'create_file';
    case 'implement': return 'create_file,edit_file';
    case 'test': return 'create_file,run_tests';
    case 'verify': return 'quality_review';
    case 'deliver': return 'git_commit';
    default: return 'edit_file';
  }
}
```

### findLeverage

根据文件路径匹配可复用组件。

```typescript
function findLeverage(file: string, reusableComponents: any[]): string | null {
  if (!file) return null;

  // 根据文件类型匹配可复用组件
  const matches = reusableComponents.filter(c => {
    if (file.includes('Service') && c.path.includes('BaseService')) return true;
    if (file.includes('Controller') && c.path.includes('BaseController')) return true;
    if (file.includes('middleware') && c.path.includes('base')) return true;
    if (file.includes('Model') && c.path.includes('BaseModel')) return true;
    return false;
  });

  return matches.map(m => m.path).join(', ') || null;
}
```

### classifyTaskDependencies

自动分类任务依赖（api_spec / external）。

> `design_spec` 已移除，设计稿依赖通过 `/figma-ui` 工作流处理。
> `external` 优先从 Phase 0.2 讨论工件驱动，跳过 Phase 0.2 时回退到正则检测。

```typescript
function classifyTaskDependencies(
  task: { name: string; file?: string },
  discussionArtifact?: DiscussionArtifact
): string[] {
  const deps: string[] = [];
  const name = task.name.toLowerCase();
  const file = (task.file || '').toLowerCase();

  // 需要后端接口的任务
  if (/api|接口|服务层|service|fetch|request|http|数据获取|后端/.test(name) ||
      /services\/|api\/|http\/|requests\//.test(file)) {
    deps.push('api_spec');
  }

  // 从 Phase 0.2 讨论工件中映射未就绪依赖
  if (discussionArtifact?.unresolvedDependencies) {
    for (const dep of discussionArtifact.unresolvedDependencies) {
      if (dep.status === 'not_started' && !deps.includes(dep.type)) {
        deps.push(dep.type);  // 'api_spec' | 'external'
      }
    }
  } else {
    // 回退：Phase 0.2 被跳过时（--no-discuss 或内联短需求），正则检测 external 依赖
    if (/第三方|sdk|外部服务|third.party|payment|sms|oauth|oss/.test(name)) {
      if (!deps.includes('external')) {
        deps.push('external');
      }
    }
  }

  return deps;
}
```

### mapTaskToAcceptanceCriteria

将任务映射到验证清单项。

```typescript
function mapTaskToAcceptanceCriteria(
  task: Task,
  checklist: AcceptanceChecklist
): string[] {
  const criteria: string[] = [];

  // 根据任务阶段和文件路径匹配验收项
  const phase = task.phase;
  const file = (task.file || '').toLowerCase();
  const requirement = (task.requirement || '').toLowerCase();

  // 表单相关任务 → 表单验证项
  if (/form|表单|input|输入/.test(requirement) || /form|modal|dialog/.test(file)) {
    checklist.formValidations.forEach(validation => {
      validation.items.forEach((item, index) => {
        if (requirement.includes(item.fieldName.toLowerCase()) ||
            requirement.includes(validation.scene.toLowerCase())) {
          criteria.push(`AC-${validation.sceneId}.${index + 1} ${item.fieldName}`);
        }
      });
    });
  }

  // 权限相关任务 → 权限验证项
  if (/权限|permission|role|auth/.test(requirement) || phase === 'infra') {
    checklist.permissionValidations.forEach(validation => {
      validation.items.forEach((item, index) => {
        if (requirement.includes(validation.role.toLowerCase()) ||
            requirement.includes(item.scenario.toLowerCase())) {
          criteria.push(`AC-${validation.roleId}.${index + 1} ${validation.role} - ${item.scenario}`);
        }
      });
    });
  }

  // ... 其他维度匹配

  // 如果没有匹配到任何验收项，返回通用验收标准
  if (criteria.length === 0) {
    criteria.push('通用验收标准：功能正常、无报错、符合设计规格');
  }

  return criteria;
}
```

### extractAcceptanceCriteria

从技术方案中提取验收标准。

```typescript
function extractAcceptanceCriteria(techDesign: string): string[] {
  // 解析技术方案中的"6. 验收标准"章节
  // 返回验收标准数组
}
```

### generateInlineTasksDoc

模板缺失时使用的内联生成函数。

```typescript
function generateInlineTasksDoc(params: {
  techDesignPath: string;
  changeId: string;
  taskName: string;
  constraintsMarkdown: string;
  acceptanceMarkdown: string;
  tasksMarkdown: string;
}): string {
  return `---
version: 2
tech_design: "${params.techDesignPath}"
created_at: "${new Date().toISOString()}"
checksum: ""
last_change: "${params.changeId}"
---

# Tasks: ${params.taskName}

## 设计文档

📄 \`${params.techDesignPath}\`

## 约束（从设计文档继承）

${params.constraintsMarkdown}

## 验收标准

${params.acceptanceMarkdown}

---

${params.tasksMarkdown}
`;
}
```

## 输出

任务清单将用于：
- Hard Stop 2: 用户审查任务清单
- Step 3: 创建工作流状态（workflow-state.json）
- 执行阶段：任务执行的依据
