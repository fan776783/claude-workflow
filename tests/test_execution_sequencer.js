const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const {
  detectNextTask,
  resetRetryRuntime,
} = require(path.join(workflowDir, 'execution_sequencer.js'))
const { ensureStateDefaults } = require(path.join(workflowDir, 'workflow_types.js'))

// resetRetryRuntime requires a canonical workflow state path (~/.claude/workflows/{id}/...). Build one
// under a sandboxed HOME so the canonical-path assertion in path_utils passes.
// path_utils 走 os.homedir()：win32 读 USERPROFILE（再 fallback HOMEDRIVE+HOMEPATH），POSIX 读 HOME。
// 四个都设才能跨平台把 os.homedir() 钉到测试 home（与 test_workflow_helpers.js 的 withHome 一致）。
function withHome(home, fn) {
  const previousHome = process.env.HOME
  const previousUserProfile = process.env.USERPROFILE
  const previousHomeDrive = process.env.HOMEDRIVE
  const previousHomePath = process.env.HOMEPATH
  const parsedHome = path.parse(home)
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.HOMEDRIVE = parsedHome.root.replace(/[\\\/]+$/, '') || parsedHome.root
  process.env.HOMEPATH = home.slice(process.env.HOMEDRIVE.length) || path.sep
  try {
    return fn()
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    if (previousHomeDrive === undefined) delete process.env.HOMEDRIVE
    else process.env.HOMEDRIVE = previousHomeDrive
    if (previousHomePath === undefined) delete process.env.HOMEPATH
    else process.env.HOMEPATH = previousHomePath
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

// S3 重基（FR-2）：detectNextTask 从吃 plan.md 文本改为吃 TaskSource.listTasks() 的 task 记录数组。
const TASK_RECORDS = [
  { id: 'T1', phase: 'implement', status: 'pending' },
  { id: 'T2', phase: 'test', status: 'pending' },
]

test('detectNextTask walks the task source based on progress', async (t) => {
  await t.test('returns first task when nothing is completed', () => {
    assert.equal(detectNextTask(TASK_RECORDS, { status: 'running' }), 'T1')
  })

  await t.test('advances past completed tasks', () => {
    const next = detectNextTask(TASK_RECORDS, { status: 'running', progress: { completed: ['T1'] } })
    assert.equal(next, 'T2')
  })

  await t.test('skips skipped and failed tasks too', () => {
    const next = detectNextTask(TASK_RECORDS, {
      status: 'running',
      progress: { completed: [], skipped: ['T1'], failed: [], blocked: [] },
    })
    assert.equal(next, 'T2')
  })

  await t.test('returns null when all tasks are done', () => {
    const next = detectNextTask(TASK_RECORDS, { status: 'running', progress: { completed: ['T1', 'T2'] } })
    assert.equal(next, null)
  })

  await t.test('returns null for empty task source', () => {
    assert.equal(detectNextTask([], { status: 'running' }), null)
    assert.equal(detectNextTask(null, { status: 'running' }), null)
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
