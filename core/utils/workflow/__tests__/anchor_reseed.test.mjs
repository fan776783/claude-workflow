import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// C-1 resume 锚点重导回归：
// 1) task-write 整集替换后 current_tasks[0] 孤儿（renumber 掉原壳 id）→ 自动重导到新源首个未完成 task；
// 2) 锚点仍在新 id 集 → 不写 state（updated_at 不动，避免打 stale 下游 handoff）；
// 3) 锚点在新 id 集但已 completed/skipped（re-plan 场景）→ 重导到首个未完成 task；
// 4) 绕过 task-write 直接造孤儿 → plan-review 以 current_tasks_orphaned hard issue 挡 ready；
// 5) 空锚点 + 源有未完成 task（legacy 未 seed 存量）→ plan-review current_tasks_empty 挡 ready；
// 6) status 派生 current_tasks_orphaned 只读标记；7) pre-execute-inject hook 对孤儿/终结锚点硬阻断；
// 8) failed/blocked 残留时锚点回退 retry/unblock 目标（advance 末 task / task-write 重导同语义，
//    防「current_tasks_empty 挡 ready 而重导选不出锚点」的死循环）；
// 9) repair-anchor reseed-only 幂等修锚；10) task-write 回报 stale_progress_ids / reseed_error。
// 临时 HOME 隔离真实 ~/.claude；require 在设 HOME 后做，并清缓存让 path_utils/task_store 读临时 HOME。

let homeEnv
let tmpHome
let projectRoot
let planComposer
let taskStore
let taskManager
let cli
const PROJECT_ID = 'anchor-reseed-pid'

function clearModuleCache() {
  for (const rel of [
    '../path_utils.js',
    '../task_store.js',
    '../task_source.js',
    '../task_manager.js',
    '../state_manager.js',
    '../plan_composer.js',
    '../lifecycle_cmds.js',
    '../execution_sequencer.js',
    '../workflow_types.js',
    '../workflow_cli.js',
  ]) {
    try { delete require.cache[require.resolve(rel)] } catch { /* ignore */ }
  }
}

function statePath() {
  return path.join(tmpHome, '.claude', 'workflows', PROJECT_ID, 'workflow-state.json')
}

function readStateJson() {
  return JSON.parse(fs.readFileSync(statePath(), 'utf8'))
}

function writeStateJson(state) {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
}

function writeTasksJson(records) {
  const jsonPath = path.join(tmpHome, 'wf-tasks.json')
  fs.writeFileSync(jsonPath, JSON.stringify(records))
  return jsonPath
}

beforeEach(() => {
  homeEnv = isolateHome('wf-reseed-')
  tmpHome = homeEnv.tmpHome
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-reseed-proj-'))
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify({ project: { id: PROJECT_ID, name: 'reseed-proj', type: 'single' } }, null, 2)}\n`)

  clearModuleCache()
  planComposer = require('../plan_composer.js')
  taskStore = require('../task_store.js')
  taskManager = require('../task_manager.js')
  cli = require('../workflow_cli.js')
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
  try { fs.rmSync(projectRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

function approvePlan() {
  const result = planComposer.cmdPlan('前端实现登录页\n后端实现登录接口', false, false, null, projectRoot, 'Spec 正确，生成 Plan')
  assert.equal(result.workflow_status, 'planned')
  assert.deepEqual(result.current_tasks, ['T1'], '前置：spec-approve 落锚 T1')
  return result
}

test('task-write 孤儿锚点：renumber 掉 T1 → current_tasks 自动重导到新源首个 task', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T2', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T3', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])

  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.equal(result.written, true)
  assert.deepEqual(result.task_ids, ['T2', 'T3'])
  assert.deepEqual(result.current_tasks_reseeded, { from: 'T1', to: 'T2' }, 'task-write 应报告锚点重导')
  assert.deepEqual(readStateJson().current_tasks, ['T2'], 'state.current_tasks 应重导到新源首个未完成 task')
})

test('task-write 锚点仍有效：T1 在新 id 集 → 不写 state、updated_at 不动', () => {
  approvePlan()
  const before = readStateJson()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])

  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.equal(result.written, true)
  assert.equal(result.current_tasks_reseeded, undefined, '锚点有效不应重导')
  const after = readStateJson()
  assert.deepEqual(after.current_tasks, ['T1'])
  assert.equal(after.updated_at, before.updated_at, '锚点有效时不得 bump updated_at（避免打 stale 下游 handoff）')
})

test('task-write 无活跃 state：纯 task-dir 写入不报错、无重导字段', () => {
  // 不跑 cmdPlan——无 workflow-state.json，重导逻辑应静默跳过（task_write_render 场景兼容）。
  const jsonPath = writeTasksJson([{ id: 'T1', name: '独立任务', task_text: '正文。', acceptance: ['ok'] }])
  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.equal(result.written, true)
  assert.equal(result.current_tasks_reseeded, undefined)
  assert.equal(result.reseed_error, undefined, '无 state 是正常场景,不应报 reseed_error')
})

test('plan-review 孤儿锚点 lint：绕过 task-write 造孤儿 → current_tasks_orphaned 挡 ready', () => {
  approvePlan()
  // 直接 replaceAllTasks 绕过 cmdTaskWrite 的重导（模拟历史脏数据 / 非常路径写入）。
  taskStore.replaceAllTasks(PROJECT_ID, [{ id: 'T5', name: '游离任务', task_text: '正文。', acceptance: ['ok'] }])
  assert.deepEqual(readStateJson().current_tasks, ['T1'], '前置：锚点仍指向已被替换掉的 T1')

  const review = planComposer.cmdPlanReview(PROJECT_ID, projectRoot)
  assert.equal(review.ready, false, '孤儿锚点必须挡 ready')
  const orphanIssue = (review.lints.task_schema.issues || []).find((issue) => issue.problem === 'current_tasks_orphaned')
  assert.ok(orphanIssue, `task_schema.issues 应含 current_tasks_orphaned，实际: ${JSON.stringify(review.lints.task_schema.issues)}`)
  assert.deepEqual(orphanIssue.orphaned_task_ids, ['T1'])
})

test('plan-review 锚点有效：task-write 重导后 ready 不被 current_tasks_orphaned 阻断', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T2', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)

  const review = planComposer.cmdPlanReview(PROJECT_ID, projectRoot)
  const orphanIssue = (review.lints.task_schema.issues || []).find((issue) => issue.problem === 'current_tasks_orphaned')
  assert.equal(orphanIssue, undefined, '重导后不应再有孤儿 issue')
})

test('task-write 锚点已完成：anchor 在新集但 progress.completed 命中 → 重导到首个未完成 task', () => {
  approvePlan()
  // 模拟 re-plan 场景：T1 已完成后整集重写仍含 T1。
  const state = readStateJson()
  state.progress = { ...(state.progress || {}), completed: ['T1'] }
  writeStateJson(state)

  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.deepEqual(result.current_tasks_reseeded, { from: 'T1', to: 'T2' }, '已完成锚点应重导到首个未完成 task')
  assert.deepEqual(readStateJson().current_tasks, ['T2'])
})

test('task-write 锚点 failed 且仍在新集：retry 目标合法保留,不重导', () => {
  approvePlan()
  // halted/failure：cmdFail 语义锚点 = retry 目标，re-plan 保留该 id 时不得被重导走。
  const state = readStateJson()
  state.status = 'halted'
  state.halt_reason = 'failure'
  state.progress = { ...(state.progress || {}), failed: ['T1'] }
  writeStateJson(state)

  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.equal(result.current_tasks_reseeded, undefined, 'failed 锚点是 retry 目标,不应重导')
  assert.deepEqual(readStateJson().current_tasks, ['T1'])
})

test('plan-review 空锚点：current_tasks=[] 而源有未完成 task → current_tasks_empty 挡 ready', () => {
  approvePlan()
  const state = readStateJson()
  state.current_tasks = []
  writeStateJson(state)

  const review = planComposer.cmdPlanReview(PROJECT_ID, projectRoot)
  assert.equal(review.ready, false, '空锚点必须挡 ready')
  const emptyIssue = (review.lints.task_schema.issues || []).find((issue) => issue.problem === 'current_tasks_empty')
  assert.ok(emptyIssue, `task_schema.issues 应含 current_tasks_empty，实际: ${JSON.stringify(review.lints.task_schema.issues)}`)
})

test('plan-review 空锚点但全部完成：不报 current_tasks_empty（合法终态）', () => {
  approvePlan()
  const state = readStateJson()
  const allIds = taskStore.listTasks(PROJECT_ID).map((t) => t.id)
  state.current_tasks = []
  state.progress = { ...(state.progress || {}), completed: allIds }
  writeStateJson(state)

  const review = planComposer.cmdPlanReview(PROJECT_ID, projectRoot)
  const emptyIssue = (review.lints.task_schema.issues || []).find((issue) => issue.problem === 'current_tasks_empty')
  assert.equal(emptyIssue, undefined, '全部完成后的空锚点合法,不应报 issue')
})

// 回归（review 2026-06-04 榜首）：仅剩 failed task 时空锚点曾形成无解循环——
// current_tasks_empty 挡 ready，而重导选不出锚点（cmdNext 排除 failed）→ task-write 修不动。
// 修复后链路：advance 末 task 回退锚到 failed（不落空）；既有空锚点脏数据由 task-write/repair-anchor
// 经 selectAnchorId 回退修复。
test('failed 残留：advance 完成最后可派发 task → 锚点回退 retry 目标,不落空', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)

  const failed = taskManager.cmdFail('T2', '验证失败', PROJECT_ID, projectRoot)
  assert.equal(failed.failed, true)
  const advanced = cli.cmdAdvance('T1', null, null, PROJECT_ID, projectRoot)
  assert.equal(advanced.advanced, true)

  const state = readStateJson()
  assert.deepEqual(state.current_tasks, ['T2'], '无可派发 task 时锚点应回退 failed retry 目标,不得置空')
  assert.equal(state.status, 'halted', 'failed 残留不得误判 completed')

  const review = planComposer.cmdPlanReview(PROJECT_ID, projectRoot)
  const issues = review.lints.task_schema.issues || []
  assert.equal(issues.find((issue) => issue.problem === 'current_tasks_empty'), undefined, '锚点未落空,不应报 current_tasks_empty')
  assert.equal(issues.find((issue) => issue.problem === 'current_tasks_orphaned'), undefined)
})

test('failed 残留 + 空锚点脏数据：task-write 重导回退 retry 目标（死循环已修复）', () => {
  approvePlan()
  // 手造修复前 advance 落出的坏状态：空锚点 + 仅剩 failed task。
  const state = readStateJson()
  state.status = 'halted'
  state.halt_reason = 'failure'
  state.current_tasks = []
  state.progress = { ...(state.progress || {}), completed: ['T1'], failed: ['T2'] }
  writeStateJson(state)

  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.deepEqual(result.current_tasks_reseeded, { from: null, to: 'T2' }, '空锚点应回退到 failed retry 目标')
  assert.deepEqual(readStateJson().current_tasks, ['T2'])

  const review = planComposer.cmdPlanReview(PROJECT_ID, projectRoot)
  const emptyIssue = (review.lints.task_schema.issues || []).find((issue) => issue.problem === 'current_tasks_empty')
  assert.equal(emptyIssue, undefined, '重导后 current_tasks_empty 不应再挡 ready（循环收敛）')
})

test('repair-anchor：孤儿锚点 reseed-only 修复,task 集不重写,二次调用幂等', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  // context 背包随 task 存在；repair-anchor 不得动 task-dir。
  const beforeTasks = taskStore.listTasks(PROJECT_ID)
  // 手编 state 造孤儿（repair-anchor 的目标场景）。
  const state = readStateJson()
  state.current_tasks = ['T9']
  writeStateJson(state)

  const repaired = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(repaired.repaired, true)
  assert.equal(repaired.from, 'T9')
  assert.equal(repaired.to, 'T1')
  assert.deepEqual(readStateJson().current_tasks, ['T1'])
  assert.deepEqual(taskStore.listTasks(PROJECT_ID), beforeTasks, 'repair-anchor 不得改写 task-dir')

  const again = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(again.repaired, false, '锚点已有效,二次调用应幂等 no-op')
  assert.equal(again.reason, 'anchor_valid')
})

// 回归（verify workflow R1/R2）：advance 末 task 回退 blocked 锚点时必须同步 halted/dependency——
// 否则 running + blocked 锚点让 pre-execute hook 状态门（canDispatch=running）放行派发被阻塞任务。
test('blocked 残留：advance 完成最后可派发 task → 锚点回退 unblock 目标且状态对齐 halted/dependency', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  const state = readStateJson()
  state.status = 'running'
  state.progress = { ...(state.progress || {}), blocked: ['T2'] }
  writeStateJson(state)

  const advanced = cli.cmdAdvance('T1', null, null, PROJECT_ID, projectRoot)
  assert.equal(advanced.advanced, true)
  const after = readStateJson()
  assert.deepEqual(after.current_tasks, ['T2'], '锚点应回退 blocked unblock 目标')
  assert.equal(after.status, 'halted', 'blocked 锚点不得伴随 running（hook 状态门依赖此不变式）')
  assert.equal(after.halt_reason, 'dependency')
})

test('repair-anchor：终态守门——completed workflow 不可修锚（防复活锚点）', () => {
  approvePlan()
  const state = readStateJson()
  state.status = 'completed'
  state.current_tasks = []
  writeStateJson(state)

  const result = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(result.repaired, false)
  assert.equal(result.reason, 'status_not_repairable')
  assert.deepEqual(readStateJson().current_tasks, [], '终态锚点不得被复活')
})

test('repair-anchor：空锚点 + 仅剩 failed → 锚到 retry 目标；无活跃 state → error', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  const state = readStateJson()
  state.status = 'halted'
  state.halt_reason = 'failure'
  state.current_tasks = []
  state.progress = { ...(state.progress || {}), completed: ['T1'], failed: ['T2'] }
  writeStateJson(state)

  const repaired = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(repaired.repaired, true)
  assert.deepEqual(repaired.current_tasks, ['T2'], '空锚点应回退 failed retry 目标')

  fs.rmSync(statePath(), { force: true })
  const noState = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.ok(noState.error, '无活跃 state 应报错而非静默')
})

test('task-write 回报 stale_progress_ids：progress 含不在新源的 id', () => {
  approvePlan()
  const state = readStateJson()
  state.progress = { ...(state.progress || {}), completed: ['T9'] }
  writeStateJson(state)

  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
  ])
  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.deepEqual(result.stale_progress_ids, ['T9'], 'progress 中不在新源的 id 应回报人工裁决')
})

test('task-write 回报 reseed_error：state JSON 损坏时 task 已写入但锚点重导失败需显式可见', () => {
  approvePlan()
  fs.writeFileSync(statePath(), '{ corrupted-json')

  const jsonPath = writeTasksJson([
    { id: 'T2', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
  ])
  const result = cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  assert.equal(result.written, true, 'task-dir 写入本身成功')
  assert.deepEqual(result.task_ids, ['T2'])
  assert.ok(result.reseed_error, `重导失败必须显式回报,实际: ${JSON.stringify(result)}`)
  assert.equal(result.current_tasks_reseeded, undefined)
})

test('status 派生 current_tasks_orphaned：锚点孤儿时只读暴露,正常时无该字段', () => {
  approvePlan()
  const healthy = taskManager.cmdStatus(PROJECT_ID, projectRoot)
  assert.equal(healthy.current_tasks_orphaned, undefined, '锚点健康时不应有标记')

  taskStore.replaceAllTasks(PROJECT_ID, [{ id: 'T5', name: '游离任务', task_text: '正文。', acceptance: ['ok'] }])
  const orphaned = taskManager.cmdStatus(PROJECT_ID, projectRoot)
  assert.equal(orphaned.current_tasks_orphaned, true, '锚点孤儿时 status 应派生 current_tasks_orphaned: true')
})

test('status 全量锚点检查：current_tasks 第二个 id 孤儿也触发标记（对齐 plan-review 广度）', () => {
  approvePlan()
  const state = readStateJson()
  state.current_tasks = ['T1', 'T9']
  writeStateJson(state)

  const result = taskManager.cmdStatus(PROJECT_ID, projectRoot)
  assert.equal(result.current_tasks_orphaned, true, '非 [0] 位置的孤儿 id 也应暴露,与 plan-review 判定一致')
})

function runHookWith(input) {
  // fileURLToPath（而非 URL.pathname）：win32 下 pathname 形如 /C:/... 不是合法 fs 路径。
  const hookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../hooks/pre-execute-inject.js')
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input),
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
  })
}

const HOOK_TASK_INPUT = {
  tool_name: 'Task',
  tool_input: { description: 'implement: 登录', prompt: 'Active task: T1', subagent_type: 'general-purpose' },
}

test('pre-execute-inject hook：孤儿锚点硬阻断,健康锚点放行', () => {
  approvePlan()
  // 推进到 running + 造孤儿（绕过 task-write 重导）。
  const state = readStateJson()
  state.status = 'running'
  writeStateJson(state)
  taskStore.replaceAllTasks(PROJECT_ID, [{ id: 'T5', name: '游离任务', task_text: '正文。', acceptance: ['ok'] }])

  const blocked = runHookWith(HOOK_TASK_INPUT)
  assert.match(blocked.stdout, /current_tasks_orphaned/, `孤儿锚点应硬阻断,实际输出: ${blocked.stdout}`)

  // 修复锚点 → 放行（不再出现孤儿阻断）。
  const fixed = readStateJson()
  fixed.current_tasks = ['T5']
  writeStateJson(fixed)
  const allowed = runHookWith(HOOK_TASK_INPUT)
  assert.doesNotMatch(allowed.stdout, /current_tasks_orphaned/, `健康锚点不应被孤儿阻断,实际输出: ${allowed.stdout}`)
})

test('pre-execute-inject hook：锚点指向已完成 task（手编 state）→ current_tasks_finished 阻断', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  // 手编：anchor 指向已完成 task（advance/task-write 正常路径不会产出此态）。
  const state = readStateJson()
  state.status = 'running'
  state.current_tasks = ['T1']
  state.progress = { ...(state.progress || {}), completed: ['T1'] }
  writeStateJson(state)

  const blocked = runHookWith(HOOK_TASK_INPUT)
  assert.match(blocked.stdout, /current_tasks_finished/, `终结锚点应硬阻断防重做,实际输出: ${blocked.stdout}`)

  // repair-anchor 修复 → 放行。
  const repaired = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(repaired.repaired, true)
  assert.deepEqual(repaired.current_tasks, ['T2'])
  const allowed = runHookWith(HOOK_TASK_INPUT)
  assert.doesNotMatch(allowed.stdout, /current_tasks_finished/, `修复后不应再被终结锚点阻断,实际输出: ${allowed.stdout}`)
})

// 回归（diff-review 2026-06-04 F-01）：终结 id 残留 progress.blocked（脏数据，如 completed 后未清
// blocked 的存量 state）→ selectAnchorId 回退域排除已终结 id，repair-anchor 不得锚回终结 id
// 形成「修复→hook 仍阻断→再修复」假修复死循环；重导结果与现状相同时幂等 no-op（不写 state）。
test('repair-anchor 终结残留：completed id 滞留 blocked → 清锚收敛,二次调用幂等 no-op', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  // 手造脏数据：全部完成但 T2 同时残留 blocked，锚点指向 T2（终结）。
  const state = readStateJson()
  state.status = 'halted'
  state.halt_reason = 'dependency'
  state.current_tasks = ['T2']
  state.progress = { ...(state.progress || {}), completed: ['T1', 'T2'], blocked: ['T2'] }
  writeStateJson(state)

  const r1 = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(r1.repaired, true)
  assert.equal(r1.to, null, '回退域排除终结 id：无可锚 → 清空锚点,不得锚回 T2')
  assert.deepEqual(readStateJson().current_tasks, [])

  const before = readStateJson()
  const r2 = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(r2.repaired, false, '重导无可改善 → 幂等 no-op,不得反复报 repaired:true')
  assert.equal(readStateJson().updated_at, before.updated_at, 'no-op 不得写 state')
})

// 回归（diff-review 2026-06-04 F-02）：halted/failure + failed/pending 混合源 + 锚点损坏 →
// state-aware 重导锚定 halt 目标（failed retry 目标）而非 dispatchable pending task——
// 否则 resume 三元组自相矛盾（status 要 retry、锚却指向从未失败 task → --retry 误靶）。
test('repair-anchor state-aware：halted/failure 混合源孤儿锚 → 锚定 failed retry 目标而非 pending', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'] },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  const state = readStateJson()
  state.status = 'halted'
  state.halt_reason = 'failure'
  state.current_tasks = ['T9']
  state.progress = { ...(state.progress || {}), failed: ['T1'] }
  writeStateJson(state)

  const repaired = cli.cmdRepairAnchor(PROJECT_ID, projectRoot)
  assert.equal(repaired.repaired, true)
  assert.equal(repaired.to, 'T1', 'halted/failure 应锚定 failed retry 目标,而非 dispatchable T2')
  const after = readStateJson()
  assert.deepEqual(after.current_tasks, ['T1'])
  assert.equal(after.status, 'halted')
  assert.equal(after.halt_reason, 'failure')
})

// 同上 F-02 的 cmdInit 自愈面：state 丢失重建时 failed+pending 混合 → 锚定 failed（与 cmdFail 落锚一致）。
test('cmdInit state-aware：failed+pending 混合源自愈 → halted/failure 且锚定 failed retry 目标', () => {
  approvePlan()
  const jsonPath = writeTasksJson([
    { id: 'T1', name: '登录表单', task_text: '实现表单。', acceptance: ['表单可提交'], status: 'failed' },
    { id: 'T2', name: '登录接口', task_text: '实现接口。', acceptance: ['接口 200'] },
  ])
  cli.cmdTaskWrite(jsonPath, PROJECT_ID, projectRoot)
  fs.rmSync(statePath(), { force: true })

  const result = cli.cmdInit(PROJECT_ID, projectRoot)
  assert.equal(result.initialized, true)
  assert.equal(result.workflow_status, 'halted')
  assert.equal(result.halt_reason, 'failure')
  assert.equal(result.first_task, 'T1', '自愈推导 halted/failure 应锚定 failed retry 目标,而非 dispatchable T2')
})
