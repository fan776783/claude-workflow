// T8/FR-7: Coverage 降级为 advisory。
// 断言 cmdPlanReview 在 spec 有 uncovered R-ID 时 ready 仍可 true（coverage 不卡 ready），
// 且 coverage 仍作为 advisory 字段返回；并断言 doc_contracts 不再要求 requirement_coverage marker。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { isolateHome } from './_test_env.mjs'

// HOME 隔离（require 之前生效）：getWorkflowStatePath 在调用时读 os.homedir()，
// 隔离后 state 落临时目录，不污染真实 ~/.claude/workflows。
const homeEnv = isolateHome('cov-advisory-home-')
after(() => homeEnv.cleanup())

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workflowDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(workflowDir, '..', '..', '..')

const { cmdPlanReview } = require(path.join(workflowDir, 'plan_composer.js'))
const { ensureStateDefaults } = require(path.join(workflowDir, 'workflow_types.js'))
const { getWorkflowStatePath } = require(path.join(workflowDir, 'path_utils.js'))
const { validatePlanTemplate } = require(path.join(workflowDir, 'doc_contracts.js'))

function setupSandboxState({ planContent, specContent }) {
  const projectId = `cov${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
  const statePath = getWorkflowStatePath(projectId)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-advisory-'))
  const planPath = path.join(tmpDir, 'plan.md')
  const specPath = path.join(tmpDir, 'spec.md')
  fs.writeFileSync(planPath, planContent)
  fs.writeFileSync(specPath, specContent)
  const state = ensureStateDefaults({
    project_id: projectId,
    status: 'planned',
    plan_file: planPath,
    spec_file: specPath,
    // C-1 不变式：planned ⟹ current_tasks[0] = task 源 firstTaskId（缺失会被
    // plan-review 的 current_tasks_empty hard issue 正确拦下，非本测试关注点）。
    current_tasks: ['T1'],
  })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return { projectId, statePath, tmpDir }
}

// 干净 plan + 验证命令/期望齐备、无 placeholder、无 anchor → 仅 coverage 缺口存在。
const CLEAN_PLAN = '## T1: foo\n- **需求 ID**: R-001\n- **验证命令**: npm test\n- **验证期望**: PASS\n'

test('cmdPlanReview ready=true when spec has uncovered R-ID (coverage advisory, not blocking)', () => {
  const spec = 'R-001 R-999 untouched second requirement'
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: CLEAN_PLAN, specContent: spec })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, true, `uncovered R-ID must not block ready, got ${JSON.stringify(result)}`)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanReview still returns coverage as an advisory field', () => {
  const spec = 'R-001 R-999 untouched second requirement'
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: CLEAN_PLAN, specContent: spec })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.ok(result.coverage, 'coverage field still present')
    assert.deepEqual(result.coverage.uncovered_ids, ['R-999'], 'uncovered_ids still computed for human review')
    assert.deepEqual(result.coverage.covered_ids, ['R-001'])
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('validatePlanTemplate no longer requires requirement_coverage marker', () => {
  // 一个不含任何 Requirement Coverage 段的模板，仅含其余 required markers → 应通过。
  const minimalTemplate = [
    '# {{task_name}}',
    'Spec: {{spec_file}}',
    '<!-- WF:ANCHOR:file_structure:begin -->',
    '<!-- WF:ANCHOR:file_structure:end -->',
    '## Tasks',
    '<!-- WF:ANCHOR:tasks:begin -->',
    '{{tasks}}',
    '<!-- WF:ANCHOR:tasks:end -->',
    '<!-- WF:ANCHOR:verification_summary:begin -->',
    '<!-- WF:ANCHOR:verification_summary:end -->',
    '- **阶段**: x',
    '- **Spec 参考**: x',
    '- **Plan 参考**: x',
    '- **需求 ID**: x',
    '- **actions**: x',
    '- **步骤**: x',
  ].join('\n')
  const result = validatePlanTemplate(minimalTemplate)
  assert.ok(!result.missing_markers.includes('{{requirement_coverage}}'), 'requirement_coverage marker dropped')
  assert.ok(!result.missing_markers.includes('## Requirement Coverage'), 'Requirement Coverage heading marker dropped')
  assert.deepEqual(result.missing_markers, [], `no markers should be missing, got ${JSON.stringify(result.missing_markers)}`)
})
