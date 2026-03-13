---
name: workflow
description: "智能工作流系统 - 需求讨论、需求分析、任务规划与自动化执行。显式调用：/workflow action [args]。Actions: start（启动规划）、execute（执行任务）、delta（增量变更/API同步）、status（查看状态）、archive（归档）。此 skill 不会自动触发，需用户明确调用。支持执行纪律强化（两阶段代码审查、结构化调试协议、TDD 执行纪律）、交互式需求讨论（Phase 0.2）、双文档系统（验收清单 + 实现指南）。"
---

# 智能工作流系统

结构化开发工作流：需求分析 → 需求讨论 → 技术设计 → 任务拆分 → 自动执行。

## 设计理念

```
workflow（功能）  ──▶  figma-ui（视觉）  ──▶  visual-diff（验证）
       │
  api_spec 阻塞
```

**职责分离**：workflow 专注业务逻辑和数据流，只阻塞 API 依赖。设计稿还原通过独立的 `/figma-ui` skill 处理。

## 执行纪律

执行阶段的质量保障机制：

- **两阶段代码审查** — 质量关卡升级为 Stage 1（规格合规）+ Stage 2（代码质量），问题分 Critical/Important/Minor 三级，共享 4 次总预算
- **结构化调试协议** — 任务失败重试前强制四阶段调试（根因调查 → 模式分析 → 假设验证 → 实施修复），3 次失败触发 Hard Stop
- **TDD 执行纪律** — 实现指南存在时，implement 阶段任务强制 Red-Green-Refactor 循环
- **审查反馈处理协议** — READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT
- **验证门控函数** — IDENTIFY → RUN → READ → VERIFY → ONLY THEN claim
- **自审查步骤** — Step 6.6 单次建议性自审查，在验证和合规检查之间

### Post-Execution Pipeline

```
executeTask() → Step 6.5（验证铁律 + Gate Function）→ Step 6.6（自审查）→ Step 6.7（规格合规）→ Step 7（更新状态）
```

质量关卡任务的 `codex_review` action 内部包含两阶段审查，详见 `specs/execute/actions/codex-review.md`。

## 需求讨论（Phase 0.2）

在代码分析（Phase 0）之后、需求结构化提取（Phase 0.5）之前的交互式需求讨论阶段：

- **自动识别 Gap** — 基于代码分析结果，检测需求中的模糊点、缺失项和隐含假设
- **逐个澄清** — 每次只问一个问题，优先选择题，支持跳过和结束
- **方案探索** — 存在互斥实现路径时，提出 2-3 种方案供对比选择
- **结构化工件** — 讨论结果持久化为独立 JSON，不修改原始需求，通过 side-channel 传递给后续阶段
- **可跳过** — `--no-discuss` 标志或简短明确的内联需求自动跳过

## 双文档系统（Phase 0.6 / 0.7）

在需求结构化提取（Phase 0.5）之后，自动生成两类文档：

### Phase 0.6: 验收清单（用户视角）

用于验证功能交付质量，包含：

- **表单字段验证**：必填、格式、长度、联动等验证项 + 测试数据
- **角色权限验证**：可见性、可操作性、数据范围等验证项 + 测试步骤
- **交互行为验证**：触发条件、响应行为、提示信息等验证项
- **业务规则验证**：条件判断、联动逻辑、唯一性等验证项 + 测试场景
- **边界场景验证**：空状态、异常处理、降级方案等验证项
- **UI展示验证**：布局、样式、响应式、文本截断等验证项 + 视觉检查点
- **功能流程验证**：步骤完整性、分支逻辑、入口路径等验证项

### Phase 0.7: 实现指南（开发者视角）

提供测试先行的实现路径，包含：

- **TDD 工作流**：Red-Green-Refactor 循环详解
- **测试分层策略**：单元测试 70% + 集成测试 20% + E2E 测试 10%
- **测试代码模板**：根据技术栈生成可直接使用的测试代码
- **测试数据工厂**：自动生成有效数据和无效数据工厂方法
- **模块实现指引**：按模块分组功能，提供测试步骤和实现提示
- **质量门禁**：自动化检查、性能指标、安全检查

**双文档特点**：
- **职责分离**：验收清单关注"应该实现什么"，实现指南关注"如何测试和实现"
- **互相引用**：两个文档互相引用，共同指导开发和验收
- **技术栈适配**：实现指南根据项目配置生成对应测试框架的代码
- **自动关联**：任务自动关联验收项和测试方法
- **持久化存储**：生成独立的 `.md` 文件，便于查阅和归档

## 调用方式

```bash
/workflow start "需求描述"              # 启动新工作流
/workflow start docs/prd.md            # 自动检测 .md 文件
/workflow start -f "需求"              # 强制覆盖已有文件
/workflow start --no-discuss docs/prd.md  # 跳过需求讨论

/workflow execute                       # 执行下一个任务（默认阶段模式）
/workflow execute --retry              # 重试失败的任务
/workflow execute --skip               # 跳过当前任务（慎用）

/workflow status                        # 查看当前状态
/workflow status --detail              # 详细模式

# 增量变更（自动识别类型，统一入口）
/workflow delta                                 # 执行 ytt 生成 API
/workflow delta docs/prd-v2.md                  # PRD 更新
/workflow delta 新增导出功能，支持 CSV 格式     # 需求补充
/workflow delta packages/api/.../teamApi.ts     # API 变更 → 自动解除阻塞

/workflow archive                       # 归档已完成的工作流
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
需求 ──▶ 代码分析 ──▶ 需求讨论 ──▶ 需求结构化 ──▶ 验证清单 ──▶ 实现指南 ──▶ tech-design.md ──▶ Intent Review ──▶ tasks.md ──▶ 执行
             │             │              │              │              │                   │                │
        codebase-    💬 逐个澄清      🛑 确认设计    📋 验收标准   📝 测试模板      🔍 审查意图      🛑 确认任务
        retrieval    🎯 方案选择                      (Phase 0.6)   (Phase 0.7)
```

## 文件结构

```
项目目录/
├── .claude/
│   ├── config/project-config.json              ← /scan 生成
│   ├── tech-design/{name}.md                   ← 技术方案
│   └── acceptance/
│       ├── {name}-checklist.md                 ← 验收清单 (Phase 0.6)
│       └── {name}-implementation-guide.md      ← 实现指南 (Phase 0.7)

~/.claude/workflows/{projectId}/
├── workflow-state.json                         ← 运行时状态
├── discussion-artifact.json                    ← 讨论工件 (Phase 0.2)
├── tasks-{name}.md                             ← 任务清单
└── changes/                                    ← 增量变更
    └── CHG-001/
        ├── delta.json
        ├── intent.md
        └── review-status.json
```

## 状态机

| 状态 | 说明 |
|------|------|
| `planned` | 规划完成，等待执行 |
| `running` | 执行中 |
| `blocked` | 等待外部依赖 |
| `failed` | 任务失败 |
| `completed` | 全部完成 |

## References

### 核心流程（概览）

| 模块 | 路径 | 说明 |
|------|------|------|
| start | [references/start-overview.md](references/start-overview.md) | 启动工作流概览 |
| execute | [references/execute-overview.md](references/execute-overview.md) | 执行任务概览 |
| delta | [references/delta-overview.md](references/delta-overview.md) | 增量变更概览 |
| status | [references/status.md](references/status.md) | 查看状态 |
| archive | [references/archive.md](references/archive.md) | 归档工作流 |

### 详细实现规格（按需查阅）

**start 流程详情**：
- [specs/start/phase-0-code-analysis.md](specs/start/phase-0-code-analysis.md) - Phase 0 代码分析
- [specs/start/phase-0.2-requirement-discussion.md](specs/start/phase-0.2-requirement-discussion.md) - Phase 0.2 需求分析讨论
- [specs/start/phase-0.5-requirement-extraction.md](specs/start/phase-0.5-requirement-extraction.md) - Phase 0.5 需求结构化提取
- [specs/start/phase-0.6-acceptance-checklist.md](specs/start/phase-0.6-acceptance-checklist.md) - Phase 0.6 验证清单生成
- [specs/start/phase-1-tech-design.md](specs/start/phase-1-tech-design.md) - Phase 1 技术方案生成
- [specs/start/phase-1.5-intent-review.md](specs/start/phase-1.5-intent-review.md) - Phase 1.5 意图审查
- [specs/start/phase-2-task-generation.md](specs/start/phase-2-task-generation.md) - Phase 2 任务清单生成

**execute 流程详情**：
- [specs/execute/execution-modes.md](specs/execute/execution-modes.md) - 执行模式详情
- [specs/execute/actions/codex-review.md](specs/execute/actions/codex-review.md) - 两阶段代码审查
- [specs/execute/helpers.md](specs/execute/helpers.md) - 辅助函数

**delta 流程详情**：
- [specs/delta/impact-analysis.md](specs/delta/impact-analysis.md) - 影响分析详情
- [specs/delta/api-sync.md](specs/delta/api-sync.md) - API 同步详情

### 其他参考

| 模块 | 路径 |
|------|------|
| 验证清单 | [references/acceptance-checklist.md](references/acceptance-checklist.md) |
| 审查反馈协议 | [references/review-feedback-protocol.md](references/review-feedback-protocol.md) |
| 外部依赖 | [references/external-deps.md](references/external-deps.md) |
| 状态机 | [references/state-machine.md](references/state-machine.md) |
| 共享工具 | [references/shared-utils.md](references/shared-utils.md) |

## 前置条件

执行 `/workflow start` 前需确保：
1. **项目已扫描**: 执行 `/scan` 生成 `.claude/config/project-config.json`
2. **需求明确**: 提供清晰的需求描述或 PRD 文档
