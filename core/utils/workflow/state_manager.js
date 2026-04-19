#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  assertCanonicalWorkflowStatePath,
  detectProjectIdFromRoot,
  getWorkflowStatePath,
} = require('./path_utils')
const { addUnique } = require('./status_utils')
const {
  buildUserSpecReview,
  deriveEffectiveStatus,
  ensureStateDefaults,
  getReviewResult,
  nextChangeId,
} = require('./workflow_types')

function isoNow() {
  return new Date().toISOString()
}

function resolveStatePath(projectId) {
  const statePath = getWorkflowStatePath(projectId)
  if (!statePath) throw new Error(`invalid project id: ${projectId}`)
  return assertCanonicalWorkflowStatePath(statePath, projectId)
}

function resolveCliStatePath(pathOrProject) {
  try {
    return assertCanonicalWorkflowStatePath(pathOrProject)
  } catch {
    return resolveStatePath(pathOrProject)
  }
}

function readState(statePath, projectId) {
  const resolvedPath = assertCanonicalWorkflowStatePath(statePath, projectId)
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
}

function normalizeForWrite(state) {
  return ensureStateDefaults(state)
}

function writeState(statePath, state, projectId) {
  const resolvedPath = assertCanonicalWorkflowStatePath(statePath, projectId || String((state || {}).project_id || ''))
  const payload = normalizeForWrite(state)
  payload.updated_at = isoNow()
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  const lockPath = `${resolvedPath}.lock`
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
  } catch (lockErr) {
    if (lockErr && lockErr.code === 'EEXIST') {
      let stale = false
      try {
        const lockContent = fs.readFileSync(lockPath, 'utf8').trim()
        const lockPid = Number(lockContent)
        if (lockPid && lockPid !== process.pid) {
          try {
            process.kill(lockPid, 0)
            // Process exists — check if lock is old (>30s = likely abandoned)
            const lockAge = Date.now() - fs.statSync(lockPath).mtimeMs
            stale = lockAge > 30000
          } catch (killErr) {
            // ESRCH = no such process (Unix), EPERM on Windows may mean process exists
            stale = killErr && killErr.code === 'ESRCH'
            if (!stale) {
              // On Windows, fall back to age-based detection
              const lockAge = Date.now() - fs.statSync(lockPath).mtimeMs
              stale = lockAge > 30000
            }
          }
        } else {
          stale = true
        }
      } catch { stale = true }
      if (stale) {
        fs.rmSync(lockPath, { force: true })
        fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
      } else {
        throw new Error(`workflow state is locked by another process (${lockPath})`)
      }
    } else {
      throw lockErr
    }
  }
  try {
    const tmpPath = `${resolvedPath}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2))
      fs.renameSync(tmpPath, resolvedPath)
    } catch (error) {
      if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true })
      throw error
    }
  } finally {
    fs.rmSync(lockPath, { force: true })
  }
}

function readStateFromProject(projectId) {
  try {
    const statePath = resolveStatePath(projectId)
    if (!fs.existsSync(statePath)) return null
    return readState(statePath, projectId)
  } catch {
    return null
  }
}

function recordDeltaChange(state, changeId = null, markApplied = true) {
  const normalized = normalizeStateInPlace(state)
  const tracking = normalized.delta_tracking || (normalized.delta_tracking = {})
  const resolvedChangeId = changeId || nextChangeId(tracking)
  tracking.current_change = resolvedChangeId
  tracking.change_counter = Math.max(Number(tracking.change_counter || 0), Number(String(resolvedChangeId).split('-').at(-1)))
  const appliedChanges = tracking.applied_changes || (tracking.applied_changes = [])
  if (markApplied && !appliedChanges.includes(resolvedChangeId)) appliedChanges.push(resolvedChangeId)
  return resolvedChangeId
}

function markDeltaApplied(state, changeId) {
  const normalized = normalizeStateInPlace(state)
  const tracking = normalized.delta_tracking || (normalized.delta_tracking = {})
  const resolvedChangeId = String(changeId || '').trim()
  if (!resolvedChangeId) return normalized
  const appliedChanges = tracking.applied_changes || (tracking.applied_changes = [])
  if (!appliedChanges.includes(resolvedChangeId)) appliedChanges.push(resolvedChangeId)
  return normalized
}

function normalizeStateInPlace(state) {
  const normalized = ensureStateDefaults(state)
  Object.assign(state, normalized)
  return state
}

function updateApiContext(state, interfaces = null, source = null, version = null, lastSync = null) {
  const normalized = normalizeStateInPlace(state)
  const apiContext = normalized.api_context || (normalized.api_context = {})
  if (interfaces !== null) apiContext.interfaces = interfaces
  if (source !== null) apiContext.source = source
  if (version !== null) apiContext.version = version
  apiContext.lastSync = lastSync || isoNow()
  return apiContext
}

function markDependencyUnblocked(state, dependency, tasksToUnblock = null) {
  const normalized = normalizeStateInPlace(state)
  const unblocked = normalized.unblocked || (normalized.unblocked = [])
  addUnique(unblocked, dependency)
  if (tasksToUnblock && tasksToUnblock.length) {
    const progress = normalized.progress || (normalized.progress = {})
    const blocked = progress.blocked || []
    progress.blocked = blocked.filter((taskId) => !tasksToUnblock.includes(taskId))
  }
  const effective = deriveEffectiveStatus(normalized)
  if (effective.status === 'halted' && effective.halt_reason === 'dependency') {
    normalized.status = 'running'
    normalized.halt_reason = null
  }
  return normalized
}

function updateDiscussionRecord(state, artifactPath, clarificationCount, completed = true) {
  const normalized = normalizeStateInPlace(state)
  normalized.discussion = {
    completed,
    artifact_path: artifactPath,
    clarification_count: clarificationCount,
  }
  return normalized.discussion
}

function updateUxDesignRecord(state, artifactPath, flowchartScenarios = 0, pageCount = 0, approved = false) {
  const normalized = normalizeStateInPlace(state)
  normalized.ux_design = {
    completed: approved,
    artifact_path: artifactPath,
    flowchart_scenarios: flowchartScenarios,
    page_count: pageCount,
    approved_at: approved ? isoNow() : null,
  }
  return normalized.ux_design
}


function updateUserSpecReview(state, status, nextAction, reviewer = 'user') {
  const normalized = normalizeStateInPlace(state)
  const reviewStatus = normalized.review_status || (normalized.review_status = {})
  reviewStatus.user_spec_review = buildUserSpecReview(status, nextAction, reviewer)
  return reviewStatus.user_spec_review
}

function updateContextInjection(state, contextInjection = {}) {
  const normalized = normalizeStateInPlace(state)
  normalized.context_injection = {
    ...((normalized.context_injection || {})),
    ...contextInjection,
  }
  return normalized.context_injection
}

function updatePlanReviewRecord(state, details = {}) {
  const normalized = normalizeStateInPlace(state)
  const reviewStatus = normalized.review_status || (normalized.review_status = {})
  reviewStatus.plan_review = {
    status: details.status || 'pending',
    review_mode: details.review_mode || 'machine_loop',
    reviewed_at: details.reviewed_at || null,
    reviewer: details.reviewer || 'subagent',
    attempt: details.attempt || 0,
    max_attempts: details.max_attempts || 3,
    last_decision: details.last_decision || null,
    next_action: details.next_action || null,
    role: details.role || null,
    profile: details.profile || null,
    signals_snapshot: details.signals_snapshot || null,
    metrics: details.metrics || {},
  }
  return reviewStatus.plan_review
}

function updateCodexSpecReview(state, details = {}) {
  const normalized = normalizeStateInPlace(state)
  const reviewStatus = normalized.review_status || (normalized.review_status = {})
  reviewStatus.codex_spec_review = {
    status: details.status || 'pending',
    review_mode: 'machine_loop',
    reviewed_at: details.reviewed_at || null,
    reviewer: 'codex',
    trigger_reason: details.trigger_reason || null,
    provider_mode: 'task_readonly',
    attempt: details.attempt || 0,
    max_attempts: details.max_attempts || 1,
    issues: details.issues || [],
    issues_found: details.issues_found || 0,
    codex_status: details.codex_status || null,
    session_id: details.session_id || null,
    timing_ms: details.timing_ms || null,
  }
  return reviewStatus.codex_spec_review
}

function updateCodexPlanReview(state, details = {}) {
  const normalized = normalizeStateInPlace(state)
  const reviewStatus = normalized.review_status || (normalized.review_status = {})
  reviewStatus.codex_plan_review = {
    status: details.status || 'pending',
    review_mode: 'machine_loop',
    reviewed_at: details.reviewed_at || null,
    reviewer: 'codex',
    trigger_reason: details.trigger_reason || null,
    provider_mode: 'task_readonly',
    attempt: details.attempt || 0,
    max_attempts: details.max_attempts || 2,
    issues: details.issues || [],
    issues_found: details.issues_found || 0,
    codex_status: details.codex_status || null,
    session_id: details.session_id || null,
    timing_ms: details.timing_ms || null,
  }
  return reviewStatus.codex_plan_review
}

function completeWorkflow(state, statePath, totalTasks) {
  state.status = 'completed'
  state.halt_reason = null
  state.current_tasks = []
  state.completed_at = isoNow()
  writeState(statePath, state)
  const progress = state.progress || {}
  return {
    total_tasks: totalTasks,
    completed: (progress.completed || []).length,
    skipped: (progress.skipped || []).length,
    failed: (progress.failed || []).length,
  }
}

function handleTaskError(state, statePath, taskId, taskName, errorMessage) {
  state.status = 'halted'
  state.halt_reason = 'failure'
  state.failure_reason = errorMessage
  const currentTasks = state.current_tasks || []
  const inBatch = currentTasks.length > 1
  if (inBatch) {
    // 批次上下文：标记批次失败并清理 current_tasks，避免 discard 后残留僵尸任务
    const batchId = state.parallel_execution?.current_batch || null
    const groups = Array.isArray(state.parallel_groups) ? state.parallel_groups : []
    const record = batchId ? groups.find((g) => g.id === batchId) : null
    if (record) {
      record.status = 'failed'
      record.failed_task_id = taskId
      record.conflict_detected = true
      record.finished_at = isoNow()
      if (state.parallel_execution) state.parallel_execution.current_batch = null
    }
    const clearSet = new Set(record?.task_ids || currentTasks)
    state.current_tasks = currentTasks.filter((id) => !clearSet.has(id))
    if (state.current_tasks.length === 0) state.current_tasks = [taskId]
  } else {
    state.current_tasks = [taskId]
  }
  const progress = state.progress || (state.progress = {})
  const failedList = progress.failed || (progress.failed = [])
  addUnique(failedList, taskId)
  writeState(statePath, state)
}

function recordContextUsage(state, taskId, phase, preTaskTokens, postTaskTokens, executionPath = 'direct', triggeredVerification = false, triggeredReview = false) {
  const metrics = state.contextMetrics || (state.contextMetrics = {
    maxContextTokens: 0,
    estimatedTokens: 0,
    projectedNextTurnTokens: 0,
    reservedExecutionTokens: 0,
    reservedVerificationTokens: 0,
    reservedReviewTokens: 0,
    reservedSafetyBufferTokens: 0,
    warningThreshold: 60,
    dangerThreshold: 80,
    hardHandoffThreshold: 90,
    maxConsecutiveTasks: 5,
    usagePercent: 0,
    projectedUsagePercent: 0,
    history: [],
  })
  const history = metrics.history || (metrics.history = [])
  history.push({
    taskId,
    phase,
    preTaskTokens,
    postTaskTokens,
    tokenDelta: postTaskTokens - preTaskTokens,
    executionPath,
    triggeredVerification,
    triggeredReview,
    timestamp: isoNow(),
  })
  if (history.length > 20) metrics.history = history.slice(-20)
}

function updateContinuation(state, action, reason, severity = 'info', nextTaskIds = null, handoffRequired = false, artifactPath = null, suggestedExecutionPath = 'direct', primarySignals = null, budgetBackstopTriggered = false, budgetLevel = 'safe', decisionNotes = null) {
  state.continuation = {
    strategy: 'context-first',
    last_decision: {
      action,
      reason,
      severity,
      nextTaskIds: nextTaskIds || [],
      suggestedExecutionPath,
      primarySignals: primarySignals || {},
      budgetBackstopTriggered,
      budgetLevel,
      decisionNotes: decisionNotes || [],
    },
    handoff_required: handoffRequired,
    artifact_path: artifactPath,
  }
}

function incrementConsecutiveCount(state) {
  const count = Number(state.consecutive_count || 0) + 1
  state.consecutive_count = count
  return count
}

function resetConsecutiveCount(state) {
  state.consecutive_count = 0
}

function calculateProgress(totalTasks, completed, skipped, failed) {
  if (totalTasks === 0) return 0
  const finished = (completed || []).length + (skipped || []).length + (failed || []).length
  return Math.round((finished / totalTasks) * 100)
}

function generateProgressBar(percent) {
  const filled = Math.round(percent / 5)
  return `[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${percent}%`
}

function resolveCliProjectId(args) {
  if (args.projectId) return args.projectId
  return detectProjectIdFromRoot(args.projectRoot)
}

function stateFileExists(statePath) {
  return fs.existsSync(statePath)
}

function parseArgs(argv) {
  const args = [...argv]
  const options = { projectId: null, projectRoot: null }
  while (args.length && args[0].startsWith('--')) {
    const flag = args.shift()
    if (flag === '--project-id') options.projectId = args.shift()
    else if (flag === '--project-root') options.projectRoot = args.shift()
    else throw new Error(`Unknown flag: ${flag}`)
  }
  const command = args.shift()
  return { options, command, args }
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function main() {
  try {
    const { options, command, args } = parseArgs(process.argv.slice(2))
    const statePathArg = args[0]
    let statePath
    let projectId = null
    if (statePathArg && !String(statePathArg).startsWith('--') && ['read', 'complete', 'error', 'progress', 'review-result'].includes(command)) {
      try {
        statePath = resolveCliStatePath(statePathArg)
        args.shift()
      } catch (error) {
        printJson({ error: error.message })
        process.exitCode = 1
        return
      }
    } else {
      projectId = resolveCliProjectId(options)
      if (!projectId) {
        printJson({ error: '无法检测项目 ID，请使用 --project-id 或 --project-root 指定' })
        process.exitCode = 1
        return
      }
      try {
        statePath = resolveStatePath(projectId)
      } catch (error) {
        printJson({ error: error.message })
        process.exitCode = 1
        return
      }
    }

    const option = (flag) => {
      const index = args.indexOf(flag)
      return index >= 0 ? args[index + 1] : null
    }

    if (command === 'read') {
      if (!stateFileExists(statePath)) {
        printJson({ error: '没有活跃的工作流' })
        process.exitCode = 1
        return
      }
      printJson(readState(statePath, projectId))
      return
    }

    if (command === 'complete') {
      if (!stateFileExists(statePath)) {
        printJson({ error: '没有活跃的工作流' })
        process.exitCode = 1
        return
      }
      printJson(completeWorkflow(readState(statePath, projectId), statePath, Number(option('--total-tasks'))))
      return
    }

    if (command === 'error') {
      if (!stateFileExists(statePath)) {
        printJson({ error: '没有活跃的工作流' })
        process.exitCode = 1
        return
      }
      const state = readState(statePath, projectId)
      handleTaskError(state, statePath, option('--task-id'), option('--task-name'), option('--message'))
      printJson({ recorded: true })
      return
    }

    if (command === 'progress') {
      if (!stateFileExists(statePath)) {
        printJson({ error: '没有活跃的工作流' })
        process.exitCode = 1
        return
      }
      const state = readState(statePath, projectId)
      const progress = state.progress || {}
      const total = state._total_tasks || 0
      const percent = calculateProgress(total, progress.completed || [], progress.skipped || [], progress.failed || [])
      printJson({ percent, bar: generateProgressBar(percent) })
      return
    }

    if (command === 'review-result') {
      if (!stateFileExists(statePath)) {
        printJson({ error: '没有活跃的工作流' })
        process.exitCode = 1
        return
      }
      const result = getReviewResult(readState(statePath, projectId), option('--task-id'))
      if (!result) printJson({ found: false, task_id: option('--task-id') })
      else printJson({ found: true, task_id: option('--task-id'), result })
      return
    }

    process.stderr.write('Usage: node state_manager.js [--project-id ID|--project-root DIR] <read|complete|error|progress|review-result> ...\n')
    process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  isoNow,
  resolveStatePath,
  resolveCliStatePath,
  readState,
  writeState,
  readStateFromProject,
  normalizeForWrite,
  normalizeStateInPlace,
  recordDeltaChange,
  markDeltaApplied,
  updateApiContext,
  markDependencyUnblocked,
  updateDiscussionRecord,

  updateUxDesignRecord,
  updateUserSpecReview,
  updateContextInjection,
  updatePlanReviewRecord,
  updateCodexSpecReview,
  updateCodexPlanReview,
  completeWorkflow,
  handleTaskError,
  recordContextUsage,
  updateContinuation,
  incrementConsecutiveCount,
  resetConsecutiveCount,
  calculateProgress,
  generateProgressBar,
  resolveCliProjectId,
  stateFileExists,
}

if (require.main === module) main()
