const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TEAM_STATE_FILENAME = 'team-state.json'
const TEAM_ID_REGEX = /^[a-zA-Z0-9_-]+$/

function isoNow() {
  return new Date().toISOString()
}

function validateTeamId(teamId) {
  return Boolean(teamId && TEAM_ID_REGEX.test(teamId))
}

function getTeamsProjectDir(projectId) {
  if (!TEAM_ID_REGEX.test(projectId || '')) return null
  return path.join(os.homedir(), '.claude', 'workflows', projectId, 'teams')
}

function getTeamDir(projectId, teamId) {
  const root = getTeamsProjectDir(projectId)
  if (!root || !validateTeamId(teamId)) return null
  return path.join(root, teamId)
}

function getTeamStatePath(projectId, teamId) {
  const teamDir = getTeamDir(projectId, teamId)
  return teamDir ? path.join(teamDir, TEAM_STATE_FILENAME) : null
}

function assertCanonicalTeamStatePath(statePath, projectId, teamId) {
  const resolved = path.resolve(statePath)
  const workflowsRoot = path.resolve(path.join(os.homedir(), '.claude', 'workflows'))
  if (!resolved.startsWith(`${workflowsRoot}${path.sep}`)) {
    throw new Error('team-state.json must be stored under ~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json')
  }
  if (path.basename(resolved) !== TEAM_STATE_FILENAME) {
    throw new Error('invalid team state filename')
  }
  const relative = path.relative(workflowsRoot, resolved).split(path.sep)
  if (relative.length !== 4 || relative[1] !== 'teams') {
    throw new Error('team-state.json must be stored under ~/.claude/workflows/{projectId}/teams/{teamId}/team-state.json')
  }
  const detectedProjectId = relative[0]
  const detectedTeamId = relative[2]
  if (projectId && detectedProjectId !== projectId) throw new Error('team state project_id mismatch')
  if (teamId && detectedTeamId !== teamId) throw new Error('team state team_id mismatch')
  if (!TEAM_ID_REGEX.test(detectedProjectId) || !validateTeamId(detectedTeamId)) {
    throw new Error('invalid project_id or team_id')
  }
  return resolved
}

function ensureTeamStateDefaults(state) {
  return {
    status: 'planning',
    team_phase: 'team-plan',
    current_tasks: [],
    worker_roster: [],
    dispatch_batches: [],
    team_review: { overall_passed: false, reviewed_at: null, notes: [] },
    fix_loop: { attempt: 0, current_failed_boundaries: [] },
    quality_gates: {},
    progress: { completed: [], blocked: [], failed: [], skipped: [] },
    continuation: { strategy: 'explicit-team', last_decision: null, handoff_required: false, artifact_path: null },
    governance: { explicit_invocation_only: true, auto_trigger_allowed: false, parallel_dispatch_mode: 'internal-team-only' },
    created_at: state?.updated_at || isoNow(),
    updated_at: isoNow(),
    ...state,
  }
}

function buildMinimumTeamState({ projectId, teamId, teamName, projectRoot, specFile, planFile, teamTasksFile }) {
  const now = isoNow()
  return ensureTeamStateDefaults({
    project_id: projectId,
    team_id: teamId,
    team_name: teamName,
    project_root: projectRoot,
    status: 'planning',
    team_phase: 'team-plan',
    current_tasks: [],
    spec_file: specFile,
    plan_file: planFile,
    team_tasks_file: teamTasksFile,
    created_at: now,
    updated_at: now,
  })
}

function readTeamState(statePath, projectId, teamId) {
  const resolved = assertCanonicalTeamStatePath(statePath, projectId, teamId)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function writeTeamState(statePath, state, projectId, teamId) {
  const resolved = assertCanonicalTeamStatePath(statePath, projectId || state.project_id, teamId || state.team_id)
  const payload = ensureTeamStateDefaults(state)
  payload.updated_at = isoNow()
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const tmpPath = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2))
  fs.renameSync(tmpPath, resolved)
}

function detectActiveTeamState(projectId) {
  const root = getTeamsProjectDir(projectId)
  if (!root || !fs.existsSync(root)) return null
  for (const entry of fs.readdirSync(root).sort()) {
    const statePath = path.join(root, entry, TEAM_STATE_FILENAME)
    if (!fs.existsSync(statePath)) continue
    try {
      const state = readTeamState(statePath, projectId, entry)
      if (state.status !== 'archived') return statePath
    } catch {}
  }
  return null
}

module.exports = {
  TEAM_STATE_FILENAME,
  isoNow,
  validateTeamId,
  getTeamsProjectDir,
  getTeamDir,
  getTeamStatePath,
  assertCanonicalTeamStatePath,
  ensureTeamStateDefaults,
  buildMinimumTeamState,
  readTeamState,
  writeTeamState,
  detectActiveTeamState,
}
