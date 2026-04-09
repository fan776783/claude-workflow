const fs = require('fs')
const path = require('path')

const { buildGovernanceRecord } = require('./governance')
const { VALID_PHASES, TERMINAL_PHASES, buildExecuteSummary, hasWritableWorker, inferTeamPhase, validateBoard, validateReviewState } = require('./phase-controller')
const { buildBoundaryClaims, buildDispatchMetadata, buildPlanTasksMarkdown, buildStaticTeamTasks, buildTeamTasks } = require('./planning-artifacts')
const {
  buildDiscussionArtifact,
  buildTechStackSummary,
  deriveTaskName,
  ensureProjectConfig,
  resolveRequirementInput,
  shouldRunDiscussion,
  shouldRunUxDesignGate,
  stableProjectId,
} = require('./planning-support')
const {
  buildMinimumTeamState,
  detectActiveTeamState,
  getTeamDir,
  getTeamStatePath,
  isReservedTeamIdentifier,
  readTeamState,
  validateActivationSource,
  writeTeamState,
} = require('./state-manager')
const { buildTaskBoardMarkdown, buildTeamTaskBoard, readTaskBoard, summarizeTaskBoard, writeTaskBoard } = require('./task-board-helpers')
const { buildTeamStatus } = require('./status-renderer')
const { loadTeamTemplates, renderTemplate } = require('./templates')

function detectProjectRoot(projectRoot) {
  return path.resolve(projectRoot || process.cwd())
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'team-run'
}

function assertExplicitTeamInvocation({ invocationSource, allowActiveFallback = false, teamId } = {}) {
  const explicitSources = new Set(['team-command', 'team-workflow'])
  if (!explicitSources.has(invocationSource || '')) {
    return {
      ok: false,
      error: 'team runtime 仅允许通过显式 /team 或 team-workflow 入口访问',
      invalid_fields: ['invocation_source'],
      next_action: 'use-explicit-team-entry',
    }
  }

  if (!teamId && !allowActiveFallback) {
    return {
      ok: false,
      error: '缺少 teamId；只有显式 /team command surface 才允许自动定位 active team runtime',
      invalid_fields: ['team_id'],
      next_action: 'pass-team-id-or-use-team-command',
    }
  }

  return { ok: true }
}

function resolveTeamStatePath({ projectId, teamId, invocationSource, allowActiveFallback = false } = {}) {
  const explicitGate = assertExplicitTeamInvocation({ invocationSource, allowActiveFallback, teamId })
  if (!explicitGate.ok) return explicitGate
  if (teamId) {
    if (isReservedTeamIdentifier(teamId)) {
      return {
        ok: false,
        error: 'team_id 包含保留哨兵值，疑似上层传入了脏 team 上下文',
        invalid_fields: ['team_id:reserved'],
        next_action: 'clear-inherited-team-context',
      }
    }
    return { ok: true, statePath: getTeamStatePath(projectId, teamId) }
  }
  return { ok: true, statePath: detectActiveTeamState(projectId) }
}

function resolveCleanupStatePath({ projectId, teamId, invocationSource } = {}) {
  if (!teamId) {
    return {
      ok: false,
      error: '缺少 teamId；/team cleanup 只允许显式指定已归档的目标 runtime',
      invalid_fields: ['team_id'],
      next_action: 'pass-team-id-to-cleanup',
    }
  }
  const explicitGate = assertExplicitTeamInvocation({ invocationSource, allowActiveFallback: false, teamId })
  if (!explicitGate.ok) return explicitGate
  if (!teamId) {
    return {
      ok: false,
      error: '缺少 teamId；/team cleanup 只允许显式指定已归档的目标 runtime',
      invalid_fields: ['team_id'],
      next_action: 'pass-team-id-to-cleanup',
    }
  }
  if (isReservedTeamIdentifier(teamId)) {
    return {
      ok: false,
      error: 'team_id 包含保留哨兵值，疑似上层传入了脏 team 上下文',
      invalid_fields: ['team_id:reserved'],
      next_action: 'clear-inherited-team-context',
    }
  }
  return { ok: true, statePath: getTeamStatePath(projectId, teamId) }
}

function validateResolvedTeamState(state) {
  if (isReservedTeamIdentifier(state?.team_id) || isReservedTeamIdentifier(state?.team_name)) {
    return {
      ok: false,
      error: 'team runtime 包含保留哨兵值，疑似继承了脏 team 上下文',
      invalid_fields: ['team_identity:reserved'],
      next_action: 'repair-team-runtime-or-clear-stale-context',
    }
  }
  if (!validateActivationSource(state?.activation)) {
    return {
      ok: false,
      error: 'team runtime 缺少合法的显式入口来源，禁止继续消费',
      invalid_fields: ['activation'],
      next_action: 'rerun-team-start-via-explicit-entry',
    }
  }
  return { ok: true }
}

function validateStartArtifacts({ specPath, planPath, teamTasksPath, statePath, taskBoardPath, board, dispatchMetadata, state }) {
  const missingArtifacts = []
  const invalidFields = []

  for (const [targetPath, label] of [[specPath, 'spec_file'], [planPath, 'plan_file'], [teamTasksPath, 'team_tasks_markdown'], [statePath, 'team_state'], [taskBoardPath, 'team_tasks_file']]) {
    if (!targetPath || !fs.existsSync(targetPath)) missingArtifacts.push(label)
  }

  const boardValidation = validateBoard(board)
  if (!boardValidation.ok) invalidFields.push(boardValidation.error)
  if (!state?.boundary_claims || typeof state.boundary_claims !== 'object' || Object.keys(state.boundary_claims).length === 0) invalidFields.push('boundary_claims')
  if (!dispatchMetadata || !Array.isArray(dispatchMetadata.boundaries) || dispatchMetadata.boundaries.length === 0) invalidFields.push('dispatch_metadata')
  if (!Array.isArray(state?.worker_roster) || state.worker_roster.length === 0) invalidFields.push('worker_roster')

  return {
    ok: missingArtifacts.length === 0 && invalidFields.length === 0,
    missing_artifacts: missingArtifacts,
    invalid_fields: invalidFields,
  }
}

function cmdTeamStart(requirement, { projectId, projectRoot, force = false, noDiscuss = false, teamName, invocationSource = 'team-command' } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const { config, configHealed } = ensureProjectConfig(root, resolvedProjectId)

  const explicitStartGate = assertExplicitTeamInvocation({ invocationSource, allowActiveFallback: true, teamId: 'bootstrap' })
  if (!explicitStartGate.ok) {
    return {
      error: explicitStartGate.error,
      project_id: resolvedProjectId,
      invalid_fields: explicitStartGate.invalid_fields,
      next_action: explicitStartGate.next_action,
    }
  }

  const activeState = detectActiveTeamState(resolvedProjectId)
  if (activeState && !force) {
    const existing = readTeamState(activeState, resolvedProjectId)
    return { error: '已存在未归档 team runtime，请先 archive 或使用 --force 重新 bootstrap', project_id: resolvedProjectId, team_id: existing.team_id, state_status: existing.status }
  }

  const { requirementSource, requirementText, sourcePath } = resolveRequirementInput(requirement, root)
  const taskName = deriveTaskName(requirementText, sourcePath)
  if (isReservedTeamIdentifier(teamName) || isReservedTeamIdentifier(taskName)) {
    return {
      error: 'team 名称包含保留哨兵值，疑似上层传入了脏 team 上下文',
      project_id: resolvedProjectId,
      invalid_fields: ['team_name:reserved'],
      next_action: 'clear-inherited-team-context',
    }
  }
  const teamId = slugify(teamName || taskName)
  const resolvedTeamName = teamName || taskName
  const { specTemplate, planTemplate } = loadTeamTemplates(__dirname)
  const now = new Date().toISOString()
  const summary = (requirementText.trim().split(/\n/)[0] || taskName).slice(0, 120)

  const specRelative = path.join('.claude', 'specs', `${teamId}.team.md`)
  const planRelative = path.join('.claude', 'plans', `${teamId}.team.md`)
  const teamTasksRelative = path.join('.claude', 'plans', `${teamId}.team-tasks.md`)
  const specPath = path.join(root, specRelative)
  const planPath = path.join(root, planRelative)
  const teamTasksPath = path.join(root, teamTasksRelative)

  if (!force) {
    for (const [targetPath, label] of [[specPath, 'Spec'], [planPath, 'Plan'], [teamTasksPath, 'Team planning task list']]) {
      if (fs.existsSync(targetPath)) return { error: `${label} 已存在: ${path.relative(root, targetPath)}` }
    }
  }

  const discussionRequired = shouldRunDiscussion(requirementText, requirementSource, { noDiscuss })
  const discussionArtifact = buildDiscussionArtifact(requirementSource)
  const uxRequired = shouldRunUxDesignGate(requirementText, config)

  const specContent = renderTemplate(specTemplate, {
    requirement_source: requirementSource,
    created_at: now,
    task_name: `${taskName} (Team)`,
    context_summary: `- 原始需求来源: ${requirementSource}\n- Team mode: explicit invocation only\n- 需求摘要: ${summary}`,
    scope_summary: `- R1: ${summary}`,
    out_of_scope_summary: '- 不自动从 /workflow、/quick-plan、关键词触发 team mode',
    blocked_summary: '- 无',
    critical_constraints: '- Team mode 必须显式通过 /team 进入\n- 不得因 parallel-boundaries 自动升级为 team mode\n- 保持现有 /workflow 语义不变',
    user_facing_behavior: `- 以 team 模式协作完成：${summary}`,
    architecture_summary: '- 以独立 team runtime bootstrap team-specific planning / execution / verify / fix\n- shared helpers 仅作为 team runtime 内部实现积木，不直接暴露为 workflow-planning 复用链路\n- 并行能力由 team runtime 内部管理，不直接调用 dispatching-parallel-agents 作为外层编排器',
    file_structure: `- ${specRelative}\n- ${planRelative}\n- ${teamTasksRelative}`,
    acceptance_criteria: `- [ ] ${summary}\n- [ ] Team mode 保持显式触发\n- [ ] 现有 /workflow 不被自动升级`,
    implementation_slices: '- Slice 1：生成 team 规划工件\n- Slice 2：拆分 team work packages\n- Slice 3：进入 execute / verify / fix 生命周期',
  })

  const seedTasks = buildStaticTeamTasks()
  const planContent = renderTemplate(planTemplate, {
    requirement_source: requirementSource,
    created_at: now,
    spec_file: specRelative,
    task_name: `${taskName} (Team)`,
    goal: summary,
    architecture_summary: 'team runtime bootstrap 负责生成 team-specific planning artifacts 与多实例协调；shared helpers 仅作为内部实现积木复用，team mode 显式触发，不自动升级。',
    tech_stack: buildTechStackSummary(config),
    files_create: `- ${specRelative}\n- ${planRelative}\n- ${teamTasksRelative}`,
    files_modify: '- 无',
    files_test: '- 无',
    tasks: buildPlanTasksMarkdown(seedTasks),
  })

  const tasks = buildTeamTasks(planContent)
  const dispatchMetadata = buildDispatchMetadata(tasks)
  const boundaryClaims = buildBoundaryClaims(tasks)
  const board = buildTeamTaskBoard(tasks).map((item) => ({
    ...item,
    claim: boundaryClaims[item.id] || null,
  }))
  fs.mkdirSync(path.dirname(specPath), { recursive: true })
  fs.mkdirSync(path.dirname(planPath), { recursive: true })
  fs.writeFileSync(specPath, specContent)
  fs.writeFileSync(planPath, planContent)
  fs.writeFileSync(teamTasksPath, buildTaskBoardMarkdown(planContent))

  const teamDir = getTeamDir(resolvedProjectId, teamId)
  if (!teamDir) return { error: '无法解析 team runtime 目录' }
  fs.mkdirSync(teamDir, { recursive: true })
  const taskBoardPath = path.join(teamDir, 'team-task-board.json')
  writeTaskBoard(taskBoardPath, board)

  const state = buildMinimumTeamState({
    projectId: resolvedProjectId,
    teamId,
    teamName: resolvedTeamName,
    projectRoot: root,
    specFile: specRelative,
    planFile: planRelative,
    teamTasksFile: taskBoardPath,
    activation: {
      mode: invocationSource === 'team-workflow' ? 'explicit-team-workflow' : 'explicit-team-command',
      entry: invocationSource === 'team-workflow' ? 'team-workflow' : 'team',
      auto_trigger_allowed: false,
    },
  })
  state.requirement_source = requirementSource
  state.discussion_required = discussionRequired
  state.discussion_artifact = discussionArtifact
  state.ux_gate_required = uxRequired
  state.governance = buildGovernanceRecord()
  state.worker_roster = [
    { name: 'orchestrator', role: 'orchestrator', status: 'running', writable: false },
    { name: 'implementer', role: 'implementer', status: 'idle', writable: true },
    { name: 'reviewer', role: 'reviewer', status: 'idle', writable: false },
  ]
  state.dispatch_batches = []
  state.boundary_claims = boundaryClaims
  state.dispatch_metadata = dispatchMetadata
  const statePath = getTeamStatePath(resolvedProjectId, teamId)
  if (!statePath) return { error: '无法解析 team state 路径' }
  writeTeamState(statePath, state, resolvedProjectId, teamId)

  const startGate = validateStartArtifacts({ specPath, planPath, teamTasksPath, statePath, taskBoardPath, board, dispatchMetadata, state })
  if (!startGate.ok) {
    return {
      error: 'team runtime bootstrap gate failed',
      project_id: resolvedProjectId,
      team_id: teamId,
      missing_artifacts: startGate.missing_artifacts,
      invalid_fields: startGate.invalid_fields,
      next_action: 'repair-team-runtime-or-rerun-team-start',
    }
  }

  return {
    started: true,
    bootstrapped: true,
    mode: 'team',
    planning_scope: 'team-specific',
    explicit_invocation_only: true,
    team_runtime_bootstrapped: true,
    project_id: resolvedProjectId,
    team_id: teamId,
    team_name: resolvedTeamName,
    team_phase: state.team_phase,
    config_healed: configHealed,
    state_path: statePath,
    spec_file: specRelative,
    plan_file: planRelative,
    team_tasks_file: taskBoardPath,
    task_summary: summarizeTaskBoard(board),
  }
}

function validateExecutePreconditions(state, board) {
  const missingArtifacts = []
  const invalidFields = []

  const currentPhase = state?.team_phase
  if (!VALID_PHASES.has(currentPhase)) {
    invalidFields.push(`team_phase:${String(currentPhase || '')}`)
  }

  const requiredFields = ['project_id', 'team_id', 'team_name', 'status', 'team_phase', 'spec_file', 'plan_file', 'team_tasks_file', 'worker_roster', 'boundary_claims', 'team_review', 'fix_loop']
  for (const field of requiredFields) {
    if (state?.[field] == null) invalidFields.push(field)
  }

  for (const [field, label] of [[state?.spec_file, 'spec_file'], [state?.plan_file, 'plan_file'], [state?.team_tasks_file, 'team_tasks_file']]) {
    if (!field || typeof field !== 'string') {
      missingArtifacts.push(label)
      continue
    }
    const targetPath = path.isAbsolute(field) ? field : path.join(detectProjectRoot(state.project_root), field)
    if (!fs.existsSync(targetPath)) missingArtifacts.push(label)
  }

  const boardValidation = validateBoard(board)
  if (!boardValidation.ok) {
    invalidFields.push(boardValidation.error)
  }

  if (currentPhase === 'team-exec' && !hasWritableWorker(state.worker_roster)) {
    invalidFields.push('worker_roster:missing_writable_worker')
  }

  if (currentPhase === 'team-fix') {
    const failedBoundaries = state?.fix_loop?.current_failed_boundaries
    if (!Array.isArray(failedBoundaries) || failedBoundaries.length === 0) {
      invalidFields.push('fix_loop.current_failed_boundaries')
    }
  }

  return {
    ok: missingArtifacts.length === 0 && invalidFields.length === 0,
    missing_artifacts: missingArtifacts,
    invalid_fields: invalidFields,
  }
}

function validateArchivePreconditions(state, board) {
  const phase = inferTeamPhase(board, state.team_phase || 'team-plan', { state })
  const reviewCheck = validateReviewState(state, board)

  if (phase === 'archived') {
    return { ok: false, error: 'team runtime already archived', team_phase: phase, status: state.status }
  }

  if (phase === 'team-exec' || phase === 'team-fix') {
    return { ok: false, error: 'cannot archive active team runtime', team_phase: phase, status: state.status }
  }

  if (phase === 'team-verify' && !reviewCheck.ok) {
    return { ok: false, error: 'cannot archive before valid team runtime review', team_phase: phase, status: state.status, invalid_fields: [reviewCheck.reason] }
  }

  if (!['team-verify', 'completed', 'failed'].includes(phase) && state.status !== 'completed') {
    return { ok: false, error: 'team runtime not ready for archive', team_phase: phase, status: state.status }
  }

  return { ok: true, team_phase: phase }
}

function cmdTeamExecute({ projectId, projectRoot, teamId, invocationSource, allowActiveFallback = false } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const resolvedState = resolveTeamStatePath({ projectId: resolvedProjectId, teamId, invocationSource, allowActiveFallback })
  if (!resolvedState.ok) {
    return {
      error: resolvedState.error,
      project_id: resolvedProjectId,
      invalid_fields: resolvedState.invalid_fields || [],
      next_action: resolvedState.next_action,
    }
  }

  const statePath = resolvedState.statePath
  if (!statePath) return { error: '没有活动 team runtime，请先执行 /team start 完成 bootstrap' }

  const state = readTeamState(statePath, resolvedProjectId, teamId)
  const stateValidation = validateResolvedTeamState(state)
  if (!stateValidation.ok) {
    return {
      error: stateValidation.error,
      project_id: resolvedProjectId,
      team_id: state.team_id,
      invalid_fields: stateValidation.invalid_fields,
      next_action: stateValidation.next_action,
    }
  }
  const board = readTaskBoard(state.team_tasks_file)
  const currentPhase = state.team_phase || 'team-plan'
  const gate = validateExecutePreconditions(state, board)

  if (!gate.ok) {
    return {
      error: 'team runtime execute gate failed',
      project_id: resolvedProjectId,
      team_id: state.team_id,
      team_phase: currentPhase,
      missing_artifacts: gate.missing_artifacts,
      invalid_fields: gate.invalid_fields,
      next_action: 'repair-team-runtime-or-rerun-team-start',
    }
  }

  if (TERMINAL_PHASES.has(currentPhase)) {
    return {
      error: 'team runtime execute gate failed',
      project_id: resolvedProjectId,
      team_id: state.team_id,
      team_phase: currentPhase,
      missing_artifacts: [],
      invalid_fields: [`terminal_phase:${currentPhase}`],
      next_action: currentPhase === 'archived' ? 'start-new-team-run' : 'archive-or-start-new-team-run',
    }
  }

  if (currentPhase === 'team-plan') {
    const planningPending = board.filter((item) => item.phase === 'planning' && item.status === 'pending').map((item) => item.id)
    if (planningPending.length > 0) {
      state.team_phase = 'team-plan'
      state.status = 'planning'
      state.current_tasks = planningPending.slice(0, 1)
    } else {
      state.team_phase = 'team-exec'
      state.status = 'running'
      state.current_tasks = board.filter((item) => item.phase === 'implement' && item.status === 'pending').slice(0, 1).map((item) => item.id)
    }
  } else {
    const inferredPhase = inferTeamPhase(board, currentPhase, { state })
    if (inferredPhase === 'team-verify') {
      const reviewCheck = validateReviewState(state, board)
      if (reviewCheck.ok && reviewCheck.decision === 'completed') {
        state.team_phase = 'completed'
        state.status = 'completed'
        state.current_tasks = []
      } else if (reviewCheck.ok && reviewCheck.decision === 'team-fix') {
        state.team_phase = 'team-fix'
        state.status = 'failed'
        state.fix_loop = state.fix_loop || { attempt: 0, current_failed_boundaries: [] }
        state.fix_loop.attempt += 1
        state.fix_loop.current_failed_boundaries = reviewCheck.failed_boundaries
      } else {
        state.team_phase = 'team-verify'
        state.status = 'paused'
        state.current_tasks = []
      }
    } else if (inferredPhase === 'team-fix') {
      state.team_phase = 'team-fix'
      state.status = 'failed'
      state.fix_loop = state.fix_loop || { attempt: 0, current_failed_boundaries: [] }
      state.fix_loop.attempt += 1
      state.fix_loop.current_failed_boundaries = board.filter((item) => item.status === 'failed').map((item) => item.id)
    } else if (inferredPhase === 'completed') {
      state.team_phase = 'completed'
      state.status = 'completed'
      state.current_tasks = []
    } else if (inferredPhase === 'failed') {
      state.team_phase = 'failed'
      state.status = 'failed'
      state.current_tasks = []
    } else {
      state.team_phase = inferredPhase
      state.status = 'running'
    }
  }

  const summary = buildExecuteSummary(state, board)
  writeTeamState(statePath, state, resolvedProjectId, state.team_id)
  return {
    executed: true,
    runtime_progressed: true,
    execution_scope: 'team-runtime-only',
    project_id: resolvedProjectId,
    team_id: state.team_id,
    status: state.status,
    governance: state.governance,
    ...summary,
  }
}

function cmdTeamStatus({ projectId, projectRoot, teamId, invocationSource, allowActiveFallback = false } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const resolvedState = resolveTeamStatePath({ projectId: resolvedProjectId, teamId, invocationSource, allowActiveFallback })
  if (!resolvedState.ok) {
    return {
      error: resolvedState.error,
      project_id: resolvedProjectId,
      invalid_fields: resolvedState.invalid_fields || [],
      next_action: resolvedState.next_action,
    }
  }
  const statePath = resolvedState.statePath
  if (!statePath) return { error: '没有活动 team runtime，请先执行 /team start 完成 bootstrap' }
  const state = readTeamState(statePath, resolvedProjectId, teamId)
  const stateValidation = validateResolvedTeamState(state)
  if (!stateValidation.ok) {
    return {
      error: stateValidation.error,
      project_id: resolvedProjectId,
      team_id: state.team_id,
      invalid_fields: stateValidation.invalid_fields,
      next_action: stateValidation.next_action,
    }
  }
  const board = readTaskBoard(state.team_tasks_file)
  return buildTeamStatus(state, board)
}

function cmdTeamArchive({ projectId, projectRoot, teamId, summary = false, invocationSource, allowActiveFallback = false } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const resolvedState = resolveTeamStatePath({ projectId: resolvedProjectId, teamId, invocationSource, allowActiveFallback })
  if (!resolvedState.ok) {
    return {
      error: resolvedState.error,
      project_id: resolvedProjectId,
      invalid_fields: resolvedState.invalid_fields || [],
      next_action: resolvedState.next_action,
    }
  }
  const statePath = resolvedState.statePath
  if (!statePath) return { error: '没有可归档的 team runtime' }
  const state = readTeamState(statePath, resolvedProjectId, teamId)
  const stateValidation = validateResolvedTeamState(state)
  if (!stateValidation.ok) {
    return {
      error: stateValidation.error,
      project_id: resolvedProjectId,
      team_id: state.team_id,
      invalid_fields: stateValidation.invalid_fields,
      next_action: stateValidation.next_action,
    }
  }
  const board = readTaskBoard(state.team_tasks_file)
  const gate = validateArchivePreconditions(state, board)
  if (!gate.ok) {
    return {
      error: gate.error,
      team_phase: gate.team_phase,
      status: gate.status,
      invalid_fields: gate.invalid_fields || [],
    }
  }
  state.status = 'archived'
  state.team_phase = 'archived'
  if (summary) {
    state.archive_summary = { archived_at: new Date().toISOString(), task_summary: summarizeTaskBoard(board), review: state.team_review || null }
  }
  writeTeamState(statePath, state, resolvedProjectId, state.team_id)
  return { archived: true, project_id: resolvedProjectId, team_id: state.team_id, state_path: statePath, team_phase: state.team_phase }
}

function cmdTeamCleanup({ projectId, projectRoot, teamId, invocationSource } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const resolvedState = resolveCleanupStatePath({ projectId: resolvedProjectId, teamId, invocationSource })
  if (!resolvedState.ok) {
    return {
      error: resolvedState.error,
      project_id: resolvedProjectId,
      invalid_fields: resolvedState.invalid_fields || [],
      next_action: resolvedState.next_action,
    }
  }

  const statePath = resolvedState.statePath
  if (!statePath || !fs.existsSync(statePath)) {
    return { error: '没有可清理的 team runtime', project_id: resolvedProjectId, next_action: 'pass-team-id-or-check-team-status' }
  }

  const state = readTeamState(statePath, resolvedProjectId, teamId)
  const stateValidation = validateResolvedTeamState(state)
  if (!stateValidation.ok) {
    return {
      error: stateValidation.error,
      project_id: resolvedProjectId,
      team_id: state.team_id,
      invalid_fields: stateValidation.invalid_fields,
      next_action: stateValidation.next_action,
    }
  }

  if (state.status !== 'archived' && state.team_phase !== 'archived') {
    return {
      error: 'cannot cleanup non-archived team runtime',
      project_id: resolvedProjectId,
      team_id: state.team_id,
      team_phase: state.team_phase,
      status: state.status,
      next_action: 'archive-team-runtime-first',
    }
  }

  const activeWorkers = (state.worker_roster || []).filter((worker) => !['completed', 'failed', 'offline', 'idle'].includes(worker.status))
  if (activeWorkers.length > 0) {
    return {
      error: 'cannot cleanup team runtime with active workers',
      project_id: resolvedProjectId,
      team_id: state.team_id,
      active_workers: activeWorkers.map((worker) => worker.worker_id || worker.name || worker.role),
      next_action: 'shutdown-or-wait-for-workers-before-cleanup',
    }
  }

  const teamDir = getTeamDir(resolvedProjectId, state.team_id)
  if (!teamDir || !fs.existsSync(teamDir)) {
    return {
      error: '没有可清理的 team runtime',
      project_id: resolvedProjectId,
      team_id: state.team_id,
      next_action: 'check-team-runtime-path',
    }
  }

  fs.rmSync(teamDir, { recursive: true, force: false })
  return {
    cleaned: true,
    project_id: resolvedProjectId,
    team_id: state.team_id,
    removed_runtime_dir: teamDir,
    preserved_artifacts: {
      spec_file: state.spec_file,
      plan_file: state.plan_file,
    },
  }
}

module.exports = {
  validateStartArtifacts,
  validateExecutePreconditions,
  validateArchivePreconditions,
  cmdTeamStart,
  cmdTeamExecute,
  cmdTeamStatus,
  cmdTeamArchive,
  cmdTeamCleanup,
}
