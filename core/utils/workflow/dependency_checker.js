#!/usr/bin/env node
/**
 * @file 依赖检查器 - 提供任务依赖校验、阻塞状态协调、并行性分析和独立性评估
 */

/**
 * 检查任务的 depends 依赖是否全部满足
 * @param {string[]} depends - 依赖的任务 ID 列表
 * @param {string[]} completed - 已完成的任务 ID 列表
 * @returns {{satisfied: boolean, missing: string[]}} 是否满足及缺失的依赖列表
 */
function checkTaskDeps(depends, completed) {
  const missing = (depends || []).filter((dep) => !(completed || []).includes(dep))
  return { satisfied: missing.length === 0, missing }
}

/**
 * 检查任务的 blocked_by 阻塞依赖是否全部解除
 * @param {string[]} blockedBy - 阻塞依赖的任务 ID 列表
 * @param {string[]} unblocked - 已解除阻塞的任务 ID 列表
 * @returns {{satisfied: boolean, missing: string[]}} 是否满足及仍被阻塞的依赖列表
 */
function checkBlockedDeps(blockedBy, unblocked) {
  const missing = (blockedBy || []).filter((dep) => !(unblocked || []).includes(dep))
  return { satisfied: missing.length === 0, missing }
}

/**
 * 协调任务的阻塞状态变化，识别当前仍被阻塞和新解除阻塞的任务
 * @param {Object[]} tasks - 任务数组，每个任务包含 id 和 blocked_by
 * @param {string[]} unblocked - 已解除阻塞的任务 ID 列表
 * @param {string[]} blockedProgress - 上一轮被阻塞的任务 ID 列表
 * @returns {{blocked: string[], newly_unblocked: string[]}} 当前阻塞和新解除阻塞的任务 ID
 */
function reconcileBlockedTasks(tasks, unblocked, blockedProgress = []) {
  const previousBlocked = new Set(blockedProgress || [])
  const unblockedSet = new Set(unblocked || [])
  const currentBlocked = []
  const newlyUnblocked = []
  for (const task of tasks || []) {
    const taskId = task.id
    const missing = (task.blocked_by || []).filter((dep) => !unblockedSet.has(dep))
    if (missing.length === 0) {
      if (previousBlocked.has(taskId)) newlyUnblocked.push(taskId)
    } else if (taskId) {
      currentBlocked.push(taskId)
    }
  }
  return { blocked: currentBlocked, newly_unblocked: newlyUnblocked }
}

const API_NAME_PATTERN = /api|接口|服务层|service|fetch|request|http/i
const API_FILE_PATTERN = /services\/|api\/|http\//i
const EXTERNAL_PATTERN = /第三方|sdk|外部服务|third.party|payment|sms|oauth|oss/i
const SHARED_PATHS = ['store', 'config', 'constants', 'types', 'shared']

/**
 * 根据任务名称和文件路径分类依赖类型（api_spec、external 等）
 * @param {string} taskName - 任务名称
 * @param {string[]} filePaths - 涉及的文件路径列表
 * @param {Object[]|null} unresolvedDependencies - 未解决的依赖列表
 * @returns {string[]} 依赖类型数组
 */
function classifyDeps(taskName, filePaths, unresolvedDependencies = null) {
  const deps = []
  const filesStr = (filePaths || []).join(' ').toLowerCase()
  if (API_NAME_PATTERN.test(String(taskName || '')) || API_FILE_PATTERN.test(filesStr)) deps.push('api_spec')
  if (unresolvedDependencies && unresolvedDependencies.length) {
    for (const dep of unresolvedDependencies) {
      if (dep.status === 'not_started' && !deps.includes(dep.type)) deps.push(dep.type)
    }
  } else if (EXTERNAL_PATTERN.test(String(taskName || '')) && !deps.includes('external')) {
    deps.push('external')
  }
  return deps
}

/**
 * 评估单个任务的独立性等级，判断是否可并行化
 * @param {Object} task - 任务对象
 * @param {boolean} hasParallelBoundary - 是否存在可证明独立的同阶段边界
 * @returns {{level: string, parallelizable: boolean, reasons: string[], boundaryTaskIds: string[], signals: Object}} 独立性评估结果
 */
function summarizeTaskIndependence(task, hasParallelBoundary = false) {
  if (!task) {
    return { level: 'low', parallelizable: false, reasons: ['缺少下一任务上下文，无法证明独立性'], boundaryTaskIds: [] }
  }
  const files = task.files || {}
  const allFiles = [...(files.create || []), ...(files.modify || []), ...(files.test || [])]
  const depends = task.depends || []
  const blockedBy = task.blocked_by || []
  const intent = (task.steps || []).map((step) => `${step.id || ''} ${step.description || ''} ${step.expected || ''}`).join(' ')
  const reasons = []
  const boundaryTaskIds = hasParallelBoundary && task.id ? [task.id] : []
  const sharedStatePaths = allFiles.filter((file) => SHARED_PATHS.some((segment) => file.includes(`/${segment}/`)))
  const selfReferenceHits = allFiles.filter((file) => file && intent.includes(file))
  if (hasParallelBoundary) reasons.push('存在可证明独立的同阶段边界')
  if (depends.length) reasons.push('任务存在显式 depends 依赖')
  if (blockedBy.length) reasons.push('任务存在 blocked_by 阻塞依赖')
  if (sharedStatePaths.length) reasons.push('任务涉及共享状态目录')
  if (selfReferenceHits.length) reasons.push('任务步骤显式引用了目标文件')
  let level = 'low'
  let parallelizable = false
  if (hasParallelBoundary && !(depends.length || blockedBy.length || sharedStatePaths.length)) {
    level = 'high'
    parallelizable = true
  } else if (depends.length || blockedBy.length || sharedStatePaths.length) {
    level = 'low'
    parallelizable = false
  } else if (allFiles.length <= 1 && selfReferenceHits.length === 0) {
    level = 'medium'
    parallelizable = false
    reasons.push('任务文件边界较小且未发现共享状态冲突')
  } else {
    reasons.push('未发现可证明独立边界')
  }
  return {
    level,
    parallelizable,
    reasons,
    boundaryTaskIds,
    signals: {
      hasDepends: depends.length > 0,
      hasBlockedBy: blockedBy.length > 0,
      touchesSharedState: sharedStatePaths.length > 0,
      referencesOwnFilesInSteps: selfReferenceHits.length > 0,
      fileCount: allFiles.length,
    },
  }
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : ''
  }
  if (command === 'check-deps') {
    process.stdout.write(`${JSON.stringify(checkTaskDeps(split(option('--depends')), split(option('--completed'))))}\n`)
    return
  }
  if (command === 'check-blocked') {
    process.stdout.write(`${JSON.stringify(checkBlockedDeps(split(option('--blocked-by')), split(option('--unblocked'))))}\n`)
    return
  }
  if (command === 'classify') {
    process.stdout.write(`${JSON.stringify({ dependencies: classifyDeps(option('--name'), split(option('--files'))) })}\n`)
    return
  }
  process.stderr.write('Usage: node dependency_checker.js <check-deps|check-blocked|classify> ...\n')
  process.exitCode = 1
}

module.exports = {
  checkTaskDeps,
  checkBlockedDeps,
  reconcileBlockedTasks,
  classifyDeps,
  summarizeTaskIndependence,
}

if (require.main === module) main()
