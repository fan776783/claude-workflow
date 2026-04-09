const fs = require('fs')
const path = require('path')

function defaultLifecycleForStatus(status = 'pending') {
  if (status === 'in_progress') return { run_state: 'in_progress', attempt: 0, last_transition_at: null }
  if (status === 'completed') return { run_state: 'verified', attempt: 0, last_transition_at: null }
  if (status === 'failed') return { run_state: 'failed', attempt: 1, last_transition_at: null }
  if (status === 'blocked') return { run_state: 'blocked', attempt: 0, last_transition_at: null }
  if (status === 'skipped') return { run_state: 'skipped', attempt: 0, last_transition_at: null }
  return { run_state: 'pending', attempt: 0, last_transition_at: null }
}

function defaultVerificationForPhase(phase = 'implement') {
  if (phase === 'planning') {
    return { required: false, status: 'pending', reviewer_role: 'planner', profile: 'plan-planner', verified_at: null, failed_reason: null }
  }
  if (phase === 'review') {
    return { required: true, status: 'pending', reviewer_role: 'reviewer', profile: 'review-reviewer', verified_at: null, failed_reason: null }
  }
  return { required: true, status: 'pending', reviewer_role: 'reviewer', profile: 'review-reviewer', verified_at: null, failed_reason: null }
}

function normalizeBoardItem(task = {}, index = 0) {
  const phase = task.phase || 'implement'
  const status = task.status || 'pending'
  const lifecycle = task.lifecycle && typeof task.lifecycle === 'object'
    ? {
        run_state: task.lifecycle.run_state || defaultLifecycleForStatus(status).run_state,
        attempt: Number(task.lifecycle.attempt || 0),
        last_transition_at: task.lifecycle.last_transition_at || null,
      }
    : defaultLifecycleForStatus(status)
  const verification = task.verification && typeof task.verification === 'object'
    ? {
        ...defaultVerificationForPhase(phase),
        ...task.verification,
      }
    : defaultVerificationForPhase(phase)

  return {
    id: task.id || `B${index + 1}`,
    name: task.name || task.id || `Boundary ${index + 1}`,
    source_task_ids: Array.isArray(task.source_task_ids) ? task.source_task_ids : [task.source_task_id || task.id || `B${index + 1}`],
    phase,
    status,
    depends: Array.isArray(task.depends) ? task.depends : [],
    blocked_by: Array.isArray(task.blocked_by) ? task.blocked_by : [],
    files: task.files || {},
    acceptance_criteria: Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [],
    critical_constraints: Array.isArray(task.critical_constraints) ? task.critical_constraints : [],
    parallelism: {
      mode: 'team',
      dispatch_strategy: task.parallelism?.dispatch_strategy || 'internal-team-orchestrator',
      dispatch_skill_invoked: Boolean(task.parallelism?.dispatch_skill_invoked),
    },
    owner: task.owner || null,
    ownership: task.ownership || null,
    claim: task.claim || null,
    lifecycle,
    verification,
    evidence_refs: Array.isArray(task.evidence_refs) ? task.evidence_refs : [],
    result: task.result || null,
  }
}

function buildTeamTaskBoard(tasks) {
  return tasks.map((task, index) => normalizeBoardItem(task, index))
}

function readTaskBoard(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).map((item, index) => normalizeBoardItem(item, index))
}

function writeTaskBoard(filePath, board) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const normalized = Array.isArray(board) ? board.map((item, index) => normalizeBoardItem(item, index)) : []
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`)
}

function summarizeTaskBoard(board) {
  const summary = { total: board.length, pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0, skipped: 0 }
  for (const item of board) {
    const status = item.status || 'pending'
    if (Object.hasOwn(summary, status)) summary[status] += 1
  }
  return summary
}

module.exports = {
  normalizeBoardItem,
  buildTeamTaskBoard,
  readTaskBoard,
  writeTaskBoard,
  summarizeTaskBoard,
}
