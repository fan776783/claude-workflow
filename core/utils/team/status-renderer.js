const { summarizeTaskBoard } = require('./task-board')
const { buildExecuteSummary } = require('./phase-controller')

function pickBoundaries(board = [], status) {
  return Array.isArray(board) ? board.filter((item) => item.status === status).map((item) => item.id) : []
}

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

function buildNextStepSuggestion(state, board) {
  const summary = buildExecuteSummary(state, board)
  return summary.next_action
}

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
