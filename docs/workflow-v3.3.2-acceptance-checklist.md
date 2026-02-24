# Workflow v3.3.2 - 验证清单生成系统

## 概述

v3.3.2 版本在 workflow skill 中新增了**验证清单生成系统（Phase 0.6）**，将结构化需求自动转换为可执行的验收项，确保需求细节在实现过程中不丢失。

## 核心价值

### 问题背景

在传统的开发流程中，PRD 中的细节要求（如表单字段必填、不同状态的展示逻辑、权限控制等）经常在实现过程中被遗漏，导致：

1. **需求遗漏**：开发者容易忽略 PRD 中的细节要求
2. **验收困难**：缺乏明确的验收标准，验收时容易遗漏
3. **返工频繁**：发现遗漏后需要返工修复
4. **沟通成本高**：产品和开发需要反复确认细节

### 解决方案

验证清单生成系统通过以下方式解决上述问题：

1. **自动提取**：从 PRD 中自动提取 9 维度的结构化需求
2. **转换为验收项**：将结构化需求转换为可执行的验收项
3. **关联到任务**：每个任务自动关联相关的验收项
4. **指导实现**：开发者在实现时参考验收项，确保不遗漏细节

## 功能特性

### 1. 9 维度需求提取（Phase 0.5）

从 PRD 中提取以下 9 个维度的结构化需求：

| 维度 | 说明 | 示例 |
|------|------|------|
| 变更记录 | 版本变更历史 | V2.0 新增字段、V2.1 修改规则 |
| 表单字段 | 字段规格（按场景分组） | 活动名称：必填、50字符限制、唯一性 |
| 角色权限 | 权限矩阵 | 管理员可删除、普通用户只读 |
| 交互规格 | 交互行为 | hover 显示 tooltip、点击弹窗 |
| 业务规则 | 条件逻辑 | 活动名称在同一分类下唯一 |
| 边界场景 | 异常处理 | 列表为空时显示空状态 |
| UI展示规则 | 展示差异 | 不同 Tab 显示不同列 |
| 功能流程 | 多步流程 | 创建活动流程（5步） |
| 数据契约 | API/数据模型 | POST /api/activities |

### 2. 7 类验证项生成（Phase 0.6）

将结构化需求转换为 7 类验证项：

| 验证项类型 | 来源维度 | 包含内容 |
|-----------|---------|---------|
| 表单字段验证 | 表单字段 | 必填验证、格式验证、长度验证、测试数据 |
| 角色权限验证 | 角色权限 | 可见性验证、可操作性验证、数据范围验证、测试步骤 |
| 交互行为验证 | 交互规格 | 触发条件、响应行为、提示信息、前置条件 |
| 业务规则验证 | 业务规则 | 条件判断、期望行为、关联字段、测试场景 |
| 边界场景验证 | 边界场景 | 场景展示、兜底行为、上下文 |
| UI展示验证 | UI展示规则 | 展示规则、视觉检查点 |
| 功能流程验证 | 功能流程 | 步骤验证、条件分支、入口路径 |

### 3. 任务关联映射

根据任务的 `phase`、`file`、`requirement` 等属性，自动匹配相关的验收项：

```markdown
## T3: 实现活动创建表单
- **阶段**: ui-form
- **文件**: `src/components/ActivityForm.vue`
- **需求**: 实现活动创建表单，包含名称、分类、时间等字段
- **验收项**: AC-F1.1, AC-F1.2, AC-F1.3, AC-B1  ← 自动关联
- **actions**: `create_file`
- **状态**: pending
```

### 4. 验收标准定义

明确定义验收通过标准：

**必须满足（Must Pass）**：
- 所有标记为 "必填" 的字段验证通过
- 所有角色权限验证通过
- 所有业务规则验证通过
- 关键功能流程验证通过

**建议满足（Should Pass）**：
- 所有交互行为验证通过
- 所有边界场景验证通过
- 所有UI展示规则验证通过

## 工作流程

```
需求文档 (PRD)
    ↓
Phase 0.5: 需求结构化提取
    ↓
9 维度结构化需求 (RequirementAnalysis)
    ↓
Phase 0.6: 验证清单生成
    ↓
7 类验证项 (AcceptanceChecklist)
    ↓
任务关联映射
    ↓
任务清单 (tasks.md) + 验证清单 (acceptance-checklist.md)
    ↓
任务执行时参考验收项
    ↓
验收测试
```

## 文件结构

```
项目目录/
├── .claude/
│   ├── config/project-config.json     ← /scan 生成
│   ├── tech-design/{name}.md          ← 技术方案
│   └── acceptance/{name}-checklist.md ← 验证清单 (v3.3.2 新增)

~/.claude/workflows/{projectId}/
├── workflow-state.json                ← 运行时状态
├── tasks-{name}.md                    ← 任务清单（包含验收项关联）
└── changes/                           ← 增量变更
    └── CHG-001/
        ├── delta.json
        ├── intent.md
        └── review-status.json
```

## 使用示例

### 1. 生成验证清单

```bash
# 启动工作流（自动生成验证清单）
/workflow start docs/prd.md
```

输出：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Phase 0.6: 生成验证清单
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 验证清单生成完成

📊 表单验证: 3 | 权限验证: 2 | 交互验证: 4 | 业务规则: 2 | 边界场景: 3 | UI展示: 2 | 功能流程: 1
📈 总验收项: 17

📄 验证清单已保存: .claude/acceptance/activity-management-checklist.md

💡 任务执行时将自动关联相关验收项
```

### 2. 查看任务关联的验收项

```bash
# 查看任务清单
cat ~/.claude/workflows/proj-123/tasks-activity-management.md

# 输出示例
## T3: 实现活动创建表单
- **验收项**: AC-F1.1, AC-F1.2, AC-F1.3, AC-B1
```

### 3. 查看具体验收项内容

```bash
# 搜索验收项
grep "AC-F1.1" .claude/acceptance/activity-management-checklist.md -A 15
```

输出：
```markdown
#### AC-F1.1 活动名称

**验证项**:
- [ ] 活动名称 为空时，显示提示: "活动名称为必填项"
- [ ] 活动名称 字符限制 50 字符
- [ ] 输入框显示 placeholder: "请输入活动名称"

**测试数据**:
| 输入 | 期望结果 |
|------|----------|
| （空值） | 显示错误提示: 活动名称为必填项 |
| 超过 50 字符的文本 | 禁止输入或显示错误提示 |
```

### 4. 执行任务时参考验收项

在实现任务时，参考关联的验收项确保：
- ✅ 所有必填字段都有验证
- ✅ 所有校验规则都已实现
- ✅ 所有提示文案都符合规格
- ✅ 所有边界场景都有处理

### 5. 验收测试

完成任务后，按照验证清单逐项验收，勾选已验证的项。

## 技术实现

### 核心函数

1. **extractStructuredRequirements()** - 从 PRD 提取 9 维度结构化需求
2. **generateAcceptanceChecklist()** - 将结构化需求转换为验证清单
3. **mapTaskToAcceptanceCriteria()** - 将任务映射到验收项
4. **renderAcceptanceChecklist()** - 渲染验证清单为 Markdown

### 数据结构

```typescript
interface RequirementAnalysis {
  changeRecords: ChangeRecord[];
  formFields: FormField[];
  rolePermissions: RolePermission[];
  interactions: Interaction[];
  businessRules: BusinessRule[];
  edgeCases: EdgeCase[];
  uiDisplayRules: UiDisplayRule[];
  functionalFlows: FunctionalFlow[];
  dataContracts: DataContract[];
}

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

## 相关文档

- **实现文档**：`templates/skills/workflow/references/start.md` - Phase 0.6 实现细节
- **说明文档**：`templates/skills/workflow/references/acceptance-checklist.md` - 验证清单系统说明
- **使用指南**：`templates/docs/acceptance-checklist-guide.md` - 使用指南和最佳实践
- **模板文件**：`templates/docs/acceptance-checklist-template.md` - 验证清单模板

## 版本历史

### v3.3.2 (2026-02-24)

**新增功能**：
- ✨ Phase 0.6: 验证清单生成系统
- ✨ 9 维度需求结构化提取（Phase 0.5 增强）
- ✨ 7 类验证项自动生成
- ✨ 任务与验收项自动关联
- ✨ 验收标准定义

**新增文件**：
- `templates/docs/acceptance-checklist-template.md` - 验证清单模板
- `templates/skills/workflow/references/acceptance-checklist.md` - 系统说明文档
- `templates/docs/acceptance-checklist-guide.md` - 使用指南

**改进**：
- 任务清单新增 `验收项` 字段
- 技术方案新增需求详情章节（1.1-1.9）
- 规划完成时显示验证清单路径

### v3.3.1 (2026-02-23)

- Phase 0.5: 需求结构化提取
- Codex 需求对齐审查

### v3.3.0 (2026-02-22)

- bug-batch Skill
- debug 精简
- scan 蓝鲸关联

## 最佳实践

### 1. PRD 编写建议

为了获得更好的验证清单，PRD 应该包含：

- **明确的字段规格**：字段名、类型、必填、长度限制、校验规则、提示文案
- **详细的权限说明**：角色、可执行操作、限制、数据范围
- **清晰的交互描述**：触发方式、目标元素、行为、提示信息、前置条件
- **完整的业务规则**：条件、期望行为、关联字段
- **边界场景说明**：场景、期望展示、兜底行为
- **UI展示差异**：不同上下文的展示规则
- **功能流程步骤**：完整步骤、条件分支、入口路径

### 2. 验证清单使用建议

- **实现前先看验收项**：确保理解所有验证要求
- **边实现边验证**：及时发现问题
- **使用测试数据**：覆盖所有场景
- **记录验收结果**：包括验收人、时间、状态
- **发现问题及时反馈**：更新验证清单

### 3. 质量保证建议

- **代码审查时参考验证清单**：确保所有验收项都已实现
- **测试时使用验证清单**：作为测试用例的补充
- **验收时逐项检查**：确保不遗漏

## 常见问题

### Q1: 验证清单生成失败怎么办？

**A**: 检查以下几点：
1. PRD 文档长度是否 > 500 字符（太短会跳过）
2. PRD 格式是否规范（Markdown 格式）
3. 是否包含足够的细节信息

### Q2: 验证清单内容不准确怎么办？

**A**: 验证清单是基于 PRD 自动生成的，如果不准确：
1. 检查 PRD 是否有歧义或遗漏
2. 更新 PRD 后重新生成
3. 可以手动编辑验证清单（小的调整）

### Q3: 如何更新验证清单？

**A**:
- 小的变更：手动编辑验证清单
- 大的变更：更新 PRD 后重新执行 `/workflow start`
- 增量变更：使用 `/workflow delta` 进行增量更新

### Q4: 验证清单可以复用吗？

**A**: 可以。如果多个项目有相似的需求，可以复制验证清单并根据实际情况调整。

## 反馈与改进

如果您在使用过程中发现问题或有改进建议，欢迎反馈：

- 提交 Issue：https://github.com/anthropics/claude-code/issues
- 或在项目中创建反馈文档

## 许可证

MIT License
