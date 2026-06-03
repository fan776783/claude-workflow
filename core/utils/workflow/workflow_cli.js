#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { readState, writeState, completeWorkflow } = require('./state_manager')
const { getWorkflowStatePath, getWorkflowsDir, getHandoffPath } = require('./path_utils')
const {
  cmdComplete,
  cmdContextBudget,
  cmdFail,
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
const { createTaskSource } = require('./task_source')
const taskStore = require('./task_store')
const { cmdAdd, cmdGet, cmdList: cmdJournalList, cmdSearch } = require('./journal')
const { buildMinimumState, buildUserSpecReview, ensureStateDefaults } = require('./workflow_types')
const { evaluateTriage, loadCodexJobResult } = require('./triage_rules')
const { buildTaskBundle } = require('./task_bundle')
const { renderTaskMd } = require('./task_md_render')
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

  // task 源 = task-dir：state.json 丢失但 task-dir 在 → 从 task-dir 重建（plan.md 已退化为叙述，
  // parseTasksV2 解不出结构化 task）。仅当 task-dir 空时回退解析存量 legacy plan.md（C-7）。
  let inferred
  const dirRecords = taskStore.listTasks(pid)
  if (dirRecords.length) {
    const progress = { completed: [], skipped: [], failed: [], blocked: [] }
    for (const record of dirRecords) {
      if (record.status === 'completed') progress.completed.push(record.id)
      else if (record.status === 'skipped') progress.skipped.push(record.id)
      else if (record.status === 'failed') progress.failed.push(record.id)
      // F-04：blocked 状态在 state.json 丢失后无处可取（仅活在 progress.blocked）。
      // 用 task.json 持久字段 blocked_by 作恢复信号——非空即视为 blocked（state.unblocked 已随 state.json 丢失，
      // 保守按未解除处理：宁可重新 halt 等用户 unblock，也不放行可能仍被阻塞的 task）。defensive 兼顾 status==='blocked'。
      // 注意只看 blocked_by（外部依赖键），不看 depends（task 间顺序依赖，属正常排程，不构成 halt）。
      else if (record.status === 'blocked' || (Array.isArray(record.blocked_by) && record.blocked_by.length)) progress.blocked.push(record.id)
    }
    const finished = new Set([...progress.completed, ...progress.skipped, ...progress.failed])
    const blockedSet = new Set(progress.blocked)
    const nextRecord = dirRecords.find((record) => !finished.has(record.id) && !blockedSet.has(record.id)) || null
    let workflowStatus
    let haltReason = null
    if (progress.failed.length) { workflowStatus = 'halted'; haltReason = 'failure' }
    else if (!nextRecord && progress.blocked.length) { workflowStatus = 'halted'; haltReason = 'dependency' }
    else if (!nextRecord) workflowStatus = 'completed'
    else if (progress.completed.length || progress.skipped.length) workflowStatus = 'running'
    else workflowStatus = 'planned'
    inferred = {
      progress,
      current_task_id: nextRecord ? nextRecord.id : (progress.failed[0] || progress.blocked[0] || null),
      workflow_status: workflowStatus,
      halt_reason: haltReason,
    }
  } else {
    if (!tasksContent) return { error: '未找到 task-dir 或 plan.md，无法推导首个任务' }
    const tasks = parseTasksV2(tasksContent)
    if (!tasks.length) return { error: '无法从 plan.md 解析任务（task-dir 也为空）' }
    inferred = summarizeTaskProgress(tasks)
  }

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
    let persistedByCompleteWorkflow = false
    if (nextTask && typeof nextTask === 'object') state.current_tasks = [nextTask.id]
    else if (typeof nextTask === 'string') state.current_tasks = [nextTask]
    else {
      state.current_tasks = []
      const progress = state.progress || {}
      const finishedCount = (progress.completed || []).length + (progress.skipped || []).length
      // task 源 = task-dir（plan.md 已退化为叙述，countTasks(plan.md) 恒 0）。total 从 TaskSource 取，
      // 否则末 task 完成后 totalTasks=0 → 完成门恒不触发，workflow 永远停在 running。
      const source = createTaskSource(state, { projectId, projectRoot, quiet: true })
      const totalTasks = source ? source.listTasks().length : (tasksContent ? countTasks(tasksContent) : 0)
      // 所有 task 完成 → execute Step 7 inline 末尾终审通过后直接 completed，无中间审查态。
      // completeWorkflow 内部已 writeState，避免外层再写一次造成终态双写。
      if (totalTasks > 0 && finishedCount >= totalTasks) {
        completeWorkflow(state, statePath, totalTasks)
        persistedByCompleteWorkflow = true
      }
    }
    if (!persistedByCompleteWorkflow) writeState(statePath, state)
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

function cmdContext(projectId = null, projectRoot = null) {
  const pid = projectId || detectProjectId(projectRoot)
  if (!pid) return { error: '无法检测项目 ID' }

  const result = { project_id: pid }
  const status = cmdStatus(pid, projectRoot)
  result.workflow = status
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

// --from-file <path|->：读路径或 stdin（-）。返回 {raw} 或 {error}。
function readFromFileArg(fromFile) {
  if (!fromFile) return { error: '--from-file 必填（文件路径，或 - 读 stdin）' }
  try {
    return { raw: fromFile === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(fromFile, 'utf8') }
  } catch (error) {
    return { error: `读取 --from-file 失败: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// task-write：从 JSON 文件/stdin 整集写 task-dir（包 taskStore.replaceAllTasks，tmp→rename 原子替换 + 清孤儿）。
// 输入 = task 记录数组，或 {tasks:[...]}。字段 = normalizeTaskRecord 11 项（见 task-dir-schema.md）。
// 这是 planner 写 task-dir 的唯一正路——禁止读 task_store.js 逆向 replaceAllTasks 自写 .cjs。
function cmdTaskWrite(fromFile, projectId, projectRoot) {
  const resolved = projectId || detectProjectId(projectRoot)
  if (!resolved) return { error: '无法检测项目 ID，请使用 --project-id 指定' }
  const fileRes = readFromFileArg(fromFile)
  if (fileRes.error) return fileRes
  let records
  try {
    const parsed = JSON.parse(fileRes.raw)
    records = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null)
  } catch (error) {
    return { error: `--from-file JSON 解析失败: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!Array.isArray(records)) return { error: '--from-file 内容须为 task 数组或 {tasks:[...]}' }
  if (!records.length) return { error: 'task 数组为空（至少一条）' }
  const seenIds = new Set()
  for (const record of records) {
    if (!record || !taskStore.isValidTaskId(String(record.id || ''))) {
      return { error: `非法 task id: ${record && record.id}（须 T<number>，如 T1）` }
    }
    const id = String(record.id)
    // 拒重复 id：replaceAllTasks 按 id 命名目录，重复 id 后者会静默覆盖前者、丢一个 task 且 count 误报。
    if (seenIds.has(id)) return { error: `重复 task id: ${id}（task-write 要求整集内每个 id 唯一）` }
    seenIds.add(id)
  }
  let written
  try {
    written = taskStore.replaceAllTasks(resolved, records)
  } catch (error) {
    return { error: `写入 task-dir 失败: ${error instanceof Error ? error.message : String(error)}` }
  }
  // 渲染 task.md（v2 人读正文，execute 逐字注入）：读回规范化记录再渲染，确保渲染源 = 落盘真相。
  // task.md 非关键产物（可重生），单条渲染失败不阻断整集写入。
  for (const id of written) {
    const rec = taskStore.readTask(resolved, id)
    if (!rec) continue
    try {
      taskStore.writeTaskMd(resolved, id, renderTaskMd(rec))
    } catch { /* task.md 渲染/落盘失败不致命：execute 期 readTaskMd 容错回退 '' */ }
  }
  return { written: true, project_id: resolved, task_ids: written, count: written.length }
}

// context-curate：从 JSONL 文件/stdin 写单 task 的 context.jsonl 背包（包 taskStore.curateContext，覆盖式）。
// 每行 {file,reason}；code 路径由 curateContext 内部过滤。execute 期 pre-execute-inject 展开为 <context-pack>。
function cmdContextCurate(taskId, fromFile, projectId, projectRoot) {
  const resolved = projectId || detectProjectId(projectRoot)
  if (!resolved) return { error: '无法检测项目 ID，请使用 --project-id 指定' }
  if (!taskId || !taskStore.isValidTaskId(String(taskId))) {
    return { error: `--id 须为合法 task id（T<number>），收到: ${taskId}` }
  }
  // task 必须已存在：curateContext 经 atomicWrite 会 mkdir 出 tasks/{id}/，给不存在的 id 写背包
  // 会造出无 task.json 的孤儿目录，事后被 plan-review lintTaskSchema 当 corruption 硬挡且难归因。
  if (!taskStore.readTask(resolved, String(taskId))) {
    return { error: `task ${taskId} 不存在：先用 task-write 写入 task 元数据，再 curate 背包` }
  }
  const fileRes = readFromFileArg(fromFile)
  if (fileRes.error) return fileRes
  const entries = []
  let skippedLines = 0
  for (const line of fileRes.raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      if (obj && typeof obj.file === 'string') entries.push({ file: obj.file, reason: obj.reason })
      else skippedLines += 1
    } catch {
      skippedLines += 1
    }
  }
  let entriesWritten
  try {
    entriesWritten = taskStore.curateContext(resolved, String(taskId), entries)
  } catch (error) {
    return { error: `写 context.jsonl 失败: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { written: true, project_id: resolved, task_id: String(taskId), entries_written: entriesWritten, input_entries: entries.length, skipped_lines: skippedLines }
}

const SUBCOMMAND_HELP = {
  advance: `advance - 标记任务完成并推进。

用法：
  advance <task-id> [--journal STR] [--decisions a,b,c] [--full]
    标记单任务完成。planned 状态下自动升为 running（返回 status_transition）。
    默认 next_task 仅返回 {id, name}。--full 返回完整 task 对象。
    v2 完整 task 切片来自 task-dir(task.json + task.md)；execute Step 1 持全量 task，无需 per-task task-bundle。
    task-bundle 仅用于 legacy plan.md workflow。
    末任务完成（无后续 task）→ 直接 completed（execute Step 7 inline 末尾终审通过后调用，无中间审查态）。
`,
  fail: `fail - 标记任务失败并 halt workflow。

用法：
  fail <task-id> --reason "<失败原因>"
    把 task 状态置 failed，workflow 入 halted/failure，current_tasks=[task-id]。
    验证失败 / reviewer schema failure / review-loop 失败的统一写入口。
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
  'plan-edit': `plan-edit - v2 plan 锚点 section 级替换（唯一写入口，保护 <!-- WF:ANCHOR --> 配对）。

用法：
  plan-edit --anchor <id> --content-file <path> [--mode replace_between|replace_full] [--allow-legacy] [--allow-anchor-change]
    --anchor <id>         必填。锚点 ID：tasks / file_structure / verification_summary / task:T<n>
    --content-file <path> 必填。替换内容文件（避免 shell 参数注入与 $& 展开；先写临时文件再传路径）
    --mode replace_between 默认。仅替换 begin/end 之间内容，保留锚点行
    --mode replace_full    连锚点行整段替换；须配 --allow-anchor-change
    --allow-legacy         v1 plan（无 version:2）整文件覆盖，失锚点保护；默认拒绝
`,
  'plan-review': `plan-review - 跑所有 lint + 算 confidence + 输出 ready 矩阵 JSON（无参数）。

返回 {ready, lints, coverage, confidence{score,level,breakdown,hints}, summary}。
  confidence.hints 列出每个未达标维度的可执行提升项 → 不必读 plan_composer.js 源码。
  lints.task_schema 列出 task.json 字段校验问题（缺 id / 非法 id / 类型错误 / empty_task_source 空源）→ 用 task-write 写入/重写修正。
`,
  'task-write': `task-write - 整集写 task-dir（planner 写机器 task 源的唯一正路，原子替换 + 清孤儿 + 渲染 task.md）。

用法：
  task-write --from-file <path.json | ->
    --from-file <path>  必填。JSON 文件路径，或 - 读 stdin。
    内容 = task 记录数组，或 {tasks:[...]}。字段（task.json v2，schema_version 写侧自动盖章 2）：
      id(必填 T<n>) name phase package target_layer depends[] blocked_by[] status acceptance[]
      verification{commands,expected_output,notes} interaction
      v2 rich（execute 护栏 / plan-review lint 直读）：files[] constraints[]
      patterns[]{file,line?,note} mandatory_reading[]{path,reason,symbols[],line_hint} task_text
    每条写入后自动从 task.json 渲染 task.md（execute 逐字注入正文）；不要手写 task.md，也不要把 rich 内容写进 plan.md 锚点。
    返回 {written, task_ids, count}。整集 tmp→rename 原子替换，旧 task-dir 不在新集合的自动清除。
  禁止读 core/utils/workflow/task_store.js 逆向 replaceAllTasks 自写 .cjs——本命令即正路。
`,
  'context-curate': `context-curate - 写单 task 的 context.jsonl 背包（覆盖式；execute 期注入 <context-pack>）。

用法：
  context-curate --id <Tn> --from-file <path.jsonl | ->
    --id <Tn>           必填。task id。
    --from-file <path>  必填。JSONL，每行 {file,reason}；- 读 stdin。
    仅 spec/research 路径——code 扩展名行被自动丢弃（背包不承载源码，implementer 执行期自读）。
    返回 {entries_written, input_entries, skipped_lines}。
`,
  'write-handoff': `write-handoff - 落 handoff/{from-phase}.md（5 行 freshness header + ≤20 行正文，覆盖式写）。

用法：
  write-handoff --from <phase> --to <phase> --content-file <path>
    --content-file 内容先写临时文件再传路径（同 plan-edit，避免 shell 注入）。
`,
  'read-handoff': `read-handoff - 读 handoff/{from-phase}.md，header 比对当前 state。

用法：
  read-handoff --from <phase>
    返回 {fresh, content} 或 {fresh:false, reason:stale|missing, fallback:read-full}（回退非错误）。
`,
  'spec-review': `spec-review - 归一化 spec 审批选择并推进状态。

用法：
  spec-review --choice "<归一化选择>"
    choice 必须先归一化为契约字符串之一（见 workflow-cli.md），禁止塞用户原话。
`,
}

const TOP_LEVEL_USAGE = `Usage: node workflow_cli.js [--project-id ID] [--project-root DIR] <plan|plan-review|plan-edit|task-write|context-curate|execute|continue|init|spec-review|delta|archive|unblock|advance|fail|set-contract-digest-path|write-handoff|context|task-bundle|verify-readiness|status|list|progress|budget|triage|journal|help> ...
  任意子命令加 --help / -h 打印该命令用法（如 plan-edit --help）。
  plan (alias: start) - 启动规划流程
  plan-review - 跑 lint + 算 confidence + 输出 ready 矩阵 JSON
  plan-edit --anchor <id> --content-file <path> [--mode replace_between|replace_full] [--allow-legacy] [--allow-anchor-change] - v2 plan 锚点 section 级替换
  task-write --from-file <path.json|-> - 整集写 task-dir v2（含 files/constraints/patterns/mandatory_reading/task_text；自动渲染 task.md；原子替换 + 清孤儿；禁逆向 task_store.js）
  context-curate --id <Tn> --from-file <path.jsonl|-> - 写单 task 的 context.jsonl 背包（覆盖式，仅 spec/research 路径）
  init - 状态文件自愈（执行阶段缺失时自动创建）
  help <advance|delta|journal|plan-edit|...> - 查看子命令参数签名
  set-contract-digest-path --path <path> [--unset] - 写 state.contract_digest_path，避免 controller 手编 state.json 触发全文件重注入
  write-handoff --from <phase> --to <phase> --content-file <path> - 落 handoff/{from-phase}.md（5 行 freshness header + ≤20 行正文，不入 state schema，覆盖式写）
  read-handoff --from <phase> - 读 handoff/{from-phase}.md，header 比对当前 state → {fresh,content} 或 {fresh:false,reason:stale|missing,fallback:read-full}（回退非错误，不置 exitCode）
  triage --result <jobId> [--strict] - 分诊 codex job 触达文件，--strict 时 out_of_scope 非空 → exit 1
  fail <task-id> --reason <msg> - 标记任务失败 → workflow 入 halted/failure（验证失败 / reviewer schema failure / review-loop 统一写入口）
  task-bundle <taskId> [--state <path>] - 【legacy，仅 plan.md workflow】提取单 task 执行 bundle；v2 task-dir workflow 改从 task-dir(task.json+task.md)取，返回 legacy 提示不参与
  verify-readiness - 读 project-config workflow.readiness 声明式预检（未声明则 ready:true）
`

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

// 在 parseArgs 之前解析 --help/-h：parseArgs 会对 leading `--help` 抛 Unknown flag,顶层 help 必须前置。
// 严格按位置识别,只认两个槽位,避免劫持位置参数的值或尾随 flag:
//   1) command 位本身是 --help/-h（含无 command 直接 `--help`）→ 顶层 help
//   2) command 紧跟的 token 是 --help/-h（如 `plan-edit --help`）→ 该子命令 help
// 反例(全部按正常命令执行,不劫持)：
//   `advance T1 --help`（T1 是位置参数,--help 尾随）、`journal search --help`（search 后 --help 是查询词）、
//   `set-contract-digest-path /p --help`、`set-contract-digest-path --path --help`（--help 是 --path 的值）。
// 返回 null = 非 help 请求,交给 parseArgs 正常解析。
function resolveHelpRequest(argv) {
  // 跳过 leading --project-id/--project-root 及其值,定位 command 槽位
  let i = 0
  while (i < argv.length && (argv[i] === '--project-id' || argv[i] === '--project-root')) i += 2
  const cmdTok = argv[i]
  // 槽位 1：command 位即 --help/-h → 顶层 help
  if (cmdTok === '--help' || cmdTok === '-h') return { command: null }
  // 无 command,或 command 位是其它 flag → 非 help 请求
  if (!cmdTok || cmdTok.startsWith('-')) return null
  // 槽位 2：command 紧跟 --help/-h → 子命令 help
  const next = argv[i + 1]
  if (next === '--help' || next === '-h') return { command: cmdTok }
  return null
}

function main() {
  try {
    // Global --help / -h: print the command's usage (or top-level) and exit before any state I/O.
    // 子命令缺参不再让调用方 grep 源码反推接口；plan-edit --help 等直接给签名。
    const helpRequest = resolveHelpRequest(process.argv.slice(2))
    if (helpRequest) {
      process.stdout.write((helpRequest.command && SUBCOMMAND_HELP[helpRequest.command]) || TOP_LEVEL_USAGE)
      return
    }

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
      result = cmdAdvance(args[0], option(args, '--journal'), splitCsv(option(args, '--decisions', '')), pid, projectRoot, { full: args.includes('--full') })
    } else if (command === 'fail') {
      // 验证失败 / reviewer schema failure / review-loop 失败的统一写入口（代理 task_manager.cmdFail）。
      result = cmdFail(args[0], option(args, '--reason'), pid, projectRoot)
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
    } else if (command === 'task-write') {
      result = cmdTaskWrite(option(args, '--from-file'), pid, projectRoot)
      if (result && result.error) process.exitCode = 1
    } else if (command === 'context-curate') {
      result = cmdContextCurate(option(args, '--id'), option(args, '--from-file'), pid, projectRoot)
      if (result && result.error) process.exitCode = 1
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
      process.stderr.write(TOP_LEVEL_USAGE)
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
  cmdSetContractDigestPath,
  cmdWriteHandoff,
  cmdReadHandoff,
  cmdTaskWrite,
  cmdContextCurate,
  inferSpecRelativeFromPlan,
  resolveHelpRequest,
}

if (require.main === module) main()
