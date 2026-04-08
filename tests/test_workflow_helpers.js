const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const cliScript = path.join(workflowDir, 'workflow_cli.js')

const planningGates = require(path.join(workflowDir, 'planning_gates.js'))
const qualityReview = require(path.join(workflowDir, 'quality_review.js'))
const executionSequencer = require(path.join(workflowDir, 'execution_sequencer.js'))
const verification = require(path.join(workflowDir, 'verification.js'))
const selfReview = require(path.join(workflowDir, 'self_review.js'))
const pathUtils = require(path.join(workflowDir, 'path_utils.js'))
const planDelta = require(path.join(workflowDir, 'plan_delta.js'))
const workflowTypes = require(path.join(workflowDir, 'workflow_types.js'))
const stateManager = require(path.join(workflowDir, 'state_manager.js'))
const dependencyChecker = require(path.join(workflowDir, 'dependency_checker.js'))

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

function minimumState(status = 'running', currentTasks = ['T1']) {
  return {
    project_id: 'proj-test',
    status,
    current_tasks: currentTasks,
    plan_file: '.claude/plans/test.md',
    spec_file: '.claude/specs/test.md',
    progress: {
      completed: [],
      blocked: [],
      failed: [],
      skipped: [],
    },
    created_at: '2026-03-31T00:00:00',
    updated_at: '2026-03-31T00:00:00',
  }
}

function createCanonicalStateFile(home, projectId = 'proj-test', status = 'running', currentTasks = ['T1']) {
  const statePath = path.join(home, '.claude', 'workflows', projectId, 'workflow-state.json')
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(minimumState(status, currentTasks), null, 2))
  return statePath
}

function withHome(home, fn) {
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    return fn()
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  }
}

function writeProjectConfig(root, projectId = 'proj-test') {
  const configPath = path.join(root, '.claude', 'config', 'project-config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify({ project: { id: projectId, name: 'test-project', type: 'single' } }, null, 2)}\n`)
  return configPath
}

function workflowStatePath(home, projectId) {
  return path.join(home, '.claude', 'workflows', projectId, 'workflow-state.json')
}

function makeCliEnv(root) {
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  return [{ HOME: home }, home]
}

function runNode(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
  })
  return result
}

test('workflow helper migration coverage', async (t) => {
  await t.test('planning gates reflect migrated heuristics', () => {
    assert.equal(planningGates.shouldRunDiscussion('修复按钮', 'inline', false, 0), false)
    assert.equal(planningGates.shouldRunDiscussion('修复按钮', 'inline', false, 1), true)
    assert.equal(planningGates.shouldRunUxDesignGate('新增设置页面', [], null), true)
    assert.equal(
      planningGates.shouldRunUxDesignGate(
        '新增导出功能',
        [{ name: 'react' }],
        { clarifications: [{ dimension: 'behavior' }] }
      ),
      true
    )

    const mapped = planningGates.mapSpecReviewChoice('Spec 正确，生成 Plan')
    assert.equal(mapped.status, 'approved')
    assert.equal(mapped.next_action, 'continue_to_plan_generation')

    const backwardCompatible = planningGates.mapSpecReviewChoice('Spec 正确，继续')
    assert.equal(backwardCompatible.status, 'approved')
    assert.equal(backwardCompatible.next_action, 'continue_to_plan_generation')

    const summary = planningGates.buildSpecReviewSummary(
      '## 2. Scope\nA\n\n## 3. Constraints\nB\n\n## 7. Acceptance Criteria\nC\n'
    )
    assert.match(summary, /## 2\. Scope/)
    assert.match(summary, /## 7\. Acceptance Criteria/)
  })

  await t.test('plan delta helpers add modify and remove tasks', () => {
    const deltas = planDelta.buildTaskDeltaExamples(
      'CHG-001',
      { description: '新增导出字段' },
      [{ id: 'T1' }, { id: 'Task-7' }, { id: 'T8', deprecated: true }]
    )

    assert.deepEqual(deltas.map((delta) => delta.action), ['add', 'modify', 'remove'])
    assert.match(deltas[0].task_markdown, /## T9: 响应增量变更 CHG-001/)
    assert.match(deltas[0].task_markdown, /node --test tests\/test_workflow_helpers\.js/)
    assert.equal(planDelta.getNextTaskIndex([{ id: 'T1' }, { id: 'T2' }, { id: 'T4' }, { id: 'T3', deprecated: true }]), 5)

    const updated = planDelta.applyTaskDeltas(PLAN_FIXTURE, planDelta.buildTaskDeltaExamples(
      'CHG-001',
      { description: '新增导出字段' },
      [{ id: 'T1' }, { id: 'T2' }]
    ))

    assert.match(updated, /## T3: 响应增量变更 CHG-001/)
    assert.match(updated, /## T1: 第一个任务（增量调整）/)
    assert.doesNotMatch(updated, /## T2: 第二个任务/)
  })

  await t.test('quality review helpers persist and read canonical gate results', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-quality-'))
    const home = path.join(tmpRoot, 'home')
    fs.mkdirSync(home, { recursive: true })

    withHome(home, () => {
      const statePath = createCanonicalStateFile(home)
      const gate = qualityReview.buildPassGateResult(
        'T8',
        'abc123',
        'def456',
        'T5',
        'T8',
        3,
        ['R-001'],
        ['不能破坏现有行为'],
        1,
        2,
        0,
        0,
        1,
        2
      )
      const evidence = qualityReview.createQualityReviewEvidence('T8', gate)

      assert.equal(gate.overall_passed, true)
      assert.equal(gate.attempt, 3)
      assert.equal(gate.stage2.assessment, 'approved')
      assert.equal(evidence.artifact_ref, 'quality_gates.T8')
      assert.equal(evidence.passed, true)

      qualityReview.writeQualityGateResult(statePath, 'T8', gate, 'proj-test')
      const review = qualityReview.readQualityGateResult(statePath, 'T8', 'proj-test')
      assert.equal(review.overall_passed, true)
      assert.equal(review.gate_task_id, 'T8')
    })

    const fallbackReview = workflowTypes.getReviewResult(
      {
        execution_reviews: {
          T4: {
            review_mode: 'machine_loop',
            last_decision: 'pass',
            spec_compliance: { passed: true, attempts: 1 },
            code_quality: { passed: true, assessment: 'approved' },
            overall_passed: true,
            reviewed_at: '2026-03-31T00:00:00',
          },
        },
      },
      'T4'
    )
    assert.equal(fallbackReview.overall_passed, true)
    assert.equal(fallbackReview.gate_task_id, 'T4')

    const failedGate = qualityReview.buildFailedGateResult(
      'T9',
      'stage2',
      'abc123',
      null,
      null,
      null,
      0,
      [],
      [],
      1,
      4,
      {
        assessment: 'needs_fixes',
        issues: {
          critical: [{ description: 'critical' }],
          important: [{ description: 'important' }],
          minor: [],
        },
      }
    )
    assert.equal(failedGate.overall_passed, false)
    assert.equal(failedGate.last_decision, 'rejected')
    assert.equal(failedGate.stage2.critical_count, 1)
  })

  await t.test('self review verification and project id checks stay aligned', () => {
    const requirements = [{ id: 'R-001', summary: '导出', scope_status: 'in_scope' }]
    const planContent = `## T1: 导出任务\n- **阶段**: implement\n- **Spec 参考**: §1\n- **Plan 参考**: P1\n- **需求 ID**: R-001\n- **actions**: edit_file\n- **步骤**:\n  - A1: 修改实现 → 完成导出\n`

    const review = selfReview.runPlanSelfReview(requirements, planContent)
    assert.equal(review.ok, false)
    assert.deepEqual(review.tasks_missing_verification, ['T1'])

    const verificationResult = verification.validateVerificationOrder(null, true, true)
    assert.equal(verificationResult.valid, false)
    assert.ok(verificationResult.violations.includes('updated_before_verification'))

    assert.equal(pathUtils.validateProjectId('proj_test-123'), true)
    assert.equal(pathUtils.validateProjectId(''), false)
    assert.equal(pathUtils.validateProjectId('../etc/passwd'), false)
    assert.equal(pathUtils.validateProjectId('proj/test'), false)
  })

  await t.test('dependency and governance helpers preserve runtime decisions', () => {
    const summary = dependencyChecker.summarizeTaskIndependence(
      {
        id: 'T9',
        depends: ['T1'],
        blocked_by: [],
        files: { create: [], modify: ['src/store/session.py'], test: [] },
        steps: [{ id: 'A1', description: '更新 src/store/session.py', expected: '完成' }],
      },
      true
    )
    assert.equal(summary.level, 'low')
    assert.equal(summary.parallelizable, false)
    assert.equal(summary.signals.hasDepends, true)
    assert.equal(summary.signals.touchesSharedState, true)

    const state = minimumState()
    state.contextMetrics = {
      projectedUsagePercent: 55,
      warningThreshold: 60,
      dangerThreshold: 80,
      hardHandoffThreshold: 90,
    }
    const parallelDecision = executionSequencer.decideGovernanceAction(
      state,
      {
        id: 'T2',
        actions: ['run_tests'],
        files: { create: [], modify: ['src/foo.py'], test: ['tests/test_foo.py'] },
        steps: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }],
      },
      'continuous',
      false,
      true
    )
    assert.equal(parallelDecision.action, 'continue-parallel-boundaries')
    assert.equal(parallelDecision.suggestedExecutionPath, 'parallel-boundaries')

    state.contextMetrics.projectedUsagePercent = 85
    const pauseDecision = executionSequencer.decideGovernanceAction(
      state,
      {
        id: 'T2',
        actions: ['edit_file'],
        files: { create: [], modify: ['src/foo.py'], test: [] },
        steps: [{ id: 'A1' }],
      }
    )
    assert.equal(pauseDecision.action, 'pause-budget')
    assert.equal(pauseDecision.budgetBackstopTriggered, true)
  })

  await t.test('applyGovernanceDecision markTaskSkipped and prepareRetry persist expected state', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-exec-'))
    const home = path.join(tmpRoot, 'home')
    fs.mkdirSync(home, { recursive: true })

    withHome(home, () => {
      const statePath = createCanonicalStateFile(home)
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      const updated = executionSequencer.applyGovernanceDecision(
        state,
        {
          action: 'pause-budget',
          reason: 'context-danger',
          severity: 'warning',
          suggestedExecutionPath: 'direct',
          primarySignals: {
            taskIndependence: { level: 'low' },
            contextPollutionRisk: { level: 'high' },
          },
          budgetBackstopTriggered: true,
          budgetLevel: 'danger',
          decisionNotes: ['预算危险区且建议路径仍会扩张主会话'],
        },
        statePath,
        ['T2']
      )

      assert.equal(updated.status, 'paused')
      const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(persisted.continuation.strategy, 'context-first')
      assert.equal(persisted.continuation.last_decision.action, 'pause-budget')
      assert.deepEqual(persisted.continuation.last_decision.nextTaskIds, ['T2'])
      assert.equal(persisted.continuation.last_decision.budgetBackstopTriggered, true)

      const tasksPath = path.join(tmpRoot, 'plan.md')
      fs.writeFileSync(tasksPath, PLAN_FIXTURE)
      const skipResult = executionSequencer.markTaskSkipped(statePath, tasksPath, PLAN_FIXTURE, 'T1')
      const skippedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      const skippedPlan = fs.readFileSync(tasksPath, 'utf8')
      assert.equal(skipResult.skipped, true)
      assert.equal(skipResult.next_task_id, 'T2')
      assert.deepEqual(skippedState.current_tasks, ['T2'])
      assert.match(skippedPlan, /⏭️/)

      skippedState.status = 'failed'
      skippedState.failure_reason = 'boom'
      fs.writeFileSync(statePath, JSON.stringify(skippedState, null, 2))

      const first = executionSequencer.prepareRetry(statePath, 'T1', 'boom')
      assert.equal(first.retryable, true)

      let failedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      failedState.status = 'failed'
      fs.writeFileSync(statePath, JSON.stringify(failedState, null, 2))
      executionSequencer.prepareRetry(statePath, 'T1', 'boom')

      failedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      failedState.status = 'failed'
      fs.writeFileSync(statePath, JSON.stringify(failedState, null, 2))
      const third = executionSequencer.prepareRetry(statePath, 'T1', 'boom')
      assert.equal(third.retryable, false)
      assert.equal(third.reason, 'hard-stop')
    })
  })

  await t.test('parallel fallback rewinds completed tasks for sequential rerun', () => {
    const state = minimumState('paused', ['T9'])
    state.progress.completed = ['T2', 'T3', 'T4']
    state.parallel_groups = [
      {
        id: 'G1',
        task_ids: ['T3', 'T4'],
        status: 'completed',
        started_at: '2026-03-31T00:00:00',
        conflict_detected: false,
      },
    ]

    const result = executionSequencer.prepareParallelSequentialFallback(state, 'G1', ['T3', 'T4'])
    assert.deepEqual(result.rerun_task_ids, ['T3', 'T4'])
    assert.deepEqual(result.state.progress.completed, ['T2'])
    assert.deepEqual(result.state.current_tasks, ['T3', 'T4'])
    assert.equal(result.state.parallel_groups[0].conflict_detected, true)
    assert.equal(result.state.parallel_groups[0].status, 'failed')
    assert.equal(result.state.continuation.last_decision.reason, 'parallel-conflict-sequential-fallback')
  })

  await t.test('workflow CLI start delta unblock archive and status/context flows work end to end', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-cli-'))
    const [extraEnv, home] = makeCliEnv(root)

    const executeResult = runNode(cliScript, ['execute'], { cwd: root, env: extraEnv })
    assert.equal(executeResult.status, 0, executeResult.stderr)
    const executePayload = JSON.parse(executeResult.stdout)
    assert.equal(executePayload.entry_action, 'execute')
    assert.equal(executePayload.resolved_mode, 'continuous')

    const startResult = runNode(cliScript, ['start', '实现导出功能'], { cwd: root, env: extraEnv })
    assert.equal(startResult.status, 0, startResult.stderr)
    const startPayload = JSON.parse(startResult.stdout)
    assert.equal(startPayload.started, true)
    assert.equal(startPayload.discussion_required, false)

    const specPath = path.join(root, startPayload.spec_file)
    const planPath = path.join(root, startPayload.plan_file)
    assert.equal(fs.existsSync(specPath), true)
    assert.equal(fs.existsSync(planPath), true)

    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'config', 'project-config.json'), 'utf8'))
    const projectId = config.project.id
    const statePath = workflowStatePath(home, projectId)
    const initialState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(initialState.status, 'planned')
    assert.deepEqual(initialState.current_tasks, ['T1'])

    const continuePlannedResult = runNode(cliScript, ['continue'], { cwd: root, env: extraEnv })
    assert.equal(continuePlannedResult.status, 0, continuePlannedResult.stderr)
    const continuePlannedPayload = JSON.parse(continuePlannedResult.stdout)
    assert.equal(continuePlannedPayload.entry_action, 'none')
    assert.equal(continuePlannedPayload.reason, 'status_not_resumable')
    assert.match(continuePlannedPayload.message, /显式使用 \/workflow execute/)

    const deltaResult = runNode(cliScript, ['delta', '新增导出字段'], { cwd: root, env: extraEnv })
    assert.equal(deltaResult.status, 0, deltaResult.stderr)
    const deltaPayload = JSON.parse(deltaResult.stdout)
    assert.equal(deltaPayload.delta_created, true)
    assert.equal(deltaPayload.change_id, 'CHG-001')
    assert.equal(deltaPayload.task_delta_summary.add, 1)
    assert.equal(deltaPayload.task_delta_summary.modify, 1)
    assert.equal(deltaPayload.task_delta_summary.remove, 0)
    assert.equal(fs.existsSync(path.join(deltaPayload.change_dir, 'delta.json')), true)
    assert.equal(fs.existsSync(path.join(deltaPayload.change_dir, 'intent.md')), true)
    assert.equal(fs.existsSync(path.join(deltaPayload.change_dir, 'review-status.json')), true)

    let planContent = fs.readFileSync(planPath, 'utf8')
    assert.match(planContent, /响应增量变更 CHG-001/)
    assert.match(planContent, /## T2: 响应增量变更 CHG-001/)
    assert.doesNotMatch(planContent, /## T1: 第一个任务\n/)

    const blockedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    blockedState.status = 'blocked'
    blockedState.progress.blocked = ['T1']
    fs.writeFileSync(statePath, JSON.stringify(blockedState, null, 2))

    const unblockResult = runNode(cliScript, ['unblock', 'api_spec'], { cwd: root, env: extraEnv })
    assert.equal(unblockResult.status, 0, unblockResult.stderr)
    const unblockPayload = JSON.parse(unblockResult.stdout)
    assert.equal(unblockPayload.unblocked, true)
    assert.ok(unblockPayload.known_unblocked.includes('api_spec'))
    assert.deepEqual(unblockPayload.newly_unblocked_tasks, ['T1'])

    const summaryState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    summaryState.delta_tracking.current_change = 'CHG-002'
    summaryState.discussion.completed = true
    summaryState.ux_design.completed = true
    summaryState.review_status.user_spec_review.status = 'approved'
    summaryState.quality_gates.T1 = { overall_passed: true }
    fs.writeFileSync(statePath, JSON.stringify(summaryState, null, 2))

    const statusResult = runNode(cliScript, ['status'], { cwd: root, env: extraEnv })
    const contextResult = runNode(cliScript, ['context'], { cwd: root, env: extraEnv })
    assert.equal(statusResult.status, 0, statusResult.stderr)
    assert.equal(contextResult.status, 0, contextResult.stderr)
    const statusPayload = JSON.parse(statusResult.stdout)
    const contextPayload = JSON.parse(contextResult.stdout)
    assert.equal(statusPayload.delta_tracking.current_change, 'CHG-002')
    assert.equal(statusPayload.planning_gates.discussion.completed, true)
    assert.deepEqual(statusPayload.quality_gate_summary.passed, ['T1'])
    assert.equal(contextPayload.runtime.delta_tracking.current_change, 'CHG-002')
    assert.equal(contextPayload.runtime.quality_gate_summary.count, 1)

    const archiveState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    archiveState.status = 'completed'
    archiveState.delta_tracking.current_change = 'CHG-001'
    fs.writeFileSync(statePath, JSON.stringify(archiveState, null, 2))

    const archiveResult = runNode(cliScript, ['archive', '--summary'], { cwd: root, env: extraEnv })
    assert.equal(archiveResult.status, 0, archiveResult.stderr)
    const archivePayload = JSON.parse(archiveResult.stdout)
    assert.equal(archivePayload.archived, true)
    assert.equal(archivePayload.workflow_status, 'archived')
    assert.equal(fs.existsSync(path.join(path.dirname(statePath), 'archive', 'CHG-001', 'delta.json')), true)
    assert.equal(fs.existsSync(archivePayload.summary_file), true)
  })

  await t.test('workflow CLI honors spec review branch and helper CLIs keep structured error contracts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-cli-branch-'))
    const [extraEnv, home] = makeCliEnv(root)

    const startResult = runNode(
      cliScript,
      ['start', '实现导出功能', '--spec-choice', '需要修改 Spec'],
      { cwd: root, env: extraEnv }
    )
    assert.equal(startResult.status, 0, startResult.stderr)
    const startPayload = JSON.parse(startResult.stdout)
    const statePath = workflowStatePath(home, startPayload.project_id)
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'spec_review')
    assert.equal(state.review_status.user_spec_review.status, 'revise_required')

    const qualityResult = runNode(path.join(workflowDir, 'quality_review.js'), ['read', 'T3'], { env: extraEnv })
    assert.equal(qualityResult.status, 1)
    assert.equal(JSON.parse(qualityResult.stdout).error, 'missing state reference')

    const executionResult = runNode(path.join(workflowDir, 'execution_sequencer.js'), ['retry', 'proj-test', 'T1'], { env: extraEnv })
    assert.equal(executionResult.status, 1)
    assert.equal(JSON.parse(executionResult.stdout).error, '没有活跃的工作流')

    const stateCliResult = runNode(path.join(workflowDir, 'state_manager.js'), ['--project-id', 'proj-test', 'progress'], { env: extraEnv })
    assert.equal(stateCliResult.status, 1)
    assert.equal(JSON.parse(stateCliResult.stdout).error, '没有活跃的工作流')
  })

  await t.test('legacy canonical state path arguments still work for helper CLIs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-cli-legacy-'))
    const [extraEnv, home] = makeCliEnv(root)
    const statePath = createCanonicalStateFile(home)
    const tasksPath = path.join(root, 'plan.md')
    fs.writeFileSync(tasksPath, PLAN_FIXTURE)

    const passResult = runNode(
      path.join(workflowDir, 'quality_review.js'),
      ['pass', 'T3', '--base-commit', 'abc123', '--state-file', statePath],
      { env: extraEnv }
    )
    assert.equal(passResult.status, 0, passResult.stderr)

    const readResult = runNode(
      path.join(workflowDir, 'quality_review.js'),
      ['read', statePath, 'T3'],
      { env: extraEnv }
    )
    assert.equal(readResult.status, 0, readResult.stderr)
    assert.equal(JSON.parse(readResult.stdout).review.overall_passed, true)

    const failedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    failedState.status = 'failed'
    failedState.failure_reason = 'boom'
    fs.writeFileSync(statePath, JSON.stringify(failedState, null, 2))

    const retryResult = runNode(
      path.join(workflowDir, 'execution_sequencer.js'),
      ['retry', statePath, 'T1', '--reason', 'boom'],
      { env: extraEnv }
    )
    assert.equal(retryResult.status, 0, retryResult.stderr)

    const stateForProgress = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    stateForProgress._total_tasks = 2
    fs.writeFileSync(statePath, JSON.stringify(stateForProgress, null, 2))

    const progressResult = runNode(path.join(workflowDir, 'state_manager.js'), ['progress', statePath], { env: extraEnv })
    assert.equal(progressResult.status, 0, progressResult.stderr)
    assert.ok(Object.prototype.hasOwnProperty.call(JSON.parse(progressResult.stdout), 'percent'))
  })

  await t.test('buildExecuteEntry rejects continue from planned workflow with explicit execute guidance', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-planned-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root)

    withHome(home, () => {
      createCanonicalStateFile(home, 'proj-test', 'planned', ['T1'])
      const result = executionSequencer.buildExecuteEntry('continue', null, null, root)
      assert.equal(result.entry_action, 'none')
      assert.equal(result.can_resume, false)
      assert.equal(result.reason, 'status_not_resumable')
      assert.match(result.message, /显式使用 \/workflow execute/)
    })
  })

  await t.test('buildExecuteEntry resumes paused workflow from project config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-entry-'))
    const home = path.join(root, 'home')
    fs.mkdirSync(home, { recursive: true })
    writeProjectConfig(root, 'proj-test')

    withHome(home, () => {
      const statePath = createCanonicalStateFile(home, 'proj-test', 'paused')
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      state.execution_mode = 'phase'
      state.continuation = {
        last_decision: {
          action: 'pause-governance',
          reason: 'phase-boundary',
        },
      }
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

      const result = executionSequencer.buildExecuteEntry('continue', null, null, root)
      assert.equal(result.entry_action, 'execute')
      assert.equal(result.resolved_mode, 'phase')
      assert.equal(result.can_resume, true)
      assert.equal(result.continuation_action, 'pause-governance')
    })
  })
})
