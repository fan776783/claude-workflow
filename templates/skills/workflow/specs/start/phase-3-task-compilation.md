# Phase 3: Task Compilation 详情

## 目的

将 `spec.md + plan.md + acceptance checklist` 编译为运行时 `tasks.md`，为执行系统提供依赖明确、步骤清晰、可验证的任务编排清单。

## 执行时机

**强制执行**：Phase 2.5 Plan Review 通过后。

## 输入

- `spec.md`
- `plan.md`
- `acceptance checklist`（如有）
- `analysisResult`
- `discussion-artifact.json`（如有，用于 blocked_by 分类）

## 输出

- `~/.claude/workflows/{projectId}/tasks-{task-name}.md`
- `workflow-state.json`

## 设计原则

- 不再从 `tech-design.md` 直接解析实施计划
- 任务的事实来源是 `plan.md`
- 任务的范围与章节引用来自 `spec.md`
- 任务的验收映射来自 `acceptance checklist`
- `tasks.md` 只写入 V2 任务字段，执行链路不再消费旧任务格式

## 实现细节

### Step 1: 读取输入文档

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Phase 3: Task Compilation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const specContent = readFile(specPath);
const planContent = readFile(planPath);
const acceptanceContent = acceptanceChecklistPath ? readFile(acceptanceChecklistPath) : '';
```

### Step 2: 解析 Plan 步骤

```typescript
const planSteps = parsePlanSteps(planContent);

if (planSteps.length === 0) {
  console.log('❌ 未从 plan.md 解析到任何步骤，无法编译任务');
  return;
}
```

### Step 3: 生成 WorkflowTaskV2 列表

```typescript
const tasks = planSteps.map((step, index) => {
  const files = classifyFiles(step.files);
  const task = {
    id: `T${index + 1}`,
    name: step.goal,
    phase: determinePhaseFromPlanStep(step),
    files,
    leverage: findLeverage(step.files[0], analysisResult.reusableComponents)?.split(', ') || [],
    spec_ref: step.specRef,
    plan_ref: step.id,
    actions: [mapActionType(step.actionType)],
    steps: [{
      id: step.id,
      description: step.goal,
      expected: step.expected,
      verification: step.verification
    }],
    verification: step.verification
      ? { commands: [step.verification], expected_output: ['命令成功执行'], notes: [] }
      : undefined,
    depends: step.dependsOn || [],
    blocked_by: [],
    quality_gate: false,
    status: 'pending',
    acceptance_criteria: []
  } satisfies WorkflowTaskV2;

  const taskFiles = [
    ...(task.files.create || []),
    ...(task.files.modify || []),
    ...(task.files.test || [])
  ];
  const blockedBy = classifyTaskDependencies({ name: task.name, files: taskFiles }, discussionArtifact);
  if (blockedBy.length > 0) {
    task.blocked_by = blockedBy;
    task.status = 'blocked';
  }

  if (acceptanceContent) {
    task.acceptance_criteria = mapTaskToAcceptanceCriteriaV2(task, acceptanceContent);
  }

  return task;
});
```

### Step 4: 添加标准质量关卡

```typescript
if (!tasks.some(t => t.quality_gate)) {
  const codeTask = tasks.filter(t =>
    t.actions.includes('create_file') ||
    t.actions.includes('edit_file') ||
    t.actions.includes('run_tests')
  ).pop();

  if (codeTask) {
    tasks.push({
      id: `T${tasks.length + 1}`,
      name: '两阶段代码审查',
      phase: 'verify',
      files: {},
      leverage: [],
      spec_ref: codeTask.spec_ref,
      plan_ref: 'QUALITY_GATE',
      actions: ['quality_review'],
      steps: [{
        id: 'Q1',
        description: '执行两阶段代码审查',
        expected: '规格合规与代码质量均通过',
        verification: 'quality_review'
      }],
      depends: [codeTask.id],
      blocked_by: [],
      quality_gate: true,
      status: 'pending',
      acceptance_criteria: []
    });
  }
}
```

### Step 5: 添加提交任务

```typescript
tasks.push({
  id: `T${tasks.length + 1}`,
  name: '提交代码',
  phase: 'deliver',
  files: {},
  leverage: [],
  spec_ref: '§7 Implementation Slices',
  plan_ref: 'COMMIT',
  actions: ['git_commit'],
  steps: [{
    id: 'C1',
    description: '提交本次改动',
    expected: '生成清晰且可追溯的提交',
    verification: 'git status 应仅剩未跟踪文档或为空'
  }],
  depends: [tasks[tasks.length - 1].id],
  blocked_by: [],
  quality_gate: false,
  status: 'pending',
  acceptance_criteria: []
});
```

### Step 6: 生成 tasks.md 文件

```typescript
const tasksPath = path.join(workflowDir, `tasks-${sanitizedName}.md`);
const tasksMarkdown = tasks.map(renderWorkflowTaskV2).join('\n\n');

const tasksContent = generateTasksDocument({
  taskName,
  techDesignPath,
  specPath,
  planPath,
  changeId,
  tasksMarkdown
});

ensureDir(workflowDir);
writeFile(tasksPath, tasksContent);
```

### Step 7: 初始化 workflow-state

```typescript
state.status = 'planned';
state.tech_design = techDesignPath;
state.spec_file = specPath;
state.plan_file = planPath;
state.tasks_file = tasksPath;
state.review_status.plan_review.status = 'passed';
writeFile(statePath, JSON.stringify(state, null, 2));
```

## 核心接口

```typescript
interface ParsedPlanStep {
  id: string;
  goal: string;
  specRef: string;
  files: string[];
  actionType: 'create_file' | 'edit_file' | 'run_tests' | 'quality_review' | 'git_commit';
  expected: string;
  verification?: string;
  dependsOn?: string[];
}
```

## 辅助函数

### parsePlanSteps

```typescript
function parsePlanSteps(planContent: string): ParsedPlanStep[] {
  const blocks = [...planContent.matchAll(/### Step (P\d+)[\s\S]*?(?=\n### Step P\d+|$)/g)];
  return blocks.map(match => {
    const block = match[0];
    return {
      id: match[1],
      goal: extractBulletValue(block, 'Goal') || '未命名步骤',
      specRef: extractBulletValue(block, 'Spec Ref') || '§7 Implementation Slices',
      files: splitCommaList(extractBulletValue(block, 'Files')),
      actionType: (extractBulletValue(block, 'Action Type') as any) || 'edit_file',
      expected: extractBulletValue(block, 'Expected Result') || '达到预期结果',
      verification: extractBulletValue(block, 'Verification') || undefined,
      dependsOn: splitCommaList(extractBulletValue(block, 'Depends On'))
    };
  });
}
```

### classifyFiles

```typescript
function classifyFiles(files: string[]): { create?: string[]; modify?: string[]; test?: string[] } {
  return {
    create: files.filter(f => !/test|spec\./.test(f) && !/existing|index/.test(f)),
    modify: files.filter(f => /existing|index|src\//.test(f)),
    test: files.filter(f => /test|spec\./.test(f))
  };
}
```

### determinePhaseFromPlanStep

```typescript
function determinePhaseFromPlanStep(step: ParsedPlanStep): string {
  if (step.actionType === 'run_tests') return 'test';
  if (step.actionType === 'quality_review') return 'verify';
  if (step.actionType === 'git_commit') return 'deliver';
  if (/接口|类型|schema|model|contract/i.test(step.goal)) return 'design';
  if (/store|hook|middleware|guard|util|helper/i.test(step.goal)) return 'infra';
  if (/page|layout|route|menu/i.test(step.goal)) return 'ui-layout';
  if (/table|list|card|display/i.test(step.goal)) return 'ui-display';
  if (/form|modal|dialog|input|select/i.test(step.goal)) return 'ui-form';
  return 'implement';
}
```

### mapActionType

```typescript
function mapActionType(actionType: ParsedPlanStep['actionType']) {
  return actionType;
}
```

### renderWorkflowTaskV2

```typescript
function renderWorkflowTaskV2(task: WorkflowTaskV2): string {
  const createFiles = task.files.create?.join(', ') || '';
  const modifyFiles = task.files.modify?.join(', ') || '';
  const testFiles = task.files.test?.join(', ') || '';

  return `## ${task.id}: ${task.name}
- **阶段**: ${task.phase}
${createFiles ? `- **创建文件**: \`${createFiles}\`` : ''}
${modifyFiles ? `- **修改文件**: \`${modifyFiles}\`` : ''}
${testFiles ? `- **测试文件**: \`${testFiles}\`` : ''}
${task.leverage?.length ? `- **复用**: \`${task.leverage.join(', ')}\`` : ''}
- **Spec 参考**: ${task.spec_ref}
- **Plan 参考**: ${task.plan_ref}
${task.acceptance_criteria?.length ? `- **验收项**: ${task.acceptance_criteria.join(', ')}` : ''}
- **actions**: \`${task.actions.join(',')}\`
${task.depends?.length ? `- **依赖**: ${task.depends.join(', ')}` : ''}
${task.blocked_by?.length ? `- **阻塞依赖**: \`${task.blocked_by.join(', ')}\`` : ''}
${task.quality_gate ? `- **质量关卡**: true（两阶段代码审查）` : ''}
- **状态**: ${task.status}
${task.verification?.commands?.length ? `- **验证命令**: \`${task.verification.commands.join(', ')}\`` : ''}
${task.verification?.expected_output?.length ? `- **验证期望**: ${task.verification.expected_output.join(', ')}` : ''}
- **步骤**:
${task.steps.map(s => `  - ${s.id}: ${s.description} → ${s.expected}${s.verification ? `（验证：${s.verification}）` : ''}`).join('\n')}`;
}
```

## 输出要求

- `tasks.md` 仅写入 V2 字段
- 文档中必须保留 `Spec 参考` 与 `Plan 参考`
- `files{}`、`actions[]`、`steps[]`、`verification` 是执行链路的唯一任务数据来源
