import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// T9/S9（C-7 / C-1）：存量 plan.md 旧 workflow 不静默失效。
// LegacyPlanMdSource 复用 parseTasksV2 从 plan.md 读 task 列表，暴露与 TaskDirSource 同一 TaskSource 接口。
// createTaskSource 工厂三分支：task-dir → TaskDirSource，仅 legacy plan.md → LegacyPlanMdSource，皆无 → null。
// 验证：legacy fixture 全链路 load→detect→update 不失锚 + resume 起点等价 + stderr 迁移提示。

let homeEnv
let tmpHome
let tmpProject
let taskSource
let sequencer
let taskManager
let taskStore
let pathUtils
let deltaArchiveCmds
const PID = 'legacysrc01'

const LEGACY_PLAN = `# 实施计划

## T1: 后端基础 schema
- **阶段**: implement
- **Package**: pkg-legacy
- **Target Layer**: backend
- **验收项**: AC-1, AC-2
- **actions**: 建表, 建索引

## T2: 前端表单
- **阶段**: implement
- **Package**: pkg-legacy
- **Target Layer**: frontend
- **依赖**: T1
- **验收项**: AC-3

## T3: 联调测试
- **阶段**: test
- **Package**: pkg-legacy
- **Target Layer**: backend
- **依赖**: T2
- **验收项**: AC-4
`

// 带外部依赖（阻塞依赖 → blocked_by）的 legacy plan：用于 unblock/deltaSync 反查回归。
// T2 阻塞依赖 api_spec —— cmdUnblock('api_spec') 后应从 progress.blocked 反查解除。
const LEGACY_PLAN_BLOCKED = `# 实施计划

## T1: 后端基础 schema
- **阶段**: implement
- **Package**: pkg-legacy
- **Target Layer**: backend
- **验收项**: AC-1

## T2: 前端对接接口
- **阶段**: implement
- **Package**: pkg-legacy
- **Target Layer**: frontend
- **依赖**: T1
- **阻塞依赖**: api_spec
- **验收项**: AC-2
`

function freshRequire() {
  for (const mod of [
    '../path_utils.js',
    '../task_store.js',
    '../task_parser.js',
    '../task_source.js',
    '../workflow_types.js',
    '../state_manager.js',
    '../task_manager.js',
    '../execution_sequencer.js',
    '../runtime_locator.js',
    '../dependency_checker.js',
    '../plan_delta.js',
    '../delta_archive_cmds.js',
  ]) {
    delete require.cache[require.resolve(mod)]
  }
  taskSource = require('../task_source.js')
  sequencer = require('../execution_sequencer.js')
  taskManager = require('../task_manager.js')
  taskStore = require('../task_store.js')
  pathUtils = require('../path_utils.js')
  deltaArchiveCmds = require('../delta_archive_cmds.js')
  taskSource._resetLegacyNotice()
}

function writePlan() {
  const planPath = path.join(tmpProject, 'plan.md')
  fs.writeFileSync(planPath, LEGACY_PLAN)
  return planPath
}

function writeState(state) {
  const statePath = pathUtils.getWorkflowStatePath(PID)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
  return statePath
}

// 捕获 stderr.write 输出。
function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr)
  const chunks = []
  process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true }
  try {
    fn()
  } finally {
    process.stderr.write = original
  }
  return chunks.join('')
}

beforeEach(() => {
  homeEnv = isolateHome('legacy-home-')
  tmpHome = homeEnv.tmpHome
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-proj-'))
  freshRequire()
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
  try { fs.rmSync(tmpProject, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('LegacyPlanMdSource.listTasks/firstTaskId/getTask 从 plan.md 读出稳定 task 序列', () => {
  const source = new taskSource.LegacyPlanMdSource(LEGACY_PLAN)
  const tasks = source.listTasks()
  assert.deepEqual(tasks.map((t) => t.id), ['T1', 'T2', 'T3'])
  assert.equal(source.firstTaskId(), 'T1')
  const t2 = source.getTask('T2')
  assert.equal(t2.package, 'pkg-legacy')
  assert.equal(t2.target_layer, 'frontend')
  assert.deepEqual(t2.depends, ['T1'])
  // acceptance_criteria → acceptance（与 TaskDirSource 记录形状对齐）
  assert.deepEqual(t2.acceptance, ['AC-3'])
  assert.equal(source.getTask('T99'), null)
})

test('createTaskSource 三分支：task-dir / legacy / 皆无', () => {
  const planPath = writePlan()
  const stateLegacy = { project_id: PID, status: 'running', plan_file: planPath, project_root: tmpProject }

  // 分支 2：无 task-dir + legacy plan.md → LegacyPlanMdSource
  const legacySource = taskSource.createTaskSource(stateLegacy, { quiet: true })
  assert.ok(legacySource instanceof taskSource.LegacyPlanMdSource)
  assert.deepEqual(legacySource.listTasks().map((t) => t.id), ['T1', 'T2', 'T3'])

  // 分支 1：task-dir 非空 → TaskDirSource（优先于 legacy）
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', package: 'pkg-dir', target_layer: 'backend', status: 'pending' })
  const dirSource = taskSource.createTaskSource(stateLegacy, { quiet: true })
  assert.ok(dirSource instanceof taskSource.TaskDirSource)
  assert.equal(dirSource.getTask('T1').package, 'pkg-dir')

  // 分支 3：皆无 → null
  const stateNone = { project_id: PID, status: 'running' }
  // 清掉刚建的 task-dir
  const tasksRoot = taskStore.getTasksRoot(PID)
  fs.rmSync(tasksRoot, { recursive: true, force: true })
  assert.equal(taskSource.createTaskSource(stateNone, { quiet: true }), null)
})

test('legacy 命中时 stderr 打印迁移提示（不静默）', () => {
  const planPath = writePlan()
  const state = { project_id: PID, status: 'running', plan_file: planPath, project_root: tmpProject }
  const out = captureStderr(() => {
    taskSource.createTaskSource(state)
  })
  assert.match(out, /legacy plan\.md/)
  assert.match(out, /兼容模式/)
})

test('loadExecutionContext 经 legacy plan.md 解析 task（无 task-dir）—— C-7 不失效', () => {
  const planPath = writePlan()
  writeState({ project_id: PID, status: 'running', current_tasks: ['T1'], plan_file: planPath, project_root: tmpProject })
  const ctx = sequencer.loadExecutionContext(PID, tmpProject)
  assert.equal(ctx.error, undefined)
  assert.equal(ctx.total_tasks, 3)
  assert.deepEqual(ctx.tasks.map((t) => t.id), ['T1', 'T2', 'T3'])
  assert.equal(ctx.current_task_id, 'T1')
  assert.equal(ctx.current_task.package, 'pkg-legacy')
  assert.equal(ctx.current_task.target_layer, 'backend')
})

test('legacy resume 起点等价：current_tasks[0] 可复现（C-1）', () => {
  const planPath = writePlan()
  writeState({ project_id: PID, status: 'running', current_tasks: ['T2'], progress: { completed: ['T1'] }, plan_file: planPath, project_root: tmpProject })
  const ctx = sequencer.loadExecutionContext(PID, tmpProject)
  assert.equal(ctx.current_task_id, 'T2')
  assert.equal(ctx.current_task.target_layer, 'frontend')
})

test('legacy 全链路 load→detect→update 顺序推进至 completed（C-1 等价）', () => {
  const planPath = writePlan()
  const statePath = writeState({ project_id: PID, status: 'running', current_tasks: ['T1'], plan_file: planPath, project_root: tmpProject })
  const sm = require('../state_manager.js')

  const completed = []
  for (let guard = 0; guard < 10; guard += 1) {
    const ctx = sequencer.loadExecutionContext(PID, tmpProject)
    assert.equal(ctx.error, undefined)
    const nextId = sequencer.detectNextTask(ctx.tasks, ctx.state)
    if (!nextId) break
    completed.push(nextId)
    const state = sm.readState(statePath, PID)
    state.progress = state.progress || {}
    state.progress.completed = [...completed]
    const advanced = sequencer.updateAfterTaskCompletion(state)
    sm.writeState(statePath, advanced)
  }
  assert.deepEqual(completed, ['T1', 'T2', 'T3'])
  const finalState = sm.readState(statePath, PID)
  assert.equal(finalState.status, 'completed')
  assert.deepEqual(finalState.current_tasks, [])
})

test('legacy markTaskSkipped：状态回写 plan.md + 推进 next（C-1）', () => {
  const planPath = writePlan()
  const statePath = writeState({ project_id: PID, status: 'running', current_tasks: ['T1'], plan_file: planPath, project_root: tmpProject })
  const result = sequencer.markTaskSkipped(statePath, 'T1', PID, tmpProject)
  assert.equal(result.skipped, true)
  assert.equal(result.next_task_id, 'T2')
  // plan.md 标题被回写状态 emoji
  const updated = fs.readFileSync(planPath, 'utf8')
  assert.match(updated.split('\n').find((l) => l.startsWith('## T1:')), /T1/)
})

test('planned + 无 task-dir + 无 plan.md → loadExecutionContext 报 task_source_missing（不静默）', () => {
  writeState({ project_id: PID, status: 'planned', current_tasks: [] })
  const ctx = sequencer.loadExecutionContext(PID)
  assert.equal(ctx.code, 'task_source_missing')
  assert.match(ctx.error, /task_source_missing/)
})

// === 真实 advance 路径（task_manager：workflow_cli advance → cmdComplete + cmdNext）===
// reviewer 实测确认：legacy plan.md workflow 的失效点在 task_manager（非 execution_sequencer）。

test('legacy cmdNext / cmdList / cmdStatus 从 plan.md 读 task（C-7 真实路径不失效）', () => {
  const planPath = writePlan()
  writeState({ project_id: PID, status: 'running', current_tasks: ['T1'], plan_file: planPath, project_root: tmpProject })

  const next = taskManager.cmdNext(PID, tmpProject)
  assert.equal(next.error, undefined)
  assert.ok(next.next_task, 'cmdNext 不应误报全完成')
  assert.equal(next.next_task.id, 'T1')

  const list = taskManager.cmdList(PID, tmpProject)
  assert.equal(list.total, 3)
  assert.deepEqual(list.tasks.map((t) => t.id), ['T1', 'T2', 'T3'])
  assert.equal(list.tasks[0].package, 'pkg-legacy')

  const status = taskManager.cmdStatus(PID, tmpProject)
  assert.equal(status.total_tasks, 3)
})

test('legacy 真实 advance：cmdComplete→cmdNext 顺序推进至 completed + plan.md emoji 回写（C-1）', () => {
  const planPath = writePlan()
  writeState({ project_id: PID, status: 'running', current_tasks: ['T1'], plan_file: planPath, project_root: tmpProject })

  // T1
  let next = taskManager.cmdNext(PID, tmpProject)
  assert.equal(next.next_task.id, 'T1')
  let done = taskManager.cmdComplete('T1', PID, tmpProject)
  assert.equal(done.error, undefined, 'cmdComplete(T1) 不应报「不存在于 task 源」')
  assert.equal(done.completed, true)

  // T2
  next = taskManager.cmdNext(PID, tmpProject)
  assert.equal(next.next_task.id, 'T2', 'T1 完成后 next 应为 T2')
  done = taskManager.cmdComplete('T2', PID, tmpProject)
  assert.equal(done.completed, true)

  // T3
  next = taskManager.cmdNext(PID, tmpProject)
  assert.equal(next.next_task.id, 'T3')
  done = taskManager.cmdComplete('T3', PID, tmpProject)
  assert.equal(done.completed, true)

  // 全完成
  next = taskManager.cmdNext(PID, tmpProject)
  assert.equal(next.next_task, null)

  const progress = taskManager.cmdProgress(PID, tmpProject)
  assert.equal(progress.total, 3)
  assert.equal(progress.completed, 3)
  assert.equal(progress.pending, 0)

  // plan.md emoji 回写：三个标题都带完成标记
  const updated = fs.readFileSync(planPath, 'utf8')
  const titles = updated.split('\n').filter((l) => /^## T\d+:/.test(l))
  assert.equal(titles.length, 3)
  // updateTaskStatusInMarkdown 落 completed emoji（✅），标题文本不应再是裸 plain
  for (const t of titles) assert.ok(/[✅☑✔]/.test(t) || /completed/i.test(t), `标题应回写完成态: ${t}`)
})

test('legacy cmdFail 落 plan.md failed + halt（真实路径）', () => {
  const planPath = writePlan()
  const statePath = writeState({ project_id: PID, status: 'running', current_tasks: ['T1'], plan_file: planPath, project_root: tmpProject })
  const result = taskManager.cmdFail('T1', 'boom', PID, tmpProject)
  assert.equal(result.error, undefined, 'cmdFail 不应报「不存在于 task 源」')
  assert.equal(result.failed, true)
  const sm = require('../state_manager.js')
  const state = sm.readState(statePath, PID)
  assert.equal(state.status, 'halted')
  assert.equal(state.halt_reason, 'failure')
})

test('legacy cmdDeps 从 plan.md 读 depends（真实路径）', () => {
  const planPath = writePlan()
  writeState({ project_id: PID, status: 'running', current_tasks: ['T2'], progress: { completed: ['T1'] }, plan_file: planPath, project_root: tmpProject })
  const deps = taskManager.cmdDeps('T2', PID, tmpProject)
  assert.equal(deps.error, undefined)
  assert.deepEqual(deps.depends, ['T1'])
})

// === 终审修复回合 FINAL-FIX-1（C-6 / C-7）：delta_archive_cmds.listSourceTasks 经 createTaskSource 工厂 ===
// 回归点：listSourceTasks 此前硬绑 new TaskDirSource(pid)，legacy plan.md（无 task-dir）反查恒空 →
// reconcileBlockedTasks 不跑 → halted[dependency] 存量 legacy workflow 无法经 unblock 恢复 running。
// 改走工厂后 LegacyPlanMdSource 反查到 task，blocked_by 比对生效。

function writeBlockedPlan() {
  const planPath = path.join(tmpProject, 'plan.md')
  fs.writeFileSync(planPath, LEGACY_PLAN_BLOCKED)
  return planPath
}

test('legacy cmdUnblock：halted[dependency] 经 LegacyPlanMdSource 反查恢复 running + newly_unblocked 非空（FINAL-FIX-1）', () => {
  const planPath = writeBlockedPlan()
  writeState({
    project_id: PID,
    status: 'halted',
    halt_reason: 'dependency',
    current_tasks: ['T2'],
    progress: { completed: ['T1'], blocked: ['T2'] },
    unblocked: [],
    plan_file: planPath,
    project_root: tmpProject,
  })

  const result = deltaArchiveCmds.cmdUnblock('api_spec', PID, tmpProject)
  assert.equal(result.error, undefined)
  assert.equal(result.unblocked, true)
  // 反查命中：T2 的 blocked_by=[api_spec] 解除 → newly_unblocked 非空（旧实现此处恒空）
  assert.deepEqual(result.newly_unblocked_tasks, ['T2'], 'legacy 反查应解除 T2，证明 reconcileBlockedTasks 真跑')
  assert.deepEqual(result.known_unblocked, ['api_spec'])
  // halted[dependency] 恢复 running
  assert.equal(result.workflow_status, 'running')

  // 落盘状态一致：progress.blocked 被 reconcile 清空
  const sm = require('../state_manager.js')
  const statePath = pathUtils.getWorkflowStatePath(PID)
  const persisted = sm.readState(statePath, PID)
  assert.equal(persisted.status, 'running')
  assert.equal(persisted.halt_reason, null)
  assert.deepEqual(persisted.progress.blocked, [], 'reconcile 应从 progress.blocked 移除已解除的 T2')
})

test('legacy cmdDeltaSync：反查非空 + 解除阻塞计入 newly_unblocked（FINAL-FIX-1）', () => {
  const planPath = writeBlockedPlan()
  writeState({
    project_id: PID,
    status: 'halted',
    halt_reason: 'dependency',
    current_tasks: ['T2'],
    progress: { completed: ['T1'], blocked: ['T2'] },
    unblocked: [],
    plan_file: planPath,
    project_root: tmpProject,
  })

  const result = deltaArchiveCmds.cmdDeltaSync('api_spec', PID, tmpProject)
  assert.equal(result.error, undefined)
  assert.equal(result.synced, true)
  assert.deepEqual(result.newly_unblocked_tasks, ['T2'], 'legacy deltaSync 反查应非空')
  assert.equal(result.workflow_status, 'running')
})

test('task-dir 模式 cmdUnblock 仍正常（工厂改造不回退主路径）', () => {
  // task-dir 非空 + 无 plan.md → 工厂选 TaskDirSource
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', package: 'pkg-dir', target_layer: 'backend', status: 'pending', blocked_by: ['api_spec'] })
  writeState({
    project_id: PID,
    status: 'halted',
    halt_reason: 'dependency',
    current_tasks: ['T1'],
    progress: { completed: [], blocked: ['T1'] },
    unblocked: [],
    project_root: tmpProject,
  })

  const result = deltaArchiveCmds.cmdUnblock('api_spec', PID, tmpProject)
  assert.equal(result.error, undefined)
  assert.deepEqual(result.newly_unblocked_tasks, ['T1'], 'task-dir 反查应解除 T1')
  assert.equal(result.workflow_status, 'running')
})

test('无 task-dir + 无 plan.md：cmdUnblock 反查空列表，保留无源跳过 reconcile 行为', () => {
  // markDependencyUnblocked 仍把 halted[dependency] 翻回 running（state_manager 既有行为），
  // 但 reconcile 不跑 → newly_unblocked 空（工厂返回 null → 空列表，不报错）。
  writeState({
    project_id: PID,
    status: 'halted',
    halt_reason: 'dependency',
    current_tasks: [],
    progress: { blocked: [] },
    unblocked: [],
    project_root: tmpProject,
  })
  const result = deltaArchiveCmds.cmdUnblock('api_spec', PID, tmpProject)
  assert.equal(result.error, undefined)
  assert.deepEqual(result.newly_unblocked_tasks, [])
})
