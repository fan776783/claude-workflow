# 实现指南生成系统 (v3.3.2+)

> Phase 0.7: 将结构化需求和验收清单转换为测试先行的实现指南

## 概述

实现指南生成系统在验收清单生成（Phase 0.6）之后自动执行，提供 TDD 工作流、测试代码模板、测试数据工厂和模块实现路径，指导开发者以测试先行的方式实现功能。

## 设计目标

1. **测试先行**：提供完整的 TDD 流程和代码模板，让开发者先写测试再写实现
2. **技术栈适配**：根据项目配置生成对应测试框架的代码模板
3. **可复用性强**：测试代码模板和数据工厂可直接使用，减少重复工作
4. **优先级明确**：P0/P1/P2 标记帮助开发者聚焦关键功能
5. **职责分离**：实现指南指导开发，验收清单验证交付

## 与验收清单的关系

### 职责分离

| 文档 | 目标用户 | 主要内容 | 使用阶段 |
|------|----------|----------|----------|
| **实现指南** | 开发者 | TDD 流程、测试模板、数据工厂、实现提示 | 开发阶段 |
| **验收清单** | 测试人员、产品经理 | 功能验收标准、质量门禁、验收记录 | 验收阶段 |

### 互相引用

```
实现指南 (implementation-guide.md)
  ├── 引用: acceptance_checklist: "./{name}-checklist.md"
  └── 提供: 测试方法、代码模板、实现路径

验收清单 (checklist.md)
  ├── 引用: implementation_guide: "./{name}-implementation-guide.md"
  └── 提供: 验收标准、质量门禁、验收记录
```

### 数据流向

```
Phase 0.5 (结构化需求)
     ↓
Phase 0.6 (验收清单) ← 用户视角的验收标准
     ↓
Phase 0.7 (实现指南) ← 开发者视角的实现路径
     ↓
Phase 2 (任务生成) ← 关联验收项和测试方法
```

## 实现指南结构

### 1. TDD 工作流

**内容**：
- Red-Green-Refactor 循环详解
- 每个阶段的具体步骤
- 测试命令和验证方法

**来源**：通用 TDD 最佳实践

### 2. 测试分层策略

**内容**：
- L1: 单元测试（70%）- 业务逻辑、数据模型、工具函数
- L2: 集成测试（20%）- API 端点、数据库操作、服务层
- L3: E2E 测试（10%）- 关键用户流程

**来源**：测试金字塔原则 + 项目技术栈

### 3. 测试代码模板

**内容**：
- 单元测试模板
- 集成测试模板
- E2E 测试模板

**生成规则**：
1. 从验收清单提取测试场景
2. 根据技术栈选择模板语法
3. 生成测试文件路径、函数名、测试数据、断言语句

**示例结构**：
```markdown
#### 单元测试：表单字段验证

**来源**: AC-F1.1 用户名不能为空

**测试文件**: `tests/unit/test_user_service.py`

**测试函数**: `test_create_user_with_empty_name`

**测试数据**:
```python
{
  "name": "",
  "email": "test@example.com"
}
```

**预期结果**: 抛出验证错误 "用户名不能为空"

**代码模板**:
```python
def test_create_user_with_empty_name():
    # Arrange
    data = UserFactory.emptyName()

    # Act & Assert
    with pytest.raises(ValidationError) as exc_info:
        UserService.create(data)

    assert "用户名不能为空" in str(exc_info.value)
```
```

### 4. 测试数据工厂

**内容**：
- 实体定义
- 工厂方法（有效数据、无效数据）
- 使用示例

**生成规则**：
1. 从 FormValidation 提取实体和字段定义
2. 为每个实体生成有效数据和无效数据工厂方法
3. 根据语言特性选择实现方式

**工厂方法命名规则**：
- `valid{Entity}()` - 返回有效的完整数据
- `empty{Field}()` - 返回指定字段为空的数据
- `tooLong{Field}()` - 返回指定字段超长的数据
- `invalid{Field}()` - 返回指定字段格式错误的数据

### 5. 模块实现指引

**内容**：
- 按模块分组功能
- 每个功能的测试步骤（单元 → 集成 → E2E）
- 实现提示
- 验收标准
- 关联验收项 ID

**生成规则**：
1. 按模块分组功能
2. 为每个功能生成测试步骤
3. 提供实现提示
4. 关联验收项 ID

**示例结构**：
```markdown
### 用户管理模块

#### 创建用户（P0）

**功能描述**: 管理员可以创建新用户

**测试步骤**:

1. **单元测试** (`tests/unit/test_user_service.py`)
   - 测试：用户名不能为空
   - 测试：邮箱格式验证
   - 测试：密码强度验证

2. **集成测试** (`tests/integration/test_user_api.py`)
   - 测试：POST /api/users 创建用户
   - 测试：创建成功返回 201
   - 测试：创建失败返回 400

3. **前端测试** (`tests/components/UserForm.test.tsx`)
   - 测试：表单验证
   - 测试：提交成功后跳转

**实现提示**:
- 使用 UserFactory 生成测试数据
- 密码需要加密存储
- 邮箱需要唯一性校验

**验收标准**:
- 所有单元测试通过
- 所有集成测试通过
- 功能符合验收清单要求

**关联验收项**: AC-F1.1, AC-F1.2, AC-P1.1
```

### 6. 质量门禁

**内容**：
- 自动化检查（测试覆盖率、测试通过率、类型检查、Linter）
- 性能指标（首屏加载、API 响应、页面交互）
- 安全检查（注入风险、XSS、CSRF、权限验证）

**生成规则**：
1. 根据项目类型和技术栈生成自动化检查命令
2. 从需求中提取性能指标
3. 生成安全检查清单

## 技术栈适配

### 技术栈检测

从 `project-config.json` 读取技术栈信息：

```typescript
interface TechStack {
  backend: string;           // 后端框架（Django, FastAPI, Express, etc.）
  frontend: string;          // 前端框架（React, Vue, Angular, etc.）
  testBackend: string;       // 后端测试框架（pytest, jest, vitest, etc.）
  testFrontend: string;      // 前端测试框架（vitest, jest, testing-library, etc.）
}
```

### 测试框架映射

| 后端框架 | 默认测试框架 | 测试文件扩展名 |
|----------|--------------|----------------|
| Django | pytest | `.py` |
| FastAPI | pytest | `.py` |
| Express | jest | `.test.js` |
| NestJS | jest | `.spec.ts` |

| 前端框架 | 默认测试框架 | 测试文件扩展名 |
|----------|--------------|----------------|
| React | vitest | `.test.tsx` |
| Vue | vitest | `.spec.ts` |
| Angular | jasmine | `.spec.ts` |

### 代码模板适配

根据测试框架生成对应的代码模板：

**pytest 示例**：
```python
def test_create_user_with_empty_name():
    # Arrange
    data = UserFactory.emptyName()

    # Act & Assert
    with pytest.raises(ValidationError) as exc_info:
        UserService.create(data)

    assert "用户名不能为空" in str(exc_info.value)
```

**vitest 示例**：
```typescript
describe('UserService', () => {
  it('should throw error when name is empty', () => {
    // Arrange
    const data = UserFactory.emptyName();

    // Act & Assert
    expect(() => UserService.create(data)).toThrow('用户名不能为空');
  });
});
```

## 生成流程

### Step 1: 检测技术栈

```typescript
const techStack = detectTechStack(projectConfig);
console.log(`
📦 技术栈检测
- 后端: ${techStack.backend}
- 前端: ${techStack.frontend}
- 后端测试: ${techStack.testBackend}
- 前端测试: ${techStack.testFrontend}
`);
```

### Step 2: 生成测试代码模板

```typescript
const testTemplates = {
  unitTests: generateUnitTestTemplates(acceptanceChecklist, techStack),
  integrationTests: generateIntegrationTestTemplates(acceptanceChecklist, techStack),
  e2eTests: generateE2eTestTemplates(acceptanceChecklist, techStack)
};
```

### Step 3: 生成测试数据工厂

```typescript
const testFixtures = generateTestFixtures(
  requirementAnalysis.formFields,
  techStack
);
```

### Step 4: 生成模块实现指引

```typescript
const moduleGuides = generateModuleGuides(
  requirementAnalysis,
  acceptanceChecklist,
  techStack
);
```

### Step 5: 生成质量门禁

```typescript
const qualityGates = generateQualityGates(
  projectConfig,
  requirementAnalysis
);
```

### Step 6: 渲染为 Markdown

```typescript
const markdown = renderImplementationGuide({
  metadata: {
    taskName,
    requirementSource,
    acceptanceChecklistPath,
    techDesignPath,
    createdAt: new Date().toISOString(),
    projectType: projectConfig.project.type,
    techStack
  },
  tddWorkflow: generateTddWorkflow(),
  testStrategy: generateTestStrategy(),
  testTemplates,
  testFixtures,
  moduleGuides,
  qualityGates
});
```

## 使用场景

### 场景 1: TDD 开发

开发者按照实现指南的测试步骤进行 Red-Green-Refactor 循环：

1. 查看模块实现指引，选择要实现的功能
2. 复制测试代码模板，创建测试文件
3. 使用测试数据工厂生成测试数据
4. 运行测试，确认失败（Red）
5. 实现功能代码，让测试通过（Green）
6. 重构优化，保持测试通过（Refactor）

### 场景 2: 测试编写

开发者直接使用测试代码模板和测试数据工厂：

1. 查看测试代码模板，了解测试场景
2. 复制代码模板到测试文件
3. 使用测试数据工厂生成测试数据
4. 根据需要调整测试逻辑

### 场景 3: 质量把关

开发者执行质量门禁检查，确保代码质量：

1. 运行自动化检查命令
2. 查看测试覆盖率报告
3. 验证性能指标
4. 执行安全检查

### 场景 4: 新人上手

新人通过模块实现指引快速理解功能和测试策略：

1. 查看模块实现指引，了解功能结构
2. 查看测试步骤，了解测试分层
3. 查看实现提示，了解技术要点
4. 查看验收标准，了解交付要求

## 文件位置

- **规格文件**：`templates/skills/workflow/specs/start/phase-0.7-implementation-guide.md`
- **模板文件**：`templates/skills/workflow/templates/implementation-guide-template.md`
- **生成位置**：`.claude/acceptance/{sanitizedName}-implementation-guide.md`
- **关联文件**：
  - 验收清单：`.claude/acceptance/{sanitizedName}-checklist.md`
  - 技术方案：`.claude/tech-design/{sanitizedName}.md`
  - 任务清单：`~/.claude/workflows/{projectId}/tasks-{sanitizedName}.md`

## 示例

完整示例请参考 `templates/skills/workflow/templates/implementation-guide-template.md`。

## 注意事项

1. **技术栈适配**：确保根据项目配置生成对应的测试框架代码
2. **模板可用性**：生成的代码模板应该可以直接使用，减少手动调整
3. **优先级标注**：明确标注 P0/P1/P2，帮助开发者聚焦关键功能
4. **与验收清单同步**：实现指南和验收清单应该保持一致，互相引用
5. **持续更新**：需求变更时，需要重新生成实现指南

## 相关文档

- [phase-0.7-implementation-guide.md](../specs/start/phase-0.7-implementation-guide.md) - Phase 0.7 实现细节
- [acceptance-checklist.md](./acceptance-checklist.md) - 验收清单系统文档
- [start-overview.md](./start-overview.md) - workflow start 流程概览
- [shared-utils.md](./shared-utils.md) - 共享工具函数
