#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  calculateMaxTasks,
  detectComplexity,
} = require('./context_budget')
const {
  assertCanonicalWorkflowStatePath,
  getWorkflowStatePath,
  validateProjectId,
} = require('./path_utils')
const { readState, writeState } = require('./state_manager')
const { detectProjectId, resolveStateAndTasks } = require('./task_manager')
const {
  countTasks,
  findNextTask,
  parseTasksV2,
  taskToDict,
  updateTaskStatusInMarkdown,
} = require('./task_parser')
const { acknowledgeSkippedSpecReview, deriveEffectiveStatus, ensureStateDefaults, getSpecReviewGateViolation } = require('./workflow_types')

function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function extractProjectId(config) {
  if (!config) return null
  const project = config.project || {}
  const projectId = project.id || config.projectId
  return validateProjectId(String(projectId || '')) ? String(projectId) : null
}

function resolveStatePathForProject(projectId) {
  return validateProjectId(projectId) ? getWorkflowStatePath(projectId) : null
}

function resolveCliStatePath(stateOrProject) {
  if (validateProjectId(stateOrProject)) return resolveStatePathForProject(stateOrProject)
  try {
    return assertCanonicalWorkflowStatePath(stateOrProject)
  } catch {
    return null
  }
}

function resolveExistingStatePath(stateOrProject) {
  const statePath = resolveCliStatePath(stateOrProject)
  return statePath && fs.existsSync(statePath) ? statePath : null
}

const VALID_EXECUTION_MODES = new Set(['continuous', 'phase', 'retry', 'skip'])
const EXECUTE_ENTRY_STATUSES = new Set([
  'planned',
  'running',
  'halted',
])
const RESUME_ENTRY_STATUSES = new Set([
  'running',
  'halted',
])

function buildExecuteEntry(command, intent, explicitMode, projectRoot, options = {}) {
  const { force = false, tdd = false } = options
  const config = loadProjectConfig(projectRoot)
  const projectId = extractProjectId(config)
  if (!projectId) {
    return {
      entry_action: 'none',
      resolved_mode: null,
      project_id: null,
      state_status: null,
      can_resume: false,
      reason: 'missing_project_config',
      message: '缺少 project-config.json 或 project.id 无效，请先执行 /scan（空项目使用 /scan --init）。',
    }
  }
  const context = loadExecutionContext(projectId, String(projectRoot))
  let state = !context.error ? context.state : null
  let gateViolation = state ? getSpecReviewGateViolation(state) : null

  if (state && gateViolation && gateViolation.code === 'spec_upgrade_required' && force && context.state_path) {
    state = acknowledgeSkippedSpecReview(state, 'user', 'execute --force')
    writeState(context.state_path, state)
    gateViolation = getSpecReviewGateViolation(state)
  }

  if (command === 'execute') {
    if (!state) {
      return {
        entry_action: 'none',
        resolved_mode: null,
        project_id: projectId,
        state_status: null,
        can_resume: false,
        reason: 'no_active_workflow',
        message: '未发现活动工作流，请先执行 /workflow-plan 创建规划。',
      }
    }
    if (gateViolation) {
      return {
        entry_action: 'none',
        resolved_mode: null,
        project_id: projectId,
        state_status: state ? state.status : null,
        can_resume: false,
        reason: gateViolation.code,
        message: gateViolation.code === 'spec_upgrade_required'
          ? gateViolation.message
          : 'Spec 尚未通过 Phase 1.1 用户审查，不能进入执行阶段。请先完成显式批准。',
      }
    }
    if (!EXECUTE_ENTRY_STATUSES.has(state.status)) {
      const message = state.status === 'spec_review' || state.status === 'planning'
        ? 'Spec 正在等待用户确认或 Plan 仍在生成，请先完成规划流程后再执行 /workflow-execute。'
        : `当前状态 ${state.status} 不支持进入执行阶段，请使用 /workflow-status 查看详情。`
      return {
        entry_action: 'none',
        resolved_mode: null,
        project_id: projectId,
        state_status: state.status,
        can_resume: false,
        reason: 'status_not_executable',
        message,
      }
    }
    const preferredMode = state ? state.execution_mode : null
    const resolvedMode = resolveExecutionMode(explicitMode || intent, preferredMode)
    const result = {
      entry_action: 'execute',
      resolved_mode: resolvedMode,
      tdd_enabled: Boolean(tdd),
      project_id: projectId,
      state_status: state ? state.status : null,
      can_resume: Boolean(state),
      reason: 'explicit_execute',
    }
    if (force && state?.review_status?.user_spec_review?.status === 'skipped') {
      result.degraded_execution_acknowledged = true
    }
    if (intent && !explicitMode && resolvedMode === (preferredMode || 'continuous') && !VALID_EXECUTION_MODES.has(intent)) {
      result.warning = `unrecognized_intent:${intent}`
    }
    return result
  }

  if (command === 'continue') {
    if (!state) {
      return {
        entry_action: 'none',
        project_id: projectId,
        state_status: null,
        can_resume: false,
        reason: 'no_active_workflow',
        message: '未发现活动工作流，请先执行 /workflow-status 或 /workflow-execute。',
      }
    }
    if (gateViolation) {
      return {
        entry_action: 'none',
        project_id: projectId,
        state_status: state.status,
        can_resume: false,
        reason: gateViolation.code,
        message: gateViolation.code === 'spec_upgrade_required'
          ? gateViolation.message
          : 'Spec 尚未通过 Phase 1.1 用户审查，不能继续执行。请先完成显式批准。',
      }
    }
    const status = state.status
    if (!RESUME_ENTRY_STATUSES.has(status)) {
      const message = ['planned', 'planning', 'spec_review'].includes(status)
        ? '规划已完成但尚未开始执行，请显式使用 /workflow-execute 开始执行。'
        : `当前状态 ${status} 不支持直接恢复，请使用 /workflow-status 查看详情。`
      return {
        entry_action: 'none',
        project_id: projectId,
        state_status: status,
        can_resume: false,
        reason: 'status_not_resumable',
        message,
      }
    }
    const continuation = state.continuation || {}
    const preferredMode = state.execution_mode || 'continuous'
    const resolvedMode = resolveExecutionMode(explicitMode || intent, preferredMode)
    const lastDecision = continuation.last_decision || {}
    const result = {
      entry_action: 'execute',
      resolved_mode: resolvedMode,
      tdd_enabled: Boolean(tdd),
      project_id: projectId,
      state_status: status,
      can_resume: true,
      reason: 'implicit_continue_resume',
      continuation_action: lastDecision.action,
      continuation_reason: lastDecision.reason,
    }
    if (intent && !explicitMode && resolvedMode === preferredMode && !VALID_EXECUTION_MODES.has(intent)) {
      result.warning = `unrecognized_intent:${intent}`
    }
    return result
  }

  return {
    entry_action: 'none',
    project_id: projectId,
    state_status: state ? state.status : null,
    can_resume: false,
    reason: 'unknown_command',
  }
}

function loadExecutionContext(projectId = null, projectRoot = null) {
  const [state, statePath, tasksContent, tasksPath, code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流', code }
  const normalizedState = ensureStateDefaults(state)
  const tasks = tasksContent ? parseTasksV2(tasksContent) : []
  const currentTaskId = (normalizedState.current_tasks || [null])[0]
  const currentTask = tasks.find((task) => task.id === currentTaskId) || null
  if (tasksContent) normalizedState._tasks_content = tasksContent
  const currentTaskIds = (normalizedState.current_tasks || []).filter(Boolean)
  return {
    state: normalizedState,
    state_path: statePath,
    tasks_content: tasksContent,
    tasks_path: tasksPath,
    tasks,
    current_task: currentTask ? taskToDict(currentTask) : null,
    current_task_id: currentTaskId,
    current_task_ids: currentTaskIds,
    total_tasks: tasksContent ? countTasks(tasksContent) : 0,
  }
}

function resolveExecutionMode(override, stateMode) {
  if (VALID_EXECUTION_MODES.has(override)) return override
  if (VALID_EXECUTION_MODES.has(stateMode)) return stateMode
  return 'continuous'
}

function detectNextTask(tasksContent, state) {
  if (!tasksContent) return null
  const progress = ensureStateDefaults(state).progress || {}
  return findNextTask(tasksContent, progress.completed || [], progress.skipped || [], progress.failed || [], progress.blocked || [])
}

function updateAfterTaskCompletion(state, tasksContent) {
  const normalizedState = ensureStateDefaults(state)
  const nextTaskId = detectNextTask(tasksContent, normalizedState)
  if (nextTaskId) {
    normalizedState.current_tasks = [nextTaskId]
    normalizedState.status = 'running'
  } else {
    // 所有 task 完成 → execute Step 7 inline 末尾终审通过后 completed，无中间审查态。
    normalizedState.current_tasks = []
    normalizedState.status = 'completed'
  }
  return normalizedState
}

function markTaskSkipped(statePath, tasksPath, tasksContent, taskId) {
  const state = ensureStateDefaults(readState(statePath))
  const progress = state.progress || (state.progress = {})
  const skipped = progress.skipped || (progress.skipped = [])
  if (!skipped.includes(taskId)) skipped.push(taskId)
  const updatedContent = updateTaskStatusInMarkdown(tasksContent, taskId, 'skipped')
  fs.writeFileSync(tasksPath, updatedContent)
  const nextTaskId = detectNextTask(updatedContent, state)
  if (nextTaskId) {
    state.current_tasks = [nextTaskId]
    state.status = 'running'
  } else {
    // 所有 task 完成 → execute Step 7 inline 末尾终审通过后 completed，无中间审查态。
    state.current_tasks = []
    state.status = 'completed'
  }
  writeState(statePath, state)
  return { skipped: true, task_id: taskId, next_task_id: nextTaskId, workflow_status: state.status }
}

function prepareRetry(statePath, taskId, failureReason = null, failureStage = 'execution') {
  const state = ensureStateDefaults(readState(statePath))
  const effective = deriveEffectiveStatus(state)
  const isRetryable = effective.status === 'halted' && effective.halt_reason === 'failure'
  if (!isRetryable) return { retryable: false, reason: `status-not-failed:${state.status}`, task_id: taskId }
  const taskRuntime = state.task_runtime || (state.task_runtime = {})
  const runtime = taskRuntime[taskId] || (taskRuntime[taskId] = { retry_count: 0, last_failure_stage: failureStage, last_failure_reason: failureReason || state.failure_reason || '', hard_stop_triggered: false, debugging_phases_completed: [] })
  runtime.retry_count = Number(runtime.retry_count || 0) + 1
  runtime.last_failure_stage = failureStage
  runtime.last_failure_reason = failureReason || state.failure_reason || ''
  if (runtime.retry_count >= 3) {
    runtime.hard_stop_triggered = true
    writeState(statePath, state)
    return { retryable: false, reason: 'hard-stop', task_id: taskId, retry_count: runtime.retry_count }
  }
  state.status = 'running'
  state.halt_reason = null
  state.failure_reason = null
  writeState(statePath, state)
  return { retryable: true, task_id: taskId, retry_count: runtime.retry_count, failure_stage: runtime.last_failure_stage }
}

function resetRetryRuntime(statePath, taskId) {
  const state = ensureStateDefaults(readState(statePath))
  const taskRuntime = state.task_runtime || (state.task_runtime = {})
  const runtime = taskRuntime[taskId] || (taskRuntime[taskId] = {})
  runtime.retry_count = 0
  runtime.debugging_phases_completed = []
  runtime.hard_stop_triggered = false
  writeState(statePath, state)
  return { reset: true, task_id: taskId }
}

function summarizeExecutionUnit(task) {
  const files = task.files || {}
  const fileCount = [...(files.create || []), ...(files.modify || []), ...(files.test || [])].length
  const actions = task.actions || []
  const complexity = detectComplexity(actions.length, fileCount, Boolean(task.quality_gate), Boolean((task.steps || []).length))
  return { task_id: task.id, phase: task.phase, complexity, max_consecutive_tasks: calculateMaxTasks(complexity, 0) }
}

function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift()
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : null
  }
  return { command, args, option }
}

function main() {
  try {
    const { command, args, option } = parseArgs(process.argv.slice(2))
    if (command === 'resolve-mode') {
      process.stdout.write(`${JSON.stringify({ execution_mode: resolveExecutionMode(option('--override'), option('--state-mode')) })}\n`)
      return
    }
    if (command === 'context') {
      const result = loadExecutionContext(option('--project-id'), option('--project-root'))
      process.stdout.write(`${JSON.stringify(result)}\n`)
      if (result.error) process.exitCode = 1
      return
    }
    if (command === 'skip') {
      const statePath = resolveExistingStatePath(args[0])
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`${JSON.stringify(markTaskSkipped(statePath, args[1], fs.readFileSync(args[1], 'utf8'), args[2]))}\n`)
      return
    }
    if (command === 'retry') {
      const statePath = resolveExistingStatePath(args[0])
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`${JSON.stringify(prepareRetry(statePath, args[1], option('--reason'), option('--failure-stage') || 'execution'))}\n`)
      return
    }
    if (command === 'retry-reset') {
      const statePath = resolveExistingStatePath(args[0])
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`${JSON.stringify(resetRetryRuntime(statePath, args[1]))}\n`)
      return
    }
    process.stderr.write('Usage: node execution_sequencer.js <resolve-mode|context|skip|retry|retry-reset> ...\n')
    process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  VALID_EXECUTION_MODES,
  loadProjectConfig,
  extractProjectId,
  resolveStatePathForProject,
  resolveCliStatePath,
  resolveExistingStatePath,
  buildExecuteEntry,
  loadExecutionContext,
  resolveExecutionMode,
  detectNextTask,
  updateAfterTaskCompletion,
  markTaskSkipped,
  prepareRetry,
  resetRetryRuntime,
  summarizeExecutionUnit,
}

if (require.main === module) main()
