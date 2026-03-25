# Traceability 参考定义

## 快速导航

- 目的
- 术语
- 数据结构
- coverage_level 定义
- scope_status 定义
- Critical Constraints 规则
- Traceability Gate 规则

## 目的

统一定义 workflow 中的 requirement item、coverage level、scope status、critical constraints 与 traceability mapping，避免各阶段各自解释“需求覆盖”的含义。

## 术语

### Requirement Baseline

由 `Phase 0.55` 生成的需求基线，是整个 workflow 的需求真相源。后续所有工件都应消费 baseline，而不是重新自由摘要原始需求。

### Requirement Item

Requirement Baseline 中的最小可追溯需求单位。每个 item 都必须有稳定 ID、职责归属、范围判定和关键约束。

### Traceability Mapping

描述单条 requirement 在 acceptance、design、spec、plan、task 中的去向，用于 review gate 和运行时质量检查。

## 数据结构

```typescript
interface RequirementItem {
  id: string;
  source_text: string;
  normalized_summary: string;
  category:
    | 'change_record'
    | 'form_field'
    | 'permission'
    | 'interaction'
    | 'business_rule'
    | 'edge_case'
    | 'ui_display'
    | 'functional_flow'
    | 'data_contract'
    | 'export_rule'
    | 'dependency';
  scope_owner: 'frontend' | 'backend' | 'shared' | 'product' | 'infra';
  scope_status: 'in_scope' | 'partially_in_scope' | 'out_of_scope' | 'blocked';
  critical_constraints: string[];
  dependency_tags: string[];
  risk_of_loss?: string;
  notes?: string[];
}
```

```typescript
interface TraceabilityMapping {
  requirement_id: string;
  acceptance_ids?: string[];
  spec_refs?: string[];
  tech_design_refs?: string[];
  plan_step_ids?: string[];
  task_ids?: string[];
  coverage_level: 'full' | 'partial' | 'none';
  scope_status: 'in_scope' | 'partially_in_scope' | 'out_of_scope' | 'blocked';
  notes?: string;
}
```

## coverage_level 定义

### full

下游工件已完整体现 requirement 的主语义与关键约束，且可进一步追溯到验证或执行环节。

### partial

下游工件只体现了 requirement 的部分内容，通常用于：

- 仅体现能力标题，未完整体现约束
- 只承接展示层，不承接底层处理逻辑
- 当前工件保留了去向，但未形成可执行或可验收映射

### none

当前工件中未体现该 requirement，除非其 `scope_status` 为 `out_of_scope`，否则视为问题。

## scope_status 定义

### in_scope

当前 workflow 明确承接，并应在 spec、plan、tasks 中形成落实路径。

### partially_in_scope

当前 workflow 只承接部分责任，必须写清承接边界与未承接部分。

### out_of_scope

当前 workflow 明确不承接，必须写明原因，并保留在 baseline 与 traceability 文档中。

### blocked

理论上在范围内，但受外部依赖阻塞，必须带 `dependency_tags`，并在后续文档中显式暴露。

## Critical Constraints 规则

以下内容若在原始需求出现，必须提取到 `critical_constraints`：

- 具体按钮文案、字段名、tab 名、区块名、sheet 命名规则
- 精确条件分支与状态判断
- 数量上限、字符限制、时间规则、排序规则
- UI 位置、显隐逻辑、视觉状态与粒度定义
- 角色边界、数据归属边界、接口依赖边界

## Traceability Gate 规则

### Spec Traceability Gate

- 所有 `in_scope` requirement 必须在 tech-design / spec 中出现明确映射。
- 所有 `partially_in_scope / out_of_scope` requirement 必须带 reason。
- 所有 `critical_constraints` 必须在 tech-design 或 spec 的显式章节中出现。

### Plan Coverage Gate

- 所有 `in_scope` requirement 至少映射到一个 plan step。
- 所有 blocked requirement 必须带 dependency 标签。
- 所有 critical constraints 必须出现在 step 或 Non-Negotiable 约束中。

### Runtime Traceability Gate

- WorkflowTaskV2 必须带 `requirement_ids`。
- 若任务对应关键约束，则必须带 `critical_constraints`。
- 质量关卡任务应能回溯到其守护的 requirement 集合。
