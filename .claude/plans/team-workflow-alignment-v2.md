---
version: 2
requirement_source: "docs/implementation_plan.md"
created_at: "2026-04-12T10:05:00Z"
spec_file: ".claude/specs/team-workflow-alignment-v2.md"
status: draft
role: plan
role_profile: null
context_profile: null
confidence_score: 9
---

# team-workflow-alignment-v2 Implementation Plan

> **Spec**: `.claude/specs/team-workflow-alignment-v2.md`

**Goal:** 将 team-workflow 的执行纪律对齐到 workflow 已有的治理水平 — SKILL.md 重写、CLI +3 命令、phase-controller +3 函数、spec 文档整合

**Architecture:** 单 SKILL.md 按 Action 分区；新只读 CLI 命令绕过 lifecycle.js 直调 phase-controller + state-manager；写操作走 state-manager 原子更新

**Tech Stack:** Node.js, JSON CLI output, node:test

---

## File Structure

### Files to Create

- `tests/test_phase_controller_enhanced.js` — phase-controller 增强功能测试
- `tests/test_team_cli_commands.js` — team-cli 新命令 integration 测试

### Files to Modify

- `core/utils/team/phase-controller.js` — +3 函数 (canEnterPhase / getPhaseTransitionReason / inferTeamPhase 增强)
- `core/utils/team/team-cli.js` — +3 命令 (context / next / advance)
- `core/skills/team-workflow/SKILL.md` — 重写为 ~400 行行动指南
- `core/specs/team-runtime/state-machine.md` — +语义对应表
- `core/specs/team-runtime/execute-entry.md` — +引用桩头
- `core/specs/team-runtime/status.md` — +引用桩头
- `core/specs/team-runtime/archive.md` — +引用桩头

### Files to Test

- `tests/test_phase_controller_enhanced.js`
- `tests/test_team_cli_commands.js`
- `tests/test_team_*.js` (回归)

### Patterns to Mirror

- `core/utils/workflow/workflow_cli.js` — CLI 路由结构和 JSON 标准输出
- `core/skills/workflow-execute/SKILL.md` — 7 步 checklist + Post-Execution Pipeline 结构
- `core/skills/workflow-review/SKILL.md` — 两阶段审查 checklist

### Mandatory Reading

- `core/utils/team/state-manager.js` — readTeamState / writeTeamState / detectActiveTeamState
- `core/utils/team/task-board.js` — readTaskBoard / summarizeTaskBoard
- `core/utils/team/phase-controller.js` — inferTeamPhase / validateBoard / buildExecuteSummary / hasWritableWorker / claimableRoleForPhase

---

## Requirement Coverage

| Requirement ID | Summary | Spec Section | Covered By Tasks | Coverage Status |
|----------------|---------|--------------|------------------|-----------------|
| S1 | SKILL.md 重写 | AC-1 | T5 | covered |
| S2 | HARD-GATE 区块 | AC-1 | T5 | covered |
| S3 | Start Contract checklist | AC-1 | T5 | covered |
| S4 | Execute Contract 7 步对齐 | AC-1 | T5 | covered |
| S5 | Verify Contract 两阶段审查 | AC-1 | T5 | covered |
| S6 | team-cli.js +3 命令 | AC-2 | T3 | covered |
| S7 | CLI JSON Schema | AC-2 | T3 | covered |
| S8 | spec 文档引用桩 | AC-5 | T6 | covered |
| S9 | 状态机语义对应表 | AC-4 | T6 | covered |
| S10 | phase-controller +3 函数 | AC-3 | T1 | covered |
| S11 | stale_checkpoint enforcement | AC-2 | T3 | covered |
| S12 | 测试 | AC-6 | T2, T4 | covered |

---

## Tasks

## T1: phase-controller.js 增强 ✅

**阶段**: implement
**状态**: completed
**Spec 参考**: AC-3, Section 5.1
**Plan 参考**: Slice 1
**需求 ID**: S10
**创建文件**: 无
**修改文件**: `core/utils/team/phase-controller.js`
**测试文件**: `tests/test_phase_controller_enhanced.js` (T2)
**验收项**: AC-3
**验证命令**: `node --test tests/test_phase_controller_enhanced.js`
**预期输出**: 所有测试通过

### actions

- implement

### 步骤

**S1: 新增 `canEnterPhase()` 函数**

在 `module.exports` 之前、`buildExecuteSummary` 之后添加：

```javascript
/**
 * 检查是否允许进入目标阶段，返回结构化的门禁结果
 * @param {string} targetPhase - 目标阶段
 * @param {object} state - team 状态对象
 * @param {object[]} board - 任务面板
 * @returns {object} { ok: boolean, reason?: string }
 */
function canEnterPhase(targetPhase, state = {}, board = []) {
  if (!VALID_PHASES.has(targetPhase)) {
    return { ok: false, reason: `invalid_phase: ${targetPhase}` }
  }
  if (TERMINAL_PHASES.has(targetPhase)) {
    return { ok: false, reason: 'target_is_terminal' }
  }

  const boardValidation = validateBoard(board)

  if (targetPhase === 'team-exec') {
    if (!boardValidation.ok) return { ok: false, reason: 'empty_board' }
    if (!hasWritableWorker(state.worker_roster)) return { ok: false, reason: 'no_writable_worker' }
    const planningItems = board.filter((item) => item.phase === 'planning')
    const activePlanningStatuses = new Set(['pending', 'in_progress', 'blocked'])
    if (planningItems.some((item) => activePlanningStatuses.has(item.status || 'pending'))) {
      return { ok: false, reason: 'planning_not_complete' }
    }
    return { ok: true }
  }

  if (targetPhase === 'team-verify') {
    if (!boardValidation.ok) return { ok: false, reason: 'empty_board' }
    const activeStatuses = new Set(['pending', 'in_progress'])
    const implementItems = board.filter((item) => item.phase === 'implement')
    if (implementItems.some((item) => activeStatuses.has(item.status || 'pending'))) {
      return { ok: false, reason: 'active_boundaries' }
    }
    if (board.some((item) => item.status === 'failed')) {
      return { ok: false, reason: 'has_failed_boundaries' }
    }
    return { ok: true }
  }

  if (targetPhase === 'team-fix') {
    const failedBoundaries = board.filter((item) => item.status === 'failed')
    if (failedBoundaries.length === 0) {
      return { ok: false, reason: 'no_failed_boundaries' }
    }
    return { ok: true }
  }

  if (targetPhase === 'team-plan') {
    return { ok: true }
  }

  return { ok: false, reason: `unhandled_phase: ${targetPhase}` }
}
```

**S2: 新增 `getPhaseTransitionReason()` 函数**

紧接 `canEnterPhase` 之后添加：

```javascript
/**
 * 根据当前 board 状态返回下一个 phase 转换的原因
 * @param {object[]} board - 任务面板
 * @param {string} currentPhase - 当前阶段
 * @returns {object} { next_phase: string, reason: string }
 */
function getPhaseTransitionReason(board, currentPhase = 'team-plan') {
  if (TERMINAL_PHASES.has(currentPhase)) {
    return { next_phase: currentPhase, reason: 'terminal_phase' }
  }
  if (!VALID_PHASES.has(currentPhase)) {
    return { next_phase: 'failed', reason: `invalid_phase: ${currentPhase}` }
  }

  const items = Array.isArray(board) ? board : []
  const byPhase = (phase) => items.filter((item) => item.phase === phase)
  const activeStatuses = new Set(['pending', 'in_progress', 'blocked'])
  const hasActive = (phase) => byPhase(phase).some((item) => activeStatuses.has(item.status || 'pending'))
  const hasFailed = (phase) => byPhase(phase).some((item) => item.status === 'failed')

  if (currentPhase === 'team-plan') {
    if (hasActive('planning')) return { next_phase: 'team-plan', reason: 'planning_in_progress' }
    return { next_phase: 'team-exec', reason: 'planning_completed' }
  }

  if (currentPhase === 'team-exec') {
    if (hasFailed('implement')) return { next_phase: 'team-fix', reason: 'implement_failures_detected' }
    if (hasActive('implement')) return { next_phase: 'team-exec', reason: 'implement_in_progress' }
    return { next_phase: 'team-verify', reason: 'all_boundaries_completed' }
  }

  if (currentPhase === 'team-verify') {
    if (hasFailed('review')) return { next_phase: 'team-fix', reason: 'review_failures_detected' }
    return { next_phase: 'completed', reason: 'verification_passed' }
  }

  if (currentPhase === 'team-fix') {
    if (hasActive('fix')) return { next_phase: 'team-fix', reason: 'fix_in_progress' }
    if (hasFailed('fix')) return { next_phase: 'failed', reason: 'fix_attempts_exhausted' }
    return { next_phase: 'team-verify', reason: 'fixes_completed' }
  }

  return { next_phase: 'failed', reason: `unhandled_phase: ${currentPhase}` }
}
```

**S3: 增强 `inferTeamPhase()` 非法 phase 分支**

将 `inferTeamPhase` 中 `if (!VALID_PHASES.has(currentPhase)) return 'failed'` 保持不变（向后兼容），但开发者可以通过 `canEnterPhase()` 获取结构化诊断。不需要修改 `inferTeamPhase` 本体。

**S4: 更新 `module.exports`**

将 `canEnterPhase` 和 `getPhaseTransitionReason` 加入导出：

```javascript
module.exports = {
  VALID_PHASES,
  VALID_BOARD_STATUSES,
  TERMINAL_PHASES,
  validateBoard,
  hasWritableWorker,
  claimableRoleForPhase,
  validateReviewState,
  inferTeamPhase,
  buildExecuteSummary,
  canEnterPhase,
  getPhaseTransitionReason,
}
```

---

## T2: phase-controller 增强功能测试 ✅

**阶段**: test
**状态**: completed
**Spec 参考**: AC-6, Section 7.1
**Plan 参考**: Slice 5
**需求 ID**: S12
**创建文件**: `tests/test_phase_controller_enhanced.js`
**修改文件**: 无
**测试文件**: `tests/test_phase_controller_enhanced.js`
**验收项**: AC-6 (phase-controller 部分)
**验证命令**: `node --test tests/test_phase_controller_enhanced.js`
**预期输出**: 所有测试通过

### actions

- implement

### 步骤

**S1: 创建测试文件**

```javascript
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { canEnterPhase, getPhaseTransitionReason, inferTeamPhase } = require('../core/utils/team/phase-controller')

describe('canEnterPhase', () => {
  const emptyBoard = []
  const validBoard = [
    { id: 'B1', phase: 'implement', status: 'pending' },
    { id: 'B2', phase: 'implement', status: 'pending' },
  ]
  const completedBoard = [
    { id: 'B1', phase: 'implement', status: 'completed' },
    { id: 'B2', phase: 'implement', status: 'completed' },
  ]
  const failedBoard = [
    { id: 'B1', phase: 'implement', status: 'completed' },
    { id: 'B2', phase: 'implement', status: 'failed' },
  ]
  const activePlanningBoard = [
    { id: 'B1', phase: 'planning', status: 'pending' },
  ]

  it('team-exec: empty board returns empty_board', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: true }] }, emptyBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'empty_board')
  })

  it('team-exec: no writable worker returns no_writable_worker', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: false }] }, validBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no_writable_worker')
  })

  it('team-exec: planning not complete returns planning_not_complete', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: true }] }, activePlanningBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'planning_not_complete')
  })

  it('team-exec: valid state returns ok', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: true }] }, validBoard)
    assert.equal(result.ok, true)
  })

  it('team-verify: active boundaries returns active_boundaries', () => {
    const result = canEnterPhase('team-verify', {}, validBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'active_boundaries')
  })

  it('team-verify: failed boundaries returns has_failed_boundaries', () => {
    const result = canEnterPhase('team-verify', {}, failedBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'has_failed_boundaries')
  })

  it('team-verify: all completed returns ok', () => {
    const result = canEnterPhase('team-verify', {}, completedBoard)
    assert.equal(result.ok, true)
  })

  it('team-fix: no failed boundaries returns no_failed_boundaries', () => {
    const result = canEnterPhase('team-fix', {}, completedBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no_failed_boundaries')
  })

  it('team-fix: has failed boundaries returns ok', () => {
    const result = canEnterPhase('team-fix', {}, failedBoard)
    assert.equal(result.ok, true)
  })

  it('invalid phase returns invalid_phase', () => {
    const result = canEnterPhase('bogus-phase', {}, validBoard)
    assert.equal(result.ok, false)
    assert.match(result.reason, /invalid_phase/)
  })

  it('terminal phase returns target_is_terminal', () => {
    const result = canEnterPhase('completed', {}, validBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'target_is_terminal')
  })
})

describe('getPhaseTransitionReason', () => {
  it('team-exec with all implement completed returns team-verify', () => {
    const board = [{ id: 'B1', phase: 'implement', status: 'completed' }]
    const result = getPhaseTransitionReason(board, 'team-exec')
    assert.equal(result.next_phase, 'team-verify')
    assert.equal(result.reason, 'all_boundaries_completed')
  })

  it('team-exec with active implement returns team-exec', () => {
    const board = [{ id: 'B1', phase: 'implement', status: 'in_progress' }]
    const result = getPhaseTransitionReason(board, 'team-exec')
    assert.equal(result.next_phase, 'team-exec')
    assert.equal(result.reason, 'implement_in_progress')
  })

  it('team-exec with failed implement returns team-fix', () => {
    const board = [{ id: 'B1', phase: 'implement', status: 'failed' }]
    const result = getPhaseTransitionReason(board, 'team-exec')
    assert.equal(result.next_phase, 'team-fix')
    assert.equal(result.reason, 'implement_failures_detected')
  })

  it('team-plan with active planning returns team-plan', () => {
    const board = [{ id: 'B1', phase: 'planning', status: 'pending' }]
    const result = getPhaseTransitionReason(board, 'team-plan')
    assert.equal(result.next_phase, 'team-plan')
    assert.equal(result.reason, 'planning_in_progress')
  })

  it('terminal phase returns itself', () => {
    const result = getPhaseTransitionReason([], 'completed')
    assert.equal(result.next_phase, 'completed')
    assert.equal(result.reason, 'terminal_phase')
  })

  it('invalid phase returns failed', () => {
    const result = getPhaseTransitionReason([], 'bogus')
    assert.equal(result.next_phase, 'failed')
    assert.match(result.reason, /invalid_phase/)
  })
})

describe('inferTeamPhase enhanced', () => {
  it('invalid phase still returns failed string (backward compat)', () => {
    const result = inferTeamPhase([], 'bogus-phase')
    assert.equal(result, 'failed')
  })
})
```

---

## T3: team-cli.js 新增 context / next / advance 命令 ✅

**阶段**: implement
**状态**: completed
**Spec 参考**: AC-2, Section 4.1, Section 5.2
**Plan 参考**: Slice 2
**需求 ID**: S6, S7, S11
**创建文件**: 无
**修改文件**: `core/utils/team/team-cli.js`
**测试文件**: `tests/test_team_cli_commands.js` (T4)
**验收项**: AC-2
**验证命令**: `node --test tests/test_team_cli_commands.js`
**预期输出**: 所有测试通过

### actions

- implement

### 步骤

**S1: 添加新依赖 import**

在文件顶部 `const { cmdTeamArchive, ... } = require('./lifecycle')` 之后添加：

```javascript
const { readTeamState, writeTeamState, detectActiveTeamState, getTeamStatePath, isoNow } = require('./state-manager')
const { readTaskBoard, writeTaskBoard, summarizeTaskBoard } = require('./task-board')
const { inferTeamPhase, buildExecuteSummary, hasWritableWorker, claimableRoleForPhase, canEnterPhase, getPhaseTransitionReason } = require('./phase-controller')
```

**S2: 扩展 parseArgs 的命令列表**

将 `['start', 'execute', 'status', 'archive', 'cleanup']` 改为 `['start', 'execute', 'status', 'archive', 'cleanup', 'context', 'next', 'advance']`。

**S3: 实现 `cmdContext()` 函数**

在 `parseArgs` 和 `printHelp` 之间添加：

```javascript
/**
 * 聚合 team 执行上下文（只读，不经过 lifecycle）
 */
function cmdContext(options) {
  const statePath = resolveTeamStatePath(options)
  if (!statePath) return { error: 'no active team runtime found', exitCode: 1 }
  const state = readTeamState(statePath, options.projectId, options.teamId)
  const boardPath = state.team_tasks_file
  if (!boardPath || !require('fs').existsSync(boardPath)) {
    return { error: 'team task board not found', exitCode: 1 }
  }
  const board = readTaskBoard(boardPath)
  const summary = summarizeTaskBoard(board)
  const executeSummary = buildExecuteSummary(state, board)
  const transitionReason = getPhaseTransitionReason(board, state.team_phase)

  return {
    team_phase: executeSummary.team_phase,
    status: state.status,
    board_summary: summary,
    next_boundary: executeSummary.pending_boundaries.length > 0
      ? { id: executeSummary.pending_boundaries[0], phase: (board.find((b) => b.id === executeSummary.pending_boundaries[0]) || {}).phase || 'implement', blocked_by: (board.find((b) => b.id === executeSummary.pending_boundaries[0]) || {}).blocked_by || [] }
      : null,
    governance_signals: {
      has_writable_worker: executeSummary.has_writable_worker,
      phase_transition_pending: transitionReason.next_phase !== executeSummary.team_phase,
    },
    team_review: state.team_review ? { overall_passed: state.team_review.overall_passed, reviewed_at: state.team_review.reviewed_at } : { overall_passed: false, reviewed_at: null },
  }
}
```

**S4: 实现 `cmdNext()` 函数**

```javascript
/**
 * 返回下一个可执行的 boundary（只读，不经过 lifecycle）
 */
function cmdNext(options) {
  const statePath = resolveTeamStatePath(options)
  if (!statePath) return { error: 'no active team runtime found', exitCode: 1 }
  const state = readTeamState(statePath, options.projectId, options.teamId)
  const boardPath = state.team_tasks_file
  if (!boardPath || !require('fs').existsSync(boardPath)) {
    return { error: 'team task board not found', exitCode: 1 }
  }
  const board = readTaskBoard(boardPath)
  const executeSummary = buildExecuteSummary(state, board)

  if (executeSummary.available_claims.length === 0) {
    if (executeSummary.pending_boundaries.length === 0) {
      return { boundary_id: null, reason: 'all_completed' }
    }
    return { boundary_id: null, reason: 'all_blocked' }
  }

  const claim = executeSummary.available_claims[0]
  const item = board.find((b) => b.id === claim.id) || {}
  return {
    boundary_id: claim.id,
    phase: item.phase || 'implement',
    blocked_by: item.blocked_by || [],
    claim_status: item.claim?.claim_status || (state.boundary_claims?.[claim.id]?.claim_status) || 'unclaimed',
    claimable_role: claim.role,
    dependencies_met: !item.blocked_by || item.blocked_by.length === 0,
  }
}
```

**S5: 实现 `cmdAdvance()` 函数**

```javascript
/**
 * 完成并推进指定 boundary（写操作，走 state-manager）
 */
function cmdAdvance(boundaryId, options) {
  if (!boundaryId) return { ok: false, reason: 'missing_boundary_id' }

  const statePath = resolveTeamStatePath(options)
  if (!statePath) return { ok: false, reason: 'no_active_team_runtime' }
  const state = readTeamState(statePath, options.projectId, options.teamId)

  if (['completed', 'failed', 'archived'].includes(state.team_phase)) {
    return { ok: false, reason: 'terminal_phase' }
  }

  const boardPath = state.team_tasks_file
  if (!boardPath || !require('fs').existsSync(boardPath)) {
    return { ok: false, reason: 'board_not_found' }
  }
  const board = readTaskBoard(boardPath)
  const targetIndex = board.findIndex((b) => b.id === boundaryId)
  if (targetIndex === -1) return { ok: false, reason: 'boundary_not_found' }

  // Stale checkpoint detection (HARD-GATE rule 4 enforcement — advisory warning)
  let checkpointWarning = null
  if (targetIndex > 0) {
    const prev = board[targetIndex - 1]
    if (prev.status === 'completed' && prev.lifecycle) {
      const prevTransition = prev.lifecycle.last_transition_at
      if (!prevTransition) {
        checkpointWarning = { reason: 'stale_checkpoint', stale_boundary: prev.id }
      }
    }
  }

  // Mark boundary as completed
  board[targetIndex].status = 'completed'
  board[targetIndex].lifecycle = board[targetIndex].lifecycle || {}
  board[targetIndex].lifecycle.run_state = 'verified'
  board[targetIndex].lifecycle.last_transition_at = isoNow()

  // Update progress
  if (!state.progress) state.progress = { completed: [], failed: [], skipped: [], blocked: [] }
  if (!state.progress.completed.includes(boundaryId)) {
    state.progress.completed.push(boundaryId)
  }

  // Infer new phase
  const newPhase = inferTeamPhase(board, state.team_phase, { state })
  state.team_phase = newPhase

  // Write board and state
  writeTaskBoard(boardPath, board)
  writeTeamState(statePath, state, options.projectId, options.teamId)

  return {
    ok: true,
    advanced_boundary: boundaryId,
    new_phase: newPhase,
    board_updated: true,
    state_updated: true,
    checkpoint_warning: checkpointWarning,
  }
}
```

**S6: 实现 `resolveTeamStatePath()` 辅助函数**

在新命令函数之前添加：

```javascript
/**
 * 根据选项解析 team state 路径
 */
function resolveTeamStatePath(options) {
  if (options.projectId && options.teamId) {
    const p = getTeamStatePath(options.projectId, options.teamId)
    if (p && require('fs').existsSync(p)) return p
  }
  if (options.projectId) {
    return detectActiveTeamState(options.projectId)
  }
  return null
}
```

**S7: 更新 `printHelp()` 添加新命令帮助**

在 Usage 区块中添加三行：

```
  node team-cli.js [--project-id ID] [--team-id ID] context
  node team-cli.js [--project-id ID] [--team-id ID] next
  node team-cli.js [--project-id ID] [--team-id ID] advance <boundaryId>
```

**S8: 更新 `main()` 路由逻辑**

在 `} else if (command === 'cleanup') {` 之后添加三个分支：

```javascript
    } else if (command === 'context') {
      result = cmdContext(options)
    } else if (command === 'next') {
      result = cmdNext(options)
    } else if (command === 'advance') {
      if (!requirement) throw new Error('advance requires a boundary ID')
      result = cmdAdvance(requirement, options)
```

注：`requirement` 变量在 parseArgs 中已被提取为 advance 之后的位置参数（如 `advance B3`）。

---

## T4: team-cli 新命令 integration 测试 ✅

**阶段**: test
**状态**: completed
**Spec 参考**: AC-6, Section 7.1
**Plan 参考**: Slice 5
**需求 ID**: S12
**创建文件**: `tests/test_team_cli_commands.js`
**修改文件**: 无
**测试文件**: `tests/test_team_cli_commands.js`
**验收项**: AC-6 (team-cli 部分)
**验证命令**: `node --test tests/test_team_cli_commands.js`
**预期输出**: 所有测试通过

### actions

- implement

### 步骤

**S1: 创建测试文件**

```javascript
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const CLI_PATH = path.resolve(__dirname, '../core/utils/team/team-cli.js')

function runCli(args) {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8', timeout: 10000 })
    return { exitCode: 0, stdout, parsed: JSON.parse(stdout) }
  } catch (err) {
    return { exitCode: err.status || 1, stderr: err.stderr || '', stdout: err.stdout || '' }
  }
}

describe('team-cli context/next/advance', () => {
  const projectId = 'test-cli-cmds'
  const teamId = 'test-team-1'
  const teamsDir = path.join(os.homedir(), '.claude', 'workflows', projectId, 'teams', teamId)
  const statePath = path.join(teamsDir, 'team-state.json')
  const boardPath = path.join(teamsDir, 'team-task-board.json')

  before(() => {
    fs.mkdirSync(teamsDir, { recursive: true })
    const state = {
      project_id: projectId,
      team_id: teamId,
      team_name: 'test-team',
      status: 'running',
      team_phase: 'team-exec',
      spec_file: '.claude/specs/test.md',
      plan_file: '.claude/plans/test.md',
      team_tasks_file: boardPath,
      current_tasks: ['B1'],
      worker_roster: [
        { worker_id: 'orchestrator-1', role: 'orchestrator', writable: false, status: 'running' },
        { worker_id: 'implementer-1', role: 'implementer', writable: true, status: 'idle' },
      ],
      team_review: { overall_passed: false, reviewed_at: null, notes: [] },
      fix_loop: { attempt: 0, current_failed_boundaries: [] },
      progress: { completed: [], failed: [], skipped: [], blocked: [] },
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    const board = [
      { id: 'B1', phase: 'implement', status: 'completed', lifecycle: { run_state: 'verified', attempt: 0, last_transition_at: new Date().toISOString() } },
      { id: 'B2', phase: 'implement', status: 'pending', blocked_by: [] },
      { id: 'B3', phase: 'implement', status: 'pending', blocked_by: ['B2'] },
    ]
    fs.writeFileSync(boardPath, JSON.stringify(board, null, 2))
  })

  after(() => {
    fs.rmSync(path.join(os.homedir(), '.claude', 'workflows', projectId), { recursive: true, force: true })
  })

  it('context returns valid JSON with expected fields', () => {
    const { exitCode, parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'context'])
    assert.equal(exitCode, 0)
    assert.ok(parsed.team_phase)
    assert.ok(parsed.board_summary)
    assert.ok(parsed.governance_signals !== undefined)
    assert.ok(parsed.team_review !== undefined)
  })

  it('next returns available boundary', () => {
    const { exitCode, parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'next'])
    assert.equal(exitCode, 0)
    assert.equal(parsed.boundary_id, 'B2')
    assert.equal(parsed.claimable_role, 'implementer')
    assert.equal(parsed.dependencies_met, true)
  })

  it('advance B2 succeeds', () => {
    const { exitCode, parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'advance', 'B2'])
    assert.equal(exitCode, 0)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.advanced_boundary, 'B2')
    assert.equal(parsed.board_updated, true)
    assert.equal(parsed.state_updated, true)
  })

  it('context with no runtime returns error', () => {
    const { exitCode } = runCli(['--project-id', 'nonexistent', '--team-id', 'nope', 'context'])
    assert.equal(exitCode, 1)
  })
})
```

---

## T5: SKILL.md 重写 ✅

**阶段**: implement
**状态**: completed
**Spec 参考**: AC-1, Section 4.1
**Plan 参考**: Slice 3
**需求 ID**: S1, S2, S3, S4, S5
**创建文件**: 无
**修改文件**: `core/skills/team-workflow/SKILL.md`
**测试文件**: 无（文档）
**验收项**: AC-1
**验证命令**: `node -e "const fs=require('fs');const s=fs.readFileSync('core/skills/team-workflow/SKILL.md','utf8');const lines=s.split('\\n').length;const hasGate=s.includes('<HARD-GATE>');const actions=[/## Action 1/,/## Action 2/,/## Action 3/,/## Action 4/].every(r=>r.test(s));console.log(JSON.stringify({lines,hasGate,allActions:actions}))"`
**预期输出**: `{"lines":>350,"hasGate":true,"allActions":true}`

### actions

- implement

### 步骤

**S1: 重写 SKILL.md**

完整重写文件内容。新 SKILL.md 结构：

1. **Frontmatter** — 保留现有 name/description
2. **概述** — 简短说明本 skill 的角色
3. **先读** — 保留现有引用链接
4. **`<HARD-GATE>`** — 5 条不可违反规则
5. **Action 1: Start Contract** — 6 步 checklist，对齐 workflow-plan 思路
6. **Action 2: Execute Contract** — 6 步 checklist，对齐 workflow-execute 7 步结构
7. **Action 3: Verify Contract** — 5 步 checklist，对齐 workflow-review 两阶段审查
8. **Action 4: Status / Archive / Cleanup Contract** — CLI 调用规范和格式化输出
9. **共享运行时资源** — 保留现有列表
10. **约束** — 保留并增强

HARD-GATE 内容：

```markdown
<HARD-GATE>
五条不可违反的规则：
1. Start 输出的 spec/plan/board 必须全部落盘且可解析，才允许宣告 start 完成
2. Execute 阶段必须至少存在一个可写 implementer，否则不得推进到 team-exec
3. verify 失败时只允许回流失败边界到 team-fix，不得重跑整个团队
4. 每个 boundary 完成后必须立即更新 board + state，禁止批量回写
5. team-review 未生成且 overall_passed 未确认，不得进入 completed
</HARD-GATE>
```

Action 2 Execute Contract checklist 对齐 workflow-execute：

```markdown
## Action 2: Execute Contract

### Checklist（按序执行）

1. ☐ 读取 team runtime 状态（state-first）
   - CLI: `node team-cli.js context --project-id X --team-id Y`
   - 检查输出的 `team_phase` 和 `governance_signals`
2. ☐ Execute Entry Gate（强制校验）
   - 当前 phase 不得为终态
   - board 非空且合法
   - 至少存在一个可写 implementer
   - CLI: 确认 `governance_signals.has_writable_worker === true`
3. ☐ 推断当前 team_phase + 提取可执行边界
   - CLI: `node team-cli.js next --project-id X --team-id Y`
   - 检查 `boundary_id` 和 `dependencies_met`
4. ☐ 执行边界任务（单/并行）
   - 单边界：直接执行
   - 多独立边界：可通过 `dispatching-parallel-agents` 并行
   - 执行完成后必须验证结果
5. ☐ Post-Execution Pipeline（每个 boundary 完成后）
   - 验证执行结果
   - 更新 board + state：`node team-cli.js advance <boundaryId> --project-id X --team-id Y`
   - 确认输出 `{ ok: true, board_updated: true, state_updated: true }`
   - 检查 `checkpoint_warning` 是否有 stale 提示
6. ☐ 判断下一步
   - 检查 `context` 输出的 `governance_signals.phase_transition_pending`
   - 仍有 pending → 继续 execute
   - 全部完成 → 进入 verify
   - 有失败 → 进入 fix
```

Action 3 Verify Contract checklist 对齐 workflow-review：

```markdown
## Action 3: Verify Contract

### Checklist（按序执行）

1. ☐ 汇总所有 boundary 执行结果
   - CLI: `node team-cli.js context --project-id X --team-id Y`
   - 确认 `board_summary.failed === 0`
2. ☐ Stage 1：合规验证（team spec 覆盖检查）
   - 对照 team spec，逐条验收每个 boundary 的输出
   - 检查文件是否创建/修改到位
3. ☐ Stage 2：集成验证（跨边界接口一致性）
   - 验证跨 boundary 的函数签名、类型定义、数据格式一致
   - 运行整体测试
4. ☐ 写入 team_review 结果
   - 更新 `team-state.json` 的 `team_review.overall_passed` 和 `team_review.reviewed_at`
5. ☐ 判定：completed / team-fix
   - `overall_passed === true` → completed
   - 存在失败 → 记录 `failed_boundaries` → team-fix
```

---

## T6: state-machine.md 增强 + spec 引用桩 ✅

**阶段**: implement
**状态**: completed
**Spec 参考**: AC-4, AC-5
**Plan 参考**: Slice 4
**需求 ID**: S8, S9
**创建文件**: 无
**修改文件**: `core/specs/team-runtime/state-machine.md`, `core/specs/team-runtime/execute-entry.md`, `core/specs/team-runtime/status.md`, `core/specs/team-runtime/archive.md`
**测试文件**: 无（文档）
**验收项**: AC-4, AC-5
**验证命令**: `node -e "const fs=require('fs');const sm=fs.readFileSync('core/specs/team-runtime/state-machine.md','utf8');const hasTable=sm.includes('语义对应');const ee=fs.readFileSync('core/specs/team-runtime/execute-entry.md','utf8');const st=fs.readFileSync('core/specs/team-runtime/status.md','utf8');const ar=fs.readFileSync('core/specs/team-runtime/archive.md','utf8');const stubs=[ee,st,ar].every(f=>f.includes('权威内容已整合至'));console.log(JSON.stringify({hasTable,stubs}))"`
**预期输出**: `{"hasTable":true,"stubs":true}`

### actions

- implement

### 步骤

**S1: 在 state-machine.md 末尾（约束章节之后）追加语义对应表**

```markdown
## 与 workflow 状态机的语义对应

> 两套状态机不是一一映射关系，而是语义层面的对应。team 的 phase 粒度更粗，
> 部分 workflow 内部状态在 team 中不存在独立表达。

| team phase | 语义等价的 workflow 阶段 | 差异说明 |
|-----------|------------------------|----------|
| `team-plan` | `planning` | team 的简化规划，无 `idle`/`spec_review` 独立阶段 |
| `team-exec` | `running` | 执行阶段语义一致 |
| `team-verify` | (无直接等价) | workflow 的审查内嵌在 `running` phase 的 `quality_review` task 中，team 独立为 phase |
| `team-fix` | `failed` + `--retry` | 修复子循环 |
| `completed` | `completed` | 语义一致 |
| `failed` | `failed` | 语义一致 |
| `archived` | `archived` | 语义一致 |

### 治理信号复用

team-execute 阶段复用以下 workflow 治理机制（轻量化）：
- **Phase 边界判断**：`inferTeamPhase()` 承担 phase 转换决策（不引入完整 ContextGovernor）
- **Post-Execution Pipeline**：boundary 完成后的验证 → 更新 board → 更新 state 流程
- **Quality Review CLI**：team-verify 可复用 `quality_review.js` 的 pass/fail 写入逻辑

> ContextGovernor 的 budget backstop 不复用到 team 层。
> 理由：orchestrator 自身 context 消耗较轻，boundary 执行由 sub-agent 完成，
> sub-agent 有独立的 context budget。
```

**S2: 在 execute-entry.md 文件头部（第 1 行之前）添加引用桩**

```markdown
> ⚠️ 本文档的权威内容已整合至 [`team-workflow/SKILL.md`](../../skills/team-workflow/SKILL.md) Action 2: Execute Contract。
> 本文件仅作为引用桩保留，防止交叉引用死链。如需修改请编辑 SKILL.md。

```

**S3: 在 status.md 文件头部添加引用桩**

```markdown
> ⚠️ 本文档的权威内容已整合至 [`team-workflow/SKILL.md`](../../skills/team-workflow/SKILL.md) Action 4: Status / Archive / Cleanup Contract。
> 本文件仅作为引用桩保留，防止交叉引用死链。如需修改请编辑 SKILL.md。

```

**S4: 在 archive.md 文件头部添加引用桩**

```markdown
> ⚠️ 本文档的权威内容已整合至 [`team-workflow/SKILL.md`](../../skills/team-workflow/SKILL.md) Action 4: Status / Archive / Cleanup Contract。
> 本文件仅作为引用桩保留，防止交叉引用死链。如需修改请编辑 SKILL.md。

```

---

## T7: 回归测试验证 ✅

**阶段**: test
**状态**: completed
**Spec 参考**: AC-6
**Plan 参考**: Slice 5
**需求 ID**: S12
**创建文件**: 无
**修改文件**: 无
**测试文件**: `tests/test_team_*.js`
**验收项**: AC-6 (回归)
**验证命令**: `node --test tests/test_team_*.js tests/test_phase_controller*.js`
**预期输出**: 所有测试通过，无回归

### actions

- test

### 步骤

**S1: 运行全量 team 相关测试**

```bash
node --test tests/test_team_*.js tests/test_phase_controller*.js
```

确认所有测试通过，没有现有测试因 phase-controller.js 或 team-cli.js 变更而失败。

---

## Self-Review Checklist

- [x] **Requirement coverage** — 12/12 需求段落（S1-S12）全部有对应 task（T1-T7）
- [x] **PRD 覆盖率** — prd-spec-coverage.json 中 0 个 partial/uncovered
- [x] **Placeholder scan** — 0 个 TBD/TODO/模糊描述
- [x] **Type consistency** — `canEnterPhase` / `getPhaseTransitionReason` 在 T1 定义、T2 测试、T3 调用，名称一致
- [x] **Command accuracy** — CLI 命令语法和文件路径与现有代码一致
- [x] **Gaps** — 无遗漏，T7 覆盖回归验证

---

## Verification Summary

| Task | Requirement IDs | Spec Ref | Files | Verification Command | Expected |
|------|-----------------|----------|-------|---------------------|----------|
| T1 | S10 | AC-3 | phase-controller.js | `node --test tests/test_phase_controller_enhanced.js` | all pass |
| T2 | S12 | AC-6 | test_phase_controller_enhanced.js | `node --test tests/test_phase_controller_enhanced.js` | all pass |
| T3 | S6,S7,S11 | AC-2 | team-cli.js | `node --test tests/test_team_cli_commands.js` | all pass |
| T4 | S12 | AC-6 | test_team_cli_commands.js | `node --test tests/test_team_cli_commands.js` | all pass |
| T5 | S1-S5 | AC-1 | SKILL.md | structure validation script | gates+actions present |
| T6 | S8,S9 | AC-4,AC-5 | state-machine.md, 3 spec stubs | content validation script | table+stubs present |
| T7 | S12 | AC-6 | test_team_*.js | `node --test tests/test_team_*.js` | no regression |
