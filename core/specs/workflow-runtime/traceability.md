# Traceability 参考定义

## 目的

定义 workflow 中的需求追溯模型。在简化的三层架构（requirement baseline → spec → plan → 执行）中，先用 requirement baseline 保留原始需求细节，再在 spec 内部完成结构化追溯，plan 通过 requirement_ids + spec section ref 建立引用关系。

## 术语

**Requirement Baseline（需求保真层）**：在 spec 生成前从完整需求文档中抽出的结构化 requirement units，是原始需求的第一层持久化表达。每条 requirement baseline item 除了摘要外，还保留 `source_excerpt`、`must_preserve`、`acceptance_signal`、`spec_targets` 等字段，用于防止细节在后续 spec / plan 生成时被压缩丢失。

**Requirement（需求条目）**：spec.md 的 Scope 章节中的编号条目（R-001 起），是最小可追溯的需求单位。每条需求包含 ID、摘要、范围状态、约束和所有者。字段定义见下方表格。

### Spec Section Ref

plan 步骤对 spec 章节的引用，用于在执行后的 Spec 合规review中对照检查。

**格式规范**：`§` 前缀 + spec 章节编号（按 markdown 标题顺序，1-indexed）。嵌套用点分隔。

| 格式 | 含义 | 示例 |
|------|------|------|
| `§N` | 顶级章节（`## N. Title`） | `§2` = Scope 章节 |
| `§N.M` | 嵌套子章节 | `§5.1` = User-facing Behavior 的第 1 个子节 |

**验证规则**：Self-Review 和 Spec 合规review时，所有 `§X.X` 引用必须能映射到 spec.md 中实际存在的 markdown 标题。无法映射的引用视为 Plan 缺陷。

### Acceptance Criteria

spec.md 的 Acceptance Criteria 章节中按module组织的验收条件，供 Spec 合规review子 Agent 使用。

### Requirement Baseline Item

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 需求 ID（R-001 起） |
| `source_excerpt` | string | 原始需求片段 |
| `normalized_summary` | string | 便于下游消费的摘要 |
| `type` | `functional / ux / logic / edge_case / constraint / unresolved` | 需求类型 |
| `scope_status` | `in_scope / out_of_scope / blocked / undecided` | 初始范围判定 |
| `must_preserve` | boolean | 是否必须在 spec / plan 中保留 |
| `acceptance_signal` | string? | 后续如何验证该需求 |
| `spec_targets` | string[] | 预期应落入的 spec 章节 |

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
| `spec_ref` | string | §X.X 章节引用 |
| `requirement_ids` | string[] | R-001, R-002 |
| `files` | string[] | 涉及文件 |
| `steps[].description` | string | 步骤描述 |
| `steps[].verification` | string? | 验证命令 |
| `steps[].expected` | string? | 预期结果 |

## scope_status 定义

### in_scope

当前workflow明确承接，必须在 spec 的 Architecture / Acceptance 章节有设计和验收对应。

### out_of_scope

当前workflow明确不承接，必须在 Scope 章节的 Out of Scope 表格中写明排除原因。

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
- Requirement Traceability 表必须覆盖所有 in_scope 需求
- 所有 must_preserve 需求必须出现在 Requirement Baseline Snapshot、Critical Constraints to Preserve 或 Raw Requirement Nuances 中
- 所有 out_of_scope / blocked 需求必须有排除原因
- 所有 constraints 必须出现在 Constraints 章节

### Plan Gate（Self-Review 阶段）

在 plan 生成后的 Self-Review 中执行：

- 所有 in_scope 需求至少映射到一个 plan task（通过 spec_ref / requirement_ids）
- Requirement Coverage 表必须列出所有 in_scope requirement 的任务承接关系
- 所有 must_preserve 细节必须在 task、critical_constraints 或 verification 中可见
- 所有 plan step 包含完整代码（No Placeholders）

### Execution Gate（执行期规格对照检查）

在满足review触发条件时执行规格对照检查：

- `quality_review` action → 进入完整两阶段review的 Stage 1：Spec 合规review
- 连续 3 个常规 task → 执行轻量合规检查
- 最后一个 task → 在最终全量review中执行 Spec 合规review

所有场景都应检查：

- 代码是否匹配 spec 描述的行为
- spec Constraints 是否被正确实现
- spec Acceptance Criteria 是否满足
