const fs = require('fs')
const path = require('path')

function buildTeamTaskBoard(tasks) {
  return tasks.map((task) => ({
    id: task.id,
    name: task.name || task.id,
    source_task_ids: [task.id],
    phase: task.phase || 'implement',
    status: task.status || 'pending',
    depends: task.depends || [],
    blocked_by: task.blocked_by || [],
    files: task.files || {},
    acceptance_criteria: task.acceptance_criteria || [],
    critical_constraints: task.critical_constraints || [],
    parallelism: {
      mode: 'team',
      dispatch_strategy: 'internal-team-orchestrator',
      dispatch_skill_invoked: false,
    },
    owner: null,
    result: null,
  }))
}

function readTaskBoard(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeTaskBoard(filePath, board) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(board, null, 2)}\n`)
}

function summarizeTaskBoard(board) {
  const summary = { total: board.length, pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 }
  for (const item of board) {
    const status = item.status || 'pending'
    if (Object.hasOwn(summary, status)) summary[status] += 1
  }
  return summary
}

module.exports = {
  buildTeamTaskBoard,
  readTaskBoard,
  writeTaskBoard,
  summarizeTaskBoard,
}
