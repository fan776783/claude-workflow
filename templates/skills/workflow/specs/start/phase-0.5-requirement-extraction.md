# Phase 0.5: 需求结构化提取详情

## 目的

从 PRD 中提取结构化数据，确保表单字段、角色权限、业务规则等细节不丢失，并为 `Phase 0.55 Requirement Baseline` 提供可归一化的 requirement item 输入。

## 执行条件

**条件执行**：仅对文件来源且长度 > 500 的需求执行；内联需求或短文本直接跳过此阶段。

```typescript
if (requirementSource !== 'inline' && requirementContent.length > 500) {
  // 执行结构化提取
} else {
  console.log(`⏭️ 跳过（${requirementSource === 'inline' ? '内联需求' : '文本过短'}）\n`);
}
```

## 提取维度（9 维度）

### 1. 变更记录

扫描版本变更/修改历史/changelog 标记（如 "变更01" / "V2.x" / "修订"）

```typescript
changeRecords: Array<{
  id: string;
  version: string;
  description: string;
  changedFields: string[];
  ruleChange?: string;
}>
```

### 2. 表单字段（按场景分组）

**关键**：同名字段在不同表单/场景下的规格可能不同（字符限制、必填规则等）

**扫描策略**：
1. 先识别所有表单/弹窗场景
2. 对每个场景逐一提取字段（输入框/选择器/上传框/开关）
3. 每个字段记录：scene + fieldName + type + required + validationRules + tooltip + helperText
4. 特别关注：字符限制、超出行为（禁止输入 vs 可输入但保存报错）、文件格式/大小限制
5. 必填规则差异：单字段必填 vs "N选一必填"
6. 校验失败提示：每个字段校验失败时的 tooltip/message 记入 validationMessage

```typescript
formFields: Array<{
  scene: string;
  fieldName: string;
  type: string;
  required: boolean;
  validationRules: string[];
  tooltip?: string;
  helperText?: string;
  validationMessage?: string;
}>
```

### 3. 角色权限

扫描角色权限差异（角色名 + 可见/不可见/可编辑/禁用）

**关键**：不同角色在同一功能上的行为差异要逐一记录
- 操作按钮的可见性（按角色 + 数据归属）
- "仅限自己创建的" vs "所有数据" 的权限边界
- 按钮不可用时是"不展示"还是"置灰"
- 页面/功能的准入权限

```typescript
rolePermissions: Array<{
  role: string;
  permissions: string[];
  restrictions: string[];
  scenarioNotes?: string;
}>
```

### 4. 交互规格

扫描交互规格描述（hover/tooltip/弹窗/确认/loading/错误提示）

**关键**：
1. 延迟参数（hover 延迟、防抖等）
2. 条件交互（权限/状态/数据归属等前提条件）
3. 弹窗层级和关闭后返回位置
4. 列表排序规则（新增数据的位置、默认排序字段和方向）
5. 展开/收起/折叠逻辑
6. 固定/吸附/悬浮位置规则

```typescript
interactions: Array<{
  trigger: string;
  element: string;
  behavior: string;
  message?: string;
  condition?: string;
}>
```

### 5. 业务规则

扫描条件逻辑（"如果...则..." / "当...时..." / "必须" / "不允许"）

**关键**：
1. 唯一性校验范围（全局唯一 vs 某作用域内唯一）
2. 联动规则（A 变更时 B 如何响应）
3. 时间戳判定规则（何种操作算"更新"、何种不算）
4. 删除/禁用的影响范围（是否影响已引用数据）
5. 跨类目/跨分组的交叉选择规则
6. 组合校验规则（多字段联合校验条件及对应提示文案）

```typescript
businessRules: Array<{
  id: string;
  condition: string;
  expectedBehavior: string;
  relatedFields: string[];
}>
```

### 6. 边界场景

扫描边界/异常场景（未开通/无权限/为空/超出/不存在/降级）

**关键**：同一空状态/异常在不同上下文的展示可能不同（文案、按钮、图标差异）

```typescript
edgeCases: Array<{
  scenario: string;
  expectedDisplay: string;
  fallbackBehavior?: string;
  context?: string;
}>
```

### 7. UI 展示规则

扫描 UI 展示差异（不同 Tab/页面/角色/数据类型下的列、字段、按钮差异）

**关键**：
1. 不同 Tab/分类下列表列的增减差异
2. 空值/未上传时的缺省展示
3. 文本截断规则（超出后省略号/换行/tooltip）
4. 固定列/吸附列规则
5. 时间/日期的格式规范
6. 多行信息的展示格式（如姓名+账号的排列方式）
7. 跨业务类型的兼容差异（同一功能在不同业务线的展示区别）

```typescript
uiDisplayRules: Array<{
  context: string;
  rule: string;
  detail: string;
}>
```

### 8. 功能流程（含入口路径）

扫描多步交互流程、条件分支路径、以及触发该流程的所有入口

**关键**：
1. 创建/添加操作的完整步骤（含前置选择）
2. 成功/失败后的页面跳转或状态变化
3. 编辑场景中嵌套的删除/重置流程
4. 复制/克隆操作的字段继承规则（哪些带入、哪些清空）
5. 上传/删除等子流程（是否有二次确认）
6. entryPoints：同一功能可能从不同页面/按钮触发，关闭后返回位置也不同

```typescript
functionalFlows: Array<{
  name: string;
  steps: string[];
  conditionalPaths?: string[];
  entryPoints?: string[];
}>
```

### 9. 数据契约（API/后端类 PRD）

扫描 API 端点、数据模型、字段映射、配置项等结构化定义

**关键**：
1. API 端点（方法 + 路径 + 请求/响应结构）
2. 数据模型（表结构 / DTO / VO 的字段定义）
3. 字段映射关系（前端字段名 ↔ 后端字段名）
4. 枚举值/状态码定义
5. 配置项及默认值

```typescript
dataContracts: Array<{
  name: string;
  type: string;
  spec: string;
  constraints?: string;
}>
```

## RequirementItem 归一化输出

除上述 9 个维度外，本阶段还必须输出一个可供 `Phase 0.55` 消费的归一化 requirement item 列表。此列表不是最终 baseline，而是 baseline 的直接输入。

### RequirementItem

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
}
```

### 归一化目标

- 让长 PRD 中的“细节需求”从维度型提取结果中被重新组织为逐条 requirement item
- 为 baseline / acceptance / spec / plan 提供统一 requirement IDs
- 让高风险需求在后续文档中不再依赖摘要质量“碰运气”保留

### 拆分规则

以下情况必须拆成独立 requirement item，而不能只保留在同一功能块下：

- 明确按钮文案、列名、sheet 命名、字段名
- 精确条件分支（有数据 / 无数据、需要 / 不需要、仅在...时）
- 排序、位置、显隐、颜色状态、主体标识等 UI 规则
- 导出规则、报表规则、对比口径、粒度定义
- 权限边界、数据归属边界、依赖边界

### risk_of_loss 标注建议

若条目满足以下特征，建议写入 `risk_of_loss`：

- 容易被抽象标题吞并
- 很像“展示细节”但其实影响业务逻辑或验收
- 若丢失会导致范围误判或验收不成立
- 同一段原文中同时出现多个 if / then / 展示规则

## 提取原则

⚠️ **宁多勿少**：宁可提取冗余条目，也不能遗漏需求细节  
⚠️ **按场景分组**：同一字段在不同场景下的规则差异必须分别记录  
⚠️ **保留原文**：校验规则、提示文案、tooltips 等必须保留 PRD 原文，不可改写  
⚠️ **穷举校验**：每个场景的必填字段缺失组合及对应提示文案都要记录到 `formFields.validationMessage`  
⚠️ **高风险条目单列**：按钮、导出、条件分支、位置与视觉状态等容易丢失的信息必须拆成独立 requirement item

## 实现函数

```typescript
function extractStructuredRequirements(
  content: string,
  discussionArtifact?: DiscussionArtifact
): RequirementAnalysis {
  // 当前模型执行：逐维度扫描 PRD 原文，提取结构化数据
  // 按每个维度的匹配模式逐段扫描，将匹配到的内容填入对应数组，空维度保持 []
  //
  // 如果 discussionArtifact 存在：
  // - 将 clarifications 中已确认的信息补充到对应维度
  // - 将 unresolvedDependencies 中的 api_spec 补充到 dataContracts（标记为待确认）

  const analysis: RequirementAnalysis = {
    changeRecords: [],
    formFields: [],
    rolePermissions: [],
    interactions: [],
    businessRules: [],
    edgeCases: [],
    uiDisplayRules: [],
    functionalFlows: [],
    dataContracts: [],
    requirementItems: []
  };

  return analysis;
}
```

```typescript
function normalizeRequirementItems(params: {
  requirementAnalysis: RequirementAnalysis;
  requirementContent: string;
  discussionArtifact?: DiscussionArtifact;
}): RequirementItem[] {
  const items: RequirementItem[] = [];

  // 1. 先把 9 维度中的条目转换为统一 requirement item
  // 2. 对包含多个高风险细节的条目进一步拆分
  // 3. 为每个 item 生成稳定 ID（R-001, R-002, ...）
  // 4. 补充 critical_constraints、dependency_tags、risk_of_loss
  // 5. 输出给 Phase 0.55 做最终 baseline 判定

  return items;
}
```

## 覆盖率验证

```typescript
const prdLineCount = requirementContent.split('\n').length;
const totalExtracted = dimensions.reduce((sum, d) => sum + (requirementAnalysis[d.key]?.length || 0), 0);
const itemCount = requirementAnalysis.requirementItems?.length || 0;
const emptyDimensions = dimensions.filter(d => (requirementAnalysis[d.key]?.length || 0) === 0);

const coverageWarning = (prdLineCount > 200 && totalExtracted < 20)
  ? `\n⚠️ 覆盖率偏低：PRD ${prdLineCount} 行，仅提取 ${totalExtracted} 条。请检查是否遗漏需求细节。`
  : '';

const itemWarning = (prdLineCount > 200 && itemCount < 12)
  ? `\n⚠️ RequirementItem 数量偏低：长 PRD 仅归一化 ${itemCount} 条，可能存在过度聚合。`
  : '';
```

## 输出要求

生成的 `requirementAnalysis` 必须满足：

- 9 个维度保持兼容
- 新增 `requirementItems` 作为归一化输出
- 高风险需求被拆成独立条目
- 下游可直接将 `requirementItems` 输入 `Phase 0.55 Requirement Baseline`
