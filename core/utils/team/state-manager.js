const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TEAM_STATE_FILENAME = 'team-state.json'
const TEAM_ID_REGEX = /^[a-zA-Z0-9_-]+$/
const VALID_WORKER_STATUSES = new Set(['idle', 'ready', 'claimed', 'running', 'blocked', 'verifying', 'completed', 'failed', 'offline'])

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

function claimablePhasesForRole(role) {
  if (role === 'orchestrator') return ['planning', 'implement', 'review', 'fix']
  if (role === 'planner') return ['planning']
  if (role === 'reviewer') return ['review']
  if (role === 'implementer') return ['implement', 'fix']
  return []
}

function defaultProfileRefForRole(role) {
  if (role === 'planner') return { phase: 'plan_generation', role: 'planner', profile: 'plan-planner', source: 'workflow-role-profiles' }
  if (role === 'reviewer') return { phase: 'quality_review_stage2', role: 'reviewer', profile: 'review-reviewer', source: 'workflow-role-profiles' }
  return null
}

function normalizeWorkerRole(role = '') {
  const normalized = String(role || '').trim().toLowerCase()
  return normalized || 'implementer'
}

function normalizeWorkerStatus(status = '', role = 'implementer') {
  const normalized = String(status || '').trim().toLowerCase()
  if (VALID_WORKER_STATUSES.has(normalized)) return normalized
  if (normalized === 'active') return role === 'orchestrator' ? 'running' : 'ready'
  return role === 'orchestrator' ? 'running' : 'idle'
}

function normalizeProfileRef(profileRef, role) {
  if (profileRef && typeof profileRef === 'object') return profileRef
  if (typeof profileRef === 'string' && profileRef.trim()) {
    return { phase: null, role, profile: profileRef.trim(), source: 'team-runtime' }
  }
  return defaultProfileRefForRole(role)
}

function normalizeWorkerId(worker = {}, index = 0, role = 'implementer') {
  if (worker.worker_id && typeof worker.worker_id === 'string') return worker.worker_id
  const fallbackIndex = role === 'orchestrator' ? 1 : index + 1
  return `${role}-${fallbackIndex}`
}

function normalizeWorkerRoster(roster = []) {
  if (!Array.isArray(roster)) return []
  return roster.map((worker, index) => {
    const role = normalizeWorkerRole(worker?.role || worker?.owner || '')
    return {
      worker_id: normalizeWorkerId(worker, index, role),
      name: worker?.name || role,
      role,
      profile_ref: normalizeProfileRef(worker?.profile_ref || worker?.profile, role),
      writable: typeof worker?.writable === 'boolean' ? worker.writable : role === 'implementer',
      claimable_phases: Array.isArray(worker?.claimable_phases) ? worker.claimable_phases : claimablePhasesForRole(role),
      status: normalizeWorkerStatus(worker?.status, role),
      current_boundary_id: worker?.current_boundary_id || null,
      specialist_tags: Array.isArray(worker?.specialist_tags) ? worker.specialist_tags : [],
      last_transition_at: worker?.last_transition_at || null,
    }
  })
}

function normalizeBoundaryClaims(boundaryClaims = {}, roster = []) {
  const claims = {}
  const rosterByRole = new Map(roster.map((worker) => [worker.role, worker.worker_id]))

  const seedClaim = (boundaryId, source = {}) => {
    const assignedRole = normalizeWorkerRole(source.assigned_role || '') || 'implementer'
    claims[boundaryId] = {
      assigned_role: assignedRole,
      current_worker_id: source.current_worker_id || rosterByRole.get(assignedRole) || null,
      claim_status: source.claim_status || 'unclaimed',
      claim_version: Number(source.claim_version || 0),
      attempt: Number(source.attempt || 0),
      claimed_at: source.claimed_at || null,
      released_at: source.released_at || null,
      reassign_reason: source.reassign_reason || null,
      history: Array.isArray(source.history) ? source.history : [],
      profile_ref: source.profile_ref || defaultProfileRefForRole(assignedRole),
    }
  }

  if (boundaryClaims && typeof boundaryClaims === 'object' && !Array.isArray(boundaryClaims)) {
    for (const [boundaryId, claim] of Object.entries(boundaryClaims)) {
      if (!boundaryId) continue
      seedClaim(boundaryId, claim || {})
    }
  }

  return claims
}

function ensureTeamStateDefaults(state) {
  const seeded = {
    status: 'planning',
    team_phase: 'team-plan',
    current_tasks: [],
    worker_roster: [],
    dispatch_batches: [],
    boundary_claims: {},
    team_review: { overall_passed: false, reviewed_at: null, notes: [], failed_boundaries: [], quality_gate_ids: [], evidence_summary: [] },
    fix_loop: { attempt: 0, current_failed_boundaries: [] },
    quality_gates: {},
    progress: { completed: [], blocked: [], failed: [], skipped: [] },
    continuation: { strategy: 'explicit-team', last_decision: null, handoff_required: false, artifact_path: null },
    governance: { explicit_invocation_only: true, auto_trigger_allowed: false, parallel_dispatch_mode: 'internal-team-only' },
    activation: { mode: 'explicit-team-command', entry: 'team', auto_trigger_allowed: false },
    created_at: state?.created_at || state?.updated_at || isoNow(),
    updated_at: isoNow(),
    ...state,
  }

  const workerRoster = normalizeWorkerRoster(seeded.worker_roster)
  const boundaryClaims = normalizeBoundaryClaims(seeded.boundary_claims, workerRoster)

  return {
    ...seeded,
    current_tasks: Array.isArray(seeded.current_tasks) ? seeded.current_tasks : [],
    worker_roster: workerRoster,
    boundary_claims: boundaryClaims,
    dispatch_batches: Array.isArray(seeded.dispatch_batches) ? seeded.dispatch_batches : [],
    team_review: {
      overall_passed: Boolean(seeded.team_review?.overall_passed),
      reviewed_at: seeded.team_review?.reviewed_at || null,
      notes: Array.isArray(seeded.team_review?.notes) ? seeded.team_review.notes : [],
      failed_boundaries: Array.isArray(seeded.team_review?.failed_boundaries) ? seeded.team_review.failed_boundaries : [],
      quality_gate_ids: Array.isArray(seeded.team_review?.quality_gate_ids) ? seeded.team_review.quality_gate_ids : [],
      evidence_summary: Array.isArray(seeded.team_review?.evidence_summary) ? seeded.team_review.evidence_summary : [],
    },
    fix_loop: {
      attempt: Number(seeded.fix_loop?.attempt || 0),
      current_failed_boundaries: Array.isArray(seeded.fix_loop?.current_failed_boundaries) ? seeded.fix_loop.current_failed_boundaries : [],
    },
    quality_gates: seeded.quality_gates && typeof seeded.quality_gates === 'object' ? seeded.quality_gates : {},
    progress: {
      completed: Array.isArray(seeded.progress?.completed) ? seeded.progress.completed : [],
      blocked: Array.isArray(seeded.progress?.blocked) ? seeded.progress.blocked : [],
      failed: Array.isArray(seeded.progress?.failed) ? seeded.progress.failed : [],
      skipped: Array.isArray(seeded.progress?.skipped) ? seeded.progress.skipped : [],
    },
  }
}

function validateActivationSource(activation) {
  if (!activation || typeof activation !== 'object') return false
  const mode = activation.mode || ''
  const entry = activation.entry || ''
  return ['explicit-team-command', 'explicit-team-workflow'].includes(mode)
    && ['team', 'team-workflow'].includes(entry)
    && activation.auto_trigger_allowed === false
}

function isReservedTeamIdentifier(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'none' || normalized === 'null' || normalized === 'undefined'
}

function buildMinimumTeamState({ projectId, teamId, teamName, projectRoot, specFile, planFile, teamTasksFile, activation } = {}) {
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
    activation: activation || { mode: 'explicit-team-command', entry: 'team', auto_trigger_allowed: false },
    created_at: now,
    updated_at: now,
  })
}

function readTeamState(statePath, projectId, teamId) {
  const resolved = assertCanonicalTeamStatePath(statePath, projectId, teamId)
  return ensureTeamStateDefaults(JSON.parse(fs.readFileSync(resolved, 'utf8')))
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

function detectLatestTeamState(projectId, { includeArchived = true } = {}) {
  const root = getTeamsProjectDir(projectId)
  if (!root || !fs.existsSync(root)) return null

  const candidates = []
  for (const entry of fs.readdirSync(root).sort()) {
    const statePath = path.join(root, entry, TEAM_STATE_FILENAME)
    if (!fs.existsSync(statePath)) continue
    try {
      const state = readTeamState(statePath, projectId, entry)
      if (!includeArchived && state.status === 'archived') continue
      candidates.push({
        statePath,
        updatedAt: Date.parse(state.updated_at || state.created_at || ''),
      })
    } catch {}
  }

  if (candidates.length === 0) return null
  candidates.sort((left, right) => {
    const leftTime = Number.isFinite(left.updatedAt) ? left.updatedAt : -Infinity
    const rightTime = Number.isFinite(right.updatedAt) ? right.updatedAt : -Infinity
    if (rightTime !== leftTime) return rightTime - leftTime
    return right.statePath.localeCompare(left.statePath)
  })
  return candidates[0].statePath
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
  detectLatestTeamState,
  validateActivationSource,
  isReservedTeamIdentifier,
}
