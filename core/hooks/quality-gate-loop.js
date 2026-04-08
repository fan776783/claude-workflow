#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { detectProjectIdFromRoot, getWorkflowsDir } = require('../utils/workflow/path_utils')
const { getReviewResult } = require('../utils/workflow/workflow_types')

const MAX_ITERATIONS = 5
const STATE_TIMEOUT_MINUTES = 30

function findWorkflowState() {
  const projectId = detectProjectIdFromRoot(process.cwd())
  if (!projectId) return { state: null, stateDir: '' }
  const workflowDir = getWorkflowsDir(projectId)
  if (!workflowDir) return { state: null, stateDir: '' }
  const statePath = path.join(workflowDir, 'workflow-state.json')
  if (!fs.existsSync(statePath)) return { state: null, stateDir: workflowDir }
  try {
    return { state: JSON.parse(fs.readFileSync(statePath, 'utf8')), stateDir: workflowDir }
  } catch {
    return { state: null, stateDir: workflowDir }
  }
}

function getCurrentTaskBlock(state, stateDir) {
  const currentTasks = state.current_tasks || []
  const taskId = currentTasks[0]
  if (!taskId) return { taskId: '', taskBlock: '' }
  const tasksFile = state.tasks_file || ''
  if (!tasksFile) return { taskId, taskBlock: '' }
  const tasksPath = path.join(stateDir, tasksFile)
  if (!fs.existsSync(tasksPath)) return { taskId, taskBlock: '' }

  try {
    const content = fs.readFileSync(tasksPath, 'utf8')
    const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const headingPattern = new RegExp(`^##+\\s+${escapedTaskId}:`, 'm')
    const headingMatch = headingPattern.exec(content)
    if (!headingMatch) return { taskId, taskBlock: '' }
    const start = headingMatch.index
    const rest = content.slice(start)
    const nextHeadingMatch = /\n##+\s+T\d+:/m.exec(rest.slice(1))
    const end = nextHeadingMatch ? start + 1 + nextHeadingMatch.index : content.length
    return { taskId, taskBlock: content.slice(start, end).trim() }
  } catch {
    return { taskId, taskBlock: '' }
  }
}

function parseActions(taskBlock) {
  if (!taskBlock) return []
  const actionMatch = taskBlock.match(/\*\*actions\*\*\s*:\s*(.+?)$/m)
  if (!actionMatch) return []
  return actionMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
}

function getCurrentTaskVerification(state, stateDir) {
  const { taskBlock } = getCurrentTaskBlock(state, stateDir)
  if (!taskBlock) return []
  const cmdMatch = taskBlock.match(/\*\*验证命令\*\*\s*:\s*(.+?)$/m)
  if (!cmdMatch) return []
  return cmdMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
}

function readLoopState(stateDir) {
  const statePath = path.join(stateDir, '.quality-loop-state.json')
  if (!fs.existsSync(statePath)) return { iteration: 0, started_at: null, last_results: [] }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return { iteration: 0, started_at: null, last_results: [] }
  }
}

function writeLoopState(stateDir, loopState) {
  try {
    fs.writeFileSync(path.join(stateDir, '.quality-loop-state.json'), JSON.stringify(loopState, null, 2))
  } catch {}
}

function runVerification(command, timeoutSeconds = 60) {
  const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: 'utf8', timeout: timeoutSeconds * 1000 })
  if (result.error) {
    return {
      command,
      exit_code: result.status == null ? -1 : result.status,
      passed: false,
      output: String(result.error.message || '').slice(0, 500),
    }
  }
  return {
    command,
    exit_code: result.status,
    passed: result.status === 0,
    output: String(result.stdout || result.stderr || '').slice(0, 500),
  }
}

function resetLoopState(stateDir) {
  writeLoopState(stateDir, { iteration: 0, started_at: null, last_results: [] })
}

function buildFailureMessage(taskId, prefix, failedItems, iteration, maxIterations) {
  const details = failedItems.map((item) => `  ❌ \`${item.command}\` (exit=${item.exit_code}): ${String(item.output || '').slice(0, 200)}`).join('\n')
  return `${prefix} (迭代 ${iteration}/${maxIterations})\n任务: ${taskId}\n失败详情:\n${details}\n请修复后重试。`
}

function main() {
  try {
    const raw = fs.readFileSync(0, 'utf8')
    if (raw.trim()) JSON.parse(raw)
  } catch {}

  const { state, stateDir } = findWorkflowState()
  if (!state || state.status !== 'running') {
    process.stdout.write(JSON.stringify({ continue: true }))
    return
  }

  const { taskId, taskBlock } = getCurrentTaskBlock(state, stateDir)
  if (!taskId) {
    process.stdout.write(JSON.stringify({ continue: true }))
    return
  }

  const actions = parseActions(taskBlock)
  const verificationCommands = getCurrentTaskVerification(state, stateDir)
  const qualityGate = getReviewResult(state, taskId)

  if (!verificationCommands.length && !actions.includes('quality_review')) {
    process.stdout.write(JSON.stringify({ continue: true }))
    return
  }

  let loopState = readLoopState(stateDir)
  if (loopState.started_at) {
    const elapsedMinutes = (Date.now() - new Date(loopState.started_at).getTime()) / 60000
    if (elapsedMinutes >= STATE_TIMEOUT_MINUTES) {
      resetLoopState(stateDir)
      process.stdout.write(JSON.stringify({ continue: true, reason: `[quality-loop] 验证超时 (${STATE_TIMEOUT_MINUTES}min)，自动放行。` }))
      return
    }
  }

  if ((loopState.iteration || 0) >= MAX_ITERATIONS) {
    resetLoopState(stateDir)
    process.stdout.write(JSON.stringify({ continue: true, reason: `[quality-loop] 已达最大重试次数 (${MAX_ITERATIONS})，自动放行。` }))
    return
  }

  if (!loopState.started_at) loopState.started_at = new Date().toISOString()
  loopState.iteration = Number(loopState.iteration || 0) + 1

  const failedItems = []
  if (verificationCommands.length) {
    const commandResults = verificationCommands.map((command) => runVerification(command))
    loopState.last_results = commandResults
    for (const result of commandResults) {
      if (!result.passed) failedItems.push(result)
    }
  }

  if (actions.includes('quality_review')) {
    const review = qualityGate || getReviewResult(state, taskId)
    if (!review || review.overall_passed !== true) {
      failedItems.push({
        command: `quality_gates.${taskId}`,
        exit_code: 1,
        output: `overall_passed=${review ? review.overall_passed : 'missing'}; last_decision=${review ? review.last_decision : 'missing'}`,
      })
    }
  }

  writeLoopState(stateDir, loopState)

  if (failedItems.length === 0) {
    resetLoopState(stateDir)
    process.stdout.write(JSON.stringify({ continue: true, reason: '[quality-loop] 所有验证与质量关卡均通过 ✅' }))
    return
  }

  process.stdout.write(JSON.stringify({
    continue: false,
    reason: buildFailureMessage(taskId, '[quality-loop] 验证失败', failedItems, loopState.iteration, MAX_ITERATIONS),
  }))
}

try {
  main()
} catch {
  process.stdout.write(JSON.stringify({ continue: true }))
  process.exitCode = 0
}
