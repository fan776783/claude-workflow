#!/usr/bin/env node
/** @file UserPromptSubmit Hook — 中频次重注入 workflow 状态。比 session-start 轻量：只输出 active-workflow + next-action + guardrail。走 lite runtime 避免 plan 文件全量 regex 解析 */

require('./_utf8')

const path = require('path')
const { normalizeWindowsShellPath } = require('../utils/workflow/path_utils')
const { getStatusMessages } = require('../utils/workflow/workflow_types')
const { getWorkflowRuntimeLite } = require('../utils/workflow/task_runtime')
const { shouldSkipInjection } = require('./_skip')

function main() {
  if (shouldSkipInjection()) return
  const projectRoot = path.resolve(normalizeWindowsShellPath(process.cwd()))
  const runtime = getWorkflowRuntimeLite(projectRoot)
  const state = runtime.state
  if (!state) return

  const { nextAction, guardrail } = getStatusMessages(state, { verbose: false })
  if (!nextAction && !guardrail) return

  const parts = []
  parts.push('<workflow-state>')
  parts.push(`状态: ${state.status || 'unknown'}`)
  const current = (state.current_tasks || [])[0]
  if (current) parts.push(`当前任务: ${current}`)
  if (nextAction) parts.push(`下一步: ${nextAction}`)
  if (guardrail) parts.push(`Guardrail: ${guardrail}`)
  parts.push('</workflow-state>')
  process.stdout.write(parts.join('\n'))
}

try {
  main()
} catch {
  process.exitCode = 0
}
