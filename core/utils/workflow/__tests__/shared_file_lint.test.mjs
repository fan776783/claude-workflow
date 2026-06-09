// T-SF: lintSharedFiles 共享文件分析 lint。
// 覆盖 merge 判据四条件正反例 + fan_out + legacy(files=undefined) 不崩 + advisory 装配（ready 不受影响）。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

// HOME 隔离：cmdPlanReview 的 state 落临时目录，不污染真实 ~/.claude/workflows。
const homeEnv = isolateHome('shared-file-home-')
after(() => homeEnv.cleanup())

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workflowDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(workflowDir, '..', '..', '..')

const { lintSharedFiles, cmdPlanReview } = require(path.join(workflowDir, 'plan_composer.js'))
const { ensureStateDefaults } = require(path.join(workflowDir, 'workflow_types.js'))
const { getWorkflowStatePath } = require(path.join(workflowDir, 'path_utils.js'))
const taskStore = require(path.join(workflowDir, 'task_store.js'))

// ---- 纯函数：merge 判据四条件正反例 ----

test('merge_candidate：同文件 + 直接依赖边 + 同 phase + 同 quality_gate', () => {
  const r = lintSharedFiles([
    { id: 'T1', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue'] },
    { id: 'T2', phase: 'implement', quality_gate: false, depends: ['T1'], files: ['a/G.vue'] },
  ])
  assert.equal(r.merge_candidates.length, 1)
  assert.deepEqual(r.merge_candidates[0].task_ids, ['T1', 'T2'])
  assert.deepEqual(r.merge_candidates[0].shared_files, ['a/G.vue'])
})

test('依赖边双向任一即可（B 依赖 A 或 A 依赖 B）', () => {
  const r = lintSharedFiles([
    { id: 'T1', phase: 'implement', quality_gate: false, depends: ['T2'], files: ['a/G.vue'] },
    { id: 'T2', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue'] },
  ])
  assert.equal(r.merge_candidates.length, 1)
})

test('多文件共享同一对 task → 单条候选聚合 shared_files', () => {
  const r = lintSharedFiles([
    { id: 'T1', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue', 'a/H.vue'] },
    { id: 'T2', phase: 'implement', quality_gate: false, depends: ['T1'], files: ['a/G.vue', 'a/H.vue'] },
  ])
  assert.equal(r.merge_candidates.length, 1, '同一对 task 只报一次')
  assert.deepEqual(r.merge_candidates[0].shared_files, ['a/G.vue', 'a/H.vue'])
})

test('no merge：① 同文件但无依赖边（并列兄弟）', () => {
  const r = lintSharedFiles([
    { id: 'T1', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue'] },
    { id: 'T2', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue'] },
  ])
  assert.equal(r.merge_candidates.length, 0)
})

test('no merge：⑤ 跨 quality_gate/commit 边界', () => {
  const r = lintSharedFiles([
    { id: 'T1', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue'] },
    { id: 'T2', phase: 'implement', quality_gate: true, depends: ['T1'], files: ['a/G.vue'] },
  ])
  assert.equal(r.merge_candidates.length, 0)
})

test('no merge：③ 不同 phase', () => {
  const r = lintSharedFiles([
    { id: 'T1', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue'] },
    { id: 'T2', phase: 'test', quality_gate: false, depends: ['T1'], files: ['a/G.vue'] },
  ])
  assert.equal(r.merge_candidates.length, 0)
})

test('传递依赖 A→B→C，A/C 共享文件但无直接边 → 不报 merge', () => {
  const r = lintSharedFiles([
    { id: 'T1', phase: 'implement', quality_gate: false, depends: [], files: ['a/G.vue'] },
    { id: 'T2', phase: 'implement', quality_gate: false, depends: ['T1'], files: ['a/X.vue'] },
    { id: 'T3', phase: 'implement', quality_gate: false, depends: ['T2'], files: ['a/G.vue'] },
  ])
  // T1/T3 共享 a/G.vue 但无直接边（仅经 T2 传递）→ merge 不触发
  assert.equal(r.merge_candidates.length, 0)
})

// ---- 纯函数：fan_out ----

test('fan_out：同文件被 ≥3 task 触及', () => {
  const r = lintSharedFiles([
    { id: 'T1', files: ['locales/zh.json'], depends: [] },
    { id: 'T2', files: ['locales/zh.json'], depends: [] },
    { id: 'T3', files: ['locales/zh.json'], depends: [] },
  ])
  assert.equal(r.fan_out.length, 1)
  assert.equal(r.fan_out[0].task_count, 3)
  assert.equal(r.fan_out[0].shared_file, 'locales/zh.json')
  assert.deepEqual(r.fan_out[0].task_ids, ['T1', 'T2', 'T3'])
})

test('no fan_out：仅 2 task 共享（低于阈值）', () => {
  const r = lintSharedFiles([
    { id: 'T1', files: ['locales/zh.json'], depends: [] },
    { id: 'T2', files: ['locales/zh.json'], depends: [] },
  ])
  assert.equal(r.fan_out.length, 0)
})

// ---- 纯函数：task 源边界（must-fix） ----

test('legacy 形状 task.files===undefined 不抛、信号恒空', () => {
  // LegacyPlanMdSource 的 legacyTaskToRecord 不产出 files 字段（task_source.js:58-77）
  const legacy = [
    { id: 'T1', phase: 'implement', quality_gate: false, depends: [] },
    { id: 'T2', phase: 'implement', quality_gate: false, depends: ['T1'] },
  ]
  let r
  assert.doesNotThrow(() => { r = lintSharedFiles(legacy) })
  assert.equal(r.merge_candidates.length, 0)
  assert.equal(r.fan_out.length, 0)
  assert.equal(r.checked_tasks, 2)
})

test('入参非数组 / 空 / 缺 id 安全', () => {
  assert.doesNotThrow(() => lintSharedFiles(undefined))
  assert.deepEqual(lintSharedFiles(null), { merge_candidates: [], fan_out: [], checked_tasks: 0 })
  // 缺 id 的脏记录跳过，不计入 checked
  assert.equal(lintSharedFiles([{ files: ['a'] }, { id: 'T1', files: ['a'] }]).checked_tasks, 1)
})

// ---- 装配 advisory：lints.shared_file 存在且 ready 不被其影响 ----

function setupSandboxState() {
  const projectId = `sf${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
  const statePath = getWorkflowStatePath(projectId)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-file-'))
  const planPath = path.join(tmpDir, 'plan.md')
  const specPath = path.join(tmpDir, 'spec.md')
  fs.writeFileSync(planPath, '# narrative plan\n- T1 / T2 同改 G.vue（依赖链）\n')
  fs.writeFileSync(specPath, '### 2.1 In Scope\n- R-001: alpha\n')
  const state = ensureStateDefaults({
    project_id: projectId,
    status: 'planned',
    plan_file: planPath,
    spec_file: specPath,
    current_tasks: ['T1'],
  })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return { projectId, statePath, tmpDir }
}

test('cmdPlanReview 暴露 lints.shared_file 且 merge 候选不挡 ready', () => {
  const { projectId, statePath, tmpDir } = setupSandboxState()
  try {
    taskStore.createTask(projectId, {
      id: 'T1', name: 'a', status: 'pending', phase: 'implement',
      files: ['apps/x/G.vue'], requirement_ids: ['R-001'],
      verification: { commands: ['npm test'], expected_output: ['PASS'] },
    })
    taskStore.createTask(projectId, {
      id: 'T2', name: 'b', status: 'pending', phase: 'implement', depends: ['T1'],
      files: ['apps/x/G.vue'], requirement_ids: ['R-001'],
      verification: { commands: ['npm test'], expected_output: ['PASS'] },
    })
    const result = cmdPlanReview(projectId, repoRoot)
    assert.ok(result.lints.shared_file, 'shared_file lint present in result')
    assert.equal(result.lints.shared_file.merge_candidates.length, 1, 'T1+T2 merge candidate surfaced')
    assert.equal(result.ready, true, `shared_file findings must stay advisory (not block ready), got lints=${JSON.stringify(result.lints.shared_file)}`)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
