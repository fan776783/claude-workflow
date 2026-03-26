# Phase 3: Task Compilation 详情

## 目的

将 `spec.md + plan.md + brief + requirement baseline` 编译为运行时 `tasks.md`，为执行系统提供依赖明确、步骤清晰、可验证的任务编排清单。

## 执行时机

**强制执行**：Phase 2.5 Plan Review 通过后。

## 输入

- `spec.md`
- `plan.md`
- `requirement baseline`
- `brief`（如有）
- `analysisResult`
- `discussion-artifact.json`（如有，用于 blocked_by 分类）

## 输出

- `~/.claude/workflows/{projectId}/tasks-{task-name}.md`
- `workflow-state.json`

## 设计原则

- 不再从 `tech-design.md` 直接解析实施计划
- 任务的事实来源是 `plan.md`
- 任务的范围与章节引用来自 `spec.md`
- 任务的验收映射来自 `brief`
- 任务的 requirement IDs 与关键约束来自 `requirement baseline`
- `tasks.md` 只写入 V2 任务字段，执行链路不再消费旧任务格式
- Task Compilation 应优先按稳定 governance slice 编译顶层任务，而不是默认“一条 atomic step = 一个顶层任务”
- `steps[]` 继续保留原子步骤，用于 traceability 与验证，不直接定义 phase 粒度

## 实现细节

### Step 1: 读取输入文档

```typescript
const specContent = readFile(specPath);
const planContent = readFile(planPath);
const baselineContent = requirementBaselinePath ? readFile(requirementBaselinePath) : '';
const briefContent = briefPath ? readFile(briefPath) : '';
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
const governanceSlices = parseGovernanceSlices(planContent);

const tasks = compileTasksFromGovernanceSlices({
  governanceSlices,
  planSteps,
  briefContent,
  baselineContent,
  analysisResult,
  discussionArtifact
});
```

**编译原则**：
- 顶层任务优先按 stable governance slice 聚合
- 同一 governance slice 下的 atomic steps 应写入同一个任务的 `steps[]`
- `phase` 应来自治理切片，而不是从每个 atomic step 机械推导
- 若一个 slice 内已经识别出多个同阶段独立边界，可在任务元数据中保留 `boundary_key` / `continuation_safe` 等线索，供执行期调度使用
- 仅在确有必要时，才把单个 atomic step 提升为顶层任务

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
      requirement_ids: codeTask.requirement_ids,
      critical_constraints: codeTask.critical_constraints,
      actions: ['quality_review'],
      steps: [{
        id: 'Q1',
        description: '执行两阶段代码审查',
        expected: '规格合规与代码质量均通过',
        verification: 'quality_review',
        requirement_ids: codeTask.requirement_ids,
        critical_constraints: codeTask.critical_constraints
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
  spec_ref: '§9 Implementation Slices',
  plan_ref: 'COMMIT',
  requirement_ids: [],
  critical_constraints: [],
  actions: ['git_commit'],
  steps: [{
    id: 'C1',
    description: '提交本次改动',
    expected: '生成清晰且可追溯的提交',
    verification: 'git status 应仅剩未跟踪文档或为空',
    requirement_ids: [],
    critical_constraints: []
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
  requirementBaselinePath,
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
state.traceability = {
  baseline_path: requirementBaselinePath,
  mappings: buildTraceabilityMappings(tasks, briefContent, baselineContent),
  coverage_summary: summarizeTaskCoverage(tasks)
};
state.review_status.plan_review.status = 'passed';
writeFile(statePath, JSON.stringify(state, null, 2));
```

## 核心接口

```typescript
interface ParsedPlanStep {
  id: string;
  goal: string;
  specRef: string;
  requirement_ids: string[];
  critical_constraints: string[];
  files: string[];
  actionType: 'create_file' | 'edit_file' | 'run_tests' | 'quality_review' | 'git_commit';
  expected: string;
  verification?: string;
  dependsOn?: string[];
  governanceSliceId?: string;
}

interface CompiledTaskMetadata {
  boundary_key?: string;
  continuation_safe?: boolean;
  integration_risk?: 'low' | 'medium' | 'high';
  governance_boundary?: 'none' | 'phase' | 'quality_gate' | 'commit' | 'blocked';
}
```
