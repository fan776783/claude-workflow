---
name: quick-plan
description: "轻量快速规划 - 适用于简单到中等任务,直接产出可执行的 plan.md,不走 workflow 状态机。触发条件:用户说「快速规划」「轻规划」「不走workflow」「plan 一下」「quick plan」,或需求清晰、作用域明确、可一次性规划完成。复杂项目(跨module / 新子系统 / 需追溯)请使用 /workflow-spec。"
argument-hint: <需求描述 | path/to/requirement.md>
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:单行 typo 级修复直接改,无需 plan。
</PRE-FLIGHT>

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

## 执行workflow

### Step 1: 需求理解

1. **解析输入**：
   - `.md` 结尾且文件存在 → 读取文件内容
   - 其他 → 作为内联需求
2. **复杂度评估**：见 [references/complexity-scoring.md](references/complexity-scoring.md)
3. **Ambiguity Gate**：以下情况**停止并询问用户**：
   - 核心交付物不明确
   - 成功标准未定义
   - 存在多种合理解读
   - 技术方案有重大未知

   复杂需求(非 typo 级)建议先走 `/grill` 做一轮对齐再回本 skill。

### Step 2: 代码库分析

1. 调用 `mcp__auggie-mcp__codebase-retrieval`（单次轻量查询）
2. 识别：
   - 相关现有文件（可复用 / 需修改）
   - 命名规范与代码模式
   - 技术约束
3. 生成 **Mandatory Reading** 列表：

| 优先级 | 文件 | 行范围 | 原因 |
| ------ | ---- | ------ | ---- |
| P0 | `path/to/file` | 1-50 | 核心模式 |
| P1 | `path/to/file` | 10-30 | 相关类型 |

### Step 3: Plan 生成

产出 `.claude/plans/{kebab-case-name}.plan.md`。模板见 [references/plan-template.md](references/plan-template.md)。

### Step 4: 展示摘要并退让

展示 plan 摘要（复杂度 + 信心评分 + 文件数 / 任务数 + 主要风险），然后用自然语言告诉用户：

> plan 已生成到 `.claude/plans/<name>.plan.md`。
> - 要直接执行 → 自行实施或交给 `/workflow-execute`（先注意下面的注意）
> - 要修改 plan → 告诉我反馈，我调整
> - 要升级到完整workflow（spec + 状态机 + 追溯）→ `/workflow-spec`

**不调 AskUserQuestion**。用户直接回复告诉下一步即可。

## Confidence 规则

| 分数 | 含义 |
| ---- | ---- |
| 8-10 | 代码库分析充分，需求清晰，单步可完成 |
| 5-7 | 基本清晰，可能有少量不确定性 |
| 1-4 | 不确定性较大，**建议切换到 `/workflow-spec`** |

## 与 workflow 的关系

| 命令 | 适用场景 | 产物 |
| ---- | -------- | ---- |
| `/quick-plan` | 简单 / 中等任务，快速 plan | 仅 `plan.md` |
| `/workflow-spec` | 复杂 / 跨module，需 spec 追溯 | `spec.md` + `plan.md` + 状态机 |

- `/quick-plan` 只生成轻量 `plan.md`，不进入 workflow 状态机
- `/quick-plan` 不触发 UX 设计审批、需求讨论等 HARD-GATE
- 过程中发现任务复杂度升到 XL 级 → 切换到 `/workflow-spec`
- 接受 plan 后想按 workflow 执行 → 建议先 `/workflow-spec` 升级为完整workflow（含 spec + 状态机）。直接 `/workflow-execute` 会因缺少 spec 而要求确认降级

## 与其他 skill 的关系

- 需求模糊 → 先 `/grill` 对齐再回本 skill
- 需要调研外部方案 / 找现成库 → 先 `/research`
- 生成 plan 后要沉淀规范 → `/spec-update`
