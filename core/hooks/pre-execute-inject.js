#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { detectProjectIdFromRoot, getWorkflowsDir } = require('../utils/workflow/path_utils')

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

function buildTaskContext(state) {
  const parts = []
  const projectRoot = process.cwd()
  const currentTasks = state.current_tasks || []
  const taskId = currentTasks[0]
  if (!taskId) return ''

  const projectId = state.projectId || state.project_id || ''
  const workflowDir = projectId ? getWorkflowsDir(projectId) : null
  const tasksFile = state.tasks_file || ''
  if (workflowDir && tasksFile) {
    const tasksContent = readFile(path.join(workflowDir, tasksFile))
    if (tasksContent) {
      const pattern = new RegExp(`##+\\s+${taskId.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}:[\\s\\S]*?(?=\\n##+\\s+T\\d+:|$)`, 'm')
      const match = tasksContent.match(pattern)
      if (match) parts.push(`<current-task>\n${match[0].slice(0, 3000)}\n</current-task>`)
    }
  }

  const specFile = state.spec_file || ''
  if (specFile) {
    const specContent = readFile(path.join(projectRoot, specFile))
    if (specContent) parts.push(`<spec-context>\n${specContent.slice(0, 2000)}\n</spec-context>`)
  }

  const baselinePath = (((state.requirement_baseline || {}).path) || ((state.requirement_baseline || {}).summary_path) || '')
  if (baselinePath) {
    const baselineContent = readFile(path.join(projectRoot, baselinePath))
    const constraints = extractSection(baselineContent, 'Critical Constraints') || extractSection(baselineContent, '关键约束')
    if (constraints) parts.push(`<critical-constraints>\n${constraints.slice(0, 1000)}\n</critical-constraints>`)
  }

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
  if (!state || !['running', 'paused'].includes(state.status)) {
    process.stdout.write(JSON.stringify(buildAllowResult()))
    return
  }

  const toolInput = typeof hookInput.tool_input === 'object' && hookInput.tool_input ? hookInput.tool_input : {}
  const taskDescription = toolInput.description || ''
  const context = buildTaskContext(state)

  if (!context) {
    process.stdout.write(JSON.stringify(buildAllowResult()))
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
