#!/usr/bin/env node

// TaskSource seam（spec §5.5.2）—— sequencer 依赖此抽象而非具体 task 来源。
//
// 接口 TaskSource:
//   listTasks()   → task 记录数组（稳定排序）
//   getTask(id)   → 单 task 记录 | null
//   firstTaskId() → 第一个 task 的 id | null（resume 起点 current_tasks[0] 的可复现来源）
//
// 两个 adapter（C-7 存量兼容）：
//   TaskDirSource(pid)            —— B-full 新流程，委托 task_store 读 task-dir
//   LegacyPlanMdSource(state/...) —— 存量 plan.md workflow 兼容读，复用 parseTasksV2（C-7 不静默失效）
//
// createTaskSource(state) 工厂按 state 选 adapter：
//   有 task-dir（tasks/ 非空）            → TaskDirSource
//   仅有 legacy plan.md（无 task-dir）    → LegacyPlanMdSource（命中时 stderr 打印迁移提示）
//   二者皆无                              → null（调用方走 assertTaskSourcePresent 报 task_source_missing）

const fs = require('fs')
const taskStore = require('./task_store')
const { parseTasksV2, updateTaskStatusInMarkdown } = require('./task_parser')

// lazy require 断循环依赖：task_manager 顶层 require('./task_source') 取 TaskDirSource，
// 若此处顶层反向 require('./task_manager') 会拿到半初始化模块。改运行时取。
function tm() {
  return require('./task_manager')
}

// TaskDirSource —— 委托 task_store，task 源 = task-dir。
// listTasks/firstTaskId 顺序由 task_store.listTasks 的 taskId 数字序保证稳定确定（C-1）。
class TaskDirSource {
  constructor(projectId) {
    this.projectId = projectId
  }

  listTasks() {
    return taskStore.listTasks(this.projectId)
  }

  getTask(taskId) {
    return taskStore.readTask(this.projectId, taskId)
  }

  firstTaskId() {
    const tasks = this.listTasks()
    return tasks.length ? tasks[0].id : null
  }

  // 状态回写落 task-dir（task_store.updateTaskStatus）。task 不存在 → 抛错（与 task_store 契约一致）。
  updateTaskStatus(taskId, newStatus) {
    return taskStore.updateTaskStatus(this.projectId, taskId, newStatus)
  }
}

// parseTasksV2 输出 → TaskSource 记录形状（与 task_store.normalizeTaskRecord 对齐）。
// 下游 scoped 注入只认 task.package / task.target_layer / task.depends / task.status —— 与 TaskDirSource 一致。
// acceptance_criteria（plan.md 字段）映射为 acceptance（task-dir 字段）。
function legacyTaskToRecord(task) {
  return {
    id: String(task.id || ''),
    name: task.name ? String(task.name).trim() : '',
    phase: task.phase || 'implement',
    package: task.package ? String(task.package).trim() : '',
    target_layer: task.target_layer || '',
    depends: Array.isArray(task.depends) ? task.depends.map((d) => String(d).trim()).filter(Boolean) : [],
    status: task.status || 'pending',
    acceptance: Array.isArray(task.acceptance_criteria) ? [...task.acceptance_criteria] : [],
    // verification（{commands,expected_output,notes}）保留，供 pre-execute-inject 注入 <verification-commands>。
    verification: task.verification && typeof task.verification === 'object' ? task.verification : null,
    interaction: task.interaction || 'AFK',
    // blocked_by 为 plan.md 时代字段，部分消费者（cmdDeps）仍读，保留以兼容。
    blocked_by: Array.isArray(task.blocked_by) ? [...task.blocked_by] : [],
    // requirement_ids/quality_gate 透传 parseTasksV2 同名字段，legacy plan.md 的 coverage 比对继续可用。
    requirement_ids: Array.isArray(task.requirement_ids) ? [...task.requirement_ids] : [],
    quality_gate: Boolean(task.quality_gate),
  }
}

// LegacyPlanMdSource —— 存量 plan.md 旧 workflow 兼容读（C-7）。
// 经此 adapter 复用 task_parser.parseTasksV2 从 plan.md 解析 task 列表，归一化为 TaskSource 记录。
// task-dir 不再被强制建立：legacy 以兼容模式运行，状态回写落 plan.md（updateTaskStatusInMarkdown）。
class LegacyPlanMdSource {
  // planContent: plan.md 文本；planPath: 落盘回写用的物理路径（可选，缺省则 updateTaskStatus 仅返回不落盘）。
  constructor(planContent = '', planPath = null) {
    this.planContent = String(planContent || '')
    this.planPath = planPath || null
    this._tasks = null
  }

  _parse() {
    if (this._tasks === null) {
      this._tasks = parseTasksV2(this.planContent).map(legacyTaskToRecord)
    }
    return this._tasks
  }

  listTasks() {
    return this._parse()
  }

  getTask(taskId) {
    return this._parse().find((task) => task.id === taskId) || null
  }

  firstTaskId() {
    const tasks = this._parse()
    return tasks.length ? tasks[0].id : null
  }

  // legacy 状态回写：改写 plan.md 标题 emoji（与 plan.md 作为唯一源一致）。
  // planPath 缺省 → 仅更新内存内容，由调用方决定是否落盘。
  updateTaskStatus(taskId, newStatus) {
    this.planContent = updateTaskStatusInMarkdown(this.planContent, taskId, newStatus)
    this._tasks = null
    if (this.planPath) {
      try {
        fs.writeFileSync(this.planPath, this.planContent)
      } catch { /* 落盘失败不致命：状态仍记在 state.progress */ }
    }
    return this.getTask(taskId)
  }
}

// 解析 state 的 legacy plan.md 物理路径 + 内容。缺失/不可读 → null。
function resolveLegacyPlan(state, projectRoot = null) {
  const planRef = (state && state.plan_file) || ''
  if (!planRef) return null
  const { detectProjectRoot, resolvePlanArtifactPath } = tm()
  const resolvedRoot = detectProjectRoot(projectRoot || (state && state.project_root))
  const artifactPath = resolvePlanArtifactPath(resolvedRoot, planRef)
  if (!artifactPath || !fs.existsSync(artifactPath)) return null
  let content
  try {
    content = fs.readFileSync(artifactPath, 'utf8')
  } catch {
    return null
  }
  return { path: artifactPath, content }
}

let legacyNoticeShown = false

// 工厂：按 state 选 adapter（spec §5.5.2 / C-7）。
//   1. task-dir 非空            → TaskDirSource
//   2. 无 task-dir + legacy plan.md 可解析出 task → LegacyPlanMdSource（stderr 迁移提示，不静默）
//   3. 皆无                      → null（调用方 assertTaskSourcePresent 报 task_source_missing）
// projectId 优先取参数 → state.project_id/projectId → detectProjectId(projectRoot)。
function createTaskSource(state, options = {}) {
  const { projectId = null, projectRoot = null, quiet = false } = options
  const pid = projectId
    || (state && (state.project_id || state.projectId))
    || tm().detectProjectId(projectRoot)
    || null

  if (pid) {
    const dirTasks = taskStore.listTasks(pid)
    if (dirTasks.length) return new TaskDirSource(pid)
  }

  // 无 task-dir → 试 legacy plan.md。
  const legacy = resolveLegacyPlan(state, projectRoot)
  if (legacy) {
    const source = new LegacyPlanMdSource(legacy.content, legacy.path)
    if (source.listTasks().length) {
      if (!quiet) emitLegacyMigrationNotice(legacy.path)
      return source
    }
  }
  return null
}

// C-7 迁移提示：命中 legacy 时 stderr 打印一行显式提示（不静默），execute 仍可推进。
// 进程内去重，避免多次解析重复刷屏。
function emitLegacyMigrationNotice(planPath) {
  if (legacyNoticeShown) return
  legacyNoticeShown = true
  const ref = planPath ? ` (${planPath})` : ''
  try {
    process.stderr.write(`[workflow] 检测到 legacy plan.md workflow${ref}，建议迁移到 task-dir；当前以兼容模式运行。\n`)
  } catch { /* stderr 不可写：忽略 */ }
}

// 测试钩子：重置进程内提示去重标志。
function _resetLegacyNotice() {
  legacyNoticeShown = false
}

module.exports = {
  TaskDirSource,
  LegacyPlanMdSource,
  legacyTaskToRecord,
  resolveLegacyPlan,
  createTaskSource,
  _resetLegacyNotice,
}
