# workflow start - 启动工作流 (v4.0)

> 精简接口：自动检测 `.md` 文件，无需 `--backend`/`--file` 参数

七阶段强制流程：**需求 → 需求讨论 → 需求结构化 → 设计 → Spec → Plan → 任务编排**

```
需求文档 ──▶ 代码分析 ──▶ 需求讨论 ──▶ 需求结构化 ──▶ 验收清单 ──▶ 实现指南 ──▶ tech-design.md
                │             │              │              │              │
                │       💬 逐个澄清      📋 验收映射      🧪 TDD 指引        架构决策
           codebase-retrieval

tech-design.md ──▶ Spec Review ──▶ spec.md ──▶ User Spec Review ──▶ Intent Review ──▶ plan.md ──▶ Plan Review ──▶ tasks.md ──▶ 执行
                    🔍 reviewer        📘 友好规范         🛑 范围确认          🔍 意图确认      🧭 原子计划       🔍 reviewer      🛑 确认任务
```

## 规格引用

| 模块 | 路径 | 说明 |
|------|------|------|
| 状态机 | `references/state-machine.md` | 状态文件结构 |
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

**目的**: 从 PRD 中提取结构化数据，确保字段、权限、业务规则、流程等细节不丢失

**执行条件**: 仅对文件来源且长度 > 500 的需求执行

**提取维度**（9 维度）:
1. 变更记录
2. 表单字段
3. 角色权限
4. 交互规格
5. 业务规则
6. 边界场景
7. UI 展示规则
8. 功能流程
9. 数据契约

**详细实现**: 参见 `specs/start/phase-0.5-requirement-extraction.md`

---

### Phase 0.6：生成验收清单（条件执行）

**目的**: 将结构化需求转换为可执行的验收清单，作为 Spec / Task 的验收真源

**执行条件**: 仅在 Phase 0.5 成功提取结构化需求后执行

**输出**: `.claude/acceptance/{task-name}-checklist.md`

**详细实现**: 参见 `specs/start/phase-0.6-acceptance-checklist.md`

---

### Phase 0.7：生成实现指南（条件执行）

**目的**: 将验收清单转换为开发者视角的实现路径，关注“如何测试和实现”

**执行条件**: 仅在 Phase 0.6 成功生成验收清单后执行

**输出**: `.claude/acceptance/{task-name}-implementation-guide.md`

**详细实现**: 参见 `specs/start/phase-0.7-implementation-guide.md`

---

### Phase 1：生成技术设计（强制）⚠️

**目的**: 在形成用户可读 Spec 前，先沉淀架构决策、边界与风险

**输出**: `.claude/tech-design/{task-name}.md`

**文档定位**:
1. 需求摘要
2. 需求详情（结构化提取，如有）
3. 代码分析结果
4. 架构设计
5. 风险与缓解

> `tech-design.md` 不再作为任务生成的直接解析输入。

**详细实现**: 参见 `specs/start/phase-1-tech-design.md`

---

### Phase 1.2：Spec Review

**目的**: 在写 `spec.md` 之前，对设计进行完整性、清晰度、一致性和范围审查

**输入**:
- `tech-design.md`
- `discussion-artifact.json`
- `requirementAnalysis`
- `acceptance checklist`

**输出**:
- 审查结论（pass / revise / split）
- 缺口清单与修订建议

**详细实现**: 参见 `specs/start/phase-1.2-spec-review.md`

---

### Phase 1.3：Spec Generation

**目的**: 生成用户友好的设计规范文档，作为 Plan 的稳定输入

**输出**: `.claude/specs/{task-name}.md`

**核心章节**:
1. Context
2. Scope
3. User-facing behavior
4. Architecture and module design
5. File structure
6. Acceptance mapping
7. Implementation slices

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

**目的**: 从 `spec + acceptance checklist + implementation guide + analysisResult` 生成可审查的实施计划

**输出**: `.claude/plans/{task-name}.md`

**计划约束**:
- scope check
- file structure first
- 原子任务粒度
- 显式 verification
- 明确质量关卡和提交节点

**详细实现**: 参见 `specs/start/phase-2-plan-generation.md`

---

### Phase 2.5：Plan Review

**目的**: 审查计划是否完整、与 Spec 对齐、粒度合理且可执行

**检查维度**:
- Completeness
- Spec Alignment
- Task Decomposition
- Buildability

**详细实现**: 参见 `specs/start/phase-2.5-plan-review.md`

---

### Phase 3：Task Compilation

**目的**: 将 `spec + plan + acceptance checklist` 编译为运行时任务清单

**输出**: `~/.claude/workflows/{projectId}/tasks-{task-name}.md`

**任务模型方向**:
- `spec_ref`
- `plan_ref`
- `files.create[] / files.modify[] / files.test[]`
- `steps[]`
- `verification`
- `depends / blocked_by / quality_gate / acceptance_criteria`

**保留能力**:
- 自动质量关卡
- 自动提交任务
- 阻塞依赖分类
- workflow-state 初始化

**详细实现**: 参见 `specs/start/phase-3-task-compilation.md`

---

### 🛑 Hard Stop 2：规划完成（强制停止）

**输出摘要**:
- 技术设计路径
- Spec 路径
- Plan 路径
- 任务清单路径
- 验收清单路径（如有）
- 任务数量
- 工作模式（normal / progressive）
- 阻塞任务列表（如有）

**文件结构**:
```
.claude/
├── tech-design/
│   └── {task-name}.md
├── specs/
│   └── {task-name}.md
├── plans/
│   └── {task-name}.md
├── acceptance/
│   ├── {task-name}-checklist.md
│   └── {task-name}-implementation-guide.md

~/.claude/workflows/{projectId}/
├── workflow-state.json
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

创建 `workflow-state.json`，包含：
- 任务元数据（task_name, tech_design, spec_file, plan_file, tasks_file）
- 当前任务指针
- 状态（planned）
- 执行模式（phase / step / boundary / quality_gate）
- 工作模式（normal / progressive）
- 会话与平台信息
- 审查状态（spec review / user spec review / intent review / plan review）
- 约束系统
- 零决策审计
- 上下文感知指标
- 质量关卡记录
- Delta Tracking

**Genesis Change**: 创建初始变更记录（delta.json）

---

## 🔄 相关命令

```bash
# 执行下一步
/workflow execute

# 查看状态
/workflow status

# 跳过当前步骤（慎用）
/workflow execute --skip

# 重试当前步骤
/workflow execute --retry

# 解除阻塞依赖
/workflow unblock api_spec
/workflow unblock external
```

---

## 📚 详细实现规格

所有详细的函数实现、数据结构定义、算法细节请参见 `specs/start/` 目录：

- `phase-0-code-analysis.md` - Phase 0 代码分析详情
- `phase-0.2-requirement-discussion.md` - Phase 0.2 需求分析讨论详情
- `phase-0.5-requirement-extraction.md` - Phase 0.5 需求结构化提取详情
- `phase-0.6-acceptance-checklist.md` - Phase 0.6 验收清单生成详情
- `phase-0.7-implementation-guide.md` - Phase 0.7 实现指南生成详情
- `phase-1-tech-design.md` - Phase 1 技术设计详情
- `phase-1.2-spec-review.md` - Phase 1.2 Spec 审查详情
- `phase-1.3-spec-generation.md` - Phase 1.3 Spec 生成详情
- `phase-1.4-spec-user-review.md` - Phase 1.4 用户 Spec 审查详情
- `phase-1.5-intent-review.md` - Phase 1.5 意图审查详情
- `phase-2-plan-generation.md` - Phase 2 Plan 生成详情
- `phase-2.5-plan-review.md` - Phase 2.5 Plan 审查详情
- `phase-3-task-compilation.md` - Phase 3 任务编译详情

---

## 📌 当前实现约定

当前 `workflow` 已固定为以下主链路：

1. **规划骨架**
   - `workflow/SKILL.md`
   - `references/start-overview.md`
   - `references/state-machine.md`
2. **设计与规范层**
   - `specs/start/phase-1-tech-design.md`
   - `specs/start/phase-1.2-spec-review.md`
   - `specs/start/phase-1.3-spec-generation.md`
   - `specs/start/phase-1.4-spec-user-review.md`
3. **计划与任务层**
   - `specs/start/phase-2-plan-generation.md`
   - `specs/start/phase-2.5-plan-review.md`
   - `specs/start/phase-3-task-compilation.md`
4. **执行消费层**
   - `references/shared-utils.md`
   - `references/status.md`
   - `specs/execute/execution-modes.md`
   - `specs/execute/helpers.md`

所有任务解析、状态展示和执行说明均以当前 V2 任务模型为准，不再保留旧阶段桥接或双轨任务叙事。
