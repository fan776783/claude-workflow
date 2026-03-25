# Phase 0.7: 实现指南生成详情

## 目的

将 Requirement Baseline、结构化需求和验收清单转换为测试先行的实现指南，提供 TDD 工作流、测试代码模板、测试数据工厂和模块实现路径。

> 自本版本起，实现指南不再只从验收项反推模块，而是作为 Baseline 的**开发派生视图**：每个模块都必须说明它承接了哪些 requirement，以及必须保护哪些 critical constraints。

## 执行条件

**条件执行**：仅在 Phase 0.6 成功生成验收清单后执行

```typescript
if (acceptanceChecklist && requirementBaseline) {
  implementationGuide = generateImplementationGuide(
    requirementAnalysis,
    requirementBaseline,
    acceptanceChecklist,
    projectConfig
  );
} else {
  console.log(`⏭️ 跳过（未生成 Baseline 或验收清单）\n`);
}
```

## 数据结构

### ImplementationGuide

```typescript
interface ImplementationGuide {
  metadata: GuideMetadata;
  requirementCoverageSummary: RequirementCoverageSummary;
  tddWorkflow: TddWorkflow;
  testStrategy: TestStrategy;
  testTemplates: TestTemplates;
  testFixtures: TestFixtures;
  moduleGuides: ModuleGuide[];
  qualityGates: QualityGates;
}
```

```typescript
interface GuideMetadata {
  taskName: string;
  requirementSource: string;
  requirementBaselinePath: string;
  acceptanceChecklistPath: string;
  techDesignPath: string;
  createdAt: string;
  projectType: string;
  techStack: TechStack;
}
```

### ModuleGuide

```typescript
interface ModuleGuide {
  moduleName: string;
  relatedRequirementIds: string[];
  relatedAcceptanceIds: string[];
  criticalConstraints: string[];
  features: FeatureGuide[];
}

interface FeatureGuide {
  featureName: string;
  priority: 'P0' | 'P1' | 'P2';
  description: string;
  relatedRequirementIds: string[];
  relatedAcceptanceIds: string[];
  criticalConstraints: string[];
  testSteps: TestStep[];
  implementationHints: string[];
  acceptanceCriteria: string[];
}
```

## 生成策略

### 1. Baseline → 模块分组

先根据 Requirement Baseline 中的 category、scope_owner、dependency_tags 对 requirement items 做模块聚类，再结合验收清单整理为实现模块。

### 2. 模块 → requirement / acceptance 双向引用

每个模块必须列出：

- `relatedRequirementIds`
- `relatedAcceptanceIds`
- `criticalConstraints`

这样执行阶段在阅读指南时，可以直接知道该模块守护的是哪些原始需求与不可协商约束。

### 3. 测试模板生成

测试模板仍主要来自 acceptance checklist，但命名、分组和优先级应回看 baseline，避免“测试项存在，但开发者不知道它对应哪条需求”。

## 模板渲染约定

实现指南模板必须与 `tech-design` / `spec` / `plan` 使用同一套渲染契约，统一采用 `replaceVars(template, vars)` 的 `{{placeholder}}` 语法。

```typescript
const testCommands = resolveGuideTestCommands(projectConfig, techStack);
const implementationGuideTemplate = loadTemplate('implementation-guide-template.md');
const implementationGuideMarkdown = replaceVars(implementationGuideTemplate, {
  task_name: taskName,
  sanitized_name: sanitizedName,
  requirement_source: requirementSource,
  created_at: new Date().toISOString(),
  requirement_baseline_path: requirementBaselinePath,
  acceptance_checklist_path: acceptanceChecklistPath,
  project_type: projectConfig.project.type,
  backend_framework: techStack.backend,
  frontend_framework: techStack.frontend,
  backend_test_framework: techStack.testBackend,
  frontend_test_framework: techStack.testFrontend,
  file_extension: resolveTestFileExtension(techStack),
  module_count: moduleGuides.length,
  p0_count: countFeaturesByPriority(moduleGuides, 'P0'),
  p1_count: countFeaturesByPriority(moduleGuides, 'P1'),
  p2_count: countFeaturesByPriority(moduleGuides, 'P2'),
  requirement_coverage_summary: renderRequirementCoverageSummary(requirementCoverageSummary),
  requirement_to_module_mapping: renderRequirementToModuleMapping(moduleGuides),
  test_command: testCommands.default,
  unit_test_templates: renderUnitTestTemplates(testTemplates.unitTests),
  integration_test_templates: renderIntegrationTestTemplates(testTemplates.integrationTests),
  e2e_test_templates: renderE2eTestTemplates(testTemplates.e2eTests),
  factory_code: renderFactoryCode(testFixtures),
  factory_usage_example: renderFactoryUsageExample(testFixtures),
  module_guides: renderModuleGuides(moduleGuides),
  automated_checks: renderAutomatedChecks(qualityGates),
  performance_metrics: renderPerformanceMetrics(qualityGates),
  security_checks: renderSecurityChecks(qualityGates),
  install_command: testCommands.install,
  setup_test_env_command: testCommands.setup,
  test_all_command: testCommands.all,
  test_unit_command: testCommands.unit,
  test_integration_command: testCommands.integration,
  test_e2e_command: testCommands.e2e,
  test_watch_command: testCommands.watch,
  p0_implementation_order: renderImplementationOrder(moduleGuides, 'P0'),
  p1_implementation_order: renderImplementationOrder(moduleGuides, 'P1'),
  p2_implementation_order: renderImplementationOrder(moduleGuides, 'P2')
});
```

```typescript
interface ImplementationGuideTemplateVars {
  task_name: string;
  sanitized_name: string;
  requirement_source: string;
  created_at: string;
  requirement_baseline_path: string;
  acceptance_checklist_path: string;
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
  requirement_to_module_mapping: string;
  test_command: string;
  unit_test_templates: string;
  integration_test_templates: string;
  e2e_test_templates: string;
  factory_code: string;
  factory_usage_example: string;
  module_guides: string;
  automated_checks: string;
  performance_metrics: string;
  security_checks: string;
  install_command: string;
  setup_test_env_command: string;
  test_all_command: string;
  test_unit_command: string;
  test_integration_command: string;
  test_e2e_command: string;
  test_watch_command: string;
  p0_implementation_order: string;
  p1_implementation_order: string;
  p2_implementation_order: string;
}
```

- `resolveTestFileExtension()` 必须根据 `techStack.testBackend / techStack.testFrontend` 产出单个默认扩展名字符串
- `renderRequirementToModuleMapping()` 必须输出 Requirement → Module 的 Markdown 映射表
- `renderModuleGuides()` 必须把 `ModuleGuide[]` 渲染为模板可直接插入的 Markdown，而不是保留结构化对象
- 所有 `test_*`、`*_templates`、`*_order` 字段都必须在模板渲染前完成字符串化

> 模板若继续扩展 `test_*`、顺序建议或质量门禁变量，必须保持 `{{placeholder}}` 命名风格，并在此处补齐映射说明。

## 强制规则

- 任何模块若无法指出 `relatedRequirementIds`，说明切分粒度不合格
- 任何含关键约束的 requirement，必须在对应模块中出现在 `criticalConstraints`
- 任何 `blocked` requirement 不应进入可执行模块，而应作为依赖说明

## 输出要求

生成的实现指南必须包含：

- Requirement Coverage Summary
- 模块级 `Related Requirement IDs`
- 模块级 `Related Acceptance IDs`
- 模块级 `Critical Constraints by Module`
- 原有 TDD 工作流、测试模板、测试工厂与质量门禁
