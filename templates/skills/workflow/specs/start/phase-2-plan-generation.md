# Phase 2: Plan Generation 详情

## 目的

从已批准的 `spec.md`、Requirement Baseline、brief 生成 `plan.md`，将规范层转化为细粒度、可验证、可编译的实施计划。

## 执行时机

**强制执行**：Phase 1.5 Intent Review 通过后，Phase 2.5 Plan Review 之前。

## 输入

- `spec.md`
- `requirement baseline`
- `brief`（如有）
- `analysisResult`

## 输出

- `.claude/plans/{task-name}.md`

## 设计原则

- **Scope Check**：只承接已批准 Spec 的范围
- **Baseline-backed**：计划必须从 requirement IDs 出发，而不只是从 capability 标题出发
- **File Structure First**：先列文件，再排步骤
- **Governance Slices First**：先定义稳定的 implementation / governance slices，再在 slice 内生成原子步骤
- **Atomic Steps**：计划步骤应足够小，便于编译为任务 `steps[]`
- **Explicit Verification**：每个步骤都有验证方式
- **Requirement Coverage by Step**：每个 in-scope requirement 至少映射到一个步骤
- **Execution-neutral**：Plan 提供编排输入，但不直接承担执行状态
- **Phase Is Governance Boundary**：phase 用于表达治理边界，而不是对每个微实现步骤做机械切分

## 实现细节

### Step 1: 准备输入与输出路径

```typescript
const planPath = `.claude/plans/${sanitizedName}.md`;
ensureDir('.claude/plans');

const specContent = readFile(specPath);
const baselineContent = requirementBaselinePath ? readFile(requirementBaselinePath) : '';
const briefContent = briefPath ? readFile(briefPath) : '';
```

### Step 2: 执行 Scope Check

```typescript
const scopeCheck = validatePlanScope(specContent, baselineContent);
if (!scopeCheck.passed) {
  console.log(`
⚠️ Plan 生成中止：发现超出 Spec 的范围
${scopeCheck.issues.map(i => `- ${i}`).join('\n')}
  `);
  return;
}
```

### Step 3: 提取文件结构、治理切片与 requirement 集合

```typescript
const filePlan = deriveFilePlan(specContent, analysisResult);
const slices = deriveImplementationSlices(specContent);
const governanceSlices = deriveGovernanceSlices({
  specContent,
  baselineContent,
  briefContent,
  implementationSlices: slices
});
const verificationPlan = deriveVerificationPlan(briefContent);
const inScopeRequirements = extractInScopeRequirements(baselineContent);
const criticalConstraints = extractCriticalConstraints(baselineContent);
```

> `governanceSlices` 是 Plan 到 Task Compilation 的中间层：
> - 用于表达稳定的 implementation scope
> - 用于承载 phase / boundary / quality gate / commit gate / integration risk
> - 不替代 atomic steps，而是为 atomic steps 提供更粗的治理容器

### Step 4: 在治理切片内生成原子步骤

```typescript
const atomicSteps = generateAtomicPlanSteps({
  specContent,
  baselineContent,
  filePlan,
  slices,
  governanceSlices,
  verificationPlan
});
```

### Step 5: 渲染 Plan 文档

```typescript
const planTemplate = loadTemplate('plan-template.md');

const planContent = replaceVars(planTemplate, {
  task_name: taskName,
  requirement_source: requirementSource,
  created_at: new Date().toISOString(),
  requirement_baseline_path: requirementBaselinePath || '',
  spec_file: specPath,
  brief_path: briefPath || '',
  files_create: renderFileList(filePlan.create),
  files_modify: renderFileList(filePlan.modify),
  files_test: renderFileList(filePlan.test),
  reuse_summary: renderReuseSummary(analysisResult.reusableComponents),
  ordering_rationale: renderOrderingRationale(slices),
  non_negotiable_requirement_constraints: renderNonNegotiableConstraints(criticalConstraints),
  atomic_steps: renderAtomicSteps(atomicSteps),
  verification_plan: renderVerificationPlan(verificationPlan),
  requirement_coverage_by_step: renderRequirementCoverageByStep(atomicSteps, inScopeRequirements)
});

writeFile(planPath, planContent);
```

## 数据结构

```typescript
interface PlanFileStructure {
  create: string[];
  modify: string[];
  test: string[];
}

interface GovernanceSlice {
  id: string;
  name: string;
  phase: string;
  boundary_key?: string;
  continuation_safe: boolean;
  integration_risk: 'low' | 'medium' | 'high';
  quality_gate_after?: boolean;
  commit_gate_after?: boolean;
  requirement_ids: string[];
}

interface PlanStep {
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
```

## 辅助函数

### validatePlanScope

```typescript
function validatePlanScope(specContent: string, baselineContent: string): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!/## 2\. Scope/.test(specContent)) {
    issues.push('Spec 缺少 Scope 章节，无法安全生成 Plan');
  }
  if (!/## 9\. Implementation Slices/.test(specContent)) {
    issues.push('Spec 缺少 Implementation Slices，无法推导计划顺序');
  }
  if (!baselineContent) {
    issues.push('缺少 Requirement Baseline，无法安全生成 requirement coverage');
  }
  return { passed: issues.length === 0, issues };
}
```

### generateAtomicPlanSteps

```typescript
function generateAtomicPlanSteps(params: {
  specContent: string;
  baselineContent: string;
  filePlan: PlanFileStructure;
  slices: string[];
  verificationPlan: string[];
}): PlanStep[] {
  const steps: PlanStep[] = [];
  const requirements = extractInScopeRequirements(params.baselineContent);
  let index = 1;

  for (const file of params.filePlan.create) {
    const matchedRequirements = matchRequirementsForFile(file, requirements);
    steps.push({
      id: `P${index++}`,
      goal: `创建并建立 ${file} 的基础结构`,
      specRef: '§7 File Structure',
      requirement_ids: matchedRequirements.map(r => r.id),
      critical_constraints: matchedRequirements.flatMap(r => r.constraints),
      files: [file],
      actionType: 'create_file',
      expected: `${file} 已创建且结构正确`,
      verification: '类型检查 / 语法检查通过'
    });
  }

  for (const file of params.filePlan.modify) {
    const matchedRequirements = matchRequirementsForFile(file, requirements);
    steps.push({
      id: `P${index++}`,
      goal: `在 ${file} 中接入目标能力`,
      specRef: '§5 User-facing Behavior',
      requirement_ids: matchedRequirements.map(r => r.id),
      critical_constraints: matchedRequirements.flatMap(r => r.constraints),
      files: [file],
      actionType: 'edit_file',
      expected: `${file} 已按 Spec 修改`,
      verification: '相关测试或手动验证通过'
    });
  }

  for (const file of params.filePlan.test) {
    const matchedRequirements = matchRequirementsForFile(file, requirements);
    steps.push({
      id: `P${index++}`,
      goal: `为 ${file} 补充测试覆盖`,
      specRef: '§8 Acceptance Mapping',
      requirement_ids: matchedRequirements.map(r => r.id),
      critical_constraints: matchedRequirements.flatMap(r => r.constraints),
      files: [file],
      actionType: 'run_tests',
      expected: '关键验收项有对应测试',
      verification: '测试命令通过'
    });
  }

  return steps;
}
```
