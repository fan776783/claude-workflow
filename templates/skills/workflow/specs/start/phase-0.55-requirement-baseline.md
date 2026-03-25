# Phase 0.55: Requirement Baseline Generation 详情

## 目的

在 `Phase 0.5` 的结构化需求提取之后，生成一份稳定、可追溯、供下游所有工件显式消费的 Requirement Baseline。Baseline 的职责不是替代 `acceptance checklist` 或 `implementation guide`，而是作为它们共同引用的需求真相源。

> Baseline 关注“原始需求条目是什么、归谁负责、哪些是硬约束、哪些容易在后续摘要中丢失”，而不是直接描述如何验收或如何实现。

## 执行时机

**强制执行**：仅在 `Phase 0.5` 成功完成后执行，位于 `Phase 0.6` 之前。

## 输入

- `requirementAnalysis`
- `requirementContent`
- `discussion-artifact.json`（如有）
- `analysisResult`（仅用于补充代码上下文与职责边界，不作为需求事实来源）

## 输出

- `.claude/analysis/{task-name}-requirement-baseline.md`
- `~/.claude/workflows/{projectId}/requirement-baseline.json`

## 设计原则

- **Baseline 独立**：不与 checklist / implementation-guide 混写。
- **逐条编号**：每个 requirement item 必须拥有稳定 ID（如 `R-001`）。
- **保留原文**：`source_text` 尽量保留 PRD 原文关键句，不做过度改写。
- **显式范围判定**：每个 requirement item 必须标记 `in_scope / partially_in_scope / out_of_scope / blocked`。
- **职责归属清晰**：每个 requirement item 必须标记 owner（frontend / backend / shared / product / infra）。
- **关键约束不可丢**：上限值、按钮名、字段名、sheet 命名、条件分支、粒度定义、位置描述等必须进入 `critical_constraints`。
- **高风险细节前置暴露**：对容易在后续摘要中丢失的需求做风险标注。

## 实现细节

### Step 1: 准备路径与基础上下文

```typescript
const baselinePath = `.claude/analysis/${sanitizedName}-requirement-baseline.md`;
const baselineJsonPath = path.join(workflowDir, 'requirement-baseline.json');
ensureDir('.claude/analysis');
```

### Step 2: 将结构化需求归一化为 RequirementItem

```typescript
const requirementItems = normalizeRequirementItems({
  requirementAnalysis,
  requirementContent,
  discussionArtifact,
  analysisResult
});
```

### Step 3: 进行范围与职责判定

```typescript
const classifiedItems = classifyRequirementScope(requirementItems, discussionArtifact);
```

### Step 4: 渲染 Baseline 文档

```typescript
const baselineTemplate = loadTemplate('requirement-baseline-template.md');
const baselineMarkdown = baselineTemplate
  ? replaceVars(baselineTemplate, {
      task_name: taskName,
      requirement_source: requirementSource,
      created_at: new Date().toISOString(),
      requirement_summary: renderRequirementBaselineSummary(classifiedItems),
      scope_summary: renderRequirementScopeSummary(classifiedItems),
      critical_constraints: renderCriticalConstraints(classifiedItems),
      requirement_items: renderRequirementItems(classifiedItems),
      uncovered_notes: renderBaselineWarnings(classifiedItems)
    })
  : generateInlineRequirementBaseline({ taskName, requirementSource, classifiedItems });

writeFile(baselinePath, baselineMarkdown);
writeFile(baselineJsonPath, JSON.stringify({ items: classifiedItems }, null, 2));
```

### Step 5: 更新状态机

```typescript
state.requirement_baseline = {
  generated: true,
  path: baselinePath,
  json_path: baselineJsonPath,
  total_requirements: classifiedItems.length,
  in_scope_count: classifiedItems.filter(i => i.scope_status === 'in_scope').length,
  partial_count: classifiedItems.filter(i => i.scope_status === 'partially_in_scope').length,
  out_of_scope_count: classifiedItems.filter(i => i.scope_status === 'out_of_scope').length,
  blocked_count: classifiedItems.filter(i => i.scope_status === 'blocked').length,
  uncovered_requirements: []
};
```

## 核心接口

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
  mapped_acceptance_ids?: string[];
  mapped_spec_refs?: string[];
  mapped_plan_steps?: string[];
  notes?: string[];
}
```

```typescript
interface RequirementBaseline {
  path_md: string;
  path_json: string;
  items: RequirementItem[];
  summary: {
    total: number;
    in_scope: number;
    partial: number;
    out_of_scope: number;
    blocked: number;
  };
  uncovered_requirements: string[];
}
```

## 高风险关键词规则

若原始 PRD 中出现以下信息，必须优先进入 `critical_constraints`：

- 按钮名 / 列名 / 区块标题 / sheet 命名
- 上限值 / 数量限制 / 枚举值
- 条件分支（如“有数据 / 无数据”“需要 / 不需要”“仅在...时展示”）
- 粒度定义（如“剧本片段粒度”）
- 位置描述（左侧 / 右侧 / 底部 / 某行）
- 强视觉状态（锁定、紫色高亮、置灰、隐藏）
- 范围判定（前端负责、后端负责、仅依赖接口输出）

## 归类规则

### in_scope

当前 workflow 需要在后续文档中完整承接并进入实现或验收的条目。

### partially_in_scope

本次只承接展示、验收、调用触发或适配层，不承接底层生成/计算/外部系统逻辑的条目。

### out_of_scope

明确不纳入当前 workflow 的条目，但必须保留原文与排除原因，禁止“无声消失”。

### blocked

当前纳入范围，但依赖 `api_spec` 或外部依赖才能继续细化的条目。

## 覆盖率门槛

### Gate 1: Baseline Coverage Gate

```typescript
const totalItems = classifiedItems.length;
const missingIds = classifiedItems.filter(i => !i.id);
const missingScope = classifiedItems.filter(i => !i.scope_status);
const missingOwner = classifiedItems.filter(i => !i.scope_owner);

if (missingIds.length > 0 || missingScope.length > 0 || missingOwner.length > 0) {
  throw new Error('Requirement Baseline 不完整：存在未编号、未判定范围或未判定职责的条目');
}
```

### Warning: 过度聚合

```typescript
const oversizedItems = classifiedItems.filter(i => i.critical_constraints.length >= 5 && /以及|并且|同时/.test(i.source_text));
if (oversizedItems.length > 0) {
  console.log('⚠️ Baseline 中存在疑似过度聚合条目，建议进一步拆分 requirement item');
}
```

## 对下游阶段的硬约束

- `Phase 0.6` 必须消费 baseline 生成 requirement-to-acceptance mapping。
- `Phase 0.7` 必须消费 baseline 为模块指引附加 `relatedRequirementIds` 与 `criticalConstraints`。
- `Phase 1` 与 `Phase 1.3` 必须消费 baseline 生成 traceability 与 out-of-scope 说明。
- `Phase 2` 与 `Phase 3` 必须消费 baseline 生成 `requirement_ids` 与 `critical_constraints`。

## 输出要求

生成后的 Baseline 必须满足：

- 任意一条原始需求都可映射到至少一个 `RequirementItem`
- 不允许存在“未处理但也未显式排除”的需求
- 必须显式记录 `out_of_scope` 与 `partially_in_scope` 的原因
- 必须列出高风险约束，供 spec / plan / review 复用
