---
version: 2
tech_design: "{{tech_design_path}}"
created_at: "{{created_at}}"
checksum: "{{checksum}}"
last_change: "{{last_change_id}}"
---

# Tasks: {{task_name}}

## 设计文档

📄 `{{tech_design_path}}`

## 约束（从设计文档继承）

{{#each constraints}}
- {{this}}
{{/each}}

## 验收标准

{{#each acceptance_criteria}}
- [ ] {{this.id}}: {{this.description}}
{{/each}}

---

{{#each tasks}}
## {{this.id}}: {{this.name}}
<!-- id: {{this.id}}, design_ref: {{this.design_ref}} -->
- **阶段**: {{this.phase}}
- **文件**: `{{this.file}}`
{{#if this.leverage}}
- **复用**: `{{this.leverage}}`
{{/if}}
{{#if this.design_ref}}
- **设计参考**: tech-design.md § {{this.design_ref}}
{{/if}}
- **需求**: {{this.requirement}}
{{#if this.acceptance}}
- **验收**: {{this.acceptance}}
{{/if}}
- **actions**: `{{this.actions}}`
{{#if this.depends}}
- **依赖**: {{this.depends}}
{{/if}}
{{#if this.quality_gate}}
- **质量关卡**: true
- **阈值**: {{this.threshold}}
{{/if}}
- **状态**: {{this.status}}

{{/each}}
