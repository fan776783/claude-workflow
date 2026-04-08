#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  evaluateBudgetThresholds,
  generateContextBar,
} = require('./context_budget')
const { checkTaskDeps, findParallelGroups } = require('./dependency_checker')
const {
  detectProjectIdFromRoot,
  getWorkflowStatePath,
  resolveUnder,
  validateProjectId,
} = require('./path_utils')
const {
  calculateProgress,
  generateProgressBar,
  readState,
  writeState,
} = require('./state_manager')
const { addUnique, getStatusEmoji } = require('./status_utils')
const {
  countTasks,
  extractConstraints,
  findNextTask,
  parseTasksV2,
  taskToDict,
  updateTaskStatusInMarkdown,
} = require('./task_parser')

function detectProjectId(projectRoot = null) {
  return detectProjectIdFromRoot(projectRoot)
}

function detectProjectRoot(projectRoot = null) {
  if (projectRoot) return path.resolve(projectRoot)
  const configPath = path.join(process.cwd(), '.claude', 'config', 'project-config.json')
  if (fs.existsSync(configPath)) return path.dirname(path.dirname(path.dirname(configPath)))
  return process.cwd()
}

function resolvePlanArtifactPath(projectRoot, artifactRef) {
  if (!artifactRef) return null
  if (path.isAbsolute(artifactRef)) return artifactRef
  const resolved = resolveUnder(projectRoot, artifactRef)
  if (resolved) return resolved
  const fallback = path.resolve(projectRoot, artifactRef)
  const projectRootResolved = path.resolve(projectRoot)
  return fallback === projectRootResolved || fallback.startsWith(`${projectRootResolved}${path.sep}`) ? fallback : null
}

function resolveStateAndTasks(projectId = null, projectRoot = null) {
  const pid = projectId || detectProjectId(projectRoot)
  if (!pid || !validateProjectId(pid)) return [null, null, null, null]
  const statePath = getWorkflowStatePath(pid)
  if (!statePath || !fs.existsSync(statePath)) return [null, null, null, null]
  const state = readState(statePath, pid)
  const resolvedProjectRoot = detectProjectRoot(projectRoot || state.project_root)
  const artifactPath = resolvePlanArtifactPath(resolvedProjectRoot, state.plan_file || '')
  if (!artifactPath || !fs.existsSync(artifactPath)) return [state, statePath, null, null]
  return [state, statePath, fs.readFileSync(artifactPath, 'utf8'), artifactPath]
}

function buildRuntimeSummary(state) {
  const reviewStatus = state.review_status || {}
  const qualityGates = state.quality_gates || {}
  return {
    delta_tracking: state.delta_tracking || {},
    planning_gates: {
      discussion: state.discussion || {},
      requirement_baseline: state.requirement_baseline || {},
      ux_design: state.ux_design || {},
      user_spec_review: reviewStatus.user_spec_review || {},
      plan_review: reviewStatus.plan_review || {},
    },
    context_injection: state.context_injection || {},
    quality_gate_summary: {
      count: Object.keys(qualityGates).length,
      passed: Object.entries(qualityGates).filter(([, gate]) => gate.overall_passed).map(([taskId]) => taskId).sort(),
      task_ids: Object.keys(qualityGates).sort(),
    },
    unblocked: state.unblocked || [],
  }
}

function cmdStatus(projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流' }
  const progress = state.progress || {}
  const total = tasksContent ? countTasks(tasksContent) : 0
  const percent = calculateProgress(total, progress.completed || [], progress.skipped || [], progress.failed || [])
  return {
    workflow_status: state.status,
    current_tasks: state.current_tasks || [],
    total_tasks: total,
    completed: (progress.completed || []).length,
    failed: (progress.failed || []).length,
    skipped: (progress.skipped || []).length,
    progress_percent: percent,
    progress_bar: generateProgressBar(percent),
    ...buildRuntimeSummary(state),
    ...(state.failure_reason ? { failure_reason: state.failure_reason } : {}),
  }
}

function cmdList(projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !tasksContent) return { error: '没有活跃的工作流或任务' }
  const tasks = parseTasksV2(tasksContent)
  return {
    total: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      phase: task.phase,
      status: task.status,
      emoji: getStatusEmoji(task.status),
      quality_gate: task.quality_gate,
      actions: task.actions,
    })),
  }
}

function cmdNext(projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !tasksContent) return { error: '没有活跃的工作流或任务' }
  const progress = state.progress || {}
  const nextId = findNextTask(tasksContent, progress.completed || [], progress.skipped || [], progress.failed || [], progress.blocked || [])
  if (!nextId) return { next_task: null, message: '所有任务已完成或被阻塞' }
  const task = parseTasksV2(tasksContent).find((item) => item.id === nextId)
  return { next_task: task ? taskToDict(task) : nextId }
}

function cmdComplete(taskId, projectId = null, projectRoot = null) {
  const [state, statePath, tasksContent, tasksPath] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath || !tasksContent || !tasksPath) return { error: '没有活跃的工作流或任务' }
  fs.writeFileSync(tasksPath, updateTaskStatusInMarkdown(tasksContent, taskId, 'completed'))
  const progress = state.progress || (state.progress = {})
  const completed = progress.completed || (progress.completed = [])
  addUnique(completed, taskId)
  if ((progress.failed || []).includes(taskId)) progress.failed = progress.failed.filter((item) => item !== taskId)
  writeState(statePath, state)
  return { completed: true, task_id: taskId }
}

function cmdFail(taskId, reason, projectId = null, projectRoot = null) {
  const [state, statePath, tasksContent, tasksPath] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath || !tasksContent || !tasksPath) return { error: '没有活跃的工作流或任务' }
  fs.writeFileSync(tasksPath, updateTaskStatusInMarkdown(tasksContent, taskId, 'failed'))
  state.status = 'failed'
  state.failure_reason = reason
  state.current_tasks = [taskId]
  const progress = state.progress || (state.progress = {})
  const failed = progress.failed || (progress.failed = [])
  addUnique(failed, taskId)
  writeState(statePath, state)
  return { failed: true, task_id: taskId, reason }
}

function cmdDeps(taskId, projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !tasksContent) return { error: '没有活跃的工作流或任务' }
  const task = parseTasksV2(tasksContent).find((item) => item.id === taskId)
  if (!task) return { error: `任务 ${taskId} 不存在` }
  const progress = state.progress || {}
  return {
    ...checkTaskDeps(task.depends, progress.completed || []),
    task_id: taskId,
    depends: task.depends,
    blocked_by: task.blocked_by,
  }
}

function cmdParallel(projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !tasksContent) return { error: '没有活跃的工作流或任务' }
  const progress = state.progress || {}
  const taskDicts = parseTasksV2(tasksContent).map(taskToDict)
  const groups = findParallelGroups(taskDicts, progress.completed || [], progress.blocked || [], progress.skipped || [], progress.failed || [])
  return { parallel_groups: groups, group_count: groups.length }
}

function cmdProgress(projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !tasksContent) return { error: '没有活跃的工作流或任务' }
  const progress = state.progress || {}
  const total = countTasks(tasksContent)
  const percent = calculateProgress(total, progress.completed || [], progress.skipped || [], progress.failed || [])
  return {
    total,
    completed: (progress.completed || []).length,
    skipped: (progress.skipped || []).length,
    failed: (progress.failed || []).length,
    blocked: (progress.blocked || []).length,
    pending: total - (progress.completed || []).length - (progress.skipped || []).length - (progress.failed || []).length,
    percent,
    bar: generateProgressBar(percent),
    constraints: extractConstraints(tasksContent),
  }
}

function cmdContextBudget(projectId = null, projectRoot = null) {
  const [state] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流' }
  const metrics = state.contextMetrics || {}
  const usage = Number(metrics.usagePercent || 0)
  const projected = Number(metrics.projectedUsagePercent || 0)
  const budget = evaluateBudgetThresholds(projected)
  return {
    ...budget,
    current_usage: usage,
    context_bar: generateContextBar(usage),
    max_consecutive_tasks: Number(metrics.maxConsecutiveTasks || 5),
    consecutive_count: Number(state.consecutive_count || 0),
  }
}

function cmdRuntimeSummary(projectId = null, projectRoot = null) {
  const [state] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流' }
  return buildRuntimeSummary(state)
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
  return { options, command: args.shift(), args }
}

function main() {
  try {
    const { options, command, args } = parseArgs(process.argv.slice(2))
    const handlers = {
      status: () => cmdStatus(options.projectId, options.projectRoot),
      list: () => cmdList(options.projectId, options.projectRoot),
      next: () => cmdNext(options.projectId, options.projectRoot),
      complete: () => cmdComplete(args[0], options.projectId, options.projectRoot),
      fail: () => cmdFail(args[0], args[1], options.projectId, options.projectRoot),
      deps: () => cmdDeps(args[0], options.projectId, options.projectRoot),
      parallel: () => cmdParallel(options.projectId, options.projectRoot),
      progress: () => cmdProgress(options.projectId, options.projectRoot),
      'context-budget': () => cmdContextBudget(options.projectId, options.projectRoot),
    }
    const handler = handlers[command]
    if (!handler) {
      process.stderr.write('Usage: node task_manager.js [--project-id ID] [--project-root DIR] <status|list|next|complete|fail|deps|parallel|progress|context-budget> ...\n')
      process.exitCode = 1
      return
    }
    process.stdout.write(`${JSON.stringify(handler(), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  detectProjectId,
  detectProjectRoot,
  resolvePlanArtifactPath,
  resolveStateAndTasks,
  buildRuntimeSummary,
  cmdStatus,
  cmdList,
  cmdNext,
  cmdComplete,
  cmdFail,
  cmdDeps,
  cmdParallel,
  cmdProgress,
  cmdContextBudget,
  cmdRuntimeSummary,
}

if (require.main === module) main()
