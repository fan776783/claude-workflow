const { parseTasksV2 } = require('../workflow/task_parser')

function normalizeBoundaryId(taskId = '', index = 0) {
  const match = String(taskId).match(/^T(\d+)$/)
  if (match) return `B${match[1]}`
  return `B${index + 1}`
}

function normalizeDepends(depends = [], idMap = new Map()) {
  return (depends || [])
    .filter((item) => item && item !== '无' && item.toLowerCase?.() !== 'none')
    .map((item) => idMap.get(item) || item)
}

function buildWorkerOwnershipMetadata(tasks = []) {
  return tasks.map((task) => ({
    boundary_id: task.id,
    owner: task.phase === 'planning' ? 'leader' : task.phase === 'review' ? 'reviewer' : 'executor',
    writable_required: task.phase === 'implement' || task.phase === 'fix',
    dispatch_ready: task.phase === 'planning',
  }))
}

function buildDispatchMetadata(tasks = []) {
  return {
    mode: 'internal-team-orchestrator',
    granularity: 'boundary-level',
    boundaries: tasks.map((task) => ({
      id: task.id,
      phase: task.phase || 'implement',
      dispatch_strategy: task.phase === 'implement' ? 'parallel-eligible' : 'sequential',
      ready: task.phase === 'planning',
    })),
  }
}

function buildStaticTeamTasks() {
  return [
    {
      id: 'B1',
      name: 'Generate planning artifacts',
      phase: 'planning',
      status: 'pending',
      depends: [],
      blocked_by: [],
      acceptance_criteria: ['生成 team spec / plan / task board / runtime state'],
      critical_constraints: ['只允许显式 /team 触发', '不自动升级 /workflow'],
      files: {},
    },
    {
      id: 'B2',
      name: 'Validate runtime artifacts',
      phase: 'planning',
      status: 'pending',
      depends: ['B1'],
      blocked_by: [],
      acceptance_criteria: ['start gate 可通过'],
      critical_constraints: ['spec/plan/team-state/task-board 缺一不可'],
      files: {},
    },
    {
      id: 'B3',
      name: 'Dispatch executable boundaries',
      phase: 'implement',
      status: 'pending',
      depends: ['B2'],
      blocked_by: [],
      acceptance_criteria: ['边界任务可进入执行'],
      critical_constraints: ['execute 阶段必须有可写 worker', 'team runtime 内部管理并行'],
      files: {},
    },
    {
      id: 'B4',
      name: 'Run team verification',
      phase: 'review',
      status: 'pending',
      depends: ['B3'],
      blocked_by: [],
      acceptance_criteria: ['team_review 写回且 verify 结论明确'],
      critical_constraints: ['不得跳过 verify 直接 completed'],
      files: {},
    },
    {
      id: 'B5',
      name: 'Repair failed boundaries',
      phase: 'fix',
      status: 'pending',
      depends: ['B4'],
      blocked_by: [],
      acceptance_criteria: ['仅失败边界进入修复循环'],
      critical_constraints: ['verify/fix loop 只回流失败边界'],
      files: {},
    },
  ]
}

function normalizeTaskPhase(phase = '') {
  const value = String(phase || '').toLowerCase()
  if (value === 'planning') return 'planning'
  if (value === 'review') return 'review'
  if (value === 'fix') return 'fix'
  return 'implement'
}

function buildTeamTasksFromPlan(planContent = '') {
  const workflowTasks = parseTasksV2(planContent)
  if (!Array.isArray(workflowTasks) || workflowTasks.length === 0) return buildStaticTeamTasks()

  const idMap = new Map()
  workflowTasks.forEach((task, index) => {
    idMap.set(task.id, normalizeBoundaryId(task.id, index))
  })

  return workflowTasks.map((task, index) => ({
    id: idMap.get(task.id) || normalizeBoundaryId(task.id, index),
    source_task_id: task.id,
    name: task.name || `Boundary ${index + 1}`,
    phase: normalizeTaskPhase(task.phase),
    status: task.status || 'pending',
    depends: normalizeDepends(task.depends, idMap),
    blocked_by: normalizeDepends(task.blocked_by, idMap),
    acceptance_criteria: [...(task.acceptance_criteria || [])],
    critical_constraints: [...(task.critical_constraints || [])],
    files: task.files || {},
    actions: [...(task.actions || [])],
    steps: [...(task.steps || [])],
    verification: task.verification || null,
    quality_gate: Boolean(task.quality_gate),
    spec_ref: task.spec_ref || null,
    plan_ref: task.plan_ref || null,
    requirement_ids: [...(task.requirement_ids || [])],
  }))
}

function buildTeamTasks(planContent = '') {
  return buildTeamTasksFromPlan(planContent)
}

function toWorkflowPlanTask(task = {}, index = 0) {
  const taskId = task.source_task_id || `T${index + 1}`
  const title = task.name || `Boundary ${index + 1}`
  const phase = task.phase || 'implement'
  const constraints = (task.critical_constraints || []).join(', ') || '无'
  const acceptance = (task.acceptance_criteria || []).join(', ') || '无'
  const depends = (task.depends || []).map((dep) => dep.replace(/^B/, 'T')).join(', ')
  const actions = (task.actions || []).join(', ') || 'execute'
  const steps = (task.steps || []).length
    ? task.steps.map((step) => `  - ${step.id}: ${step.description} → ${step.expected}${step.verification ? `（验证：${step.verification}）` : ''}`).join('\n')
    : '  - A1: 执行边界任务 → 输出结果（验证：结果可读）'

  return `## ${taskId}: ${title}
- **阶段**: ${phase}
- **关键约束**: ${constraints}
- **验收项**: ${acceptance}
- **依赖**: ${depends || '无'}
- **质量关卡**: ${task.quality_gate ? 'true' : 'false'}
- **状态**: ${task.status || 'pending'}
- **actions**: ${actions}
- **步骤**:
${steps}`
}

function buildPlanTasksMarkdown(tasks = buildStaticTeamTasks()) {
  return tasks.map((task, index) => toWorkflowPlanTask(task, index)).join('\n\n')
}

module.exports = {
  buildWorkerOwnershipMetadata,
  buildDispatchMetadata,
  buildStaticTeamTasks,
  buildTeamTasksFromPlan,
  buildTeamTasks,
  buildPlanTasksMarkdown,
}
