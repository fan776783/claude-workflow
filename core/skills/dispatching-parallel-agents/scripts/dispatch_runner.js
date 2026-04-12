#!/usr/bin/env node

/** 并行分派执行器 —— 负责任务上下文构建、worktree 需求判断和批量分派 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { registerAgent } = require('./agent_registry')
const { createWorktree, getRepoRoot } = require('./worktree_manager')

const READ_ONLY_TERMS = new Set([
  'analyze', 'analysis', 'inspect', 'investigate', 'investigation',
  'review', 'trace', 'diagnose', 'diagnostic', 'plan', 'document',
  'audit', 'explore', 'research', 'read', 'verify', 'summarize',
])
const WRITE_TERMS = new Set([
  'implement', 'fix', 'edit', 'update', 'refactor', 'create',
  'delete', 'rename', 'migrate', 'write', 'modify', 'patch',
  'add', 'remove', 'replace', 'change',
])

/**
 * 为单个任务构建最小化的执行上下文文本，包含步骤、文件、约束、验收项等
 * @param {object} task - 任务对象
 * @param {string} projectRoot - 项目根目录
 * @param {string} specContent - 相关规范内容（可选）
 * @returns {string} 格式化的上下文文本
 */
function buildMinimalContext(task, projectRoot, specContent = '') {
  const parts = []
  parts.push(`# 任务: ${task.id || '?'} - ${task.name || ''}`)
  parts.push('')

  const steps = task.steps || []
  if (steps.length > 0) {
    parts.push('## 执行步骤')
    for (const step of steps) {
      parts.push(`- ${step.id || ''}: ${step.description || ''} → ${step.expected || ''}`)
    }
    parts.push('')
  }

  const files = task.files || {}
  if (Object.keys(files).length > 0) {
    parts.push('## 目标文件')
    for (const fileType of ['create', 'modify', 'test']) {
      const fileList = files[fileType] || []
      if (fileList.length > 0) parts.push(`- ${fileType}: ${fileList.join(', ')}`)
    }
    parts.push('')
  }

  const constraints = task.critical_constraints || []
  if (constraints.length > 0) {
    parts.push('## 关键约束（不可违反）')
    for (const item of constraints) parts.push(`- ${item}`)
    parts.push('')
  }

  const criteria = task.acceptance_criteria || []
  if (criteria.length > 0) {
    parts.push('## 验收项')
    for (const item of criteria) parts.push(`- ${item}`)
    parts.push('')
  }

  if (specContent) {
    parts.push('## 相关规范')
    parts.push(String(specContent).slice(0, 2000))
    parts.push('')
  }

  const verification = task.verification || {}
  const commands = verification.commands || []
  if (commands.length > 0) {
    parts.push('## 验证命令')
    for (const command of commands) parts.push(`\`\`\`bash\n${command}\n\`\`\``)
    parts.push('')
  }

  parts.push('## 输出要求')
  parts.push('完成后请提供:')
  parts.push('1. 每个步骤的执行结果')
  parts.push('2. 验证命令的输出和 exit code')
  parts.push('3. 如果失败，说明失败原因和已尝试的修复')
  parts.push('')

  return parts.join('\n')
}

/**
 * 将任务的名称、步骤、验收项、验证命令等拼接为小写文本，用于意图分析
 * @param {object} task - 任务对象
 * @returns {string} 拼接后的小写文本
 */
function collectTaskText(task) {
  const parts = [String(task.name || '')]
  for (const step of task.steps || []) {
    parts.push(String(step.description || ''))
    parts.push(String(step.expected || ''))
  }
  for (const criterion of task.acceptance_criteria || []) parts.push(String(criterion))
  for (const command of task.verification?.commands || []) parts.push(String(command))
  return parts.join(' ').toLowerCase()
}

/**
 * 判断任务的 files 字段是否为空（无 create/modify/test 文件）
 * @param {object} task - 任务对象
 * @returns {boolean} 文件列表为空时返回 true
 */
function taskFilesEmpty(task) {
  const files = task.files || {}
  return ['create', 'modify', 'test'].every((key) => !files[key] || files[key].length === 0)
}

/**
 * 根据任务的文件目标和文本意图判断是否需要 worktree 隔离
 * @param {object} task - 任务对象
 * @returns {boolean} 需要 worktree 时返回 true
 */
function requiresWorktree(task) {
  if (!taskFilesEmpty(task)) return true
  const text = collectTaskText(task)
  if (!text) return true

  const hasReadOnlySignal = [...READ_ONLY_TERMS].some((term) => text.includes(term))
  const hasWriteSignal = [...WRITE_TERMS].some((term) => text.includes(term))

  if (hasWriteSignal) return true
  if (hasReadOnlySignal) return false
  return true
}

/**
 * 生成 worktree 配置决策的说明文本
 * @param {object} task - 任务对象
 * @param {boolean} needsWorktree - 是否需要 worktree
 * @returns {string} 配置决策说明
 */
function provisioningNote(task, needsWorktree) {
  if (!needsWorktree) return 'read-only task detected; skipping worktree provisioning'
  if (taskFilesEmpty(task)) return 'task intent ambiguous; defaulting to worktree isolation'
  return 'task declares file targets; provisioning worktree'
}

/**
 * 批量分派一组任务：串行创建 worktree、注册 agent、构建上下文，返回分派清单
 * @param {object[]} tasks - 任务列表
 * @param {string|null} groupId - 分组 ID，不传则自动生成
 * @param {string} platform - 运行平台
 * @param {boolean} useWorktree - 是否启用 worktree 隔离
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 分派结果，含 manifests 列表或 error
 */
function dispatchGroup(tasks, groupId = null, platform = 'claude-code', useWorktree = false, projectRoot = null) {
  const root = projectRoot || process.cwd()
  const gid = groupId || `group-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  const manifests = []

  for (const task of tasks) {
    const taskId = task.id || 'unknown'
    const branch = `workflow/${String(taskId).toLowerCase()}`
    const needsWorktree = useWorktree && requiresWorktree(task)
    const note = provisioningNote(task, needsWorktree)

    let worktreePath = null
    if (needsWorktree) {
      const worktreeResult = createWorktree(branch, taskId, 'HEAD', root)
      if (worktreeResult.created || worktreeResult.exists) {
        worktreePath = worktreeResult.path
      } else if (worktreeResult.error) {
        return {
          error: worktreeResult.error,
          failed_task_id: taskId,
          group_id: gid,
          manifests,
          platform,
          use_worktree: useWorktree,
          created_at: new Date().toISOString(),
        }
      }
    }

    const agent = registerAgent(
      taskId,
      worktreePath,
      task.boundary || 'auto',
      platform,
      gid,
      null,
      root,
    )

    const context = buildMinimalContext(task, root)
    manifests.push({
      agent_id: agent.agent_id,
      task_id: taskId,
      task_name: task.name || '',
      group_id: gid,
      platform,
      requires_worktree: needsWorktree,
      provisioning_note: note,
      worktree_path: worktreePath,
      context,
      context_length: context.length,
    })
  }

  return {
    group_id: gid,
    dispatched: manifests.length,
    manifests,
    platform,
    use_worktree: useWorktree,
    created_at: new Date().toISOString(),
  }
}

function parseOption(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function main() {
  const args = process.argv.slice(2)
  const command = args.shift()

  if (command === 'dispatch') {
    if (!hasFlag(args, '--tasks-json')) {
      process.stderr.write('Missing required arguments\n')
      process.exitCode = 1
      return
    }

    const allTasks = JSON.parse(fs.readFileSync(parseOption(args, '--tasks-json'), 'utf8'))
    const taskIds = parseOption(args, '--task-ids')
    const selected = taskIds
      ? allTasks.filter((task) => new Set(taskIds.split(',').map((item) => item.trim()).filter(Boolean)).has(task.id))
      : allTasks

    printJson(dispatchGroup(
      selected,
      parseOption(args, '--group-id'),
      parseOption(args, '--platform') || 'claude-code',
      hasFlag(args, '--use-worktree'),
    ))
    return
  }

  if (command === 'build-context') {
    if (!hasFlag(args, '--tasks-json') || !hasFlag(args, '--task-id')) {
      process.stderr.write('Missing required arguments\n')
      process.exitCode = 1
      return
    }

    const allTasks = JSON.parse(fs.readFileSync(parseOption(args, '--tasks-json'), 'utf8'))
    const task = allTasks.find((item) => item.id === parseOption(args, '--task-id'))
    if (!task) {
      printJson({ error: `Task ${parseOption(args, '--task-id')} not found` })
      process.exitCode = 1
      return
    }

    process.stdout.write(`${buildMinimalContext(task, process.cwd())}\n`)
    return
  }

  process.stderr.write('Usage: node dispatch_runner.js <dispatch|build-context> ...\n')
  process.exitCode = 1
}

const build_minimal_context = buildMinimalContext
const requires_worktree = requiresWorktree
const provisioning_note = provisioningNote
const dispatch_group = dispatchGroup

module.exports = {
  READ_ONLY_TERMS,
  WRITE_TERMS,
  buildMinimalContext,
  requiresWorktree,
  provisioningNote,
  dispatchGroup,
  build_minimal_context,
  requires_worktree,
  provisioning_note,
  dispatch_group,
  createWorktree,
  getRepoRoot,
}

if (require.main === module) main()
