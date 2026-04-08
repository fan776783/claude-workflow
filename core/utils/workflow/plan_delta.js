#!/usr/bin/env node

const {
  appendTaskBlocks,
  parseTasksV2,
  removeTasksFromMarkdown,
  replaceTaskBlock,
  taskToDict,
} = require('./task_parser')

function isoNow() {
  return new Date().toISOString()
}

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

function renderIntentMarkdown(changeId, trigger) {
  return [`# ${changeId}`, '', `- 类型: ${trigger.type}`, `- 来源: ${trigger.source || 'inline'}`, `- 摘要: ${trigger.description}`, '- 状态: draft', ''].join('\n')
}

function createDeltaArtifacts(changeId, trigger, parentChange = null) {
  return {
    delta: createDeltaPayload(changeId, trigger, parentChange),
    intent: renderIntentMarkdown(changeId, trigger),
    review_status: createReviewStatusPayload(changeId),
  }
}

function summarizeTaskDeltas(taskDeltas = []) {
  const summary = { add: 0, modify: 0, remove: 0 }
  for (const delta of taskDeltas) {
    const action = String(delta.action || '').toLowerCase()
    if (action in summary) summary[action] += 1
  }
  return summary
}

function getNextTaskIndex(tasks) {
  let maxIndex = 0
  for (const task of tasks || []) {
    const match = String(task.id || '').match(/^(?:T|Task-)(\d+)$/)
    if (match) maxIndex = Math.max(maxIndex, Number(match[1]))
  }
  return maxIndex + 1
}

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
