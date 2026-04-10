---
name: quick-plan
description: "轻量快速规划 - 4 步完成实施计划，适用于简单到中等复杂度的任务。触发条件：用户调用 /quick-plan，或请求快速规划、制定方案等。此命令不走状态机，不生成 spec，直接产出可执行的 plan.md。"
---

# 轻量快速规划

## 用法

`/quick-plan <需求描述 | path/to/requirement.md>`

直接产出可执行的实施计划，**不走状态机**，不生成独立 spec。

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
| XL     | 架构变更、新子系统   | 建议切换 `/workflow plan` |

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

用户选择：

1. **确认** → 用户自行执行或交给 `/workflow execute`
2. **修改** → 回到 Step 3 调整
3. **切换到 /workflow plan** → 用户明确需要完整管线

## Confidence Score 规则

| 分数 | 含义                                         |
| ---- | -------------------------------------------- |
| 8-10 | 代码库分析充分，需求清晰，单步可完成         |
| 5-7  | 基本清晰，可能有少量不确定性                 |
| 1-4  | 不确定性较大，**建议切换到 /workflow plan** |

## 与 workflow 的关系

- `/quick-plan` 是轻量规划入口：只产出 `plan.md`，不进入状态机。
- `/workflow plan` 是完整规划入口：会生成 `spec.md`、`plan.md` 并写入 workflow 状态。
- 若 `/quick-plan` 在分析过程中发现任务升级为跨模块/高不确定性场景，应改走 `/workflow plan`。
- 若用户确认了 `/quick-plan` 生成的计划并希望继续按 workflow 推进，可转到 `/workflow execute`。

## 注意

- `/quick-plan` 不走状态机，不生成 `workflow-state.json`
- `/quick-plan` 不触发 UX 设计审批、需求讨论等 HARD-GATE
- 如果 plan 产出后用户希望走正式流程，可以 `/workflow plan` 重新启动
