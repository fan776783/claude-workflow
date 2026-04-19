#!/usr/bin/env node

const fs = require('fs')
const {
  STRIP_STATUS_EMOJI_REGEX,
  escapeRegExp,
  extractStatusFromTitle,
  getStatusEmoji,
  validateTaskId,
} = require('./status_utils')

function createTaskFiles(data = {}) {
  return {
    create: [...(data.create || [])],
    modify: [...(data.modify || [])],
    test: [...(data.test || [])],
  }
}

function createTaskVerification(data = {}) {
  return {
    commands: [...(data.commands || [])],
    expected_output: [...(data.expected_output || [])],
    notes: [...(data.notes || [])],
  }
}

// Target Layer 白名单：frontend / backend / guides 三选一，对齐 code-specs 目录布局。
const TARGET_LAYER_WHITELIST = new Set(['frontend', 'backend', 'guides'])
function normalizeTargetLayer(value) {
  if (!value) return ''
  const normalized = String(value).trim().toLowerCase()
  return TARGET_LAYER_WHITELIST.has(normalized) ? normalized : ''
}

function createWorkflowTaskV2(data = {}) {
  return {
    id: data.id || '',
    name: data.name || '',
    phase: data.phase || 'implement',
    package: data.package ? String(data.package).trim() : '',
    target_layer: normalizeTargetLayer(data.target_layer),
    files: createTaskFiles(data.files),
    leverage: [...(data.leverage || [])],
    spec_ref: data.spec_ref || '§Unknown',
    plan_ref: data.plan_ref || 'P-UNKNOWN',
    requirement_ids: [...(data.requirement_ids || [])],
    critical_constraints: [...(data.critical_constraints || [])],
    acceptance_criteria: [...(data.acceptance_criteria || [])],
    depends: [...(data.depends || [])],
    blocked_by: [...(data.blocked_by || [])],
    quality_gate: Boolean(data.quality_gate),
    status: data.status || 'pending',
    actions: [...(data.actions || [])],
    steps: [...(data.steps || [])],
    verification: data.verification ? createTaskVerification(data.verification) : null,
    all_files() {
      return [...this.files.create, ...this.files.modify, ...this.files.test].filter(Boolean)
    },
    intent_text() {
      return (this.steps || []).map((step) => `${step.id} ${step.description} ${step.expected}`).join(' ')
    },
  }
}

function extractField(body, fieldName) {
  const pattern = new RegExp(`^\\s*-?\\s*\\*\\*${escapeRegExp(fieldName)}\\*\\*\\s*:\\s*(.+?)$`, 'gim')
  const match = pattern.exec(String(body || ''))
  if (!match) return null
  return match[1].replace(/`/g, '').trim()
}

// Package 字段白名单：仅允许 [A-Za-z0-9_.-]，拒绝路径分隔符与路径跳转。
// 与 task_runtime.isValidPackageName 保持一致（该校验挪不到 task_runtime 是因为这里是消费侧防线）。
const PACKAGE_FIELD_PATTERN = /^[A-Za-z0-9_.-]+$/
function extractPackageField(body) {
  const raw = String(body || '')
  // 检测重复 Package 行：≥2 次视为 plan 手工编辑出错，静默置空不要信任首值。
  const pattern = /^\s*-?\s*\*\*Package\*\*\s*:\s*(.+?)$/gim
  const matches = [...raw.matchAll(pattern)]
  if (matches.length > 1) return ''
  if (matches.length === 0) return ''
  const value = matches[0][1].replace(/`/g, '').trim()
  if (!value || value === '.' || value === '..') return ''
  if (!PACKAGE_FIELD_PATTERN.test(value)) return ''
  return value
}

function extractListField(body, fieldName) {
  const value = extractField(body, fieldName)
  if (!value) return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseQualityGate(body) {
  const value = extractField(body, '质量关卡')
  if (!value) return false
  return ['true', '是'].includes(value.toLowerCase())
}

function extractAllTaskIds(content) {
  return String(content || '').match(/##+\s+(T\d+):/g)?.map((item) => item.match(/T\d+/)[0]) || []
}

function extractTaskBlock(content, taskId) {
  if (!validateTaskId(taskId)) return ''
  const pattern = new RegExp(`##+\\s+${escapeRegExp(taskId)}:[\\s\\S]*?(?=\\n##+\\s+T\\d+:|$)`)
  const match = String(content || '').match(pattern)
  return match ? match[0] : ''
}

function extractSteps(content, taskId) {
  const taskBlock = extractTaskBlock(content, taskId)
  const stepsSectionMatch = taskBlock.match(/-\s+\*\*步骤\*\*:[\s\S]*$/)
  if (!stepsSectionMatch) return []
  const stepsSection = stepsSectionMatch[0]
  const pattern = /-\s+([A-Z]\d+):\s+(.+?)\s+→\s+(.+?)(?:（验证：(.*?)）)?$/gm
  const result = []
  for (const match of stepsSection.matchAll(pattern)) {
    result.push({
      id: match[1],
      description: match[2],
      expected: match[3],
      verification: match[4] || null,
    })
  }
  return result
}

function parseTaskFiles(body) {
  return createTaskFiles({
    create: extractListField(body, '创建文件'),
    modify: extractListField(body, '修改文件'),
    test: extractListField(body, '测试文件'),
  })
}

function parseTaskVerification(body) {
  const commands = extractListField(body, '验证命令')
  const expectedOutput = extractListField(body, '验证期望')
  const notes = extractListField(body, '验证备注')
  if (!(commands.length || expectedOutput.length || notes.length)) return null
  return createTaskVerification({ commands, expected_output: expectedOutput, notes })
}

function parseTasksV2(content) {
  const tasks = []
  for (const taskId of extractAllTaskIds(content)) {
    const body = extractTaskBlock(content, taskId)
    if (!body) continue
    const titleMatch = body.match(/##+\s+T\d+:\s*(.+?)\s*\n/m)
    const rawTitle = titleMatch ? titleMatch[1] : taskId
    const titleStatus = extractStatusFromTitle(rawTitle)
    const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim()
    tasks.push(createWorkflowTaskV2({
      id: taskId,
      name,
      phase: extractField(body, '阶段') || 'implement',
      package: extractPackageField(body) || '',
      target_layer: normalizeTargetLayer(extractField(body, 'Target Layer')),
      files: parseTaskFiles(body),
      leverage: extractListField(body, '复用'),
      spec_ref: extractField(body, 'Spec 参考') || '§Unknown',
      plan_ref: extractField(body, 'Plan 参考') || 'P-UNKNOWN',
      requirement_ids: extractListField(body, '需求 ID'),
      critical_constraints: extractListField(body, '关键约束'),
      acceptance_criteria: extractListField(body, '验收项'),
      depends: extractListField(body, '依赖'),
      blocked_by: extractListField(body, '阻塞依赖'),
      quality_gate: parseQualityGate(body),
      status: titleStatus || extractField(body, '状态') || 'pending',
      actions: extractListField(body, 'actions'),
      steps: extractSteps(content, taskId),
      verification: parseTaskVerification(body),
    }))
  }
  return tasks
}

function summarizeTaskProgress(tasks) {
  const progress = {
    completed: [],
    skipped: [],
    failed: [],
    blocked: [],
  }
  let currentTaskId = null
  let currentTaskStatus = null

  for (const task of tasks || []) {
    const status = String(task?.status || 'pending')
    if (status.includes('completed')) {
      progress.completed.push(task.id)
      continue
    }
    if (status.includes('skipped')) {
      progress.skipped.push(task.id)
      continue
    }
    if (status.includes('failed')) progress.failed.push(task.id)
    if (status.includes('blocked')) progress.blocked.push(task.id)

    if (!currentTaskId) {
      currentTaskId = task.id
      currentTaskStatus = status
    }
  }

  const doneCount = progress.completed.length + progress.skipped.length
  const total = (tasks || []).length
  const workflowStatus = total > 0 && doneCount >= total
    ? 'completed'
    : currentTaskStatus && currentTaskStatus.includes('failed')
      ? 'failed'
      : currentTaskStatus && currentTaskStatus.includes('blocked')
        ? 'blocked'
      : 'running'

  return {
    progress,
    current_task_id: currentTaskId,
    current_task_status: currentTaskStatus,
    workflow_status: workflowStatus,
  }
}

function findTaskById(content, taskId) {
  return parseTasksV2(content).find((task) => task.id === taskId) || null
}

function findNextTask(content, completed, skipped, failed, blocked = []) {
  const excluded = new Set([...(completed || []), ...(skipped || []), ...(failed || [])])
  for (const taskId of extractAllTaskIds(content)) {
    if (!excluded.has(taskId) && !(blocked || []).includes(taskId)) return taskId
  }
  return null
}

function countTasks(content) {
  return extractAllTaskIds(content).length
}

function extractConstraints(content) {
  const match = String(content || '').match(/##\s*约束[^\n]*\n([\s\S]*?)(?=\n##|$)/i)
  if (!match) return []
  return match[1].split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim())
}

function updateTaskStatusInMarkdown(content, taskId, newStatus) {
  if (!validateTaskId(taskId)) return content
  const emoji = getStatusEmoji(newStatus)
  const pattern = new RegExp(`(##+\\s+${escapeRegExp(taskId)}:\\s*)(.+?)(\\s*\\n)`, 'm')
  return String(content || '').replace(pattern, (_, prefix, title, suffix) => `${prefix}${title.replace(STRIP_STATUS_EMOJI_REGEX, '').trim()} ${emoji}${suffix}`)
}

function replaceTaskBlock(content, taskId, newBlock) {
  const block = extractTaskBlock(content, taskId)
  if (!block) return content
  return String(content || '').replace(block, `${String(newBlock || '').replace(/\s+$/, '')}\n`)
}

function appendTaskBlocks(content, blocks) {
  const appended = (blocks || []).filter((block) => String(block || '').trim()).map((block) => String(block).replace(/\s+$/, '')).join('\n')
  if (!appended) return content
  const suffix = String(content || '').endsWith('\n') ? '\n' : '\n\n'
  return `${content || ''}${suffix}${appended}\n`
}

function removeTasksFromMarkdown(content, taskIds) {
  let updated = String(content || '')
  for (const taskId of taskIds || []) {
    const block = extractTaskBlock(updated, taskId)
    if (block) updated = updated.replace(block, '')
  }
  return `${updated.replace(/\n{3,}/g, '\n\n').trim()}\n`
}

function taskToDict(task) {
  const result = {
    ...task,
    files: createTaskFiles(task.files),
    leverage: [...(task.leverage || [])],
    requirement_ids: [...(task.requirement_ids || [])],
    critical_constraints: [...(task.critical_constraints || [])],
    acceptance_criteria: [...(task.acceptance_criteria || [])],
    depends: [...(task.depends || [])],
    blocked_by: [...(task.blocked_by || [])],
    actions: [...(task.actions || [])],
    steps: [...(task.steps || [])],
  }
  delete result.all_files
  delete result.intent_text
  if (!result.verification) delete result.verification
  return result
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  if (command === 'parse') {
    const taskIdIndex = args.indexOf('--task-id')
    const taskId = taskIdIndex >= 0 ? args[taskIdIndex + 1] : null
    const file = args.find((arg, index) => arg && !arg.startsWith('--') && index !== taskIdIndex + 1)
    if (!file) throw new Error('parse 需要提供 plan 文件路径')
    const content = fs.readFileSync(file, 'utf8')
    if (taskId) {
      process.stdout.write(`${JSON.stringify(findTaskById(content, taskId), null, 2)}\n`)
      return
    }
    process.stdout.write(`${JSON.stringify(parseTasksV2(content).map(taskToDict), null, 2)}\n`)
    return
  }
  if (command === 'find-next') {
    const fileIndex = Math.max(args.indexOf('--file'), args.indexOf('--tasks-file'))
    if (fileIndex < 0) throw new Error('find-next 需要提供 --file')
    const file = args[fileIndex + 1]
    const content = fs.readFileSync(file, 'utf8')
    const option = (flag) => {
      const index = args.indexOf(flag)
      return index >= 0 ? args[index + 1] : ''
    }
    process.stdout.write(`${JSON.stringify({ next_task: findNextTask(content, split(option('--completed')), split(option('--skipped')), split(option('--failed')), split(option('--blocked'))) })}\n`)
    return
  }
  if (command === 'count') {
    process.stdout.write(`${JSON.stringify({ count: countTasks(fs.readFileSync(args[0], 'utf8')) })}\n`)
    return
  }
  if (command === 'constraints') {
    process.stdout.write(`${JSON.stringify({ constraints: extractConstraints(fs.readFileSync(args[0], 'utf8')) }, null, 2)}\n`)
    return
  }
  if (command === 'update-status') {
    const [file, taskId, status] = args
    const dryRun = args.includes('--dry-run')
    const updated = updateTaskStatusInMarkdown(fs.readFileSync(file, 'utf8'), taskId, status)
    if (dryRun) process.stdout.write(updated)
    else {
      fs.writeFileSync(file, updated)
      process.stdout.write(`${JSON.stringify({ updated: true, task_id: taskId, status })}\n`)
    }
    return
  }
  process.stderr.write('Usage: node task_parser.js <parse|find-next|count|constraints|update-status> ...\n')
  process.exitCode = 1
}

module.exports = {
  TARGET_LAYER_WHITELIST,
  normalizeTargetLayer,
  createTaskFiles,
  createTaskVerification,
  createWorkflowTaskV2,
  extractField,
  extractListField,
  parseQualityGate,
  extractAllTaskIds,
  extractTaskBlock,
  extractSteps,
  parseTaskFiles,
  parseTaskVerification,
  parseTasksV2,
  summarizeTaskProgress,
  findTaskById,
  findNextTask,
  countTasks,
  extractConstraints,
  updateTaskStatusInMarkdown,
  replaceTaskBlock,
  appendTaskBlocks,
  removeTasksFromMarkdown,
  taskToDict,
}

if (require.main === module) main()
