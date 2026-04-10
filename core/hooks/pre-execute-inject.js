#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { detectProjectIdFromRoot, getWorkflowsDir } = require('../utils/workflow/path_utils')
const { getReviewResult, getSpecReviewGateViolation } = require('../utils/workflow/workflow_types')

function readFile(targetPath, fallback = '') {
  try {
    return fs.readFileSync(targetPath, 'utf8')
  } catch {
    return fallback
  }
}

function extractSection(content, heading, maxChars = 2000) {
  const pattern = new RegExp(`^(#{1,4})\\s+${heading.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n\\1\\s|$)`, 'm')
  const match = String(content || '').match(pattern)
  if (!match) return ''
  const section = match[2].trim()
  return section.length > maxChars ? section.slice(0, maxChars) : section
}

function findWorkflowState() {
  const projectId = detectProjectIdFromRoot(process.cwd())
  if (!projectId) return null
  const workflowDir = getWorkflowsDir(projectId)
  if (!workflowDir) return null
  const statePath = path.join(workflowDir, 'workflow-state.json')
  if (!fs.existsSync(statePath)) return null
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

function getCurrentTaskBlock(state, workflowDir, taskId) {
  const tasksFile = state.tasks_file || ''
  if (!workflowDir || !tasksFile || !taskId) return ''
  const tasksContent = readFile(path.join(workflowDir, tasksFile))
  if (!tasksContent) return ''

  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingPattern = new RegExp(`^##+\\s+${escapedTaskId}:`, 'm')
  const headingMatch = headingPattern.exec(tasksContent)
  if (!headingMatch) return ''

  const start = headingMatch.index
  const rest = tasksContent.slice(start)
  const nextHeadingMatch = /\n##+\s+T\d+:/m.exec(rest.slice(1))
  const end = nextHeadingMatch ? start + 1 + nextHeadingMatch.index : tasksContent.length
  return tasksContent.slice(start, end).trim()
}

function extractVerificationCommands(taskBlock) {
  if (!taskBlock) return []
  const cmdMatch = taskBlock.match(/\*\*验证命令\*\*\s*:\s*(.+?)$/m)
  if (!cmdMatch) return []
  return cmdMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
}

function buildTaskContext(state) {
  const parts = []
  const projectRoot = process.cwd()
  const currentTasks = state.current_tasks || []
  const taskId = currentTasks[0]
  if (!taskId) return ''

  const projectId = state.projectId || state.project_id || ''
  const workflowDir = projectId ? getWorkflowsDir(projectId) : null
  const taskBlock = getCurrentTaskBlock(state, workflowDir, taskId)
  if (taskBlock) {
    parts.push(`<current-task>\n${taskBlock.slice(0, 3000)}\n</current-task>`)
    const verificationCommands = extractVerificationCommands(taskBlock)
    if (verificationCommands.length) {
      parts.push(`<verification-commands>\n${verificationCommands.map((item) => `- ${item}`).join('\n')}\n</verification-commands>`)
    }
  }

  const specFile = state.spec_file || ''
  if (specFile) {
    const specContent = readFile(path.join(projectRoot, specFile))
    if (specContent) parts.push(`<spec-context>\n${specContent.slice(0, 2000)}\n</spec-context>`)
  }



  const qualityGate = getReviewResult(state, taskId)
  if (qualityGate) {
    parts.push(`<quality-gate-state>\nlast_decision: ${qualityGate.last_decision || 'unknown'}\noverall_passed: ${qualityGate.overall_passed === true}\n</quality-gate-state>`)
  }

  parts.push('<team-guardrail>\nordinary workflow task injection must ignore team runtime context; do not read or inherit team_id, team_name, worker_roster, dispatch_batches, team_review, or ~/.claude/workflows/{projectId}/teams/* unless the user explicitly entered /team.\n</team-guardrail>')

  const guidesDir = path.join(projectRoot, '.claude', 'specs', 'guides')
  if (fs.existsSync(guidesDir) && fs.statSync(guidesDir).isDirectory()) {
    parts.push('<reminder>修改代码前请参考 .agent-workflow/specs/guides/ 中的思维指南。</reminder>')
  }

  return parts.join('\n\n')
}

function buildAllowResult(message = null, patchedToolInput = null) {
  const result = { continue: true }
  if (message) result.message = message
  if (patchedToolInput) {
    result.tool_input = patchedToolInput
    result.patched_tool_input = patchedToolInput
    result.hookSpecificOutput = { tool_input: patchedToolInput }
  }
  return result
}

function buildBlockResult(reason) {
  return { continue: false, reason }
}

function main() {
  let hookInput = {}
  try {
    const raw = fs.readFileSync(0, 'utf8')
    hookInput = raw.trim() ? JSON.parse(raw) : {}
  } catch {}

  if (hookInput.tool_name !== 'Task') {
    process.stdout.write(JSON.stringify(buildAllowResult()))
    return
  }

  const state = findWorkflowState()
  if (!state) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] 未发现活动 workflow，禁止直接派发执行型 Task。请先使用 `/workflow plan` 或 `/workflow execute`。')))
    return
  }

  const gateViolation = getSpecReviewGateViolation(state)
  if (gateViolation) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] Phase 1.1 User Spec Review 尚未 approved，禁止派发执行型 Task。请先回到 spec_review 完成人工确认。')))
    return
  }

  if (!['running', 'paused'].includes(state.status)) {
    process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] 当前 workflow 状态为 ${state.status}，不允许直接派发执行型 Task。请先走对应的 workflow 命令路径。`)))
    return
  }

  const currentTaskId = (state.current_tasks || [])[0]
  if (!currentTaskId) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] 当前没有 active task，禁止派发执行型 Task。请先通过 `/workflow execute` 解析下一步任务。')))
    return
  }

  if (!state.spec_file || !state.plan_file) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] 缺少 spec_file 或 plan_file，执行上下文不完整。请先修复 workflow 状态后再继续。')))
    return
  }

  const toolInput = typeof hookInput.tool_input === 'object' && hookInput.tool_input ? hookInput.tool_input : {}
  const forbiddenTeamFields = ['team', 'team_name', 'team_id', 'teamId']
  const inheritedTeamFields = forbiddenTeamFields.filter((field) => Object.prototype.hasOwnProperty.call(toolInput, field))
  if (inheritedTeamFields.length) {
    process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] 当前不是显式 /team 路径，禁止透传 team 上下文字段: ${inheritedTeamFields.join(', ')}`)))
    return
  }
  const taskDescription = toolInput.description || ''
  const context = buildTaskContext(state)

  if (!context) {
    process.stdout.write(JSON.stringify(buildAllowResult('[workflow-hook] 未注入额外上下文：当前任务缺少可提取上下文。')))
    return
  }

  const patchedToolInput = { ...toolInput, description: `${context}\n\n---\n\n${taskDescription}` }
  const result = buildAllowResult(`[workflow-hook] 已注入任务上下文 (${context.length} 字符)`, patchedToolInput)
  process.stdout.write(JSON.stringify(result))
}

try {
  main()
} catch (error) {
  process.stdout.write(JSON.stringify(buildAllowResult()))
  process.exitCode = 0
}
