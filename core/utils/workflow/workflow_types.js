#!/usr/bin/env node

function isoNow() {
  return new Date().toISOString()
}

function copyJson(value) {
  return JSON.parse(JSON.stringify(value))
}

const MINIMUM_PROGRESS = {
  completed: [],
  blocked: [],
  failed: [],
  skipped: [],
}

const MINIMUM_DELTA_TRACKING = {
  enabled: true,
  changes_dir: 'changes/',
  current_change: null,
  applied_changes: [],
  change_counter: 0,
}

const MINIMUM_API_CONTEXT = {
  interfaces: [],
  lastSync: null,
  source: null,
  version: null,
}

const MINIMUM_GIT_STATUS = {
  initialized: false,
  subagent_available: false,
  user_acknowledged_degradation: false,
}

const MINIMUM_CONTEXT_INJECTION = {
  schema_version: '1',
  signals: {
    ui: false,
    workspace: false,
    security: false,
    data: false,
    backend_heavy: false,
  },
  planning: {
    plan_generation: { role: 'planner', profile: null },
    plan_review: { role: 'reviewer', profile: null },
    codex_spec_review: { triggered: false },
    codex_plan_review: { triggered: false },
  },
  execution: {
    quality_review_stage2: { role: 'reviewer', profile: null },
  },
}

const MINIMUM_SESSIONS = {
  platform: 'claude-code',
  executor: null,
}

const MINIMUM_STATE_STATUSES = new Set([
  'idle',
  'spec_review',
  'planned',
  'running',
  'halted',
  'completed',
  'archived',
])
const POST_SPEC_REVIEW_STATUSES = new Set([
  'planned',
  'running',
  'halted',
  'completed',
])

// Enum 常量化：消除 stringly-typed 散落字面量。新代码应引用这些常量；旧字符串字面量仍兼容。
const HALT_REASON = Object.freeze({
  FAILURE: 'failure',
  DEPENDENCY: 'dependency',
  AWAITING_CODEX_REVIEW: 'awaiting_codex_review',
})

const TRIGGER_REASON = Object.freeze({
  SIGNAL_BACKEND_HEAVY: 'signal:backend_heavy',
  SIGNAL_UI: 'signal:ui',
  SIGNAL_DATA: 'signal:data',
  SIGNAL_SECURITY: 'signal:security',
  SIGNAL_WORKSPACE: 'signal:workspace',
  USER_REQUESTED: 'user_requested',
})

const ATTEMPT_PHASE = Object.freeze({
  STAGE1: 'stage1',
  STAGE2: 'stage2',
  CODEX_SPEC_REVIEW: 'codex_spec_review',
  CODEX_PLAN_REVIEW: 'codex_plan_review',
})

const ATTEMPT_OUTCOME = Object.freeze({
  PASS: 'pass',
  REVISE: 'revise',
  REJECTED: 'rejected',
  PENDING: 'pending',
})

const FINDING_STATUS = Object.freeze({
  NEW: 'new',
  CARRIED: 'carried',
  RESOLVED: 'resolved',
})

// T8：构建偏离审计 record。spec-update 触发前的二次确认由 CLI 层做，本函数只做 schema 归一化。
function buildDeviationRecord({ originalIntent, acceptedImplementation, specSection, requiresSpecReview = true, decidedAt = null, decidedBy = 'user' } = {}) {
  return {
    deviation_id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    decided_at: decidedAt || isoNow(),
    decided_by: decidedBy,
    original_intent: String(originalIntent || ''),
    accepted_implementation: String(acceptedImplementation || ''),
    spec_section: specSection || null,
    requires_spec_review: Boolean(requiresSpecReview),
  }
}

function buildAttemptRecord({ attemptId = null, phase, triggerReason = null, outcome, findingsRef = null, timestamp = null } = {}) {
  return {
    attempt_id: attemptId || `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phase,
    trigger_reason: triggerReason,
    outcome,
    findings_ref: findingsRef,
    timestamp: timestamp || isoNow(),
  }
}

// Pass-through projector for read-side consumers.
// Halted state derives halt_reason from explicit field, defaulting to 'failure'.
function deriveEffectiveStatus(state) {
  const source = state || {}
  const rawStatus = source.status || 'idle'
  const haltReason = source.halt_reason || null
  return { status: rawStatus, halt_reason: rawStatus === 'halted' ? (haltReason || 'failure') : null }
}

function buildMinimumState(projectId, planFile, specFile, currentTasks = [], status = 'running') {
  if (!MINIMUM_STATE_STATUSES.has(status)) throw new Error(`invalid workflow status: ${status}`)
  const now = isoNow()
  return {
    project_id: projectId,
    status,
    current_tasks: currentTasks,
    plan_file: planFile,
    spec_file: specFile,
    progress: copyJson(MINIMUM_PROGRESS),
    created_at: now,
    updated_at: now,
  }
}

function ensureStateDefaults(state) {
  const normalized = copyJson(state || {})
  // Read-side discard of retired execute/review fields (lean-execute 收敛，对齐 ADR 0002 "读时丢弃老字段" 先例)。
  // 老 state 文件读入后这些字段被丢弃，不写 migration。
  delete normalized.quality_gates
  delete normalized.continuation
  delete normalized.review_report_path
  delete normalized.contextMetrics
  if (!normalized.project_id && normalized.projectId) normalized.project_id = normalized.projectId
  if (!normalized.status) normalized.status = 'idle'
  if (!normalized.current_tasks) normalized.current_tasks = []
  if (!('initial_head_commit' in normalized)) normalized.initial_head_commit = null
  normalized.progress = normalized.progress || {}
  for (const [key, value] of Object.entries(MINIMUM_PROGRESS)) {
    if (!Array.isArray(normalized.progress[key])) normalized.progress[key] = [...value]
  }
  if (!normalized.task_runtime) normalized.task_runtime = {}
  if (!normalized.unblocked) normalized.unblocked = []
  if (!normalized.sessions) normalized.sessions = copyJson(MINIMUM_SESSIONS)
  if (!normalized.delta_tracking) normalized.delta_tracking = copyJson(MINIMUM_DELTA_TRACKING)
  if (!normalized.git_status) normalized.git_status = copyJson(MINIMUM_GIT_STATUS)
  if (!normalized.context_injection) normalized.context_injection = copyJson(MINIMUM_CONTEXT_INJECTION)
  if (!normalized.review_status) normalized.review_status = {}
  if (!normalized.api_context) normalized.api_context = copyJson(MINIMUM_API_CONTEXT)
  if (!normalized.discussion) normalized.discussion = { completed: false, clarification_count: 0, unresolved_dependencies: [] }

  if (!normalized.ux_design) normalized.ux_design = { completed: false, ux_gate_required: false, flowchart_scenarios: 0, page_count: 0, approved_at: null }
  if (!normalized.review_status.user_spec_review) normalized.review_status.user_spec_review = { status: 'pending', review_mode: 'human_gate', reviewed_at: null, reviewer: 'user', next_action: null }
  if (!normalized.review_status.codex_spec_review) normalized.review_status.codex_spec_review = { status: 'pending', review_mode: 'machine_loop', reviewed_at: null, reviewer: 'codex', trigger_reason: null, provider_mode: 'task_readonly', attempt: 0, max_attempts: 1, issues: [], issues_found: 0, codex_status: null, session_id: null, timing_ms: null }
  if (!normalized.review_status.codex_plan_review) normalized.review_status.codex_plan_review = { status: 'pending', review_mode: 'machine_loop', reviewed_at: null, reviewer: 'codex', trigger_reason: null, provider_mode: 'task_readonly', attempt: 0, max_attempts: 2, issues: [], issues_found: 0, codex_status: null, session_id: null, timing_ms: null }
  if (!('failure_reason' in normalized)) normalized.failure_reason = null
  if (!('halt_reason' in normalized)) normalized.halt_reason = null
  // contract digest 落盘路径（顶层字符串）。set-contract-digest-path CLI 动词写入，避免 controller 手编 state.json。
  if (!('contract_digest_path' in normalized)) normalized.contract_digest_path = null
  // T8 deviation_log: 用户"接受偏离"决策的审计日志,每条带 decided_at / spec_section / requires_spec_review。
  if (!Array.isArray(normalized.deviation_log)) normalized.deviation_log = []
  if (!normalized.created_at) normalized.created_at = normalized.updated_at || isoNow()
  if (!normalized.updated_at) normalized.updated_at = isoNow()
  return normalized
}

function normalizeQualityGateRecord(taskId, record) {
  const stage1 = { ...(record.stage1 || {}) }
  if (!stage1.code_specs_check || typeof stage1.code_specs_check !== 'object') {
    stage1.code_specs_check = { performed: false, advisory: true, findings_count: 0 }
  }
  const attempts = Array.isArray(record.attempts) ? record.attempts : []
  return {
    gate_task_id: record.gate_task_id || taskId,
    review_mode: record.review_mode || 'machine_loop',
    last_decision: record.last_decision || 'revise',
    stage1,
    stage2: record.stage2 || {},
    attempts,
    overall_passed: Boolean(record.overall_passed || false),
    reviewed_at: record.reviewed_at || null,
  }
}

function getReviewResult(state, taskId) {
  const qualityGates = (state || {}).quality_gates || {}
  if (qualityGates[taskId]) return normalizeQualityGateRecord(taskId, qualityGates[taskId])
  return null
}

function summarizeProgress(state) {
  const progress = ensureStateDefaults(state).progress
  return {
    completed: progress.completed.length,
    blocked: progress.blocked.length,
    failed: progress.failed.length,
    skipped: progress.skipped.length,
  }
}

function buildUserSpecReview(status, nextAction, reviewer = 'user', reviewMode = 'human_gate') {
  return {
    status,
    review_mode: reviewMode,
    reviewed_at: status === 'pending' ? null : isoNow(),
    reviewer,
    next_action: nextAction,
  }
}

function nextChangeId(deltaTracking) {
  const counter = Number(((deltaTracking || {}).change_counter) || 0) + 1
  return `CHG-${String(counter).padStart(3, '0')}`
}

function getUserSpecReview(state) {
  return ensureStateDefaults(state).review_status.user_spec_review
}

function isUserSpecReviewApproved(state) {
  const review = getUserSpecReview(state)
  return review.status === 'approved' || (review.status === 'skipped' && Boolean(review.acknowledged_degradation_at))
}

function acknowledgeSkippedSpecReview(state, reviewer = 'user', source = 'execute --force') {
  const normalized = ensureStateDefaults(state)
  const review = normalized.review_status.user_spec_review || (normalized.review_status.user_spec_review = {
    status: 'pending',
    review_mode: 'human_gate',
    reviewed_at: null,
    reviewer: 'user',
    next_action: null,
  })
  if (review.status !== 'skipped') return normalized
  const acknowledgedAt = isoNow()
  review.acknowledged_degradation_at = acknowledgedAt
  review.acknowledged_degradation_by = reviewer
  review.acknowledged_degradation_source = source
  review.requires_degradation_ack = false
  normalized.git_status.user_acknowledged_degradation = true
  normalized.updated_at = acknowledgedAt
  return normalized
}

function getSpecReviewGateViolation(state) {
  const normalized = ensureStateDefaults(state)
  if (!POST_SPEC_REVIEW_STATUSES.has(normalized.status)) return null
  const review = normalized.review_status.user_spec_review || {}
  if (review.status === 'approved') return null
  if (review.status === 'skipped') {
    if (review.acknowledged_degradation_at) return null
    return {
      code: 'spec_upgrade_required',
      status: normalized.status,
      review_status: 'skipped',
      message: '当前 workflow 由无 spec 的 plan 自愈恢复，执行前需先升级到 /workflow-plan，或显式使用 /workflow-execute --force 确认降级。',
    }
  }
  return {
    code: 'user_spec_review_required',
    status: normalized.status,
    review_status: review.status || 'pending',
    message: `workflow 处于 ${normalized.status}，但 Phase 1.1 User Spec Review 尚未 approved`,
  }
}

function main() {
  const fs = require('fs')
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  if (command === 'minimum-state') {
    const [projectId, planFile, specFile] = args
    const statusIndex = args.indexOf('--status')
    const tasksIndex = args.indexOf('--current-tasks')
    const status = statusIndex >= 0 ? args[statusIndex + 1] : 'running'
    const currentTasks = tasksIndex >= 0 ? args[tasksIndex + 1].split(',').map((item) => item.trim()).filter(Boolean) : []
    process.stdout.write(`${JSON.stringify(buildMinimumState(projectId, planFile, specFile, currentTasks, status), null, 2)}\n`)
    return
  }
  if (command === 'normalize-state') {
    const state = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    process.stdout.write(`${JSON.stringify(ensureStateDefaults(state), null, 2)}\n`)
    return
  }
  if (command === 'review-result') {
    const state = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    process.stdout.write(`${JSON.stringify({ review: getReviewResult(state, args[1]) }, null, 2)}\n`)
    return
  }
  process.stderr.write('Usage: node workflow_types.js <minimum-state|normalize-state|review-result> ...\n')
  process.exitCode = 1
}

module.exports = {
  MINIMUM_PROGRESS,
  MINIMUM_DELTA_TRACKING,
  MINIMUM_API_CONTEXT,
  MINIMUM_GIT_STATUS,
  MINIMUM_CONTEXT_INJECTION,
  MINIMUM_SESSIONS,

  MINIMUM_STATE_STATUSES,
  HALT_REASON,
  TRIGGER_REASON,
  ATTEMPT_PHASE,
  ATTEMPT_OUTCOME,
  FINDING_STATUS,
  isoNow,
  copyJson,
  buildMinimumState,
  ensureStateDefaults,
  deriveEffectiveStatus,
  normalizeQualityGateRecord,
  buildAttemptRecord,
  buildDeviationRecord,
  getReviewResult,
  summarizeProgress,
  buildUserSpecReview,
  nextChangeId,
  getUserSpecReview,
  isUserSpecReviewApproved,
  acknowledgeSkippedSpecReview,
  getSpecReviewGateViolation,
  getStatusMessages,
}

/**
 * 共享 status → 消息表。verbose=true 给 SessionStart 长文本，verbose=false 给 UserPromptSubmit 重注入用的短文本。
 * 单点维护避免 session-start 与 inject-workflow-state 漂移。
 */
function getStatusMessages(state, { verbose = true } = {}) {
  if (!state) {
    return verbose
      ? { nextAction: '没有活跃的工作流。使用 `/workflow-plan` 开始新任务。', guardrail: '无活动 workflow：仅允许新建流程，不应猜测恢复执行。' }
      : { nextAction: null, guardrail: null }
  }
  if (getSpecReviewGateViolation(state)) {
    return verbose
      ? {
          nextAction: '检测到 User Spec Review 缺失。请先回到 Phase 1.1 完成显式批准，再继续进入 plan 或 execute。',
          guardrail: 'Guardrail：检测到状态机越界，Phase 1.1 User Spec Review 未 approved 却已进入后续状态；禁止继续推进，需先修复回 spec_review。',
        }
      : { nextAction: 'Spec Review 未 approved，回 Phase 1.1 完成显式批准。', guardrail: 'Spec Review 越界，禁止推进，需回 spec_review。' }
  }
  const { status, halt_reason: haltReason } = deriveEffectiveStatus(state)
  const table = verbose ? VERBOSE_STATUS_TABLE : SHORT_STATUS_TABLE
  const entry = table[status]
  if (!entry) {
    return verbose
      ? { nextAction: `当前状态: ${status}。使用 /workflow-status 查看详情。`, guardrail: 'Guardrail：主流程由 command + skill + state machine 控制，hook 只做上下文提示与守门。' }
      : { nextAction: null, guardrail: null }
  }
  if (typeof entry === 'function') return entry(state, haltReason)
  return entry
}

const VERBOSE_STATUS_TABLE = {
  idle: { nextAction: '使用 `/workflow-plan` 开始新的工作流。', guardrail: 'Guardrail：主流程由 command + skill + state machine 控制，hook 只做上下文提示与守门。' },
  planned: { nextAction: '规划已完成。使用 `/workflow-execute` 开始执行；不要重新进入规划。', guardrail: 'Guardrail：此状态只允许显式 `/workflow-execute` 进入执行器；禁止自动继续或重新规划。' },
  spec_review: { nextAction: 'Spec 等待确认。请先审查 Spec 文档并完成人工确认，不能直接执行。', guardrail: 'Guardrail：当前处于人工 Spec 审查关口（或 Plan 生成中）；禁止直接进入实现。' },
  running: (state) => ({
    nextAction: `工作流执行中，当前任务: ${(state.current_tasks || [])[0] || '?'}。使用 /workflow-execute 继续。`,
    guardrail: 'Guardrail：恢复执行必须经过 `/workflow-execute` 的 shared resolver，不得绕过治理与质量关卡。如果你以 implement / check sub-agent 身份阅读到此条，自我豁免：直接执行任务，不要再派 `/workflow-execute` 或同类型 sub-agent。',
  }),
  halted: (state, haltReason) => ({
    nextAction: haltReason === 'dependency'
      ? '工作流被阻塞。使用 `/workflow unblock <dep>` 解除依赖后再恢复执行。'
      : haltReason === 'failure'
        ? `任务 ${(state.current_tasks || [])[0] || '?'} 失败: ${state.failure_reason || '未知'}。使用 /workflow-execute --retry 重试，或显式选择 skip。`
        : '工作流已暂停。请处理暂停原因后使用 `/workflow-execute` 恢复执行。',
    guardrail: haltReason === 'failure'
      ? 'Guardrail：失败态只能走 retry/skip 治理路径，不得静默推进到下一任务。'
      : haltReason === 'dependency'
        ? 'Guardrail：阻塞态需先 unblock，不能把"继续"解释为直接执行。'
        : 'Guardrail：暂停态恢复执行必须经过 `/workflow-execute` 的 shared resolver。',
  }),
  completed: (state) => ({
    nextAction: `工作流已完成 (${((state.progress || {}).completed || []).length} 任务)。使用 /workflow-archive 归档，不要继续执行。`,
    guardrail: 'Guardrail：已完成流程只允许归档或查看状态，不允许继续执行。',
  }),
  archived: { nextAction: '工作流已归档。使用 `/workflow-plan` 开始新任务。', guardrail: 'Guardrail：归档流程视为结束，后续需求需重新 `/workflow-plan`。' },
}

const SHORT_STATUS_TABLE = {
  idle: { nextAction: null, guardrail: null },
  planned: { nextAction: '使用 `/workflow-execute` 开始执行；不要重新规划。', guardrail: '只允许显式 `/workflow-execute` 进入执行器。' },
  spec_review: { nextAction: 'Spec 等待人工确认。', guardrail: '人工审查关口，禁止直接实现。' },
  running: (state) => ({
    nextAction: `执行中: ${(state.current_tasks || [])[0] || '?'}。/workflow-execute 继续。`,
    guardrail: '恢复执行必须经 `/workflow-execute` shared resolver。',
  }),
  halted: (state, haltReason) => ({
    nextAction: haltReason === 'failure'
      ? `任务 ${(state.current_tasks || [])[0] || '?'} 失败。/workflow-execute --retry 或 skip。`
      : haltReason === 'dependency'
        ? '依赖阻塞。/workflow unblock <dep> 后恢复。'
        : '已暂停，处理原因后 /workflow-execute 恢复。',
    guardrail: '阻塞/失败态需走 retry/skip/unblock 治理。',
  }),
  completed: { nextAction: '已完成，/workflow-archive 归档。', guardrail: '已完成只允许归档或查看状态。' },
  archived: { nextAction: null, guardrail: null },
}

if (require.main === module) main()
