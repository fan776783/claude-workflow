---
description: /quick-plan - 轻量快速规划，适用于简单到中等任务。复杂项目请使用 /workflow-plan
argument-hint: <需求描述 | path/to/requirement.md>
---

# /quick-plan - 轻量快速规划

直接产出可执行的实施计划，**不走状态机**，不生成独立 spec。

## 用法

```
/quick-plan "修复登录按钮样式"
/quick-plan "添加新的 API 字段"
/quick-plan docs/requirement.md
```

## 核心原则

- **30 秒目标**：快速完成规划，不走重量级管线
- **不猜测**：不清楚就问，不假设
- **完整可执行**：plan 中每步包含具体文件、代码和验证命令
- **模式引用**：新代码必须与代码库现有模式一致

## 执行流程

### Step 1: 需求理解

1. **解析输入**：
   - `.md` 结尾且文件存在 → 读取文件内容
   - 其他 → 作为内联需求
2. **复杂度评估**：

| 级别   | 信号                 | 范围                       |
| ------ | -------------------- | -------------------------- |
| Small  | 单文件、局部变更     | 1-3 个文件                 |
| Medium | 多文件、遵循现有模式 | 3-10 个文件                |
| Large  | 跨模块、新模式       | 10+ 个文件                 |
| XL     | 架构变更、新子系统   | 建议切换 `/workflow-plan` |

3. **Ambiguity Gate**：以下情况**停止并询问用户**：
   - 核心交付物不明确
   - 成功标准未定义
   - 存在多种合理解读
   - 技术方案有重大未知

### Step 2: 代码库分析

1. 调用 `mcp__auggie-mcp__codebase-retrieval`（单次轻量查询）
2. 识别：
   - 相关现有文件（可复用 / 需修改）
   - 命名规范与代码模式
   - 技术约束
3. 生成 **Mandatory Reading** 列表：

| 优先级 | 文件           | 行范围 | 原因     |
| ------ | -------------- | ------ | -------- |
| P0     | `path/to/file` | 1-50   | 核心模式 |
| P1     | `path/to/file` | 10-30  | 相关类型 |

### Step 3: Plan 生成

产出 `.claude/plans/{kebab-case-name}.plan.md`：

```markdown
# Plan: [功能名称]

## Summary

[2-3 句概述]

## Metadata

- **Complexity**: Small | Medium | Large
- **Confidence**: N/10
- **Estimated Files**: N 个
- **Key Risk**: [主要风险]

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0       | ...  | ...   | ... |

## Patterns to Mirror

### [模式名称]

// SOURCE: [file:lines]
[代码库中的真实代码片段]

---

## Files to Change

| File           | Action        | Justification |
| -------------- | ------------- | ------------- |
| `path/to/file` | CREATE/UPDATE | 说明          |

---

## Tasks

### T1: [名称]

- **Action**: 具体操作
- **File**: `path/to/file`
- **Mirror**: [引用上方的模式]
- **Verify**: [验证命令]

### T2: [名称]

...

---

## Testing Strategy

- [测试计划]

## Risks

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| ...  | ...        | ...        |
```

### Step 4: 用户确认（Hard Stop）

展示 plan 摘要：

- 复杂度 + 信心评分
- 文件数 + 任务数
- 主要风险

展示后调用 `AskUserQuestion` 收集决策，`question` 写"如何处理这份 quick-plan？"，`options` 给三条：

- `confirm` — 确认计划，用户自行执行或交给 `/workflow-execute`
- `revise` — 修改计划，回到 Step 3 根据反馈调整
- `upgrade_workflow_plan` — 切换到 `/workflow-plan` 完整管线（含 spec + 状态机）

收到用户选择前不得继续。

## Confidence Score 规则

| 分数 | 含义                                         |
| ---- | -------------------------------------------- |
| 8-10 | 代码库分析充分，需求清晰，单步可完成         |
| 5-7  | 基本清晰，可能有少量不确定性                 |
| 1-4  | 不确定性较大，**建议切换到 /workflow-plan** |

## 与 workflow 的关系

| 命令              | 适用场景                  | 产物                           |
| ----------------- | ------------------------- | ------------------------------ |
| `/quick-plan`     | 简单/中等任务，快速 plan  | 仅 `plan.md`                   |
| `/workflow-plan` | 复杂/跨模块，需 spec 追溯 | `spec.md` + `plan.md` + 状态机 |

- `/quick-plan` 只生成轻量 `plan.md`，不进入 workflow 状态机。
- `/quick-plan` 不触发 UX 设计审批、需求讨论等 HARD-GATE。
- 如果 `/quick-plan` 过程中发现任务复杂度升到 XL 级，应切换到 `/workflow-plan`。
- 如果用户接受 `/quick-plan` 生成的计划，并希望按 workflow 执行，建议先 `/workflow-plan` 升级为完整工作流（含 spec + 状态机）。直接 `/workflow-execute` 会因缺少 spec 而要求确认降级。
