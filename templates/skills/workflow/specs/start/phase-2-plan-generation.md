# Phase 2: Plan Generation 详情

## 目的

从已批准的 `spec.md` 生成可直接执行的实施计划。Plan 的每一步都必须包含完整的代码块和验证命令，禁止任何占位符。

> plan.md 的读者是一个"有技术能力但零项目上下文"的工程师。他应该能按照 plan 的每一步直接执行，不需要猜测。

## 执行时机

**强制执行**：Phase 1.1 User Spec Review 通过后。

## 输入

- `spec.md`（唯一规范输入）
- `analysisResult`（代码分析结果，仅作为可复用组件和文件规划的辅助上下文，不改变 spec 作为唯一规范来源的地位）

## 输出

- `.claude/plans/{task-name}.md`

## 设计原则

- **Spec-Normative Input** — spec.md 是唯一规范输入；`analysisResult` 仅作为文件规划与复用提示的辅助上下文
- **File Structure First** — 先列文件，再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟的原子操作
- **Complete Code** — 每步包含完整代码块（不是伪代码或描述）
- **Exact Commands** — 验证命令包含预期输出
- **No Placeholders** — 禁止 TBD/TODO/"类似 Task N"/模糊描述
- **WorkflowTaskV2 Compatible** — 任务块必须使用 `## Tn:` 标题和 V2 字段，供执行器直接解析
- **Spec Section Ref** — 每步标注对应的 spec 章节

## No Placeholders 规则

以下内容在 plan 中出现即为**plan failure**，必须替换为实际内容：

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation"
- "Write tests for the above"（未提供实际测试代码）
- "Similar to Task N"（必须重复代码）
- 描述"做什么"但不展示"怎么做"的步骤
- 引用未在任何 task 中定义的类型、函数或方法

## 实现细节

### Step 1: 准备输入与输出路径

```typescript
const planPath = `.claude/plans/${sanitizedName}.md`;
ensureDir('.claude/plans');

const specContent = readFile(specPath);
```

### Step 2: 提取文件结构

```typescript
const filePlan = deriveFilePlan(specContent, analysisResult);
const slices = extractImplementationSlices(specContent);
```

### Step 3: 生成 WorkflowTaskV2 任务块

```typescript
const tasks: WorkflowTaskV2[] = [];
let index = 1;

for (const slice of slices) {
  for (const file of slice.files) {
    tasks.push({
      id: `T${index++}`,
      name: `实现 ${file.description}`,
      phase: slice.phase || 'implement',
      files: {
        create: file.isNew ? [file.path] : [],
        modify: file.isNew ? [] : [file.path],
        test: file.testPath ? [file.testPath] : []
      },
      specRef: slice.specRef,
      planRef: `P-${slice.name}`,
      acceptanceCriteria: deriveAcceptanceCriteriaForSlice(slice),
      actions: deriveTaskActions(file),
      verification: {
        commands: deriveVerificationCommands(file),
        expectedOutput: deriveExpectedOutputs(file)
      },
      steps: [
        {
          id: 'S1',
          description: `编写 ${file.description} 的失败测试`,
          expected: '测试稳定失败并暴露目标行为缺口',
          verification: file.testCommand
        },
        {
          id: 'S2',
          description: `实现 ${file.description} 的最小代码变更`,
          expected: '目标能力可用且符合 Spec 约束'
        },
        {
          id: 'S3',
          description: '运行验证命令并确认全部通过',
          expected: '测试、类型检查或 lint 全部通过',
          verification: file.testCommand
        }
      ]
    });
  }
}
```

### Step 4: 渲染 Plan 文档

```typescript
const planTemplate = loadTemplate('plan-template.md');
const planContent = replaceVars(planTemplate, {
  task_name: taskName,
  requirement_source: requirementSource,
  spec_file: specPath,
  created_at: new Date().toISOString(),
  goal: extractGoal(specContent),
  architecture_summary: extractArchitectureSummary(specContent),
  tech_stack: extractTechStack(specContent),
  files_create: renderFileList(filePlan.create),
  files_modify: renderFileList(filePlan.modify),
  files_test: renderFileList(filePlan.test),
  tasks: renderWorkflowTasksV2(tasks)
});

writeFile(planPath, planContent);
```

### Step 5: Self-Review

Plan 生成后立即执行自审查：

```typescript
function selfReviewPlan(planContent: string, specContent: string): void {
  // 1. Spec coverage: 逐条检查 spec 的每个需求
  const specRequirements = extractRequirements(specContent);
  const planTasks = extractTasks(planContent);

  for (const req of specRequirements) {
    const covered = planTasks.some(task =>
      task.specRef === req.sectionRef || task.code.includes(req.keyword)
    );
    if (!covered) {
      console.warn(`⚠️ Spec 需求 [${req.id}] 未在 plan 中找到对应 task`);
      // 自动补充 task
    }
  }

  // 2. Placeholder scan: 搜索禁止内容
  const placeholders = ['TBD', 'TODO', 'implement later', 'fill in details',
    'add appropriate', 'similar to Task', 'write tests for'];
  for (const ph of placeholders) {
    if (planContent.toLowerCase().includes(ph.toLowerCase())) {
      console.error(`❌ Plan 包含禁止的占位符: "${ph}"`);
      // 自动替换为实际内容
    }
  }

  // 3. Type consistency: 检查跨 task 的类型/函数名一致性
  const definedSymbols = extractDefinitions(planContent);
  const usedSymbols = extractUsages(planContent);
  for (const used of usedSymbols) {
    if (!definedSymbols.includes(used)) {
      console.warn(`⚠️ Plan 使用了未定义的符号: ${used}`);
    }
  }
}

selfReviewPlan(planContent, specContent);
```

## Plan 文档结构

```markdown
# [Feature Name] Implementation Plan

> **Spec**: `.claude/specs/{name}.md`

**Goal:** [一句话描述]
**Architecture:** [2-3 句架构方案]
**Tech Stack:** [关键技术]

---

## File Structure

### Files to Create
- `exact/path/to/file.ts` — 职责描述

### Files to Modify
- `exact/path/to/existing.ts` — 修改说明

### Files to Test
- `tests/exact/path/to/test.ts`

---

## T1: 实现组件能力

- **阶段**: implement
- **创建文件**: `src/components/FeatureCard.tsx`
- **测试文件**: `tests/components/FeatureCard.test.tsx`
- **Spec 参考**: §5.1
- **Plan 参考**: P-feature-card
- **验收项**: AC-001, AC-002
- **actions**: create_file, run_tests
- **验证命令**: `pnpm test tests/components/FeatureCard.test.tsx`, `pnpm lint`
- **验证期望**: `PASS`, `0 errors`
- **步骤**:
  - S1: 编写失败测试覆盖卡片渲染与交互 → 测试稳定失败并暴露缺失能力（验证：`pnpm test tests/components/FeatureCard.test.tsx`）
  - S2: 实现组件与最小样式结构 → 组件行为符合 Spec 与约束
  - S3: 运行测试与 lint → 所有验证通过（验证：`pnpm test tests/components/FeatureCard.test.tsx && pnpm lint`）
```

## 强制规则

- 所有 spec 中的 in_scope 需求至少映射到一个 plan task
- 每个 task 的每个 step 包含完整代码或命令
- 禁止任何占位符内容
- 验证命令必须包含预期输出
- Self-Review 不通过时必须修复后才能提交
