#!/usr/bin/env node
/** @file delta/archive/unblock 命令 - 从 lifecycle_cmds.js 拆出的 delta 变更流转与归档/解除阻塞命令 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const {
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
const { createTaskSource } = require('./task_source')
const { deriveEffectiveStatus, ensureStateDefaults, buildDeviationRecord } = require('./workflow_types')
const { reconcileBlockedTasks } = require('./dependency_checker')

// S3 重基（FR-2 / carry-forward）：unblock/deltaSync 的 newly_unblocked / summary count
// 反查经 createTaskSource 工厂选 adapter——task-dir → TaskDirSource，仅 legacy plan.md → LegacyPlanMdSource（C-6/C-7：
// legacy workflow 的 unblock/deltaSync 仍能反查到 task，halted[dependency] 可恢复 running，不静默失效）。
// task-dir 记录承载 depends（task 间依赖）+ 可选 blocked_by（外部依赖键，存量字段）；reconcileBlockedTasks
// 比对 blocked_by 与 unblocked 集，task-dir 缺 blocked_by 时归一为 []，报告字段如实反映 task 源建模。
// quiet:true：unblock/sync 多次调用复用，迁移提示由 task_manager 首个命中处打印（进程内去重），避免刷屏。
// 工厂返回 null（task-dir + legacy plan.md 皆无）→ 空列表，保留现有「无源跳过 reconcile」行为，不回退正常流程。
function listSourceTasks(projectId, state, projectRoot) {
  const source = createTaskSource(state, { projectId, projectRoot, quiet: true })
  return source ? source.listTasks() : []
}
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

  // P4.2：删除旧的「写 plan.md/tasks.md task block」死写入路径（task_deltas 从未被填充 + 目标错指 plan.md）。
  // v2 下 task 增删改由 workflow-delta SKILL 经 `task-write` 整集重写 task-dir 完成（见 SKILL Step 6.1）；
  // delta apply 只做审计推进 + blocked 反查（cmdDeltaSync/cmdUnblock），不再触碰机器 task 源。
  // task_delta_summary 退化为审计计数（保留返回字段形状向后兼容）。
  const taskDeltaSummary = summarizeTaskDeltas(delta.task_deltas || [])

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

  // 2. 解除阻塞（task 反查走 TaskSource，不再 parseTasksV2(plan.md)）
  markDependencyUnblocked(normalizedState, dep)
  const tasks = listSourceTasks(resolvedProjectId, normalizedState, root)
  let newlyUnblocked = []
  if (tasks.length) {
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
  // 删根 task-dir（canonical 机器 task 源已 snapshot 进 destDir/tasks）；否则残留按 project-id 泄漏给下个 workflow（幽灵 task）。
  const rootTasksDir = path.join(workflowDir, 'tasks')
  if (fs.existsSync(rootTasksDir)) fs.rmSync(rootTasksDir, { recursive: true, force: true })
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

  // Snapshot canonical 机器 task 源 task-dir（每 task task.json/context.jsonl）。Phase 1 用 copy 不删源——
  // 若 populating 崩溃，recovery 回滚 destDir，根 tasks/ 完整保留；根目录删除留到 Phase 2 finalizeArchiveCommit。
  const rootTasksDir = path.join(workflowDir, 'tasks')
  let archivedTaskCount = 0
  if (fs.existsSync(rootTasksDir)) {
    fs.cpSync(rootTasksDir, path.join(destDir, 'tasks'), { recursive: true })
    try {
      archivedTaskCount = fs.readdirSync(rootTasksDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^T\d+$/.test(entry.name)).length
    } catch { archivedTaskCount = 0 }
  }

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
    fs.writeFileSync(summaryPath, ['# 工作流归档摘要', '', `- 项目 ID: ${resolvedProjectId}`, `- Task: ${normalizedState.task_name || 'N/A'}`, `- Spec: ${normalizedState.spec_file || 'N/A'}`, `- Plan: ${normalizedState.plan_file || 'N/A'}`, `- 已归档变更: ${archivedChanges.length ? archivedChanges.join(', ') : '无'}`, `- 已归档 task-dir 任务数: ${archivedTaskCount}`, `- 已完成任务: ${(progress.completed || []).length}`, `- 已跳过任务: ${(progress.skipped || []).length}`, `- 失败任务: ${(progress.failed || []).length}`, ''].join('\n'))
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
    archived_task_count: archivedTaskCount,
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

  // task 反查走 TaskSource（task-dir），不再 parseTasksV2(plan.md)。
  const tasks = listSourceTasks(resolvedProjectId, normalizedState, root)
  let newlyUnblocked = []
  if (tasks.length) {
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

// T8 cmdAcceptDeviation：用户在 retry 阶段"接受偏离更新 spec"时调用。
// 写入 deviation_log 审计记录 + 触发 spec-update 流程标记（实际 spec 文件编辑由 spec-update skill 完成）。
// 并发安全：state_manager.writeState 已实现 lock（state_manager.js:47-102 wx + PID + 30s TTL + ESRCH 探活），无需自建 lock。
// 调用前 CLI 层应做 hard stop 二次确认（用户显式 --confirmed）— 本函数不做用户交互。
function cmdAcceptDeviation(options = {}, projectId = null, projectRoot = null) {
  const { originalIntent, acceptedImplementation, specSection, requiresSpecReview, confirmed } = options
  if (!originalIntent || !acceptedImplementation) {
    return { error: '缺少 --original-intent / --accepted-impl' }
  }
  if (!confirmed) {
    return {
      error: 'hard stop: 偏离决策需显式确认',
      hint: '加 --confirmed 标志确认接受偏离，将记录 deviation_log 并标记 spec-update 待执行',
      preview: { original_intent: String(originalIntent).slice(0, 80), accepted_implementation: String(acceptedImplementation).slice(0, 80), spec_section: specSection || null },
    }
  }
  const [resolvedProjectId, root, , statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !statePath || !state) return { error: '没有活跃的工作流' }
  const normalizedState = ensureStateDefaults(state)

  const record = buildDeviationRecord({
    originalIntent,
    acceptedImplementation,
    specSection,
    requiresSpecReview: requiresSpecReview !== false,
  })
  if (!Array.isArray(normalizedState.deviation_log)) normalizedState.deviation_log = []
  normalizedState.deviation_log.push(record)

  writeState(statePath, normalizedState)
  return {
    accepted: true,
    project_id: resolvedProjectId,
    deviation: record,
    next_action: record.requires_spec_review
      ? '运行 /spec-update 把 accepted_implementation 写到 spec 文件对应 section，并触发 spec-review'
      : '偏离已审计但不需要 spec-review；下次 execute 末尾终审以更新后 spec 为基准',
    workflow_status: normalizedState.status,
  }
}

module.exports = {
  detectDeltaTrigger,
  cmdDeltaInit,
  cmdDeltaImpact,
  cmdDeltaApply,
  cmdDeltaFail,
  cmdDeltaSync,
  cmdArchive,
  cmdUnblock,
  cmdAcceptDeviation,
  recoverArchiveTombstone,
  ARCHIVE_MARKER_FILE,
  ARCHIVE_MARKER_VERSION,
}
