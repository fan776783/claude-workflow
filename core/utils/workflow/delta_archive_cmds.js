#!/usr/bin/env node
/** @file delta/archive/unblock 命令 - 从 lifecycle_cmds.js 拆出的 delta 变更流转与归档/解除阻塞命令 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const {
  applyTaskDeltas,
  createDeltaArtifacts,
  summarizeTaskDeltas,
  toPrettyJson,
} = require('./plan_delta')
const {
  markDeltaApplied,
  markDependencyUnblocked,
  recordDeltaChange,
  writeState,
} = require('./state_manager')
const { detectProjectRoot, resolveStateAndTasks } = require('./task_manager')
const { parseTasksV2, taskToDict } = require('./task_parser')
const { deriveEffectiveStatus, ensureStateDefaults } = require('./workflow_types')
const { reconcileBlockedTasks } = require('./dependency_checker')
const { slugifyFilename, summarizeText } = require('./project_setup')
const { resolveWorkflowRuntime } = require('./runtime_locator')

function detectDeltaTrigger(source, projectRoot) {
  const raw = String(source || '').trim()
  if (!raw) return { type: 'sync', source: null, description: '执行 API 同步' }
  const absolute = path.isAbsolute(raw) ? raw : path.join(projectRoot, raw)
  const normalizedSource = raw.replace(/\\/g, '/')
  if (raw.endsWith('.md') && fs.existsSync(absolute)) return { type: 'prd', source: raw, description: `PRD 更新: ${path.basename(raw)}` }
  if (raw.endsWith('Api.ts') || normalizedSource.includes('/autogen/') || raw.endsWith('.api.ts')) return { type: 'api', source: raw, description: `API 变更: ${raw}` }
  return { type: 'requirement', source: raw, description: summarizeText(raw, 120) }
}

// --- Delta 子命令 ---

const VALID_CHANGE_ID_PATTERN = /^CHG-\d{3,}$/

function validateChangeId(changeId) {
  if (!changeId || !VALID_CHANGE_ID_PATTERN.test(changeId)) {
    return { error: `非法 change-id: ${changeId}。格式须为 CHG-NNN` }
  }
  return null
}

function resolveActiveDelta(projectId, projectRoot) {
  const [resolvedProjectId, root, workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return [null, null, null, null, null, { error: '没有活跃的工作流' }]

  const normalizedState = ensureStateDefaults(state)
  if (normalizedState.status === 'archived') return [null, null, null, null, null, { error: '当前工作流已归档，无法追加 delta' }]

  return [resolvedProjectId, workflowDir, statePath, normalizedState, root, null]
}

function cmdDeltaInit(triggerType, source, description, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, root, err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  const trigger = { type: triggerType || 'requirement', source: source || null, description: description || `${triggerType || 'requirement'} 变更` }
  const tracking = normalizedState.delta_tracking || (normalizedState.delta_tracking = {})
  const parentChange = tracking.current_change || null
  const changeId = recordDeltaChange(normalizedState, null, false)

  const changeDir = path.join(workflowDir, 'changes', changeId)
  fs.mkdirSync(changeDir, { recursive: true })

  const artifacts = createDeltaArtifacts(changeId, trigger, parentChange)
  fs.writeFileSync(path.join(changeDir, 'delta.json'), toPrettyJson(artifacts.delta))
  fs.writeFileSync(path.join(changeDir, 'intent.md'), artifacts.intent)
  fs.writeFileSync(path.join(changeDir, 'review-status.json'), toPrettyJson(artifacts.review_status))

  writeState(statePath, normalizedState)

  return {
    delta_created: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    trigger_type: trigger.type,
    change_dir: changeDir,
    parent_change: parentChange,
  }
}

function cmdDeltaImpact(changeId, tasksAdded, tasksModified, tasksRemoved, riskLevel, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, , err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  if (!changeId) return { error: '缺少 --change-id' }
  const changeIdErr = validateChangeId(changeId)
  if (changeIdErr) return changeIdErr
  const changeDir = path.join(workflowDir, 'changes', changeId)
  const deltaPath = path.join(changeDir, 'delta.json')
  if (!fs.existsSync(deltaPath)) return { error: `变更记录不存在: ${changeId}` }

  const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'))
  delta.impact_analysis = {
    summary: `新增 ${tasksAdded || 0} / 修改 ${tasksModified || 0} / 废弃 ${tasksRemoved || 0}`,
    tasks_added: Number(tasksAdded || 0),
    tasks_modified: Number(tasksModified || 0),
    tasks_removed: Number(tasksRemoved || 0),
    risk_level: riskLevel || 'low',
    affected_tasks: delta.impact_analysis?.affected_tasks || [],
    affected_files: delta.impact_analysis?.affected_files || [],
  }
  delta.status = 'analyzed'
  fs.writeFileSync(deltaPath, toPrettyJson(delta))

  return {
    impact_recorded: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    impact: delta.impact_analysis,
  }
}

function cmdDeltaApply(changeId, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, root, err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  if (!changeId) return { error: '缺少 --change-id' }
  const changeIdErr = validateChangeId(changeId)
  if (changeIdErr) return changeIdErr
  const changeDir = path.join(workflowDir, 'changes', changeId)
  const deltaPath = path.join(changeDir, 'delta.json')
  if (!fs.existsSync(deltaPath)) return { error: `变更记录不存在: ${changeId}` }

  const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'))
  if (delta.status === 'applied') {
    markDeltaApplied(normalizedState, changeId)
    writeState(statePath, normalizedState)
    return {
      applied: true,
      already_applied: true,
      project_id: resolvedProjectId,
      change_id: changeId,
      workflow_status: normalizedState.status,
      task_delta_summary: { add: 0, modify: 0, remove: 0 },
    }
  }

  delta.status = 'applied'
  delta.applied_at = new Date().toISOString()
  fs.writeFileSync(deltaPath, toPrettyJson(delta))
  markDeltaApplied(normalizedState, changeId)

  // 更新 review-status
  const reviewStatusPath = path.join(changeDir, 'review-status.json')
  if (fs.existsSync(reviewStatusPath)) {
    const reviewStatus = JSON.parse(fs.readFileSync(reviewStatusPath, 'utf8'))
    reviewStatus.status = 'approved'
    reviewStatus.reviewed_at = new Date().toISOString()
    reviewStatus.review_mode = 'human_gate'
    fs.writeFileSync(reviewStatusPath, toPrettyJson(reviewStatus))
  }

  // 应用 task deltas（如有）
  let taskDeltaSummary = { add: 0, modify: 0, remove: 0 }
  const taskDeltas = delta.task_deltas || []
  if (taskDeltas.length) {
    const [, , tasksContent, tasksPath] = resolveStateAndTasks(resolvedProjectId, root)
    if (tasksContent && tasksPath) {
      fs.writeFileSync(tasksPath, applyTaskDeltas(tasksContent, taskDeltas))
      taskDeltaSummary = summarizeTaskDeltas(taskDeltas)
    }
  }

  writeState(statePath, normalizedState)

  return {
    applied: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    workflow_status: normalizedState.status,
    task_delta_summary: taskDeltaSummary,
  }
}

function cmdDeltaFail(changeId, errorMessage, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, , err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  if (!changeId) return { error: '缺少 --change-id' }
  const changeIdErr = validateChangeId(changeId)
  if (changeIdErr) return changeIdErr
  const changeDir = path.join(workflowDir, 'changes', changeId)
  const deltaPath = path.join(changeDir, 'delta.json')
  if (!fs.existsSync(deltaPath)) return { error: `变更记录不存在: ${changeId}` }

  const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'))
  delta.status = 'failed'
  delta.error = String(errorMessage || '').substring(0, 500)
  delta.failed_at = new Date().toISOString()
  fs.writeFileSync(deltaPath, toPrettyJson(delta))

  writeState(statePath, normalizedState)

  return {
    failed: true,
    project_id: resolvedProjectId,
    change_id: changeId,
  }
}

function cmdDeltaSync(dependency, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, root, err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  const dep = String(dependency || 'api_spec').trim()

  // 1. 初始化变更记录
  const trigger = { type: 'sync', source: dep, description: `同步 ${dep} 并解除阻塞` }
  const tracking = normalizedState.delta_tracking || (normalizedState.delta_tracking = {})
  const parentChange = tracking.current_change || null
  const changeId = recordDeltaChange(normalizedState)
  const changeDir = path.join(workflowDir, 'changes', changeId)
  fs.mkdirSync(changeDir, { recursive: true })

  // 2. 解除阻塞
  markDependencyUnblocked(normalizedState, dep)
  const [, , tasksContent] = resolveStateAndTasks(resolvedProjectId, root)
  let newlyUnblocked = []
  if (tasksContent) {
    const tasks = parseTasksV2(tasksContent).map(taskToDict)
    const reconciliation = reconcileBlockedTasks(tasks, normalizedState.unblocked || [], ((normalizedState.progress || {}).blocked) || [])
    if (!normalizedState.progress) normalizedState.progress = {}
    normalizedState.progress.blocked = reconciliation.blocked
    newlyUnblocked = reconciliation.newly_unblocked
    const effective = deriveEffectiveStatus(normalizedState)
    if (effective.status === 'halted' && effective.halt_reason === 'dependency' && !reconciliation.blocked.length) {
      normalizedState.status = 'running'
      normalizedState.halt_reason = null
    }
  }

  // 3. 写入审计记录（先审计后生效）
  const artifacts = createDeltaArtifacts(changeId, trigger, parentChange)
  artifacts.delta.status = 'applied'
  artifacts.delta.applied_at = new Date().toISOString()
  artifacts.delta.impact_analysis.summary = `同步 ${dep}，解除 ${newlyUnblocked.length} 个任务阻塞`
  artifacts.review_status.status = 'auto_applied'
  artifacts.review_status.review_mode = 'sync'
  artifacts.review_status.reviewed_at = new Date().toISOString()

  fs.writeFileSync(path.join(changeDir, 'delta.json'), toPrettyJson(artifacts.delta))
  fs.writeFileSync(path.join(changeDir, 'intent.md'), artifacts.intent)
  fs.writeFileSync(path.join(changeDir, 'review-status.json'), toPrettyJson(artifacts.review_status))

  // 4. 持久化状态（后生效）
  writeState(statePath, normalizedState)

  return {
    synced: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    dependency: dep,
    workflow_status: normalizedState.status,
    newly_unblocked_tasks: newlyUnblocked,
    known_unblocked: normalizedState.unblocked || [],
  }
}

// Legacy: 保留旧的单参数调用模式用于向后兼容
function cmdDelta(source = '', projectId = null, projectRoot = null) {
  const root = detectProjectRoot(projectRoot)
  const trigger = detectDeltaTrigger(source, root)
  return cmdDeltaInit(trigger.type, trigger.source, trigger.description, projectId, projectRoot)
}

const ARCHIVE_MARKER_FILE = 'ARCHIVING.marker'
const ARCHIVE_MARKER_VERSION = 2
const ARCHIVE_LEASE_MS = 5 * 60 * 1000

function buildArchiveTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
}

function buildHistorySlug(taskName) {
  const raw = String(taskName || '').trim()
  const slug = slugifyFilename(raw) || raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'workflow'
  return slug.slice(0, 80) || 'workflow'
}

function readArchiveMarker(workflowDir) {
  const markerPath = path.join(workflowDir, ARCHIVE_MARKER_FILE)
  if (!fs.existsSync(markerPath)) return null
  try {
    return { path: markerPath, data: JSON.parse(fs.readFileSync(markerPath, 'utf8')) }
  } catch {
    return { path: markerPath, data: null }
  }
}

function writeArchiveMarker(workflowDir, data) {
  const markerPath = path.join(workflowDir, ARCHIVE_MARKER_FILE)
  const tmp = `${markerPath}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, markerPath)
  return markerPath
}

function isArchiveOwnerAlive(pid) {
  const numericPid = Number(pid)
  if (!Number.isInteger(numericPid) || numericPid <= 0 || numericPid > 0x7fffffff) return false
  if (numericPid === process.pid) return false
  try {
    process.kill(numericPid, 0)
    return true
  } catch (err) {
    if (err && err.code === 'ESRCH') return false
    if (err && err.code === 'ERR_INVALID_ARG_TYPE') return false
    // Windows EPERM or any other errno: assume alive, lease expiry is the fallback signal.
    return true
  }
}

// Tombstone-based recovery: called by workflow_cli before dispatching commands.
// Decisions:
//   - marker.phase === 'committing' → forward-commit (Phase 2 crash)
//   - otherwise → rollback destDir (Phase 1 crash or unrecognized marker)
//   - If marker's owner PID is still alive AND lease has not expired → skip entirely
//     (another process is still archiving; touching anything here would race).
function recoverArchiveTombstone(workflowDir) {
  const marker = readArchiveMarker(workflowDir)
  if (!marker) return { recovered: false }
  const data = marker.data || {}

  const leaseExpiresAt = data.lease_expires_at ? Date.parse(data.lease_expires_at) : 0
  const leaseValid = Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()
  const ownerPid = data.owner_pid != null ? Number(data.owner_pid) : null
  const ownerIsSelf = ownerPid && ownerPid === process.pid
  if (!ownerIsSelf && ownerPid && leaseValid && isArchiveOwnerAlive(ownerPid)) {
    return { recovered: false, reason: 'owner_alive', owner_pid: ownerPid, lease_expires_at: data.lease_expires_at }
  }

  const destDir = data.dest_dir || null
  const phase = data.phase || null

  if (phase === 'committing') {
    finalizeArchiveCommit(workflowDir, destDir)
    fs.rmSync(marker.path, { force: true })
    return { recovered: true, phase: 'phase2-forward-commit', dest_dir: destDir }
  }

  // Phase 'populating' or legacy v1 markers (no phase field) → roll destDir back.
  // The v1 signal (destState exists == Phase 2 done) was unsafe because Phase 1
  // writes destState before copying tasks/changes; legacy markers must rollback.
  if (destDir && fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true })
  fs.rmSync(marker.path, { force: true })
  return { recovered: true, phase: 'phase1-rollback', dest_dir: destDir }
}

function finalizeArchiveCommit(workflowDir, destDir) {
  const rootState = path.join(workflowDir, 'workflow-state.json')
  const rootStateLock = `${rootState}.lock`
  if (fs.existsSync(rootState)) fs.rmSync(rootState, { force: true })
  if (fs.existsSync(rootStateLock)) fs.rmSync(rootStateLock, { force: true })
  const rootTasks = path.join(workflowDir, 'tasks.md')
  if (fs.existsSync(rootTasks)) fs.rmSync(rootTasks, { force: true })
  const rootChanges = path.join(workflowDir, 'changes')
  if (fs.existsSync(rootChanges)) {
    try {
      const remaining = fs.readdirSync(rootChanges)
      if (remaining.length === 0) fs.rmdirSync(rootChanges)
      else fs.rmSync(rootChanges, { recursive: true, force: true })
    } catch {}
  }
}

function cmdArchive(summary = false, projectId = null, projectRoot = null) {
  const [resolvedProjectId, , workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return { error: '没有可归档的工作流' }

  const normalizedState = ensureStateDefaults(state)
  if (normalizedState.status !== 'completed') return { error: '只有 completed 状态的工作流可以归档', state_status: normalizedState.status }

  const markerPath = path.join(workflowDir, ARCHIVE_MARKER_FILE)
  if (fs.existsSync(markerPath)) return { error: '检测到未完成的归档 tombstone，请先调用 recover 或手动清理', marker: markerPath }

  const timestamp = buildArchiveTimestamp()
  const slug = buildHistorySlug(normalizedState.task_name)
  // timestamp is produced by buildArchiveTimestamp as YYYYMMDD-HHMMSS.
  const yearMonth = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}`
  const historyRoot = path.join(workflowDir, 'history', yearMonth)
  const destDir = path.join(historyRoot, `${slug}-${timestamp}`)
  fs.mkdirSync(destDir, { recursive: true })

  const changesDir = path.join(workflowDir, 'changes')
  const plannedEntries = []
  if (fs.existsSync(changesDir)) {
    for (const entry of fs.readdirSync(changesDir).sort()) {
      if (!entry.startsWith('CHG-')) continue
      const source = path.join(changesDir, entry)
      if (!fs.statSync(source).isDirectory()) continue
      plannedEntries.push(entry)
    }
  }

  const startedAt = new Date().toISOString()
  const leaseExpiresAt = new Date(Date.now() + ARCHIVE_LEASE_MS).toISOString()
  writeArchiveMarker(workflowDir, {
    marker_version: ARCHIVE_MARKER_VERSION,
    project_id: resolvedProjectId,
    dest_dir: destDir,
    started_at: startedAt,
    lease_expires_at: leaseExpiresAt,
    owner_pid: process.pid,
    phase: 'populating',
    entries: plannedEntries,
  })

  // Phase 1: populate destDir (snapshot state, copy tasks.md, move CHG-*). Root remains intact
  // so active-workflow detection still works if we crash mid-flight. A recovery that lands in
  // the middle of this phase will see phase='populating' and roll destDir back.
  normalizedState.status = 'archived'
  normalizedState.halt_reason = null
  normalizedState.archived_at = new Date().toISOString()
  if (!normalizedState.delta_tracking) normalizedState.delta_tracking = {}
  normalizedState.delta_tracking.current_change = null
  fs.writeFileSync(path.join(destDir, 'workflow-state.json'), `${JSON.stringify(normalizedState, null, 2)}\n`)

  const rootTasks = path.join(workflowDir, 'tasks.md')
  if (fs.existsSync(rootTasks)) fs.copyFileSync(rootTasks, path.join(destDir, 'tasks.md'))

  const destChanges = path.join(destDir, 'changes')
  const archivedChanges = []
  if (plannedEntries.length) {
    fs.mkdirSync(destChanges, { recursive: true })
    for (const entry of plannedEntries) {
      const source = path.join(changesDir, entry)
      const destination = path.join(destChanges, entry)
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true })
      fs.renameSync(source, destination)
      archivedChanges.push(entry)
    }
  }

  let summaryPath = null
  if (summary) {
    summaryPath = path.join(destDir, `archive-summary-${timestamp}.md`)
    const progress = normalizedState.progress || {}
    fs.writeFileSync(summaryPath, ['# 工作流归档摘要', '', `- 项目 ID: ${resolvedProjectId}`, `- Task: ${normalizedState.task_name || 'N/A'}`, `- Spec: ${normalizedState.spec_file || 'N/A'}`, `- Plan: ${normalizedState.plan_file || 'N/A'}`, `- 已归档变更: ${archivedChanges.length ? archivedChanges.join(', ') : '无'}`, `- 已完成任务: ${(progress.completed || []).length}`, `- 已跳过任务: ${(progress.skipped || []).length}`, `- 失败任务: ${(progress.failed || []).length}`, ''].join('\n'))
  }

  // Transition to phase='committing'. This is the cut point that recoveries use to decide
  // whether to forward-commit (delete root) or rollback (delete destDir): everything up to
  // this point is still safely reversible.
  writeArchiveMarker(workflowDir, {
    marker_version: ARCHIVE_MARKER_VERSION,
    project_id: resolvedProjectId,
    dest_dir: destDir,
    started_at: startedAt,
    lease_expires_at: new Date(Date.now() + ARCHIVE_LEASE_MS).toISOString(),
    owner_pid: process.pid,
    phase: 'committing',
    entries: plannedEntries,
    archived_changes: archivedChanges,
  })

  // Phase 2: commit — remove root state/tasks/changes, then clear the tombstone.
  finalizeArchiveCommit(workflowDir, destDir)
  fs.rmSync(markerPath, { force: true })

  return {
    archived: true,
    project_id: resolvedProjectId,
    archived_changes: archivedChanges,
    history_dir: destDir,
    summary_file: summaryPath,
    workflow_status: 'archived',
  }
}

function cmdUnblock(dependency, projectId = null, projectRoot = null) {
  const [resolvedProjectId, root, , statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !statePath || !state) return { error: '没有活跃的工作流' }

  const dep = String(dependency || '').trim()
  if (!dep) return { error: '缺少要解除的依赖标识' }

  const normalizedState = ensureStateDefaults(state)
  markDependencyUnblocked(normalizedState, dep)

  const [, , tasksContent] = resolveStateAndTasks(resolvedProjectId, root)
  let newlyUnblocked = []
  if (tasksContent) {
    const tasks = parseTasksV2(tasksContent).map(taskToDict)
    const reconciliation = reconcileBlockedTasks(tasks, normalizedState.unblocked || [], ((normalizedState.progress || {}).blocked) || [])
    if (!normalizedState.progress) normalizedState.progress = {}
    normalizedState.progress.blocked = reconciliation.blocked
    newlyUnblocked = reconciliation.newly_unblocked
    const effective = deriveEffectiveStatus(normalizedState)
    if (effective.status === 'halted' && effective.halt_reason === 'dependency' && !reconciliation.blocked.length) {
      normalizedState.status = 'running'
      normalizedState.halt_reason = null
    }
  }

  writeState(statePath, normalizedState)
  return { unblocked: true, project_id: resolvedProjectId, dependency: dep, workflow_status: normalizedState.status, known_unblocked: normalizedState.unblocked || [], newly_unblocked_tasks: newlyUnblocked }
}

module.exports = {
  detectDeltaTrigger,
  cmdDelta,
  cmdDeltaInit,
  cmdDeltaImpact,
  cmdDeltaApply,
  cmdDeltaFail,
  cmdDeltaSync,
  cmdArchive,
  cmdUnblock,
  recoverArchiveTombstone,
  ARCHIVE_MARKER_FILE,
  ARCHIVE_MARKER_VERSION,
}
