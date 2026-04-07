const { summarizeTaskBoard } = require('./task-board')

function buildTeamStatus(state, board) {
  return {
    team_id: state.team_id,
    team_name: state.team_name,
    status: state.status,
    team_phase: state.team_phase,
    spec_file: state.spec_file,
    plan_file: state.plan_file,
    team_tasks_file: state.team_tasks_file,
    task_summary: summarizeTaskBoard(board),
    current_tasks: state.current_tasks || [],
    governance: state.governance || {},
    updated_at: state.updated_at,
  }
}

module.exports = {
  buildTeamStatus,
}
