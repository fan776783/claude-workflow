#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  calculateMaxTasks,
  detectComplexity,
  evaluateBudgetThresholds,
} = require('./context_budget')
const { summarizeTaskIndependence } = require('./dependency_checker')
const {
  assertCanonicalWorkflowStatePath,
  getWorkflowStatePath,
  validateProjectId,
} = require('./path_utils')
const { readState, updateContinuation, writeState } = require('./state_manager')
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
const HARD_STOP_ACTIONS = new Set(['handoff-required', 'pause-budget', 'pause-governance', 'pause-quality-gate', 'pause-before-commit'])
// 软提示常量：高 pollution + 独立 task 组合命中时携带，主会话据此给用户 banner 软提示，不阻塞执行
const ADVISORY_CONSIDER_HANDOFF_OR_SPLIT = 'consider-handoff-or-split'
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

function assessContextPollutionRisk(task, budget) {
  if (!task) {
    return {
      level: 'medium',
      reasons: ['缺少下一任务上下文，按中等污染风险处理'],
      preferredExecutionPath: 'direct',
    }
  }
  const actions = task.actions || []
  const verification = task.verification || {}
  const files = task.files || {}
  const steps = task.steps || []
  const reasons = []
  if (actions.some((action) => ['run_tests', 'quality_review'].includes(action))) reasons.push('任务会产出测试或审查输出')
  if ((verification.commands || []).length) reasons.push('任务包含显式验证命令')
  if ((files.test || []).length > 0) reasons.push('任务直接涉及测试文件')
  if (steps.length >= 3) reasons.push('任务步骤较多，可能伴随更多中间过程')
  if (budget.at_warning) reasons.push('预算进入 warning 区，应避免继续污染主会话')
  let level = 'low'
  let preferred = 'direct'
  // quality_review 在 reviewer subagent 隔离执行，不污染 controller 上下文。
  // 只在 run_tests 或多 reasons 时升 high；actions.includes('quality_review') 单独不触发。
  if (actions.includes('run_tests') || reasons.length >= 3) {
    level = 'high'
    preferred = 'single-subagent'
  } else if (reasons.length) {
    level = 'medium'
  } else {
    reasons.push('任务输出预期较聚焦')
  }
  return { level, reasons, preferredExecutionPath: preferred }
}

function buildDecision(action, reason, severity, budget, suggestedExecutionPath = 'direct', primarySignals = null, budgetBackstopTriggered = false, decisionNotes = null, advisory = null) {
  return {
    action,
    reason,
    severity,
    budget,
    suggestedExecutionPath,
    primarySignals: primarySignals || {},
    budgetBackstopTriggered,
    budgetLevel: budget.level || 'safe',
    decisionNotes: decisionNotes || [],
    ...(advisory ? { advisory } : {}),
  }
}

function decideGovernanceAction(state, nextTask = null, executionMode = 'continuous', pauseBeforeCommit = false, hasParallelBoundary = false) {
  const normalizedState = ensureStateDefaults(state)
  const metrics = normalizedState.contextMetrics || {}
  const projectedUsage = Number(metrics.projectedUsagePercent ?? metrics.usagePercent ?? 0)
  const warning = Number(metrics.warningThreshold ?? 60)
  const danger = Number(metrics.dangerThreshold ?? 80)
  const hardHandoff = Number(metrics.hardHandoffThreshold ?? 90)
  const budget = evaluateBudgetThresholds(projectedUsage, warning, danger, hardHandoff)
  const independence = summarizeTaskIndependence(nextTask, hasParallelBoundary)
  const pollution = assessContextPollutionRisk(nextTask, budget)
  const primarySignals = { taskIndependence: independence, contextPollutionRisk: pollution }

  const effective = deriveEffectiveStatus(normalizedState)
  if (effective.status === 'halted' && (effective.halt_reason === 'failure' || effective.halt_reason === 'dependency')) {
    const label = effective.halt_reason === 'failure' ? 'failure' : 'dependency'
    return buildDecision('pause-governance', `status-halted-${label}`, 'warning', budget, 'direct', primarySignals, false, [`工作流已 halted（${label}），优先暂停治理`])
  }
  if (budget.at_hard_handoff) {
    return buildDecision('handoff-required', 'hard-handoff-threshold', 'critical', budget, 'direct', primarySignals, true, ['预算达到硬停止阈值，必须交接'])
  }
  // 质量门暂停由 Step 7 post-execution（decidePostExecutionAction）处理；执行前 decide 不判 quality_gate。
  if (nextTask) {
    const actions = nextTask.actions || []
    if (pauseBeforeCommit && actions.includes('git_commit')) {
      return buildDecision('pause-before-commit', 'pause-before-commit', 'info', budget, 'direct', primarySignals, false, ['提交前仍需人工确认'])
    }
  }
  if (executionMode === 'phase' && nextTask) {
    const currentId = (normalizedState.current_tasks || [null])[0]
    const tasksContent = normalizedState._tasks_content
    const parsedTasks = tasksContent ? parseTasksV2(tasksContent) : []
    const currentTask = parsedTasks.find((task) => task.id === currentId)
    if (currentTask?.phase && nextTask.phase && currentTask.phase !== nextTask.phase) {
      return buildDecision('pause-governance', 'phase-boundary', 'info', budget, 'direct', primarySignals, false, ['phase 模式下跨阶段仍暂停'])
    }
  }
  if (independence.parallelizable && pollution.level === 'high') {
    // 高 pollution + 独立 task 组合：携带 advisory 软提示让用户考虑 handoff / split，不阻塞执行。
    return buildDecision(
      'continue-direct',
      'independent-high-pollution',
      'info',
      budget,
      'direct',
      primarySignals,
      false,
      [...independence.reasons, ...pollution.reasons],
      ADVISORY_CONSIDER_HANDOFF_OR_SPLIT
    )
  }
  if (pollution.level === 'high' && independence.level === 'low') {
    const action = budget.at_danger ? 'pause-budget' : 'pause-governance'
    const reason = budget.at_danger ? 'context-danger' : 'high-pollution-without-independent-boundary'
    return buildDecision(action, reason, 'warning', budget, pollution.preferredExecutionPath || 'direct', primarySignals, budget.at_danger, ['高污染任务且缺少独立边界，不应继续扩张主会话'])
  }
  if (budget.at_danger && pollution.preferredExecutionPath === 'direct') {
    return buildDecision('pause-budget', 'context-danger', 'warning', budget, 'direct', primarySignals, true, ['预算危险区且建议路径仍会扩张主会话'])
  }
  return buildDecision('continue-direct', 'governor-allows', 'info', budget, pollution.preferredExecutionPath || 'direct', primarySignals, false, [...independence.reasons, ...pollution.reasons])
}

// task 完成 + reviewer 出结果后由 Step 7 调用。基于 {reviewResult, budget, completedTask} 决定是否暂停。
// 与 decideGovernanceAction 区别：本函数运行在 task 完成**后**，已知 review 结论，可据此精确判断。
function decidePostExecutionAction(state, completedTask = null, reviewResult = null) {
  const normalizedState = ensureStateDefaults(state)
  const metrics = normalizedState.contextMetrics || {}
  const projectedUsage = Number(metrics.projectedUsagePercent ?? metrics.usagePercent ?? 0)
  const warning = Number(metrics.warningThreshold ?? 60)
  const danger = Number(metrics.dangerThreshold ?? 80)
  const hardHandoff = Number(metrics.hardHandoffThreshold ?? 90)
  const budget = evaluateBudgetThresholds(projectedUsage, warning, danger, hardHandoff)
  const primarySignals = {
    reviewResult: reviewResult ? { passed: Boolean(reviewResult.passed), decision: reviewResult.decision || null } : null,
    completedTaskId: completedTask ? completedTask.id || null : null,
    qualityGate: Boolean(completedTask && completedTask.quality_gate),
  }

  // 预算硬停止优先
  if (budget.at_hard_handoff) {
    return buildDecision('handoff-required', 'hard-handoff-threshold', 'critical', budget, 'direct', primarySignals, true, ['预算达到硬停止阈值，必须交接'])
  }

  // review FAIL → halt 让用户决策（review 修复路径已由 implementer revise 处理；本路径仅在 reviewer 终态 reject 时触发）
  if (reviewResult && reviewResult.passed === false) {
    return buildDecision(
      'pause-quality-gate',
      'review-failed',
      'warning',
      budget,
      'direct',
      primarySignals,
      false,
      ['Reviewer 终态 FAIL，暂停让用户决策（escalate / accept-deviation / 手动修复）']
    )
  }

  // quality_gate task + budget warning+：暂停让用户看 review 结论再继续（保留原"质量关卡"语义）
  if (completedTask && completedTask.quality_gate && (budget.at_warning || budget.at_danger)) {
    return buildDecision(
      'pause-quality-gate',
      'quality-gate-budget-pressure',
      'info',
      budget,
      'direct',
      primarySignals,
      budget.at_danger,
      ['Quality gate 完成且预算进入 warning/danger 区，暂停让用户决策是否继续']
    )
  }

  // 默认放行
  return buildDecision('continue-direct', 'post-execution-allows', 'info', budget, 'direct', primarySignals, false, ['Review PASS 且预算安全，继续下一 task'])
}

function applyGovernanceDecision(state, decision, statePath = null, nextTaskIds = null, artifactPath = null) {
  const normalizedState = ensureStateDefaults(state)
  const action = decision.action || 'continue-direct'
  if (HARD_STOP_ACTIONS.has(action)) {
    normalizedState.status = 'halted'
    normalizedState.halt_reason = 'governance'
    updateContinuation(
      normalizedState,
      action,
      decision.reason || 'unknown',
      decision.severity || 'info',
      nextTaskIds || [],
      action === 'handoff-required',
      artifactPath,
      decision.suggestedExecutionPath || 'direct',
      decision.primarySignals || {},
      Boolean(decision.budgetBackstopTriggered),
      decision.budgetLevel || 'safe',
      decision.decisionNotes || []
    )
    if (statePath) writeState(statePath, normalizedState)
  }
  return normalizedState
}

function updateAfterTaskCompletion(state, tasksContent) {
  const normalizedState = ensureStateDefaults(state)
  const nextTaskId = detectNextTask(tasksContent, normalizedState)
  if (nextTaskId) {
    normalizedState.current_tasks = [nextTaskId]
    normalizedState.status = 'running'
  } else {
    normalizedState.current_tasks = []
    normalizedState.status = 'review_pending'
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
    state.current_tasks = []
    state.status = 'review_pending'
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
    if (command === 'decide') {
      const statePath = resolveExistingStatePath(args[0])
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      const state = ensureStateDefaults(readState(statePath))
      const nextTask = option('--next-task-json') ? JSON.parse(option('--next-task-json')) : null
      process.stdout.write(`${JSON.stringify(decideGovernanceAction(state, nextTask, option('--execution-mode') || 'continuous', args.includes('--pause-before-commit'), args.includes('--has-parallel-boundary')))}\n`)
      return
    }
    // Step 7 post-execution governance CLI 入口。
    // 用法: decide-post-execution <state-path> --completed-task-json '{...}' --review-result-json '{...}'
    // pause-before-commit 由 pre-execution `decide` 处理（看 next task），post-execution 不涉及。
    if (command === 'decide-post-execution') {
      const statePath = resolveExistingStatePath(args[0])
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      const state = ensureStateDefaults(readState(statePath))
      const completedTask = option('--completed-task-json') ? JSON.parse(option('--completed-task-json')) : null
      const reviewResult = option('--review-result-json') ? JSON.parse(option('--review-result-json')) : null
      process.stdout.write(`${JSON.stringify(decidePostExecutionAction(state, completedTask, reviewResult))}\n`)
      return
    }
    if (command === 'apply-decision') {
      const statePath = resolveExistingStatePath(args[0])
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      const state = ensureStateDefaults(readState(statePath))
      const decision = JSON.parse(option('--decision-json'))
      const nextTaskIds = String(option('--next-task-ids') || '').split(',').map((item) => item.trim()).filter(Boolean)
      const updatedState = applyGovernanceDecision(state, decision, statePath, nextTaskIds, option('--artifact-path'))
      process.stdout.write(`${JSON.stringify({ status: updatedState.status, continuation: updatedState.continuation })}\n`)
      return
    }
    process.stderr.write('Usage: node execution_sequencer.js <resolve-mode|context|skip|retry|retry-reset|decide|decide-post-execution|apply-decision> ...\n')
    process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  VALID_EXECUTION_MODES,
  HARD_STOP_ACTIONS,
  ADVISORY_CONSIDER_HANDOFF_OR_SPLIT,
  loadProjectConfig,
  extractProjectId,
  resolveStatePathForProject,
  resolveCliStatePath,
  resolveExistingStatePath,
  buildExecuteEntry,
  loadExecutionContext,
  resolveExecutionMode,
  detectNextTask,
  assessContextPollutionRisk,
  decideGovernanceAction,
  decidePostExecutionAction,
  applyGovernanceDecision,
  updateAfterTaskCompletion,
  markTaskSkipped,
  prepareRetry,
  resetRetryRuntime,
  summarizeExecutionUnit,
}

if (require.main === module) main()
