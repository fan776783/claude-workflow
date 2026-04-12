/** Team 规划产物构建 —— 负责从 plan 内容生成 team 任务面板、边界认领、分派元数据和 Markdown 输出 */

const { parseTasksV2 } = require('../workflow/task_parser')

/**
 * 将任务 ID 从 T 前缀格式转换为 B 前缀的边界 ID
 * @param {string} taskId - 原始任务 ID
 * @param {number} index - 任务在列表中的索引
 * @returns {string} 边界 ID（如 B1、B2）
 */
function normalizeBoundaryId(taskId = '', index = 0) {
  const match = String(taskId).match(/^T(\d+)$/)
  if (match) return `B${match[1]}`
  return `B${index + 1}`
}

/**
 * 规范化依赖列表，过滤无效值并映射 ID
 * @param {string[]} depends - 原始依赖 ID 列表
 * @param {Map<string,string>} idMap - 原始 ID 到边界 ID 的映射
 * @returns {string[]} 规范化后的依赖列表
 */
function normalizeDepends(depends = [], idMap = new Map()) {
  return (depends || [])
    .filter((item) => item && item !== '无' && item.toLowerCase?.() !== 'none')
    .map((item) => idMap.get(item) || item)
}

/**
 * 根据阶段名称返回对应角色
 * @param {string} phase - 阶段名称
 * @returns {string} 角色名（planner / reviewer / implementer）
 */
function roleForPhase(phase = '') {
  if (phase === 'planning') return 'planner'
  if (phase === 'review') return 'reviewer'
  return 'implementer'
}

/**
 * 根据角色返回默认的 profile 引用配置
 * @param {string} role - 角色名
 * @returns {object|null} profile 引用对象，无匹配时返回 null
 */
function defaultProfileRef(role = '') {
  if (role === 'planner') return { phase: 'plan_generation', role: 'planner', profile: 'plan-planner', source: 'workflow-role-profiles' }
  if (role === 'reviewer') return { phase: 'quality_review_stage2', role: 'reviewer', profile: 'review-reviewer', source: 'workflow-role-profiles' }
  return null
}

/**
 * 为任务列表构建边界认领映射，每个边界初始为 unclaimed 状态
 * @param {object[]} tasks - 任务列表
 * @returns {object} 以任务 ID 为键的认领映射
 */
function buildBoundaryClaims(tasks = []) {
  return Object.fromEntries(tasks.map((task) => {
    const assignedRole = roleForPhase(task.phase)
    return [task.id, {
      assigned_role: assignedRole,
      current_worker_id: null,
      claim_status: 'unclaimed',
      claim_version: 0,
      attempt: 0,
      claimed_at: null,
      released_at: null,
      reassign_reason: null,
      history: [],
      profile_ref: defaultProfileRef(assignedRole),
    }]
  }))
}

/**
 * 构建分派元数据，描述每个边界的阶段、角色和分派策略
 * @param {object[]} tasks - 任务列表
 * @returns {object} 分派元数据，含 mode、granularity 和 boundaries
 */
function buildDispatchMetadata(tasks = []) {
  return {
    mode: 'internal-team-orchestrator',
    granularity: 'boundary-level',
    recommended_team_size: '3-5',
    use_team_only_when: 'shared-task-board-or-direct-teammate-communication-needed',
    boundaries: tasks.map((task) => ({
      id: task.id,
      phase: task.phase || 'implement',
      assigned_role: roleForPhase(task.phase),
      dispatch_strategy: task.phase === 'implement' ? 'parallel-eligible' : 'sequential',
      ready: task.phase === 'planning',
    })),
  }
}

/**
 * 构建静态的 team 默认任务列表（规划→验证→分派→审查→修复）
 * @returns {object[]} 5 个默认边界任务
 */
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
      critical_constraints: ['execute 阶段必须有可写 implementer', '独立任务优先队内并行，不需要协作时不滥用 /team'],
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
      critical_constraints: ['不得跳过 verify 直接 completed', 'idle 是正常信号，不等于失败'],
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

/**
 * 规范化阶段名称为合法值
 * @param {string} phase - 原始阶段名
 * @returns {string} 规范化后的阶段名（planning / review / fix / implement）
 */
function normalizeTaskPhase(phase = '') {
  const value = String(phase || '').toLowerCase()
  if (value === 'planning') return 'planning'
  if (value === 'review') return 'review'
  if (value === 'fix') return 'fix'
  return 'implement'
}

/**
 * 从 plan Markdown 内容解析并构建 team 任务列表，无法解析时回退到静态任务
 * @param {string} planContent - plan 文件的 Markdown 内容
 * @returns {object[]} team 任务列表
 */
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

/**
 * 构建 team 任务列表（buildTeamTasksFromPlan 的别名）
 * @param {string} planContent - plan 文件的 Markdown 内容
 * @returns {object[]} team 任务列表
 */
function buildTeamTasks(planContent = '') {
  return buildTeamTasksFromPlan(planContent)
}

/**
 * 将单个 team 任务转换为 workflow plan 格式的 Markdown 文本
 * @param {object} task - team 任务对象
 * @param {number} index - 任务索引
 * @returns {string} Markdown 格式的任务描述
 */
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

/**
 * 将任务列表批量转换为 Markdown 格式的 plan 文本
 * @param {object[]} tasks - team 任务列表
 * @returns {string} 拼接后的 Markdown 文本
 */
function buildPlanTasksMarkdown(tasks = buildStaticTeamTasks()) {
  return tasks.map((task, index) => toWorkflowPlanTask(task, index)).join('\n\n')
}

module.exports = {
  buildBoundaryClaims,
  buildDispatchMetadata,
  buildStaticTeamTasks,
  buildTeamTasksFromPlan,
  buildTeamTasks,
  buildPlanTasksMarkdown,
}
