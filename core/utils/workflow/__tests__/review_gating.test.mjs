import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

const require = createRequire(import.meta.url)

// FR-6 / AC-6（T7）：机器 review 自动触发降级为显式开关。
// 默认关：shouldRunCodex* → false、triggerCodexReview 不派 job、ensureStateDefaults 默认 state
// 不含 codex_*_review 子对象（保 user_spec_review）；显式开后两段判定/dispatch 完整恢复。
let homeEnv
let tmpHome
let planningGates
let codexRunner
let workflowTypes

beforeEach(() => {
  homeEnv = isolateHome('wf-review-gating-')
  tmpHome = homeEnv.tmpHome
  delete require.cache[require.resolve('../planning_gates.js')]
  delete require.cache[require.resolve('../codex_review_runner.js')]
  delete require.cache[require.resolve('../workflow_types.js')]
  planningGates = require('../planning_gates.js')
  codexRunner = require('../codex_review_runner.js')
  workflowTypes = require('../workflow_types.js')
})

afterEach(() => {
  try { homeEnv.cleanup() } catch { /* ignore */ }
})

// 强 signal spec（security + migration regex），开启后必触发。
const HOT_SPEC = '## 2. Scope\nsecurity hardening + DB migration + transaction boundary'
const HOT_SIGNALS = { security: true, backend_heavy: true, data: true }

// --- shouldRunCodexSpecReview ---

test('默认（无 options）shouldRunCodexSpecReview 即使强 signal 也 return false', () => {
  const r = planningGates.shouldRunCodexSpecReview(HOT_SPEC, HOT_SIGNALS)
  assert.equal(r.run, false)
  assert.equal(r.reason, 'review-gating-disabled')
})

test('reviewEnabled=false 显式传入 → shouldRunCodexSpecReview return false', () => {
  const r = planningGates.shouldRunCodexSpecReview(HOT_SPEC, HOT_SIGNALS, { reviewEnabled: false })
  assert.equal(r.run, false)
})

test('reviewEnabled=true + 强 signal → shouldRunCodexSpecReview 恢复 true', () => {
  const r = planningGates.shouldRunCodexSpecReview(HOT_SPEC, { security: true }, { reviewEnabled: true })
  assert.equal(r.run, true)
  assert.equal(r.reason, 'signal:security')
})

test('reviewEnabled=true + 无 signal/regex → run false（原 signal 判定生效，非 gating）', () => {
  const r = planningGates.shouldRunCodexSpecReview('plain spec', {}, { reviewEnabled: true })
  assert.equal(r.run, false)
  assert.equal(r.reason, null)
})

// --- shouldRunCodexPlanReview ---

test('默认 shouldRunCodexPlanReview return false', () => {
  const r = planningGates.shouldRunCodexPlanReview('worker queue cron', '', HOT_SIGNALS)
  assert.equal(r.run, false)
  assert.equal(r.reason, 'review-gating-disabled')
})

test('reviewEnabled=true + regex 命中 → shouldRunCodexPlanReview 恢复 true', () => {
  const r = planningGates.shouldRunCodexPlanReview('uses jwt + rbac', '', {}, { reviewEnabled: true })
  assert.equal(r.run, true)
  assert.match(r.reason, /^regex:/)
})

// --- isMachineReviewEnabled config 解析 ---

test('isMachineReviewEnabled：默认/缺 config → false', () => {
  assert.equal(planningGates.isMachineReviewEnabled(null), false)
  assert.equal(planningGates.isMachineReviewEnabled({}), false)
  assert.equal(planningGates.isMachineReviewEnabled({ workflow: {} }), false)
  assert.equal(planningGates.isMachineReviewEnabled({ workflow: { review: false } }), false)
})

test('isMachineReviewEnabled：workflow.review=true / .codex=true / .enabled=true → true', () => {
  assert.equal(planningGates.isMachineReviewEnabled({ workflow: { review: true } }), true)
  assert.equal(planningGates.isMachineReviewEnabled({ workflow: { review: { codex: true } } }), true)
  assert.equal(planningGates.isMachineReviewEnabled({ workflow: { review: { enabled: true } } }), true)
  assert.equal(planningGates.isMachineReviewEnabled({ workflow: { review: { codex: false } } }), false)
})

// --- triggerCodexReview 默认门控（不派 job） ---

test('triggerCodexReview 默认（无 enabled）→ 不派 codex job', () => {
  const state = {
    project_root: tmpHome,
    review_status: { codex_spec_review: { status: 'pending', trigger_reason: 'signal:security' } },
  }
  const r = codexRunner.triggerCodexReview(state, 'spec', { projectRoot: tmpHome })
  assert.equal(r.triggered, false)
  assert.equal(r.reason, 'review-gating-disabled')
  // 未修改 review 记录 / 未写 job_id
  assert.equal(state.review_status.codex_spec_review.status, 'pending')
  assert.equal(state.review_status.codex_spec_review.job_id, undefined)
})

test('triggerCodexReview enabled=false 显式 → 不派 job', () => {
  const state = {
    project_root: tmpHome,
    review_status: { codex_plan_review: { status: 'pending', trigger_reason: 'signal:data' } },
  }
  const r = codexRunner.triggerCodexReview(state, 'plan', { projectRoot: tmpHome, enabled: false })
  assert.equal(r.triggered, false)
  assert.equal(r.reason, 'review-gating-disabled')
})

test('triggerCodexReview enabled=true 但无 review 记录 → 走原逻辑（no-review-record，非 gating）', () => {
  const state = { project_root: tmpHome, review_status: {} }
  const r = codexRunner.triggerCodexReview(state, 'spec', { projectRoot: tmpHome, enabled: true })
  assert.equal(r.triggered, false)
  assert.equal(r.reason, 'no-review-record')
})

// --- ensureStateDefaults 默认 review_status 子结构精简 ---

test('默认 state 不含 codex_spec_review / codex_plan_review / plan_review 子对象', () => {
  const state = workflowTypes.ensureStateDefaults({ status: 'idle' })
  assert.equal(state.review_status.codex_spec_review, undefined)
  assert.equal(state.review_status.codex_plan_review, undefined)
  assert.equal(state.review_status.plan_review, undefined)
})

test('默认 state 完整保留 user_spec_review 人工 gate（C-1）', () => {
  const state = workflowTypes.ensureStateDefaults({ status: 'idle' })
  const usr = state.review_status.user_spec_review
  assert.ok(usr, 'user_spec_review 必须实例化')
  assert.equal(usr.status, 'pending')
  assert.equal(usr.review_mode, 'human_gate')
  assert.equal(usr.reviewer, 'user')
  assert.equal(usr.reviewed_at, null)
  assert.equal(usr.next_action, null)
})

test('老 state 带 codex_*_review 子对象 → 读时保留（非破坏性，仅默认不新建）', () => {
  const legacy = {
    status: 'planned',
    review_status: {
      user_spec_review: { status: 'approved', review_mode: 'human_gate', reviewer: 'user' },
      codex_spec_review: { status: 'completed', reviewer: 'codex' },
    },
  }
  const state = workflowTypes.ensureStateDefaults(legacy)
  assert.equal(state.review_status.codex_spec_review.status, 'completed')
  assert.equal(state.review_status.user_spec_review.status, 'approved')
})

// --- C-5 端到端：cmdSpecReview approve 路径显式开启可恢复（不只 cmdPlan） ---
// 独立 fixture：临时 HOME + project root + project-config.json，跑真实 cmdSpecReview。

const PID2 = 'review-gating-e2e-pid'

function setupProject(reviewFlag) {
  const localHome = isolateHome('wf-rg-e2e-home-')
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rg-e2e-proj-'))
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const config = { project: { id: PID2, name: 'rg-e2e', type: 'single' } }
  if (reviewFlag !== undefined) config.workflow = { review: reviewFlag }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  for (const rel of ['../plan_composer.js', '../task_store.js', '../task_source.js', '../path_utils.js', '../workflow_types.js']) {
    try { delete require.cache[require.resolve(rel)] } catch { /* ignore */ }
  }
  const planComposer = require('../plan_composer.js')
  const pathUtils = require('../path_utils.js')
  return { localHome, projectRoot, planComposer, pathUtils }
}

function readWorkflowState(pathUtils) {
  const statePath = path.join(pathUtils.getWorkflowsDir(PID2), 'workflow-state.json')
  return JSON.parse(fs.readFileSync(statePath, 'utf8'))
}

// reviewEnabled=true 路径会 spawn codex-bridge --background 起 detached worker（cwd=projectRoot）。
// Windows 不允许删除某进程的 cwd → rmSync 抛 EPERM/EBUSY；这是 fire-and-forget 设计的预期 race，
// 非 product bug，teardown 容忍即可（POSIX 不受影响，busy 目录可直接 unlink）。
function rmDirTolerant(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    if (err && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(err.code)) return
    throw err
  }
}

// 强 signal 需求（security/backend/data），开启后 shouldRunCodex* 必判 run=true。
const HOT_REQUIREMENT = '后端实现鉴权 security 接口\n数据迁移 migration + transaction 边界\n约束: 保留现有 session'

test('C-5 默认 config（无 review flag）：cmdSpecReview approve → 不实例化 codex_*_review 子对象', () => {
  const { localHome, projectRoot, planComposer, pathUtils } = setupProject(undefined)
  try {
    planComposer.cmdPlan(HOT_REQUIREMENT, false, false, null, projectRoot, '需要修改 Spec')
    const result = planComposer.cmdSpecReview('Spec 正确，生成 Plan', null, projectRoot)
    assert.equal(result.workflow_status, 'planned')
    assert.deepEqual(result.codex_review_triggers, [], '默认不派 codex job')
    const state = readWorkflowState(pathUtils)
    assert.equal(state.review_status.codex_spec_review, undefined)
    assert.equal(state.review_status.codex_plan_review, undefined)
    assert.equal(state.review_status.plan_review, undefined)
    // user_spec_review 完整（approve 后 = approved）
    assert.equal(state.review_status.user_spec_review.status, 'approved')
  } finally {
    localHome.cleanup()
    rmDirTolerant(projectRoot)
  }
})

test('C-5 config workflow.review.codex=true：cmdSpecReview approve → 实例化 codex_*_review 子对象（pending + trigger_reason）', () => {
  const { localHome, projectRoot, planComposer, pathUtils } = setupProject({ codex: true })
  try {
    planComposer.cmdPlan(HOT_REQUIREMENT, false, false, null, projectRoot, '需要修改 Spec')
    const result = planComposer.cmdSpecReview('Spec 正确，生成 Plan', null, projectRoot)
    assert.equal(result.workflow_status, 'planned')
    const state = readWorkflowState(pathUtils)
    // 显式开启 → 子对象实例化（C-5 能力恢复，非删死）
    assert.ok(state.review_status.codex_spec_review, 'codex_spec_review 应被实例化')
    assert.ok(state.review_status.codex_plan_review, 'codex_plan_review 应被实例化')
    assert.ok(state.review_status.plan_review, 'plan_review 应被实例化')
    // status：pending（未派 job）或 in_progress（codex-bridge 派发成功）——二者都证明 C-5 能力恢复。
    const recoverableStatuses = new Set(['pending', 'in_progress'])
    assert.ok(recoverableStatuses.has(state.review_status.codex_spec_review.status), `spec status=${state.review_status.codex_spec_review.status}`)
    assert.ok(state.review_status.codex_spec_review.trigger_reason, 'spec review trigger_reason 非空')
    assert.ok(recoverableStatuses.has(state.review_status.codex_plan_review.status), `plan status=${state.review_status.codex_plan_review.status}`)
    assert.ok(state.review_status.codex_plan_review.trigger_reason, 'plan review trigger_reason 非空')
    // user_spec_review 不受影响
    assert.equal(state.review_status.user_spec_review.status, 'approved')
  } finally {
    localHome.cleanup()
    rmDirTolerant(projectRoot)
  }
})
