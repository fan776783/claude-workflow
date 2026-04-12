#!/usr/bin/env node
/**
 * @file 团队 CLI 入口 - 解析命令行参数并分发到对应的团队生命周期命令
 */

const { cmdTeamArchive, cmdTeamCleanup, cmdTeamExecute, cmdTeamStart, cmdTeamStatus } = require('./lifecycle')
const fs = require('fs')
const { readTeamState, writeTeamState, detectActiveTeamState, getTeamStatePath, isoNow } = require('./state-manager')
const { readTaskBoard, writeTaskBoard, summarizeTaskBoard } = require('./task-board')
const { inferTeamPhase, buildExecuteSummary, hasWritableWorker, claimableRoleForPhase, canEnterPhase, getPhaseTransitionReason } = require('./phase-controller')

/**
 * 解析命令行参数，提取选项、子命令和需求文本
 * @param {string[]} argv - 命令行参数数组（不含 node 和脚本路径）
 * @returns {{options: Object, command: string|undefined, requirement: string|undefined}} 解析结果
 */
function parseArgs(argv) {
  const args = [...argv]
  const options = { projectId: undefined, projectRoot: undefined, teamId: undefined, force: false, noDiscuss: false, summary: false, teamName: undefined }
  const positionals = []

  while (args.length) {
    const token = args.shift()
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    if (token === '--project-id') options.projectId = args.shift()
    else if (token === '--project-root') options.projectRoot = args.shift()
    else if (token === '--team-id') options.teamId = args.shift()
    else if (token === '--team-name') options.teamName = args.shift()
    else if (token === '--force') options.force = true
    else if (token === '--no-discuss') options.noDiscuss = true
    else if (token === '--summary') options.summary = true
    else throw new Error(`Unknown flag: ${token}`)
  }

  const candidate = positionals.shift()
  if (!candidate) return { options, command: undefined, requirement: undefined }
  if (['start', 'execute', 'status', 'archive', 'cleanup', 'context', 'next', 'advance'].includes(candidate)) {
    const requirement = positionals.join(' ').trim()
    return { options, command: candidate, requirement: requirement || undefined }
  }
  return { options, command: 'start', requirement: [candidate, ...positionals].join(' ').trim() }
}

/**
 * 根据选项解析 team state 路径
 */
function resolveTeamStatePath(options) {
  if (options.projectId && options.teamId) {
    const p = getTeamStatePath(options.projectId, options.teamId)
    if (p && fs.existsSync(p)) return p
  }
  if (options.projectId) {
    return detectActiveTeamState(options.projectId)
  }
  return null
}

/**
 * 聚合 team 执行上下文（只读，不经过 lifecycle）
 */
function cmdContext(options) {
  const statePath = resolveTeamStatePath(options)
  if (!statePath) return { error: 'no active team runtime found', exitCode: 1 }
  const state = readTeamState(statePath, options.projectId, options.teamId)
  const boardPath = state.team_tasks_file
  if (!boardPath || !fs.existsSync(boardPath)) {
    return { error: 'team task board not found', exitCode: 1 }
  }
  const board = readTaskBoard(boardPath)
  const summary = summarizeTaskBoard(board)
  const executeSummary = buildExecuteSummary(state, board)
  const transitionReason = getPhaseTransitionReason(board, state.team_phase)
  const nextItem = executeSummary.pending_boundaries.length > 0
    ? board.find((b) => b.id === executeSummary.pending_boundaries[0])
    : null

  return {
    team_phase: executeSummary.team_phase,
    status: state.status,
    board_summary: summary,
    next_boundary: nextItem
      ? { id: nextItem.id, phase: nextItem.phase || 'implement', blocked_by: nextItem.blocked_by || [] }
      : null,
    governance_signals: {
      has_writable_worker: executeSummary.has_writable_worker,
      phase_transition_pending: transitionReason.next_phase !== executeSummary.team_phase,
    },
    team_review: state.team_review
      ? { overall_passed: state.team_review.overall_passed, reviewed_at: state.team_review.reviewed_at }
      : { overall_passed: false, reviewed_at: null },
  }
}

/**
 * 返回下一个可执行的 boundary（只读，不经过 lifecycle）
 */
function cmdNext(options) {
  const statePath = resolveTeamStatePath(options)
  if (!statePath) return { error: 'no active team runtime found', exitCode: 1 }
  const state = readTeamState(statePath, options.projectId, options.teamId)
  const boardPath = state.team_tasks_file
  if (!boardPath || !fs.existsSync(boardPath)) {
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
    claim_status: (item.claim && item.claim.claim_status) || (state.boundary_claims && state.boundary_claims[claim.id] && state.boundary_claims[claim.id].claim_status) || 'unclaimed',
    claimable_role: claim.role,
    dependencies_met: !item.blocked_by || item.blocked_by.length === 0,
  }
}

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
  if (!boardPath || !fs.existsSync(boardPath)) {
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

/**
 * 输出 CLI 使用帮助信息
 */
function printHelp() {
  process.stdout.write(`team CLI

Usage:
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] start <requirement|path> [--force] [--no-discuss] [--team-name NAME]
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] execute
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] status
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] archive [--summary]
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] cleanup
  node team-cli.js [--project-id ID] [--team-id ID] context
  node team-cli.js [--project-id ID] [--team-id ID] next
  node team-cli.js [--project-id ID] [--team-id ID] advance <boundaryId>

Notes:
  start bootstraps a dedicated team runtime and writes team-specific planning artifacts.
  execute/status/archive/cleanup operate on that team runtime only.
  context returns aggregated team execution context (read-only).
  next returns the next executable boundary (read-only).
  advance marks a boundary as completed and updates board + state.
`)
}

/**
 * CLI 主入口，解析参数后调用对应的团队生命周期命令并输出 JSON 结果
 */
function main() {
  try {
    const { options, command, requirement } = parseArgs(process.argv.slice(2))
    let result
    if (command === 'start') {
      if (!requirement) throw new Error('start requires a requirement or requirement file')
      result = cmdTeamStart(requirement, { ...options, invocationSource: 'team-command' })
    } else if (command === 'execute') {
      result = cmdTeamExecute({ ...options, invocationSource: 'team-command', allowActiveFallback: true })
    } else if (command === 'status') {
      result = cmdTeamStatus({ ...options, invocationSource: 'team-command', allowActiveFallback: true })
    } else if (command === 'archive') {
      result = cmdTeamArchive({ ...options, invocationSource: 'team-command', allowActiveFallback: true })
    } else if (command === 'cleanup') {
      result = cmdTeamCleanup({ ...options, invocationSource: 'team-command' })
    } else if (command === 'context') {
      result = cmdContext(options)
      if (result && result.exitCode) { process.exitCode = result.exitCode }
    } else if (command === 'next') {
      result = cmdNext(options)
      if (result && result.exitCode) { process.exitCode = result.exitCode }
    } else if (command === 'advance') {
      if (!requirement) throw new Error('advance requires a boundary ID')
      result = cmdAdvance(requirement, options)
    } else {
      printHelp()
      process.exitCode = command ? 1 : 0
      return
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

main()
