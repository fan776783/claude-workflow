#!/usr/bin/env node
/**
 * @file 计划增量变更管理 - 提供 delta 载荷创建、任务增量应用、审查状态和同步审计功能
 */

const {
  appendTaskBlocks,
  parseTasksV2,
  removeTasksFromMarkdown,
  replaceTaskBlock,
  taskToDict,
} = require('./task_parser')

/**
 * 返回当前时间的 ISO 格式字符串
 * @returns {string} ISO 8601 时间字符串
 */
function isoNow() {
  return new Date().toISOString()
}

/**
 * 创建增量变更的完整载荷对象
 * @param {string} changeId - 变更 ID
 * @param {Object} trigger - 触发信息（包含 type、source、description）
 * @param {string|null} parentChange - 父变更 ID
 * @returns {Object} delta 载荷对象
 */
function createDeltaPayload(changeId, trigger, parentChange = null) {
  return {
    id: changeId,
    parent_change: parentChange,
    status: 'draft',
    created_at: isoNow(),
    trigger,
    impact_analysis: {
      summary: 'pending',
      affected_tasks: [],
      affected_files: [],
    },
    spec_deltas: [],
    task_deltas: [],
  }
}

/**
 * 创建审查状态载荷对象
 * @param {string} changeId - 变更 ID
 * @param {string} status - 审查状态（默认 'draft'）
 * @returns {Object} 审查状态对象
 */
function createReviewStatusPayload(changeId, status = 'draft') {
  return {
    change_id: changeId,
    status,
    review_mode: 'human_gate',
    reviewed_at: null,
    reviewer: null,
    notes: [],
  }
}

/**
 * 将变更意图渲染为 Markdown 格式文本
 * @param {string} changeId - 变更 ID
 * @param {Object} trigger - 触发信息
 * @returns {string} Markdown 格式的意图描述
 */
function renderIntentMarkdown(changeId, trigger) {
  return [`# ${changeId}`, '', `- 类型: ${trigger.type}`, `- 来源: ${trigger.source || 'inline'}`, `- 摘要: ${trigger.description}`, '- 状态: draft', ''].join('\n')
}

/**
 * 一次性创建 delta、intent Markdown 和审查状态三个工件
 * @param {string} changeId - 变更 ID
 * @param {Object} trigger - 触发信息
 * @param {string|null} parentChange - 父变更 ID
 * @returns {{delta: Object, intent: string, review_status: Object}} 三个工件的组合
 */
function createDeltaArtifacts(changeId, trigger, parentChange = null) {
  return {
    delta: createDeltaPayload(changeId, trigger, parentChange),
    intent: renderIntentMarkdown(changeId, trigger),
    review_status: createReviewStatusPayload(changeId),
  }
}

/**
 * 统计任务增量操作的各类型计数
 * @param {Object[]} taskDeltas - 任务增量数组
 * @returns {{add: number, modify: number, remove: number}} 各操作类型的计数
 */
function summarizeTaskDeltas(taskDeltas = []) {
  const summary = { add: 0, modify: 0, remove: 0 }
  for (const delta of taskDeltas) {
    const action = String(delta.action || '').toLowerCase()
    if (action in summary) summary[action] += 1
  }
  return summary
}

/**
 * 获取现有任务列表中下一个可用的任务索引号
 * @param {Object[]} tasks - 现有任务数组
 * @returns {number} 下一个可用索引号
 */
function getNextTaskIndex(tasks) {
  let maxIndex = 0
  for (const task of tasks || []) {
    const match = String(task.id || '').match(/^(?:T|Task-)(\d+)$/)
    if (match) maxIndex = Math.max(maxIndex, Number(match[1]))
  }
  return maxIndex + 1
}

/**
 * 将任务增量操作（add/modify/remove）应用到 Markdown 内容上
 * @param {string} content - 原始 Markdown 内容
 * @param {Object[]} taskDeltas - 任务增量操作数组
 * @returns {string} 应用增量后的 Markdown 内容
 */
function applyTaskDeltas(content, taskDeltas) {
  let updated = String(content || '')
  const additions = []
  for (const delta of taskDeltas || []) {
    const action = String(delta.action || '').toLowerCase()
    if (action === 'add') {
      const block = String(delta.task_markdown || '')
      if (block.trim()) additions.push(`${block.replace(/\s+$/, '')}\n`)
    } else if (action === 'modify') {
      if (delta.task_id && String(delta.task_markdown || '').trim()) updated = replaceTaskBlock(updated, delta.task_id, delta.task_markdown)
    } else if (action === 'remove' && delta.task_id) {
      updated = removeTasksFromMarkdown(updated, [delta.task_id])
    }
  }
  if (additions.length) updated = appendTaskBlocks(updated, additions)
  return updated
}

/**
 * 根据变更信息和现有任务生成示例性的任务增量操作列表
 * @param {string} changeId - 变更 ID
 * @param {Object} trigger - 触发信息
 * @param {Object[]} existingTasks - 现有任务数组
 * @returns {Object[]} 示例任务增量操作数组
 */
function buildTaskDeltaExamples(changeId, trigger, existingTasks = []) {
  const description = trigger.description || changeId
  const nextIndex = getNextTaskIndex(existingTasks)
  const addTaskId = `T${nextIndex}`
  const existingTaskIds = existingTasks.map((task) => String(task.id || '')).filter(Boolean)
  const modifyTaskId = existingTaskIds[0] || null
  const removeTaskId = existingTaskIds[1] || null
  const deltas = [{
    action: 'add',
    task_markdown: `## ${addTaskId}: 响应增量变更 ${changeId}\n- **阶段**: implement\n- **Spec 参考**: §1\n- **Plan 参考**: P-delta-${changeId.toLowerCase()}\n- **需求 ID**: R-001\n- **状态**: pending\n- **actions**: edit_file\n- **步骤**:\n  - D1: 响应变更 ${description} → 完成增量处理\n- **验证命令**: \`node --test tests/test_workflow_helpers.js\`\n- **验证期望**: \`OK\`\n`,
  }]
  if (modifyTaskId) {
    deltas.push({
      action: 'modify',
      task_id: modifyTaskId,
      task_markdown: `## ${modifyTaskId}: 第一个任务（增量调整）\n- **阶段**: implement\n- **Spec 参考**: §1\n- **Plan 参考**: P1\n- **需求 ID**: R-001\n- **状态**: pending\n- **actions**: edit_file\n- **步骤**:\n  - A1: 修改实现并吸收增量变化 → 完成第一个任务\n- **验证命令**: \`node --test tests/test_workflow_helpers.js\`\n- **验证期望**: \`OK\`\n`,
    })
  }
  if (removeTaskId) deltas.push({ action: 'remove', task_id: removeTaskId })
  return deltas
}

/**
 * 构建同步审计载荷，记录变更应用后的 API 差异和解除阻塞的任务
 * @param {string} changeId - 变更 ID
 * @param {Object} apiDiff - API 差异对象（added/removed/modified）
 * @param {string[]} unblockedTasks - 因此变更解除阻塞的任务 ID 列表
 * @param {string} status - 同步状态（默认 'applied'）
 * @returns {Object} 审计载荷对象
 */
function buildSyncAuditPayload(changeId, apiDiff = { added: [], removed: [], modified: [] }, unblockedTasks = [], status = 'applied') {
  return {
    change_id: changeId,
    status,
    synced_at: isoNow(),
    impact: {
      added: apiDiff.added || [],
      removed: apiDiff.removed || [],
      modified: apiDiff.modified || [],
    },
    unblocked_tasks: unblockedTasks,
  }
}

/**
 * 将对象序列化为格式化的 JSON 字符串（末尾带换行）
 * @param {*} payload - 待序列化的数据
 * @returns {string} 格式化的 JSON 字符串
 */
function toPrettyJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`
}

module.exports = {
  isoNow,
  createDeltaPayload,
  createReviewStatusPayload,
  renderIntentMarkdown,
  createDeltaArtifacts,
  summarizeTaskDeltas,
  getNextTaskIndex,
  applyTaskDeltas,
  buildTaskDeltaExamples,
  buildSyncAuditPayload,
  toPrettyJson,
}
