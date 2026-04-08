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

const MINIMUM_STATE_STATUSES = new Set(['idle', 'spec_review', 'planning', 'planned', 'running', 'paused', 'blocked', 'failed', 'completed', 'archived'])

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
  normalized.progress = normalized.progress || {}
  for (const [key, value] of Object.entries(MINIMUM_PROGRESS)) {
    if (!Array.isArray(normalized.progress[key])) normalized.progress[key] = [...value]
  }
  if (!normalized.quality_gates) normalized.quality_gates = {}
  if (!normalized.unblocked) normalized.unblocked = []
  if (!normalized.sessions) normalized.sessions = copyJson(MINIMUM_SESSIONS)
  if (!normalized.delta_tracking) normalized.delta_tracking = copyJson(MINIMUM_DELTA_TRACKING)
  if (!normalized.git_status) normalized.git_status = copyJson(MINIMUM_GIT_STATUS)
  if (!normalized.context_injection) normalized.context_injection = copyJson(MINIMUM_CONTEXT_INJECTION)
  if (!normalized.review_status) normalized.review_status = {}
  if (!normalized.api_context) normalized.api_context = copyJson(MINIMUM_API_CONTEXT)
  if (!normalized.discussion) normalized.discussion = { completed: false, artifact_path: null, clarification_count: 0 }
  if (!normalized.ux_design) normalized.ux_design = { completed: false, artifact_path: null, flowchart_scenarios: 0, page_count: 0, approved_at: null }
  if (!normalized.review_status.user_spec_review) normalized.review_status.user_spec_review = { status: 'pending', review_mode: 'human_gate', reviewed_at: null, reviewer: 'user', next_action: null }
  if (!('failure_reason' in normalized)) normalized.failure_reason = null
  if (!normalized.created_at) normalized.created_at = normalized.updated_at || isoNow()
  if (!normalized.updated_at) normalized.updated_at = isoNow()
  return normalized
}

function normalizeQualityGateRecord(taskId, record) {
  return {
    gate_task_id: record.gate_task_id || taskId,
    review_mode: record.review_mode || 'machine_loop',
    last_decision: record.last_decision || 'revise',
    stage1: record.stage1 || {},
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
    reviewed_at: isoNow(),
    reviewer,
    next_action: nextAction,
  }
}

function nextChangeId(deltaTracking) {
  const counter = Number(((deltaTracking || {}).change_counter) || 0) + 1
  return `CHG-${String(counter).padStart(3, '0')}`
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
  MINIMUM_STATE_STATUSES,
  isoNow,
  copyJson,
  buildMinimumState,
  ensureStateDefaults,
  normalizeQualityGateRecord,
  getReviewResult,
  summarizeProgress,
  buildUserSpecReview,
  nextChangeId,
}

if (require.main === module) main()
