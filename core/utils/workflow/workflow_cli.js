#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { readState, writeState, completeWorkflow } = require('./state_manager')
const { getWorkflowStatePath, getWorkflowsDir } = require('./path_utils')
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
const { cmdArchive, cmdDelta, cmdDeltaInit, cmdDeltaImpact, cmdDeltaApply, cmdDeltaFail, cmdDeltaSync, cmdSpecReview, cmdPlan, cmdUnblock } = require('./lifecycle_cmds')
const { buildExecuteEntry } = require('./execution_sequencer')
const { countTasks, parseTasksV2, summarizeTaskProgress } = require('./task_parser')
const { cmdAdd, cmdGet, cmdList: cmdJournalList, cmdSearch } = require('./journal')
const { buildMinimumState, buildUserSpecReview, ensureStateDefaults } = require('./workflow_types')

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

function detectGitHead(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0) return null
  const commit = String(result.stdout || '').trim()
  return commit || null
}

function inferSpecRelativeFromPlan(planRelative, projectRoot) {
  const normalizedPlan = String(planRelative || '').replace(/\\/g, '/')
  const candidates = []
  if (normalizedPlan.startsWith('.claude/plans/')) {
    candidates.push(normalizedPlan.replace('.claude/plans/', '.claude/specs/'))
  }
  if (normalizedPlan === '.claude/plan.md') candidates.push('.claude/spec.md')
  if (normalizedPlan === '.cursor/plan.md') candidates.push('.cursor/spec.md')

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(projectRoot, candidate))) return candidate
  }
  return null
}

function cmdInit(projectId = null, projectRoot = null, planPath = null) {
  const root = detectProjectRoot(projectRoot)
  const pid = projectId || detectProjectId(root)
  if (!pid) return { error: '无法检测项目 ID，请使用 --project-id 指定' }

  const statePath = getWorkflowStatePath(pid)
  if (!statePath) return { error: `无法解析状态文件路径: ${pid}` }
  if (fs.existsSync(statePath)) {
    const existing = ensureStateDefaults(JSON.parse(fs.readFileSync(statePath, 'utf8')))
    return { initialized: false, reason: 'state_exists', project_id: pid, state_status: existing.status }
  }

  // 如果显式指定了 plan 路径，直接使用
  if (planPath) {
    const explicitPlan = path.isAbsolute(planPath) ? planPath : path.join(root, planPath)
    if (!fs.existsSync(explicitPlan)) return { error: `指定的 plan 文件不存在: ${planPath}` }
    const tasksContent = fs.readFileSync(explicitPlan, 'utf8')
    const tasks = parseTasksV2(tasksContent)
    if (!tasks.length) return { error: '无法从指定的 plan 文件解析任务' }
    const inferred = summarizeTaskProgress(tasks)
    const planRelative = path.relative(root, explicitPlan).replace(/\\/g, '/')
    const specFile = inferSpecRelativeFromPlan(planRelative, root)
    const initialTasks = inferred.current_task_id ? [inferred.current_task_id] : []
    const state = ensureStateDefaults(buildMinimumState(pid, planRelative, specFile, initialTasks, inferred.workflow_status))
    state.progress = inferred.progress
    if (specFile) {
      state.review_status.user_spec_review = buildUserSpecReview('approved', 'execute', 'system-recovery')
    } else {
      state.review_status.user_spec_review = buildUserSpecReview('skipped', 'execute', 'system-recovery')
      state.review_status.user_spec_review.requires_degradation_ack = true
      state.review_status.user_spec_review.acknowledged_degradation_at = null
      state.review_status.user_spec_review.acknowledged_degradation_by = null
      state.review_status.user_spec_review.acknowledged_degradation_source = null
    }
    state.project_root = root
    state.initial_head_commit = detectGitHead(root)
    writeState(statePath, state)
    return {
      initialized: true, project_id: pid, state_path: statePath, plan_file: planRelative,
      spec_file: specFile, first_task: inferred.current_task_id, workflow_status: inferred.workflow_status,
      progress: inferred.progress, upgrade_required: !specFile, spec_review_status: specFile ? 'approved' : 'skipped',
    }
  }

  // 不能用 resolveStateAndTasks——它要求 state 文件已存在。直接扫描当前支持的 plan 产物路径。
  const legacyCandidates = ['.claude/plan.md', '.claude/plans/plan.md', '.cursor/plan.md']
  const planCandidates = []
  for (const candidate of legacyCandidates) {
    const absolute = path.join(root, candidate)
    if (fs.existsSync(absolute)) planCandidates.push(absolute)
  }
  const plansDir = path.join(root, '.claude', 'plans')
  if (fs.existsSync(plansDir)) {
    for (const entry of fs.readdirSync(plansDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) planCandidates.push(path.join(plansDir, entry.name))
    }
  }

  const uniqueCandidates = planCandidates
    .filter((candidate, index, list) => list.indexOf(candidate) === index)
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)

  if (uniqueCandidates.length > 1) {
    return {
      error: '发现多个 plan 候选文件，无法自动选择。请使用 --plan 指定具体文件',
      detected_plans: uniqueCandidates.map((p) => ({
        path: path.relative(root, p).replace(/\\/g, '/'),
        mtime: fs.statSync(p).mtime.toISOString(),
      })),
    }
  }

  const [tasksPath] = uniqueCandidates

  const tasksContent = tasksPath ? fs.readFileSync(tasksPath, 'utf8') : null
  if (!tasksContent) return { error: '未找到 plan.md，无法推导首个任务' }

  const tasks = parseTasksV2(tasksContent)
  if (!tasks.length) return { error: '无法从 plan.md 解析任务' }
  const inferred = summarizeTaskProgress(tasks)

  const planRelative = tasksPath ? path.relative(root, tasksPath).replace(/\\/g, '/') : null
  const specFile = inferSpecRelativeFromPlan(planRelative, root)

  const initialTasks = inferred.current_task_id ? [inferred.current_task_id] : []
  const state = ensureStateDefaults(buildMinimumState(pid, planRelative, specFile, initialTasks, inferred.workflow_status))
  state.progress = inferred.progress
  // spec 文件存在 → 推断历史上已通过审批，标记为 system-recovery
  // 无 spec → 可能来自 quick-plan，标记为 skipped（不伪造审批记录）
  if (specFile) {
    state.review_status.user_spec_review = buildUserSpecReview('approved', 'execute', 'system-recovery')
  } else {
    state.review_status.user_spec_review = buildUserSpecReview('skipped', 'execute', 'system-recovery')
    state.review_status.user_spec_review.requires_degradation_ack = true
    state.review_status.user_spec_review.acknowledged_degradation_at = null
    state.review_status.user_spec_review.acknowledged_degradation_by = null
    state.review_status.user_spec_review.acknowledged_degradation_source = null
  }
  state.project_root = root
  state.initial_head_commit = detectGitHead(root)
  writeState(statePath, state)

  return {
    initialized: true,
    project_id: pid,
    state_path: statePath,
    plan_file: planRelative,
    spec_file: specFile,
    first_task: inferred.current_task_id,
    workflow_status: inferred.workflow_status,
    progress: inferred.progress,
    // 当 plan 存在但无 spec 时（如来自 /quick-plan），提示调用方引导升级
    upgrade_required: !specFile,
    spec_review_status: specFile ? 'approved' : 'skipped',
  }
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
        state.status = 'review_pending'
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

function cmdReviewAdvance(outcome, failedTaskIds = null, projectId = null, projectRoot = null) {
  const [state, statePath, tasksContent] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流' }
  if (state.status !== 'review_pending') {
    return { error: `当前状态为 ${state.status}，不是 review_pending。只有 review_pending 状态才能推进审查结果。`, state_status: state.status }
  }

  if (outcome === 'passed') {
    const totalTasks = tasksContent ? countTasks(tasksContent) : 0
    const summary = completeWorkflow(state, statePath, totalTasks)
    return {
      review_advanced: true,
      outcome: 'passed',
      workflow_status: 'completed',
      summary,
    }
  }

  if (outcome === 'failed') {
    const tasks = failedTaskIds || []
    state.status = 'running'
    state.completed_at = null
    const progress = state.progress || (state.progress = {})
    const failedList = progress.failed || (progress.failed = [])
    for (const taskId of tasks) {
      if (!failedList.includes(taskId)) failedList.push(taskId)
      // 从 completed 列表中移除，还原为可重执行状态
      progress.completed = (progress.completed || []).filter((id) => id !== taskId)
    }
    if (tasks.length) state.current_tasks = [tasks[0]]
    writeState(statePath, state)
    return {
      review_advanced: true,
      outcome: 'failed',
      workflow_status: 'running',
      failed_tasks: tasks,
      current_task: state.current_tasks[0] || null,
    }
  }

  return { error: `未知的审查结果: ${outcome}。支持 passed 或 failed。` }
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
      result = buildExecuteEntry(command, intent, normalizedMode, root, { force: args.includes('--force') })
    } else if (command === 'next') {
      result = cmdNext(pid, projectRoot)
    } else if (command === 'plan' || command === 'start') {
      const requirement = args[0]
      result = cmdPlan(requirement, args.includes('--force') || args.includes('-f'), args.includes('--no-discuss'), pid, projectRoot, option(args, '--spec-choice', null))
    } else if (command === 'spec-review') {
      result = cmdSpecReview(optionOrArg(args, '--choice', option(args, '--spec-choice', null)), pid, projectRoot)
    } else if (command === 'delta') {
      const deltaSubcommand = args[0]
      if (deltaSubcommand === 'init') {
        result = cmdDeltaInit(option(args, '--type'), option(args, '--source'), option(args, '--description'), pid, projectRoot)
      } else if (deltaSubcommand === 'impact') {
        result = cmdDeltaImpact(option(args, '--change-id'), option(args, '--tasks-added'), option(args, '--tasks-modified'), option(args, '--tasks-removed'), option(args, '--risk-level'), pid, projectRoot)
      } else if (deltaSubcommand === 'apply') {
        result = cmdDeltaApply(option(args, '--change-id'), pid, projectRoot)
      } else if (deltaSubcommand === 'fail') {
        result = cmdDeltaFail(option(args, '--change-id'), option(args, '--error'), pid, projectRoot)
      } else if (deltaSubcommand === 'sync') {
        result = cmdDeltaSync(option(args, '--dependency') || args[1], pid, projectRoot)
      } else {
        // Legacy: 旧的单参数模式
        result = cmdDelta(args[0] || '', pid, projectRoot)
      }
    } else if (command === 'archive') {
      result = cmdArchive(args.includes('--summary'), pid, projectRoot)
    } else if (command === 'unblock') {
      result = cmdUnblock(args[0], pid, projectRoot)
    } else if (command === 'advance') {
      if (args.includes('--review-passed')) {
        result = cmdReviewAdvance('passed', null, pid, projectRoot)
      } else if (args.includes('--review-failed')) {
        result = cmdReviewAdvance('failed', splitCsv(option(args, '--failed-tasks', '')), pid, projectRoot)
      } else {
        result = cmdAdvance(args[0], option(args, '--journal'), splitCsv(option(args, '--decisions', '')), pid, projectRoot)
      }
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
    } else if (command === 'init') {
      result = cmdInit(pid, projectRoot, option(args, '--plan'))
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
      process.stderr.write('Usage: node workflow_cli.js [--project-id ID] [--project-root DIR] <plan|execute|continue|init|spec-review|delta|archive|unblock|advance|context|status|list|progress|parallel|budget|journal> ...\n  plan (alias: start) - 启动规划流程\n  init - 状态文件自愈（执行阶段缺失时自动创建）\n')
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
  cmdInit,
  cmdReviewAdvance,
}

if (require.main === module) main()
