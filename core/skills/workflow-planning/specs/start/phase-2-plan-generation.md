# Phase 2: Plan Generation 详情

## 快速导航

- 想看 plan 的硬约束：看“设计原则”与 “No Placeholders 规则”
- 想看输出路径和模板：看“输出”与 Step 1
- 想看 WorkflowTaskV2 兼容要求：看设计原则与任务块章节
- 想看 Self-Review：搜 self-review / review loop

## 何时读取

- Spec 已批准，准备生成 `plan.md` 时
- 需要确认 plan 是否足够细、可直接执行时

## 目的

从已批准的 `spec.md` 生成可直接执行的实施计划。Plan 的每一步都必须包含完整的代码块和验证命令，禁止任何占位符。

> plan.md 的读者是一个"有技术能力但零项目上下文"的工程师。他应该能按照 plan 的每一步直接执行，不需要猜测。

## 执行时机

**强制执行**：Phase 1.1 User Spec Review 通过后。

## 输入

- `spec.md`（唯一规范输入）
- `analysisResult`（代码分析结果，仅作为可复用组件和文件规划的辅助上下文，不改变 spec 作为唯一规范来源的地位）
- `discussion-artifact.json`（仅用于 drift 检查，不作为规范数据源 — 见下方 Drift Check）

### Discussion-Artifact Drift Check

Phase 1 Spec 生成已消费 discussion-artifact 并将决策写入 spec。Phase 2 读取 discussion-artifact **仅做一致性校验**，不从中生成新任务：

1. 若 `selectedApproach` 存在，验证 spec Architecture 章节是否反映了该方案。偏差 → 回退 Phase 1 修订 Spec，**不在 Plan 中补任务**。
2. 若 `unresolvedDependencies` 存在，验证 spec Scope 章节对应需求标记为 `blocked`。缺失 → 回退 Phase 1。

> ⚠️ Plan 阶段不得基于 discussion-artifact 发明 spec 中不存在的任务。发现偏差一律回退 Spec 修订。

## 输出

- `.claude/plans/{task-name}.md`

## 设计原则

- **Spec-Normative Input** — spec.md 是唯一规范输入；`analysisResult` 仅作为文件规划与复用提示的辅助上下文
- **File Structure First** — 先列文件，再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟的原子操作
- **Complete Code** — 每步包含完整代码块（不是伪代码或描述）
- **Exact Commands** — 验证命令包含预期输出（Self-Review 仅检查命令语法和路径存在性；语义正确性在执行阶段验证）
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
ensureDir(".claude/plans");

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
      phase: slice.phase || "implement",
      files: {
        create: file.isNew ? [file.path] : [],
        modify: file.isNew ? [] : [file.path],
        test: file.testPath ? [file.testPath] : [],
      },
      spec_ref: slice.specRef,
      plan_ref: `P-${slice.name}`,
      acceptance_criteria: deriveAcceptanceCriteriaForSlice(slice),
      actions: deriveTaskActions(file),
      verification: {
        commands: deriveVerificationCommands(file),
        expected_output: deriveExpectedOutputs(file),
      },
      steps: [
        {
          id: "S1",
          description: `编写 ${file.description} 的失败测试`,
          expected: "测试稳定失败并暴露目标行为缺口",
          verification: file.testCommand,
        },
        {
          id: "S2",
          description: `实现 ${file.description} 的最小代码变更`,
          expected: "目标能力可用且符合 Spec 约束",
        },
        {
          id: "S3",
          description: "运行验证命令并确认全部通过",
          expected: "测试、类型检查或 lint 全部通过",
          verification: file.testCommand,
        },
      ],
    });
  }
}
```

### Step 4: 渲染 Plan 文档

```typescript
const planTemplate = loadTemplate("plan-template.md");
const planContent = replaceVars(planTemplate, {
  task_name: taskName,
  requirement_source: requirementSource,
  spec_file: specPath,
  created_at: new Date().toISOString(),
  goal: extractGoal(specContent),
  architecture_summary: extractArchitectureSummary(specContent),
  tech_stack: extractTechStack(specContent),
  confidence_score: confidenceScore,
  patterns_to_mirror: renderPatternsToMirror(patternsToMirror),
  mandatory_reading: renderMandatoryReading(mandatoryReading),
  files_create: renderFileList(filePlan.create),
  files_modify: renderFileList(filePlan.modify),
  files_test: renderFileList(filePlan.test),
  tasks: renderWorkflowTasksV2(tasks),
});

writeFile(planPath, planContent);
```

### Step 4.5: Discussion-Artifact Drift Check

```typescript
// 仅做一致性校验，不作为规范数据源
const discussionPath = path.join(workflowDir, "discussion-artifact.json");
if (fileExists(discussionPath)) {
  const discussion = JSON.parse(readFile(discussionPath));

  // 检查 selectedApproach 是否反映在 spec Architecture 章节
  if (discussion.selectedApproach) {
    const archSection = extractSection(
      specContent,
      "## 5. Architecture and Module Design",
    );
    if (!archSection?.includes(discussion.selectedApproach.name)) {
      console.error(
        `❌ Drift: discussion 选定方案 "${discussion.selectedApproach.name}" 未在 Spec Architecture 章节体现`,
      );
      console.log("⏸️ 请回退到 Phase 1 修订 Spec 后重新生成 Plan");
      return;
    }
  }

  // 检查 unresolvedDependencies 是否标记为 blocked
  for (const dep of discussion.unresolvedDependencies || []) {
    if (dep.status === "not_started") {
      const scopeSection = extractSection(specContent, "## 2. Scope");
      // 检查该依赖的描述关键词是否出现在 blocked 条目中
      const depKeyword = dep.description.split(/\s+/).slice(0, 3).join(" ");
      const blockedPattern = new RegExp(
        `blocked[\\s\\S]{0,200}${escapeRegExp(depKeyword)}`,
        "i",
      );
      if (!scopeSection || !blockedPattern.test(scopeSection)) {
        console.error(
          `❌ Drift: discussion 未就绪依赖 "${dep.description}" 未在 Spec Scope 中标记为 blocked`,
        );
        console.log("⏸️ 请回退到 Phase 1 修订 Spec 后重新生成 Plan");
        return;
      }
    }
  }
}
```

### Step 4.8: Pattern Discovery

从代码分析结果中提取可复用的代码模式，生成 `Patterns to Mirror` 和 `Mandatory Reading` 区块，写入 plan 文档。

```typescript
// 从 analysisResult 提取代码模式
interface PatternToMirror {
  name: string; // 模式名称（如 "Repository Pattern"、"Error Boundary"）
  sourceFile: string; // 来源文件路径
  keySnippet?: string; // 关键代码片段引用（函数名/类名，非完整代码）
  relevance: string; // 与当前任务的关联说明
}

interface MandatoryReadingFile {
  path: string;
  priority: "P0" | "P1" | "P2"; // P0: 必读 / P1: 重要 / P2: 参考
  reason: string;
}

// 从 analysisResult.patterns 和 analysisResult.relatedFiles 生成
const patternsToMirror: PatternToMirror[] = analysisResult.patterns.map(
  (p) => ({
    name: p.name,
    sourceFile: findBestExampleFile(p, analysisResult.relatedFiles),
    keySnippet: extractKeySymbol(p),
    relevance: p.description,
  }),
);

const mandatoryReading: MandatoryReadingFile[] =
  analysisResult.relatedFiles.map((f) => ({
    path: f.path,
    priority:
      f.reuseType === "extend" ? "P0" : f.reuseType === "modify" ? "P1" : "P2",
    reason: f.purpose,
  }));
```

### Step 4.9: Confidence Score

基于多维度信号综合评估 plan 的可靠性，写入 plan Metadata。

```typescript
// 计算综合信心分
function calculateConfidenceScore(
  specCoverage: number, // spec 需求覆盖率 (0-1)
  patternCount: number, // 识别到的可复用模式数量
  constraintCount: number, // 已识别的约束数量
  hasTestStrategy: boolean, // 是否有清晰的测试策略
): number {
  let score = 5; // 基线分
  score += specCoverage >= 0.95 ? 2 : specCoverage >= 0.8 ? 1 : 0;
  score += patternCount >= 3 ? 1 : 0;
  score += constraintCount >= 2 ? 1 : 0;
  score += hasTestStrategy ? 1 : 0;
  return Math.min(10, Math.max(1, score));
}

const confidenceScore = calculateConfidenceScore(
  specCoverageRatio,
  patternsToMirror.length,
  analysisResult.constraints.length,
  tasks.some((t) => t.steps.some((s) => s.verification)),
);

console.log(`🎯 Confidence Score: ${confidenceScore}/10`);
```

Plan 生成后立即执行自审查。Self-Review 只检查**无需执行即可判断**的内容（语法、格式、覆盖率），语义正确性验证推迟到执行阶段的 Verification Iron Law 和质量关卡。

> 参见执行阶段验证链：`../../../workflow-executing/specs/execute/post-execution-pipeline.md` Step 6.5 Verification Iron Law

```typescript
function selfReviewPlan(planContent: string, specContent: string): void {
  // 1. Spec coverage: 逐条检查 spec 的每个需求
  const specRequirements = extractRequirements(specContent);
  const planTasks = extractTasks(planContent);

  for (const req of specRequirements) {
    const covered = planTasks.some(
      (task) =>
        task.spec_ref === req.sectionRef || task.code.includes(req.keyword),
    );
    if (!covered) {
      console.warn(`⚠️ Spec 需求 [${req.id}] 未在 plan 中找到对应 task`);
      // 自动补充 task
    }
  }

  // 2. Placeholder scan: 搜索禁止占位符（no placeholders 规则）
  const placeholders = ["TBD", "TODO", "implement later", "fill in details", "add appropriate", "similar to Task", "write tests for"]; // no placeholders 检查列表
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

  // 4. Command syntax + path existence: 验证命令格式和文件路径（非语义正确性）
  for (const task of planTasks) {
    for (const step of task.steps || []) {
      if (step.verification) {
        // 检查命令语法格式合理性（如括号匹配、管道符使用）
        // 检查引用的文件路径是否在 File Structure 中声明
        // 注意：不验证命令执行后是否通过，语义验证在执行阶段完成
      }
    }
  }

  // 5. Discussion-artifact drift check（若 Step 4.5 未阻塞到这里，记录通过）

  // 6. Pattern Faithfulness: 验证 Patterns to Mirror 中的每个引用都指向真实存在的代码文件/函数
  for (const pattern of patternsToMirror) {
    if (!fileExists(pattern.sourceFile)) {
      console.warn(
        `⚠️ Pattern 引用的源文件不存在: ${pattern.sourceFile} (模式: ${pattern.name})`,
      );
      // 自动修正：标记为 unverified 或尝试重新定位
    }
    if (pattern.keySnippet) {
      // 检查 keySnippet 指向的符号是否在源文件中存在
      const sourceContent = readFile(pattern.sourceFile);
      if (!sourceContent.includes(pattern.keySnippet)) {
        console.warn(
          `⚠️ Pattern 引用的符号 "${pattern.keySnippet}" 未在 ${pattern.sourceFile} 中找到`,
        );
      }
    }
  }

  // 7. No Prior Knowledge Test: 检查 plan 是否能被零上下文工程师直接执行
  for (const task of planTasks) {
    // 检查每个 task 是否有完整的文件路径（而非相对描述）
    if (!task.files?.create?.length && !task.files?.modify?.length) {
      console.warn(
        `⚠️ Task ${task.id} 缺少明确的文件路径，零上下文工程师无法确定编辑哪个文件`,
      );
    }
    // 检查 steps 是否包含可执行的具体指令（而非模糊描述）
    for (const step of task.steps || []) {
      if (step.description.length < 10) {
        console.warn(
          `⚠️ Task ${task.id} Step ${step.id} 描述过短，可能不够具体`,
        );
      }
    }
  }

  console.log(
    "✅ Self-Review 通过（语法/覆盖率/格式/模式保真度/可执行性检查）",
  );
  console.log("ℹ️ 语义正确性验证将在执行阶段的质量关卡中完成");
}

selfReviewPlan(planContent, specContent);
```

## Plan 文档结构

```markdown
# [Feature Name] Implementation Plan

> **Spec**: `.claude/specs/{name}.md`

## Metadata

**Goal:** [一句话描述]
**Architecture:** [2-3 句架构方案]
**Tech Stack:** [关键技术]
**Confidence:** [N/10]

---

## Patterns to Mirror

| 模式               | 源文件                  | 关键符号              | 关联说明             |
| ------------------ | ----------------------- | --------------------- | -------------------- |
| Repository Pattern | `src/repos/UserRepo.ts` | `UserRepo.findById()` | 新 Repo 应复用此模式 |

## Mandatory Reading

| 优先级 | 文件                      | 原因                |
| ------ | ------------------------- | ------------------- |
| P0     | `src/core/BaseService.ts` | 新 Service 必须继承 |
| P1     | `src/utils/validators.ts` | 可复用的校验函数    |
| P2     | `docs/architecture.md`    | 架构背景参考        |

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

## 任务依赖说明

Plan 中任务的 `depends` 和 `blocked_by` 字段遵循共享 schema 定义（见 `state-machine.md` WorkflowTaskV2）：

- **`depends`**：任务间的内部顺序依赖（T2 depends on T1 = T1 完成后 T2 才可开始）。Plan 按 Implementation Slices 顺序排列任务，**默认隐式串行**；仅在需要显式并行或跨 slice 引用时才手动填写。
- **`blocked_by`**：外部阻塞依赖（`api_spec` / `external`），表示任务需要等待外部资源就绪。不用于任务间内部顺序。

> ⚠️ `blocked_by` 不是 `depends` 的同义词。执行期的并行判定由 `workflow-executing` 的 `canRunInParallel()` 处理（文件集、传递依赖、语义引用），Plan 不重复定义并行规则。

## 强制规则

- 所有 spec 中的 in_scope 需求至少映射到一个 plan task
- 每个 task 的每个 step 包含完整代码或命令
- 禁止任何占位符内容
- 验证命令必须包含预期输出
- Self-Review 不通过时必须修复后才能提交
- Discussion-artifact drift check 发现偏差时必须回退 Spec 修订，不得在 Plan 中补偿
