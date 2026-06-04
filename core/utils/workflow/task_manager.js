#!/usr/bin/env node
/** @file 任务管理器 - 工作流任务的状态查询、完成、失败、依赖检查、并行分组等命令 */

const fs = require('fs')
const path = require('path')
const { checkTaskDeps } = require('./dependency_checker')
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
  extractConstraints,
} = require('./task_parser')
const { createTaskSource } = require('./task_source')
const { findOrphanedAnchors, firstDispatchableTaskId } = require('./workflow_types')

// S3 重基（FR-2）：task_manager 的 task 序列来源从 parseTasksV2(plan.md) 切到 TaskSource。
// 这些命令（complete/next/list/progress/deps）是 execute 主推进路径（workflow_cli advance）的真实落点。
// T9（C-7/C-1）：经 createTaskSource 工厂选 adapter——task-dir → TaskDirSource，仅 legacy plan.md → LegacyPlanMdSource。
function resolveProjectIdForTasks(state, projectId = null, projectRoot = null) {
  return projectId || (state && (state.project_id || state.projectId)) || detectProjectId(projectRoot) || null
}

// 取 TaskSource：legacy plan.md workflow 缺 task-dir 时回退 LegacyPlanMdSource（真实 advance 路径 C-7 兜底）。
// quiet=true：task_manager 内部多命令复用，迁移提示由首个命中处打印（进程内去重），避免重复刷屏。
function taskSourceFor(state, projectId = null, projectRoot = null) {
  return createTaskSource(state, { projectId, projectRoot, quiet: true })
}

// 下一个待执行 task：按 TaskSource 顺序排除 completed/skipped/failed/blocked。
// 实现收敛到 workflow_types.firstDispatchableTaskId（C-1 共享谓词），此处保留导出名兼容既有调用方。
function nextTaskIdFromSource(tasks, progress = {}) {
  return firstDispatchableTaskId(tasks, progress)
}

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
 * 解析工作流状态和任务内容。
 * @returns {Array} [state, statePath, tasksContent, tasksPath, code]
 *   - 成功：前 4 项有效，code === null
 *   - 失败：未解析的项为 null，code 为 snake_case 根因
 *     （project_id_missing / project_id_invalid / state_file_missing /
 *      plan_file_unset / plan_path_unresolved / plan_file_missing）
 */
function resolveStateAndTasks(projectId = null, projectRoot = null) {
  const pid = projectId || detectProjectId(projectRoot)
  if (!pid) return [null, null, null, null, 'project_id_missing']
  if (!validateProjectId(pid)) return [null, null, null, null, 'project_id_invalid']
  const statePath = getWorkflowStatePath(pid)
  if (!statePath || !fs.existsSync(statePath)) return [null, null, null, null, 'state_file_missing']
  const state = readState(statePath, pid)
  const planRef = state.plan_file || ''
  if (!planRef) return [state, statePath, null, null, 'plan_file_unset']
  const resolvedProjectRoot = detectProjectRoot(projectRoot || state.project_root)
  const artifactPath = resolvePlanArtifactPath(resolvedProjectRoot, planRef)
  if (!artifactPath) return [state, statePath, null, null, 'plan_path_unresolved']
  if (!fs.existsSync(artifactPath)) return [state, statePath, null, null, 'plan_file_missing']
  return [state, statePath, fs.readFileSync(artifactPath, 'utf8'), artifactPath, null]
}

/**
 * 首次推进时把 state.status 从 planned 升为 running。
 * 返回 'planned->running' 以便调用方把信号带回调用方；其他状态不动并返回 null。
 */
function liftPlannedToRunning(state) {
  if (state.status !== 'planned') return null
  state.status = 'running'
  return 'planned->running'
}

/**
 * 构建工作流运行时摘要，汇总 delta 追踪、规划门控、上下文注入等信息
 * @param {Object} state - 工作流状态对象
 * @returns {Object} 运行时摘要对象
 */
function buildRuntimeSummary(state) {
  const reviewStatus = state.review_status || {}
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
  const [state, , , tasksPath, code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流', code }
  const progress = state.progress || {}
  const pid = resolveProjectIdForTasks(state, projectId, projectRoot)
  const source = taskSourceFor(state, pid, projectRoot)
  const sourceTasks = source ? source.listTasks() : []
  const total = sourceTasks.length
  const percent = calculateProgress(total, progress.completed || [], progress.skipped || [], progress.failed || [])
  // C-1 锚点可解析性只读暴露：current_tasks 含不在 task 源的 id → 派生 current_tasks_orphaned 标记，
  // 让 status 直接呈现矛盾（否则 current_tasks 原样回显 + total_tasks 各自健康，失配被双重掩盖）。
  // 全量 current_tasks 检查（对齐 plan-review 广度）；复用 listTasks 结果免二次读盘。
  const anchorOrphaned = Boolean(source) && findOrphanedAnchors(state.current_tasks, sourceTasks).length > 0
  return {
    workflow_status: state.status,
    plan_file: tasksPath || state.plan_file || '',
    current_tasks: state.current_tasks || [],
    ...(anchorOrphaned ? { current_tasks_orphaned: true } : {}),
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
  const [state, , , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流或任务', code }
  const pid = resolveProjectIdForTasks(state, projectId, projectRoot)
  const source = taskSourceFor(state, pid, projectRoot)
  const tasks = source ? source.listTasks() : []
  return {
    total: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name || '',
      phase: task.phase,
      status: task.status,
      emoji: getStatusEmoji(task.status),
      target_layer: task.target_layer,
      package: task.package,
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
  const [state, , , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流或任务', code }
  const pid = resolveProjectIdForTasks(state, projectId, projectRoot)
  const source = taskSourceFor(state, pid, projectRoot)
  const tasks = source ? source.listTasks() : []
  // task 源为空 + plan 未解析 → 透传 resolveStateAndTasks 的诊断 code（如 plan_file_unset / plan_file_missing），
  // 保持「无任务」的可诊断契约（task-dir 流程任务齐时 code 为 null，不影响正常推进）。
  if (!tasks.length && code) return { error: '没有活跃的工作流或任务', code }
  const progress = state.progress || {}
  const nextId = nextTaskIdFromSource(tasks, progress)
  if (!nextId) return { next_task: null, message: '所有任务已完成或被阻塞' }
  const task = source ? source.getTask(nextId) : null
  return { next_task: task || nextId }
}

/**
 * 将指定任务标记为已完成
 * @param {string} taskId - 任务 ID
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 操作结果
 */
function cmdComplete(taskId, projectId = null, projectRoot = null) {
  const [state, statePath, , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流或任务', code }
  const pid = resolveProjectIdForTasks(state, projectId, projectRoot)
  if (!pid) return { error: '无法解析 project id，无法标记完成', code }
  const source = taskSourceFor(state, pid, projectRoot)
  const task = source ? source.getTask(taskId) : null
  if (!task) return { error: `任务 ${taskId} 不存在于 task 源中，无法标记完成` }
  source.updateTaskStatus(taskId, 'completed')
  const progress = state.progress || (state.progress = {})
  const completed = progress.completed || (progress.completed = [])
  addUnique(completed, taskId)
  // complete 终结该 task：failed/blocked 一并清除（与 markTaskSkipped 对称）——
  // 终结 id 残留 blocked 会污染 selectAnchorId 回退域，让 repair-anchor 面对本可避免的脏数据。
  if ((progress.failed || []).includes(taskId)) progress.failed = progress.failed.filter((item) => item !== taskId)
  if ((progress.blocked || []).includes(taskId)) progress.blocked = progress.blocked.filter((item) => item !== taskId)
  const statusTransition = liftPlannedToRunning(state)
  writeState(statePath, state)
  const result = { completed: true, task_id: taskId }
  if (statusTransition) result.status_transition = statusTransition
  return result
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
  const [state, statePath, , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流或任务', code }
  const pid = resolveProjectIdForTasks(state, projectId, projectRoot)
  if (!pid) return { error: '无法解析 project id，无法标记失败', code }
  const source = taskSourceFor(state, pid, projectRoot)
  const task = source ? source.getTask(taskId) : null
  if (!task) return { error: `任务 ${taskId} 不存在于 task 源中，无法标记失败` }
  source.updateTaskStatus(taskId, 'failed')
  state.status = 'halted'
  state.halt_reason = 'failure'
  state.failure_reason = reason
  state.current_tasks = [taskId]
  const progress = state.progress || (state.progress = {})
  const failed = progress.failed || (progress.failed = [])
  addUnique(failed, taskId)
  // 与 cmdComplete 对称：失败时把 taskId 移出 completed，避免 completed→fail 同 task 双计入。
  if ((progress.completed || []).includes(taskId)) progress.completed = progress.completed.filter((item) => item !== taskId)
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
  const [state, , , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流或任务', code }
  const pid = resolveProjectIdForTasks(state, projectId, projectRoot)
  const source = taskSourceFor(state, pid, projectRoot)
  const task = source ? source.getTask(taskId) : null
  if (!task) return { error: `任务 ${taskId} 不存在` }
  const progress = state.progress || {}
  // task-dir 记录仅含 depends（无 blocked_by）；blocked_by 为 plan.md 时代字段，task-dir 流程不再承载。
  return {
    ...checkTaskDeps(task.depends, progress.completed || []),
    task_id: taskId,
    depends: task.depends,
    blocked_by: task.blocked_by || [],
  }
}

/**
 * 查询工作流整体进度
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 进度详情，包含完成数、失败数、百分比、进度条等
 */
function cmdProgress(projectId = null, projectRoot = null) {
  const [state, , tasksContent, , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流或任务', code }
  const pid = resolveProjectIdForTasks(state, projectId, projectRoot)
  const source = taskSourceFor(state, pid, projectRoot)
  const progress = state.progress || {}
  const total = source ? source.listTasks().length : 0
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
    // 约束仍从 plan.md 叙述正文提取（如可读）；task-dir 不承载约束文本。
    constraints: tasksContent ? extractConstraints(tasksContent) : [],
  }
}

/**
 * 获取工作流运行时摘要
 * @param {string|null} [projectId=null] - 项目 ID
 * @param {string|null} [projectRoot=null] - 项目根目录
 * @returns {Object} 运行时摘要
 */
function cmdRuntimeSummary(projectId = null, projectRoot = null) {
  const [state, , , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state) return { error: '没有活跃的工作流', code }
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
      progress: () => cmdProgress(options.projectId, options.projectRoot),
    }
    const handler = handlers[command]
    if (!handler) {
      process.stderr.write('Usage: node task_manager.js [--project-id ID] [--project-root DIR] <status|list|next|complete|fail|deps|progress> ...\n')
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
  liftPlannedToRunning,
  buildRuntimeSummary,
  cmdStatus,
  cmdList,
  cmdNext,
  cmdComplete,
  cmdFail,
  cmdDeps,
  cmdProgress,
  cmdRuntimeSummary,
}

if (require.main === module) main()
