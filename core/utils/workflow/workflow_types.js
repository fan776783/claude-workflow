#!/usr/bin/env node

function isoNow() {
  return new Date().toISOString()
}

function copyJson(value) {
  return JSON.parse(JSON.stringify(value))
}

const MINIMUM_PROGRESS = {
  completed: [],
  blocked: [],
  failed: [],
  skipped: [],
}

const MINIMUM_DELTA_TRACKING = {
  enabled: true,
  changes_dir: 'changes/',
  current_change: null,
  applied_changes: [],
  change_counter: 0,
}

const MINIMUM_API_CONTEXT = {
  interfaces: [],
  lastSync: null,
  source: null,
  version: null,
}

const MINIMUM_GIT_STATUS = {
  initialized: false,
  subagent_available: false,
  user_acknowledged_degradation: false,
}

const MINIMUM_CONTEXT_INJECTION = {
  schema_version: '1',
  signals: {
    ui: false,
    workspace: false,
    security: false,
    data: false,
    backend_heavy: false,
  },
  planning: {
    plan_generation: { role: 'planner', profile: null },
    plan_review: { role: 'reviewer', profile: null },
    codex_spec_review: { triggered: false },
    codex_plan_review: { triggered: false },
  },
  execution: {
    quality_review_stage2: { role: 'reviewer', profile: null },
  },
  artifact_path: null,
}

const MINIMUM_SESSIONS = {
  platform: 'claude-code',
  executor: null,
}

const MINIMUM_PARALLEL_EXECUTION = {
  enabled: false,
  max_concurrency: 1,
  current_batch: null,
}

const MINIMUM_BOUNDARY_SCHEDULING = {
  enabled: false,
  currentBoundary: null,
  boundaryProgress: {},
}


// New canonical statuses + legacy values kept for backward compatibility during the migration window.
// Legacy values (`planning`, `paused`, `blocked`, `failed`) may still appear on disk until the
// one-shot `agent-workflow migrate-state` runs; deriveEffectiveStatus projects them to the new model.
const MINIMUM_STATE_STATUSES = new Set([
  'idle',
  'spec_review',
  'planned',
  'running',
  'halted',
  'review_pending',
  'completed',
  'archived',
  // legacy
  'planning',
  'paused',
  'blocked',
  'failed',
])
const POST_SPEC_REVIEW_STATUSES = new Set([
  'planned',
  'running',
  'halted',
  'review_pending',
  'completed',
  // legacy
  'planning',
  'paused',
  'blocked',
  'failed',
])

const LEGACY_STATUS_TO_HALT_REASON = {
  paused: 'governance',
  blocked: 'dependency',
  failed: 'failure',
}

// Project legacy top-level status values onto the new (status, halt_reason) model without mutating input.
// Readers use this to stay status-agnostic during the migration window; writers should produce the new
// shape directly (status='halted' + halt_reason=...) via the state_manager helpers.
function deriveEffectiveStatus(state) {
  const source = state || {}
  const rawStatus = source.status || 'idle'
  const reasonFromLegacy = LEGACY_STATUS_TO_HALT_REASON[rawStatus] || null
  if (reasonFromLegacy) return { status: 'halted', halt_reason: reasonFromLegacy }
  if (rawStatus === 'planning') return { status: 'spec_review', halt_reason: null }
  const haltReason = source.halt_reason || null
  return { status: rawStatus, halt_reason: rawStatus === 'halted' ? (haltReason || 'governance') : null }
}

function buildMinimumState(projectId, planFile, specFile, currentTasks = [], status = 'running') {
  if (!MINIMUM_STATE_STATUSES.has(status)) throw new Error(`invalid workflow status: ${status}`)
  const now = isoNow()
  return {
    project_id: projectId,
    status,
    current_tasks: currentTasks,
    plan_file: planFile,
    spec_file: specFile,
    progress: copyJson(MINIMUM_PROGRESS),
    created_at: now,
    updated_at: now,
  }
}

function ensureStateDefaults(state) {
  const normalized = copyJson(state || {})
  if (!normalized.project_id && normalized.projectId) normalized.project_id = normalized.projectId
  if (!normalized.status) normalized.status = 'idle'
  if (!normalized.current_tasks) normalized.current_tasks = []
  if (!('initial_head_commit' in normalized)) normalized.initial_head_commit = null
  normalized.progress = normalized.progress || {}
  for (const [key, value] of Object.entries(MINIMUM_PROGRESS)) {
    if (!Array.isArray(normalized.progress[key])) normalized.progress[key] = [...value]
  }
  if (!normalized.quality_gates) normalized.quality_gates = {}
  if (!normalized.task_runtime) normalized.task_runtime = {}
  if (!Array.isArray(normalized.parallel_groups)) normalized.parallel_groups = []
  if (!normalized.parallel_execution) normalized.parallel_execution = copyJson(MINIMUM_PARALLEL_EXECUTION)
  if (!normalized.boundaryScheduling) normalized.boundaryScheduling = copyJson(MINIMUM_BOUNDARY_SCHEDULING)
  if (!normalized.unblocked) normalized.unblocked = []
  if (!normalized.sessions) normalized.sessions = copyJson(MINIMUM_SESSIONS)
  if (!normalized.delta_tracking) normalized.delta_tracking = copyJson(MINIMUM_DELTA_TRACKING)
  if (!normalized.git_status) normalized.git_status = copyJson(MINIMUM_GIT_STATUS)
  if (!normalized.context_injection) normalized.context_injection = copyJson(MINIMUM_CONTEXT_INJECTION)
  if (!normalized.review_status) normalized.review_status = {}
  if (!normalized.api_context) normalized.api_context = copyJson(MINIMUM_API_CONTEXT)
  if (!normalized.discussion) normalized.discussion = { completed: false, clarification_count: 0, unresolved_dependencies: [] }

  if (!normalized.ux_design) normalized.ux_design = { completed: false, ux_gate_required: false, flowchart_scenarios: 0, page_count: 0, approved_at: null }
  if (!normalized.review_status.user_spec_review) normalized.review_status.user_spec_review = { status: 'pending', review_mode: 'human_gate', reviewed_at: null, reviewer: 'user', next_action: null }
  if (!normalized.review_status.codex_spec_review) normalized.review_status.codex_spec_review = { status: 'pending', review_mode: 'machine_loop', reviewed_at: null, reviewer: 'codex', trigger_reason: null, provider_mode: 'task_readonly', attempt: 0, max_attempts: 1, issues: [], issues_found: 0, codex_status: null, session_id: null, timing_ms: null }
  if (!normalized.review_status.codex_plan_review) normalized.review_status.codex_plan_review = { status: 'pending', review_mode: 'machine_loop', reviewed_at: null, reviewer: 'codex', trigger_reason: null, provider_mode: 'task_readonly', attempt: 0, max_attempts: 2, issues: [], issues_found: 0, codex_status: null, session_id: null, timing_ms: null }
  if (!('failure_reason' in normalized)) normalized.failure_reason = null
  if (!('halt_reason' in normalized)) normalized.halt_reason = null
  if (!normalized.created_at) normalized.created_at = normalized.updated_at || isoNow()
  if (!normalized.updated_at) normalized.updated_at = isoNow()
  return normalized
}

function normalizeQualityGateRecord(taskId, record) {
  const stage1 = { ...(record.stage1 || {}) }
  // Code Specs Check 是 Stage 1 的 advisory 子段，旧记录没有这个字段时补一个占位，方便下游无脑读取。
  if (!stage1.code_specs_check || typeof stage1.code_specs_check !== 'object') {
    stage1.code_specs_check = { performed: false, advisory: true, findings_count: 0 }
  }
  return {
    gate_task_id: record.gate_task_id || taskId,
    review_mode: record.review_mode || 'machine_loop',
    last_decision: record.last_decision || 'revise',
    stage1,
    stage2: record.stage2 || {},
    overall_passed: Boolean(record.overall_passed || false),
    reviewed_at: record.reviewed_at || null,
  }
}

function getReviewResult(state, taskId) {
  const qualityGates = (state || {}).quality_gates || {}
  if (qualityGates[taskId]) return normalizeQualityGateRecord(taskId, qualityGates[taskId])
  const executionReviews = (state || {}).execution_reviews || {}
  const legacy = executionReviews[taskId]
  if (!legacy) return null
  const stage1 = legacy.spec_compliance || legacy.stage1 || {}
  const stage2 = legacy.code_quality || legacy.stage2 || {}
  const overall = legacy.overall_passed == null ? Boolean(stage1.passed) && Boolean(stage2.passed) : legacy.overall_passed
  return normalizeQualityGateRecord(taskId, {
    gate_task_id: taskId,
    review_mode: legacy.review_mode || 'machine_loop',
    last_decision: legacy.last_decision || 'revise',
    stage1,
    stage2,
    overall_passed: overall,
    reviewed_at: legacy.reviewed_at || null,
  })
}

function summarizeProgress(state) {
  const progress = ensureStateDefaults(state).progress
  return {
    completed: progress.completed.length,
    blocked: progress.blocked.length,
    failed: progress.failed.length,
    skipped: progress.skipped.length,
  }
}

function buildUserSpecReview(status, nextAction, reviewer = 'user', reviewMode = 'human_gate') {
  return {
    status,
    review_mode: reviewMode,
    reviewed_at: status === 'pending' ? null : isoNow(),
    reviewer,
    next_action: nextAction,
  }
}

function nextChangeId(deltaTracking) {
  const counter = Number(((deltaTracking || {}).change_counter) || 0) + 1
  return `CHG-${String(counter).padStart(3, '0')}`
}

function getUserSpecReview(state) {
  return ensureStateDefaults(state).review_status.user_spec_review
}

function isUserSpecReviewApproved(state) {
  const review = getUserSpecReview(state)
  return review.status === 'approved' || (review.status === 'skipped' && Boolean(review.acknowledged_degradation_at))
}

function acknowledgeSkippedSpecReview(state, reviewer = 'user', source = 'execute --force') {
  const normalized = ensureStateDefaults(state)
  const review = normalized.review_status.user_spec_review || (normalized.review_status.user_spec_review = {
    status: 'pending',
    review_mode: 'human_gate',
    reviewed_at: null,
    reviewer: 'user',
    next_action: null,
  })
  if (review.status !== 'skipped') return normalized
  const acknowledgedAt = isoNow()
  review.acknowledged_degradation_at = acknowledgedAt
  review.acknowledged_degradation_by = reviewer
  review.acknowledged_degradation_source = source
  review.requires_degradation_ack = false
  normalized.git_status.user_acknowledged_degradation = true
  normalized.updated_at = acknowledgedAt
  return normalized
}

function getSpecReviewGateViolation(state) {
  const normalized = ensureStateDefaults(state)
  if (!POST_SPEC_REVIEW_STATUSES.has(normalized.status)) return null
  const review = normalized.review_status.user_spec_review || {}
  if (review.status === 'approved') return null
  if (review.status === 'skipped') {
    if (review.acknowledged_degradation_at) return null
    return {
      code: 'spec_upgrade_required',
      status: normalized.status,
      review_status: 'skipped',
      message: '当前 workflow 由无 spec 的 plan 自愈恢复，执行前需先升级到 /workflow-plan，或显式使用 /workflow-execute --force 确认降级。',
    }
  }
  return {
    code: 'user_spec_review_required',
    status: normalized.status,
    review_status: review.status || 'pending',
    message: `workflow 处于 ${normalized.status}，但 Phase 1.1 User Spec Review 尚未 approved`,
  }
}

function main() {
  const fs = require('fs')
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  if (command === 'minimum-state') {
    const [projectId, planFile, specFile] = args
    const statusIndex = args.indexOf('--status')
    const tasksIndex = args.indexOf('--current-tasks')
    const status = statusIndex >= 0 ? args[statusIndex + 1] : 'running'
    const currentTasks = tasksIndex >= 0 ? args[tasksIndex + 1].split(',').map((item) => item.trim()).filter(Boolean) : []
    process.stdout.write(`${JSON.stringify(buildMinimumState(projectId, planFile, specFile, currentTasks, status), null, 2)}\n`)
    return
  }
  if (command === 'normalize-state') {
    const state = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    process.stdout.write(`${JSON.stringify(ensureStateDefaults(state), null, 2)}\n`)
    return
  }
  if (command === 'review-result') {
    const state = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    process.stdout.write(`${JSON.stringify({ review: getReviewResult(state, args[1]) }, null, 2)}\n`)
    return
  }
  process.stderr.write('Usage: node workflow_types.js <minimum-state|normalize-state|review-result> ...\n')
  process.exitCode = 1
}

module.exports = {
  MINIMUM_PROGRESS,
  MINIMUM_DELTA_TRACKING,
  MINIMUM_API_CONTEXT,
  MINIMUM_GIT_STATUS,
  MINIMUM_CONTEXT_INJECTION,
  MINIMUM_SESSIONS,
  MINIMUM_PARALLEL_EXECUTION,
  MINIMUM_BOUNDARY_SCHEDULING,

  MINIMUM_STATE_STATUSES,
  LEGACY_STATUS_TO_HALT_REASON,
  isoNow,
  copyJson,
  buildMinimumState,
  ensureStateDefaults,
  deriveEffectiveStatus,
  normalizeQualityGateRecord,
  getReviewResult,
  summarizeProgress,
  buildUserSpecReview,
  nextChangeId,
  getUserSpecReview,
  isUserSpecReviewApproved,
  acknowledgeSkippedSpecReview,
  getSpecReviewGateViolation,
}

if (require.main === module) main()
