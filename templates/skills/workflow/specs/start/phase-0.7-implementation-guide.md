# Phase 0.7: 实现指南生成详情

## 目的

将结构化需求和验收清单转换为测试先行的实现指南，提供 TDD 工作流、测试代码模板、测试数据工厂和模块实现路径。

## 执行条件

**条件执行**：仅在 Phase 0.6 成功生成验收清单后执行

```typescript
if (acceptanceChecklist) {
  implementationGuide = generateImplementationGuide(
    requirementAnalysis,
    acceptanceChecklist,
    projectConfig
  );
} else {
  console.log(`⏭️ 跳过（未执行 Phase 0.6）\n`);
}
```

## 数据结构

### ImplementationGuide

```typescript
interface ImplementationGuide {
  metadata: GuideMetadata;
  tddWorkflow: TddWorkflow;
  testStrategy: TestStrategy;
  testTemplates: TestTemplates;
  testFixtures: TestFixtures;
  moduleGuides: ModuleGuide[];
  qualityGates: QualityGates;
}

interface GuideMetadata {
  taskName: string;
  requirementSource: string;
  acceptanceChecklistPath: string;
  techDesignPath: string;
  createdAt: string;
  projectType: string;
  techStack: TechStack;
}

interface TechStack {
  backend: string;
  frontend: string;
  testBackend: string;
  testFrontend: string;
}
```

### TddWorkflow

```typescript
interface TddWorkflow {
  description: string;
  redPhase: WorkflowPhase;
  greenPhase: WorkflowPhase;
  refactorPhase: WorkflowPhase;
}

interface WorkflowPhase {
  name: string;
  steps: string[];
  tips: string[];
}
```

### TestStrategy

```typescript
interface TestStrategy {
  unitTests: TestLayer;
  integrationTests: TestLayer;
  e2eTests: TestLayer;
}

interface TestLayer {
  percentage: number;
  scope: string[];
  framework: string;
}
```

### TestTemplates

```typescript
interface TestTemplates {
  unitTests: TestTemplate[];
  integrationTests: TestTemplate[];
  e2eTests: TestTemplate[];
}

interface TestTemplate {
  testType: string;
  scenario: string;
  sourceAcceptanceCriteria: string;  // 来源验收项 ID
  filePath: string;
  testFunctionName: string;
  testData: Record<string, any>;
  expectedResult: string;
  codeTemplate: string;
}
```

### TestFixtures

```typescript
interface TestFixtures {
  entities: EntityFixture[];
  filePath: string;
  codeTemplate: string;
}

interface EntityFixture {
  entityName: string;
  fields: FieldDefinition[];
  factoryMethods: FactoryMethod[];
}

interface FieldDefinition {
  name: string;
  type: string;
  required: boolean;
  validationRules: string[];
}

interface FactoryMethod {
  methodName: string;
  purpose: string;
  returnData: Record<string, any>;
}
```

### ModuleGuide

```typescript
interface ModuleGuide {
  moduleName: string;
  features: FeatureGuide[];
}

interface FeatureGuide {
  featureName: string;
  priority: 'P0' | 'P1' | 'P2';
  description: string;
  testSteps: TestStep[];
  implementationHints: string[];
  acceptanceCriteria: string[];
  relatedAcceptanceIds: string[];
}

interface TestStep {
  layer: 'unit' | 'integration' | 'e2e';
  filePath: string;
  tests: string[];
}
```

### QualityGates

```typescript
interface QualityGates {
  automated: AutomatedCheck[];
  performance: PerformanceMetric[];
  security: SecurityCheck[];
}

interface AutomatedCheck {
  name: string;
  threshold: string;
  command: string;
}

interface PerformanceMetric {
  name: string;
  threshold: string;
  measurementMethod: string;
}

interface SecurityCheck {
  name: string;
  checkMethod: string;
}
```

## 生成策略

### 1. 技术栈检测

从 `project-config.json` 读取技术栈信息：

```typescript
function detectTechStack(projectConfig: ProjectConfig): TechStack {
  return {
    backend: projectConfig.project.techStack.backend || 'unknown',
    frontend: projectConfig.project.techStack.frontend || 'unknown',
    testBackend: projectConfig.testFramework?.backend || detectTestFramework('backend'),
    testFrontend: projectConfig.testFramework?.frontend || detectTestFramework('frontend')
  };
}

function detectTestFramework(type: 'backend' | 'frontend'): string {
  // 根据项目文件检测测试框架
  // 后端: pytest, jest, vitest, mocha, etc.
  // 前端: vitest, jest, testing-library, etc.
}
```

### 2. 测试代码模板生成

**生成规则**：

1. 从验收清单提取测试场景
2. 根据技术栈选择模板语法
3. 生成测试文件路径、函数名、测试数据、断言语句

**模板结构**：

```typescript
function generateTestTemplate(
  acceptanceCriteria: AcceptanceCriteria,
  techStack: TechStack,
  testLayer: 'unit' | 'integration' | 'e2e'
): TestTemplate {
  const template: TestTemplate = {
    testType: determineTestType(acceptanceCriteria),
    scenario: acceptanceCriteria.description,
    sourceAcceptanceCriteria: acceptanceCriteria.id,
    filePath: generateTestFilePath(acceptanceCriteria, techStack, testLayer),
    testFunctionName: generateTestFunctionName(acceptanceCriteria),
    testData: extractTestData(acceptanceCriteria),
    expectedResult: extractExpectedResult(acceptanceCriteria),
    codeTemplate: renderCodeTemplate(acceptanceCriteria, techStack, testLayer)
  };

  return template;
}
```

**示例（通用结构）**：

```markdown
#### 单元测试：表单字段验证

**来源**: AC-F1.1 用户名不能为空

**测试文件**: `tests/unit/test_user_service.{ext}`

**测试函数**: `test_create_user_with_empty_name`

**测试数据**:
```json
{
  "name": "",
  "email": "test@example.com"
}
```

**预期结果**: 抛出验证错误 "用户名不能为空"

**代码模板**:
```
{framework_specific_template}
```
```

### 3. 测试数据工厂生成

**生成规则**：

1. 从 FormValidation 提取实体和字段定义
2. 为每个实体生成有效数据和无效数据工厂方法
3. 根据语言特性选择实现方式

**工厂方法命名规则**：

- `valid{Entity}()` - 返回有效的完整数据
- `empty{Field}()` - 返回指定字段为空的数据
- `tooLong{Field}()` - 返回指定字段超长的数据
- `invalid{Field}()` - 返回指定字段格式错误的数据

**示例**：

```typescript
function generateEntityFixture(
  entity: string,
  formValidations: FormValidation[],
  techStack: TechStack
): EntityFixture {
  const fields = extractFieldDefinitions(formValidations);
  const factoryMethods = generateFactoryMethods(entity, fields);

  return {
    entityName: entity,
    fields,
    factoryMethods
  };
}

function generateFactoryMethods(
  entity: string,
  fields: FieldDefinition[]
): FactoryMethod[] {
  const methods: FactoryMethod[] = [];

  // 有效数据工厂
  methods.push({
    methodName: `valid${entity}`,
    purpose: '返回有效的完整数据',
    returnData: generateValidData(fields)
  });

  // 为每个字段生成无效数据工厂
  fields.forEach(field => {
    if (field.required) {
      methods.push({
        methodName: `empty${capitalize(field.name)}`,
        purpose: `返回 ${field.name} 为空的数据（用于必填验证测试）`,
        returnData: generateEmptyFieldData(fields, field.name)
      });
    }

    if (field.validationRules.includes('maxLength')) {
      methods.push({
        methodName: `tooLong${capitalize(field.name)}`,
        purpose: `返回 ${field.name} 超长的数据（用于长度验证测试）`,
        returnData: generateTooLongFieldData(fields, field.name)
      });
    }

    if (field.validationRules.includes('format')) {
      methods.push({
        methodName: `invalid${capitalize(field.name)}`,
        purpose: `返回 ${field.name} 格式错误的数据（用于格式验证测试）`,
        returnData: generateInvalidFieldData(fields, field.name)
      });
    }
  });

  return methods;
}
```

### 4. 模块实现指引生成

**生成规则**：

1. 按模块分组功能
2. 为每个功能生成测试步骤（单元 → 集成 → E2E）
3. 提供实现提示和验收标准
4. 关联验收项 ID

**示例**：

```typescript
function generateModuleGuide(
  module: string,
  features: Feature[],
  acceptanceChecklist: AcceptanceChecklist
): ModuleGuide {
  return {
    moduleName: module,
    features: features.map(feature => ({
      featureName: feature.name,
      priority: feature.priority,
      description: feature.description,
      testSteps: generateTestSteps(feature, acceptanceChecklist),
      implementationHints: generateImplementationHints(feature),
      acceptanceCriteria: generateAcceptanceCriteria(feature),
      relatedAcceptanceIds: findRelatedAcceptanceIds(feature, acceptanceChecklist)
    }))
  };
}

function generateTestSteps(
  feature: Feature,
  acceptanceChecklist: AcceptanceChecklist
): TestStep[] {
  const steps: TestStep[] = [];

  // L1: 单元测试
  const unitTests = extractUnitTests(feature, acceptanceChecklist);
  if (unitTests.length > 0) {
    steps.push({
      layer: 'unit',
      filePath: generateUnitTestPath(feature),
      tests: unitTests
    });
  }

  // L2: 集成测试
  const integrationTests = extractIntegrationTests(feature, acceptanceChecklist);
  if (integrationTests.length > 0) {
    steps.push({
      layer: 'integration',
      filePath: generateIntegrationTestPath(feature),
      tests: integrationTests
    });
  }

  // L3: E2E 测试
  const e2eTests = extractE2eTests(feature, acceptanceChecklist);
  if (e2eTests.length > 0) {
    steps.push({
      layer: 'e2e',
      filePath: generateE2eTestPath(feature),
      tests: e2eTests
    });
  }

  return steps;
}
```

### 5. 质量门禁生成

**生成规则**：

1. 根据项目类型和技术栈生成自动化检查命令
2. 从需求中提取性能指标
3. 生成安全检查清单

```typescript
function generateQualityGates(
  projectConfig: ProjectConfig,
  requirementAnalysis: RequirementAnalysis
): QualityGates {
  return {
    automated: [
      {
        name: '单元测试覆盖率',
        threshold: '≥ 80%',
        command: generateCoverageCommand(projectConfig)
      },
      {
        name: '所有单元测试通过',
        threshold: '100%',
        command: generateUnitTestCommand(projectConfig)
      },
      {
        name: '所有集成测试通过',
        threshold: '100%',
        command: generateIntegrationTestCommand(projectConfig)
      },
      {
        name: '类型检查通过',
        threshold: '0 errors',
        command: generateTypeCheckCommand(projectConfig)
      },
      {
        name: 'Linter 无 error',
        threshold: '0 errors',
        command: generateLintCommand(projectConfig)
      }
    ],
    performance: extractPerformanceMetrics(requirementAnalysis),
    security: generateSecurityChecks(projectConfig)
  };
}
```

## 渲染为 Markdown

```typescript
function renderImplementationGuide(
  guide: ImplementationGuide
): string {
  let markdown = renderMetadata(guide.metadata);
  markdown += renderOverview(guide);
  markdown += renderTddWorkflow(guide.tddWorkflow);
  markdown += renderTestStrategy(guide.testStrategy);
  markdown += renderTestTemplates(guide.testTemplates);
  markdown += renderTestFixtures(guide.testFixtures);
  markdown += renderModuleGuides(guide.moduleGuides);
  markdown += renderQualityGates(guide.qualityGates);
  markdown += renderQuickStart(guide);
  markdown += renderRelatedDocs(guide.metadata);

  return markdown;
}
```

## 输出文件

**路径**: `.claude/acceptance/{task-name}-implementation-guide.md`

**结构**: 参见 `templates/skills/workflow/templates/implementation-guide-template.md`

## 与验收清单的关系

1. **职责分离**：
   - 实现指南：指导开发，提供测试代码模板和 TDD 流程
   - 验收清单：验证交付，提供功能验收标准

2. **互相引用**：
   - 实现指南引用验收清单：`acceptance_checklist: ".claude/acceptance/{name}-checklist.md"`
   - 验收清单引用实现指南：`implementation_guide: ".claude/acceptance/{name}-implementation-guide.md"`

3. **数据流向**：
   ```
   Phase 0.5 (结构化需求)
        ↓
   Phase 0.6 (验收清单) ← 用户视角的验收标准
        ↓
   Phase 0.7 (实现指南) ← 开发者视角的实现路径
        ↓
   Phase 2 (任务生成) ← 关联验收项和测试方法
   ```

## 使用场景

1. **TDD 开发**：开发者按照实现指南的测试步骤进行 Red-Green-Refactor 循环
2. **测试编写**：直接使用测试代码模板和测试数据工厂
3. **质量把关**：执行质量门禁检查，确保代码质量
4. **新人上手**：通过模块实现指引快速理解功能和测试策略
