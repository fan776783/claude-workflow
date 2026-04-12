---
version: 3
requirement_source: "docs/implementation_plan.md"
created_at: "2026-04-12T10:00:00Z"
status: draft
role: spec
prd_coverage: "prd-spec-coverage.json"
---

# Spec: team-workflow-alignment-v2

> 统一规范文档：需求范围 + 设计决策 + 验收标准

## 1. Context

### 1.1 Problem Statement

- 当前问题：`team-workflow` 和 `workflow` 是两套独立演进的执行体系。workflow 已完成声明驱动 + CLI 状态机架构重构，拥有成熟的 skill 分层和 checklist 结构；team-workflow 仍保留概述式 SKILL.md（134 行）、薄 CLI（93 行，5 命令）、缺少 HARD-GATE / checklist / Post-Execution Pipeline / Self-Review 等治理机制。
- 业务目标：将 team-workflow 的执行纪律对齐到 workflow 已有的治理水平，同时保持 team 的独立 runtime 隔离和显式入口约束。
- 成功结果：team-workflow SKILL.md 重写为 workflow 风格的完整行动指南（~400 行），team-cli.js 新增 3 个命令（context/next/advance），phase-controller.js 增强 3 个函数，team-runtime spec 文档整合为引用桩。

### 1.2 Assumptions

- 技术假设：team-cli.js 的新增只读命令（context/next）可以绕过 lifecycle.js，直接调用 phase-controller.js + state-manager.js 组装输出，不会引入副作用。
- 技术假设：phase-controller.js 的 `inferTeamPhase()` 现有返回值结构（返回 phase string）可以在不破坏已有调用方的前提下增强错误信息。
- 业务假设：team 使用频率低于 workflow，不需要拆成多个 skill，单 SKILL.md 按 Action 分区即可满足治理需求。
- 业务假设：lifecycle.js 拆分属于第二阶段工作，本次不涉及。

---

## 2. Scope

### 2.1 In Scope

1. **SKILL.md 重写**：将 team-workflow SKILL.md 从 134 行概述式文档重写为 ~400 行 workflow 风格行动指南，包含 HARD-GATE、4 个 Action Contract（Start / Execute / Verify / Status+Archive+Cleanup）、每个 Action 带编号 checklist
2. **team-cli.js 增强**：新增 3 个子命令：
   - `context`（只读）— 聚合 team state + board + 下一步建议
   - `next`（只读）— 返回下一个可执行 boundary
   - `advance <boundaryId>`（写操作）— 完成 boundary 并推进 board/state
3. **phase-controller.js 增强**：新增 3 个函数：
   - `getPhaseTransitionReason(board, currentPhase)` — 返回 phase 转换原因
   - `canEnterPhase(targetPhase, state, board)` — 显式 gate check
   - 增强 `inferTeamPhase()` — 非法 phase 输入返回结构化错误而非裸 `'failed'`
4. **state-machine.md 增强**：添加与 workflow 状态机的语义对应表和治理信号复用章节
5. **spec 文档整合**：为 execute-entry.md / status.md / archive.md 添加引用桩头（内容已整合进 SKILL.md）

### 2.2 Out of Scope

- lifecycle.js 拆分（第二阶段）
- team-cli.js 的 `progress` 和 `journal add` 命令（第二阶段）
- team-workflow 拆分为多个独立 skill
- ContextGovernor budget backstop 复用到 team 层
- team spec/plan 模板文件创建（已有简化版规划流程）

### 2.3 Blocked

- 无阻塞项

---

## 3. Constraints

> 不可协商的硬约束

1. **不拆分 skill**：team-workflow 保持单一 SKILL.md，按 Action 分区强化治理
2. **只读命令绕过 lifecycle**：`context` 和 `next` 不经过 lifecycle.js（避免 782 行单体继续膨胀），直接调用 phase-controller + state-manager
3. **写操作走 state-manager**：`advance` 通过 state-manager.js 的原子更新函数完成，不新增 lifecycle.js 函数
4. **治理轻量化**：team 层只做 phase 边界判断（`inferTeamPhase()`），不复用完整 ContextGovernor budget backstop
5. **向后兼容**：现有 5 个 CLI 命令（start/execute/status/archive/cleanup）的行为和输出不变
6. **保留引用桩**：整合后的 spec 原文件添加重定向头而非删除，避免交叉引用死链
7. **inferTeamPhase() 增强不破坏已有调用方**：返回值仍为 phase string，错误信息通过额外的结构化返回通道提供
8. **HARD-GATE 规则 4 的 enforcement**：advance 命令中增加时间戳一致性检测，首次实施为建议性警告

---

## 4. User-facing Behavior

### 4.1 Primary Flow

**SKILL.md（AI Agent 消费）**：

Agent 读取 SKILL.md 时，会看到清晰的 4 个 Action Contract，每个 Action 含：
- HARD-GATE 规则引用
- 编号 checklist（必须按序完成）
- 对应的 CLI 命令调用
- 预期行为和输出格式

**CLI 新增命令（AI Agent 调用）**：

```bash
# 获取 team 执行上下文
node team-cli.js context --project-id X --team-id Y
# 输出：team_phase, board_summary, next_boundary, governance_signals, team_review

# 获取下一个可执行边界
node team-cli.js next --project-id X --team-id Y
# 输出：boundary_id, phase, blocked_by, claim_status, claimable_role, dependencies_met

# 完成并推进边界
node team-cli.js advance B3 --project-id X --team-id Y
# 输出：ok, advanced_boundary, new_phase, board_updated, state_updated, checkpoint_warning
```

### 4.2 Error and Edge Flows

- **无 team runtime**：`context` / `next` 返回 exitCode 1 + 错误信息
- **所有边界完成**：`next` 返回 `{ boundary_id: null, reason: 'all_completed' }`
- **上一 boundary checkpoint 未写入**：`advance` 返回 `{ ok: false, reason: 'stale_checkpoint', stale_boundary: 'B(n-1)' }`
- **非法 phase 输入**：增强后的 `inferTeamPhase()` 返回 `'failed'` 并可通过 `canEnterPhase()` 获取结构化错误
- **终态 phase 尝试 advance**：返回 `{ ok: false, reason: 'terminal_phase' }`

### 4.3 Observable Outcomes

- SKILL.md 从 134 行概述变为 ~400 行完整行动指南，Agent 执行纪律对齐 workflow
- team-cli.js 从 5 命令变为 8 命令，CLI 操作面与 workflow_cli.js 对称
- phase-controller.js 新增 3 个函数，phase 转换逻辑更透明
- state-machine.md 新增语义对应表，开发者可理解两套状态机的关系
- 3 个 spec 文件添加引用桩头，消除信息分散

---

## 5. Architecture and Module Design

### 5.1 Module Responsibilities

- **SKILL.md**：AI Agent 的完整行动指南，定义 4 个 Action Contract 的 checklist、HARD-GATE、CLI 调用规范
- **team-cli.js**：CLI 统一入口，路由 8 个子命令到对应的处理函数
- **phase-controller.js**：phase 转换逻辑中心，新增显式 gate check 和转换原因
- **state-manager.js**：状态原子读写（现有，advance 命令的写操作依赖）
- **task-board.js / task-board-helpers.js**：board 读写操作（现有，context/next 的数据来源）

### 5.2 Data Models

**`context` 输出 schema**：
```json
{
  "team_phase": "team-exec",
  "status": "running",
  "board_summary": { "total": 5, "completed": 2, "failed": 0, "pending": 3 },
  "next_boundary": { "id": "B3", "phase": "implement", "blocked_by": [] },
  "governance_signals": { "has_writable_worker": true, "phase_transition_pending": false },
  "team_review": { "overall_passed": false, "reviewed_at": null }
}
```

**`next` 输出 schema**：
```json
{
  "boundary_id": "B3",
  "phase": "implement",
  "blocked_by": [],
  "claim_status": "unclaimed",
  "claimable_role": "implementer",
  "dependencies_met": true
}
```

**`advance` 输出 schema**：
```json
{
  "ok": true,
  "advanced_boundary": "B3",
  "new_phase": "team-exec",
  "board_updated": true,
  "state_updated": true,
  "checkpoint_warning": null
}
```

**`canEnterPhase()` 返回 schema**：
```json
{ "ok": false, "reason": "no_writable_worker" }
```

**`getPhaseTransitionReason()` 返回 schema**：
```json
{ "next_phase": "team-verify", "reason": "all_boundaries_completed" }
```

### 5.3 Technology Choices

- 纯 Node.js，无新外部依赖
- JSON 标准输出（与 workflow_cli.js 一致）
- state-manager.js 原子读写（现有基础设施）

### 5.4 Risks and Trade-offs

- **风险**：`inferTeamPhase()` 增强可能影响已有调用方（lifecycle.js 中 7 处调用）。缓解：保持返回值为 phase string，结构化错误通过独立的 `canEnterPhase()` 函数提供，而非改变 `inferTeamPhase()` 的返回结构。
- **权衡**：新只读命令绕过 lifecycle.js 意味着部分逻辑存在两个路径。接受此 trade-off 以避免 lifecycle.js 继续膨胀（782 行）。
- **不采用方案**：拆分 team-workflow 为多个 skill — 使用频率低，12 个 utils/*.js 已提供功能分离，不值得增加 skill 数量。

---

## 6. File Structure

| 文件 | 操作 | 说明 |
|------|------|------|
| `core/skills/team-workflow/SKILL.md` | **重写** | 134 → ~400 行，4 个 Action Contract |
| `core/utils/team/team-cli.js` | **修改** | 93 → ~180 行，+3 命令 |
| `core/utils/team/phase-controller.js` | **修改** | 179 → ~250 行，+3 函数 |
| `core/specs/team-runtime/state-machine.md` | **修改** | 210 → ~270 行，+语义对应表 |
| `core/specs/team-runtime/execute-entry.md` | **修改** | +引用桩头 3 行 |
| `core/specs/team-runtime/status.md` | **修改** | +引用桩头 3 行 |
| `core/specs/team-runtime/archive.md` | **修改** | +引用桩头 3 行 |
| `tests/test_phase_controller_enhanced.js` | **新建** | phase-controller 增强功能测试 |
| `tests/test_team_cli_commands.js` | **新建** | team-cli 新命令 integration 测试 |

---

## 7. Acceptance Criteria

### AC-1: SKILL.md 重写

- SKILL.md 包含 `<HARD-GATE>` 区块，列出 5 条不可违反规则
- 包含 4 个 Action Contract（Start / Execute / Verify / Status+Archive+Cleanup）
- 每个 Action 有编号 checklist（`1. ☐ ...`）
- Action 2 (Execute) 的 checklist 对齐 workflow-execute 的 7 步结构
- Action 3 (Verify) 的 checklist 对齐 workflow-review 的两阶段审查
- 每个 checklist 步骤引用对应的 CLI 命令
- `先读` 章节保留现有引用链接

### AC-2: team-cli.js 新增命令

- `context` 命令返回 JSON，包含 `team_phase`、`board_summary`、`next_boundary`、`governance_signals`、`team_review`
- `next` 命令返回 JSON，包含 `boundary_id`、`phase`、`blocked_by`、`claim_status`、`claimable_role`、`dependencies_met`
- `advance <boundaryId>` 命令返回 JSON，包含 `ok`、`advanced_boundary`、`new_phase`、`board_updated`、`state_updated`、`checkpoint_warning`
- 无 team runtime 时返回 exitCode 1 + 错误信息
- `context` / `next` 不调用 lifecycle.js 的任何函数
- `advance` 通过 state-manager.js 写入，不新增 lifecycle.js 函数
- 现有 5 个命令行为不变

### AC-3: phase-controller.js 增强

- `canEnterPhase('team-exec', state, board)` 在 board 为空时返回 `{ ok: false, reason: 'empty_board' }`
- `canEnterPhase('team-exec', state, board)` 在无可写 worker 时返回 `{ ok: false, reason: 'no_writable_worker' }`
- `canEnterPhase('team-verify', state, board)` 在仍有 pending implement 边界时返回 `{ ok: false, reason: 'active_boundaries' }`
- `getPhaseTransitionReason(board, 'team-exec')` 在所有 implement 完成时返回 `{ next_phase: 'team-verify', reason: 'all_boundaries_completed' }`
- `inferTeamPhase()` 对非法 phase 输入返回 `'failed'`（保持向后兼容），同时 `canEnterPhase()` 提供诊断信息
- 现有导出函数的签名和行为不变

### AC-4: state-machine.md 增强

- 包含与 workflow 状态机的语义对应表（7 行 team phase vs workflow 阶段）
- 包含治理信号复用章节（phase 边界判断、Post-Execution Pipeline、Quality Review CLI）
- 现有内容不丢失

### AC-5: spec 文档引用桩

- execute-entry.md / status.md / archive.md 各添加引用桩头
- 引用桩指向 SKILL.md 中对应的 Action 段落
- 原有内容保留不变

### AC-6: 测试

- phase-controller 增强功能测试覆盖 `canEnterPhase`、`getPhaseTransitionReason`、增强后 `inferTeamPhase` 的错误场景
- team-cli 新命令 integration 测试覆盖正常和错误路径
- 现有测试 `test_team_*.js` 回归通过

### 7.1 Test Strategy

- 单元测试：phase-controller.js 新增函数的输入输出验证（`tests/test_phase_controller_enhanced.js`）
- 集成测试：team-cli.js 新命令的端到端 JSON 输出验证（`tests/test_team_cli_commands.js`）
- 回归测试：`node --test tests/test_team_*.js` 全部通过

---

## 8. Implementation Slices

### Slice 1: phase-controller.js 增强（基础设施）

新增 `canEnterPhase()`、`getPhaseTransitionReason()`，增强 `inferTeamPhase()` 错误返回。这是 CLI 命令和 SKILL.md 的底层依赖。

### Slice 2: team-cli.js 新增命令

基于 Slice 1 的新函数，实现 `context`、`next`、`advance` 三个子命令。

### Slice 3: SKILL.md 重写

基于 Slice 1-2 的 CLI 能力，重写 SKILL.md 为 4 个 Action Contract + HARD-GATE + checklist。

### Slice 4: state-machine.md 增强 + spec 引用桩

添加语义对应表和引用桩头，属于文档对齐工作。

### Slice 5: 测试

为 Slice 1-2 编写单元测试和集成测试。

---

## 9. Open Questions

- **lifecycle.js 拆分**：33KB / ~782 行的单体文件是最大技术债务。本方案通过让新增只读命令绕过 lifecycle.js 避免进一步膨胀。拆分作为第二阶段独立任务，建议方向：lifecycle-start.js (~200行)、lifecycle-execute.js (~300行)、lifecycle-ops.js (~100行)、lifecycle-shared.js (~100行)。此问题不阻塞本次实施。
