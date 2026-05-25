#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { readState, writeState, completeWorkflow } = require('./state_manager')
const { getWorkflowStatePath, getWorkflowsDir, getHandoffPath } = require('./path_utils')
const {
  cmdComplete,
  cmdContextBudget,
  cmdList,
  cmdNext,
  cmdProgress,
  cmdStatus,
  detectProjectId,
  detectProjectRoot,
  resolveStateAndTasks,
} = require('./task_manager')
const { cmdArchive, cmdDeltaInit, cmdDeltaImpact, cmdDeltaApply, cmdDeltaFail, cmdDeltaSync, cmdSpecReview, cmdPlan, cmdPlanReview, cmdPlanEdit, cmdUnblock, cmdAcceptDeviation, recoverArchiveTombstone } = require('./lifecycle_cmds')
const { buildExecuteEntry } = require('./execution_sequencer')
const { countTasks, parseTasksV2, summarizeTaskProgress } = require('./task_parser')
const { cmdAdd, cmdGet, cmdList: cmdJournalList, cmdSearch } = require('./journal')
const { buildMinimumState, buildUserSpecReview, ensureStateDefaults } = require('./workflow_types')
const { evaluateTriage, loadCodexJobResult } = require('./triage_rules')
const { buildTaskBundle } = require('./task_bundle')
const { runReadiness } = require('./readiness_checks')
const { loadProjectConfig, resolveSpecDocsRoot } = require('./project_setup')
const os = require('os')

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
  // spec.md 默认在项目内 docs/workflows/specs/，从 plan.md 同 baseName 反查。
  const specDocsRoot = resolveSpecDocsRoot(loadProjectConfig(projectRoot))
  if (normalizedPlan) {
    candidates.push(path.posix.join(specDocsRoot, path.basename(normalizedPlan)))
  }
  // 旧 user 级路径：绝对路径指向 workflowDir/plans/
  if (path.isAbsolute(normalizedPlan) && normalizedPlan.includes('/plans/')) {
    const dir = path.dirname(normalizedPlan)
    const base = path.basename(normalizedPlan)
    candidates.push(path.join(dir.replace(/\/plans$/, '/specs'), base))
  }
  // 兼容旧路径格式
  if (normalizedPlan.startsWith('.claude/plans/')) {
    candidates.push(normalizedPlan.replace('.claude/plans/', '.claude/specs/'))
  }
  if (normalizedPlan === '.claude/plan.md') candidates.push('.claude/spec.md')
  if (normalizedPlan === '.cursor/plan.md') candidates.push('.cursor/spec.md')

  for (const candidate of candidates) {
    const resolvedPath = path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate)
    if (fs.existsSync(resolvedPath)) return candidate
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
    const planRelative = explicitPlan.startsWith(path.join(os.homedir(), '.claude', 'workflows'))
      ? explicitPlan
      : path.relative(root, explicitPlan).replace(/\\/g, '/')
    const specFile = inferSpecRelativeFromPlan(planRelative, root)
    const initialTasks = inferred.current_task_id ? [inferred.current_task_id] : []
    const state = ensureStateDefaults(buildMinimumState(pid, planRelative, specFile, initialTasks, inferred.workflow_status))
    state.progress = inferred.progress
    if (inferred.halt_reason) state.halt_reason = inferred.halt_reason
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
      halt_reason: inferred.halt_reason,
      progress: inferred.progress, upgrade_required: !specFile, spec_review_status: specFile ? 'approved' : 'skipped',
    }
  }

  // 不能用 resolveStateAndTasks——它要求 state 文件已存在。直接扫描当前支持的 plan 产物路径。
  const planCandidates = []
  // 扫描项目目录下的 .claude/plans/
  const plansDir = path.join(root, '.claude', 'plans')
  if (fs.existsSync(plansDir)) {
    for (const entry of fs.readdirSync(plansDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) planCandidates.push(path.join(plansDir, entry.name))
    }
  }
  // 扫描 workflowDir 下的 plans/ 目录（新路径格式）
  const wfDir = getWorkflowsDir(pid)
  if (wfDir) {
    const wfPlansDir = path.join(wfDir, 'plans')
    if (fs.existsSync(wfPlansDir)) {
      for (const entry of fs.readdirSync(wfPlansDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) planCandidates.push(path.join(wfPlansDir, entry.name))
      }
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

  const planRelative = tasksPath
    ? (tasksPath.startsWith(path.join(os.homedir(), '.claude', 'workflows')) ? tasksPath : path.relative(root, tasksPath).replace(/\\/g, '/'))
    : null
  const specFile = inferSpecRelativeFromPlan(planRelative, root)

  const initialTasks = inferred.current_task_id ? [inferred.current_task_id] : []
  const state = ensureStateDefaults(buildMinimumState(pid, planRelative, specFile, initialTasks, inferred.workflow_status))
  state.progress = inferred.progress
  if (inferred.halt_reason) state.halt_reason = inferred.halt_reason
  // spec 文件存在 → 推断历史上已通过审批，标记为 system-recovery
  // 无 spec → 标记 skipped 留痕，不伪造审批记录
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
    halt_reason: inferred.halt_reason,
    progress: inferred.progress,
    // plan 存在但无 spec → 提示调用方引导 spec 重建或显式 --force
    upgrade_required: !specFile,
    spec_review_status: specFile ? 'approved' : 'skipped',
  }
}

function advanceAfterComplete(completedTaskIds, journalSummary, decisions, projectId, projectRoot) {
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
      const label = Array.isArray(completedTaskIds) ? completedTaskIds.join(',') : completedTaskIds
      // T6 兼容层：advance --journal "string" 上游 CLI 路径，把 string 包装成 evidence 最小结构。
      // 直接调 `node journal.js add --summary "string"` 仍走 hard-reject。
      const summaryForJournal = typeof journalSummary === 'string'
        ? { commands_run: [], diff_summary: journalSummary, coverage_evidence: '', unverified_items: [] }
        : journalSummary
      journalResult = cmdAdd(
        pid,
        `完成 ${label}${nextId ? ` → ${nextId}` : ''}`,
        pid,
        Array.isArray(completedTaskIds) ? completedTaskIds : [completedTaskIds],
        summaryForJournal,
        decisions || [],
        nextId ? [`下一任务: ${nextId}`] : []
      )
    }
  }

  return { nextTask, workflowStatus: state ? state.status : null, journalResult }
}

// 治理 halt 恢复：仅当 status=halted && halt_reason=governance 时翻为 running，避免误用清掉真实 failure halt。
function cmdResumeFromGovernanceHalt(projectId = null, projectRoot = null) {
  const [state, statePath, , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流', code }
  if (state.status !== 'halted') {
    return { error: `当前状态为 ${state.status}，不是 halted。该动词仅用于治理 halt 恢复。`, state_status: state.status }
  }
  if (state.halt_reason !== 'governance') {
    return { error: `halt_reason=${state.halt_reason}，非 governance halt。其他 halt（failure/dependency）必须经各自恢复路径。`, halt_reason: state.halt_reason }
  }
  const previousReason = state.halt_reason
  state.status = 'running'
  state.halt_reason = null
  writeState(statePath, state)
  return {
    resumed: true,
    project_id: state.project_id || projectId || null,
    previous_status: 'halted',
    previous_halt_reason: previousReason,
    workflow_status: 'running',
  }
}

// set-report-path：写顶层 state.review_report_path，避免 controller 手编 state.json 触发 harness 全文件 system-reminder 重注入。
function cmdSetReportPath(reportPath, projectId = null, projectRoot = null, { unset = false } = {}) {
  const [state, statePath, , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流', code }
  if (!unset && (!reportPath || !String(reportPath).trim())) {
    return { error: 'report path 不能为空（如需清除请加 --unset）' }
  }
  const previous = state.review_report_path || null
  state.review_report_path = unset ? null : String(reportPath).trim()
  writeState(statePath, state)
  return {
    updated: true,
    review_report_path: state.review_report_path,
    previous_value: previous,
  }
}

// set-contract-digest-path：写顶层 state.contract_digest_path，避免 controller 手编 state.json 触发 harness 全文件 system-reminder 重注入。
function cmdSetContractDigestPath(digestPath, projectId = null, projectRoot = null, { unset = false } = {}) {
  const [state, statePath, , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流', code }
  if (!unset && (!digestPath || !String(digestPath).trim())) {
    return { error: 'contract digest path 不能为空（如需清除请加 --unset）' }
  }
  const previous = state.contract_digest_path || null
  state.contract_digest_path = unset ? null : String(digestPath).trim()
  writeState(statePath, state)
  return {
    updated: true,
    contract_digest_path: state.contract_digest_path,
    previous_value: previous,
  }
}

// write-handoff：落 handoff/{from-phase}.md（不入 state schema，覆盖式写）。
// 顶部 5 行 freshness header（from/to/state_updated_at/spec_file/plan_file，值取自当前 state）+ ≤20 行正文。
function cmdWriteHandoff({ fromPhase, toPhase, contentFile, projectId = null, projectRoot = null } = {}) {
  const [state, statePath, , , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流', code }
  const handoffPath = getHandoffPath(state.project_id || projectId, fromPhase)
  if (!handoffPath) return { error: `非法 from phase: ${fromPhase}（仅支持 spec|plan|execute）` }
  if (!toPhase || !String(toPhase).trim()) return { error: 'to phase 不能为空' }
  if (!contentFile || !String(contentFile).trim()) return { error: 'content-file 不能为空' }
  if (!fs.existsSync(contentFile)) return { error: `content-file 不存在: ${contentFile}` }

  const body = fs.readFileSync(contentFile, 'utf8').replace(/\n+$/, '')
  const bodyLines = body.length ? body.split('\n') : []
  if (bodyLines.length > 20) {
    return { error: `handoff 正文 ${bodyLines.length} 行，超过 20 行上限` }
  }

  const header = [
    `from: ${fromPhase}`,
    `to: ${toPhase}`,
    `state_updated_at: ${state.updated_at || ''}`,
    `spec_file: ${state.spec_file || ''}`,
    `plan_file: ${state.plan_file || ''}`,
  ].join('\n')

  fs.mkdirSync(path.dirname(handoffPath), { recursive: true })
  fs.writeFileSync(handoffPath, `${header}\n\n${body}\n`)
  return { written: true, path: handoffPath, lines: bodyLines.length }
}

// read-handoff：cmdWriteHandoff 的反向。读 handoff/{from}.md，比对 header 的
// state_updated_at/spec_file/plan_file 与当前 state，全等 → {fresh:true, content:<正文>}，
// 任一不符 → {fresh:false, reason:'stale', fallback:'read-full', mismatch}，文件缺失 →
// {fresh:false, reason:'missing', fallback:'read-full'}。C-4：任何分支不抛异常、不置 exitCode（回退非错误）。
function cmdReadHandoff({ from, projectId = null, projectRoot = null } = {}) {
  try {
    const [state] = resolveStateAndTasks(projectId, projectRoot)
    const handoffPath = getHandoffPath(state ? state.project_id || projectId : projectId, from)
    if (!handoffPath || !state || !fs.existsSync(handoffPath)) {
      return { fresh: false, reason: 'missing', fallback: 'read-full' }
    }

    const raw = fs.readFileSync(handoffPath, 'utf8')
    // header 与正文以首个空行分隔（cmdWriteHandoff 写出 `${header}\n\n${body}\n`）。
    const separatorIndex = raw.indexOf('\n\n')
    const headerBlock = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw
    const body = separatorIndex >= 0 ? raw.slice(separatorIndex + 2).replace(/\n+$/, '') : ''

    const header = {}
    for (const line of headerBlock.split('\n')) {
      const colon = line.indexOf(': ')
      if (colon < 0) continue
      header[line.slice(0, colon)] = line.slice(colon + 2)
    }

    const expected = {
      state_updated_at: state.updated_at || '',
      spec_file: state.spec_file || '',
      plan_file: state.plan_file || '',
    }
    const mismatch = Object.keys(expected).filter((key) => (header[key] || '') !== expected[key])
    if (mismatch.length) {
      return { fresh: false, reason: 'stale', fallback: 'read-full', mismatch }
    }
    return { fresh: true, content: body }
  } catch {
    // C-4：读侧任何异常一律回退读全文，绝不抛。
    return { fresh: false, reason: 'missing', fallback: 'read-full' }
  }
}

// advance 默认响应仅回 {id, name}，完整 task 数据走 task-bundle <id>（Step 5.1.0 流程）。
// 调用方需要全量 task 时显式传 --full（CLI）或 { full: true }（程序调用）。
function slimNextTask(nextTask) {
  if (nextTask == null) return null
  if (typeof nextTask === 'string') return { id: nextTask, name: null }
  if (typeof nextTask === 'object') return { id: nextTask.id || null, name: nextTask.name || null }
  return nextTask
}

function cmdAdvance(taskId, journalSummary = null, decisions = null, projectId = null, projectRoot = null, { full = false } = {}) {
  const completeResult = cmdComplete(taskId, projectId, projectRoot)
  if (completeResult.error) return completeResult
  const { nextTask, workflowStatus, journalResult } = advanceAfterComplete(taskId, journalSummary, decisions, projectId, projectRoot)
  const result = {
    advanced: true,
    completed_task: taskId,
    next_task: full ? nextTask : slimNextTask(nextTask),
    workflow_status: workflowStatus,
  }
  if (completeResult.status_transition) result.status_transition = completeResult.status_transition
  if (journalResult) result.journal = journalResult
  return result
}

function cmdReviewAdvance(outcome, failedTaskIds = null, projectId = null, projectRoot = null) {
  const [state, statePath, tasksContent, , code] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流', code }
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

const SUBCOMMAND_HELP = {
  advance: `advance - 标记任务完成并推进，或推进 review 结果。

用法：
  advance <task-id> [--journal STR] [--decisions a,b,c] [--full]
    标记单任务完成。planned 状态下自动升为 running（返回 status_transition）。
    默认 next_task 仅返回 {id, name}。--full 返回完整 task 对象。
    完整数据走 task-bundle <id>（execute Step 5.1.0 标准流程）。
  advance --review-passed
    review_pending → completed（需事先跑完 /workflow-review）。
  advance --review-failed --failed-tasks "T1,T2"
    review_pending → running，列出的 task 重新回到失败列表等待修复。
`,
  delta: `delta - 规划时捕获并应用delta。

用法：
  delta init --type <type> --source <source> --description <desc>
  delta impact --change-id ID \\
         [--tasks-added A --tasks-modified B --tasks-removed C --risk-level low|medium|high]
  delta apply --change-id ID
  delta fail --change-id ID --error MSG
  delta sync --dependency DEP
  delta <legacy-arg>    # 向后兼容：旧单参数模式
`,
  journal: `journal - 工作流journal新增、查询、搜索。

用法：
  journal add --title STR --summary STR \\
         [--workflow-id ID --tasks-completed T1,T2 --decisions a,b --next-steps x,y]
  journal list [--limit 20]
  journal search <query>
  journal get <id>
`,
}

function renderSubcommandHelp(subcommand) {
  if (!subcommand) {
    return `Usage: node workflow_cli.js help <subcommand>
Available subcommands: ${Object.keys(SUBCOMMAND_HELP).join(', ')}
`
  }
  const body = SUBCOMMAND_HELP[subcommand]
  if (body) return body
  return `未知 subcommand: ${subcommand}
Available subcommands: ${Object.keys(SUBCOMMAND_HELP).join(', ')}
`
}

function main() {
  try {
    const { options, command, args } = parseArgs(process.argv.slice(2))
    const pid = options.projectId
    const projectRoot = options.projectRoot
    let result

    // Recover from a crashed /workflow-archive before dispatching any command, so active-workflow
    // detection sees a clean root (either fully archived or fully reverted).
    try {
      const recoveryPid = pid || detectProjectId(projectRoot)
      if (recoveryPid) {
        const workflowDir = getWorkflowsDir(recoveryPid)
        if (workflowDir && fs.existsSync(workflowDir)) recoverArchiveTombstone(workflowDir)
      }
    } catch {}

    // T2 codex review halt-resume: 任何 CLI 命令进入前，扫一次 in_progress codex job 终态。
    // hasActiveCodexReview short-circuit — 无 codex review 时立即返回不打开 state 文件。
    try {
      const scanPid = pid || detectProjectId(projectRoot)
      if (scanPid) {
        const { scanCodexJobsForResume } = require('./codex_review_runner')
        const { readState, writeState } = require('./state_manager')
        const workflowDir = getWorkflowsDir(scanPid)
        if (workflowDir) {
          const statePath = require('path').join(workflowDir, 'workflow-state.json')
          if (fs.existsSync(statePath)) {
            const state = readState(statePath, scanPid)
            const scanResult = scanCodexJobsForResume(state, { projectRoot })
            if (!scanResult.short_circuit && (scanResult.resumed > 0 || scanResult.expired > 0)) {
              writeState(statePath, state, scanPid)
            }
          }
        }
      }
    } catch {}

    if (command === 'help') {
      process.stdout.write(renderSubcommandHelp(args[0]))
      return
    }

    if (command === 'execute' || command === 'continue') {
      const intent = args[0] && !args[0].startsWith('--') ? args[0] : null
      const mode = option(args, '--mode')
      const root = projectRoot ? path.resolve(projectRoot) : process.cwd()
      const normalizedMode = mode || (intent && EXECUTION_MODE_ALIASES[intent]) || intent
      result = buildExecuteEntry(command, intent, normalizedMode, root, { force: args.includes('--force'), tdd: args.includes('--tdd') })
    } else if (command === 'next') {
      result = cmdNext(pid, projectRoot)
    } else if (command === 'plan' || command === 'start') {
      const requirement = args[0]
      result = cmdPlan(requirement, args.includes('--force') || args.includes('-f'), args.includes('--no-discuss'), pid, projectRoot, option(args, '--spec-choice', null), option(args, '--task-name', null))
    } else if (command === 'plan-review') {
      result = cmdPlanReview(pid, projectRoot)
    } else if (command === 'plan-edit') {
      result = cmdPlanEdit({
        anchor: option(args, '--anchor', null),
        mode: option(args, '--mode', 'replace_between'),
        contentFile: option(args, '--content-file', null),
        allowLegacy: args.includes('--allow-legacy'),
        allowAnchorChange: args.includes('--allow-anchor-change'),
        projectId: pid,
        projectRoot,
      })
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
        process.stderr.write(`Unknown delta subcommand: ${deltaSubcommand}. Use init|impact|apply|fail|sync.\n`)
        process.exitCode = 1
        return
      }
    } else if (command === 'archive') {
      result = cmdArchive(args.includes('--summary'), pid, projectRoot)
    } else if (command === 'unblock') {
      result = cmdUnblock(args[0], pid, projectRoot)
    } else if (command === 'accept-deviation') {
      // T8 偏离决策闭环。需要 --confirmed 显式确认（hard stop）。
      result = cmdAcceptDeviation({
        originalIntent: option(args, '--original-intent'),
        acceptedImplementation: option(args, '--accepted-impl'),
        specSection: option(args, '--spec-section'),
        requiresSpecReview: !args.includes('--no-spec-review'),
        confirmed: args.includes('--confirmed'),
      }, pid, projectRoot)
    } else if (command === 'advance') {
      if (args.includes('--review-passed')) {
        result = cmdReviewAdvance('passed', null, pid, projectRoot)
      } else if (args.includes('--review-failed')) {
        result = cmdReviewAdvance('failed', splitCsv(option(args, '--failed-tasks', '')), pid, projectRoot)
      } else {
        result = cmdAdvance(args[0], option(args, '--journal'), splitCsv(option(args, '--decisions', '')), pid, projectRoot, { full: args.includes('--full') })
      }
    } else if (command === 'resume-from-governance-halt') {
      result = cmdResumeFromGovernanceHalt(pid, projectRoot)
      if (result && result.error) process.exitCode = 1
    } else if (command === 'set-report-path') {
      const unset = args.includes('--unset')
      const reportPath = optionOrArg(args, '--path')
      result = cmdSetReportPath(reportPath, pid, projectRoot, { unset })
      if (result && result.error) process.exitCode = 1
    } else if (command === 'set-contract-digest-path') {
      const unset = args.includes('--unset')
      const digestPath = optionOrArg(args, '--path')
      result = cmdSetContractDigestPath(digestPath, pid, projectRoot, { unset })
      if (result && result.error) process.exitCode = 1
    } else if (command === 'write-handoff') {
      result = cmdWriteHandoff({
        fromPhase: option(args, '--from'),
        toPhase: option(args, '--to'),
        contentFile: option(args, '--content-file'),
        projectId: pid,
        projectRoot,
      })
      if (result && result.error) process.exitCode = 1
    } else if (command === 'read-handoff') {
      // C-4：fresh:false（stale/missing）属正常回退，绝不置 exitCode。
      result = cmdReadHandoff({
        from: option(args, '--from'),
        projectId: pid,
        projectRoot,
      })
    } else if (command === 'context') {
      result = cmdContext(pid, projectRoot)
    } else if (command === 'task-bundle') {
      const taskId = args.find((arg) => !String(arg).startsWith('--'))
      if (!taskId) {
        result = { error: 'task_id 必填' }
        process.exitCode = 1
      } else {
        const resolvedPid = pid || detectProjectId(projectRoot)
        result = buildTaskBundle(taskId, {
          projectId: resolvedPid,
          projectRoot,
          statePath: option(args, '--state'),
        })
        if (result && result.error) process.exitCode = 1
      }
    } else if (command === 'verify-readiness') {
      const root = detectProjectRoot(projectRoot)
      const { loadProjectConfig } = require('./project_setup')
      const projectConfig = loadProjectConfig(root) || {}
      const workflowConfig = projectConfig.workflow || {}
      const checkNames = Array.isArray(workflowConfig.readiness) ? workflowConfig.readiness : []
      const readinessOptions = (workflowConfig.readinessOptions && typeof workflowConfig.readinessOptions === 'object')
        ? workflowConfig.readinessOptions
        : {}
      try {
        result = runReadiness(checkNames, root, readinessOptions)
      } catch (readinessError) {
        if (readinessError && readinessError.code === 'CHECK_NOT_REGISTERED') {
          result = { error: 'readiness check not registered', check: readinessError.check }
          process.exitCode = 1
        } else {
          throw readinessError
        }
      }
    } else if (command === 'status') {
      result = cmdStatus(pid, projectRoot)
    } else if (command === 'list') {
      result = cmdList(pid, projectRoot)
    } else if (command === 'progress') {
      result = cmdProgress(pid, projectRoot)
    } else if (command === 'budget') {
      result = cmdContextBudget(pid, projectRoot)
    } else if (command === 'triage') {
      const jobId = option(args, '--result')
      const strict = args.includes('--strict')
      const jobResult = loadCodexJobResult(jobId, projectRoot)
      if (jobResult.error) {
        result = jobResult
        process.exitCode = 1
      } else {
        const root = detectProjectRoot(projectRoot)
        const { loadProjectConfig } = require('./project_setup')
        const projectConfig = loadProjectConfig(root)
        result = evaluateTriage(jobResult.touchedFiles, projectConfig)
        if (strict && result.out_of_scope.length) process.exitCode = 1
      }
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
      process.stderr.write('Usage: node workflow_cli.js [--project-id ID] [--project-root DIR] <plan|plan-review|plan-edit|execute|continue|init|spec-review|delta|archive|unblock|advance|resume-from-governance-halt|set-report-path|set-contract-digest-path|write-handoff|context|task-bundle|verify-readiness|status|list|progress|budget|triage|journal|help> ...\n  plan (alias: start) - 启动规划流程\n  plan-review - 跑 lint + 算 confidence + 输出 ready 矩阵 JSON\n  plan-edit --anchor <id> --content-file <path> [--mode replace_between|replace_full] [--allow-legacy] [--allow-anchor-change] - v2 plan 锚点 section 级替换\n  init - 状态文件自愈（执行阶段缺失时自动创建）\n  help <advance|delta|journal> - 查看复合子命令参数签名\n  resume-from-governance-halt - 清治理 halt（status=halted && halt_reason=governance）→ running，避免 controller 手编 state.json\n  set-report-path <path> [--unset] - 写 state.review_report_path，避免 controller 手编 state.json 触发全文件重注入\n  set-contract-digest-path --path <path> [--unset] - 写 state.contract_digest_path，避免 controller 手编 state.json 触发全文件重注入\n  write-handoff --from <phase> --to <phase> --content-file <path> - 落 handoff/{from-phase}.md（5 行 freshness header + ≤20 行正文，不入 state schema，覆盖式写）\n  read-handoff --from <phase> - 读 handoff/{from-phase}.md，header 比对当前 state → {fresh,content} 或 {fresh:false,reason:stale|missing,fallback:read-full}（回退非错误，不置 exitCode）\n  triage --result <jobId> [--strict] - 分诊 codex job 触达文件，--strict 时 out_of_scope 非空 → exit 1\n  task-bundle <taskId> [--state <path>] - 提取单个 task 的结构化执行 bundle（task_text + AC + constraints + patterns + mandatory-reading + verification）\n  verify-readiness - 读 project-config workflow.readiness 声明式预检（未声明则 ready:true）\n')
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
  cmdResumeFromGovernanceHalt,
  cmdSetReportPath,
  cmdSetContractDigestPath,
  cmdWriteHandoff,
  cmdReadHandoff,
  cmdReviewAdvance,
  inferSpecRelativeFromPlan,
}

if (require.main === module) main()
