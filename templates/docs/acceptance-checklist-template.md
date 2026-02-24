---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
tech_design: "{{tech_design_path}}"
---

# 验收清单: {{task_name}}

> 本清单由需求结构化提取自动生成，用于指导任务执行和验收测试

## 📋 清单概览

- **总验收项**: {{total_items}}
- **表单验证**: {{form_validation_count}} 项
- **权限验证**: {{permission_validation_count}} 项
- **交互验证**: {{interaction_validation_count}} 项
- **业务规则验证**: {{business_rule_validation_count}} 项
- **边界场景验证**: {{edge_case_validation_count}} 项
- **UI展示验证**: {{ui_display_validation_count}} 项

---

{{#if form_validations.length}}
## 1. 表单字段验证

{{#each form_validations}}
### 1.{{@index}} {{scene}}

{{#each items}}
#### AC-F{{../scene_id}}.{{@index}} {{fieldName}}

**验证项**:
{{#each checks}}
- [ ] {{this}}
{{/each}}

**测试数据**:
{{#if testCases}}
| 输入 | 期望结果 |
|------|----------|
{{#each testCases}}
| {{input}} | {{expected}} |
{{/each}}
{{/if}}

{{/each}}
{{/each}}

---
{{/if}}

{{#if permission_validations.length}}
## 2. 角色权限验证

{{#each permission_validations}}
### 2.{{@index}} {{role}}

{{#each items}}
#### AC-P{{../role_id}}.{{@index}} {{scenario}}

**验证项**:
{{#each checks}}
- [ ] {{this}}
{{/each}}

**测试步骤**:
{{#each testSteps}}
{{@index}}. {{this}}
{{/each}}

{{/each}}
{{/each}}

---
{{/if}}

{{#if interaction_validations.length}}
## 3. 交互行为验证

{{#each interaction_validations}}
### 3.{{@index}} {{category}}

{{#each items}}
#### AC-I{{../category_id}}.{{@index}} {{element}} - {{trigger}}

**验证项**:
{{#each checks}}
- [ ] {{this}}
{{/each}}

**前置条件**: {{precondition}}

{{/each}}
{{/each}}

---
{{/if}}

{{#if business_rule_validations.length}}
## 4. 业务规则验证

{{#each business_rule_validations}}
#### AC-B{{@index}} {{rule_id}}: {{description}}

**验证项**:
{{#each checks}}
- [ ] {{this}}
{{/each}}

**关联字段**: {{relatedFields}}

**测试场景**:
{{#each testScenarios}}
- **场景 {{@index}}**: {{scenario}}
  - 输入: {{input}}
  - 期望: {{expected}}
{{/each}}

{{/each}}

---
{{/if}}

{{#if edge_case_validations.length}}
## 5. 边界场景验证

{{#each edge_case_validations}}
#### AC-E{{@index}} {{scenario}}

**验证项**:
{{#each checks}}
- [ ] {{this}}
{{/each}}

**上下文**: {{context}}

**兜底行为**: {{fallback}}

{{/each}}

---
{{/if}}

{{#if ui_display_validations.length}}
## 6. UI展示规则验证

{{#each ui_display_validations}}
### 6.{{@index}} {{context}}

{{#each items}}
#### AC-U{{../context_id}}.{{@index}} {{rule}}

**验证项**:
{{#each checks}}
- [ ] {{this}}
{{/each}}

**视觉检查点**:
{{#each visualChecks}}
- {{this}}
{{/each}}

{{/each}}
{{/each}}

---
{{/if}}

{{#if functional_flow_validations.length}}
## 7. 功能流程验证

{{#each functional_flow_validations}}
### 7.{{@index}} {{flowName}}

**完整流程验证**:
{{#each steps}}
{{@index}}. [ ] {{this}}
{{/each}}

{{#if conditionalPaths.length}}
**条件分支验证**:
{{#each conditionalPaths}}
- [ ] {{condition}}: {{expectedBehavior}}
{{/each}}
{{/if}}

{{#if entryPoints.length}}
**入口路径验证**:
{{#each entryPoints}}
- [ ] 从 {{entry}} 触发 → {{expectedResult}}
{{/each}}
{{/if}}

{{/each}}

---
{{/if}}

## 8. 任务关联映射

> 每个任务应参考对应的验收项进行实现和自测

{{#each task_checklist_mapping}}
### {{taskId}}: {{taskName}}

**关联验收项**:
{{#each acceptanceCriteria}}
- {{this}}
{{/each}}

**验证方式**: {{verificationType}}

{{/each}}

---

## 9. 验收通过标准

**必须满足**:
{{#each must_pass_criteria}}
- {{this}}
{{/each}}

**建议满足**:
{{#each should_pass_criteria}}
- {{this}}
{{/each}}

---

## 10. 验收记录

| 验收项 ID | 验收人 | 验收时间 | 状态 | 备注 |
|-----------|--------|----------|------|------|
| - | - | - | - | - |

