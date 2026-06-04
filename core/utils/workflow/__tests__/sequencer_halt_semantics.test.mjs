import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// 回归（handoff 2026-06-04 #1/#2）：execution_sequencer 的 updateAfterTaskCompletion / markTaskSkipped
// 在无可派发 task 时无条件 status='completed' + current_tasks=[]——仅剩 failed/blocked 时把 workflow
// 误标 completed（与 workflow_cli.advanceAfterComplete 的 selectAnchorId + alignStatusWithAnchor 不对称）。
// 期望：failed/blocked 残留 → 锚点回退 retry/unblock 目标 + status halted（failure/dependency），不落 completed。
// 另：markTaskSkipped 双计入——skip 一个 failed task 后该 id 同时留在 progress.failed 与 progress.skipped
// （cmdComplete 会清 failed，skip 不清）。HOME 隔离走 _test_env.isolateHome（handoff 决策 #5）。

let homeEnv
let tmpHome
let sequencer
let taskStore
let pathUtils
const PID = 'seqhalt01'

function clearModuleCache() {
  for (const rel of [
    '../path_utils.js',
    '../task_store.js',
    '../task_source.js',
    '../workflow_types.js',
    '../state_manager.js',
    '../task_manager.js',
    '../execution_sequencer.js',
  ]) {
    try { delete require.cache[require.resolve(rel)] } catch { /* ignore */ }
  }
}

function writeState(state) {
  const statePath = pathUtils.getWorkflowStatePath(PID)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
  return statePath
}

function readStateJson(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'))
}

beforeEach(() => {
  homeEnv = isolateHome('wf-seqhalt-')
  tmpHome = homeEnv.tmpHome
  clearModuleCache()
  sequencer = require('../execution_sequencer.js')
  taskStore = require('../task_store.js')
  pathUtils = require('../path_utils.js')
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
})

test('updateAfterTaskCompletion：完成最后可派发 task 后仅剩 failed → halted/failure + 锚点回退 retry 目标,不落 completed', () => {
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', status: 'completed' })
  taskStore.createTask(PID, { id: 'T2', phase: 'test', status: 'failed' })

  const state = sequencer.updateAfterTaskCompletion({
    project_id: PID,
    status: 'running',
    current_tasks: ['T1'],
    progress: { completed: ['T1'], failed: ['T2'] },
  })

  assert.equal(state.status, 'halted', 'failed 残留不得误判 completed')
  assert.equal(state.halt_reason, 'failure')
  assert.deepEqual(state.current_tasks, ['T2'], '锚点应回退 failed retry 目标,不得置空')
})

test('updateAfterTaskCompletion：仅剩 blocked → halted/dependency + 锚点回退 unblock 目标', () => {
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', status: 'completed' })
  taskStore.createTask(PID, { id: 'T2', phase: 'test', status: 'pending' })

  const state = sequencer.updateAfterTaskCompletion({
    project_id: PID,
    status: 'running',
    current_tasks: ['T1'],
    progress: { completed: ['T1'], blocked: ['T2'] },
  })

  assert.equal(state.status, 'halted', 'blocked 残留不得误判 completed')
  assert.equal(state.halt_reason, 'dependency')
  assert.deepEqual(state.current_tasks, ['T2'], '锚点应回退 blocked unblock 目标')
})

test('updateAfterTaskCompletion：全部终结（completed ∪ skipped）→ completed + 清空锚点（保留旧行为）', () => {
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', status: 'completed' })
  taskStore.createTask(PID, { id: 'T2', phase: 'test', status: 'skipped' })

  const state = sequencer.updateAfterTaskCompletion({
    project_id: PID,
    status: 'running',
    current_tasks: ['T2'],
    progress: { completed: ['T1'], skipped: ['T2'] },
  })

  assert.equal(state.status, 'completed', '无 failed/blocked 残留时全部终结 → completed')
  assert.deepEqual(state.current_tasks, [])
})

test('markTaskSkipped：skip 最后一个可派发 task 但仍剩 failed → halted,不落 completed', () => {
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', status: 'pending' })
  taskStore.createTask(PID, { id: 'T2', phase: 'test', status: 'failed' })
  const statePath = writeState({
    project_id: PID,
    status: 'running',
    current_tasks: ['T1'],
    progress: { failed: ['T2'] },
  })

  const result = sequencer.markTaskSkipped(statePath, 'T1', PID)
  assert.equal(result.skipped, true)
  assert.equal(result.workflow_status, 'halted', 'failed 残留时 skip 不得误判 completed')

  const state = readStateJson(statePath)
  assert.equal(state.status, 'halted')
  assert.equal(state.halt_reason, 'failure')
  assert.deepEqual(state.current_tasks, ['T2'], '锚点应回退 failed retry 目标')
})

test('markTaskSkipped：skip 一个 failed task → 从 progress.failed 清除,不双计入', () => {
  taskStore.createTask(PID, { id: 'T1', phase: 'implement', status: 'pending' })
  taskStore.createTask(PID, { id: 'T2', phase: 'test', status: 'failed' })
  const statePath = writeState({
    project_id: PID,
    status: 'halted',
    halt_reason: 'failure',
    current_tasks: ['T2'],
    progress: { failed: ['T2'] },
  })

  const result = sequencer.markTaskSkipped(statePath, 'T2', PID)
  assert.equal(result.skipped, true)

  const state = readStateJson(statePath)
  assert.ok(state.progress.skipped.includes('T2'), 'skip 后应记入 progress.skipped')
  assert.ok(!state.progress.failed.includes('T2'), 'skip 一个 failed task 须从 progress.failed 清除（对齐 cmdComplete）')
  // T2 skip 后 T1 仍可派发 → 推进而非误判 completed
  assert.deepEqual(state.current_tasks, ['T1'])
  assert.equal(state.status, 'running')
})
