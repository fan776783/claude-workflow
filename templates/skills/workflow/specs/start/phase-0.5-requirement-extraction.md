# Phase 0.5: 需求结构化提取详情

## 目的

从 PRD 中提取结构化数据，确保表单字段、角色权限、业务规则等细节不丢失。

## 执行条件

**条件执行**：仅对文件来源且长度 > 500 的需求执行（向后兼容：内联需求 / 短文本自动跳过）

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
  scene: string;          // 所属场景/表单（区分同名字段在不同表单中的规格差异）
  fieldName: string;
  type: string;           // text | textarea | image | select | switch | multi-select
  required: boolean;
  validationRules: string[];
  tooltip?: string;       // 输入框内的默认文案/placeholder
  helperText?: string;    // 常驻提示文案
  validationMessage?: string;  // 校验失败时的提示文案（保留 PRD 原文）
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
  scenarioNotes?: string; // 场景级补充说明（数据归属、条件可见性等）
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
  condition?: string;     // 触发条件（所处页面/Tab/权限状态等前提）
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
  context?: string;       // 发生在哪个页面/组件
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
  context: string;        // 页面/Tab/组件
  rule: string;           // 展示规则描述
  detail: string;         // 具体差异说明
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
  name: string;           // 流程名称
  steps: string[];        // 步骤序列
  conditionalPaths?: string[];  // 条件分支
  entryPoints?: string[];      // 触发该流程的入口路径
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
  name: string;           // 接口/模型名称
  type: string;           // api_endpoint | data_model | field_mapping | config
  spec: string;           // 规格描述（方法+路径、字段定义、映射关系等）
  constraints?: string;   // 约束说明（必填、类型、范围等）
}>
```

## 提取原则

⚠️ **宁多勿少**：宁可提取冗余条目，也不能遗漏需求细节
⚠️ **按场景分组**：同一字段在不同场景下的规则差异必须分别记录
⚠️ **保留原文**：校验规则、提示文案、tooltips 等必须保留 PRD 原文，不可改写
⚠️ **穷举校验**：每个场景的必填字段缺失组合及对应提示文案都要记录到 formFields.validationMessage

## 实现函数

```typescript
function extractStructuredRequirements(content: string): RequirementAnalysis {
  // 当前模型执行：逐维度扫描 PRD 原文，提取结构化数据
  // 按每个维度的匹配模式逐段扫描，将匹配到的内容填入对应数组，空维度保持 []

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
  };

  // 提取指令（每个维度）：
  // 1. changeRecords → { id, version, description, changedFields[], ruleChange }
  // 2. formFields → { scene, fieldName, type, required, validationRules[], tooltip, helperText, validationMessage }
  //    ⚠️ 对每个表单场景分别提取，scene 字段标识所属场景
  // 3. rolePermissions → { role, permissions[], restrictions[], scenarioNotes }
  // 4. interactions → { trigger, element, behavior, message, condition }
  // 5. businessRules → { id, condition, expectedBehavior, relatedFields[] }
  // 6. edgeCases → { scenario, expectedDisplay, fallbackBehavior, context }
  // 7. uiDisplayRules → { context, rule, detail }
  // 8. functionalFlows → { name, steps[], conditionalPaths[], entryPoints[] }
  // 9. dataContracts → { name, type, spec, constraints }

  return analysis;
}
```

## 覆盖率验证

```typescript
// 覆盖率验证：PRD 行数 vs 提取条目数
const prdLineCount = requirementContent.split('\n').length;
const totalExtracted = dimensions.reduce((sum, d) => sum + (requirementAnalysis[d.key]?.length || 0), 0);
const emptyDimensions = dimensions.filter(d => (requirementAnalysis[d.key]?.length || 0) === 0);

const coverageWarning = (prdLineCount > 200 && totalExtracted < 20)
  ? `\n⚠️ 覆盖率偏低：PRD ${prdLineCount} 行，仅提取 ${totalExtracted} 条。请检查是否遗漏需求细节。`
  : '';

const emptyWarning = emptyDimensions.length > 3
  ? `\n⚠️ ${emptyDimensions.length} 个维度为空（${emptyDimensions.map(d => d.label).join('、')}），请确认 PRD 是否涉及这些维度。`
  : '';
```

## 输出

结构化需求将用于：
- Phase 0.6: 生成验证清单
- Phase 1: 技术方案生成（填充"需求详情"章节）
- Phase 2: 任务生成（关联验收项）
