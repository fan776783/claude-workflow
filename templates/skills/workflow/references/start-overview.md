# workflow start - 启动工作流 (v4.1)

> 精简接口：自动检测 `.md` 文件，无需 `--backend`/`--file` 参数

八阶段强制流程：**需求 → 需求讨论 → 需求结构化 → Requirement Baseline → 设计 → Spec → Plan → 任务编排**

## 快速导航

- 规格引用
- 执行流程概览
- Phase 0-0.6：需求分析到 Brief 生成
- Phase 1-1.5：设计、Spec 与 Intent 审查
- Phase 2-3：Plan、Task Compilation 与 Hard Stop
- 创建工作流状态

```
需求文档 ──▶ 代码分析 ──▶ 需求讨论 ──▶ 需求结构化 ──▶ Requirement Baseline ──▶ Brief ──▶ tech-design.md
                │             │               │                   │                  │
                │       💬 逐个澄清       RequirementItem     requirement IDs     📋 模块验收 + TDD 指引
           codebase-retrieval                                      constraints

tech-design.md ──▶ Traceability Review ──▶ spec.md ──▶ User Spec Review ──▶ Intent Review ──▶ plan.md ──▶ Plan Review ──▶ tasks.md ──▶ 执行
                    🔍 结构+追溯审查         📘 友好规范         🛑 范围确认          🔍 意图确认      🧭 原子计划       🔍 覆盖审查      🛑 确认任务
```

## 规格引用

| 模块 | 路径 | 说明 |
|------|------|------|
| 状态机 | `references/state-machine.md` | 状态文件结构 |
| 追溯模型 | `references/traceability.md` | requirement item 与 quality gate 定义 |
| 任务解析 | `references/shared-utils.md` | V2 任务模型与解析函数 |
| 质量关卡 | `specs/execute/actions/quality-review.md` | 两阶段代码审查 |

---

## 🎯 执行流程概览

### Step 0：解析参数

解析命令行参数，支持：
- 内联需求：`/workflow start "实现用户认证功能"`
- 文件需求：`/workflow start docs/prd.md`（自动检测 `.md` 文件）
- 强制覆盖：`/workflow start -f "强制覆盖已有文件"`
- 跳过讨论：`/workflow start --no-discuss docs/prd.md`

**详细实现**: 参见 `specs/start/phase-0-code-analysis.md`

---

### Step 1：项目配置检查（强制）

检查 `.claude/config/project-config.json` 是否存在，验证项目 ID。

**前置条件**: 必须先执行 `/scan` 生成项目配置。

---

### Step 2：检测现有工作流

检查 `~/.claude/workflows/{projectId}/workflow-state.json` 是否存在未归档的工作流。

**处理原则**:
- 已归档：可直接启动新工作流
- 未归档：先通过当前状态页确认是否继续、完成或归档
- 取消：不创建新的规划产物

---

### Phase 0：代码分析（强制）⚠️

**目的**: 在设计前充分理解代码库

使用代码检索能力分析相关代码，提取：
1. 相关现有实现文件（可复用或需修改）
2. 可继承的基类、可复用的工具类
3. 相似功能的实现参考（作为模式参考）
4. 技术约束（数据库、框架、规范、错误处理模式）
5. 需要注意的依赖关系

**详细实现**: 参见 `specs/start/phase-0-code-analysis.md`

---

### Phase 0.2：需求分析讨论（条件执行）

**目的**: 通过交互式对话发现需求中的模糊点、缺失项和隐含假设

**执行条件**: 非内联短需求（内联 ≤ 100 字符跳过），可通过 `--no-discuss` 跳过

**讨论流程**:
1. **需求预分析** — 基于代码分析结果，自动识别待澄清事项
2. **逐个澄清** — 每次只问一个问题，优先选择题
3. **方案探索** — 存在互斥实现路径时提出 2-3 种方案
4. **持久化讨论工件** — 结构化 side-channel，供后续阶段显式消费

**详细实现**: 参见 `specs/start/phase-0.2-requirement-discussion.md`

---

### Phase 0.5：需求结构化提取（条件执行）

**目的**: 从 PRD 中按业务场景提取结构化数据，确保可操作细节不丢失，并归一化为后续可追溯的 requirement items 输入

**执行条件**: 仅对文件来源且长度 > 500 的需求执行

**提取方式**：Extraction Spec（约束驱动 + Gate 门禁）
- 模型根据 PRD 内容自行识别业务场景，按场景分组
- 4 个 Gate 门禁确保覆盖率、约束完整性、关联完整性、粒度合理
- 9 个常见维度降级为可选自检 checklist

**输出要求**:
- 为 `Phase 0.55` 提供可归一化的 `RequirementItem` 输入
- 高风险条目应拆分，避免在下游合并丢失

**详细实现**: 参见 `specs/start/phase-0.5-requirement-extraction.md`

---

### Phase 0.55：Requirement Baseline（条件执行）

**目的**: 将结构化需求固化为 requirement IDs、scope decision 和 critical constraints 的真相源

**执行条件**: 仅在 Phase 0.5 成功提取结构化需求后执行

**输出**:
- `.claude/analysis/{task-name}-requirement-baseline.md`
- `~/.claude/workflows/{projectId}/requirement-baseline.json`

**关键结果**:
- requirement IDs
- `in_scope / partially_in_scope / out_of_scope / blocked`
- owner（frontend / backend / shared / infra）
- critical constraints
- out-of-scope 与 blocked 原因

**详细实现**: 参见 `specs/start/phase-0.55-requirement-baseline.md`

---

### Phase 0.6：生成 Acceptance & Implementation Brief（条件执行）

**目的**: 将 Requirement Baseline 转换为按模块组织的统一开发文档，包含验收标准和实现路径

**执行条件**: 仅在 Phase 0.55 成功生成 Requirement Baseline 后执行

**输出**: `.claude/acceptance/{task-name}-brief.md`

**新增硬约束**:
- 必须生成 requirement-to-brief mapping
- 必须显式标记 partially covered / uncovered requirements
- 模块必须携带 `relatedRequirementIds` 和 `constraints`

**详细实现**: 参见 `specs/start/phase-0.6-brief.md`

---

### Phase 1：生成技术设计（强制）⚠️

**目的**: 在形成用户可读 Spec 前，先沉淀架构决策、边界与风险，并显式说明需求追溯与 out-of-scope 判定

**输入增加**: Requirement Baseline

**文档定位**:
1. 需求摘要
2. 需求详情（结构化提取，如有）
3. 代码分析结果
4. Requirement Traceability
5. 架构设计
6. 风险与缓解
7. Critical Constraints to Preserve

> `tech-design.md` 不再作为任务生成的直接解析输入。

**详细实现**: 参见 `specs/start/phase-1-tech-design.md`

---

### Phase 1.2：Spec Review / Traceability Review

**目的**: 在写 `spec.md` 之前，对设计进行完整性、清晰度、一致性、范围和追溯审查

**输入**:
- `tech-design.md`
- `discussion-artifact.json`
- `requirement baseline`
- `brief`

**输出**:
- 审查结论（pass / revise / split）
- 缺口清单与修订建议

**重点检查**:
- `traceabilityCompleteness`
- `criticalConstraintPreservation`
- `scopeDecisionExplicitness`

**详细实现**: 参见 `specs/start/phase-1.2-spec-review.md`

---

### Phase 1.3：Spec Generation

**目的**: 生成用户友好的设计规范文档，作为 Plan 的稳定输入

**输出**: `.claude/specs/{task-name}.md`

**核心章节**:
1. Context
2. Scope
3. Requirement Traceability
4. Critical Requirement Constraints
5. User-facing behavior
6. Architecture and module design
7. File structure
8. Acceptance mapping
9. Implementation slices

**详细实现**: 参见 `specs/start/phase-1.3-spec-generation.md`

---

### 🛑 Hard Stop 1：User Spec Review

**目的**: 在进入执行计划之前，让用户确认 Spec 的范围、边界和模块切分

**用户选择**:
1. **Spec 正确，继续**
2. **需要修改 Spec**
3. **需要拆分范围 / 回退设计**

**详细实现**: 参见 `specs/start/phase-1.4-spec-user-review.md`

---

### Phase 1.5：Intent Review（增量变更意图审查）

**目的**: 基于稳定 `spec.md` 生成 Intent 文档，供用户确认本次变更方向

**输出**: `~/.claude/workflows/{projectId}/changes/{changeId}/intent.md`

**Intent 文档内容**:
- 变更 ID
- 触发类型（new_requirement）
- 变更意图
- `spec_ref`
- 影响分析（涉及文件、技术约束、可复用组件）
- 审查状态

**🛑 Hard Stop**: 用户确认变更意图后才继续

**详细实现**: 参见 `specs/start/phase-1.5-intent-review.md`

---

### Phase 2：Plan Generation

**目的**: 从 `spec + requirement baseline + brief + analysisResult` 生成可审查的实施计划

**输出**: `.claude/plans/{task-name}.md`

**计划约束**:
- scope check
- file structure first
- 原子任务粒度
- 显式 verification
- requirement coverage by step
- non-negotiable requirement constraints
- 明确质量关卡和提交节点

**详细实现**: 参见 `specs/start/phase-2-plan-generation.md`

---

### Phase 2.5：Plan Review

**目的**: 审查计划是否完整、与 Spec / Baseline 对齐、粒度合理、覆盖 requirement 且可执行

**检查维度**:
- Completeness
- Spec Alignment
- Task Decomposition
- Buildability
- Requirement Coverage
- Critical Constraint Preservation

**详细实现**: 参见 `specs/start/phase-2.5-plan-review.md`

---

### Phase 3：Task Compilation

**目的**: 将 `spec + plan + brief + requirement baseline` 编译为运行时任务清单

**输出**: `~/.claude/workflows/{projectId}/tasks-{task-name}.md`

**任务模型方向**:
- `spec_ref`
- `plan_ref`
- `requirement_ids`
- `critical_constraints`
- `files.create[] / files.modify[] / files.test[]`
- `steps[]`
- `verification`
- `depends / blocked_by / quality_gate / acceptance_criteria`

**保留能力**:
- 自动质量关卡
- 自动提交任务
- 阻塞依赖分类
- workflow-state 初始化
- 追溯指标回写

**详细实现**: 参见 `specs/start/phase-3-task-compilation.md`

---

### 🛑 Hard Stop 2：规划完成（强制停止）

**输出摘要**:
- Requirement Baseline 路径
- 技术设计路径
- Spec 路径
- Plan 路径
- 任务清单路径
- Brief 路径（如有）
- requirement 总数 / in-scope 数
- uncovered requirements（如有）
- 任务数量
- 工作模式（normal / progressive）
- 阻塞任务列表（如有）

**文件结构**:
```
.claude/
├── analysis/
│   └── {task-name}-requirement-baseline.md
├── tech-design/
│   └── {task-name}.md
├── specs/
│   └── {task-name}.md
├── plans/
│   └── {task-name}.md
├── acceptance/
│   └── {task-name}-brief.md

~/.claude/workflows/{projectId}/
├── workflow-state.json
├── requirement-baseline.json
├── tasks-{task-name}.md
└── changes/
    └── {changeId}/
        ├── delta.json
        ├── intent.md
        └── review-status.json
```

**下一步**: 用户审查后执行 `/workflow execute`

---

### Step 3：创建工作流状态

状态文件应额外记录：
- requirement baseline 路径
- baseline 覆盖统计
- traceability review 状态
- uncovered requirements
- plan coverage metrics
