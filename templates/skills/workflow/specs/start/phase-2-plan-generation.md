# Phase 2: Plan Generation 详情

## 目的

从已批准的 `spec.md`、验收清单和实现指南生成 `plan.md`，将规范层转化为细粒度、可验证、可编译的实施计划。

## 执行时机

**强制执行**：Phase 1.5 Intent Review 通过后，Phase 2.5 Plan Review 之前。

## 输入

- `spec.md`
- `acceptance checklist`（如有）
- `implementation guide`（如有）
- `analysisResult`

## 输出

- `.claude/plans/{task-name}.md`

## 设计原则

- **Scope Check**：只承接已批准 Spec 的范围
- **File Structure First**：先列文件，再排步骤
- **Atomic Steps**：计划步骤应足够小，便于编译为任务 steps[]
- **Explicit Verification**：每个步骤都有验证方式
- **Execution-neutral**：Plan 提供编排输入，但不直接承担执行状态

## 实现细节

### Step 1: 准备输入与输出路径

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧭 Phase 2: Plan Generation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const planPath = `.claude/plans/${sanitizedName}.md`;
ensureDir('.claude/plans');

const specContent = readFile(specPath);
const acceptanceContent = acceptanceChecklistPath ? readFile(acceptanceChecklistPath) : '';
const implementationGuideContent = implementationGuidePath ? readFile(implementationGuidePath) : '';
```

### Step 2: 执行 Scope Check

```typescript
const scopeCheck = validatePlanScope(specContent, requirementContent);
if (!scopeCheck.passed) {
  console.log(`
⚠️ Plan 生成中止：发现超出 Spec 的范围
${scopeCheck.issues.map(i => `- ${i}`).join('\n')}
  `);
  return;
}
```

### Step 3: 提取文件结构与切片

```typescript
const filePlan = deriveFilePlan(specContent, analysisResult);
const slices = deriveImplementationSlices(specContent);
const verificationPlan = deriveVerificationPlan(acceptanceContent, implementationGuideContent);
```

### Step 4: 生成原子步骤

```typescript
const atomicSteps = generateAtomicPlanSteps({
  specContent,
  filePlan,
  slices,
  verificationPlan
});
```

### Step 5: 渲染 Plan 文档

```typescript
const planTemplate = loadTemplate('plan-template.md');

let planContent: string;
if (planTemplate) {
  planContent = replaceVars(planTemplate, {
    task_name: taskName,
    requirement_source: requirementSource,
    created_at: new Date().toISOString(),
    spec_file: specPath,
    acceptance_checklist_path: acceptanceChecklistPath || '',
    implementation_guide_path: implementationGuidePath || '',
    files_create: renderFileList(filePlan.create),
    files_modify: renderFileList(filePlan.modify),
    files_test: renderFileList(filePlan.test),
    reuse_summary: renderReuseSummary(analysisResult.reusableComponents),
    ordering_rationale: renderOrderingRationale(slices),
    atomic_steps: renderAtomicSteps(atomicSteps),
    verification_plan: renderVerificationPlan(verificationPlan)
  });
} else {
  planContent = generateInlinePlan({
    taskName,
    requirementSource,
    specPath,
    acceptanceChecklistPath,
    implementationGuidePath,
    filePlan,
    analysisResult,
    slices,
    atomicSteps,
    verificationPlan
  });
}

writeFile(planPath, planContent);
console.log(`✅ Plan 已生成：${planPath}`);
```

## 数据结构

```typescript
interface PlanFileStructure {
  create: string[];
  modify: string[];
  test: string[];
}

interface PlanStep {
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

### validatePlanScope

```typescript
function validatePlanScope(specContent: string, requirementContent: string): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!/## 2\. Scope/.test(specContent)) {
    issues.push('Spec 缺少 Scope 章节，无法安全生成 Plan');
  }
  if (!/## 7\. Implementation Slices/.test(specContent)) {
    issues.push('Spec 缺少 Implementation Slices，无法推导计划顺序');
  }
  return { passed: issues.length === 0, issues };
}
```

### deriveFilePlan

```typescript
function deriveFilePlan(specContent: string, analysisResult: any): PlanFileStructure {
  return {
    create: extractBulletList(specContent, '### 5.1 Files to Create'),
    modify: extractBulletList(specContent, '### 5.2 Files to Modify'),
    test: extractBulletList(specContent, '### 5.3 Files to Test')
  };
}
```

### deriveImplementationSlices

```typescript
function deriveImplementationSlices(specContent: string): string[] {
  return extractNumberedList(specContent, '## 7. Implementation Slices');
}
```

### generateAtomicPlanSteps

```typescript
function generateAtomicPlanSteps(params: {
  specContent: string;
  filePlan: PlanFileStructure;
  slices: string[];
  verificationPlan: string[];
}): PlanStep[] {
  const steps: PlanStep[] = [];
  let index = 1;

  for (const file of params.filePlan.create) {
    steps.push({
      id: `P${index++}`,
      goal: `创建并建立 ${file} 的基础结构`,
      specRef: '§5 File Structure',
      files: [file],
      actionType: 'create_file',
      expected: `${file} 已创建且结构正确`,
      verification: '类型检查 / 语法检查通过'
    });
  }

  for (const file of params.filePlan.modify) {
    steps.push({
      id: `P${index++}`,
      goal: `在 ${file} 中接入目标能力`,
      specRef: '§3 User-facing Behavior',
      files: [file],
      actionType: 'edit_file',
      expected: `${file} 已按 Spec 修改`,
      verification: '相关测试或手动验证通过'
    });
  }

  for (const file of params.filePlan.test) {
    steps.push({
      id: `P${index++}`,
      goal: `为 ${file} 补充测试覆盖`,
      specRef: '§6 Acceptance Mapping',
      files: [file],
      actionType: 'run_tests',
      expected: '关键验收项有对应测试',
      verification: '测试命令通过'
    });
  }

  return steps;
}
```

## 输出要求

生成的 `plan.md` 必须满足：

- 引用明确的 `spec_file`
- 具有稳定的步骤 ID（P1, P2, ...）
- 每个步骤可映射到 Task Compilation 中的 `steps[]`
- 每个步骤尽量只聚焦一类文件或一个单一目标
