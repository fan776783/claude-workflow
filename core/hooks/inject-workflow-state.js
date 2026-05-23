#!/usr/bin/env node
/** @file UserPromptSubmit Hook — 中频次重注入 workflow 状态。比 session-start 轻量：只输出 active-workflow + next-action + guardrail，省略 project-info / specs / code-specs，控制每次 prompt 注入的字节开销 */

require('./_utf8')

const fs = require('fs')
const path = require('path')
const { getWorkflowStatePath, normalizeWindowsShellPath } = require('../utils/workflow/path_utils')
const { deriveEffectiveStatus, getSpecReviewGateViolation } = require('../utils/workflow/workflow_types')
const { getWorkflowRuntime } = require('../utils/workflow/task_runtime')
const { shouldSkipInjection } = require('./_skip')

function findProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function determineNextAction(state) {
  if (!state) return null
  const gateViolation = getSpecReviewGateViolation(state)
  if (gateViolation) return 'Spec Review 未 approved，回 Phase 1.1 完成显式批准。'
  const { status, halt_reason } = deriveEffectiveStatus(state)
  const current = (state.current_tasks || [])[0] || '?'
  if (status === 'planned') return '使用 `/workflow-execute` 开始执行；不要重新规划。'
  if (status === 'spec_review') return 'Spec 等待人工确认。'
  if (status === 'running') return `执行中: ${current}。/workflow-execute 继续。`
  if (status === 'halted' && halt_reason === 'failure') return `任务 ${current} 失败。/workflow-execute --retry 或 skip。`
  if (status === 'halted' && halt_reason === 'dependency') return '依赖阻塞。/workflow unblock <dep> 后恢复。'
  if (status === 'halted') return '已暂停，处理原因后 /workflow-execute 恢复。'
  if (status === 'review_pending') return '待 /workflow-review 通过后归档。'
  if (status === 'completed') return '已完成，/workflow-archive 归档。'
  if (status === 'archived') return null
  return null
}

function determineGuardrail(state) {
  if (!state) return null
  const gateViolation = getSpecReviewGateViolation(state)
  if (gateViolation) return 'Spec Review 越界，禁止推进，需回 spec_review。'
  const { status } = deriveEffectiveStatus(state)
  if (status === 'planned') return '只允许显式 `/workflow-execute` 进入执行器。'
  if (status === 'spec_review') return '人工审查关口，禁止直接实现。'
  if (status === 'running') return '恢复执行必须经 `/workflow-execute` shared resolver。'
  if (status === 'halted') return '阻塞/失败态需走 retry/skip/unblock 治理。'
  if (status === 'review_pending') return '待审查通过，不得跳过归档。'
  if (status === 'completed') return '已完成只允许归档或查看状态。'
  if (status === 'archived') return null
  return null
}

function main() {
  if (shouldSkipInjection()) return
  const projectRoot = path.resolve(normalizeWindowsShellPath(process.cwd()))
  const config = findProjectConfig(projectRoot)
  if (!config) return

  const project = config.project || {}
  const projectId = project.id || config.projectId || ''
  const runtime = getWorkflowRuntime(projectRoot)
  const state = projectId && runtime.projectId === projectId ? runtime.state : null
  if (!state) return

  const nextAction = determineNextAction(state)
  const guardrail = determineGuardrail(state)
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
