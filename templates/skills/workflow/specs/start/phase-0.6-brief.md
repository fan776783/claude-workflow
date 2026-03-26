# Phase 0.6: Acceptance & Implementation Brief 生成详情

## 目的

将 Requirement Baseline 转换为按模块组织的统一开发文档，同时包含验收标准和实现路径，供开发者/AI agent 在实现和验收阶段使用。

> Brief 是 Baseline 的**开发派生视图**：每个模块说明它承接了哪些 requirement、必须保护哪些 constraints、如何验收、如何测试、如何实现。

## 执行条件

**条件执行**：仅在 Phase 0.55 成功生成 Requirement Baseline 后执行

```typescript
if (requirementBaseline) {
  brief = generateBrief(requirementBaseline, projectConfig, taskName);
  // NOTE: tech_design_path 在 Brief 生成时为空，Phase 1 完成后回填
} else {
  console.log(`⏭️ 跳过（未生成 Requirement Baseline）\n`);
}
```

## 数据结构

### AcceptanceImplementationBrief

```typescript
interface AcceptanceImplementationBrief {
  metadata: BriefMetadata;
  requirementCoverageSummary: RequirementCoverageSummary;
  requirementToBriefMapping: RequirementToBriefMapping[];
  modules: BriefModule[];
  tddWorkflow: TddWorkflow;
  testStrategy: TestStrategy;
  testFixtures: TestFixtures;
  qualityGates: QualityGates;
  partiallyCoveredRequirements: RequirementCoverageGap[];
  uncoveredRequirements: RequirementCoverageGap[];
}
```

### BriefMetadata

```typescript
interface BriefMetadata {
  taskName: string;
  requirementSource: string;
  requirementBaselinePath: string;
  techDesignPath: string;       // 生成时为空，Phase 1 完成后回填
  createdAt: string;
  projectType: string;
  techStack: TechStack;
}
```

### BriefModule

```typescript
interface BriefModule {
  moduleName: string;
  relatedRequirementIds: string[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  testTemplates: TestTemplate[];
  implementationHints: string[];
  priority: 'P0' | 'P1' | 'P2';
}

interface AcceptanceCriterion {
  id: string;                       // AC-M1.1, AC-M1.2...
  description: string;              // 验收描述
  checks: string[];                 // 具体检查项
  testCases?: Array<{
    input: string;
    expected: string;
  }>;
  relatedRequirementIds?: string[];
}

interface TestTemplate {
  layer: 'unit' | 'integration' | 'e2e';
  testFile: string;
  testFunction: string;
  source: string;                   // 对应的 AcceptanceCriterion ID
  codeTemplate: string;
}
```

### RequirementCoverageSummary

```typescript
interface RequirementCoverageSummary {
  totalRequirements: number;
  inScopeRequirements: number;
  fullyCovered: number;
  partiallyCovered: number;
  uncovered: number;
}
```

### RequirementToBriefMapping

```typescript
interface RequirementToBriefMapping {
  requirementId: string;
  requirementSummary: string;
  scopeStatus: 'in_scope' | 'partially_in_scope' | 'out_of_scope' | 'blocked';
  coverageLevel: 'full' | 'partial' | 'none';
  briefModuleNames: string[];
  acceptanceIds: string[];
  notes?: string;
}
```

### RequirementCoverageGap

```typescript
interface RequirementCoverageGap {
  requirementId: string;
  summary: string;
  reason: string;
  suggestedAction?: string;
}
```

## 生成策略

### 1. Baseline → 模块分组

根据 Requirement Baseline 中的 `scenario`、`scope_owner`、`dependency_tags` 对 requirement items 做模块聚类：

- 同一 `scenario` 下的 items 优先归入同一模块
- `related_items` 互相引用的 items 必须在同一模块
- 按 `scope_owner` 细分前后端模块（如一个场景涉及前后端，可拆为两个模块）

```typescript
function clusterModules(baseline: RequirementBaseline): BriefModule[] {
  // 1. 按 scenario 初步分组
  // 2. 将 related_items 引用的 items 合并到同一组
  // 3. 按 scope_owner 决定是否拆分前后端模块
  // 4. 为每组确定 priority（取组内最高优先级）
  // 5. 返回 BriefModule[]
}
```

### 2. 模块 → 验收标准

每个模块的 `acceptanceCriteria` 从关联的 requirement items 派生：

- 每个 `in_scope` requirement 至少映射到一个验收标准
- 验收标准描述"用户/系统应该如何表现"，而非"如何实现"
- `constraints` 从 Baseline 直接引用，不再重复展开

### 3. 模块 → 测试模板

从验收标准派生测试代码模板：

- 根据 `projectConfig` 技术栈选择测试框架语法
- 按测试层级分配（unit / integration / e2e）
- 每个模板标注来源的 AcceptanceCriterion ID

```typescript
function generateTestTemplates(
  module: BriefModule,
  techStack: TechStack
): TestTemplate[] {
  // 从 acceptanceCriteria 提取测试场景
  // 根据技术栈生成测试代码模板
}
```

### 4. 测试数据工厂

从所有模块的验收标准中提取实体和字段定义，生成测试数据工厂：

```typescript
function generateTestFixtures(
  modules: BriefModule[],
  techStack: TechStack
): TestFixtures {
  // 识别需要 mock 的实体
  // 为每个实体生成 valid/invalid 数据工厂
}
```

### 5. 质量门禁

根据项目类型和技术栈生成质量检查项：

```typescript
function generateQualityGates(
  projectConfig: ProjectConfig
): QualityGates {
  // 自动化检查（测试覆盖率、类型检查、Linter）
  // 性能指标
  // 安全检查
}
```

## 模板渲染约定

Brief 模板使用 `replaceVars(template, vars)` 的 `{{placeholder}}` 语法，与 workflow 其他模板保持一致。

```typescript
const briefTemplate = loadTemplate('brief-template.md');
const briefMarkdown = replaceVars(briefTemplate, {
  task_name: taskName,
  sanitized_name: sanitizedName,
  requirement_source: requirementSource,
  created_at: new Date().toISOString(),
  requirement_baseline_path: requirementBaselinePath,
  tech_design_path: techDesignPath,
  project_type: projectConfig.project.type,
  backend_framework: techStack.backend,
  frontend_framework: techStack.frontend,
  backend_test_framework: techStack.testBackend,
  frontend_test_framework: techStack.testFrontend,
  file_extension: resolveTestFileExtension(techStack),
  module_count: modules.length,
  p0_count: countModulesByPriority(modules, 'P0'),
  p1_count: countModulesByPriority(modules, 'P1'),
  p2_count: countModulesByPriority(modules, 'P2'),
  requirement_coverage_summary: renderRequirementCoverageSummary(coverageSummary),
  requirement_total_count: coverageSummary.totalRequirements,
  requirement_in_scope_count: coverageSummary.inScopeRequirements,
  requirement_full_coverage_count: coverageSummary.fullyCovered,
  requirement_partial_coverage_count: coverageSummary.partiallyCovered,
  requirement_none_coverage_count: coverageSummary.uncovered,
  requirement_to_brief_mapping: renderRequirementToBriefMapping(mappings),
  test_command: testCommands.default,
  module_briefs: renderModuleBriefs(modules),
  factory_code: renderFactoryCode(testFixtures),
  factory_usage_example: renderFactoryUsageExample(testFixtures),
  automated_checks: renderAutomatedChecks(qualityGates),
  performance_metrics: renderPerformanceMetrics(qualityGates),
  security_checks: renderSecurityChecks(qualityGates),
  partially_covered_requirements: renderCoverageGaps(partiallyCoveredRequirements),
  uncovered_requirements: renderCoverageGaps(uncoveredRequirements),
  install_command: testCommands.install,
  setup_test_env_command: testCommands.setup,
  test_all_command: testCommands.all,
  test_unit_command: testCommands.unit,
  test_integration_command: testCommands.integration,
  test_e2e_command: testCommands.e2e,
  test_watch_command: testCommands.watch,
  quality_gate_command: acceptanceCommands.qualityGate,
  coverage_command: acceptanceCommands.coverage,
  performance_check_command: acceptanceCommands.performance,
  p0_implementation_order: renderImplementationOrder(modules, 'P0'),
  p1_implementation_order: renderImplementationOrder(modules, 'P1'),
  p2_implementation_order: renderImplementationOrder(modules, 'P2')
});
```

```typescript
interface BriefTemplateVars {
  task_name: string;
  sanitized_name: string;
  requirement_source: string;
  created_at: string;
  requirement_baseline_path: string;
  tech_design_path: string;
  project_type: string;
  backend_framework: string;
  frontend_framework: string;
  backend_test_framework: string;
  frontend_test_framework: string;
  file_extension: string;
  module_count: number;
  p0_count: number;
  p1_count: number;
  p2_count: number;
  requirement_coverage_summary: string;
  requirement_total_count: number;
  requirement_in_scope_count: number;
  requirement_full_coverage_count: number;
  requirement_partial_coverage_count: number;
  requirement_none_coverage_count: number;
  requirement_to_brief_mapping: string;
  test_command: string;
  module_briefs: string;
  factory_code: string;
  factory_usage_example: string;
  automated_checks: string;
  performance_metrics: string;
  security_checks: string;
  partially_covered_requirements: string;
  uncovered_requirements: string;
  install_command: string;
  setup_test_env_command: string;
  test_all_command: string;
  test_unit_command: string;
  test_integration_command: string;
  test_e2e_command: string;
  test_watch_command: string;
  quality_gate_command: string;
  coverage_command: string;
  performance_check_command: string;
  p0_implementation_order: string;
  p1_implementation_order: string;
  p2_implementation_order: string;
}
```

## 强制规则

- 任何 `in_scope` requirement 不允许在 Brief 中"无声消失"
- 任何 `partial` requirement 必须写明缺口原因
- 任何 `uncovered` requirement 必须在 Uncovered Requirements 区块显式暴露
- 验收项 ID 与 requirement IDs 必须可双向追溯
- 任何模块若无法指出 `relatedRequirementIds`，说明切分粒度不合格
- 任何含关键约束的 requirement，必须在对应模块的 `constraints` 中出现
- 任何 `blocked` requirement 不应进入可执行模块，而应作为依赖说明

## 输出要求

生成的 Brief 必须包含：

- Requirement Coverage Summary（唯一一份）
- Requirement-to-Brief Mapping
- Partially Covered Requirements
- Uncovered Requirements
- 按模块组织的验收标准 + 测试模板 + 实现指引
- TDD Workflow 与测试分层策略
- 测试数据工厂
- 质量门禁
- 实现顺序建议

**输出路径**: `.claude/acceptance/{sanitizedName}-brief.md`
