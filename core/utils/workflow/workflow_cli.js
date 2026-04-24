#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { readState, writeState, completeWorkflow } = require('./state_manager')
const { getWorkflowStatePath, getWorkflowsDir } = require('./path_utils')
const {
  cmdComplete,
  cmdCompleteBatch,
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
const { cmdArchive, cmdDelta, cmdDeltaInit, cmdDeltaImpact, cmdDeltaApply, cmdDeltaFail, cmdDeltaSync, cmdSpecReview, cmdPlan, cmdUnblock, recoverArchiveTombstone, planLegacyProjectIdMigration, applyLegacyProjectIdMigration } = require('./lifecycle_cmds')
const { buildExecuteEntry } = require('./execution_sequencer')
const { countTasks, parseTasksV2, summarizeTaskProgress } = require('./task_parser')
const { cmdAdd, cmdGet, cmdList: cmdJournalList, cmdSearch } = require('./journal')
const { LEGACY_STATUS_TO_HALT_REASON, buildMinimumState, buildUserSpecReview, ensureStateDefaults } = require('./workflow_types')
const os = require('os')
const { buildBatchPassGateResult, writeBatchQualityGateResult } = require('./quality_review')
const { finishBatch, getBatchRecord, setBatchReviewGroup, failWritableBatch } = require('./batch_orchestrator')
const {
  getRepoRoot,
  getIntegrationWorktreeDir,
  finalMergeToMain,
  discardIntegrationWorktree,
} = require('./merge_strategist')

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
      journalResult = cmdAdd(
        pid,
        `完成 ${label}${nextId ? ` → ${nextId}` : ''}`,
        pid,
        Array.isArray(completedTaskIds) ? completedTaskIds : [completedTaskIds],
        journalSummary,
        decisions || [],
        nextId ? [`下一任务: ${nextId}`] : []
      )
    }
  }

  return { nextTask, workflowStatus: state ? state.status : null, journalResult }
}

function cmdAdvance(taskId, journalSummary = null, decisions = null, projectId = null, projectRoot = null) {
  const completeResult = cmdComplete(taskId, projectId, projectRoot)
  if (completeResult.error) return completeResult
  const { nextTask, workflowStatus, journalResult } = advanceAfterComplete(taskId, journalSummary, decisions, projectId, projectRoot)
  const result = {
    advanced: true,
    completed_task: taskId,
    next_task: nextTask,
    workflow_status: workflowStatus,
  }
  if (journalResult) result.journal = journalResult
  return result
}

function collectBatchGateInputs(state, taskIds, tasksContent) {
  const tasks = tasksContent ? parseTasksV2(tasksContent) : []
  const taskMap = new Map(tasks.map((task) => [task.id, task]))
  const requirementIds = new Set()
  const criticalConstraints = new Set()
  const perTaskStage1 = {}

  const missingStage1 = []
  const failedStage1 = []
  for (const taskId of taskIds) {
    const task = taskMap.get(taskId)
    for (const requirementId of task?.requirement_ids || []) requirementIds.add(requirementId)
    for (const constraint of task?.critical_constraints || []) criticalConstraints.add(constraint)

    const gate = ((state || {}).quality_gates || {})[taskId] || {}
    const stage1 = gate.stage1
    const hasStage1 = stage1 && typeof stage1 === 'object'
    const stage1Passed = hasStage1 && stage1.passed === true
    if (!hasStage1) missingStage1.push(taskId)
    else if (!stage1Passed) failedStage1.push(taskId)
    perTaskStage1[taskId] = {
      passed: stage1Passed,
      attempts: Math.max(1, Number((stage1 && stage1.attempts) || gate.attempt || 1)),
      issues_found: Math.max(0, Number((stage1 && stage1.issues_found) || 0)),
    }
  }

  return {
    requirementIds: [...requirementIds],
    criticalConstraints: [...criticalConstraints],
    perTaskStage1,
    missingStage1,
    failedStage1,
  }
}

function cmdAdvanceBatch(taskIds, journalSummary = null, decisions = null, projectId = null, projectRoot = null, batchId = null, batchMeta = {}) {
  const [stateBeforeComplete, statePathBeforeComplete, tasksContentBeforeComplete] = resolveStateAndTasks(projectId, projectRoot)
  let batchRecord = null
  const effectiveMeta = { ...(batchMeta || {}) }
  const gitActions = []

  if (batchId && stateBeforeComplete) {
    batchRecord = getBatchRecord(stateBeforeComplete, batchId)
    if (!batchRecord) return { error: `并行批次不存在: ${batchId}` }
    if (batchRecord.kind === 'writable') {
      if (batchRecord.status === 'completed' && batchRecord.merge_state === 'completed') {
        return {
          advanced: true,
          completed_tasks: [...taskIds],
          next_task: null,
          workflow_status: stateBeforeComplete.status || null,
          batch_id: batchId,
          idempotent: true,
          merged_commit: batchRecord.diff_window?.to_commit || null,
        }
      }
      if (effectiveMeta.stage2_passed !== true) return { error: `writable 批次 ${batchId} 尚未通过 stage2 审查，禁止推进完成` }

      const preCheck = collectBatchGateInputs(stateBeforeComplete, taskIds, tasksContentBeforeComplete || '')
      if (preCheck.missingStage1.length) {
        return { error: `writable 批次 ${batchId} 存在缺失 stage1 记录的任务：${preCheck.missingStage1.join(', ')}`, batch_id: batchId }
      }
      if (preCheck.failedStage1.length) {
        return { error: `writable 批次 ${batchId} 存在 stage1 未通过的任务：${preCheck.failedStage1.join(', ')}`, batch_id: batchId }
      }

      // Git 侧合并先于状态登记：merged_commit 缺失时尝试内部 finalMergeToMain
      if (!effectiveMeta.merged_commit) {
        if (batchRecord.merge_state === 'merged_awaiting_state' && batchRecord.merge_commit) {
          // 上次合并成功但后续 state 写入失败；复用已登记的 merge_commit，跳过二次 git merge
          effectiveMeta.base_commit = effectiveMeta.base_commit || batchRecord.merge_base || null
          effectiveMeta.merged_commit = batchRecord.merge_commit
          gitActions.push({ action: 'reuse_merge_intent', batch_id: batchId, merge_commit: batchRecord.merge_commit })
        } else {
          const root = projectRoot || process.cwd()
          const repoRoot = getRepoRoot(root)
          if (!repoRoot) return { error: '不在 git 仓库中，无法执行 integration merge', batch_id: batchId }
          const effectiveProjectId = projectId || detectProjectId(projectRoot) || stateBeforeComplete.project_id || null
          let integrationPath
          try { integrationPath = getIntegrationWorktreeDir(repoRoot, batchId, effectiveProjectId) }
          catch (err) { return { error: `解析 integration worktree 失败: ${err.message}`, batch_id: batchId } }

          // Pre-merge intent：记录"正在合并"，落盘后再执行 git 操作
          batchRecord.merge_state = 'merging'
          batchRecord.merge_started_at = new Date().toISOString()
          batchRecord.merge_base = stateBeforeComplete.initial_head_commit || null
          writeState(statePathBeforeComplete, stateBeforeComplete, effectiveProjectId)

          const mergeResult = finalMergeToMain(repoRoot, integrationPath, batchId, effectiveProjectId, batchRecord.merge_base || null)
          gitActions.push({ action: 'final_merge_to_main', result: mergeResult })
          if (mergeResult.error) {
            // 合并失败：清理 merge_state，避免后续被误判为 merged_awaiting_state
            batchRecord.merge_state = 'failed'
            writeState(statePathBeforeComplete, stateBeforeComplete, effectiveProjectId)
            return {
              error: `integration worktree 合并到主分支失败: ${mergeResult.error}`,
              batch_id: batchId,
              git_actions: gitActions,
            }
          }
          effectiveMeta.base_commit = effectiveMeta.base_commit || mergeResult.main_head_before || stateBeforeComplete.initial_head_commit || null
          effectiveMeta.merged_commit = mergeResult.main_head_after || mergeResult.integration_commit

          // Post-merge intent：main 已前进；若后续 state 写入失败，可据此恢复
          batchRecord.merge_state = 'merged_awaiting_state'
          batchRecord.merge_commit = effectiveMeta.merged_commit
          batchRecord.merge_base = effectiveMeta.base_commit
          writeState(statePathBeforeComplete, stateBeforeComplete, effectiveProjectId)
        }
      }
      if (!effectiveMeta.merged_commit) return { error: `writable 批次 ${batchId} 缺少 merged_commit，禁止推进完成` }
    }
  }

  const completeResult = cmdCompleteBatch(taskIds, projectId, projectRoot)
  if (completeResult.error) return completeResult

  if (batchId) {
    const [state, statePath] = resolveStateAndTasks(projectId, projectRoot)
    if (state && statePath) {
      const diffWindow = effectiveMeta.merged_commit
        ? {
          from_commit: effectiveMeta.base_commit || state.initial_head_commit || null,
          to_commit: effectiveMeta.merged_commit,
          files_changed: Math.max(0, Number(effectiveMeta.files_changed || 0)),
        }
        : null
      if (batchRecord?.kind === 'writable' && effectiveMeta.stage2_passed === true) {
        const gateInputs = collectBatchGateInputs(stateBeforeComplete || state, taskIds, tasksContentBeforeComplete || '')
        const gateResult = buildBatchPassGateResult(
          batchId,
          taskIds,
          effectiveMeta.base_commit || state.initial_head_commit || null,
          effectiveMeta.merged_commit,
          diffWindow ? diffWindow.files_changed : 0,
          gateInputs.requirementIds,
          gateInputs.criticalConstraints,
          gateInputs.perTaskStage1,
          Math.max(1, Number(effectiveMeta.stage2_attempts || 1)),
          Math.max(0, Number(effectiveMeta.critical_count || 0)),
          Math.max(0, Number(effectiveMeta.important_count || 0)),
          Math.max(0, Number(effectiveMeta.minor_count || 0)),
          effectiveMeta.reviewer || 'subagent'
        )
        const qualityGates = state.quality_gates || (state.quality_gates = {})
        qualityGates[batchId] = gateResult
        writeBatchQualityGateResult(statePath, batchId, gateResult, projectId || detectProjectId(projectRoot))
        setBatchReviewGroup(state, batchId, {
          quality_gate_id: effectiveMeta.quality_gate_id || batchId,
          stage2_passed: true,
        })
      }
      finishBatch(state, batchId, 'completed', diffWindow)
      const completedRecord = getBatchRecord(state, batchId)
      if (completedRecord && batchRecord?.kind === 'writable') {
        completedRecord.merge_state = 'completed'
        if (effectiveMeta.merged_commit) completedRecord.merge_commit = effectiveMeta.merged_commit
      }
      writeState(statePath, state)
    }
  }

  const { nextTask, workflowStatus, journalResult } = advanceAfterComplete(taskIds, journalSummary, decisions, projectId, projectRoot)
  const result = {
    advanced: true,
    completed_tasks: [...taskIds],
    next_task: nextTask,
    workflow_status: workflowStatus,
  }
  if (batchId) result.batch_id = batchId
  if (gitActions.length) result.git_actions = gitActions
  if (effectiveMeta.merged_commit) result.merged_commit = effectiveMeta.merged_commit
  if (journalResult) result.journal = journalResult
  return result
}

function cmdBatchFail(batchId, { nextAction = 'discard_integration_worktree', failedTaskId = null, reason = null, projectId = null, projectRoot = null } = {}) {
  const [state, statePath] = resolveStateAndTasks(projectId, projectRoot)
  if (!state || !statePath) return { error: '没有活跃的工作流' }
  const record = getBatchRecord(state, batchId)
  if (!record) return { error: `并行批次不存在: ${batchId}` }

  const gitActions = []
  const effectiveProjectId = projectId || detectProjectId(projectRoot) || state.project_id || null
  if (nextAction === 'discard_integration_worktree') {
    const root = projectRoot || process.cwd()
    const repoRoot = getRepoRoot(root) || root
    const discard = discardIntegrationWorktree(repoRoot, batchId, { forceDeleteBranch: true, projectId: effectiveProjectId })
    gitActions.push({ action: 'discard_integration_worktree', result: discard })
    // 即使存在 errors（例如 worktree 不存在）也继续推进状态清理，避免脏状态残留
  }

  const finalStatus = nextAction === 'discard_integration_worktree' ? 'discarded' : 'failed'
  failWritableBatch(state, statePath, batchId, finalStatus, projectId || detectProjectId(projectRoot))

  // 重新读取以补充 conflict_detected / failed_task_id 并清理 current_tasks
  const [afterState, afterPath] = resolveStateAndTasks(projectId, projectRoot)
  if (afterState && afterPath) {
    const updated = getBatchRecord(afterState, batchId)
    if (updated) {
      updated.conflict_detected = true
      if (failedTaskId) updated.failed_task_id = failedTaskId
      if (reason) updated.failure_reason = String(reason).slice(0, 500)
    }
    const taskSet = new Set(record.task_ids || [])
    afterState.current_tasks = (afterState.current_tasks || []).filter((id) => !taskSet.has(id))
    writeState(afterPath, afterState)
  }

  return {
    batch_failed: true,
    batch_id: batchId,
    status: finalStatus,
    next_action: nextAction,
    cleared_tasks: [...(record.task_ids || [])],
    git_actions: gitActions,
  }
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

// One-shot upgrader: rewrites legacy top-level {paused,blocked,failed,planning} into the new model.
// Backups go under <workflowDir>/.migrations/<ts>/. Active state files are migrated in place.
function cmdMigrateState(options = {}) {
  const root = path.join(os.homedir(), '.claude', 'workflows')
  if (!fs.existsSync(root)) return { migrated: 0, total: 0, root }
  const dryRun = Boolean(options.dryRun)
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  const results = []
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  for (const entry of entries) {
    const workflowDir = path.join(root, entry.name)
    const statePath = path.join(workflowDir, 'workflow-state.json')
    if (!fs.existsSync(statePath)) continue
    let state
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch { results.push({ project_id: entry.name, skipped: 'parse_error' }); continue }
    const originalStatus = state.status || null
    const reason = LEGACY_STATUS_TO_HALT_REASON[originalStatus] || null
    const planningRemap = originalStatus === 'planning'
    if (!reason && !planningRemap) {
      results.push({ project_id: entry.name, skipped: 'already_new', status: originalStatus })
      continue
    }
    if (dryRun) {
      results.push({ project_id: entry.name, would_migrate: originalStatus, target_status: reason ? 'halted' : 'spec_review' })
      continue
    }
    const backupDir = path.join(workflowDir, '.migrations', timestamp)
    fs.mkdirSync(backupDir, { recursive: true })
    fs.copyFileSync(statePath, path.join(backupDir, 'workflow-state.json'))
    if (reason) {
      state.status = 'halted'
      state.halt_reason = reason
    } else if (planningRemap) {
      state.status = 'spec_review'
      state.halt_reason = null
    }
    state.updated_at = new Date().toISOString()
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
    results.push({ project_id: entry.name, migrated_from: originalStatus, migrated_to: state.status, halt_reason: state.halt_reason || null, backup_dir: backupDir })
  }
  const migrated = results.filter((r) => r.migrated_from || r.would_migrate).length
  return { migrated, total: results.length, root, dry_run: dryRun, results }
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

    // Recover from a crashed /workflow-archive before dispatching any command, so active-workflow
    // detection sees a clean root (either fully archived or fully reverted).
    try {
      const recoveryPid = pid || detectProjectId(projectRoot)
      if (recoveryPid) {
        const workflowDir = getWorkflowsDir(recoveryPid)
        if (workflowDir && fs.existsSync(workflowDir)) recoverArchiveTombstone(workflowDir)
      }
    } catch {}

    if (command === 'execute' || command === 'continue') {
      const intent = args[0] && !args[0].startsWith('--') ? args[0] : null
      const mode = option(args, '--mode')
      const root = projectRoot ? path.resolve(projectRoot) : process.cwd()
      const normalizedMode = mode || (intent && EXECUTION_MODE_ALIASES[intent]) || intent
      result = buildExecuteEntry(command, intent, normalizedMode, root, { force: args.includes('--force') })
      const parallelFlag = option(args, '--parallel')
      if (args.includes('--no-parallel')) {
        result.parallel_override = { enabled: false, max_concurrency: 1 }
      } else if (parallelFlag) {
        result.parallel_override = { enabled: true, max_concurrency: Math.max(1, Number(parallelFlag) || 2) }
      }
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
    } else if (command === 'migrate-state') {
      result = cmdMigrateState({ dryRun: args.includes('--dry-run') })
    } else if (command === 'migrate-project-id') {
      const root = projectRoot ? path.resolve(projectRoot) : process.cwd()
      if (args.includes('--apply')) result = applyLegacyProjectIdMigration(root)
      else result = planLegacyProjectIdMigration(root)
    } else if (command === 'unblock') {
      result = cmdUnblock(args[0], pid, projectRoot)
    } else if (command === 'advance') {
      if (args.includes('--review-passed')) {
        result = cmdReviewAdvance('passed', null, pid, projectRoot)
      } else if (args.includes('--review-failed')) {
        result = cmdReviewAdvance('failed', splitCsv(option(args, '--failed-tasks', '')), pid, projectRoot)
      } else if (args.includes('--batch-fail')) {
        const batchId = option(args, '--batch-id', null)
        if (!batchId) {
          result = { error: 'advance --batch-fail 需要 --batch-id' }
        } else {
          result = cmdBatchFail(batchId, {
            nextAction: option(args, '--next-action', 'discard_integration_worktree'),
            failedTaskId: option(args, '--failed-task', null),
            reason: option(args, '--reason', null),
            projectId: pid,
            projectRoot,
          })
        }
      } else if (args.includes('--batch')) {
        const batchTaskIds = splitCsv(option(args, '--batch'))
        const batchId = option(args, '--batch-id', null)
        result = cmdAdvanceBatch(
          batchTaskIds,
          option(args, '--journal'),
          splitCsv(option(args, '--decisions', '')),
          pid,
          projectRoot,
          batchId,
          {
            base_commit: option(args, '--base-commit', null),
            merged_commit: option(args, '--merged-commit', null),
            files_changed: option(args, '--files-changed', 0),
            quality_gate_id: option(args, '--quality-gate-id', null),
            stage2_passed: args.includes('--stage2-passed'),
            stage2_attempts: option(args, '--stage2-attempts', 1),
            critical_count: option(args, '--critical-count', 0),
            important_count: option(args, '--important-count', 0),
            minor_count: option(args, '--minor-count', 0),
            reviewer: option(args, '--reviewer', null),
          }
        )
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
      process.stderr.write('Usage: node workflow_cli.js [--project-id ID] [--project-root DIR] <plan|execute|continue|init|spec-review|delta|archive|unblock|advance|context|status|list|progress|parallel|budget|journal|migrate-state|migrate-project-id> ...\n  plan (alias: start) - 启动规划流程\n  init - 状态文件自愈（执行阶段缺失时自动创建）\n  migrate-state - 一次性升级 legacy 状态到 halted+halt_reason（可 --dry-run）\n  migrate-project-id - 检测并迁移 legacy 纯 hex projectId（默认 dry-run，--apply 执行）\n')
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
  cmdAdvanceBatch,
  cmdBatchFail,
  cmdContext,
  cmdInit,
  cmdReviewAdvance,
}

if (require.main === module) main()
