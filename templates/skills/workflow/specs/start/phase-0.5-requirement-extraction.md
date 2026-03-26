# Phase 0.5: 需求结构化提取 — Extraction Spec

## 目的

从 PRD 中提取结构化的 RequirementItem 列表，按业务场景分组，确保可操作细节不丢失，为 `Phase 0.55 Requirement Baseline` 提供可追溯的输入。

> 本阶段不预设提取维度。模型根据 PRD 内容自行识别业务场景，在 Extraction Spec 约束和 Gate 门禁下完成提取。

## 执行条件

**条件执行**：仅对文件来源且长度 > 500 的需求执行；内联需求或短文本直接跳过此阶段。

```typescript
if (requirementSource !== 'inline' && requirementContent.length > 500) {
  // 执行结构化提取
} else {
  console.log(`⏭️ 跳过（${requirementSource === 'inline' ? '内联需求' : '文本过短'}）\n`);
}
```

---

## RequirementItem 接口

```typescript
interface RequirementItem {
  id: string;                    // R-001, R-002... 稳定 ID
  source_text: string;           // PRD 原文原句（不改写、不缩写）
  summary: string;               // 一句话归纳（供下游快速浏览）
  scenario: string;              // 所属业务场景（模型自行识别）
  scope_owner: 'frontend' | 'backend' | 'shared' | 'product' | 'infra';
  scope_status: 'in_scope' | 'partially_in_scope' | 'out_of_scope' | 'blocked';
  constraints: string[];         // 不可丢失的硬约束
  related_items: string[];       // 关联条目 ID（同场景拆分的其他条目）
  dependency_tags: string[];     // 外部依赖标签（api_spec, external 等）
  risk_of_loss?: string;         // 高丢失风险说明
}
```

---

## 提取行为规则

### 规则 1: 按业务场景分组，不按预设维度

模型自行从 PRD 中识别自然场景边界。**场景** = 用户完成一个完整目标的最小闭环（如"创建工单"、"审批流程"、"数据导出"、"角色权限配置"）。

- 场景名由模型根据 PRD 内容命名，无固定枚举
- 一个 PRD 可能包含 3-20 个场景
- 场景之间可有依赖但不可重叠

### 规则 2: 一条 item = 一个可独立验收的功能点

```
BEFORE finalizing an item:
  Ask: "这条 item 能否写出一个独立的验收用例？"
  IF not:
    → Split into smaller items OR merge into parent item
  IF yes:
    → Accept as-is
```

### 规则 3: 拆分不丢关系

同一 PRD 段落拆出多条 item 时，必须互相填写 `related_items`。

```
BEFORE moving to next paragraph:
  Check: 本段拆出的所有 items 是否已建立 related_items 关联？
  IF not:
    → 补充 related_items 引用
```

跨段但引用同一实体（如同一按钮、同一字段、同一角色）的 items 也必须建立 `related_items` 关联。

### 规则 4: source_text 保真

- `source_text` 必须是 PRD 原文关键句，不做改写
- `summary` 可以缩写但不可改变语义
- 校验规则、提示文案、tooltips 等必须保留原文

### 规则 5: 宁多勿少

宁可提取冗余条目，也不能遗漏需求细节。不确定时拆分为独立条目。

---

## 约束提取 Gate（硬门禁）

### 约束模式表

当 `source_text` 包含以下任一模式时，**必须**提取到 `constraints[]`，否则 Gate B 判定失败：

| 模式 | 示例 |
|------|------|
| 具名 UI 元素 | 按钮名、字段名、Tab 名、列名、区块标题、sheet 命名 |
| 数值边界 | 上限 N 个、最多 M 字符、N 秒超时、文件大小限制 |
| 条件分支 | 如果…则…、当…时…、否则…、仅在…时 |
| 枚举值 | 状态包括：A/B/C、类型分为… |
| 位置/布局 | 左侧、顶部、第 N 行、固定列、底部右侧 |
| 视觉状态 | 置灰、高亮、隐藏、禁用、紫色标记、锁定 |
| 角色限定 | 仅管理员、本人数据、全部数据、仅限创建者 |
| 粒度定义 | XX 粒度、按 XX 维度聚合 |
| 格式规范 | 时间格式、日期格式、数字格式、文件格式 |

---

## 覆盖门禁（自检 Gate）

提取完成后，模型必须执行以下 4 个 Gate 自检。Gate A-C 为硬门禁（不通过必须修正），Gate D 为软门禁（警告但不阻断）。

### Gate A: 原文覆盖率

遍历 PRD 每一段，确认：
- 每个显式功能描述 → 至少对应 1 个 RequirementItem
- 每个条件分支（如果/当/否则） → 至少对应 1 个 RequirementItem
- 每个角色提及 → 至少 1 个 item 标注了对应 scope_owner

```
FAIL condition:
  PRD 中存在超过 2 句连续功能描述未被任何 item 覆盖
```

### Gate B: 约束完整性

遍历所有 items，确认：
- source_text 中含约束模式表所列模式 → `constraints[]` 非空

```
FAIL condition:
  source_text 含硬约束模式但 constraints 为空
```

### Gate C: 关联完整性

- 同段拆分的 items → `related_items` 互相引用
- 跨段但引用同一实体的 items → `related_items` 互相引用

```
FAIL condition:
  2+ items 引用同一实体但无 related_items 关联
```

### Gate D: 粒度检查（软门禁）

- 单条 item 的 `constraints` 超过 5 条 → 建议拆分
- 单条 item 的 `source_text` 超过 200 字 → 建议拆分

```
WARNING（不阻断）:
  提示存在疑似过度聚合条目，建议拆分
```

### 总体覆盖率阈值

```typescript
const prdLineCount = requirementContent.split('\n').length;
const itemCount = requirementItems.length;

if (prdLineCount > 200 && itemCount < 20) {
  console.log(`⚠️ 覆盖率偏低：PRD ${prdLineCount} 行，仅提取 ${itemCount} 条。请检查是否遗漏需求细节。`);
}
```

---

## risk_of_loss 标注建议

若条目满足以下特征，建议写入 `risk_of_loss`：

- 容易被抽象标题吞并
- 很像"展示细节"但其实影响业务逻辑或验收
- 若丢失会导致范围误判或验收不成立
- 同一段原文中同时出现多个 if / then / 展示规则

---

## 实现函数

```typescript
function extractRequirementItems(
  content: string,
  discussionArtifact?: DiscussionArtifact
): RequirementItem[] {
  // 当前模型执行：
  // 1. 通读 PRD，识别自然业务场景
  // 2. 按场景逐段提取 RequirementItem
  // 3. 对包含多个硬约束的条目进一步拆分
  // 4. 为每个 item 生成稳定 ID（R-001, R-002, ...）
  // 5. 建立 related_items 关联
  // 6. 补充 constraints、dependency_tags、risk_of_loss
  //
  // 如果 discussionArtifact 存在：
  // - 将 clarifications 中已确认的信息补充到对应 item
  // - 将 unresolvedDependencies 标记为 dependency_tags
  //
  // 7. 执行 Gate A-D 自检，修正不通过的 Gate

  const items: RequirementItem[] = [];
  return items;
}
```

---

## 可选自检参考

提取完成且通过 Gate A-D 后，可对照以下常见维度查漏补缺。**非强制维度，有则补充，无则跳过，不要为了填满而生造内容。**

- [ ] 表单字段规格（字段名、必填、校验、提示）？
- [ ] 角色权限边界（可见性、可操作性、数据范围）？
- [ ] 交互规范（hover、弹窗、loading、延迟）？
- [ ] 业务规则与约束（唯一性、联动、时间戳判定）？
- [ ] 边界/异常场景（空状态、无权限、超限、降级）？
- [ ] UI 展示差异（不同 Tab/角色/类型下的差异）？
- [ ] 功能流程与入口（多步交互、条件分支、返回位置）？
- [ ] 数据契约/API（端点、模型、字段映射）？
- [ ] 变更记录（版本差异、修订历史）？

---

## 输出要求

生成的 `RequirementItem[]` 必须满足：

- 每条 item 有稳定 ID
- 按业务场景分组（scenario 字段）
- 关联条目通过 related_items 互引
- 高风险需求被拆成独立条目
- 通过 Gate A-D 自检
- 下游可直接将 items 输入 `Phase 0.55 Requirement Baseline`
