# workflow start - 启动工作流 (v5.0)

> 精简三层架构：**需求 → Spec → Plan → 执行 + 子 Agent 审查**

五阶段强制流程：**代码分析（+ Git 检查）→ 需求讨论 → UX 设计审批 → Spec 生成 → User Review → Plan 生成**

## 快速导航

- 执行流程概览
- Phase 0：代码分析（+ Git 状态检查）
- Phase 0.2：需求讨论（条件执行）
- Phase 0.3：UX 设计审批（HARD-GATE，条件执行）
- Phase 1：Spec 生成
- Phase 1.1：User Spec Review（Hard Stop）
- Phase 2：Plan 生成（含 Self-Review）
- 规划完成（Hard Stop）

```
需求文档 ──▶ 代码分析 ──▶ 需求讨论 ──▶ UX 设计审批 ──▶ spec.md ──▶ User Review ──▶ plan.md ──▶ 执行 + 审查
                │             │           │                │           │               │
           codebase-     💬 逐个澄清  🎨 流程图设计    📘 统一规范    🛑 用户确认    📋 原子步骤
           retrieval     🎯 方案选择  📐 页面分层      📐 架构设计                  ✅ 完整代码
           + Git 检查     🔍 UX 检测   🛑 HARD-GATE      🎯 验收标准                  🚫 No TBD
```

## 规格引用

| 模块 | 路径 | 说明 |
|------|------|------|
| 状态机 | `references/state-machine.md` | 状态文件结构 |
| 追溯模型 | `references/traceability.md` | 需求追溯与验收 |
| 子 Agent 审查 | `specs/execute/subagent-review.md` | 两阶段代码审查 |
| 共享工具 | `references/shared-utils.md` | 任务解析函数 |

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

### Step 1：项目配置检查与自愈（强制）

检查 `.claude/config/project-config.json` 是否存在。

- **已有配置**：读取并验证项目 ID
- **配置缺失**：自动基于目录路径生成最小配置（含 projectId），确保状态机可初始化

**前置条件**: 推荐先执行 `/scan` 生成完整项目配置，但非必须。workflow start 会在配置缺失时自动生成最小配置（`_scanMode: auto-healed`）。

**详细实现**: 参见 `specs/start/phase-0-code-analysis.md` Step 1.3

---

### Step 2：检测现有工作流

检查 `~/.claude/workflows/{projectId}/workflow-state.json` 是否存在未归档的工作流。

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
4. **持久化讨论工件** — 结构化 side-channel，供 Spec 生成阶段消费

**详细实现**: 参见 `specs/start/phase-0.2-requirement-discussion.md`

---

### Phase 0.3：UX 设计审批（HARD-GATE，条件执行）

**目的**: 在 Spec 生成前，强制完成用户操作流程图和页面分层设计

**执行条件**: 检测到前端/GUI 相关需求时触发（纯后端/CLI 项目自动跳过）

**设计流程**:
1. **生成用户操作流程图** — Mermaid 格式，覆盖首次使用、核心操作、异常处理、返回取消
2. **生成页面分层设计** — L0 首页（≤ 4 模块）/ L1 功能页 / L2 辅助面板
3. **自动工作目录探测** — 检测 Claude Code / Cursor / Codex 的本地路径
4. **HARD-GATE 用户批准** — 设计未经批准不得进入 Spec 生成

**详细实现**: 参见 `specs/start/phase-0.3-ux-design-gate.md`

---

### Phase 1：Spec 生成（强制）⚠️

**目的**: 在单一文档中完成需求范围判定、架构设计、验收标准和关键约束

**输入**:
- 需求内容（PRD 或内联）
- 代码分析结果
- 讨论工件（如有）

**输出**: `.claude/specs/{task-name}.md`

**核心章节**:
1. Context — 背景和目标
2. Scope — 需求编号 + 范围判定（in/out/blocked）
3. Constraints — 不可协商的硬约束
4. User-facing Behavior — 正常/异常/边界行为
5. Architecture and Module Design — 模块划分 + 技术选型
6. File Structure — 新建/修改/测试文件
7. Acceptance Criteria — 按模块的验收条件
8. Implementation Slices — 渐进交付切片
9. Open Questions — 待确认问题

**生成后执行 Self-Review**:
- 需求覆盖扫描
- Placeholder 扫描（禁止 TBD/TODO）
- 内部一致性检查
- 约束完整性检查

**详细实现**: 参见 `specs/start/phase-1-spec-generation.md`

---

### 🛑 Hard Stop 1：User Spec Review

**目的**: 让用户确认 Spec 的范围、架构和验收标准。

**治理模式**: `human_gate`。用户主权确认，不参与机器自动修文。

**用户选择**:
1. **Spec 正确，继续** → 进入 Plan Generation
2. **需要修改 Spec** → 回到 Phase 1
3. **需要拆分范围** → 拆分后重新启动

**详细实现**: 参见 `specs/start/phase-1.1-spec-user-review.md`

---

### Phase 2：Plan Generation

**目的**: 从 `spec.md` 生成可直接执行的实施计划

**输入**: `spec.md`（唯一规范输入）+ `analysisResult`

**输出**: `.claude/plans/{task-name}.md`

**计划约束**:
- **File Structure First** — 先列文件，再排步骤
- **Bite-Sized Tasks** — 每步 2-5 分钟
- **Complete Code** — 每步包含完整代码块
- **No Placeholders** — 禁止 TBD/TODO/模糊描述
- **WorkflowTaskV2 Compatible** — 任务块必须使用 `## Tn:` 标题和可解析字段
- **Spec Section Ref** — 每步标注对应 spec 章节

**生成后执行 Self-Review**:
- 逐条检查 spec 需求覆盖
- Placeholder 扫描
- 跨 task 类型一致性
- 命令和路径准确性

**详细实现**: 参见 `specs/start/phase-2-plan-generation.md`

---

### 🛑 Hard Stop 2：规划完成（强制停止）

**输出摘要**:
- Spec 路径
- Plan 路径
- 需求总数 / in-scope 数
- 任务数量

**文件结构**:
```
.claude/
├── specs/{task-name}.md            ← 统一规范
└── plans/{task-name}.md            ← 实施计划

~/.claude/workflows/{projectId}/
├── workflow-state.json             ← 运行时状态
├── discussion-artifact.json        ← 讨论工件
└── changes/
```

**下一步**: 用户审查后执行 `/workflow execute`

---

### Step 3：创建工作流状态

状态文件记录：
- project_root
- spec 路径
- plan 路径
- user spec review 状态
- 任务进度
