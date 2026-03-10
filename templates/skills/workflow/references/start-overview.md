# workflow start - 启动工作流 (v3.0)

> 精简接口：自动检测 `.md` 文件，无需 `--backend`/`--file` 参数

五阶段强制流程：**需求 → 需求讨论 → 需求结构化 → 设计 → 意图审查 → 任务**

```
需求文档 ──▶ 代码分析 ──▶ 需求讨论 ──▶ 需求结构化 ──▶ tech-design.md ──▶ Intent Review ──▶ tasks.md ──▶ 执行
                │             │              │       │          │                │
                │       💬 逐个澄清    🛑 确认需求理解  🛑 确认设计      🔍 审查意图      🛑 确认任务
                │       🎯 方案选择     (非空维度≥3时)
           codebase-retrieval
```

## 规格引用

| 模块 | 路径 | 说明 |
|------|------|------|
| 状态机 | `specs/workflow/state-machine.md` | 状态文件结构 |
| 任务解析 | `specs/workflow/task-parser.md` | Task 接口定义 |
| 质量关卡 | `specs/workflow/quality-gate.md` | 关卡任务标记 |

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

### Step 2：检测现有任务

检查 `~/.claude/workflows/{projectId}/workflow-state.json` 是否存在未完成的任务。

**冲突处理**:
- 继续旧任务
- 开始新任务（旧任务自动备份）
- 取消操作

---

### Phase 0：代码分析（强制）⚠️

**目的**: 在设计前充分理解代码库

使用 `mcp__auggie-mcp__codebase-retrieval` 分析相关代码，提取：
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
1. **需求预分析** — 基于代码分析结果，自动识别待澄清事项（范围边界、行为未定义、边界场景、技术约束冲突、外部依赖）
2. **逐个澄清** — 每次只问一个问题，优先选择题，用户可随时结束
3. **方案探索**（条件） — 存在互斥实现路径时，提出 2-3 种方案供选择
4. **持久化讨论工件** — 结构化 side-channel（不修改原始需求），供后续阶段显式消费

**跳过机制**: `--no-discuss` 标志 或 内联短需求自动跳过

**详细实现**: 参见 `specs/start/phase-0.2-requirement-discussion.md`

---

### Phase 0.5：需求结构化提取（条件执行）

**目的**: 从 PRD 中提取结构化数据，确保表单字段、角色权限、业务规则等细节不丢失

**执行条件**: 仅对文件来源且长度 > 500 的需求执行（向后兼容：内联需求 / 短文本自动跳过）

**提取维度**（9 维度）:
1. 变更记录
2. 表单字段（按场景分组）
3. 角色权限
4. 交互规格
5. 业务规则
6. 边界场景
7. UI 展示规则
8. 功能流程（含入口路径）
9. 数据契约

**详细实现**: 参见 `specs/start/phase-0.5-requirement-extraction.md`

---

### Phase 0.6：生成验证清单（条件执行）

**目的**: 将结构化需求转换为可执行的验证清单，指导任务实现和验收测试

**执行条件**: 仅在 Phase 0.5 成功提取结构化需求后执行

**输出**: `.claude/acceptance/{task-name}-checklist.md`

**清单类型**:
- 表单验证项
- 权限验证项
- 交互验证项
- 业务规则验证项
- 边界场景验证项
- UI 展示验证项
- 功能流程验证项

**详细实现**: 参见 `specs/start/phase-0.6-acceptance-checklist.md`

---

### Phase 0.7：生成实现指南（条件执行）

**目的**: 将验收清单转换为开发者视角的实现路径，关注"如何测试和实现"

**执行条件**: 仅在 Phase 0.6 成功生成验证清单后执行

**输出**: `.claude/acceptance/{task-name}-implementation-guide.md`

**详细实现**: 参见 `specs/start/phase-0.7-implementation-guide.md`

---

### Phase 1：生成技术方案（强制）⚠️

**目的**: 在拆分任务前明确架构决策

**输出**: `.claude/tech-design/{task-name}.md`

**文件冲突处理**:
- 使用现有方案
- 重新生成（覆盖）
- 取消操作

**技术方案结构**:
1. 需求摘要
2. 需求详情（结构化提取，如有）
3. 代码分析结果
4. 架构设计
5. 实施计划
6. 风险与缓解
7. 验收标准

**详细实现**: 参见 `specs/start/phase-1-tech-design.md`

---

### Phase 1.5：Intent Review（增量变更意图审查）

**目的**: 在生成任务清单前，生成 Intent 文档供用户审查变更意图

**输出**: `~/.claude/workflows/{projectId}/changes/{changeId}/intent.md`

**Intent 文档内容**:
- 变更 ID
- 触发类型（new_requirement）
- 变更意图
- 影响分析（涉及文件、技术约束、可复用组件）
- 审查状态

**🛑 Hard Stop**: 用户确认变更意图后才继续

**详细实现**: 参见 `specs/start/phase-1.5-intent-review.md`

---

### 🛑 Hard Stop 1：设计方案确认

**用户选择**:
1. **继续拆分任务**: 方案已完善，基于此方案生成任务清单
2. **Codex 审查**: 让 Codex 审查方案后再决定（评分 < 70 时建议完善）
3. **手动编辑后继续**: 暂停，手动完善方案后重新执行

**Codex 审查内容**:
- 架构设计是否合理
- 模块划分是否清晰
- 接口设计是否完整
- 实施计划是否可行
- 风险评估是否充分
- 需求覆盖率（Requirement Alignment，如有结构化需求）

---

### Phase 2：基于设计生成任务清单

**目的**: 将技术方案转换为可执行的任务清单

**输出**: `~/.claude/workflows/{projectId}/tasks-{task-name}.md`

**任务属性**:
- id: 任务 ID（T1, T2, ...）
- name: 任务名称
- phase: 任务阶段（design, infra, ui-layout, ui-display, ui-form, ui-integrate, test, verify, deliver）
- file: 目标文件
- leverage: 可复用组件
- design_ref: 设计文档章节引用
- requirement: 需求描述
- actions: 执行动作（create_file, edit_file, run_tests, codex_review, git_commit）
- depends: 依赖任务 ID
- blocked_by: 阻塞依赖（api_spec, external）
- quality_gate: 是否为质量关卡
- status: 任务状态（pending, blocked）
- acceptance_criteria: 关联的验收项（如有验证清单）

**自动添加**:
- 标准质量关卡（两阶段代码审查）
- 提交任务（git_commit）

**详细实现**: 参见 `specs/start/phase-2-task-generation.md`

---

### 🛑 Hard Stop 2：规划完成（强制停止）

**输出摘要**:
- 技术方案路径
- 任务清单路径
- 验证清单路径（如有）
- 任务数量
- 工作模式（normal / progressive）
- 阻塞任务列表（如有）

**文件结构**:
```
.claude/
├── tech-design/
│   └── {task-name}.md    ← 技术方案
├── acceptance/
│   └── {task-name}-checklist.md  ← 验证清单（可选）

~/.claude/workflows/{projectId}/
├── workflow-state.json        ← 运行时状态
├── tasks-{task-name}.md       ← 任务清单
└── changes/
    └── {changeId}/
        ├── delta.json         ← 变更描述
        ├── intent.md          ← 意图文档
        └── review-status.json ← 审查状态
```

**下一步**: 用户审查后执行 `/workflow execute`

---

### Step 3：创建工作流状态

创建 `workflow-state.json`，包含：
- 任务元数据（task_name, tech_design, tasks_file）
- 当前任务指针
- 状态（planned）
- 执行模式（phase / step / boundary / quality_gate）
- 工作模式（normal / progressive）
- 会话 ID（codex, gemini, claude）
- 进度跟踪（completed, blocked, skipped, failed）
- 约束系统（hard, soft, openQuestions, successCriteria, pbtProperties）
- 零决策审计（passed, antiPatterns, remainingAmbiguities）
- 上下文感知指标（estimatedTokens, warningThreshold, dangerThreshold）
- 边界调度（enabled, currentBoundary, boundaryProgress）
- 质量关卡（gate_task_id, commit_hash, stage1, stage2, overall_passed）
- Delta Tracking（enabled, changes_dir, current_change, applied_changes）

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
/workflow unblock api_spec    # 后端接口已就绪
/workflow unblock external    # 第三方服务/SDK 已就绪
```

---

## 📚 详细实现规格

所有详细的函数实现、数据结构定义、算法细节请参见 `specs/start/` 目录：

- `phase-0-code-analysis.md` - Phase 0 代码分析详情
- `phase-0.2-requirement-discussion.md` - Phase 0.2 需求分析讨论详情
- `phase-0.5-requirement-extraction.md` - Phase 0.5 需求结构化提取详情
- `phase-0.6-acceptance-checklist.md` - Phase 0.6 验证清单生成详情
- `phase-0.7-implementation-guide.md` - Phase 0.7 实现指南生成详情
- `phase-1-tech-design.md` - Phase 1 技术方案生成详情
- `phase-1.5-intent-review.md` - Phase 1.5 意图审查详情
- `phase-2-task-generation.md` - Phase 2 任务清单生成详情
