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
const { createTaskSource } = require('./task_source')
const { acknowledgeSkippedSpecReview, assertExecutableTaskSourcePresent, assertTaskSourcePresent, deriveEffectiveStatus, ensureStateDefaults, getSpecReviewGateViolation } = require('./workflow_types')

// S3 重基（FR-2）：sequencer 的 task 序列来源从 parseTasksV2(plan.md) 切到 TaskSource（task-dir）。
// projectId 优先取自参数/state，再回退 detectProjectId(projectRoot)。
function resolveSequencerProjectId(state, projectId = null, projectRoot = null) {
  return projectId || (state && (state.project_id || state.projectId)) || detectProjectId(projectRoot) || null
}

// detectNextTask 改吃 task 记录数组（{id,status}），不再吃 plan.md 文本。
// 顺序由 TaskDirSource.listTasks() 的 taskId 数字序保证（C-1）。
function nextTaskIdFromTasks(tasks, progress = {}) {
  const excluded = new Set([
    ...(progress.completed || []),
    ...(progress.skipped || []),
    ...(progress.failed || []),
  ])
  const blocked = new Set(progress.blocked || [])
  for (const task of tasks || []) {
    const id = task && task.id
    if (!id) continue
    if (!excluded.has(id) && !blocked.has(id)) return id
  }
  return null
}

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
  // F-01：task_source_missing 是 B-full invariant 缺源诊断——必须在入口阻断 execute/continue，不能放行。
  // （旧路径靠 state=null 隐式阻断；现 loadExecutionContext 带 state 回传供门控判定，需在此显式短路，
  //  否则 planned/running/halted + 空 task-dir 会误判为可执行，进入无 task 可派发的困惑性空跑。）
  if (context.code === 'task_source_missing') {
    return {
      entry_action: 'none',
      resolved_mode: null,
      project_id: projectId,
      state_status: context.state ? context.state.status : null,
      can_resume: false,
      reason: 'task_source_missing',
      message: context.error || 'task 源缺失（task-dir 为空），无法进入执行阶段。请重新运行 /workflow-plan 生成 task 源。',
    }
  }
  try {
    assertExecutableTaskSourcePresent(context.state || {}, projectId, String(projectRoot))
  } catch (error) {
    if (error && (error.code === 'task_dir_schema_v1' || error.code === 'task_dir_not_executable')) {
      return {
        entry_action: 'none',
        resolved_mode: null,
        project_id: projectId,
        state_status: context.state ? context.state.status : null,
        can_resume: false,
        reason: error.code,
        message: error.message,
      }
    }
    throw error
  }
  // task_source_missing 之外的可诊断态：context.state 仍带回供门控判定。
  // 真正"无 state"（resolveStateAndTasks 早退）才置 null。
  let state = context.state || (!context.error ? context.state : null)
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
      const message = state.status === 'spec_review'
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
      const message = ['planned', 'spec_review'].includes(status)
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
  // plan.md 仍解析以拿 statePath / 叙述正文路径，但 task 序列改读 task-dir（TaskSource）。
  // plan.md 缺失（plan_file_unset / plan_file_missing）不再致命：task 源是 task-dir。
  const [state, statePath, tasksContent, tasksPath, code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流', code }
  const normalizedState = ensureStateDefaults(state)
  const pid = resolveSequencerProjectId(normalizedState, projectId, projectRoot)
  // T9/S2：工厂选 adapter —— task-dir → TaskDirSource，仅 legacy plan.md → LegacyPlanMdSource（C-7 兜底）。
  // 皆无 → null，由下方 assertTaskSourcePresent 报 task_source_missing（不静默）。
  const source = createTaskSource(normalizedState, { projectId: pid, projectRoot })
  const tasks = source ? source.listTasks() : []
  // B-full invariant（FR-8 / C-3）：planned/running/halted 必须有非空 task 源。
  // 这里不抛——entry-gating / status 等只读消费者复用 loadExecutionContext，硬抛会误伤。
  // 缺源诊断走显式 error 字段（status 要求 task 源但为空时），advance/dispatch 路径另由 assertTaskSourcePresent 守门。
  if (!tasks.length) {
    try {
      assertTaskSourcePresent(normalizedState, pid, projectRoot)
    } catch (err) {
      if (err && err.code === 'task_source_missing') {
        return { error: err.message, code: err.code, state: normalizedState, state_path: statePath }
      }
      throw err
    }
  }
  const currentTaskId = (normalizedState.current_tasks || [null])[0]
  const currentTask = (source && currentTaskId) ? source.getTask(currentTaskId) : null
  if (tasksContent) normalizedState._tasks_content = tasksContent
  const currentTaskIds = (normalizedState.current_tasks || []).filter(Boolean)
  return {
    state: normalizedState,
    state_path: statePath,
    tasks_content: tasksContent,
    tasks_path: tasksPath,
    tasks,
    current_task: currentTask || null,
    current_task_id: currentTaskId,
    current_task_ids: currentTaskIds,
    total_tasks: tasks.length,
  }
}

function resolveExecutionMode(override, stateMode) {
  if (VALID_EXECUTION_MODES.has(override)) return override
  if (VALID_EXECUTION_MODES.has(stateMode)) return stateMode
  return 'continuous'
}

// detectNextTask(tasks, state)：tasks = TaskSource.listTasks() 的记录数组（{id,status}）。
// 兼容：仍接受 task 记录数组；不再吃 plan.md 文本（legacy plan.md 读取走 T9 LegacyPlanMdSource）。
function detectNextTask(tasks, state) {
  if (!Array.isArray(tasks) || !tasks.length) return null
  const progress = ensureStateDefaults(state).progress || {}
  return nextTaskIdFromTasks(tasks, progress)
}

// updateAfterTaskCompletion(state, tasks?)：tasks 可选；缺省时从 state 的 projectId 经 TaskDirSource 重新拉。
// 调用方（sequencer skip 路径）传入已更新的 task 列表以反映刚落盘的状态变化。
function updateAfterTaskCompletion(state, tasks = null) {
  const normalizedState = ensureStateDefaults(state)
  let taskList = tasks
  if (!Array.isArray(taskList)) {
    const pid = resolveSequencerProjectId(normalizedState)
    // 工厂选 adapter：legacy plan.md workflow 缺 task-dir 时仍能拉出 task 列表（C-1 等价）。
    const source = createTaskSource(normalizedState, { projectId: pid, quiet: true })
    taskList = source ? source.listTasks() : []
  }
  const nextTaskId = detectNextTask(taskList, normalizedState)
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

// skip：task 状态落 task-dir（task_store.updateTaskStatus），不再改写 plan.md。
// projectId 优先取 state.project_id，再回退检测；缺源 → updateTaskStatus 抛错由调用方兜。
function markTaskSkipped(statePath, taskId, projectId = null, projectRoot = null) {
  const state = ensureStateDefaults(readState(statePath))
  const pid = resolveSequencerProjectId(state, projectId, projectRoot)
  const progress = state.progress || (state.progress = {})
  const skipped = progress.skipped || (progress.skipped = [])
  if (!skipped.includes(taskId)) skipped.push(taskId)
  // 工厂选 adapter：legacy plan.md 缺 task-dir 时走 LegacyPlanMdSource（C-7 / C-1）。
  const source = createTaskSource(state, { projectId: pid, projectRoot, quiet: true })
  if (source) {
    try {
      source.updateTaskStatus(taskId, 'skipped')
    } catch { /* task 源缺该 task：跳过状态仍记在 progress.skipped */ }
  }
  const tasks = source ? source.listTasks() : []
  const nextTaskId = detectNextTask(tasks, state)
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
      // CLI 契约保持 `skip <state-path> <plan-path> <task-id>`；plan-path 已退役（task 源 = task-dir），仅占位兼容。
      // 先剥离 value-taking flag（及其值），按真正的位置参数定位 state / task-id——
      // 否则 `skip <state> <task> --project-id X` 会把 `--project-id` 误当 task-id（args.length>=3 命中）。
      const VALUE_FLAGS = new Set(['--project-id', '--project-root'])
      const positionals = []
      for (let i = 0; i < args.length; i += 1) {
        if (VALUE_FLAGS.has(args[i])) { i += 1; continue }
        if (String(args[i]).startsWith('--')) continue
        positionals.push(args[i])
      }
      const statePath = resolveExistingStatePath(positionals[0])
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      // task-id 取最后一个位置参数：兼容旧三参（state plan task）与新两参（state task）调用。
      const taskId = positionals.length >= 3 ? positionals[2] : positionals[1]
      process.stdout.write(`${JSON.stringify(markTaskSkipped(statePath, taskId, option('--project-id'), option('--project-root')))}\n`)
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
