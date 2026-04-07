function inferTeamPhase(board, currentPhase = 'team-plan') {
  if (currentPhase === 'team-plan') return 'team-plan'
  if (!board.length) return currentPhase
  const failed = board.filter((item) => item.status === 'failed')
  const inProgress = board.filter((item) => item.status === 'in_progress')
  const pending = board.filter((item) => item.status === 'pending')
  const completed = board.filter((item) => item.status === 'completed')

  if (failed.length) return 'team-fix'
  if (inProgress.length || pending.length) return 'team-exec'
  if (completed.length === board.length) return 'team-verify'
  return currentPhase
}

function buildExecuteSummary(state, board) {
  const teamPhase = inferTeamPhase(board, state.team_phase || 'team-plan')
  const pendingBoundaries = board.filter((item) => item.status === 'pending').map((item) => item.id)
  const failedBoundaries = board.filter((item) => item.status === 'failed').map((item) => item.id)

  let nextAction = 'complete-team-run'
  if (teamPhase === 'team-plan') nextAction = 'review-team-plan'
  else if (teamPhase === 'team-exec' && pendingBoundaries.length) nextAction = 'execute-next-boundary'
  else if (teamPhase === 'team-verify') nextAction = 'run-team-verification'
  else if (teamPhase === 'team-fix') nextAction = 'repair-failed-boundaries'

  return { team_phase: teamPhase, next_action: nextAction, pending_boundaries: pendingBoundaries, failed_boundaries: failedBoundaries }
}

module.exports = {
  inferTeamPhase,
  buildExecuteSummary,
}
