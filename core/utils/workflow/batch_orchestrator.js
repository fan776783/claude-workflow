#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { findParallelGroups, canRunParallel } = require('./dependency_checker')
const { loadProjectConfig, normalizeProjectConfig } = require('./execution_sequencer')
const { getWorkflowsDir } = require('./path_utils')
const { readState, writeState } = require('./state_manager')
const { parseTasksV2, taskToDict } = require('./task_parser')
const { ensureStateDefaults } = require('./workflow_types')

function isoNow() {
  return new Date().toISOString()
}

function nextBatchId(parallelGroups) {
  return `B-${String((parallelGroups || []).length + 1).padStart(4, '0')}`
}

function getArtifactsDir(projectId, groupId) {
  const workflowsDir = getWorkflowsDir(projectId)
  if (!workflowsDir) return null
  return path.join(workflowsDir, 'artifacts', groupId)
}

function selectReadyBatch(tasks, state, maxConcurrency) {
  const normalized = ensureStateDefaults(state)
  const progress = normalized.progress || {}
  const taskDicts = tasks.map(taskToDict)
  const groups = findParallelGroups(
    taskDicts,
    progress.completed || [],
    progress.blocked || [],
    progress.skipped || [],
    progress.failed || []
  )
  if (!groups.length) return []
  const largest = groups.reduce((a, b) => (a.length >= b.length ? a : b), [])
  const limit = Math.min(maxConcurrency || 2, largest.length)
  return largest.slice(0, limit)
}

function verifyIndependence(taskIds, allTasks) {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]))
  const selected = taskIds.map((id) => taskMap.get(id)).filter(Boolean)
  const filesOf = (t) => [
    ...((t.files || {}).create || []),
    ...((t.files || {}).modify || []),
    ...((t.files || {}).test || []),
  ]
  const intentOf = (t) =>
    (t.steps || []).map((s) => `${s.id || ''} ${s.description || ''} ${s.expected || ''}`).join(' ')

  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      const a = selected[i]
      const b = selected[j]
      const result = canRunParallel(
        filesOf(a), a.depends || [], intentOf(a), a.id,
        filesOf(b), b.depends || [], intentOf(b), b.id
      )
      if (!result.parallel) return { ok: false, conflict: { a: a.id, b: b.id, reason: result.reason } }
    }
  }
  return { ok: true }
}

function hasBatchExcludedActions(task) {
  const excluded = new Set(['git_commit', 'quality_review'])
  return (task.actions || []).some((a) => excluded.has(a))
}

function filterBatchCandidates(taskIds, allTasks) {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]))
  return taskIds.filter((id) => {
    const t = taskMap.get(id)
    return t && !hasBatchExcludedActions(t)
  })
}

function resolveParallelConfig(projectRoot) {
  const raw = loadProjectConfig(projectRoot || process.cwd())
  return normalizeProjectConfig(raw).parallel
}

function createBatchRecord(groupId, kind, taskIds) {
  return {
    id: groupId,
    kind,
    task_ids: [...taskIds],
    status: 'running',
    started_at: isoNow(),
    finished_at: null,
    conflict_detected: false,
    diff_window: null,
    review_group: null,
  }
}

function registerBatch(state, groupId, kind, taskIds) {
  if (!Array.isArray(state.parallel_groups)) state.parallel_groups = []
  if (!state.parallel_execution) state.parallel_execution = { enabled: false, max_concurrency: 1, current_batch: null }
  const record = createBatchRecord(groupId, kind, taskIds)
  state.parallel_groups.push(record)
  state.parallel_execution.current_batch = groupId
  return record
}

function getBatchRecord(state, groupId) {
  if (!Array.isArray(state?.parallel_groups)) return null
  return state.parallel_groups.find((group) => group.id === groupId) || null
}

function setBatchReviewGroup(state, groupId, reviewGroup = null) {
  const record = getBatchRecord(state, groupId)
  if (!record) return null
  record.review_group = reviewGroup
    ? {
      quality_gate_id: reviewGroup.quality_gate_id || groupId,
      stage2_passed: reviewGroup.stage2_passed === true,
    }
    : null
  return record
}

function finishBatch(state, groupId, status, diffWindow) {
  if (!Array.isArray(state.parallel_groups)) state.parallel_groups = []
  if (!state.parallel_execution) state.parallel_execution = { enabled: false, max_concurrency: 1, current_batch: null }
  for (const group of state.parallel_groups) {
    if (group.id === groupId) {
      group.status = status
      group.finished_at = isoNow()
      if (diffWindow) group.diff_window = diffWindow
      break
    }
  }
  if (state.parallel_execution.current_batch === groupId) {
    state.parallel_execution.current_batch = null
  }
  return state
}

function dispatchReadonlyBatch(state, statePath, taskIds, projectId) {
  const groupId = nextBatchId(state.parallel_groups)
  registerBatch(state, groupId, 'readonly', taskIds)
  writeState(statePath, state, projectId)

  const artifactsDir = getArtifactsDir(projectId, groupId)
  if (artifactsDir) fs.mkdirSync(artifactsDir, { recursive: true })

  return {
    groupId,
    kind: 'readonly',
    taskIds: [...taskIds],
    artifactsDir,
  }
}

function completeReadonlyBatch(state, statePath, groupId, projectId) {
  finishBatch(state, groupId, 'completed', null)
  writeState(statePath, state, projectId)
}

function failReadonlyBatch(state, statePath, groupId, projectId) {
  finishBatch(state, groupId, 'failed', null)
  writeState(statePath, state, projectId)
}

function prepareWritableBatch(state, statePath, taskIds, projectId, projectRoot, platform, tasksContent = null) {
  const content = tasksContent || state._tasks_content || ''
  const allTasks = content ? parseTasksV2(content) : []
  const filtered = filterBatchCandidates(taskIds, allTasks)
  if (filtered.length < 2) return { kind: 'serial', reason: 'insufficient_candidates' }

  const independence = verifyIndependence(filtered, allTasks)
  if (!independence.ok) return { kind: 'serial_fallback', reason: independence.conflict }

  const groupId = nextBatchId(state.parallel_groups)
  registerBatch(state, groupId, 'writable', filtered)
  state.current_tasks = [...filtered]
  writeState(statePath, state, projectId)

  for (const taskId of filtered) {
    const runtime = state.task_runtime[taskId] || (state.task_runtime[taskId] = {})
    runtime.batch_id = groupId
    runtime.dispatch_mode = 'worktree'
  }
  writeState(statePath, state, projectId)

  return {
    kind: 'writable',
    groupId,
    taskIds: [...filtered],
    platform: platform || 'claude-code',
    projectRoot: projectRoot || process.cwd(),
  }
}

function completeWritableBatch(state, statePath, groupId, diffWindow, projectId) {
  finishBatch(state, groupId, 'completed', diffWindow)
  writeState(statePath, state, projectId)
}

function failWritableBatch(state, statePath, groupId, status, projectId) {
  const validStatuses = new Set(['failed', 'partial', 'fallback_serial', 'rolledback', 'discarded'])
  finishBatch(state, groupId, validStatuses.has(status) ? status : 'failed', null)
  writeState(statePath, state, projectId)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : null
  }

  if (command === 'select-batch') {
    const tasksFile = option('--tasks-file')
    const stateFile = option('--state-file')
    if (!tasksFile || !stateFile) {
      process.stderr.write('select-batch requires --tasks-file and --state-file\n')
      process.exitCode = 1
      return
    }
    const tasks = parseTasksV2(fs.readFileSync(tasksFile, 'utf8'))
    const state = ensureStateDefaults(JSON.parse(fs.readFileSync(stateFile, 'utf8')))
    const maxConcurrency = Number(option('--max-concurrency') || 2)
    const candidates = selectReadyBatch(tasks, state, maxConcurrency)
    const filtered = filterBatchCandidates(candidates, tasks)
    const independence = filtered.length >= 2 ? verifyIndependence(filtered, tasks) : { ok: false, conflict: null }
    printJson({
      candidates,
      filtered,
      independence,
      batch_viable: independence.ok && filtered.length >= 2,
    })
    return
  }

  if (command === 'config') {
    printJson(resolveParallelConfig(option('--project-root')))
    return
  }

  process.stderr.write('Usage: node batch_orchestrator.js <select-batch|config> ...\n')
  process.exitCode = 1
}

module.exports = {
  isoNow,
  nextBatchId,
  getArtifactsDir,
  selectReadyBatch,
  verifyIndependence,
  hasBatchExcludedActions,
  filterBatchCandidates,
  resolveParallelConfig,
  createBatchRecord,
  registerBatch,
  getBatchRecord,
  setBatchReviewGroup,
  finishBatch,
  dispatchReadonlyBatch,
  completeReadonlyBatch,
  failReadonlyBatch,
  prepareWritableBatch,
  completeWritableBatch,
  failWritableBatch,
}

if (require.main === module) main()
