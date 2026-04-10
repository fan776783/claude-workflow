#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { getWorkflowStatePath } = require('../utils/workflow/path_utils')
const { getSpecReviewGateViolation } = require('../utils/workflow/workflow_types')

function shouldSkip() {
  return process.env.CLAUDE_NON_INTERACTIVE === '1'
}

function readFile(targetPath, fallback = '') {
  try {
    return fs.readFileSync(targetPath, 'utf8')
  } catch {
    return fallback
  }
}

function findProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function findWorkflowState(projectId) {
  const statePath = getWorkflowStatePath(projectId)
  if (!statePath || !fs.existsSync(statePath)) return null
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

function collectSpecIndices(projectRoot) {
  const specsDir = path.join(projectRoot, '.claude', 'specs')
  if (!fs.existsSync(specsDir) || !fs.statSync(specsDir).isDirectory()) return ''

  const indices = []
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.isFile() && entry.name === 'index.md') {
        const rel = path.relative(projectRoot, fullPath)
        const content = readFile(fullPath)
        if (content.trim()) indices.push(`### ${rel}\n${content.slice(0, 500)}`)
      }
    }
  }
  walk(specsDir)
  return indices.join('\n\n')
}

function determineNextAction(state) {
  if (!state) return '没有活跃的工作流。使用 `/workflow start` 开始新任务。'
  const gateViolation = getSpecReviewGateViolation(state)
  if (gateViolation) return '检测到 User Spec Review 缺失。请先回到 Phase 1.1 完成显式批准，再继续进入 plan 或 execute。'
  const status = state.status || 'idle'
  const currentTasks = state.current_tasks || []
  const progress = state.progress || {}
  const completed = progress.completed || []

  if (status === 'idle') return '使用 `/workflow start` 开始新的工作流。'
  if (status === 'planned') return '规划已完成。使用 `/workflow execute` 开始执行；不要重新进入规划。'
  if (status === 'spec_review') return 'Spec 等待确认。请先审查 Spec 文档并完成人工确认，不能直接执行。'
  if (status === 'running') return `工作流执行中，当前任务: ${currentTasks[0] || '?'}。使用 /workflow execute 继续。`
  if (status === 'paused') return '工作流已暂停。请处理暂停原因后使用 `/workflow execute` 恢复执行。'
  if (status === 'failed') return `任务 ${currentTasks[0] || '?'} 失败: ${state.failure_reason || '未知'}。使用 /workflow execute --retry 重试，或显式选择 skip。`
  if (status === 'blocked') return '工作流被阻塞。使用 `/workflow unblock <dep>` 解除依赖后再恢复执行。'
  if (status === 'completed') return `工作流已完成 (${completed.length} 任务)。使用 /workflow archive 归档，不要继续执行。`
  if (status === 'archived') return '工作流已归档。使用 `/workflow start` 开始新任务。'
  return `当前状态: ${status}。使用 /workflow status 查看详情。`
}

function determineGuardrail(state) {
  if (!state) return '无活动 workflow：仅允许新建流程，不应猜测恢复执行；普通会话不得继承或恢复任何 team context。'
  const gateViolation = getSpecReviewGateViolation(state)
  if (gateViolation) return 'Guardrail：检测到状态机越界，Phase 1.1 User Spec Review 未 approved 却已进入后续状态；禁止继续推进，需先修复回 spec_review。'
  const status = state.status || 'idle'
  if (status === 'planned') return 'Guardrail：此状态只允许显式 `/workflow execute` 进入执行器；禁止自动继续或重新规划，也不得混入 team context。'
  if (status === 'spec_review') return 'Guardrail：当前处于人工 Spec 审查关口；禁止直接进入实现，也不得切换到 team 语义。'
  if (status === 'running' || status === 'paused') return 'Guardrail：恢复执行必须经过 `/workflow execute` 的 shared resolver，不得绕过治理与质量关卡；普通 workflow 会话忽略 team runtime。'
  if (status === 'failed') return 'Guardrail：失败态只能走 retry/skip 治理路径，不得静默推进到下一任务，也不得继承 team context。'
  if (status === 'blocked') return 'Guardrail：阻塞态需先 unblock，不能把“继续”解释为直接执行或 team 恢复。'
  if (status === 'completed') return 'Guardrail：已完成流程只允许归档或查看状态，不允许继续执行，也不读取 team runtime。'
  if (status === 'archived') return 'Guardrail：归档流程视为结束，后续需求需重新 `/workflow start`；team runtime 不会自动继承到普通会话。'
  return 'Guardrail：主流程由 command + skill + state machine 控制，hook 只做上下文提示与守门；非 `/team` 路径必须忽略 team runtime。'
}

function determineTeamGuardrail() {
  return 'Guardrail：普通 session / workflow 只读取 workflow runtime，不继承 team runtime 的 team_id、team_name、worker_roster、dispatch_batches 或 review 状态；只有显式 `/team start|execute|status|archive|cleanup` 才允许读取 team-state.json。`/team cleanup` 还必须显式提供 teamId。'
}

function main() {
  if (shouldSkip()) return
  const projectRoot = process.cwd()
  const config = findProjectConfig(projectRoot)
  if (!config) return

  const project = config.project || {}
  const projectId = project.id || config.projectId || ''
  const projectName = project.name || config.projectName || path.basename(projectRoot)
  const state = projectId ? findWorkflowState(projectId) : null
  const specs = collectSpecIndices(projectRoot)

  const parts = []
  parts.push('<workflow-context>')
  parts.push('<project-info>')
  parts.push(`项目: ${projectName}`)
  parts.push(`项目 ID: ${projectId}`)
  const frameworks = Array.isArray(config.frameworks) ? config.frameworks : []
  if (frameworks.length) {
    const tech = frameworks.slice(0, 5).map((item) => typeof item === 'string' ? item : item.name || '').filter(Boolean).join(', ')
    if (tech) parts.push(`技术栈: ${tech}`)
  }
  parts.push('</project-info>')

  if (state) {
    parts.push('<active-workflow>')
    parts.push(`状态: ${state.status || 'unknown'}`)
    const progress = state.progress || {}
    const completed = progress.completed || []
    const tasksFile = state.tasks_file || ''
    parts.push(`已完成: ${completed.length} 任务${tasksFile ? ` (任务文件: ${tasksFile})` : ''}`)
    const current = state.current_tasks || []
    if (current.length) parts.push(`当前任务: ${current.join(', ')}`)
    const usage = ((state.contextMetrics || {}).usagePercent) || 0
    if (usage > 0) parts.push(`上下文使用率: ${usage}%`)
    parts.push('</active-workflow>')
  }

  parts.push('<next-action>')
  parts.push(determineNextAction(state))
  parts.push('</next-action>')

  parts.push('<workflow-guardrail>')
  parts.push(determineGuardrail(state))
  parts.push('</workflow-guardrail>')

  parts.push('<team-guardrail>')
  parts.push(determineTeamGuardrail())
  parts.push('</team-guardrail>')

  if (specs) {
    parts.push('<project-specs>')
    parts.push(specs)
    parts.push('</project-specs>')
  }

  const guidesDir = path.join(projectRoot, '.claude', '.agent-workflow', 'specs', 'guides')
  if (fs.existsSync(guidesDir) && fs.statSync(guidesDir).isDirectory()) {
    parts.push('<thinking-guides>')
    parts.push('项目包含思维指南，修改代码前请参考:')
    for (const name of fs.readdirSync(guidesDir).sort()) {
      if (name !== 'index.md' && name.endsWith('.md')) parts.push(`  - .claude/.agent-workflow/specs/guides/${name}`)
    }
    parts.push('</thinking-guides>')
  }

  parts.push('</workflow-context>')
  process.stdout.write(parts.join('\n'))
}

try {
  main()
} catch {
  process.exitCode = 0
}
