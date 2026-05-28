const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const {
  detectNextTask,
  summarizeExecutionUnit,
  resetRetryRuntime,
} = require(path.join(workflowDir, 'execution_sequencer.js'))
const { ensureStateDefaults } = require(path.join(workflowDir, 'workflow_types.js'))

// resetRetryRuntime requires a canonical workflow state path (~/.claude/workflows/{id}/...). Build one
// under a sandboxed HOME so the canonical-path assertion in path_utils passes.
function withHome(home, fn) {
  const prev = process.env.HOME
  process.env.HOME = home
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.HOME
    else process.env.HOME = prev
  }
}

function canonicalStatePath(home, projectId = 'proj-test') {
  return path.join(home, '.claude', 'workflows', projectId, 'workflow-state.json')
}

// The per-task governance decision machine (decideGovernanceAction / decidePostExecutionAction /
// applyGovernanceDecision / assessContextPollutionRisk / HARD_STOP_ACTIONS) was retired in the
// lean-execute refactor. The survivors below — next-task detection, execution-unit summarization, and
// retry runtime reset — remain the live execution_sequencer helpers and stay under test here.
// markTaskSkipped / prepareRetry survivors are exercised in tests/test_workflow_helpers.js.

const PLAN_FIXTURE = `## T1: 第一个任务
- **阶段**: implement
- **Spec 参考**: §1
- **Plan 参考**: P1
- **状态**: pending
- **actions**: edit_file
- **步骤**:
  - A1: 修改实现 → 完成第一个任务

## T2: 第二个任务
- **阶段**: test
- **Spec 参考**: §2
- **Plan 参考**: P2
- **状态**: pending
- **actions**: run_tests
- **步骤**:
  - A2: 运行测试 → 完成第二个任务
`

test('detectNextTask walks the plan based on progress', async (t) => {
  await t.test('returns first task when nothing is completed', () => {
    assert.equal(detectNextTask(PLAN_FIXTURE, { status: 'running' }), 'T1')
  })

  await t.test('advances past completed tasks', () => {
    const next = detectNextTask(PLAN_FIXTURE, { status: 'running', progress: { completed: ['T1'] } })
    assert.equal(next, 'T2')
  })

  await t.test('skips skipped and failed tasks too', () => {
    const next = detectNextTask(PLAN_FIXTURE, {
      status: 'running',
      progress: { completed: [], skipped: ['T1'], failed: [], blocked: [] },
    })
    assert.equal(next, 'T2')
  })

  await t.test('returns null when all tasks are done', () => {
    const next = detectNextTask(PLAN_FIXTURE, { status: 'running', progress: { completed: ['T1', 'T2'] } })
    assert.equal(next, null)
  })

  await t.test('returns null for empty tasks content', () => {
    assert.equal(detectNextTask('', { status: 'running' }), null)
    assert.equal(detectNextTask(null, { status: 'running' }), null)
  })
})

test('summarizeExecutionUnit derives complexity and consecutive-task budget', async (t) => {
  await t.test('summarizes a simple task', () => {
    const summary = summarizeExecutionUnit({
      id: 'T1',
      phase: 'implement',
      actions: ['edit_file'],
      files: { create: [], modify: ['src/a.py'], test: [] },
      steps: [{ id: 'A1' }],
      quality_gate: false,
    })
    assert.equal(summary.task_id, 'T1')
    assert.equal(summary.phase, 'implement')
    assert.equal(typeof summary.complexity, 'string')
    assert.equal(typeof summary.max_consecutive_tasks, 'number')
    assert.ok(summary.max_consecutive_tasks >= 1)
  })

  await t.test('quality_gate task is summarized without throwing', () => {
    const summary = summarizeExecutionUnit({
      id: 'T9',
      phase: 'implement',
      actions: ['edit_file', 'run_tests', 'quality_review'],
      files: { create: ['src/new.py'], modify: ['src/a.py', 'src/b.py'], test: ['tests/test_a.py'] },
      steps: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }],
      quality_gate: true,
    })
    assert.equal(summary.task_id, 'T9')
    assert.ok(summary.max_consecutive_tasks >= 1)
  })
})

test('resetRetryRuntime clears retry bookkeeping on disk', async (t) => {
  await t.test('zeroes retry_count and hard_stop_triggered for the task', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-reset-retry-'))
    const home = path.join(tmpRoot, 'home')
    fs.mkdirSync(home, { recursive: true })

    withHome(home, () => {
      const statePath = canonicalStatePath(home)
      fs.mkdirSync(path.dirname(statePath), { recursive: true })
      const state = ensureStateDefaults({
        project_id: 'proj-test',
        status: 'running',
        task_runtime: {
          T1: { retry_count: 3, hard_stop_triggered: true, debugging_phases_completed: ['diagnose'] },
        },
      })
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

      const result = resetRetryRuntime(statePath, 'T1')
      assert.equal(result.reset, true)
      assert.equal(result.task_id, 'T1')

      const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(persisted.task_runtime.T1.retry_count, 0)
      assert.equal(persisted.task_runtime.T1.hard_stop_triggered, false)
      assert.deepEqual(persisted.task_runtime.T1.debugging_phases_completed, [])
    })
  })
})
