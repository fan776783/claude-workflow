#!/usr/bin/env node

const { spawnSync } = require('child_process')
const path = require('path')
const { writeState } = require('./state_manager')
const {
  cmdComplete,
  cmdContextBudget,
  cmdList,
  cmdNext,
  cmdParallel,
  cmdProgress,
  cmdStatus,
  detectProjectId,
  detectProjectRoot,
  resolveStateAndTasks,
} = require('./task_manager')
const { cmdArchive, cmdDelta, cmdSpecReview, cmdStart, cmdUnblock } = require('./lifecycle_cmds')
const { buildExecuteEntry } = require('./execution_sequencer')
const { countTasks } = require('./task_parser')
const { cmdAdd, cmdGet, cmdList: cmdJournalList, cmdSearch } = require('./journal')

const EXECUTION_MODE_ALIASES = {
  继续: 'continuous',
  连续: 'continuous',
  next: 'phase',
  下一阶段: 'phase',
  单阶段: 'phase',
  phase: 'phase',
  重试: 'retry',
  retry: 'retry',
  跳过: 'skip',
  skip: 'skip',
}

function cmdAdvance(taskId, journalSummary = null, decisions = null, projectId = null, projectRoot = null) {
  const completeResult = cmdComplete(taskId, projectId, projectRoot)
  if (completeResult.error) return completeResult
  const nextResult = cmdNext(projectId, projectRoot)
  const nextTask = nextResult.next_task
  const [state, statePath, tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (state && statePath) {
    if (nextTask && typeof nextTask === 'object') state.current_tasks = [nextTask.id]
    else if (typeof nextTask === 'string') state.current_tasks = [nextTask]
    else {
      state.current_tasks = []
      const progress = state.progress || {}
      const finishedCount = (progress.completed || []).length + (progress.skipped || []).length
      const totalTasks = tasksContent ? countTasks(tasksContent) : 0
      if (totalTasks > 0 && finishedCount >= totalTasks) {
        state.status = 'completed'
        state.completed_at = new Date().toISOString()
      }
    }
    writeState(statePath, state)
  }

  let journalResult = null
  if (journalSummary) {
    const pid = projectId || detectProjectId(projectRoot)
    if (pid) {
      const nextId = nextTask && typeof nextTask === 'object' ? nextTask.id : nextTask
      journalResult = cmdAdd(
        pid,
        `完成 ${taskId}${nextId ? ` → ${nextId}` : ''}`,
        pid,
        [taskId],
        journalSummary,
        decisions || [],
        nextId ? [`下一任务: ${nextId}`] : []
      )
    }
  }

  const result = {
    advanced: true,
    completed_task: taskId,
    next_task: nextTask,
    workflow_status: state ? state.status : null,
  }
  if (journalResult) result.journal = journalResult
  return result
}

function cmdContext(projectId = null, projectRoot = null) {
  const pid = projectId || detectProjectId(projectRoot)
  if (!pid) return { error: '无法检测项目 ID' }

  const result = { project_id: pid }
  const status = cmdStatus(pid, projectRoot)
  result.workflow = status
  result.runtime = {
    delta_tracking: status.delta_tracking || {},
    planning_gates: status.planning_gates || {},
    quality_gate_summary: status.quality_gate_summary || {},
    unblocked: status.unblocked || [],
  }
  const nextInfo = cmdNext(pid, projectRoot)
  result.next_task = nextInfo.next_task
  const budget = cmdContextBudget(pid, projectRoot)
  if (!budget.error) {
    result.budget = {
      level: budget.level,
      current_usage: budget.current_usage,
      max_consecutive_tasks: budget.max_consecutive_tasks,
    }
  }

  const journal = cmdJournalList(pid, 3)
  if (!journal.error) {
    result.recent_sessions = journal.sessions || []
    if ((journal.sessions || []).length) {
      const latest = cmdGet(pid, journal.sessions[0].id)
      if (!latest.error) {
        result.last_session = {
          title: latest.title,
          summary: latest.summary,
          decisions: latest.decisions || [],
          next_steps: latest.next_steps || [],
        }
      }
    }
  }

  try {
    const root = detectProjectRoot(projectRoot)
    const gitResult = spawnSync('git', ['status', '--porcelain', '--branch'], { encoding: 'utf8', cwd: root, timeout: 5000 })
    if (gitResult.status === 0) {
      const lines = String(gitResult.stdout || '').trim().split('\n').filter(Boolean)
      const branchLine = lines[0] || ''
      const changedFiles = lines.slice(1).filter((line) => line.trim()).length
      result.git = {
        branch: branchLine.replace(/^##\s*/, ''),
        changed_files: changedFiles,
      }
    }
  } catch {}

  return result
}

function splitCsv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function parseArgs(argv) {
  const args = [...argv]
  const options = { projectId: null, projectRoot: null }
  while (args.length && args[0].startsWith('--')) {
    const flag = args.shift()
    if (flag === '--project-id') options.projectId = args.shift()
    else if (flag === '--project-root') options.projectRoot = args.shift()
    else throw new Error(`Unknown flag: ${flag}`)
  }
  const command = args.shift()
  return { options, command, args }
}

function option(args, flag, fallback = null) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : fallback
}

function optionOrArg(args, flag, fallback = null) {
  const explicit = option(args, flag)
  if (explicit != null) return explicit
  const first = args.find((arg) => !String(arg).startsWith('--'))
  return first != null ? first : fallback
}

function main() {
  try {
    const { options, command, args } = parseArgs(process.argv.slice(2))
    const pid = options.projectId
    const projectRoot = options.projectRoot
    let result

    if (command === 'execute' || command === 'continue') {
      const intent = args[0] && !args[0].startsWith('--') ? args[0] : null
      const mode = option(args, '--mode')
      const root = projectRoot ? path.resolve(projectRoot) : process.cwd()
      const normalizedMode = mode || (intent && EXECUTION_MODE_ALIASES[intent]) || intent
      result = buildExecuteEntry(command, intent, normalizedMode, root)
    } else if (command === 'next') {
      result = cmdNext(pid, projectRoot)
    } else if (command === 'start') {
      const requirement = args[0]
      result = cmdStart(requirement, args.includes('--force') || args.includes('-f'), args.includes('--no-discuss'), pid, projectRoot, option(args, '--spec-choice', null))
    } else if (command === 'spec-review') {
      result = cmdSpecReview(optionOrArg(args, '--choice', option(args, '--spec-choice', null)), pid, projectRoot)
    } else if (command === 'delta') {
      result = cmdDelta(args[0] || '', pid, projectRoot)
    } else if (command === 'archive') {
      result = cmdArchive(args.includes('--summary'), pid, projectRoot)
    } else if (command === 'unblock') {
      result = cmdUnblock(args[0], pid, projectRoot)
    } else if (command === 'advance') {
      result = cmdAdvance(args[0], option(args, '--journal'), splitCsv(option(args, '--decisions', '')), pid, projectRoot)
    } else if (command === 'context') {
      result = cmdContext(pid, projectRoot)
    } else if (command === 'status') {
      result = cmdStatus(pid, projectRoot)
    } else if (command === 'list') {
      result = cmdList(pid, projectRoot)
    } else if (command === 'progress') {
      result = cmdProgress(pid, projectRoot)
    } else if (command === 'parallel') {
      result = cmdParallel(pid, projectRoot)
    } else if (command === 'budget') {
      result = cmdContextBudget(pid, projectRoot)
    } else if (command === 'journal') {
      const journalCommand = args.shift()
      const resolvedPid = pid || detectProjectId(projectRoot)
      if (!resolvedPid) result = { error: '无法检测项目 ID，请使用 --project-id 指定' }
      else if (journalCommand === 'add') {
        result = cmdAdd(resolvedPid, option(args, '--title'), option(args, '--workflow-id'), splitCsv(option(args, '--tasks-completed', '')), option(args, '--summary'), splitCsv(option(args, '--decisions', '')), splitCsv(option(args, '--next-steps', '')))
      } else if (journalCommand === 'list') {
        result = cmdJournalList(resolvedPid, Number(option(args, '--limit', 20)))
      } else if (journalCommand === 'search') {
        result = cmdSearch(resolvedPid, args[0])
      } else if (journalCommand === 'get') {
        result = cmdGet(resolvedPid, Number(args[0]))
      } else {
        process.stderr.write('Usage: node workflow_cli.js journal <add|list|search|get> ...\n')
        process.exitCode = 1
        return
      }
    } else {
      process.stderr.write('Usage: node workflow_cli.js [--project-id ID] [--project-root DIR] <execute|continue|start|spec-review|delta|archive|unblock|advance|context|status|list|progress|parallel|budget|journal> ...\n')
      process.exitCode = 1
      return
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  EXECUTION_MODE_ALIASES,
  cmdAdvance,
  cmdContext,
}

if (require.main === module) main()
