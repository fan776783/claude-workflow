# Traceability 参考定义

## 目的

定义 workflow 中的需求追溯模型。追溯链（已机器化）：

```text
原始需求 → cmdPlan 提取 requirement items（编 R-NNN）→ spec.md §2.1 In Scope（`- R-001: ...`）
        → spec-approve 落 task 壳（壳带 requirement_ids，1:1 预填）
        → /workflow-plan task-write 重切（每 task 承接 requirement_ids，可多对一）
        → plan-review coverage 比对（spec §2.1 R-ID vs task.json requirement_ids 并集）
        → confidence PRD 维度计分（covered/uncovered 比率）
```

coverage 为 **advisory**（不挡 ready），uncovered_ids 供人工确认是否故意不承接。

## 术语

**Requirement（需求条目）**：spec.md §2.1 In Scope 中的编号条目（`R-001` 起），是最小可追溯的需求单位。由 CLI `plan` 命令从原始需求提取并编号（`extractRequirementItems` → 渲染进 spec 骨架 `{{scope_summary}}`），每条含 ID、摘要、范围状态、约束、所有者。

**requirement_ids（task 承接字段）**：task.json 的 `requirement_ids: string[]`（schema 见 [`task-dir-schema.md`](task-dir-schema.md)）。spec-approve 壳按需求 1:1 预填；`/workflow-plan` 现写重切时必须把全部 in-scope R-ID 分配到新 task 集。`plan-review` 的 coverage / confidence PRD 维度只认这个字段。

### Spec Section Ref

plan / task 对 spec 章节的引用，用于执行后的 Spec 合规 review 对照检查。

**格式规范**：`§` 前缀 + spec 章节编号（按 markdown 标题顺序，1-indexed）。嵌套用点分隔。

| 格式 | 含义 | 示例 |
|------|------|------|
| `§N` | 顶级章节（`## N. Title`） | `§2` = Scope 章节 |
| `§N.M` | 嵌套子章节 | `§5.1` = User-facing Behavior 的第 1 个子节 |

**验证规则**：所有 `§X.X` 引用必须能映射到 spec.md 中实际存在的 markdown 标题。无法映射的引用视为 Plan 缺陷。

### Requirement 字段（cmdPlan 提取的 requirement item）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 需求 ID（R-001 起） |
| `normalized_summary` | string | 面向下游的短描述 |
| `type` | `functional / ux / logic / edge_case / constraint` | 需求类型（推断） |
| `scope_status` | `in_scope / out_of_scope / blocked` | 范围判定 |
| `constraints` | string[] | 硬约束 |
| `owner` | `frontend / backend / shared` | 所有者（推断） |
| `must_preserve` | boolean | 高风险需求标记 → task 壳 `quality_gate` |
| `acceptance_signal` | string? | 后续如何验证该需求 → 壳 `acceptance` |

## scope_status 定义

### in_scope

当前workflow明确承接，必须在 spec 的 Architecture / Acceptance 章节有设计和验收对应；进入 coverage 比对分母。

### out_of_scope

当前workflow明确不承接，必须在 Scope 章节的 Out of Scope 表格中写明排除原因；**不**进入 coverage 比对（F-07）。

### blocked

理论上在范围内但受外部依赖阻塞，必须在 Blocked 表格中写明依赖和说明；不进入 coverage 比对。

## Critical Constraints 规则

以下内容若在原始需求出现，必须提取到 spec 的 Constraints 章节：

- 具体按钮文案、字段名、tab 名、区块名
- 精确条件分支与状态判断
- 数量上限、字符限制、时间规则、排序规则
- UI 位置、显隐逻辑、视觉状态
- 角色边界、数据归属边界、接口依赖边界

## Traceability Gate 规则

### Spec Gate（workflow-spec Step 4 Self-Review）

- 所有 in_scope 需求必须在 Architecture / Acceptance 章节有对应内容
- 所有 must_preserve 约束必须出现在 §3 Constraints
- 所有 out_of_scope / blocked 需求必须有排除原因

### Plan Gate（plan-review CLI）

- coverage：所有 in_scope R-ID 应被至少一个 task 的 `requirement_ids` 承接（advisory；uncovered 列给人审）
- partial：spec 多处提及但仅 1 个 task 承接 → PRD 维度扣 1 分
- 所有 must_preserve 细节必须在 task 的 `constraints` / `acceptance` / `verification` 中可见
- No Placeholders（`lintPlaceholder` hard-block）

### Execution Gate（执行期规格对照检查）

执行期规格对照由 workflow-execute 的两道既有质量门承接（无独立 cadence）：

- **per-task reviewer Phase 1**（每 task 必跑）→ AC 覆盖 / 超额 / 关键约束对照
- **末尾 final reviewer**（HARD-GATE #4）→ 整 branch diff 两 phase：phase1 对照 spec 成功标准 + 全部 AC；phase2 fresh regression hunt（新引入缺陷 + 跨 task contract 一致性，受已知问题排除清单约束、branch 视角升级项仍须上报，细则见 workflow-execute `prompts/reviewer.md`「末尾 final-review 形态」）

两道门都应检查：

- 代码是否匹配 spec 描述的行为
- spec Constraints 是否被正确实现
- spec Acceptance Criteria 是否满足
