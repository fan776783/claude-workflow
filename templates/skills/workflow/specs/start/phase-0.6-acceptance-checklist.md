# Phase 0.6: 验证清单生成详情

## 目的

将结构化需求转换为可执行的验证清单，用于验证功能交付质量。验证清单关注用户视角的验收标准，与 Phase 0.7 生成的实现指南（开发者视角）互补。

## 执行条件

**条件执行**：仅在 Phase 0.5 成功提取结构化需求后执行

```typescript
if (requirementAnalysis) {
  acceptanceChecklist = generateAcceptanceChecklist(requirementAnalysis, taskName);
  // Phase 0.6 完成后，自动触发 Phase 0.7 生成实现指南
} else {
  console.log(`⏭️ 跳过（未执行 Phase 0.5）\n`);
}
```

## 与 Phase 0.7 的关系

- **Phase 0.6 (验收清单)**: 用户视角的验收标准，用于验证交付质量
- **Phase 0.7 (实现指南)**: 开发者视角的实现路径，提供 TDD 流程和测试模板

两者互相引用，共同指导开发和验收。

## 数据结构

### AcceptanceChecklist

```typescript
interface AcceptanceChecklist {
  formValidations: FormValidation[];
  permissionValidations: PermissionValidation[];
  interactionValidations: InteractionValidation[];
  businessRuleValidations: BusinessRuleValidation[];
  edgeCaseValidations: EdgeCaseValidation[];
  uiDisplayValidations: UiDisplayValidation[];
  functionalFlowValidations: FunctionalFlowValidation[];
  taskChecklistMapping: TaskChecklistMapping[];
}
```

### FormValidation

```typescript
interface FormValidation {
  scene: string;
  sceneId: string;  // F1, F2, ...
  items: Array<{
    fieldName: string;
    checks: string[];
    testCases: Array<{ input: string; expected: string }>;
  }>;
}
```

### PermissionValidation

```typescript
interface PermissionValidation {
  role: string;
  roleId: string;  // P1, P2, ...
  items: Array<{
    scenario: string;
    checks: string[];
    testSteps: string[];
  }>;
}
```

### InteractionValidation

```typescript
interface InteractionValidation {
  category: string;
  categoryId: string;  // I1, I2, ...
  items: Array<{
    element: string;
    trigger: string;
    checks: string[];
    precondition: string;
  }>;
}
```

### BusinessRuleValidation

```typescript
interface BusinessRuleValidation {
  ruleId: string;
  description: string;
  checks: string[];
  relatedFields: string;
  testScenarios: Array<{
    scenario: string;
    input: string;
    expected: string;
  }>;
}
```

### EdgeCaseValidation

```typescript
interface EdgeCaseValidation {
  scenario: string;
  checks: string[];
  context: string;
  fallback: string;
}
```

### UiDisplayValidation

```typescript
interface UiDisplayValidation {
  context: string;
  contextId: string;  // U1, U2, ...
  items: Array<{
    rule: string;
    checks: string[];
    visualChecks: string[];
  }>;
}
```

### FunctionalFlowValidation

```typescript
interface FunctionalFlowValidation {
  flowName: string;
  steps: string[];
  conditionalPaths: Array<{
    condition: string;
    expectedBehavior: string;
  }>;
  entryPoints: Array<{
    entry: string;
    expectedResult: string;
  }>;
}
```

## 转换策略

### 1. 表单字段 → 验证项

**转换规则**：
- 必填字段 → 空值验证项 + 提示文案验证
- 字符限制 → 长度验证项 + 超出测试用例
- 格式校验 → 格式验证项 + 不符合格式测试用例
- Tooltip → Placeholder 验证项
- Helper Text → 提示文案验证项
- 文件上传 → 格式/大小限制验证项 + 失败提示验证
- 下拉选择 → 选项完整性验证 + 排序验证
- 开关 → 状态切换验证 + 联动逻辑验证

**示例**：
```typescript
// 输入：formField
{
  scene: "创建用户弹窗",
  fieldName: "用户名",
  type: "text",
  required: true,
  validationRules: ["最多20字符", "不能包含特殊字符"],
  tooltip: "请输入用户名",
  validationMessage: "用户名不能为空"
}

// 输出：formValidation.items
{
  fieldName: "用户名",
  checks: [
    "用户名 为空时，显示提示: \"用户名不能为空\"",
    "用户名 最多20字符",
    "用户名 不能包含特殊字符",
    "输入框显示 placeholder: \"请输入用户名\""
  ],
  testCases: [
    { input: "（空值）", expected: "显示错误提示: 用户名不能为空" },
    { input: "超过 20 字符的文本", expected: "禁止输入或显示错误提示" },
    { input: "不符合格式的输入", expected: "显示格式错误提示" }
  ]
}
```

### 2. 角色权限 → 验证项

**转换规则**：
- 权限 → 可见性验证 + 可操作性验证 + 结果验证
- 限制 → 不可见/置灰验证 + 拦截验证
- 场景说明 → 数据范围验证 + 归属判定验证

**示例**：
```typescript
// 输入：rolePermission
{
  role: "普通用户",
  permissions: ["查看自己的数据", "编辑自己的数据"],
  restrictions: ["删除数据", "查看他人数据"],
  scenarioNotes: "只能看到自己创建的数据"
}

// 输出：permissionValidation.items
[
  {
    scenario: "普通用户 - 查看自己的数据",
    checks: [
      "普通用户 可以执行 \"查看自己的数据\" 操作",
      "操作按钮/入口对 普通用户 可见",
      "执行操作后结果符合预期"
    ],
    testSteps: [
      "使用 普通用户 账号登录",
      "导航到相关功能页面",
      "验证 \"查看自己的数据\" 操作可见且可执行",
      "执行操作并验证结果"
    ]
  },
  {
    scenario: "普通用户 - 删除数据",
    checks: [
      "普通用户 不能执行 \"删除数据\" 操作",
      "相关按钮/入口对 普通用户 不可见或置灰",
      "尝试执行时显示权限不足提示"
    ],
    testSteps: [
      "使用 普通用户 账号登录",
      "导航到相关功能页面",
      "验证 \"删除数据\" 操作不可见或置灰",
      "（如可见）尝试执行并验证被拦截"
    ]
  },
  {
    scenario: "普通用户 - 数据范围",
    checks: [
      "普通用户 只能看到符合权限范围的数据",
      "数据归属判定逻辑正确: 只能看到自己创建的数据"
    ],
    testSteps: [
      "使用 普通用户 账号登录",
      "查看数据列表",
      "验证只显示符合权限范围的数据",
      "尝试访问超出权限范围的数据，验证被拦截"
    ]
  }
]
```

### 3. 交互规格 → 验证项

**转换规则**：
- 触发条件 → 前置条件验证
- 行为 → 行为验证
- 提示信息 → 提示文案验证
- Hover 延迟 → 延迟时间验证
- 弹窗 → 层级验证 + 关闭后返回位置验证 + 内容完整性验证
- Loading → Loading 状态验证 + 结束后状态更新验证

### 4. 业务规则 → 验证项

**转换规则**：
- 条件 → 条件判断验证
- 期望行为 → 行为验证
- 关联字段 → 联动验证
- 唯一性 → 唯一性校验范围验证 + 重复值测试
- 联动规则 → 联动测试
- 删除/禁用 → 影响范围验证 + 删除影响测试

### 5. 边界场景 → 验证项

**转换规则**：
- 场景 → 展示验证
- 兜底行为 → 兜底行为验证
- 上下文 → 上下文特定验证
- 空状态 → 空状态文案/图标/按钮验证 + 操作引导验证
- 权限不足 → 提示清晰性验证 + 开通入口验证
- 超出限制 → 提示和处理验证

### 6. UI展示规则 → 验证项

**转换规则**：
- 列差异 → 显示/隐藏验证 + 顺序验证 + 宽度验证
- 文本截断 → 截断验证 + Hover 完整内容验证
- 时间格式 → 格式验证 + 时区验证
- 空值展示 → 占位符/默认值验证
- 固定列 → 滚动时固定验证 + 样式验证

### 7. 功能流程 → 验证项

**转换规则**：
- 步骤 → 步骤完整性验证
- 条件分支 → 分支逻辑验证
- 入口路径 → 入口触发验证 + 返回位置验证

## 实现函数

```typescript
function generateAcceptanceChecklist(
  analysis: RequirementAnalysis,
  taskName: string
): AcceptanceChecklist {
  const checklist: AcceptanceChecklist = {
    formValidations: [],
    permissionValidations: [],
    interactionValidations: [],
    businessRuleValidations: [],
    edgeCaseValidations: [],
    uiDisplayValidations: [],
    functionalFlowValidations: [],
    taskChecklistMapping: []
  };

  // 1. 表单字段 → 验证项
  const formByScene = groupBy(analysis.formFields, 'scene');
  Object.entries(formByScene).forEach(([scene, fields], sceneIndex) => {
    // ... 转换逻辑
  });

  // 2. 角色权限 → 验证项
  analysis.rolePermissions.forEach((perm, index) => {
    // ... 转换逻辑
  });

  // 3-7. 其他维度转换
  // ...

  return checklist;
}
```

## 渲染为 Markdown

```typescript
function renderAcceptanceChecklist(
  checklist: AcceptanceChecklist,
  metadata: {
    taskName: string;
    requirementSource: string;
    techDesignPath: string;
    createdAt: string;
  }
): string {
  // 渲染为 Markdown 格式
  // 包含：清单概览、各维度验证项、验收通过标准、验收记录
}
```

## 输出文件

**路径**: `.claude/acceptance/{task-name}-checklist.md`

**结构**:
```markdown
---
version: 1
requirement_source: "docs/prd.md"
created_at: "2026-02-24T10:00:00Z"
tech_design: ".claude/tech-design/task-name.md"
---

# 验收清单: 任务名称

> 本清单由需求结构化提取自动生成，用于指导任务执行和验收测试

## 📋 清单概览

- **总验收项**: 42
- **表单验证**: 3 个场景
- **权限验证**: 2 个角色
- **交互验证**: 4 个类别
- **业务规则验证**: 5 条规则
- **边界场景验证**: 6 个场景
- **UI展示验证**: 3 个上下文
- **功能流程验证**: 2 个流程

---

## 1. 表单字段验证

### 1.1 创建用户弹窗

#### AC-F1.1 用户名

**验证项**:
- [ ] 用户名 为空时，显示提示: "用户名不能为空"
- [ ] 用户名 最多20字符
- [ ] 用户名 不能包含特殊字符
- [ ] 输入框显示 placeholder: "请输入用户名"

**测试数据**:

| 输入 | 期望结果 |
|------|----------|
| （空值） | 显示错误提示: 用户名不能为空 |
| 超过 20 字符的文本 | 禁止输入或显示错误提示 |
| 不符合格式的输入 | 显示格式错误提示 |

...

## 8. 验收通过标准

**必须满足**:
- 所有标记为 "必填" 的字段验证通过
- 所有角色权限验证通过
- 所有业务规则验证通过
- 关键功能流程验证通过

**建议满足**:
- 所有交互行为验证通过
- 所有边界场景验证通过
- 所有UI展示规则验证通过

---

## 9. 验收记录

| 验收项 ID | 验收人 | 验收时间 | 状态 | 备注 |
|-----------|--------|----------|------|------|
| - | - | - | - | - |
```

## 任务关联

验证清单项将在 Phase 2 任务生成时自动关联到相关任务：

```typescript
function mapTaskToAcceptanceCriteria(
  task: Task,
  checklist: AcceptanceChecklist
): string[] {
  // 根据任务的 phase、file、requirement 等属性
  // 匹配相关的验收项 ID
  // 返回验收项 ID 数组（如 ["AC-F1.1 用户名", "AC-P1.1 普通用户 - 查看自己的数据"]）
}
```

## 使用场景

1. **任务执行时**: 开发者参考验证清单确保实现完整
2. **代码审查时**: 审查者根据验证清单检查实现质量
3. **验收测试时**: 测试人员按验证清单逐项验收
4. **文档归档时**: 验证清单作为需求实现的证明文档
