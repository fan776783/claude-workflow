const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const {
  HARD_STOP_ACTIONS,
  decideGovernanceAction,
  decidePostExecutionAction,
  assessContextPollutionRisk,
} = require(path.join(workflowDir, 'execution_sequencer.js'))

const buildState = (projectedUsagePercent = 0) => ({
  status: 'running',
  contextMetrics: {
    projectedUsagePercent,
    warningThreshold: 60,
    dangerThreshold: 80,
    hardHandoffThreshold: 90,
  },
})

test('execution_sequencer quality-gate alignment', async (t) => {
  await t.test('pre-execution decide on quality_gate task at safe budget returns continue-direct', () => {
    const state = buildState(0)
    const qgTask = { id: 'T1', quality_gate: true, actions: ['quality_review'], steps: ['s1'] }
    const decision = decideGovernanceAction(state, qgTask, 'continuous', false, false)
    assert.equal(decision.action, 'continue-direct', 'quality_gate task at 0% budget must continue, not halt')
    assert.equal(HARD_STOP_ACTIONS.has(decision.action), false)
  })

  await t.test('pre-execution decide still respects pause-before-commit', () => {
    const state = buildState(0)
    const commitTask = { id: 'T1', actions: ['git_commit'], steps: [] }
    const decision = decideGovernanceAction(state, commitTask, 'continuous', true, false)
    assert.equal(decision.action, 'pause-before-commit')
    assert.equal(HARD_STOP_ACTIONS.has(decision.action), true)
  })

  await t.test('pre-execution decide still hard-stops at hard handoff threshold', () => {
    const state = buildState(95)
    const task = { id: 'T1', actions: [], steps: [] }
    const decision = decideGovernanceAction(state, task, 'continuous', false, false)
    assert.equal(decision.action, 'handoff-required')
    assert.equal(decision.severity, 'critical')
  })

  await t.test('assessContextPollutionRisk does not treat quality_review as auto-high', () => {
    const budget = { at_warning: false }
    const task = { actions: ['quality_review'], verification: {}, files: {}, steps: [] }
    const risk = assessContextPollutionRisk(task, budget)
    assert.notEqual(risk.level, 'high', 'quality_review alone should not force high pollution')
  })

  await t.test('assessContextPollutionRisk still flags run_tests as high', () => {
    const budget = { at_warning: false }
    const task = { actions: ['run_tests'], verification: {}, files: {}, steps: [] }
    const risk = assessContextPollutionRisk(task, budget)
    assert.equal(risk.level, 'high')
    assert.equal(risk.preferredExecutionPath, 'single-subagent')
  })
})

test('decidePostExecutionAction matrix', async (t) => {
  const qgTask = { id: 'T1', quality_gate: true, actions: ['quality_review'] }
  const plainTask = { id: 'T2', actions: ['create_file'] }

  await t.test('review PASS + safe budget → continue-direct', () => {
    const decision = decidePostExecutionAction(buildState(0), qgTask, { passed: true, decision: 'approved' })
    assert.equal(decision.action, 'continue-direct')
    assert.equal(decision.reason, 'post-execution-allows')
  })

  await t.test('review FAIL → pause-quality-gate (warning)', () => {
    const decision = decidePostExecutionAction(buildState(0), qgTask, { passed: false, decision: 'rejected' })
    assert.equal(decision.action, 'pause-quality-gate')
    assert.equal(decision.severity, 'warning')
    assert.equal(decision.reason, 'review-failed')
    assert.equal(HARD_STOP_ACTIONS.has(decision.action), true, 'pause-quality-gate remains a hard stop in post-execution')
  })

  await t.test('review PASS but quality_gate + budget warning → pause-quality-gate (info)', () => {
    const decision = decidePostExecutionAction(buildState(65), qgTask, { passed: true })
    assert.equal(decision.action, 'pause-quality-gate')
    assert.equal(decision.severity, 'info')
    assert.equal(decision.reason, 'quality-gate-budget-pressure')
  })

  await t.test('review PASS + non-quality-gate task + budget warning → continue-direct', () => {
    const decision = decidePostExecutionAction(buildState(65), plainTask, { passed: true })
    assert.equal(decision.action, 'continue-direct')
  })

  await t.test('hard handoff overrides everything', () => {
    const decision = decidePostExecutionAction(buildState(95), qgTask, { passed: true })
    assert.equal(decision.action, 'handoff-required')
    assert.equal(decision.severity, 'critical')
  })

  await t.test('completed git_commit task does not trigger pause-before-commit in post-execution', () => {
    // pause-before-commit is a pre-execution gate (look at next task before it runs).
    // decidePostExecutionAction does not re-check git_commit on completedTask — commit already happened.
    const commitTask = { id: 'T3', actions: ['git_commit'] }
    const decision = decidePostExecutionAction(buildState(0), commitTask, { passed: true })
    assert.equal(decision.action, 'continue-direct', 'post-execution must not pause for already-completed commit task')
  })

  await t.test('null reviewResult + safe budget + non-quality-gate → continue-direct (defensive)', () => {
    const decision = decidePostExecutionAction(buildState(0), plainTask, null)
    assert.equal(decision.action, 'continue-direct')
  })
})
