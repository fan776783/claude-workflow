import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// S3 重基（FR-2 / AC-2）：sequencer 从 parseTasksV2(plan.md) 切到 TaskSource(task-dir)。
// 本套件构造仅含 task-dir（无 plan.md task block）的 workflow，断言:
//   - loadExecutionContext → detectNextTask → updateAfterTaskCompletion 能把多个 task 推进至 completed
//   - current_tasks[0] resume 起点取自 task-dir 数字序首个（C-1）
//   - current_task 元数据 package/target_layer 可解析（C-2 scoped 注入前提）
//   - planned/running/halted 缺 task 源 → assertTaskSourcePresent 报 task_source_missing

let homeEnv
let tmpHome
let sequencer
let taskStore
let pathUtils
const PID = 'seqtaskdir01'

function freshRequire() {
  for (const mod of [
    '../path_utils.js',
    '../task_store.js',
    '../task_source.js',
    '../workflow_types.js',
    '../state_manager.js',
    '../task_manager.js',
    '../execution_sequencer.js',
  ]) {
    delete require.cache[require.resolve(mod)]
  }
  sequencer = require('../execution_sequencer.js')
  taskStore = require('../task_store.js')
  pathUtils = require('../path_utils.js')
}

function writeState(state) {
  const statePath = pathUtils.getWorkflowStatePath(PID)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
  return statePath
}

function seedTasks() {
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', package: 'pkg-a', target_layer: 'backend', status: 'pending' })
  taskStore.createTask(PID, { id: 'T2', phase: 'implement', package: 'pkg-a', target_layer: 'frontend', depends: ['T1'], status: 'pending' })
  taskStore.createTask(PID, { id: 'T3', phase: 'test', package: 'pkg-a', target_layer: 'backend', depends: ['T2'], status: 'pending' })
}

beforeEach(() => {
  homeEnv = isolateHome('seq-taskdir-')
  tmpHome = homeEnv.tmpHome
  freshRequire()
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
})

test('loadExecutionContext 从 task-dir 读 task 序列（无 plan.md task block）', () => {
  seedTasks()
  writeState({ project_id: PID, status: 'running', current_tasks: ['T1'] })
  const ctx = sequencer.loadExecutionContext(PID)
  assert.equal(ctx.error, undefined)
  assert.equal(ctx.total_tasks, 3)
  assert.deepEqual(ctx.tasks.map((t) => t.id), ['T1', 'T2', 'T3'], 'task-dir 数字序稳定')
  assert.equal(ctx.current_task_id, 'T1')
  // C-2: scoped 注入元数据 package/target_layer 可解析
  assert.equal(ctx.current_task.package, 'pkg-a')
  assert.equal(ctx.current_task.target_layer, 'backend')
})

test('current_tasks[0] resume 起点 = task-dir 首个 task（C-1）', () => {
  seedTasks()
  // resume：current_tasks 已落 T2（T1 已 completed）
  taskStore.updateTaskStatus(PID, 'T1', 'completed')
  writeState({ project_id: PID, status: 'running', current_tasks: ['T2'], progress: { completed: ['T1'] } })
  const ctx = sequencer.loadExecutionContext(PID)
  assert.equal(ctx.current_task_id, 'T2')
  assert.equal(ctx.current_task.target_layer, 'frontend')
  // firstTaskId 仍是数字序首个（与 resume 起点解耦：resume 看 state.current_tasks）
})

test('detectNextTask 按 task-dir 顺序排除 completed/skipped/failed', () => {
  seedTasks()
  const tasks = taskStore.listTasks(PID)
  assert.equal(sequencer.detectNextTask(tasks, { status: 'running' }), 'T1')
  assert.equal(sequencer.detectNextTask(tasks, { status: 'running', progress: { completed: ['T1'] } }), 'T2')
  assert.equal(sequencer.detectNextTask(tasks, { status: 'running', progress: { completed: ['T1'], skipped: ['T2'] } }), 'T3')
  assert.equal(sequencer.detectNextTask(tasks, { status: 'running', progress: { completed: ['T1', 'T2', 'T3'] } }), null)
})

test('updateAfterTaskCompletion 从 task-dir 重新拉 task → 推进 + 终态 completed', () => {
  seedTasks()
  // T1 完成 → next = T2
  let state = sequencer.updateAfterTaskCompletion(
    { project_id: PID, status: 'running', current_tasks: ['T1'], progress: { completed: ['T1'] } },
  )
  assert.equal(state.status, 'running')
  assert.deepEqual(state.current_tasks, ['T2'])

  // T1+T2 完成 → next = T3
  state = sequencer.updateAfterTaskCompletion(
    { project_id: PID, status: 'running', current_tasks: ['T2'], progress: { completed: ['T1', 'T2'] } },
  )
  assert.deepEqual(state.current_tasks, ['T3'])

  // 全部完成 → completed，current_tasks 清空
  state = sequencer.updateAfterTaskCompletion(
    { project_id: PID, status: 'running', current_tasks: ['T3'], progress: { completed: ['T1', 'T2', 'T3'] } },
  )
  assert.equal(state.status, 'completed')
  assert.deepEqual(state.current_tasks, [])
})

test('load→detect→update 三元组顺序推进多个 task 至 completed（AC-2）', () => {
  seedTasks()
  const statePath = writeState({ project_id: PID, status: 'running', current_tasks: ['T1'] })
  const sm = require('../state_manager.js')

  const completed = []
  for (let guard = 0; guard < 10; guard += 1) {
    const ctx = sequencer.loadExecutionContext(PID)
    assert.equal(ctx.error, undefined)
    const nextId = sequencer.detectNextTask(ctx.tasks, ctx.state)
    if (!nextId) break
    // 模拟 task 完成：落 task-dir 状态 + state.progress
    taskStore.updateTaskStatus(PID, nextId, 'completed')
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

test('markTaskSkipped 落 task-dir skipped + 推进 next', () => {
  seedTasks()
  const statePath = writeState({ project_id: PID, status: 'running', current_tasks: ['T1'] })
  const result = sequencer.markTaskSkipped(statePath, 'T1', PID)
  assert.equal(result.skipped, true)
  assert.equal(result.next_task_id, 'T2')
  assert.equal(taskStore.readTask(PID, 'T1').status, 'skipped')
})

test('planned + 缺 task 源 → loadExecutionContext 回 error/code（不抛，entry-gating 友好）', () => {
  writeState({ project_id: PID, status: 'planned', current_tasks: [] })
  const ctx = sequencer.loadExecutionContext(PID)
  assert.equal(ctx.code, 'task_source_missing')
  assert.match(ctx.error, /task_source_missing/)
})

test('idle/spec_review/completed → 不要求 task 源（loadExecutionContext 不抛）', () => {
  for (const status of ['spec_review', 'completed']) {
    writeState({ project_id: PID, status, current_tasks: [] })
    const ctx = sequencer.loadExecutionContext(PID)
    assert.equal(ctx.error, undefined, `status=${status} 不应报错`)
    assert.equal(ctx.total_tasks, 0)
  }
})
