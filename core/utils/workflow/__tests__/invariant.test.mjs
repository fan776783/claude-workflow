import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// assertTaskSourcePresent 经 lazy require task_store → getWorkflowsDir(pid) 落临时 HOME。
let tmpHome
let workflowTypes
let taskStore
const PID = 'testpid02'

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-invariant-'))
  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
  delete require.cache[require.resolve('../workflow_types.js')]
  delete require.cache[require.resolve('../task_source.js')]
  delete require.cache[require.resolve('../task_manager.js')]
  delete require.cache[require.resolve('../task_parser.js')]
  delete require.cache[require.resolve('../task_store.js')]
  delete require.cache[require.resolve('../path_utils.js')]
  workflowTypes = require('../workflow_types.js')
  taskStore = require('../task_store.js')
})

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('planned + 缺 task 源 → 抛 task_source_missing', () => {
  let caught = null
  try {
    workflowTypes.assertTaskSourcePresent({ status: 'planned', project_id: PID })
  } catch (err) {
    caught = err
  }
  assert.ok(caught, 'expected throw')
  assert.equal(caught.code, 'task_source_missing')
  assert.match(caught.message, /task_source_missing/)
})

test('running + 缺 task 源 → 抛 task_source_missing', () => {
  assert.throws(
    () => workflowTypes.assertTaskSourcePresent({ status: 'running', project_id: PID }),
    /task_source_missing/,
  )
})

test('halted + 缺 task 源 → 抛 task_source_missing', () => {
  assert.throws(
    () => workflowTypes.assertTaskSourcePresent({ status: 'halted', project_id: PID }),
    /task_source_missing/,
  )
})

test('planned + task 源存在 → 不报', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'pending' })
  assert.equal(workflowTypes.assertTaskSourcePresent({ status: 'planned', project_id: PID }), true)
})

test('executable guard: planned + v2 metadata 壳 → 抛 task_dir_not_executable', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'pending' })
  assert.throws(
    () => workflowTypes.assertExecutableTaskSourcePresent({ status: 'planned', project_id: PID }),
    /task_dir_not_executable|metadata 壳/,
  )
})

test('executable guard: planned + v2 task_text → 不报', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'pending', task_text: '执行正文' })
  assert.equal(workflowTypes.assertExecutableTaskSourcePresent({ status: 'planned', project_id: PID }), true)
})

test('planned + legacy plan.md task 源存在 → 不报', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-invariant-project-'))
  const planPath = path.join(projectRoot, 'plan.md')
  fs.writeFileSync(planPath, `# 实施计划

## T1: legacy task
- **阶段**: implement
- **验收项**: AC-1
`)
  assert.equal(
    workflowTypes.assertTaskSourcePresent({ status: 'planned', project_id: PID, plan_file: planPath }, PID, projectRoot),
    true,
  )
})

test('idle / spec_review / completed / archived → 不要求 task 源（不报）', () => {
  for (const status of ['idle', 'spec_review', 'completed', 'archived']) {
    assert.equal(
      workflowTypes.assertTaskSourcePresent({ status, project_id: PID }),
      true,
      `status=${status} 不应报错`,
    )
  }
})

test('executable guard: spec_review + v2 metadata 壳仍不报 task-dir readiness', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'pending' })
  assert.equal(workflowTypes.assertExecutableTaskSourcePresent({ status: 'spec_review', project_id: PID }), true)
})

test('projectId 显式参数优先于 state.project_id', () => {
  taskStore.createTask(PID, { id: 'T1' })
  // state 不带 project_id，靠第二参数解析
  assert.equal(workflowTypes.assertTaskSourcePresent({ status: 'running' }, PID), true)
})

test('无 project id 且 planned → 抛 task_source_missing', () => {
  assert.throws(
    () => workflowTypes.assertTaskSourcePresent({ status: 'planned' }),
    /task_source_missing/,
  )
})
