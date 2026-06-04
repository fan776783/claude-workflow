import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// T10/S10（C-1 / AC-9）：resume 三元组等价回归。
// resume 三元组 = current_tasks[0] + status + task 源（task-dir 或 legacy plan.md）。
// /clear 后内存全丢，运行时仅从 disk（state.json + task-dir / plan.md）重建。
// 本套件断言：重建后 task 序列、current_tasks[0]、status、各 task status 与重建前逐项等价。
//   - task-dir 路径（TaskDirSource）
//   - legacy plan.md 路径（LegacyPlanMdSource，无 task-dir）
//   - firstTaskId 顺序稳定性（重建后 current_tasks[0] 可复现）

let homeEnv
let tmpHome
let tmpProject
let taskSource
let taskStore
let pathUtils
let sm
const PID = 'resumeequiv1'

// 模拟 /clear：清掉所有 workflow 运行时模块缓存，强制从 disk 冷启重建。
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
  ]) {
    delete require.cache[require.resolve(mod)]
  }
  taskSource = require('../task_source.js')
  taskStore = require('../task_store.js')
  pathUtils = require('../path_utils.js')
  sm = require('../state_manager.js')
  taskSource._resetLegacyNotice()
}

function writeState(state) {
  const statePath = pathUtils.getWorkflowStatePath(PID)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
  return statePath
}

// 从 disk 重建 resume 三元组快照：状态 + task 源记录（逐项可比较）。
function snapshotFromDisk(state, projectRoot = null) {
  const statePath = pathUtils.getWorkflowStatePath(PID)
  const diskState = sm.readState(statePath, PID)
  const source = taskSource.createTaskSource(diskState, { projectRoot, quiet: true })
  const tasks = source ? source.listTasks() : []
  return {
    status: diskState.status,
    currentTask0: (diskState.current_tasks || [])[0] || null,
    sourceKind: source ? source.constructor.name : null,
    firstTaskId: source ? source.firstTaskId() : null,
    taskIds: tasks.map((t) => t.id),
    taskStatuses: tasks.map((t) => ({ id: t.id, status: t.status })),
  }
}

beforeEach(() => {
  homeEnv = isolateHome('resume-home-')
  tmpHome = homeEnv.tmpHome
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-proj-'))
  freshRequire()
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
  try { fs.rmSync(tmpProject, { recursive: true, force: true }) } catch { /* ignore */ }
})

// === task-dir 路径（TaskDirSource）===

test('task-dir resume：/clear 冷启重建后 resume 三元组逐项等价（C-1）', () => {
  // 多 task，部分 completed，current 指向中间 task。
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', package: 'pkg-a', target_layer: 'backend', status: 'completed' })
  taskStore.createTask(PID, { id: 'T2', phase: 'implement', package: 'pkg-a', target_layer: 'frontend', depends: ['T1'], status: 'completed' })
  taskStore.createTask(PID, { id: 'T3', phase: 'implement', package: 'pkg-a', target_layer: 'backend', depends: ['T2'], status: 'pending' })
  taskStore.createTask(PID, { id: 'T4', phase: 'test', package: 'pkg-a', target_layer: 'backend', depends: ['T3'], status: 'pending' })
  const state = { project_id: PID, status: 'running', current_tasks: ['T3'], progress: { completed: ['T1', 'T2'] } }
  writeState(state)

  // 重建前快照（内存仍热）。
  const before = snapshotFromDisk(state)

  // 模拟 /clear：丢弃所有内存模块状态。
  freshRequire()

  // 仅从 disk 重建。
  const after = snapshotFromDisk(state)

  assert.deepEqual(after, before, 'resume 三元组重建前后逐项等价')
  // 显式断言三元组语义。
  assert.equal(after.status, 'running')
  assert.equal(after.currentTask0, 'T3')
  assert.equal(after.sourceKind, 'TaskDirSource')
  assert.deepEqual(after.taskIds, ['T1', 'T2', 'T3', 'T4'])
  assert.deepEqual(after.taskStatuses, [
    { id: 'T1', status: 'completed' },
    { id: 'T2', status: 'completed' },
    { id: 'T3', status: 'pending' },
    { id: 'T4', status: 'pending' },
  ])
})

test('task-dir resume：firstTaskId 顺序稳定（数字序，重建可复现）', () => {
  // 乱序建 task，listTasks/firstTaskId 应按 taskId 数字序稳定。
  taskStore.createTask(PID, { id: 'T10', package: 'pkg-a', status: 'pending' })
  taskStore.createTask(PID, { id: 'T2', package: 'pkg-a', status: 'pending' })
  taskStore.createTask(PID, { id: 'T1', package: 'pkg-a', status: 'pending' })
  const state = { project_id: PID, status: 'running', current_tasks: ['T1'] }
  writeState(state)

  const before = snapshotFromDisk(state)
  freshRequire()
  const after = snapshotFromDisk(state)

  assert.equal(before.firstTaskId, 'T1')
  assert.equal(after.firstTaskId, 'T1', 'firstTaskId 重建后可复现')
  assert.deepEqual(after.taskIds, ['T1', 'T2', 'T10'], '数字序稳定')
})

// === legacy plan.md 路径（LegacyPlanMdSource，无 task-dir）===

const LEGACY_PLAN = `# 实施计划

## T1: 后端基础 schema
- **阶段**: implement
- **Package**: pkg-legacy
- **Target Layer**: backend
- **验收项**: AC-1

## T2: 前端表单
- **阶段**: implement
- **Package**: pkg-legacy
- **Target Layer**: frontend
- **依赖**: T1
- **验收项**: AC-2

## T3: 联调测试
- **阶段**: test
- **Package**: pkg-legacy
- **Target Layer**: backend
- **依赖**: T2
- **验收项**: AC-3
`

test('legacy plan.md resume：/clear 冷启重建后 resume 三元组等价（C-1 / C-7）', () => {
  const planPath = path.join(tmpProject, 'plan.md')
  fs.writeFileSync(planPath, LEGACY_PLAN)
  // 无 task-dir：current 指向中间 task，T1 已 completed。
  const state = {
    project_id: PID,
    status: 'running',
    current_tasks: ['T2'],
    progress: { completed: ['T1'] },
    plan_file: planPath,
    project_root: tmpProject,
  }
  writeState(state)

  const before = snapshotFromDisk(state, tmpProject)
  freshRequire()
  const after = snapshotFromDisk(state, tmpProject)

  assert.deepEqual(after, before, 'legacy resume 三元组重建前后逐项等价')
  assert.equal(after.status, 'running')
  assert.equal(after.currentTask0, 'T2')
  assert.equal(after.sourceKind, 'LegacyPlanMdSource')
  assert.equal(after.firstTaskId, 'T1', 'legacy firstTaskId 顺序稳定可复现')
  assert.deepEqual(after.taskIds, ['T1', 'T2', 'T3'])
})

test('legacy plan.md resume：firstTaskId 顺序稳定（解析顺序，重建可复现）', () => {
  const planPath = path.join(tmpProject, 'plan.md')
  fs.writeFileSync(planPath, LEGACY_PLAN)
  const state = { project_id: PID, status: 'running', current_tasks: ['T1'], plan_file: planPath, project_root: tmpProject }
  writeState(state)

  const before = snapshotFromDisk(state, tmpProject)
  freshRequire()
  const after = snapshotFromDisk(state, tmpProject)

  assert.equal(before.firstTaskId, 'T1')
  assert.equal(after.firstTaskId, 'T1')
  assert.deepEqual(after.taskIds, before.taskIds)
})
