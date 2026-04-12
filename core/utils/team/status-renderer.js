/**
 * @file 团队状态渲染器 - 将团队运行时状态和任务看板聚合为结构化的状态快照
 */
const { summarizeTaskBoard } = require('./task-board')
const { buildExecuteSummary } = require('./phase-controller')

/**
 * 从任务看板中筛选指定状态的边界 ID 列表
 * @param {Array} board - 任务看板数组
 * @param {string} status - 目标状态（如 'pending'、'failed'、'in_progress'）
 * @returns {string[]} 匹配状态的边界 ID 数组
 */
function pickBoundaries(board = [], status) {
  return Array.isArray(board) ? board.filter((item) => item.status === status).map((item) => item.id) : []
}

/**
 * 精简 worker 名册信息，提取关键字段用于状态展示
 * @param {Array} workerRoster - 完整的 worker 名册数组
 * @returns {Object[]} 精简后的 worker 摘要数组
 */
function summarizeRoster(workerRoster = []) {
  return workerRoster.map((worker) => ({
    worker_id: worker.worker_id,
    role: worker.role,
    profile: worker.profile_ref?.profile || null,
    writable: Boolean(worker.writable),
    status: worker.status,
    current_boundary_id: worker.current_boundary_id || null,
  }))
}

/**
 * 根据当前状态和看板生成下一步操作建议
 * @param {Object} state - 团队运行时状态
 * @param {Array} board - 任务看板数组
 * @returns {string|Object} 下一步操作建议
 */
function buildNextStepSuggestion(state, board) {
  const summary = buildExecuteSummary(state, board)
  return summary.next_action
}

/**
 * 构建完整的团队状态快照，聚合任务摘要、边界状态、worker 名册等信息
 * @param {Object} state - 团队运行时状态
 * @param {Array} board - 任务看板数组
 * @returns {Object} 包含团队全部状态信息的结构化对象
 */
function buildTeamStatus(state, board) {
  const taskSummary = summarizeTaskBoard(board)
  const failedBoundaries = pickBoundaries(board, 'failed')
  const pendingBoundaries = pickBoundaries(board, 'pending')
  const inProgressBoundaries = pickBoundaries(board, 'in_progress')
  const executeSummary = buildExecuteSummary(state, board)

  return {
    team_id: state.team_id,
    team_name: state.team_name,
    status: state.status,
    team_phase: state.team_phase,
    spec_file: state.spec_file,
    plan_file: state.plan_file,
    team_tasks_file: state.team_tasks_file,
    task_summary: taskSummary,
    current_tasks: state.current_tasks || [],
    pending_boundaries: pendingBoundaries,
    in_progress_boundaries: inProgressBoundaries,
    failed_boundaries: failedBoundaries,
    review: state.team_review || {},
    fix_loop: state.fix_loop || {},
    worker_roster: summarizeRoster(state.worker_roster || []),
    boundary_claims: state.boundary_claims || {},
    dispatch_metadata: state.dispatch_metadata || null,
    governance: state.governance || {},
    board_valid: executeSummary.board_valid,
    board_error: executeSummary.board_error,
    has_writable_worker: executeSummary.has_writable_worker,
    available_claims: executeSummary.available_claims,
    idle_is_normal: true,
    next_action: buildNextStepSuggestion(state, board),
    updated_at: state.updated_at,
  }
}

module.exports = {
  buildTeamStatus,
}
