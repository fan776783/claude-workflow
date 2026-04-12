/**
 * @file 任务看板核心模块 - 提供看板条目的标准化、读写、构建和统计功能
 */
const fs = require('fs')
const path = require('path')

/**
 * 根据任务状态生成默认的生命周期对象
 * @param {string} status - 任务状态（pending/in_progress/completed/failed/blocked/skipped）
 * @returns {{run_state: string, attempt: number, last_transition_at: null}} 生命周期对象
 */
function defaultLifecycleForStatus(status = 'pending') {
  if (status === 'in_progress') return { run_state: 'in_progress', attempt: 0, last_transition_at: null }
  if (status === 'completed') return { run_state: 'verified', attempt: 0, last_transition_at: null }
  if (status === 'failed') return { run_state: 'failed', attempt: 1, last_transition_at: null }
  if (status === 'blocked') return { run_state: 'blocked', attempt: 0, last_transition_at: null }
  if (status === 'skipped') return { run_state: 'skipped', attempt: 0, last_transition_at: null }
  return { run_state: 'pending', attempt: 0, last_transition_at: null }
}

/**
 * 根据任务阶段生成默认的验证配置对象
 * @param {string} phase - 任务阶段（planning/review/implement）
 * @returns {Object} 包含 required、status、reviewer_role 等字段的验证配置
 */
function defaultVerificationForPhase(phase = 'implement') {
  if (phase === 'planning') {
    return { required: false, status: 'pending', reviewer_role: 'planner', profile: 'plan-planner', verified_at: null, failed_reason: null }
  }
  if (phase === 'review') {
    return { required: true, status: 'pending', reviewer_role: 'reviewer', profile: 'review-reviewer', verified_at: null, failed_reason: null }
  }
  return { required: true, status: 'pending', reviewer_role: 'reviewer', profile: 'review-reviewer', verified_at: null, failed_reason: null }
}

/**
 * 将原始任务对象标准化为完整的看板条目，补全缺失字段并设置默认值
 * @param {Object} task - 原始任务对象
 * @param {number} index - 任务在列表中的索引，用于生成默认 ID
 * @returns {Object} 标准化后的看板条目
 */
function normalizeBoardItem(task = {}, index = 0) {
  const phase = task.phase || 'implement'
  const status = task.status || 'pending'
  const lifecycle = task.lifecycle && typeof task.lifecycle === 'object'
    ? {
        run_state: task.lifecycle.run_state || defaultLifecycleForStatus(status).run_state,
        attempt: Number(task.lifecycle.attempt || 0),
        last_transition_at: task.lifecycle.last_transition_at || null,
      }
    : defaultLifecycleForStatus(status)
  const verification = task.verification && typeof task.verification === 'object'
    ? {
        ...defaultVerificationForPhase(phase),
        ...task.verification,
      }
    : defaultVerificationForPhase(phase)

  return {
    id: task.id || `B${index + 1}`,
    name: task.name || task.id || `Boundary ${index + 1}`,
    source_task_ids: Array.isArray(task.source_task_ids) ? task.source_task_ids : [task.source_task_id || task.id || `B${index + 1}`],
    phase,
    status,
    depends: Array.isArray(task.depends) ? task.depends : [],
    blocked_by: Array.isArray(task.blocked_by) ? task.blocked_by : [],
    files: task.files || {},
    acceptance_criteria: Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [],
    critical_constraints: Array.isArray(task.critical_constraints) ? task.critical_constraints : [],
    parallelism: {
      mode: 'team',
      dispatch_strategy: task.parallelism?.dispatch_strategy || 'internal-team-orchestrator',
      dispatch_skill_invoked: Boolean(task.parallelism?.dispatch_skill_invoked),
    },
    owner: task.owner || null,
    ownership: task.ownership || null,
    claim: task.claim || null,
    lifecycle,
    verification,
    evidence_refs: Array.isArray(task.evidence_refs) ? task.evidence_refs : [],
    result: task.result || null,
  }
}

/**
 * 将任务数组批量标准化为看板条目数组
 * @param {Object[]} tasks - 原始任务对象数组
 * @returns {Object[]} 标准化后的看板条目数组
 */
function buildTeamTaskBoard(tasks) {
  return tasks.map((task, index) => normalizeBoardItem(task, index))
}

/**
 * 从 JSON 文件读取并标准化任务看板
 * @param {string} filePath - 看板 JSON 文件路径
 * @returns {Object[]} 标准化后的看板条目数组
 */
function readTaskBoard(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).map((item, index) => normalizeBoardItem(item, index))
}

/**
 * 将看板数据标准化后写入 JSON 文件，自动创建目录
 * @param {string} filePath - 目标文件路径
 * @param {Object[]} board - 看板条目数组
 */
function writeTaskBoard(filePath, board) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const normalized = Array.isArray(board) ? board.map((item, index) => normalizeBoardItem(item, index)) : []
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`)
}

/**
 * 统计看板中各状态的任务数量
 * @param {Object[]} board - 看板条目数组
 * @returns {{total: number, pending: number, in_progress: number, completed: number, failed: number, blocked: number, skipped: number}} 各状态计数
 */
function summarizeTaskBoard(board) {
  const summary = { total: board.length, pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0, skipped: 0 }
  for (const item of board) {
    const status = item.status || 'pending'
    if (Object.hasOwn(summary, status)) summary[status] += 1
  }
  return summary
}

module.exports = {
  normalizeBoardItem,
  buildTeamTaskBoard,
  readTaskBoard,
  writeTaskBoard,
  summarizeTaskBoard,
}
