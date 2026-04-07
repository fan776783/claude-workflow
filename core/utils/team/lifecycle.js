const fs = require('fs')
const path = require('path')

const { buildGovernanceRecord } = require('./governance')
const { buildExecuteSummary, inferTeamPhase } = require('./phase-controller')
const { buildPlanTasksMarkdown, buildTeamTasks } = require('./planning-artifacts')
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
  readTeamState,
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

function cmdTeamStart(requirement, { projectId, projectRoot, force = false, noDiscuss = false, teamName } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const { config, configHealed } = ensureProjectConfig(root, resolvedProjectId)

  const activeState = detectActiveTeamState(resolvedProjectId)
  if (activeState && !force) {
    const existing = readTeamState(activeState, resolvedProjectId)
    return { error: '已存在未归档 team run，请先 archive 或使用 --force 覆盖', project_id: resolvedProjectId, team_id: existing.team_id, state_status: existing.status }
  }

  const { requirementSource, requirementText, sourcePath } = resolveRequirementInput(requirement, root)
  const taskName = deriveTaskName(requirementText, sourcePath)
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
    for (const [targetPath, label] of [[specPath, 'Spec'], [planPath, 'Plan'], [teamTasksPath, 'Team task board']]) {
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
    architecture_summary: '- 以独立 team runtime 协调 planning / execution / verify / fix\n- 并行能力由 team runtime 内部管理，不直接调用 dispatching-parallel-agents 作为外层编排器',
    file_structure: `- ${specRelative}\n- ${planRelative}\n- ${teamTasksRelative}`,
    acceptance_criteria: `- [ ] ${summary}\n- [ ] Team mode 保持显式触发\n- [ ] 现有 /workflow 不被自动升级`,
    implementation_slices: '- Slice 1：生成 team 规划工件\n- Slice 2：拆分 team work packages\n- Slice 3：进入 execute / verify / fix 生命周期',
  })

  const planContent = renderTemplate(planTemplate, {
    requirement_source: requirementSource,
    created_at: now,
    spec_file: specRelative,
    task_name: `${taskName} (Team)`,
    goal: summary,
    architecture_summary: 'team runtime 负责多实例协调，workflow 能力作为内部 phase engine 复用；team mode 显式触发，不自动升级。',
    tech_stack: buildTechStackSummary(config),
    files_create: `- ${specRelative}\n- ${planRelative}\n- ${teamTasksRelative}`,
    files_modify: '- 无',
    files_test: '- 无',
    tasks: buildPlanTasksMarkdown(),
  })

  const tasks = buildTeamTasks()
  const board = buildTeamTaskBoard(tasks)
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
  })
  state.requirement_source = requirementSource
  state.discussion_required = discussionRequired
  state.discussion_artifact = discussionArtifact
  state.ux_gate_required = uxRequired
  state.governance = buildGovernanceRecord()
  state.worker_roster = [{ name: 'leader', role: 'orchestrator', status: 'active' }]
  const statePath = getTeamStatePath(resolvedProjectId, teamId)
  if (!statePath) return { error: '无法解析 team state 路径' }
  writeTeamState(statePath, state, resolvedProjectId, teamId)

  return {
    started: true,
    mode: 'team',
    explicit_invocation_only: true,
    project_id: resolvedProjectId,
    team_id: teamId,
    team_name: resolvedTeamName,
    config_healed: configHealed,
    state_path: statePath,
    spec_file: specRelative,
    plan_file: planRelative,
    team_tasks_file: taskBoardPath,
    task_summary: summarizeTaskBoard(board),
  }
}

function cmdTeamExecute({ projectId, projectRoot, teamId } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const statePath = teamId ? getTeamStatePath(resolvedProjectId, teamId) : detectActiveTeamState(resolvedProjectId)
  if (!statePath) return { error: '没有活动 team run，请先执行 /team start' }

  const state = readTeamState(statePath, resolvedProjectId, teamId)
  const board = readTaskBoard(state.team_tasks_file)
  const currentPhase = state.team_phase || 'team-plan'

  if (currentPhase === 'team-plan') {
    state.team_phase = 'team-exec'
    state.status = 'running'
    state.current_tasks = board.filter((item) => item.status === 'pending').slice(0, 1).map((item) => item.id)
  } else {
    state.team_phase = inferTeamPhase(board, currentPhase)
    if (state.team_phase === 'team-verify') {
      state.status = 'paused'
      state.current_tasks = []
    } else if (state.team_phase === 'team-fix') {
      state.status = 'failed'
      state.fix_loop = state.fix_loop || { attempt: 0, current_failed_boundaries: [] }
      state.fix_loop.attempt += 1
      state.fix_loop.current_failed_boundaries = board.filter((item) => item.status === 'failed').map((item) => item.id)
    } else {
      state.status = 'running'
    }
  }

  const summary = buildExecuteSummary(state, board)
  writeTeamState(statePath, state, resolvedProjectId, state.team_id)
  return { executed: true, project_id: resolvedProjectId, team_id: state.team_id, status: state.status, governance: state.governance, ...summary }
}

function cmdTeamStatus({ projectId, projectRoot, teamId } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const statePath = teamId ? getTeamStatePath(resolvedProjectId, teamId) : detectActiveTeamState(resolvedProjectId)
  if (!statePath) return { error: '没有活动 team run' }
  const state = readTeamState(statePath, resolvedProjectId, teamId)
  const board = readTaskBoard(state.team_tasks_file)
  return buildTeamStatus(state, board)
}

function cmdTeamArchive({ projectId, projectRoot, teamId, summary = false } = {}) {
  const root = detectProjectRoot(projectRoot)
  const resolvedProjectId = projectId || stableProjectId(root)
  const statePath = teamId ? getTeamStatePath(resolvedProjectId, teamId) : detectActiveTeamState(resolvedProjectId)
  if (!statePath) return { error: '没有可归档的 team run' }
  const state = readTeamState(statePath, resolvedProjectId, teamId)
  const board = readTaskBoard(state.team_tasks_file)
  const phase = inferTeamPhase(board, state.team_phase || 'team-plan')
  if (!['team-verify', 'completed'].includes(phase) && state.status !== 'completed') {
    return { error: '只有 team-verify 或 completed 状态的 team run 可以归档', team_phase: phase, status: state.status }
  }
  state.status = 'archived'
  state.team_phase = 'archived'
  if (summary) {
    state.archive_summary = { archived_at: new Date().toISOString(), task_summary: summarizeTaskBoard(board) }
  }
  writeTeamState(statePath, state, resolvedProjectId, state.team_id)
  return { archived: true, project_id: resolvedProjectId, team_id: state.team_id, state_path: statePath, team_phase: state.team_phase }
}

module.exports = {
  cmdTeamStart,
  cmdTeamExecute,
  cmdTeamStatus,
  cmdTeamArchive,
}
