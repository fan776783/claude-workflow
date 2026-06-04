import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// S2 去骨架（FR-1 / AC-1）回归：cmdSpecReview/cmdPlan approve 后生成工件无 buildTaskBlock 占位 body，
// task-dir 壳落地，current_tasks[0] = TaskDirSource.firstTaskId。
// 临时 HOME 隔离真实 ~/.claude；require 在设 HOME 后做，并清缓存让 path_utils/task_store 读临时 HOME。

let homeEnv
let tmpHome
let projectRoot
let planComposer
let taskStore
let taskSource
const PROJECT_ID = 'specrev-skel-pid'

// buildTaskBlock 占位特征串（AC-1 grep 目标）——生成工件不得含。
const SKELETON_MARKERS = ['src/ui/r-', 'src/server/r-', 'src/shared/r-', '- A1:', '- A2:', '- A3:', 'npm test -- r-']

function clearModuleCache() {
  for (const rel of [
    '../plan_composer.js',
    '../task_store.js',
    '../task_source.js',
    '../path_utils.js',
    '../lifecycle_cmds.js',
  ]) {
    try { delete require.cache[require.resolve(rel)] } catch { /* ignore */ }
  }
}

beforeEach(() => {
  homeEnv = isolateHome('wf-specrev-')
  tmpHome = homeEnv.tmpHome
  // 项目根独立于 HOME，写入 project-config.json（project.id 必须 = PROJECT_ID）。
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-specrev-proj-'))
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify({ project: { id: PROJECT_ID, name: 'specrev-proj', type: 'single' } }, null, 2)}\n`)

  clearModuleCache()
  planComposer = require('../plan_composer.js')
  taskStore = require('../task_store.js')
  taskSource = require('../task_source.js')
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
  try { fs.rmSync(projectRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

function assertNoSkeleton(content, label) {
  for (const marker of SKELETON_MARKERS) {
    assert.ok(!content.includes(marker), `${label} 不应含占位特征串 "${marker}"`)
  }
  // buildTaskBlock 结构化 task block 头形态：`## Tn: 实现 R-xxx`（plan.md 退化后不应出现）
  assert.ok(!/^##\s+T\d+:\s+实现\s+R-/m.test(content), `${label} 不应含结构化 task block 标题`)
  // per-task anchor（buildTaskBlock 产物），plan.md 退化后不应出现
  assert.ok(!/WF:ANCHOR:task:T\d+:begin/.test(content), `${label} 不应含 per-task anchor`)
}

test('cmdPlan + cmdSpecReview approve（两步正路）：plan.md 无占位 body + task-dir 壳 + current_tasks[0]=firstTaskId', () => {
  // 原 --spec-choice 一步式分支已删（无 skill 可达），唯一路径 = cmdPlan 产骨架 → cmdSpecReview approve。
  const requirement = '前端实现登录页表单校验\n后端实现登录鉴权接口\n约束: 必须保留现有 session 逻辑'
  const planRes = planComposer.cmdPlan(requirement, false, false, null, projectRoot)
  assert.equal(planRes.started, true)
  assert.equal(planRes.workflow_status, 'spec_review')
  assert.equal(planRes.plan_file, null, 'cmdPlan 不再生成 plan.md')
  assert.equal(planRes.task_count, 0, 'cmdPlan 不再落 task 壳')

  const result = planComposer.cmdSpecReview('Spec 正确，生成 Plan', null, projectRoot)
  assert.equal(result.workflow_status, 'planned')
  assert.ok(result.task_count >= 1, 'task_count 应 >= 1')

  // plan.md 无占位 skeleton
  const planContent = fs.readFileSync(result.plan_file, 'utf8')
  assertNoSkeleton(planContent, 'plan.md')

  // task-dir 壳存在且为元数据 task.json（无 body），并带 R-ID 链字段
  const tasks = taskStore.listTasks(PROJECT_ID)
  assert.ok(tasks.length >= 1, 'task-dir 应至少有 1 个壳')
  assert.equal(tasks.length, result.task_count, 'task-dir 数应等于 task_count')
  for (const t of tasks) {
    assert.match(t.id, /^T\d+$/)
    assert.equal(t.phase, 'implement')
    assert.equal(t.status, 'pending')
    assert.equal(t.interaction, 'AFK')
    assert.ok(Array.isArray(t.requirement_ids) && t.requirement_ids.length >= 1, '壳应预填 requirement_ids')
  }

  // current_tasks[0] = TaskDirSource.firstTaskId（C-1 来源不断）
  const firstTaskId = new taskSource.TaskDirSource(PROJECT_ID).firstTaskId()
  assert.equal(firstTaskId, 'T1')
  assert.deepEqual(result.current_tasks, [firstTaskId])
  // 正路：cmdPlan 已落盘 signals → approve 复用 persisted，不重派生、无漂移警告。
  assert.equal(result.role_signals_source, 'persisted', 'cmdPlan→approve 正路应复用 persisted signals')
  assert.equal(result.role_signals_warning, undefined, 'persisted 路径不应带漂移警告')
})

test('cmdSpecReview approve：去骨架落 task-dir 壳 + current_tasks[0]=firstTaskId', () => {
  // cmdPlan 落到 spec_review 态（写 spec.md，无 plan、无 task-dir）。
  const requirement = '前端实现搜索框\n后端实现搜索接口'
  const planRes = planComposer.cmdPlan(requirement, false, false, null, projectRoot)
  assert.equal(planRes.workflow_status, 'spec_review')
  assert.equal(planRes.plan_file, null)
  assert.deepEqual(taskStore.listTasks(PROJECT_ID), [], 'spec_review 态不应落 task-dir 壳')

  // approve → cmdSpecReview 落 task-dir + plan.md 退化叙述
  const result = planComposer.cmdSpecReview('Spec 正确，生成 Plan', null, projectRoot)
  assert.equal(result.review_recorded, true)
  assert.equal(result.workflow_status, 'planned')
  assert.ok(result.task_count >= 1)

  const planContent = fs.readFileSync(result.plan_file, 'utf8')
  assertNoSkeleton(planContent, 'plan.md (spec-review)')

  const tasks = taskStore.listTasks(PROJECT_ID)
  assert.equal(tasks.length, result.task_count)
  assert.ok(tasks.length >= 1)

  const firstTaskId = new taskSource.TaskDirSource(PROJECT_ID).firstTaskId()
  assert.equal(firstTaskId, 'T1')
  assert.deepEqual(result.current_tasks, [firstTaskId])

  // task.json 是元数据壳（无 acceptance body 模板串 / 无步骤占位）
  const t1Raw = fs.readFileSync(taskStore.getTaskJsonPath(PROJECT_ID, 'T1'), 'utf8')
  assertNoSkeleton(t1Raw, 'task.json')
})

test('cmdSpecReview approve 占位门：spec.md 含模板占位 → 拒绝 approve 并回 hits', () => {
  const planRes = planComposer.cmdPlan('实现一个带占位的功能', false, false, null, projectRoot)
  assert.equal(planRes.workflow_status, 'spec_review')
  // 人为往 spec.md 注入占位 token，模拟扩写未完成就 approve
  const specContent = fs.readFileSync(planRes.spec_file, 'utf8')
  fs.writeFileSync(planRes.spec_file, `${specContent}\n- TODO 后续完善\n`)

  const result = planComposer.cmdSpecReview('Spec 正确，生成 Plan', null, projectRoot)
  assert.equal(result.reason, 'spec_placeholder', `占位 spec 应被拒绝，got ${JSON.stringify(result)}`)
  assert.ok(Array.isArray(result.placeholder_hits) && result.placeholder_hits.length >= 1)
  // 状态未被推进、未落壳
  assert.deepEqual(taskStore.listTasks(PROJECT_ID), [], '拒绝 approve 后不应落 task 壳')

  // 补全后重 approve 通过
  fs.writeFileSync(planRes.spec_file, specContent)
  const retry = planComposer.cmdSpecReview('Spec 正确，生成 Plan', null, projectRoot)
  assert.equal(retry.workflow_status, 'planned')
})

test('plan.md 退化叙述含 tasks 锚点但不含 parseTasksV2 可解析的结构化 task block', () => {
  planComposer.cmdPlan('实现一个功能', false, false, null, projectRoot)
  const result = planComposer.cmdSpecReview('Spec 正确，生成 Plan', null, projectRoot)
  const planContent = fs.readFileSync(result.plan_file, 'utf8')
  // 顶层 tasks 锚点保留（template 结构锚点不动）
  assert.ok(planContent.includes('<!-- WF:ANCHOR:tasks:begin -->'))
  assert.ok(planContent.includes('<!-- WF:ANCHOR:tasks:end -->'))
  // parseTasksV2 在退化 plan.md 上解析不出 task（机器源已迁 task-dir）
  const { parseTasksV2 } = require('../task_parser.js')
  assert.equal(parseTasksV2(planContent).length, 0, 'plan.md 不应再被 parseTasksV2 当 task 源')
})
