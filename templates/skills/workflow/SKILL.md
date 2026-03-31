---
name: workflow
description: "智能工作流系统 - 需求讨论、Spec 规划与自动化执行。显式调用：/workflow action [args]。Actions: start（启动规划）、execute（执行任务）、delta（增量变更/API同步）、status（查看状态）、archive（归档）。此 skill 不会自动触发，需用户明确调用。支持子 Agent 驱动的两阶段代码审查（Spec 合规 + 代码质量）、交互式需求讨论（Phase 0.2）、结构化调试协议和 TDD 执行纪律。"
---

# 智能工作流系统

> 本文件为产品摘要层，不定义新的状态字段、触发规则或执行语义；具体行为以 `references/state-machine.md`、`references/execute-entry.md` 与 `specs/` 下的阶段文档为准。

结构化开发工作流：代码分析 → 需求讨论（条件）→ UX 设计审批（条件 HARD-GATE）→ Spec 生成 → User Review → Plan 生成 → 执行 + 子 Agent 审查。

## ⚠️ 执行铁律（不可跳过）

以下规则在执行 `/workflow execute` 时**强制生效**。违反任何一条即为执行失败。

1. **状态文件先行**：执行第一个 task 前，必须确认 `~/.claude/workflows/{projectId}/workflow-state.json` 存在且 `status: running`。不存在则立即创建最小状态文件（参见 `references/state-machine.md` → 最小必需状态）。
2. **Plan 实时更新**：每个 task 完成后，必须立即更新 `plan.md` 中对应的 `WorkflowTaskV2` 任务块进度标记。**禁止在所有任务完成后批量回写**。
3. **审查不可跳过**：质量关卡 task（`actions` 含 `quality_review`）完成后，必须执行两阶段审查（Spec 合规 + 代码质量）。每连续完成 3 个常规 task 未审查时，必须执行一次轻量 Spec 合规检查。如不支持子 Agent，在当前会话切换角色执行（参见 `specs/execute/subagent-review.md` → 降级执行）。
4. **验证才能完成**：每个 task 完成后必须运行验证命令（build/test/lint 或 task 指定命令），读取输出确认通过。**未运行验证命令不得标记 completed**。
5. **讨论与设计必须持久化**：Phase 0.2 讨论结束后，必须将结论写入 `discussion-artifact.json`。Phase 0.3 UX 设计审批通过后，必须将设计写入 `ux-design-artifact.json`。不得仅依赖对话上下文记忆。

> ⚠️ 执行 `/workflow execute` 时，请在开始前回顾上述 5 条铁律。每完成一个 task 后，对照 `references/execution-checklist.md` 检查是否遗漏。

## 设计理念

```
需求 ──→ spec.md（设计 + 验收 + 约束）──→ plan.md（步骤 + 代码 + 验证）──→ 执行 + 审查
```

**三层文档，两次转化**：每次转化都有审查保障，信息衰减最小化。

- **spec**：统一的需求 + 设计 + 验收规范（合并原 baseline/brief/tech-design/spec）
- **plan**：可直接执行的原子步骤（含完整代码和验证命令，No Placeholders）
- **执行**：编码 + 子 Agent 两阶段审查（Spec 合规 → 代码质量）

## 核心规划模型

`workflow` 采用三层规划工件：

- **规范层**：`spec.md`
  - 聚焦需求范围、用户行为、架构设计、验收标准、关键约束
  - 是 `plan.md` 的唯一权威上游
  - 在单一文档中完成需求追溯、设计决策和验收定义
- **计划层**：`plan.md`
  - 聚焦实施步骤、文件结构、原子任务、验证命令
  - 每步必须包含完整代码块和验证命令（No Placeholders 规则）
  - 使用 `WorkflowTaskV2` 任务块（`## Tn:`）作为执行器解析的 canonical 格式，并在任务块内维护进度标记
  - 生成后执行 Self-Review 确保 spec 覆盖（内联自检，非子 Agent）
- **执行层**：代码产出
  - 按 plan 步骤逐步实现
  - 质量关卡任务完成后由子 Agent 执行两阶段审查（条件触发）

## 执行治理

`workflow execute` 采用条件触发的子 Agent 审查机制：

```
执行任务 → 编码实现 → ①验证 → ②自审查/合规检查（建议性）→ ③更新 plan → ④更新 state
                                                                    ↓
              ┌─ quality_review action ─→ 完整两阶段审查（子 Agent: Spec 合规 → 代码质量）
     ⑤审查 ──┤─ 连续 3 个常规 task ────→ 轻量合规检查
              └─ 最后一个 task ─────────→ 全量完成审查
```

**审查原则**（借鉴 superpowers）：
- **Spec 合规优先**：先确认代码匹配 spec，再看代码质量
- **子 Agent 隔离**：审查员使用独立上下文，不受实现者偏见影响
- **只关注实际问题**：只标记会在实际使用中造成问题的偏差
- **审查循环**：发现问题 → 修复 → 重新审查，直到通过

## 执行纪律

执行阶段的质量保障机制：

- **两阶段子 Agent 审查** — Spec 合规审查 + 代码质量审查，质量关卡 / 每 3 任务 / 最后任务时条件触发
- **结构化调试协议** — 任务失败重试前强制四阶段调试（根因调查 → 模式分析 → 假设验证 → 实施修复）
- **TDD 执行纪律** — 代码产出任务强制 Red-Green-Refactor 循环
- **验证门控函数** — IDENTIFY → RUN → READ → VERIFY → ONLY THEN claim
- **No Placeholders 规则** — plan 中禁止 TBD/TODO/模糊描述，每步必须包含完整代码

### Post-Execution Pipeline

```
executeTask() → ①验证（Gate Function）→ ②自审查/合规检查（建议性）→ ③更新 plan.md → ④更新 state.json → ⑤审查（条件触发）→ ⑥Journal（条件）
```

> Pipeline ⑤ 的审查触发条件：quality_review action → 完整两阶段审查（子 Agent）；连续 3 个常规 task → 轻量合规检查；最后 task → 全量审查。详见 `references/execution-checklist.md`。

## 子 Agent 路由

执行阶段支持平台感知的子 Agent 路由。

当需要对**同阶段 2+ 独立任务**启用并行子 Agent 时，**必须先读取并应用** `../dispatching-parallel-agents/SKILL.md`，再根据其中的规则执行：

- **Claude Code / Cursor**：使用 `Task` 风格子 Agent 执行独立任务与审查
- **Codex**：将 skill 中的子 Agent 抽象映射到 `spawn_agent` / `wait` / `close_agent`
- **不支持子 Agent 的平台**：自动降级为当前会话顺序执行

**使用原则**：

- 仅在任务彼此独立、无共享状态、不会编辑同一文件组时启用并行
- 每个子 Agent 只接收当前任务所需的最小上下文，不继承主会话历史
- 子 Agent 返回后，主会话负责验证、冲突检测、状态更新与下一步路由

## 需求讨论（Phase 0.2）

在代码分析（Phase 0）之后、UX 设计审批（Phase 0.3）之前的交互式需求讨论阶段：

- **自动识别 Gap** — 基于代码分析结果，检测需求中的模糊点、缺失项和隐含假设
- **UX 导航检测** — 检测多页面/多面板需求是否缺少导航结构描述
- **首次体验检测** — 检测是否缺少用户首次使用的引导流程描述
- **逐个澄清** — 每次只问一个问题，优先选择题，支持跳过和结束
- **方案探索** — 存在互斥实现路径时，提出 2-3 种方案供对比选择
- **结构化工件** — 讨论结果持久化为独立 JSON，供后续阶段消费
- **可跳过** — `--no-discuss` 标志或简短明确的内联需求自动跳过

## UX 设计审批（Phase 0.3）— HARD-GATE

在需求讨论（Phase 0.2）之后、Spec 生成（Phase 1）之前的设计审批阶段。**仅在检测到前端/GUI 相关需求时触发；一旦触发，未经用户批准不得进入 Spec 生成**：

- **用户操作流程图** — 生成 Mermaid 流程图，覆盖首次使用、核心操作、异常处理、返回取消
- **页面分层设计** — 明确功能模块的层级归属（L0 首页 / L1 功能页 / L2 辅助面板），L0 不得超过 4 个模块
- **工作目录探测** — 自动检测 Claude Code / Cursor / Codex 的本地工作目录并建议预设
- **HARD-GATE** — 设计未经用户批准不得进入 Spec 生成，支持循环修改直到通过

## Spec 生成（Phase 1）

统一的规范文档生成阶段。**若 Phase 0.3 被触发，则必须等待其审批通过后才能进入本阶段**。Spec 输入会合并原始需求、代码分析结果、讨论工件（如有）与 UX 设计工件（如有），并在单一文档中完成：

- **需求范围判定** — 每条需求标记 `in_scope / out_of_scope / blocked`，编号 R-001 起
- **澄清结果归档** — 将 Phase 0.2 的澄清结论、已选方案和未就绪依赖写入 Clarification Summary
- **关键约束提取** — 字段名、条件分支、数量限制等硬约束直接写入 Constraints 章节，并显式包含工作区/环境约束
- **架构与模块设计** — 模块划分、数据模型、接口设计、技术选型，并合并 UX 页面分层信息
- **用户可见行为** — 正常流程、异常流程、边界行为，并合并 UX 流程图/首次使用路径
- **验收标准** — 每个模块的验收条件和测试策略
- **文件结构** — 新建、修改和测试文件清单
- **实施切片** — 按可渐进交付的切片组织

## Plan 生成（Phase 2）

从 `spec.md` 生成可直接执行的实施计划：

- **前置状态** — Spec 审批通过后进入 `planning`，Plan 生成完成后才写入 `planned`
- **Spec-Normative Input** — `spec.md` 是唯一规范输入；`analysisResult` 仅作为文件规划与复用提示的辅助上下文
- **File Structure First** — 先列文件，再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟，使用 `WorkflowTaskV2` 任务块（`## Tn:`）组织并追踪进度
- **Complete Code** — 每步包含完整代码块和验证命令
- **No Placeholders** — 禁止 TBD/TODO/"实现 X"等模糊描述
- **Self-Review** — 生成后逐条检查 spec 每个需求是否有对应 task
- **Spec Section Ref** — 每步标注对应的 spec 章节

## 调用方式

```bash
/workflow start "需求描述"                 # 启动新工作流
/workflow start docs/prd.md               # 自动检测 .md 文件
/workflow start -f "需求"                 # 强制覆盖已有文件
/workflow start --no-discuss docs/prd.md # 跳过需求讨论

/workflow execute                         # 恢复/继续执行（默认 continuous）
/workflow execute --phase                 # 按阶段执行并在 phase 边界暂停
/workflow execute --retry                 # 重试失败的任务
/workflow execute --skip                  # 跳过当前任务（慎用）

/workflow status                          # 查看当前状态
/workflow status --detail                 # 详细模式

# 增量变更（自动识别类型，统一入口）
/workflow delta
/workflow delta docs/prd-v2.md
/workflow delta 新增导出功能，支持 CSV 格式

/workflow archive                         # 归档已完成的工作流

# ── 查询式状态机命令（借鉴 Trellis） ──
/workflow next                            # 查询下一步该做什么
/workflow advance T3                      # 完成 T3 + 自动推进到下一任务
/workflow advance T3 --journal "摘要"     # 推进 + 记录 journal
/workflow context                         # 聚合启动上下文（状态+journal+git）

# 会话日志（跨 Session 记忆）
/workflow journal list                    # 查看最近会话记录
/workflow journal search "关键词"          # 搜索历史会话
```

## 自然语言控制

执行时可描述意图：

| 用户说 | 系统理解 |
|--------|----------|
| "继续" / "连续" | continuous 模式（默认） |
| "下一阶段" / "单阶段" | phase 模式 |
| "重试" / "跳过" | retry / skip 模式 |

**继续语义约束**：
- `/workflow execute`：显式进入执行器，并按默认 `continuous` 模式恢复/继续。
- `/workflow execute 继续`：与默认执行一致，继续执行直到命中质量关卡、提交前暂停或 `ContextGovernor` 暂停。
- 裸自然语言“继续”：仅在已存在活动 workflow（`running` / `paused` / `failed` / `blocked`）且当前对话仍处于该 workflow 任务链上时可解释为恢复执行；否则应提示用户显式使用 `/workflow execute` 或 `/workflow status`。
- 未识别的自然语言意图不得静默覆盖既有模式，应回退到 `execution_mode` 或默认 `continuous`。

## 工作流程

```
需求 ──▶ 代码分析 ──▶ 需求讨论 ──▶ UX 设计审批 ──▶ spec.md ──▶ User Review ──▶ plan.md ──▶ 执行 + 审查
              │             │           │                │            │               │           │
         codebase-    💬 逐个澄清  🎨 流程图设计    📘 统一规范    🛑 用户确认    📋 原子步骤   🔍 多维审查
         retrieval    🎯 方案选择  📐 页面分层      📐 架构设计                  ✅ 完整代码   🔍 Spec 合规
                      🔍 UX 检测   🔍 目录探测      🎯 验收标准                  🚫 No TBD    🔍 代码质量
                                   🛑 HARD-GATE                                              🔍 UX 完整性
```

## 文件结构

```
项目目录/
├── .claude/
│   ├── config/project-config.json              ← /scan 生成
│   ├── specs/{name}.md                         ← 统一规范（Phase 1）
│   └── plans/{name}.md                         ← 实施计划（Phase 2）

~/.claude/workflows/{projectId}/
├── workflow-state.json                         ← 运行时状态
├── discussion-artifact.json                    ← 讨论工件 (Phase 0.2 执行后持久化)
├── ux-design-artifact.json                     ← UX 设计工件 (Phase 0.3 触发并审批通过后持久化)
├── journal/                                    ← 会话日志（跨 Session 记忆）
│   ├── index.json                              ← 日志索引（自动维护）
│   └── sessions/                               ← 单次会话记录
│       ├── session-001.json
│       └── session-NNN.json
├── changes/
│   └── CHG-001/
│       ├── delta.json
│       ├── intent.md
│       └── review-status.json
└── archive/
    └── CHG-001/
```

## 状态机

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无活动任务 |
| `spec_review` | Spec 已生成，等待用户确认范围 |
| `planning` | Spec 已批准，正在生成或整理 Plan |
| `planned` | Plan 已生成，规划完成，等待执行 |
| `running` | 执行中 |
| `paused` | 暂停，等待用户处理 |
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
| journal | [scripts/journal.py](scripts/journal.py) | 跨 Session 会话日志 |
| state-machine | [references/state-machine.md](references/state-machine.md) | 状态结构 |
| traceability | [references/traceability.md](references/traceability.md) | 需求追溯模型 |
| shared-utils | [references/shared-utils.md](references/shared-utils.md) | 统一 CLI 入口 + 数据模型参考 |
| execution-checklist | [references/execution-checklist.md](references/execution-checklist.md) | 任务完成强制检查清单 |

### 详细实现规格（按需查阅）

**start 流程详情**：
- [specs/start/phase-0-code-analysis.md](specs/start/phase-0-code-analysis.md) - Phase 0 代码分析
- [specs/start/phase-0.2-requirement-discussion.md](specs/start/phase-0.2-requirement-discussion.md) - Phase 0.2 需求分析讨论
- [specs/start/phase-0.3-ux-design-gate.md](specs/start/phase-0.3-ux-design-gate.md) - Phase 0.3 UX 设计审批（HARD-GATE）
- [specs/start/phase-1-spec-generation.md](specs/start/phase-1-spec-generation.md) - Phase 1 Spec 生成
- [specs/start/phase-1.1-spec-user-review.md](specs/start/phase-1.1-spec-user-review.md) - Phase 1.1 用户 Spec 审查
- [specs/start/phase-2-plan-generation.md](specs/start/phase-2-plan-generation.md) - Phase 2 Plan 生成

**execute 流程详情**：
- [specs/execute/execution-modes.md](specs/execute/execution-modes.md) - 执行模式详情
- [specs/execute/subagent-review.md](specs/execute/subagent-review.md) - 子 Agent 两阶段审查
- [specs/execute/helpers.md](specs/execute/helpers.md) - 辅助函数

**delta 流程详情**：
- [specs/delta/impact-analysis.md](specs/delta/impact-analysis.md) - 影响分析详情
- [specs/delta/api-sync.md](specs/delta/api-sync.md) - API 同步详情

### 其他参考

| 模块 | 路径 |
|------|------|
| 审查反馈协议 | [references/review-feedback-protocol.md](references/review-feedback-protocol.md) |
| 外部依赖 | [references/external-deps.md](references/external-deps.md) |
| 运行时状态机（唯一来源） | [references/state-machine.md](references/state-machine.md) |
| Traceability | [references/traceability.md](references/traceability.md) |
| 共享工具 | [references/shared-utils.md](references/shared-utils.md) |
| 执行入口与恢复解析 | [references/execute-entry.md](references/execute-entry.md) |

## 前置条件

执行 `/workflow start` 前需确保：
1. **项目配置可用**：推荐执行 `/scan` 生成完整配置，但非必须。workflow start 会在缺失时自动生成最小配置
2. **需求明确**：提供清晰的需求描述或 PRD 文档
3. **可接受分阶段确认**：Spec 包含显式 Hard Stop
4. **Git 仓库已初始化**：项目需在 git 仓库中（用于子代理 worktree 隔离）。缺失时会提示用户选择初始化或降级运行。
