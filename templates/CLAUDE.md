# Codex Collaboration System (v4.0)

> Codex 单模型协作 + 当前模型编排
>
> **注意**: 本文件是 `@justinfan/agent-workflow` Skills 体系的一部分，通过 canonical + managed-links 架构分发到多个 AI 编码工具。
>
> `workflow` 现已区分 planning side review loops 与 execution quality gates：Phase 1.2 / Phase 2.5 为 `machine_loop`，Phase 1.4 为 `human_gate`，Phase 1.5 为 `conditional_human_gate`；执行阶段 `quality_review` 则作为 shared review loop contract 的 execution adapter 写入 `quality_gates.*`。
>
> 当执行阶段涉及**同阶段 2+ 独立任务 / 独立问题域的并行分派**时，优先复用 `/dispatching-parallel-agents` skill；单任务 subagent 或单 reviewer 子 agent 不属于该 skill 的适用场景。

---

## 0. Global Protocols

所有操作必须严格遵循以下系统约束：

- **交互语言**：工具/模型交互用 **English**；用户输出用 **中文**
- **会话连续性**：记录 `sessionId`，后续任务**强制思考**是否继续对话
- **沙箱安全**：Codex **零写入权限**，输出必须为 `unified diff patch`
- **代码主权**：外部模型输出为"脏原型"，交付代码**必须由当前模型重构**
- **代码风格**：精简高效、无冗余；注释/文档遵循**非必要不形成**原则
- **针对性改动**：严禁影响现有功能
- **上下文检索**：优先用 `mcp__auggie-mcp__codebase-retrieval`，减少 search/find/grep
- **判断依据**：以代码和工具搜索结果为准，禁止猜测
- **强制并行**：调用 Codex 时必须使用 **Run in the background**（**不设置** timeout）

### 协作架构

```
┌─────────────────────────────────────────────────────────────┐
│              当前模型（全栈编排者 + 最终决策者）               │
│        契约设计 · 整合视角 · 文件写入 · 交付验证              │
└─────────────────────────────────────────────────────────────┘
                             ↑
                             │ 技术分析 / 审查 / 调试
                    ┌────────┴────────┐
                    │     Codex       │
                    │   技术专家（只读） │
                    │  算法/安全/性能   │
                    └─────────────────┘
```

### 动态协作模式

| Mode | 说明 | 适用场景 |
|------|------|----------|
| `none` | 不调用外部模型 | 单行修复、拼写错误、简单任务 |
| `codex` | Codex 协作 | 后端逻辑、算法、安全审查、代码审计 |

**路由规则**：
- 后端/逻辑/算法任务 → Codex 协作
- 前端/UI 任务 → 当前模型直接执行（Claude 原生能力）
- 全栈任务 → Codex 分析后端，当前模型处理前端
- 简单任务 → `[Mode: none] 任务简单，直接执行`

---

## 1. Workflow

### Phase 1: 上下文检索 + 路由

1. 调用 `mcp__auggie-mcp__codebase-retrieval`
2. 获取相关类/函数/变量的完整定义
3. 需求模糊时向用户输出引导性问题
4. **模式判定**：根据任务类型选择 `none`/`codex`

### Phase 2: 协作分析

| Mode | 执行 |
|------|------|
| none | 跳过，直接 Phase 4 |
| codex | Codex 分析 → 当前模型补充前端视角 → **Hard Stop**: 展示计划，询问 **"Shall I proceed? (Y/N)"** |

**Codex 调用**（`run_in_background: true`，**不设置** timeout），按 `collaborating-with-codex` skill 调用：

```
PROMPT: "ROLE: Technical Analyst. CONSTRAINTS: READ-ONLY, output analysis report only. Analyze: <用户问题>. Context: <从 Phase 1 获取的相关代码和架构信息>. OUTPUT: Detailed technical analysis with recommendations."
```

用 `TaskOutput` 等待结果，**📌 保存 `sessionId`**。

### Phase 3: 原型获取

| Mode | 执行 |
|------|------|
| none | 跳过 |
| codex | Codex 生成 Diff（复用会话 `--session-id`）→ `TaskOutput` 收集 |

按 `collaborating-with-codex` skill 调用（复用会话 `--session-id`）：

```
PROMPT: "ROLE: System Architect. CONSTRAINTS: READ-ONLY, output Unified Diff Patch ONLY. <后续需求>. OUTPUT: Unified Diff Patch ONLY."
# 复用会话：追加 --session-id "<uuid-from-phase-2>"
```

输出: `Unified Diff Patch ONLY`

### Phase 4: 编码实施

**当前模型执行**：

1. 将外部原型视为"脏原型"，仅作参考
2. 读取 Codex Diff → **思维沙箱**（模拟应用并检查逻辑）→ **重构**（清理）→ 最终代码
3. 重构为干净的生产级代码
4. 验证无副作用

### Phase 5: 审计与交付

| Mode | 执行 |
|------|------|
| none | 当前模型自检后交付 |
| codex | Codex 审查（`run_in_background: true`）→ 整合反馈后交付 |

按 `collaborating-with-codex` skill 调用：

```
PROMPT: "ROLE: Code Reviewer. CONSTRAINTS: READ-ONLY, output review comments sorted by P0→P3. Review the following changes: <diff_content>. Evaluate: logic correctness, security, performance, error handling, edge cases. OUTPUT FORMAT: Review comments only, sort by P0→P3 priority."
```

---

## 2. Quick Reference

### 调用语法

> **完整命令格式和参数说明参见 `collaborating-with-codex` skill。**

**PROMPT 模板**：

```
"ROLE: <角色>. CONSTRAINTS: READ-ONLY. <任务描述>. OUTPUT: <输出格式>"
```

**会话恢复**：追加 `--session-id "<uuid>"` 参数。

### 异步执行

使用 `run_in_background: true` 执行（**不设置** timeout），通过 `TaskOutput` 等待结果。

### 会话复用

每次调用返回 JSON `{"success": true, "sessionId": "xxx", "agentMessages": "..."}`，后续阶段用 `--session-id <id>` 复用上下文。

---

## 3. Expert Roles

调用 Codex 时通过 `--prompt` 内联角色前缀：

| 阶段 | 角色前缀 |
|------|----------|
| 分析 | `ROLE: Technical Analyst. CONSTRAINTS: READ-ONLY, output analysis report only.` |
| 规划 | `ROLE: System Architect. CONSTRAINTS: READ-ONLY, output Unified Diff Patch ONLY.` |
| 审查 | `ROLE: Code Reviewer. CONSTRAINTS: READ-ONLY, output review comments sorted by P0→P3.` |
| 调试 | `ROLE: Backend Debugger. CONSTRAINTS: READ-ONLY, output diagnostic report only.` |
| 测试 | `ROLE: Test Engineer. CONSTRAINTS: READ-ONLY, output test analysis report only.` |
| 优化 | `ROLE: Performance Optimizer. CONSTRAINTS: READ-ONLY, output optimization recommendations only.` |

### Codex 专长

| 专长领域 | 权威范围 | 约束 |
|----------|----------|------|
| API 设计、数据库、安全、性能、算法 | **技术权威** | 零写入权限 + Diff Only |

### 当前模型职责

当前运行的模型作为**全栈编排者**，负责：
- 协调 Codex 协作
- 独立处理前端/UI 任务
- 将"脏原型"重构为生产级代码
- 执行所有文件写入操作
- 最终质量把关与交付验证

---

## 4. 结果分析与评估

当前模型收到 Codex 返回结果后，**必须**执行以下分析流程：

### 评估维度

| 维度 | 检查点 |
|------|--------|
| **正确性** | API 契约、数据模型、业务逻辑 |
| **完整性** | 错误处理、边界条件、安全校验 |
| **一致性** | 命名规范、代码风格、类型定义 |
| **可维护性** | 模块划分、依赖注入、接口抽象 |

### 质量阈值

- **Codex 输出不合理**：拒绝采用，当前模型重新生成或放弃该方案
- **前端相关改动**：当前模型直接处理，不依赖外部模型
- **质量低于预期**：触发 Hard Stop，向用户报告问题并请求指导
