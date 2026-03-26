---
name: workflow
description: "智能工作流系统 - 需求讨论、需求分析、Spec/Plan 规划与自动化执行。显式调用：/workflow action [args]。Actions: start（启动规划）、execute（执行任务）、delta（增量变更/API同步）、status（查看状态）、archive（归档）。此 skill 不会自动触发，需用户明确调用。支持执行纪律强化（两阶段代码审查、结构化调试协议、TDD 执行纪律）、交互式需求讨论（Phase 0.2）、Requirement Baseline + Traceability Review、Acceptance & Implementation Brief，以及 Spec Review / Plan Review 双重质量门槛。"
---

# 智能工作流系统

结构化开发工作流：需求分析 → 需求讨论 → 需求结构化 → Requirement Baseline → 技术设计 → Spec 生成 → Plan 生成 → 任务编排 → 自动执行。

## 设计理念

```
workflow（功能/数据/执行）  ──▶  figma-ui（视觉）  ──▶  visual-diff（验证）
           │
      api_spec 阻塞
```

**职责分离**：`workflow` 专注业务逻辑、设计规范、实现计划和执行编排，只阻塞 API / 外部依赖。设计稿还原通过独立的 `/figma-ui` skill 处理。

## Traceability-first 原则

`workflow` 的默认约束不再只是“文档写完整”，而是“原始需求能够被持续追溯”。

当执行阶段需要**并行分派独立任务 / 问题域**时，必须先读取并应用 `../dispatching-parallel-agents/SKILL.md`，由该 skill 统一负责平台检测、独立性检查、上下文边界分组、最小上下文封装、结果回收与冲突降级。

- **Requirement Baseline 是需求真相源**：长 PRD 先归一化为 requirement items，再由后续文档消费。
- **显式范围判定**：每条需求都必须标记 `in_scope / partially_in_scope / out_of_scope / blocked`。
- **关键约束显式保留**：按钮文案、字段名、sheet 命名、条件分支、数量限制、显隐规则等必须进入 traceability 链路。
- **下游不得自由丢失需求**：`acceptance checklist`、`implementation guide`、`tech-design`、`spec`、`plan`、`tasks` 都必须消费 baseline，而不是重新自由摘要 PRD。
- **Review 检查是否漏需求**：Spec Review / Plan Review 升级为“结构审查 + 追溯审查 + 关键约束审查”。

详见 `references/traceability.md`。

## 核心规划模型

`workflow` 现在采用五层规划工件：

- **基线层**：`requirement-baseline.md`
  - 聚焦 requirement IDs、scope status、critical constraints、out-of-scope 与 blocked 条目
  - 是所有后续工件共享的需求真相源
- **设计层**：`tech-design.md`
  - 聚焦架构决策、系统边界、关键风险、技术约束
  - 必须显式体现 Requirement Traceability
- **规范层**：`spec.md`
  - 聚焦最终范围、用户行为、模块划分、文件结构、验收映射
  - 是 `plan.md` 的权威上游
- **计划层**：`plan.md`
  - 聚焦实施顺序、原子步骤、验证命令、质量要求
  - 是 `tasks.md` 的直接编译输入
- **编排层**：`tasks.md`
  - 聚焦运行时执行、依赖推进、质量关卡、提交节点
  - 必须保留 `requirement_ids` 与关键约束映射

## 执行纪律

执行阶段的质量保障机制：

- **两阶段代码审查** — 质量关卡升级为 Stage 1（规格合规）+ Stage 2（代码质量），问题分 Critical/Important/Minor 三级，共享 4 次总预算
- **结构化调试协议** — 任务失败重试前强制四阶段调试（根因调查 → 模式分析 → 假设验证 → 实施修复），3 次失败触发 Hard Stop
- **TDD 执行纪律** — Brief 存在时，代码产出任务强制 Red-Green-Refactor 循环
- **审查反馈处理协议** — READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT
- **验证门控函数** — IDENTIFY → RUN → READ → VERIFY → ONLY THEN claim
- **自审查步骤** — Step 6.6 单次建议性自审查，在验证和合规检查之间
- **追溯守卫** — 任何执行任务或质量关卡都应能回溯到 requirement IDs 与 critical constraints

### Post-Execution Pipeline

```
executeTask() → Step 6.5（验证铁律 + Gate Function）→ Step 6.6（自审查）→ Step 6.7（规格合规）→ Step 7（更新状态）
```

质量关卡任务的 `quality_review` action 内部包含两阶段审查，详见 `specs/execute/actions/quality-review.md`。

## 子 Agent 路由

执行阶段支持平台感知的子 agent 路由。

当需要对**同阶段 2+ 独立任务**启用并行子 agent 时，**必须先读取并应用** `../dispatching-parallel-agents/SKILL.md`，再根据其中的规则执行：

- **Claude Code / Cursor**：使用 `Task` 风格子 agent 执行独立任务与并行批次
- **Codex**：将 skill 中的子 agent 抽象映射到 `spawn_agent` / `wait` / `close_agent`
- **不支持子 agent 的平台**：自动降级为当前会话顺序执行

**使用原则**：

- 仅在任务彼此独立、无共享状态、不会编辑同一文件组时启用并行
- 每个子 agent 只接收当前任务所需的最小上下文，不继承主会话历史
- 子 agent 返回后，主会话负责验证、冲突检测、状态更新与下一步路由
- 同阶段多任务场景优先按上下文边界分组，而不是按角色分工

## 需求讨论（Phase 0.2）

在代码分析（Phase 0）之后、需求结构化提取（Phase 0.5）之前的交互式需求讨论阶段：

- **自动识别 Gap** — 基于代码分析结果，检测需求中的模糊点、缺失项和隐含假设
- **逐个澄清** — 每次只问一个问题，优先选择题，支持跳过和结束
- **方案探索** — 存在互斥实现路径时，提出 2-3 种方案供对比选择
- **结构化工件** — 讨论结果持久化为独立 JSON，不修改原始需求，通过 side-channel 传递给后续阶段
- **可跳过** — `--no-discuss` 标志或简短明确的内联需求自动跳过

## Requirement Baseline（Phase 0.55）

在需求结构化提取（Phase 0.5）之后，自动生成一份需求基线文档：

- **Requirement IDs** — 每条需求获得稳定编号，用于后续映射
- **Scope Classification** — 标记 `in_scope / partially_in_scope / out_of_scope / blocked`
- **Constraints** — 保留易丢失的硬约束
- **Scenario** — 按业务场景分组，保持关联关系
- **Ownership** — 明确 frontend / backend / shared / infra 归属
- **Traceability Source** — 为 brief / spec / plan / tasks 提供统一输入

## Acceptance & Implementation Brief（Phase 0.6）

在 Requirement Baseline 生成之后，自动生成按模块组织的统一开发文档：

- **Module Briefs**：每个模块包含验收标准 + 测试策略 + 实现指引
- **Requirement-to-Brief Mapping**：显式说明每个 requirement 的覆盖程度
- **TDD 工作流**：Red-Green-Refactor 循环详解
- **测试分层策略**：单元测试 70% + 集成测试 20% + E2E 测试 10%
- **测试代码模板**：根据技术栈生成可直接使用的测试代码
- **测试数据工厂**：自动生成有效数据和无效数据工厂方法
- **Constraints by Module**：把 baseline 关键约束下沉到模块级
- **质量门禁**：自动化检查、性能指标、安全检查

## Spec / Plan 双重审查

在传统 `tech-design` 之后增加两层规划工件和两道质量门槛：

- **Phase 1.2: Spec Review** — 检查设计是否已经达到可写规范文档的质量线，并验证 traceability completeness / critical constraint preservation / scope decision explicitness
- **Phase 1.3: Spec Generation** — 生成用户友好的 `spec.md`
- **Phase 1.4: User Spec Review** — 用户确认范围、模块和验收映射
- **Phase 1.5: Intent Review** — 基于稳定 `spec` 审查变更意图
- **Phase 2: Plan Generation** — 从 `spec + baseline + brief` 生成 `plan.md`
- **Phase 2.5: Plan Review** — 检查计划完整性、粒度、可执行性与 requirement coverage
- **Phase 3: Task Compilation** — 将 `spec + plan + brief + baseline` 编译为 `tasks.md`

## 调用方式

```bash
/workflow start "需求描述"                 # 启动新工作流
/workflow start docs/prd.md               # 自动检测 .md 文件
/workflow start -f "需求"                 # 强制覆盖已有文件
/workflow start --no-discuss docs/prd.md # 跳过需求讨论

/workflow execute                         # 执行下一个任务（默认阶段模式）
/workflow execute --retry                 # 重试失败的任务
/workflow execute --skip                  # 跳过当前任务（慎用）

/workflow status                          # 查看当前状态
/workflow status --detail                 # 详细模式

# 增量变更（自动识别类型，统一入口）
/workflow delta
/workflow delta docs/prd-v2.md
/workflow delta 新增导出功能，支持 CSV 格式
/workflow delta packages/api/.../teamApi.ts

/workflow archive                         # 归档已完成的工作流
```

## 自然语言控制

执行时可描述意图：

| 用户说 | 系统理解 |
|--------|----------|
| "单步执行" | step 模式 |
| "继续" / "下一阶段" | phase 模式（默认） |
| "执行到质量关卡" | quality_gate 模式 |
| "重试" / "跳过" | retry / skip 模式 |

## 工作流程

```
需求 ──▶ 代码分析 ──▶ 需求讨论 ──▶ 需求结构化 ──▶ Requirement Baseline ──▶ Brief ──▶ tech-design.md
             │             │               │                  │                 │
        codebase-    💬 逐个澄清       RequirementItem   requirement IDs    📋 模块验收 + TDD 指引
        retrieval    🎯 方案选择        归一化输出        constraints         coverage view

tech-design.md ──▶ Traceability Review ──▶ spec.md ──▶ User Spec Review ──▶ Intent Review ──▶ plan.md ──▶ Plan Review ──▶ tasks.md ──▶ 执行
                    🔍 结构+追溯审查         📘 友好规范        🛑 用户确认             🔍 审查意图      🧭 实施计划      🔍 覆盖审查      🛑 确认任务
```

## 文件结构

```
项目目录/
├── .claude/
│   ├── config/project-config.json              ← /scan 生成
│   ├── analysis/
│   │   └── {name}-requirement-baseline.md      ← 需求基线（Phase 0.55）
│   ├── tech-design/{name}.md                   ← 技术设计
│   ├── specs/{name}.md                         ← 设计规范（Spec）
│   ├── plans/{name}.md                         ← 实施计划（Plan）
│   └── acceptance/
│       └── {name}-brief.md                    ← Brief (Phase 0.6)

~/.claude/workflows/{projectId}/
├── workflow-state.json                         ← 运行时状态
├── discussion-artifact.json                    ← 讨论工件 (Phase 0.2)
├── requirement-baseline.json                   ← requirement items JSON
├── tasks-{name}.md                             ← 任务编排清单
├── changes/
│   └── CHG-001/
│       ├── delta.json
│       ├── intent.md
│       └── review-status.json
└── archive/
    └── CHG-001/
```

> Intent Review 的“取消”分支会放弃当前变更，并清理当前 `changes/{changeId}` 下的临时 Intent 工件；已完成并归档的变更记录位于 `archive/`。

## 状态机

| 状态 | 说明 |
|------|------|
| `planned` | 规划完成，等待后续确认或执行 |
| `spec_review` | Spec 已生成，等待用户确认范围或回退修改 |
| `intent_review` | Intent 文档已生成，等待用户确认变更方向 |
| `running` | 执行中 |
| `paused` | 暂停，等待用户处理文档或继续操作 |
| `blocked` | 等待外部依赖 |
| `failed` | 任务失败 |
| `completed` | 全部完成 |
| `archived` | 工作流已归档 |

## References

### 核心流程（概览）

| 模块 | 路径 | 说明 |
|------|------|------|
| start | [references/start-overview.md](references/start-overview.md) | 启动工作流概览 |
| execute | [references/execute-overview.md](references/execute-overview.md) | 执行任务概览 |
| delta | [references/delta-overview.md](references/delta-overview.md) | 增量变更概览 |
| status | [references/status.md](references/status.md) | 查看状态 |
| archive | [references/archive.md](references/archive.md) | 归档工作流 |
| state-machine | [references/state-machine.md](references/state-machine.md) | 状态结构与审查字段 |
| traceability | [references/traceability.md](references/traceability.md) | 需求追溯模型与质量门槛 |
| shared-utils | [references/shared-utils.md](references/shared-utils.md) | 任务解析、上下文估算、并行分组 |

### 详细实现规格（按需查阅）

**start 流程详情**：
- [specs/start/phase-0-code-analysis.md](specs/start/phase-0-code-analysis.md) - Phase 0 代码分析
- [specs/start/phase-0.2-requirement-discussion.md](specs/start/phase-0.2-requirement-discussion.md) - Phase 0.2 需求分析讨论
- [specs/start/phase-0.5-requirement-extraction.md](specs/start/phase-0.5-requirement-extraction.md) - Phase 0.5 需求结构化提取
- [specs/start/phase-0.55-requirement-baseline.md](specs/start/phase-0.55-requirement-baseline.md) - Phase 0.55 Requirement Baseline
- [specs/start/phase-0.6-brief.md](specs/start/phase-0.6-brief.md) - Phase 0.6 Brief 生成
- [specs/start/phase-1-tech-design.md](specs/start/phase-1-tech-design.md) - Phase 1 技术设计生成
- [specs/start/phase-1.2-spec-review.md](specs/start/phase-1.2-spec-review.md) - Phase 1.2 Spec 审查
- [specs/start/phase-1.3-spec-generation.md](specs/start/phase-1.3-spec-generation.md) - Phase 1.3 Spec 生成
- [specs/start/phase-1.4-spec-user-review.md](specs/start/phase-1.4-spec-user-review.md) - Phase 1.4 用户 Spec 审查
- [specs/start/phase-1.5-intent-review.md](specs/start/phase-1.5-intent-review.md) - Phase 1.5 意图审查
- [specs/start/phase-2-plan-generation.md](specs/start/phase-2-plan-generation.md) - Phase 2 Plan 生成
- [specs/start/phase-2.5-plan-review.md](specs/start/phase-2.5-plan-review.md) - Phase 2.5 Plan 审查
- [specs/start/phase-3-task-compilation.md](specs/start/phase-3-task-compilation.md) - Phase 3 任务编译

**execute 流程详情**：
- [specs/execute/execution-modes.md](specs/execute/execution-modes.md) - 执行模式详情
- [specs/execute/actions/quality-review.md](specs/execute/actions/quality-review.md) - 两阶段代码审查
- [specs/execute/helpers.md](specs/execute/helpers.md) - 辅助函数

**delta 流程详情**：
- [specs/delta/impact-analysis.md](specs/delta/impact-analysis.md) - 影响分析详情
- [specs/delta/api-sync.md](specs/delta/api-sync.md) - API 同步详情

### 其他参考

| 模块 | 路径 |
|------|------|
| Brief | [references/brief.md](references/brief.md) |
| 审查反馈协议 | [references/review-feedback-protocol.md](references/review-feedback-protocol.md) |
| 外部依赖 | [references/external-deps.md](references/external-deps.md) |
| 状态机 | [references/state-machine.md](references/state-machine.md) |
| Traceability | [references/traceability.md](references/traceability.md) |
| 共享工具 | [references/shared-utils.md](references/shared-utils.md) |

## 前置条件

执行 `/workflow start` 前需确保：
1. **项目已扫描**：执行 `/scan` 生成 `.claude/config/project-config.json`
2. **需求明确**：提供清晰的需求描述或 PRD 文档
3. **可接受分阶段确认**：Spec / Intent / 任务编排均包含显式 Hard Stop
4. **接受显式追溯建模**：长 PRD 场景下会生成 Requirement Baseline 并作为后续工件输入
