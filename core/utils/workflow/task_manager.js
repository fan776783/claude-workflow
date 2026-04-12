#!/usr/bin/env node
/** @file 任务管理器 - 工作流任务的状态查询、完成、失败、依赖检查、并行分组等命令 */

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

/**
 * 检测当前项目的项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录路径
 * @returns {string|null} 项目 ID
 */
function detectProjectId(projectRoot = null) {
  return detectProjectIdFromRoot(projectRoot)
}

/**
 * 检测并解析项目根目录的绝对路径
 * @param {string|null} [projectRoot=null] - 项目根目录路径，为空时自动检测
 * @returns {string} 解析后的项目根目录绝对路径
 */
function detectProjectRoot(projectRoot = null) {
  if (projectRoot) return path.resolve(projectRoot)
  const configPath = path.join(process.cwd(), '.claude', 'config', 'project-config.json')
  if (fs.existsSync(configPath)) return path.dirname(path.dirname(path.dirname(configPath)))
  return process.cwd()
}

/**
 * 解析 Plan 产物的绝对路径
 * @param {string} projectRoot - 项目根目录
 * @param {string} artifactRef - 产物引用路径（相对或绝对）
 * @returns {string|null} 解析后的绝对路径，无效时返回 null
 */
function resolvePlanArtifactPath(projectRoot, artifactRef) {
  if (!artifactRef) return null
  if (path.isAbsolute(artifactRef)) return artifactRef
  const resolved = resolveUnder(projectRoot, artifactRef)
  if (resolved) return resolved
  const fallback = path.resolve(projectRoot, artifactRef)
  const projectRootResolved = path.resolve(projectRoot)
  return fallback === projectRootResolved || fallback.startsWith(`${projectRootResolved}${path.sep}`) ? fallback : null
}

/**
 * 解析工作流状态和任务内容
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Array} [state, statePath, tasksContent, tasksPath]，无效时各项为 null
 */
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

/**
 * 构建工作流运行时摘要，汇总 delta 追踪、规划门控、质量关卡等信息
 * @param {Object} state - 工作流状态对象
 * @returns {Object} 运行时摘要对象
 */
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

/**
 * 查询工作流状态概览
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 状态概览，包含进度、任务数、运行时摘要等
 */
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

/**
 * 列出所有任务及其状态
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 任务列表，包含 total 和 tasks 数组
 */
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

/**
 * 查找下一个待执行的任务
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 下一个任务信息或完成提示
 */
function cmdNext(projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !tasksContent) return { error: '没有活跃的工作流或任务' }
  const progress = state.progress || {}
  const nextId = findNextTask(tasksContent, progress.completed || [], progress.skipped || [], progress.failed || [], progress.blocked || [])
  if (!nextId) return { next_task: null, message: '所有任务已完成或被阻塞' }
  const task = parseTasksV2(tasksContent).find((item) => item.id === nextId)
  return { next_task: task ? taskToDict(task) : nextId }
}

/**
 * 将指定任务标记为已完成
 * @param {string} taskId - 任务 ID
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 操作结果
 */
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

/**
 * 将指定任务标记为失败
 * @param {string} taskId - 任务 ID
 * @param {string} reason - 失败原因
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 操作结果
 */
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

/**
 * 查询指定任务的依赖状态
 * @param {string} taskId - 任务 ID
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 依赖检查结果
 */
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

/**
 * 查找可并行执行的任务分组
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 并行分组结果
 */
function cmdParallel(projectId = null, projectRoot = null) {
  const [state, , tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !tasksContent) return { error: '没有活跃的工作流或任务' }
  const progress = state.progress || {}
  const taskDicts = parseTasksV2(tasksContent).map(taskToDict)
  const groups = findParallelGroups(taskDicts, progress.completed || [], progress.blocked || [], progress.skipped || [], progress.failed || [])
  return { parallel_groups: groups, group_count: groups.length }
}

/**
 * 查询工作流整体进度
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 进度详情，包含完成数、失败数、百分比、进度条等
 */
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

/**
 * 查询上下文预算使用情况
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 预算评估结果
 */
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

/**
 * 获取工作流运行时摘要
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 运行时摘要
 */
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
