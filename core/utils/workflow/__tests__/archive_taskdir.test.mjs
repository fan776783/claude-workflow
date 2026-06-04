import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// P0.1 归档清理回归：cmdArchive 必须 snapshot canonical task-dir 进 history，
// 并在提交阶段删根 tasks/，否则残留按 project-id 泄漏给同项目下个 workflow（幽灵 task）。
// 路径经 os.homedir() call-time 解析 process.env.HOME → 落临时 HOME（同 invariant.test.mjs）。
const PID = 'archpid01'
let tmpHome
let homeEnv
const pathUtils = require('../path_utils.js')
const taskStore = require('../task_store.js')
const { cmdArchive } = require('../delta_archive_cmds.js')

beforeEach(() => {
  homeEnv = isolateHome('wf-archive-')
  tmpHome = homeEnv.tmpHome
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
})

function writeState(state) {
  const statePath = pathUtils.getWorkflowStatePath(PID)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return statePath
}

test('archive: snapshot task-dir 进 history + 清根 tasks/ + summary 计数', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'completed' })
  taskStore.createTask(PID, { id: 'T2', status: 'completed' })
  taskStore.curateContext(PID, 'T1', [{ file: 'docs/spec.md', reason: 'ref' }])
  writeState({
    project_id: PID,
    status: 'completed',
    task_name: 'archive smoke',
    spec_file: 'docs/spec.md',
    plan_file: null,
    progress: { completed: ['T1', 'T2'], skipped: [], failed: [] },
  })

  const workflowDir = pathUtils.getWorkflowsDir(PID)
  const rootTasksDir = path.join(workflowDir, 'tasks')
  assert.ok(fs.existsSync(rootTasksDir), 'precondition: 根 tasks/ 存在')

  const result = cmdArchive(true, PID, tmpHome)

  assert.equal(result.archived, true)
  assert.equal(result.archived_task_count, 2, 'archived_task_count 应为 2')
  // 根 tasks/ 与根 state 都被提交阶段清掉
  assert.equal(fs.existsSync(rootTasksDir), false, '归档后根 tasks/ 应删除')
  assert.equal(fs.existsSync(pathUtils.getWorkflowStatePath(PID)), false, '归档后根 state 应删除')
  // history 含 task-dir snapshot（task.json + context.jsonl）
  assert.ok(fs.existsSync(path.join(result.history_dir, 'tasks', 'T1', 'task.json')), 'history 含 T1/task.json')
  assert.ok(fs.existsSync(path.join(result.history_dir, 'tasks', 'T2', 'task.json')), 'history 含 T2/task.json')
  assert.ok(fs.existsSync(path.join(result.history_dir, 'tasks', 'T1', 'context.jsonl')), 'history 含 T1/context.jsonl')
  // summary 含 task-dir 计数行
  const summary = fs.readFileSync(result.summary_file, 'utf8')
  assert.match(summary, /已归档 task-dir 任务数: 2/)
})

test('archive: 清根 tasks/ → 同 pid 下个 workflow listTasks 为空（无幽灵 task）', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'completed' })
  writeState({
    project_id: PID,
    status: 'completed',
    task_name: 'ghost check',
    spec_file: 'docs/s.md',
    progress: { completed: ['T1'] },
  })

  cmdArchive(false, PID, tmpHome)

  assert.deepEqual(taskStore.listTasks(PID), [], '归档后不应残留 task 壳')
})
