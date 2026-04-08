#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { detectProjectIdFromRoot, getWorkflowsDir } = require('../utils/workflow/path_utils')

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

function getCurrentTaskVerification(state, stateDir) {
  const currentTasks = state.current_tasks || []
  const taskId = currentTasks[0]
  if (!taskId) return []
  const tasksFile = state.tasks_file || ''
  if (!tasksFile) return []
  const tasksPath = path.join(stateDir, tasksFile)
  if (!fs.existsSync(tasksPath)) return []

  try {
    const content = fs.readFileSync(tasksPath, 'utf8')
    const taskPattern = new RegExp(`##+\\s+${taskId.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}:[\\s\\S]*?(?=\\n##+\\s+T\\d+:|$)`, 'm')
    const blockMatch = content.match(taskPattern)
    if (!blockMatch) return []
    const cmdMatch = blockMatch[0].match(/\*\*验证命令\*\*\s*:\s*(.+?)$/m)
    if (!cmdMatch) return []
    return cmdMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
  } catch {
    return []
  }
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

  const commands = getCurrentTaskVerification(state, stateDir)
  if (!commands.length) {
    process.stdout.write(JSON.stringify({ continue: true }))
    return
  }

  let loopState = readLoopState(stateDir)
  if (loopState.started_at) {
    const elapsedMinutes = (Date.now() - new Date(loopState.started_at).getTime()) / 60000
    if (elapsedMinutes >= STATE_TIMEOUT_MINUTES) {
      loopState = { iteration: 0, started_at: null, last_results: [] }
      writeLoopState(stateDir, loopState)
      process.stdout.write(JSON.stringify({ continue: true, reason: `[quality-loop] 验证超时 (${STATE_TIMEOUT_MINUTES}min)，自动放行。` }))
      return
    }
  }

  if ((loopState.iteration || 0) >= MAX_ITERATIONS) {
    loopState = { iteration: 0, started_at: null, last_results: [] }
    writeLoopState(stateDir, loopState)
    process.stdout.write(JSON.stringify({ continue: true, reason: `[quality-loop] 已达最大重试次数 (${MAX_ITERATIONS})，自动放行。` }))
    return
  }

  if (!loopState.started_at) loopState.started_at = new Date().toISOString()
  const results = commands.map((command) => runVerification(command))
  const allPassed = results.every((item) => item.passed)
  loopState.iteration = Number(loopState.iteration || 0) + 1
  loopState.last_results = results
  writeLoopState(stateDir, loopState)

  if (allPassed) {
    writeLoopState(stateDir, { iteration: 0, started_at: null, last_results: [] })
    process.stdout.write(JSON.stringify({ continue: true, reason: '[quality-loop] 所有验证命令通过 ✅' }))
    return
  }

  const failed = results.filter((item) => !item.passed)
  const taskId = (state.current_tasks || ['?'])[0]
  const failureMessage = failed.map((item) => `  ❌ \`${item.command}\` (exit=${item.exit_code}): ${String(item.output || '').slice(0, 200)}`).join('\n')
  process.stdout.write(JSON.stringify({
    continue: false,
    reason: `[quality-loop] 验证失败 (迭代 ${loopState.iteration}/${MAX_ITERATIONS})\n任务: ${taskId}\n失败的验证:\n${failureMessage}\n请修复后重试。`,
  }, null, 0))
}

try {
  main()
} catch {
  process.stdout.write(JSON.stringify({ continue: true }))
  process.exitCode = 0
}
