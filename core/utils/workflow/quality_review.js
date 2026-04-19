#!/usr/bin/env node

const { spawnSync } = require('child_process')
const { readState, resolveStatePath, writeState } = require('./state_manager')
const { createEvidence } = require('./verification')
const { assertCanonicalWorkflowStatePath, detectProjectIdFromRoot } = require('./path_utils')
const { ensureStateDefaults, getReviewResult } = require('./workflow_types')
const { buildInjectedContext, buildAgentPrompt, classifyRoleSignals, resolveRoleProfile } = require('./role_injection')

const GATE_BUDGET = {
  max_total_loops: 4,
  max_diff_context_chars: 50000,
  cache_stage1: true,
}

function isoNow() {
  return new Date().toISOString()
}

function createReviewSubject(baseCommit, requirementIds = [], criticalConstraints = []) {
  const ref = baseCommit ? `${baseCommit}..HEAD` : 'HEAD'
  return {
    kind: 'diff_window',
    ref,
    requirement_ids: requirementIds,
    critical_constraints: criticalConstraints,
  }
}

function createDiffWindow(baseCommit, fromTask = null, toTask = null, filesChanged = 0) {
  return {
    base_commit: baseCommit,
    from_task: fromTask,
    to_task: toTask,
    files_changed: filesChanged,
  }
}

function getGitHead(projectRoot = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0) return null
  const commit = String(result.stdout || '').trim()
  return commit || null
}

function getPassedQualityGates(state = {}) {
  const reviewedAt = (gate) => {
    const value = gate?.reviewed_at || gate?.stage2?.completed_at || gate?.stage1?.completed_at
    const timestamp = value ? Date.parse(value) : Number.NaN
    return Number.isNaN(timestamp) ? 0 : timestamp
  }
  return Object.entries((state || {}).quality_gates || {})
    .filter(([, gate]) => gate && gate.overall_passed === true)
    .sort((left, right) => reviewedAt(right[1]) - reviewedAt(left[1]))
}

function resolveReviewBaseline(state = {}, projectRoot = process.cwd()) {
  const normalized = ensureStateDefaults(state)
  const [latestPassedGateId, latestPassedGate] = getPassedQualityGates(normalized)[0] || []
  if (latestPassedGate?.commit_hash) {
    return {
      base_commit: latestPassedGate.commit_hash,
      baseline_source: 'last_passed_gate',
      gate_task_id: latestPassedGateId,
    }
  }
  if (normalized.initial_head_commit) {
    return {
      base_commit: normalized.initial_head_commit,
      baseline_source: 'initial_head_commit',
      gate_task_id: null,
    }
  }
  return {
    base_commit: null,
    baseline_source: 'unavailable',
    gate_task_id: null,
  }
}

function buildBudgetSnapshot(state = {}, projectRoot = process.cwd()) {
  const baseline = resolveReviewBaseline(state, projectRoot)
  return {
    ...GATE_BUDGET,
    ...baseline,
    passed_gate_count: getPassedQualityGates(state).length,
  }
}

function resolveQualityReviewProfile(state = {}, requirementIds = [], criticalConstraints = [], diffWindow = null) {
  const normalized = ensureStateDefaults(state)
  const existing = (((normalized.context_injection || {}).execution) || {}).quality_review_stage2 || {}
  const signals = classifyRoleSignals('', [], null, {
    requirementIds,
    criticalConstraints,
    summary: requirementIds.join(' '),
    taskName: criticalConstraints.join(' '),
  })
  if (existing.profile || existing.role) {
    const profile = {
      ...resolveRoleProfile('quality_review_stage2', signals, normalized.collaboration || {}, normalized.sessions || {}),
      role: existing.role || resolveRoleProfile('quality_review_stage2', signals, normalized.collaboration || {}, normalized.sessions || {}).role,
      profile: existing.profile || resolveRoleProfile('quality_review_stage2', signals, normalized.collaboration || {}, normalized.sessions || {}).profile,
    }
    return {
      signals,
      profile,
      injectedContext: buildInjectedContext(
        createReviewSubject(diffWindow?.base_commit || 'HEAD', requirementIds, criticalConstraints),
        profile,
        signals,
        { diff_window: diffWindow }
      ),
    }
  }
  const profile = resolveRoleProfile('quality_review_stage2', signals, normalized.collaboration || {}, normalized.sessions || {})
  return {
    signals,
    profile,
    injectedContext: buildInjectedContext(
      createReviewSubject(diffWindow?.base_commit || 'HEAD', requirementIds, criticalConstraints),
      profile,
      signals,
      { diff_window: diffWindow }
    ),
  }
}

function createReviewerPrompt(state = {}, requirementIds = [], criticalConstraints = [], diffWindow = null) {
  const { profile, injectedContext } = resolveQualityReviewProfile(state, requirementIds, criticalConstraints, diffWindow)
  return {
    role: profile.role,
    profile: profile.profile,
    prompt: buildAgentPrompt(profile, injectedContext, ((state || {}).sessions || {}).platform || 'claude-code'),
    injected_context: injectedContext,
  }
}

function extractIssueCount(result) {
  if (!result) return 0
  let total = 0
  for (const key of ['missing', 'extra', 'misunderstandings', 'coverage_gaps', 'blocking_issues']) {
    if (Array.isArray(result[key])) total += result[key].length
  }
  if (result.issues && typeof result.issues === 'object') {
    for (const key of ['critical', 'important', 'minor']) {
      if (Array.isArray(result.issues[key])) total += result.issues[key].length
    }
  }
  return total
}

function collectBlockingIssues(result) {
  if (!result) return []
  if (Array.isArray(result.blocking_issues)) return result.blocking_issues
  const collected = []
  for (const key of ['missing', 'extra', 'misunderstandings', 'coverage_gaps']) {
    if (!Array.isArray(result[key])) continue
    for (const item of result[key]) collected.push(typeof item === 'object' ? item : { description: String(item) })
  }
  if (result.issues && typeof result.issues === 'object') {
    for (const level of ['critical', 'important']) {
      if (!Array.isArray(result.issues[level])) continue
      for (const item of result.issues[level]) collected.push(typeof item === 'object' ? item : { description: String(item), severity: level })
    }
  }
  return collected
}

function buildPassGateResult(taskId, baseCommit, currentCommit = null, fromTask = null, toTask = null, filesChanged = 0, requirementIds = [], criticalConstraints = [], stage1Attempts = 1, stage2Attempts = 1, stage1IssuesFound = 0, criticalCount = 0, importantCount = 0, minorCount = 0, reviewer = 'subagent', state = {}, stage2ReviewMode = 'single_reviewer', stage2CodexStatus = null, stage2ReviewCycleId = null) {
  const attempts = stage1Attempts + stage2Attempts
  const now = isoNow()
  const diffWindow = createDiffWindow(baseCommit, fromTask, toTask, filesChanged)
  const reviewerPrompt = createReviewerPrompt(state, requirementIds, criticalConstraints, diffWindow)
  return {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: taskId,
    subject: createReviewSubject(baseCommit, requirementIds, criticalConstraints),
    max_attempts: GATE_BUDGET.max_total_loops,
    attempt: attempts,
    last_decision: 'pass',
    next_action: 'continue_execution',
    commit_hash: currentCommit || baseCommit,
    diff_window: diffWindow,
    stage1: { passed: true, attempts: stage1Attempts, issues_found: stage1IssuesFound, completed_at: now },
    stage2: { passed: true, attempts: stage2Attempts, assessment: 'approved', critical_count: criticalCount, important_count: importantCount, minor_count: minorCount, completed_at: now, role: reviewerPrompt.role, profile: reviewerPrompt.profile, review_mode: stage2ReviewMode, codex_status: stage2CodexStatus, review_cycle_id: stage2ReviewCycleId, raw_results: null, merged: null },
    overall_passed: true,
    reviewed_at: now,
    reviewer,
    reviewer_prompt_preview: reviewerPrompt.prompt,
  }
}

function buildFailedGateResult(taskId, failedStage, baseCommit, currentCommit = null, fromTask = null, toTask = null, filesChanged = 0, requirementIds = [], criticalConstraints = [], stage1Attempts = 1, totalAttempts = 1, lastResult = null, reviewer = 'subagent', state = {}) {
  const budgetExhausted = totalAttempts >= GATE_BUDGET.max_total_loops
  const stage1Failed = failedStage === 'stage1' || failedStage === 'stage1_recheck'
  const stage2Failed = failedStage === 'stage2'
  const terminalDecision = budgetExhausted || stage2Failed ? 'rejected' : 'revise'
  const nextAction = terminalDecision === 'rejected' ? 'mark_task_failed_or_escalate' : 'fix_and_retry_or_escalate'
  const now = isoNow()
  const diffWindow = createDiffWindow(baseCommit, fromTask, toTask, filesChanged)
  const reviewerPrompt = createReviewerPrompt(state, requirementIds, criticalConstraints, diffWindow)
  const result = {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: taskId,
    subject: createReviewSubject(baseCommit, requirementIds, criticalConstraints),
    max_attempts: GATE_BUDGET.max_total_loops,
    attempt: totalAttempts,
    last_decision: terminalDecision,
    next_action: nextAction,
    blocking_issues: collectBlockingIssues(lastResult),
    reviewed_at: now,
    reviewer,
    reviewer_prompt_preview: reviewerPrompt.prompt,
    commit_hash: currentCommit || baseCommit,
    diff_window: diffWindow,
    stage1: { passed: !stage1Failed, attempts: stage1Attempts, issues_found: extractIssueCount(lastResult), completed_at: now },
    overall_passed: false,
  }
  if (stage2Failed) {
    const issues = typeof lastResult === 'object' && lastResult ? (lastResult.issues || {}) : {}
    result.stage2 = {
      passed: false,
      attempts: Math.max(totalAttempts - stage1Attempts, 0),
      assessment: (lastResult || {}).assessment || 'rejected',
      critical_count: (issues.critical || []).length,
      important_count: (issues.important || []).length,
      minor_count: (issues.minor || []).length,
      completed_at: now,
      role: reviewerPrompt.role,
      profile: reviewerPrompt.profile,
      review_mode: (lastResult || {}).review_mode || 'single_reviewer',
      codex_status: (lastResult || {}).codex_status || null,
      review_cycle_id: (lastResult || {}).review_cycle_id || null,
      raw_results: (lastResult || {}).raw_results || null,
      merged: (lastResult || {}).merged || null,
    }
  } else if (failedStage === 'stage1_recheck') {
    result.stage2 = {
      passed: true,
      attempts: Math.max(totalAttempts - stage1Attempts, 0),
      assessment: 'approved',
      critical_count: 0,
      important_count: 0,
      minor_count: 0,
      completed_at: now,
      role: reviewerPrompt.role,
      profile: reviewerPrompt.profile,
      review_mode: 'single_reviewer',
      codex_status: null,
      review_cycle_id: null,
      raw_results: null,
      merged: null,
    }
  }
  return result
}

function resolveBaseCommitForCommand(state = {}, projectRoot = process.cwd(), explicitBaseCommit = null) {
  if (explicitBaseCommit) {
    return {
      base_commit: explicitBaseCommit,
      baseline_source: 'explicit',
      gate_task_id: null,
    }
  }
  return resolveReviewBaseline(state, projectRoot)
}

function aggregateStage1(taskIds, perTaskStage1) {
  const entries = (taskIds || []).map((id) => perTaskStage1[id])
  const allPresent = entries.every(Boolean)
  const allPassed = allPresent && entries.length > 0 && entries.every((s) => s.passed)
  const totalAttempts = entries.reduce((sum, s) => sum + ((s || {}).attempts || 0), 0)
  const totalIssues = entries.reduce((sum, s) => sum + ((s || {}).issues_found || 0), 0)
  return { allPassed, totalAttempts, totalIssues }
}

function buildBatchPassGateResult(groupId, taskIds, baseCommit, mergedCommit, filesChanged = 0, requirementIds = [], criticalConstraints = [], perTaskStage1 = {}, stage2Attempts = 1, criticalCount = 0, importantCount = 0, minorCount = 0, reviewer = 'subagent', state = {}) {
  const now = isoNow()
  const diffWindow = createDiffWindow(baseCommit, null, null, filesChanged)
  const { allPassed: allStage1Passed, totalAttempts: totalStage1Attempts, totalIssues: totalStage1Issues } = aggregateStage1(taskIds, perTaskStage1)
  return {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: groupId,
    scope: 'batch',
    batch_id: groupId,
    task_ids: [...taskIds],
    per_task_stage1: { ...perTaskStage1 },
    subject: createReviewSubject(baseCommit, requirementIds, criticalConstraints),
    max_attempts: GATE_BUDGET.max_total_loops,
    attempt: totalStage1Attempts + stage2Attempts,
    last_decision: 'pass',
    next_action: 'continue_execution',
    commit_hash: mergedCommit || baseCommit,
    diff_window: diffWindow,
    protected_requirement_ids: [...requirementIds],
    protected_constraints: [...criticalConstraints],
    stage1: { passed: allStage1Passed, attempts: totalStage1Attempts, issues_found: totalStage1Issues, completed_at: now },
    stage2: { passed: true, attempts: stage2Attempts, assessment: 'approved', critical_count: criticalCount, important_count: importantCount, minor_count: minorCount, completed_at: now },
    overall_passed: true,
    reviewed_at: now,
    reviewer,
  }
}

function buildBatchFailedGateResult(groupId, taskIds, failedStage, baseCommit, mergedCommit, filesChanged = 0, requirementIds = [], criticalConstraints = [], perTaskStage1 = {}, totalAttempts = 1, lastResult = null, reviewer = 'subagent') {
  const now = isoNow()
  const diffWindow = createDiffWindow(baseCommit, null, null, filesChanged)
  const { allPassed: allStage1Passed, totalAttempts: totalStage1Attempts, totalIssues: totalStage1Issues } = aggregateStage1(taskIds, perTaskStage1)
  const budgetExhausted = totalAttempts >= GATE_BUDGET.max_total_loops
  const stage2Failed = failedStage === 'stage2'
  const terminalDecision = budgetExhausted || stage2Failed ? 'rejected' : 'revise'
  const nextAction = terminalDecision === 'rejected' ? 'discard_integration_worktree' : 'fix_and_retry_batch'
  const result = {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: groupId,
    scope: 'batch',
    batch_id: groupId,
    task_ids: [...taskIds],
    per_task_stage1: { ...perTaskStage1 },
    subject: createReviewSubject(baseCommit, requirementIds, criticalConstraints),
    max_attempts: GATE_BUDGET.max_total_loops,
    attempt: totalAttempts,
    last_decision: terminalDecision,
    next_action: nextAction,
    blocking_issues: collectBlockingIssues(lastResult),
    commit_hash: mergedCommit || baseCommit,
    diff_window: diffWindow,
    protected_requirement_ids: [...requirementIds],
    protected_constraints: [...criticalConstraints],
    stage1: { passed: allStage1Passed, attempts: totalStage1Attempts, issues_found: totalStage1Issues, completed_at: now },
    overall_passed: false,
    reviewed_at: now,
    reviewer,
  }
  if (stage2Failed) {
    const issues = typeof lastResult === 'object' && lastResult ? (lastResult.issues || {}) : {}
    result.stage2 = {
      passed: false,
      attempts: Math.max(totalAttempts - totalStage1Attempts, 0),
      assessment: (lastResult || {}).assessment || 'rejected',
      critical_count: (issues.critical || []).length,
      important_count: (issues.important || []).length,
      minor_count: (issues.minor || []).length,
      completed_at: now,
    }
  }
  return result
}

function writeBatchQualityGateResult(statePath, groupId, gateResult, projectId = null) {
  return writeQualityGateResult(statePath, groupId, gateResult, projectId)
}

function writeQualityGateResult(statePath, taskId, gateResult, projectId = null) {
  const state = ensureStateDefaults(readState(statePath, projectId))
  const qualityGates = state.quality_gates || (state.quality_gates = {})
  qualityGates[taskId] = gateResult
  writeState(statePath, state, projectId)
  return gateResult
}

function readQualityGateResult(statePath, taskId, projectId = null) {
  const state = ensureStateDefaults(readState(statePath, projectId))
  return getReviewResult(state, taskId)
}

function resolveCliStatePath(projectId = null, stateFile = null) {
  if (stateFile) return assertCanonicalWorkflowStatePath(stateFile, projectId)
  if (projectId) return resolveStatePath(projectId)
  throw new Error('missing state reference')
}

function resolveExistingCliStatePath(projectId = null, stateFile = null) {
  try {
    const statePath = resolveCliStatePath(projectId, stateFile)
    return require('fs').existsSync(statePath) ? statePath : null
  } catch {
    return null
  }
}

function createQualityReviewEvidence(taskId, gateResult) {
  const passed = Boolean(gateResult.overall_passed)
  const stage1 = gateResult.stage1 || {}
  const stage2 = gateResult.stage2 || {}
  const outputSummary = `Stage 1 passed=${stage1.passed || false} attempts=${stage1.attempts || 0}, Stage 2 passed=${stage2.passed || false} attempts=${stage2.attempts || 0}, decision=${gateResult.last_decision}`
  return createEvidence('two-stage code review', passed ? 0 : 1, outputSummary, passed, `quality_gates.${taskId}`)
}

function resolveCommandState(commandProjectId = null, commandStateFile = null) {
  const projectId = commandProjectId || (commandStateFile ? null : detectProjectIdFromRoot(process.cwd()))
  const statePath = resolveExistingCliStatePath(projectId, commandStateFile)
  if (!statePath) {
    return {
      projectId,
      statePath: null,
      state: {},
    }
  }
  return {
    projectId,
    statePath,
    state: readState(statePath, projectId),
  }
}

function main() {
  try {
    const args = [...process.argv.slice(2)]
    const command = args.shift()
    const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
    const option = (flag) => {
      const index = args.indexOf(flag)
      return index >= 0 ? args[index + 1] : null
    }

    if (command === 'pass') {
      const taskId = args.shift()
      const commandState = resolveCommandState(option('--project-id'), option('--state-file'))
      if ((option('--project-id') || option('--state-file')) && !commandState.statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      const baseline = resolveBaseCommitForCommand(commandState.state, commandState.state.project_root || process.cwd(), option('--base-commit'))
      const baseCommit = baseline.base_commit
      if (!baseCommit) {
        process.stdout.write(`${JSON.stringify({ error: '缺少质量关卡基线，请先补齐 initial_head_commit 或显式传入 --base-commit', baseline_source: baseline.baseline_source })}\n`)
        process.exitCode = 1
        return
      }
      const currentCommit = option('--current-commit') || getGitHead(commandState.state.project_root || process.cwd()) || baseCommit
      const gateResult = buildPassGateResult(taskId, baseCommit, currentCommit, option('--from-task'), option('--to-task'), Number(option('--files-changed') || 0), split(option('--requirement-ids')), split(option('--critical-constraints')), Number(option('--stage1-attempts') || 1), Number(option('--stage2-attempts') || 1), Number(option('--stage1-issues-found') || 0), Number(option('--critical-count') || 0), Number(option('--important-count') || 0), Number(option('--minor-count') || 0), option('--reviewer') || 'subagent', commandState.state, option('--review-mode') || 'single_reviewer', option('--codex-status') || null, option('--review-cycle-id') || null)
      if (commandState.statePath) writeQualityGateResult(commandState.statePath, taskId, gateResult, commandState.projectId)
      process.stdout.write(`${JSON.stringify({ gate_result: gateResult, evidence: createQualityReviewEvidence(taskId, gateResult) })}\n`)
      return
    }

    if (command === 'fail') {
      const taskId = args.shift()
      let lastResult = {}
      try {
        lastResult = JSON.parse(option('--last-result-json') || '{}')
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ error: `invalid last-result-json: ${error}` })}\n`)
        process.exitCode = 1
        return
      }
      const commandState = resolveCommandState(option('--project-id'), option('--state-file'))
      if ((option('--project-id') || option('--state-file')) && !commandState.statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      const baseline = resolveBaseCommitForCommand(commandState.state, commandState.state.project_root || process.cwd(), option('--base-commit'))
      const baseCommit = baseline.base_commit
      if (!baseCommit) {
        process.stdout.write(`${JSON.stringify({ error: '缺少质量关卡基线，请先补齐 initial_head_commit 或显式传入 --base-commit', baseline_source: baseline.baseline_source })}\n`)
        process.exitCode = 1
        return
      }
      const currentCommit = option('--current-commit') || getGitHead(commandState.state.project_root || process.cwd()) || baseCommit
      const gateResult = buildFailedGateResult(taskId, option('--failed-stage'), baseCommit, currentCommit, option('--from-task'), option('--to-task'), Number(option('--files-changed') || 0), split(option('--requirement-ids')), split(option('--critical-constraints')), Number(option('--stage1-attempts') || 1), Number(option('--total-attempts') || 1), lastResult, option('--reviewer') || 'subagent', commandState.state)
      if (commandState.statePath) writeQualityGateResult(commandState.statePath, taskId, gateResult, commandState.projectId)
      process.stdout.write(`${JSON.stringify({ gate_result: gateResult, evidence: createQualityReviewEvidence(taskId, gateResult) })}\n`)
      return
    }

    if (command === 'read') {
      const taskOrState = args.shift()
      let statePath
      let taskId
      if (args[0]) {
        statePath = resolveExistingCliStatePath(option('--project-id'), taskOrState)
        taskId = args.shift()
      } else if (option('--project-id')) {
        statePath = resolveExistingCliStatePath(option('--project-id'), null)
        taskId = taskOrState
      } else {
        process.stdout.write(`${JSON.stringify({ error: 'missing state reference' })}\n`)
        process.exitCode = 1
        return
      }
      if (!statePath) {
        process.stdout.write(`${JSON.stringify({ error: '没有活跃的工作流' })}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`${JSON.stringify({ review: readQualityGateResult(statePath, taskId, option('--project-id')) })}\n`)
      return
    }

    if (command === 'budget') {
      const commandState = resolveCommandState(option('--project-id'), option('--state-file'))
      process.stdout.write(`${JSON.stringify(buildBudgetSnapshot(commandState.state, commandState.state.project_root || process.cwd()))}\n`)
      return
    }

    process.stderr.write('Usage: node quality_review.js <pass|fail|read|budget> ...\n')
    process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  GATE_BUDGET,
  isoNow,
  createReviewSubject,
  createDiffWindow,
  extractIssueCount,
  collectBlockingIssues,
  buildPassGateResult,
  buildFailedGateResult,
  buildBatchPassGateResult,
  buildBatchFailedGateResult,
  writeBatchQualityGateResult,
  resolveQualityReviewProfile,
  createReviewerPrompt,
  writeQualityGateResult,
  readQualityGateResult,
  resolveCliStatePath,
  resolveExistingCliStatePath,
  createQualityReviewEvidence,
  getGitHead,
  getPassedQualityGates,
  resolveReviewBaseline,
  resolveBaseCommitForCommand,
  buildBudgetSnapshot,
}

if (require.main === module) main()
