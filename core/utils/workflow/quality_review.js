#!/usr/bin/env node

const { spawnSync } = require('child_process')
const { resolveStatePath } = require('./state_manager')
const { assertCanonicalWorkflowStatePath } = require('./path_utils')
const { ensureStateDefaults } = require('./workflow_types')
const { buildInjectedContext, buildAgentPrompt, classifyRoleSignals, resolveRoleProfile, STAGE2_REVIEW_MODE_SET } = require('./role_injection')

// per-task gate 持久化 + governor budget 已退役（R-002）。
// 末尾终审复用的 buildPass/FailGateResult 仍需 review loop 上限来整形结果，
// 保留为不导出的内部常量，不再承担 budget 决策。
// 4 = 1 次首审 + 3 轮重派，对应 SKILL Step 4.2 / subagent-driven.md 的「循环上限 3 轮」（attempts 计数，非轮数）。
const MAX_REVIEW_LOOPS = 4

function normalizeStage2ReviewMode(value, fallback = 'single_reviewer') {
  if (!value) return fallback
  const str = String(value).trim()
  if (STAGE2_REVIEW_MODE_SET.has(str)) return str
  process.stderr.write(`[quality_review] unknown --review-mode "${str}", falling back to "${fallback}"\n`)
  return fallback
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
  // Probe E 只在 cross_layer_depth_gap 上携带细节。如果 blocking_issues 已经包含了该条目，上面的计数已经算过；
  // 否则（例如只传 crossLayerDepthGap 走 options 路径）按 missing_sections 的条数计入，退化最少为 1。
  if (result.cross_layer_depth_gap && result.cross_layer_depth_gap.triggered) {
    const hasInBlocking = Array.isArray(result.blocking_issues)
      && result.blocking_issues.some((x) => x && x.type === 'cross_layer_depth_gap')
    if (!hasInBlocking) {
      const sections = result.cross_layer_depth_gap.missing_sections
      total += Array.isArray(sections) && sections.length > 0 ? sections.length : 1
    }
  }
  return total
}

function buildCrossLayerDepthGapIssue(gap) {
  return {
    type: 'cross_layer_depth_gap',
    severity: 'critical',
    description: gap.description || 'Infra/cross-layer 改动命中 Probe E，但关联 code-spec 缺少关键段（Validation & Error Matrix / Good-Base-Bad Cases / Tests Required）。',
    files: Array.isArray(gap.files) ? [...gap.files] : [],
    specs: Array.isArray(gap.specs) ? [...gap.specs] : [],
    missing_sections: Array.isArray(gap.missing_sections) ? [...gap.missing_sections] : [],
  }
}

function collectBlockingIssues(result) {
  if (!result) return []
  // Probe E 条目必须**追加**而不是重建：外部 reviewer 产出的 `blocking_issues` 数组要原样保留，Probe E 只在命中时补一条。
  // 因此即使 result.blocking_issues 已是数组，也要先拷一份再追加，不能早退把 Probe E 吞掉。
  if (Array.isArray(result.blocking_issues)) {
    const base = [...result.blocking_issues]
    if (result.cross_layer_depth_gap && typeof result.cross_layer_depth_gap === 'object'
        && !base.some((x) => x && x.type === 'cross_layer_depth_gap')) {
      base.push(buildCrossLayerDepthGapIssue(result.cross_layer_depth_gap))
    }
    return base
  }
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
  if (result.cross_layer_depth_gap && typeof result.cross_layer_depth_gap === 'object') {
    collected.push(buildCrossLayerDepthGapIssue(result.cross_layer_depth_gap))
  }
  return collected
}

// 归一化 Stage 1 的 code_specs_check 子段。per-change 诊断永远 advisory，只记录计数与是否执行过。
function normalizeCodeSpecsCheck({ performed = true, findingsCount = 0 } = {}) {
  return {
    performed: Boolean(performed),
    advisory: true,
    findings_count: Number.isFinite(findingsCount) ? Math.max(0, Math.trunc(findingsCount)) : 0,
  }
}

// 归一化 Probe E 的阻塞标记。只在命中时写入；未命中则 stage1 子段中不出现该字段。
function normalizeCrossLayerDepthGap({ triggered = false, files = [], specs = [], missingSections = [], description = '' } = {}) {
  return {
    triggered: Boolean(triggered),
    files: Array.isArray(files) ? [...files] : [],
    specs: Array.isArray(specs) ? [...specs] : [],
    missing_sections: Array.isArray(missingSections) ? [...missingSections] : [],
    description: description ? String(description) : '',
  }
}

function buildPassGateResult(taskId, baseCommit, currentCommit = null, fromTask = null, toTask = null, filesChanged = 0, requirementIds = [], criticalConstraints = [], stage1Attempts = 1, stage2Attempts = 1, stage1IssuesFound = 0, criticalCount = 0, importantCount = 0, minorCount = 0, reviewer = 'subagent', state = {}, stage2ReviewMode = 'single_reviewer', stage2CodexStatus = null, stage2ReviewCycleId = null, options = {}) {
  const attempts = stage1Attempts + stage2Attempts
  const now = isoNow()
  const diffWindow = createDiffWindow(baseCommit, fromTask, toTask, filesChanged)
  const reviewerPrompt = createReviewerPrompt(state, requirementIds, criticalConstraints, diffWindow)
  const stage1 = { passed: true, attempts: stage1Attempts, issues_found: stage1IssuesFound, completed_at: now }
  // Code Specs Check 仅 advisory，只要 CLI 有声明就写入；pass 路径不应命中 cross_layer_depth_gap，保留字段以便下游统一读取。
  stage1.code_specs_check = normalizeCodeSpecsCheck(options.codeSpecsCheck || {})
  return {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: taskId,
    subject: createReviewSubject(baseCommit, requirementIds, criticalConstraints),
    max_attempts: MAX_REVIEW_LOOPS,
    attempt: attempts,
    last_decision: 'pass',
    next_action: 'continue_execution',
    commit_hash: currentCommit || baseCommit,
    diff_window: diffWindow,
    stage1,
    stage2: { passed: true, attempts: stage2Attempts, assessment: 'approved', critical_count: criticalCount, important_count: importantCount, minor_count: minorCount, completed_at: now, role: reviewerPrompt.role, profile: reviewerPrompt.profile, review_mode: stage2ReviewMode, codex_status: stage2CodexStatus, review_cycle_id: stage2ReviewCycleId, raw_results: null, merged: null },
    overall_passed: true,
    reviewed_at: now,
    reviewer,
  }
}

function buildFailedGateResult(taskId, failedStage, baseCommit, currentCommit = null, fromTask = null, toTask = null, filesChanged = 0, requirementIds = [], criticalConstraints = [], stage1Attempts = 1, totalAttempts = 1, lastResult = null, reviewer = 'subagent', state = {}, options = {}) {
  const budgetExhausted = totalAttempts >= MAX_REVIEW_LOOPS
  const stage1Failed = failedStage === 'stage1' || failedStage === 'stage1_recheck'
  const stage2Failed = failedStage === 'stage2'
  const terminalDecision = budgetExhausted || stage2Failed ? 'rejected' : 'revise'
  const nextAction = terminalDecision === 'rejected' ? 'mark_task_failed_or_escalate' : 'fix_and_retry_or_escalate'
  const now = isoNow()
  const diffWindow = createDiffWindow(baseCommit, fromTask, toTask, filesChanged)
  const reviewerPrompt = createReviewerPrompt(state, requirementIds, criticalConstraints, diffWindow)
  // 把上游 CLI 传入的 cross_layer_depth_gap / code_specs_check 合并进 lastResult，再走 collectBlockingIssues。
  const mergedLastResult = { ...(lastResult && typeof lastResult === 'object' ? lastResult : {}) }
  if (options.crossLayerDepthGap && options.crossLayerDepthGap.triggered) {
    mergedLastResult.cross_layer_depth_gap = normalizeCrossLayerDepthGap(options.crossLayerDepthGap)
  }
  const stage1 = { passed: !stage1Failed, attempts: stage1Attempts, issues_found: extractIssueCount(mergedLastResult), completed_at: now }
  stage1.code_specs_check = normalizeCodeSpecsCheck(options.codeSpecsCheck || {})
  if (mergedLastResult.cross_layer_depth_gap) stage1.cross_layer_depth_gap = mergedLastResult.cross_layer_depth_gap
  const result = {
    review_type: 'quality_review',
    review_mode: 'machine_loop',
    gate_task_id: taskId,
    subject: createReviewSubject(baseCommit, requirementIds, criticalConstraints),
    max_attempts: MAX_REVIEW_LOOPS,
    attempt: totalAttempts,
    last_decision: terminalDecision,
    next_action: nextAction,
    blocking_issues: collectBlockingIssues(mergedLastResult),
    reviewed_at: now,
    reviewer,
    commit_hash: currentCommit || baseCommit,
    diff_window: diffWindow,
    stage1,
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
      review_mode: normalizeStage2ReviewMode((lastResult || {}).review_mode),
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

// R-002：per-task gate 持久化（pass/fail 落盘、read 读盘）与 governor budget 子命令均已退役。
// 本模块现在仅作为库导出 reviewer prompt 构造 + review 结果整形辅助，供末尾终审复用；无 CLI 子命令。
function main() {
  process.stderr.write('quality_review.js 无 CLI 子命令（per-task gate 持久化已退役，模块仅供库内引用）\n')
  process.exitCode = 1
}

module.exports = {
  isoNow,
  createReviewSubject,
  createDiffWindow,
  extractIssueCount,
  collectBlockingIssues,
  buildPassGateResult,
  buildFailedGateResult,
  resolveQualityReviewProfile,
  resolveCliStatePath,
  resolveExistingCliStatePath,
  getGitHead,
}

if (require.main === module) main()
