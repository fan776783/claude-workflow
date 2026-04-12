/** Team 阶段控制器 —— 负责任务面板校验、阶段推断、审查状态验证和执行摘要构建 */

const TERMINAL_PHASES = new Set(['completed', 'failed', 'archived'])
const VALID_PHASES = new Set(['team-plan', 'team-exec', 'team-verify', 'team-fix', 'completed', 'failed', 'archived'])
const VALID_BOARD_STATUSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'blocked', 'skipped'])
const VALID_LIFECYCLE_STATES = new Set(['pending', 'claimed', 'in_progress', 'awaiting_verify', 'verified', 'failed', 'blocked', 'skipped'])

/**
 * 校验任务面板的结构完整性：检查 ID 唯一性、状态和生命周期合法性
 * @param {object[]} board - 任务面板数组
 * @returns {object} 校验结果，含 ok 和可能的 error
 */
function validateBoard(board) {
  if (!Array.isArray(board) || board.length === 0) {
    return { ok: false, error: 'team task board is empty' }
  }

  const ids = new Set()
  for (const item of board) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'team task board contains invalid item' }
    }
    if (!item.id || typeof item.id !== 'string') {
      return { ok: false, error: 'team task board item missing id' }
    }
    if (ids.has(item.id)) {
      return { ok: false, error: `team task board contains duplicate id: ${item.id}` }
    }
    ids.add(item.id)
    const status = item.status || 'pending'
    if (!VALID_BOARD_STATUSES.has(status)) {
      return { ok: false, error: `team task board item has invalid status: ${item.id}:${status}` }
    }
    const runState = item.lifecycle?.run_state
    if (runState && !VALID_LIFECYCLE_STATES.has(runState)) {
      return { ok: false, error: `team task board item has invalid lifecycle: ${item.id}:${runState}` }
    }
  }

  return { ok: true }
}

/**
 * 检查 worker 名册中是否存在可写入的 worker
 * @param {object[]} workerRoster - worker 名册
 * @returns {boolean} 存在可写 worker 时返回 true
 */
function hasWritableWorker(workerRoster = []) {
  return Array.isArray(workerRoster) && workerRoster.some((worker) => worker?.writable === true)
}

/**
 * 根据阶段名称返回对应的可认领角色
 * @param {string} phase - 阶段名称
 * @returns {string} 角色名（planner / reviewer / implementer）
 */
function claimableRoleForPhase(phase = '') {
  if (phase === 'planning') return 'planner'
  if (phase === 'review') return 'reviewer'
  return 'implementer'
}

/**
 * 根据任务面板状态和当前阶段推断下一个 team 阶段
 * @param {object[]} board - 任务面板
 * @param {string} currentPhase - 当前阶段
 * @param {object} options - 可选参数，含 state
 * @returns {string} 推断出的阶段名称
 */
function inferTeamPhase(board, currentPhase = 'team-plan', options = {}) {
  if (TERMINAL_PHASES.has(currentPhase)) return currentPhase
  if (!VALID_PHASES.has(currentPhase)) return 'failed'

  const boardValidation = validateBoard(board)
  if (!boardValidation.ok) return 'failed'

  const state = options.state || {}
  const items = Array.isArray(board) ? board : []
  const byPhase = (phase) => items.filter((item) => item.phase === phase)
  const activeStatuses = new Set(['pending', 'in_progress', 'blocked'])
  const hasActive = (phase) => byPhase(phase).some((item) => activeStatuses.has(item.status || 'pending'))
  const hasFailed = (phase) => byPhase(phase).some((item) => item.status === 'failed')
  const hasCompleted = (phase) => byPhase(phase).some((item) => item.status === 'completed')
  const review = state.team_review || {}

  if (currentPhase === 'team-plan') return hasActive('planning') ? 'team-plan' : 'team-exec'
  if (hasActive('planning')) return 'team-plan'
  if (hasFailed('implement') || hasFailed('review') || hasFailed('fix')) return 'team-fix'
  if (hasActive('implement')) return 'team-exec'
  if (currentPhase === 'team-fix') {
    if (hasActive('fix')) return 'team-fix'
    if (hasCompleted('fix')) return 'team-verify'
  }
  if (hasActive('review')) return 'team-verify'
  if (review.overall_passed === true && review.reviewed_at) return 'completed'
  if (hasActive('fix') || hasCompleted('fix')) return 'team-fix'
  return 'team-verify'
}

/**
 * 验证审查状态，判断是否可以完成、需要修复或继续执行
 * @param {object} state - team 状态对象
 * @param {object[]} board - 任务面板
 * @returns {object} 验证结果，含 ok、decision 和 failed_boundaries
 */
function validateReviewState(state = {}, board = []) {
  const review = state.team_review || {}
  const failedBoundaries = Array.isArray(board) ? board.filter((item) => item.status === 'failed').map((item) => item.id) : []
  const completedBoundaries = Array.isArray(board) ? board.filter((item) => item.status === 'completed').map((item) => item.id) : []

  if (!review || typeof review !== 'object') {
    return { ok: false, reason: 'team_review_missing', failed_boundaries: failedBoundaries }
  }

  if (review.overall_passed === true) {
    if (!review.reviewed_at) {
      return { ok: false, reason: 'team_review.reviewed_at_missing', failed_boundaries: failedBoundaries }
    }
    return { ok: true, decision: 'completed', failed_boundaries: [] }
  }

  if (failedBoundaries.length > 0) {
    return { ok: true, decision: 'team-fix', failed_boundaries: failedBoundaries }
  }

  if (completedBoundaries.length === board.length) {
    return { ok: false, reason: 'team_review_not_passed', failed_boundaries: [] }
  }

  return { ok: true, decision: 'team-exec', failed_boundaries: [] }
}

/**
 * 构建执行摘要：推断阶段、计算待处理/失败边界、确定下一步操作
 * @param {object} state - team 状态对象
 * @param {object[]} board - 任务面板
 * @returns {object} 执行摘要，含 team_phase、next_action、pending/failed_boundaries 等
 */
function buildExecuteSummary(state, board) {
  const boardValidation = validateBoard(board)
  const teamPhase = inferTeamPhase(board, state.team_phase || 'team-plan', { state })
  const pendingBoundaries = Array.isArray(board) ? board.filter((item) => item.status === 'pending').map((item) => item.id) : []
  const failedBoundaries = Array.isArray(board) ? board.filter((item) => item.status === 'failed').map((item) => item.id) : []
  const availableClaims = Array.isArray(board)
    ? board.filter((item) => item.status === 'pending' && (!item.blocked_by || item.blocked_by.length === 0)).map((item) => ({ id: item.id, role: claimableRoleForPhase(item.phase) }))
    : []

  let nextAction = 'complete-team-run'
  if (teamPhase === 'team-plan') nextAction = 'complete-planning-boundary'
  else if (teamPhase === 'team-exec' && pendingBoundaries.length) nextAction = 'execute-next-boundary'
  else if (teamPhase === 'team-verify') nextAction = 'run-team-verification'
  else if (teamPhase === 'team-fix') nextAction = 'repair-failed-boundaries'
  else if (teamPhase === 'completed') nextAction = 'archive-or-start-new-team-run'
  else if (teamPhase === 'failed') nextAction = 'repair-team-runtime-or-rerun-team-start'
  else if (teamPhase === 'archived') nextAction = 'cleanup-or-start-new-team-run'

  return {
    team_phase: teamPhase,
    next_action: nextAction,
    pending_boundaries: pendingBoundaries,
    failed_boundaries: failedBoundaries,
    available_claims: availableClaims,
    board_valid: boardValidation.ok,
    board_error: boardValidation.ok ? null : boardValidation.error,
    has_writable_worker: hasWritableWorker(state.worker_roster),
  }
}

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
