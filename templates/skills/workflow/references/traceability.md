# Traceability 参考定义

## 目的

定义 workflow 中的需求追溯模型。在简化的三层架构（spec → plan → 执行）中，需求追溯在 spec 内部完成，plan 通过 spec section ref 建立引用关系。

## 术语

**Requirement（需求条目）**：spec.md 的 Scope 章节中的编号条目（R-001 起），是最小可追溯的需求单位。每条需求包含 ID、摘要、范围状态、约束和所有者。字段定义见下方表格。

### Spec Section Ref

plan 步骤对 spec 章节的引用（如 §5.1），用于在执行后的 Spec 合规审查中对照检查。

### Acceptance Criteria

spec.md 的 Acceptance Criteria 章节中按模块组织的验收条件，供 Spec 合规审查子 Agent 使用。

### Requirement（spec.md 中的需求条目）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 需求 ID（R-001 起） |
| `summary` | string | 面向下游的短描述 |
| `scope_status` | `in_scope / out_of_scope / blocked` | 范围判定 |
| `constraints` | string[] | 硬约束 |
| `owner` | `frontend / backend / shared / infra` | 所有者 |
| `exclusion_reason` | string? | out_of_scope / blocked 的原因 |

### PlanTask（plan.md 中的任务条目）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 任务名称 |
| `specRef` | string | §X.X 章节引用 |
| `requirementIds` | string[] | R-001, R-002 |
| `files` | string[] | 涉及文件 |
| `steps[].description` | string | 步骤描述 |
| `steps[].verifyCommand` | string? | 验证命令 |
| `steps[].expectedResult` | string? | 预期结果 |

## scope_status 定义

### in_scope

当前工作流明确承接，必须在 spec 的 Architecture / Acceptance 章节有设计和验收对应。

### out_of_scope

当前工作流明确不承接，必须在 Scope 章节的 Out of Scope 表格中写明排除原因。

### blocked

理论上在范围内但受外部依赖阻塞，必须在 Blocked 表格中写明依赖和说明。

## Critical Constraints 规则

以下内容若在原始需求出现，必须提取到 spec 的 Constraints 章节：

- 具体按钮文案、字段名、tab 名、区块名
- 精确条件分支与状态判断
- 数量上限、字符限制、时间规则、排序规则
- UI 位置、显隐逻辑、视觉状态
- 角色边界、数据归属边界、接口依赖边界

## Traceability Gate 规则

### Spec Gate（Self-Review 阶段）

在 spec 生成后的 Self-Review 中执行：

- 所有 in_scope 需求必须在 Architecture / Acceptance 章节有对应内容
- 所有 out_of_scope / blocked 需求必须有排除原因
- 所有 constraints 必须出现在 Constraints 章节

### Plan Gate（Self-Review 阶段）

在 plan 生成后的 Self-Review 中执行：

- 所有 in_scope 需求至少映射到一个 plan task（通过 specRef / requirementIds）
- 所有 plan step 包含完整代码（No Placeholders）

### Execution Gate（子 Agent Spec 合规审查）

在满足审查触发条件时（quality_review action / 连续 3 个常规 task / 最后 task）由 Spec 合规审查子 Agent 执行：

- 代码是否匹配 spec 描述的行为
- spec Constraints 是否被正确实现
- spec Acceptance Criteria 是否满足
