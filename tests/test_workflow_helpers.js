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
const lifecycleCmds = require(path.join(workflowDir, 'lifecycle_cmds.js'))
const taskParser = require(path.join(workflowDir, 'task_parser.js'))
const docContracts = require(path.join(workflowDir, 'doc_contracts.js'))
const installer = require(path.join(repoRoot, 'lib', 'installer.js'))
const teamLifecycle = require(path.join(repoRoot, 'core', 'utils', 'team', 'lifecycle.js'))
const teamStateManager = require(path.join(repoRoot, 'core', 'utils', 'team', 'state-manager.js'))
const teamCliScript = path.join(repoRoot, 'core', 'utils', 'team', 'team-cli.js')
const sessionStartHook = path.join(repoRoot, 'core', 'hooks', 'session-start.js')
const preExecuteHook = path.join(repoRoot, 'core', 'hooks', 'pre-execute-inject.js')
const qualityGateHook = path.join(repoRoot, 'core', 'hooks', 'quality-gate-loop.js')

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
  const approved = ['planning', 'planned', 'running', 'paused', 'blocked', 'failed', 'completed'].includes(status)
  return {
    project_id: 'proj-test',
    status,
    current_tasks: currentTasks,
    plan_file: '.claude/plans/test.md',
    spec_file: '.claude/specs/test.md',
    review_status: {
      user_spec_review: {
        status: approved ? 'approved' : 'pending',
        review_mode: 'human_gate',
        reviewed_at: approved ? '2026-03-31T00:00:00' : null,
        reviewer: 'user',
        next_action: approved ? 'continue_to_plan_generation' : null,
      },
    },
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
  const parsedHome = path.parse(home)
  const homeDrive = parsedHome.root.replace(/[\\\/]+$/, '') || parsedHome.root
  const homePath = home.slice(homeDrive.length) || path.sep
  return [{ HOME: home, USERPROFILE: home, HOMEDRIVE: homeDrive, HOMEPATH: homePath }, home]
}

function runNode(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
  })
  return result
}

function createWorkflowPlan(home, projectId = 'proj-test', planName = 'tasks.md', content = PLAN_FIXTURE) {
  const planPath = path.join(home, '.claude', 'workflows', projectId, planName)
  fs.mkdirSync(path.dirname(planPath), { recursive: true })
  fs.writeFileSync(planPath, content)
  return planPath
}

function createTeamRuntimeArtifacts(home, root, projectId, teamId, { status = 'planning', teamName = teamId } = {}) {
  const workflowsTeamDir = path.join(home, '.claude', 'workflows', projectId, 'teams', teamId)
  const taskBoardPath = path.join(workflowsTeamDir, 'team-task-board.json')
  const specRelative = path.join('.claude', 'specs', `${teamId}.team.md`)
  const planRelative = path.join('.claude', 'plans', `${teamId}.team.md`)
  const specPath = path.join(root, specRelative)
  const planPath = path.join(root, planRelative)

  fs.mkdirSync(path.dirname(specPath), { recursive: true })
  fs.mkdirSync(path.dirname(planPath), { recursive: true })
  fs.mkdirSync(workflowsTeamDir, { recursive: true })

  fs.writeFileSync(specPath, `# Team Spec\nTEAM-ONLY:${teamId}\n`)
  fs.writeFileSync(planPath, `# Team Plan\nTEAM-ONLY:${teamId}\n`)
  fs.writeFileSync(taskBoardPath, '[]\n')

  const statePath = path.join(workflowsTeamDir, 'team-state.json')
  fs.writeFileSync(statePath, JSON.stringify({
    project_id: projectId,
    team_id: teamId,
    team_name: teamName,
    status,
    team_phase: status === 'archived' ? 'archived' : 'team-plan',
    spec_file: specRelative,
    plan_file: planRelative,
    team_tasks_file: taskBoardPath,
    worker_roster: [{ name: 'leader', writable: false }],
    team_review: { overall_passed: status === 'archived', reviewed_at: null, notes: [] },
    fix_loop: { attempt: 0, current_failed_boundaries: [] },
    governance: {
      explicit_invocation_only: true,
      auto_trigger_allowed: false,
      parallel_dispatch_mode: 'internal-team-only',
    },
    activation: { mode: 'explicit-team-command', entry: 'team', auto_trigger_allowed: false },
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
  }, null, 2))

  return statePath
}

function runHook(script, input, options = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    input: JSON.stringify(input),
  })
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
      '## 2. Scope\n\n### 2.1 In Scope\nA\n\n### 2.2 Out of Scope\nB\n\n## 3. Constraints\nC\n\n## 4. User-facing Behavior\nD\n\n## 7. Acceptance Criteria\nE\n\n### 7.1 Test Strategy\nF\n'
    )
    assert.match(summary, /## 2\. Scope/)
    assert.match(summary, /### 2\.1 In Scope/)
    assert.match(summary, /## 7\. Acceptance Criteria/)
    assert.match(summary, /### 7\.1 Test Strategy/)
  })

  await t.test('requirement coverage preserves quality gate semantics', () => {
    // 无 must_preserve 的普通需求
    const coverage = lifecycleCmds.buildRequirementCoverage([
      {
        id: 'R-001',
        normalized_summary: '管理员只能导出自己有权限的数据',
        scope_status: 'in_scope',
        type: 'constraint',
        owner: 'backend',
        acceptance_signal: '验证管理员权限过滤生效',
      },
    ])

    assert.equal(coverage[0].must_preserve, false)

    // 有 must_preserve 的高风险需求
    const highRiskCoverage = lifecycleCmds.buildRequirementCoverage([
      {
        id: 'R-001',
        normalized_summary: '管理员只能导出自己有权限的数据',
        scope_status: 'in_scope',
        must_preserve: true,
        constraints: ['管理员只能导出自己有权限的数据'],
        type: 'constraint',
        owner: 'backend',
        acceptance_signal: '验证管理员权限过滤生效',
      },
    ])

    assert.equal(highRiskCoverage[0].must_preserve, true)
    assert.deepEqual(highRiskCoverage[0].protected_details, ['管理员只能导出自己有权限的数据'])

    const tasks = taskParser.parseTasksV2(lifecycleCmds.buildPlanTasks(highRiskCoverage))
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].quality_gate, true)
    assert.deepEqual(tasks[0].requirement_ids, ['R-001'])

    const decision = executionSequencer.decideGovernanceAction(minimumState(), tasks[0], 'continuous', false, false)
    assert.equal(decision.action, 'pause-quality-gate')
    assert.equal(decision.reason, 'quality-gate-boundary')
  })

  await t.test('self review doc contract wrapper keeps spec and plan arguments aligned', () => {
    const cliContent = "command === 'start'"
    const overviewDocContent = '/workflow start'
    const specTemplateContent = '## 2. Scope\n{{task_name}}\n{{scope_summary}}\n{{critical_constraints}}\n## 3. Constraints\n{{acceptance_criteria}}\n## 7. Acceptance Criteria'
    const planTemplateContent = '## Requirement Coverage\n{{task_name}}\n{{spec_file}}\n{{tasks}}\n{{requirement_coverage}}\n## Tasks\n阶段\n需求 ID\nSpec 参考\nPlan 参考\nactions\n步骤\n## Self-Review Checklist'

    const wrapped = selfReview.runDocContractReview(
      cliContent,
      overviewDocContent,
      specTemplateContent,
      planTemplateContent,
      [],
      []
    )
    const direct = docContracts.validateWorkflowDocContracts(
      cliContent,
      overviewDocContent,
      specTemplateContent,
      planTemplateContent,
      [],
      []
    )

    assert.deepEqual(wrapped, direct)
    assert.equal(wrapped.spec_template_contract.ok, true)
    assert.equal(wrapped.plan_template_contract.ok, true)
  })

  await t.test('doc placeholder scan ignores quoted instructional TODO markers', () => {
    const placeholders = docContracts.findNonInstructionalPlaceholders('- "TBD"、"TODO"、"implement later"')
    assert.deepEqual(placeholders, [])
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

    const stage1RecheckGate = qualityReview.buildFailedGateResult(
      'T9',
      'stage1_recheck',
      'abc123',
      null,
      null,
      null,
      0,
      [],
      [],
      1,
      2,
      {
        missing: [{ description: 'spec drift after stage2 fix' }],
      }
    )
    assert.equal(stage1RecheckGate.last_decision, 'revise')
    assert.equal(stage1RecheckGate.stage1.passed, false)
    assert.equal(stage1RecheckGate.stage2.passed, true)

    const exhaustedStage1Gate = qualityReview.buildFailedGateResult(
      'T10',
      'stage1',
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
        missing: [{ description: 'still missing requirement' }],
      }
    )
    assert.equal(exhaustedStage1Gate.last_decision, 'rejected')
  })

  await t.test('quality review budget resolves baseline from state and latest passed gate', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-review-budget-'))
    const [extraEnv, home] = makeCliEnv(root)
    writeProjectConfig(root, 'proj-test')
    const statePath = createCanonicalStateFile(home, 'proj-test', 'running', ['T3'])
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    state.project_root = root
    state.initial_head_commit = 'base-000'
    state.quality_gates = {
      T1: {
        overall_passed: true,
        commit_hash: 'pass-111',
        reviewed_at: '2026-03-31T00:00:00.000Z',
      },
      T2: {
        overall_passed: true,
        commit_hash: 'pass-222',
        reviewed_at: '2026-03-31T01:00:00.000Z',
      },
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

    const budgetResult = runNode(path.join(workflowDir, 'quality_review.js'), ['budget'], {
      cwd: root,
      env: extraEnv,
    })
    assert.equal(budgetResult.status, 0, budgetResult.stderr)
    const budget = JSON.parse(budgetResult.stdout)
    assert.equal(budget.base_commit, 'pass-222')
    assert.equal(budget.baseline_source, 'last_passed_gate')
    assert.equal(budget.gate_task_id, 'T2')
    assert.equal(budget.passed_gate_count, 2)
  })

  await t.test('quality review requires an explicit or persisted baseline for first gate on legacy state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-review-baseline-'))
    const [extraEnv, home] = makeCliEnv(root)
    writeProjectConfig(root, 'proj-test')
    const statePath = createCanonicalStateFile(home, 'proj-test', 'running', ['T1'])
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    state.project_root = root
    state.initial_head_commit = null
    state.quality_gates = {}
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

    const budgetResult = runNode(path.join(workflowDir, 'quality_review.js'), ['budget'], {
      cwd: root,
      env: extraEnv,
    })
    assert.equal(budgetResult.status, 0, budgetResult.stderr)
    const budget = JSON.parse(budgetResult.stdout)
    assert.equal(budget.base_commit, null)
    assert.equal(budget.baseline_source, 'unavailable')

    const failResult = runNode(path.join(workflowDir, 'quality_review.js'), ['fail', 'T1', '--failed-stage', 'stage1'], {
      cwd: root,
      env: extraEnv,
    })
    assert.equal(failResult.status, 1)
    const failPayload = JSON.parse(failResult.stdout)
    assert.match(failPayload.error, /缺少质量关卡基线/)
    assert.equal(failPayload.baseline_source, 'unavailable')
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
    assert.equal(executePayload.entry_action, 'none')
    assert.equal(executePayload.reason, 'no_active_workflow')

    const startResult = runNode(cliScript, ['start', '实现导出功能'], { cwd: root, env: extraEnv })
    assert.equal(startResult.status, 0, startResult.stderr)
    const startPayload = JSON.parse(startResult.stdout)
    assert.equal(startPayload.started, true)
    assert.equal(startPayload.discussion_required, false)
    assert.equal(startPayload.awaiting_user_spec_review, true)

    const specPath = path.join(root, startPayload.spec_file)
    assert.equal(fs.existsSync(specPath), true)
    assert.equal(startPayload.plan_file, null)

    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'config', 'project-config.json'), 'utf8'))
    const projectId = config.project.id
    const statePath = workflowStatePath(home, projectId)
    const initialState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(initialState.status, 'spec_review')
    assert.deepEqual(initialState.current_tasks, [])

    const continuePlannedResult = runNode(cliScript, ['continue'], { cwd: root, env: extraEnv })
    assert.equal(continuePlannedResult.status, 0, continuePlannedResult.stderr)
    const continuePlannedPayload = JSON.parse(continuePlannedResult.stdout)
    assert.equal(continuePlannedPayload.entry_action, 'none')
    assert.equal(continuePlannedPayload.reason, 'status_not_resumable')
    assert.match(continuePlannedPayload.message, /spec_review/)

    let editedSpecContent = fs.readFileSync(specPath, 'utf8')
    editedSpecContent = editedSpecContent.replace('R-001: 实现导出功能', 'R-001: 仅实现 CSV 导出')
    editedSpecContent = editedSpecContent.replace('R-001: 确认 实现导出功能 可工作', 'R-001: 确认 仅实现 CSV 导出 可工作')
    fs.writeFileSync(specPath, editedSpecContent)

    const approvedReviewResult = runNode(
      cliScript,
      ['spec-review', '--choice', 'Spec 正确，生成 Plan'],
      { cwd: root, env: extraEnv }
    )
    assert.equal(approvedReviewResult.status, 0, approvedReviewResult.stderr)
    const approvedReviewPayload = JSON.parse(approvedReviewResult.stdout)
    const planPath = path.join(root, approvedReviewPayload.plan_file)
    assert.equal(fs.existsSync(planPath), true)
    const generatedPlan = fs.readFileSync(planPath, 'utf8')
    assert.match(generatedPlan, /仅实现 CSV 导出/)

    const approvedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(approvedState.status, 'planned')
    assert.equal(approvedState.review_status.user_spec_review.status, 'approved')
    assert.deepEqual(approvedState.current_tasks, ['T1'])

    const deltaResult = runNode(cliScript, ['delta', '新增导出字段'], { cwd: root, env: extraEnv })
    assert.equal(deltaResult.status, 0, deltaResult.stderr)
    const deltaPayload = JSON.parse(deltaResult.stdout)
    assert.equal(deltaPayload.delta_created, true)
    assert.equal(deltaPayload.change_id, 'CHG-001')
    assert.equal(deltaPayload.trigger_type, 'requirement')
    assert.equal(fs.existsSync(path.join(deltaPayload.change_dir, 'delta.json')), true)
    assert.equal(fs.existsSync(path.join(deltaPayload.change_dir, 'intent.md')), true)
    assert.equal(fs.existsSync(path.join(deltaPayload.change_dir, 'review-status.json')), true)

    const deltaState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(deltaState.delta_tracking.current_change, 'CHG-001')
    assert.deepEqual(deltaState.delta_tracking.applied_changes, [])

    const reviewStatus = JSON.parse(fs.readFileSync(path.join(deltaPayload.change_dir, 'review-status.json'), 'utf8'))
    assert.equal(reviewStatus.status, 'draft')

    const planContent = fs.readFileSync(planPath, 'utf8')
    assert.doesNotMatch(planContent, /响应增量变更 CHG-001/)
    assert.match(planContent, /## T1:/)

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

  await t.test('delta init only marks applied changes after apply and keeps audit artifacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-delta-init-'))
    const [extraEnv, home] = makeCliEnv(root)
    writeProjectConfig(root, 'proj-test')
    const statePath = createCanonicalStateFile(home, 'proj-test', 'running', ['T1'])

    const initResult = runNode(
      cliScript,
      ['delta', 'init', '--type', 'requirement', '--source', '新增导出字段', '--description', '导出字段变更'],
      { cwd: root, env: extraEnv }
    )
    assert.equal(initResult.status, 0, initResult.stderr)
    const initPayload = JSON.parse(initResult.stdout)
    assert.equal(initPayload.delta_created, true)
    assert.equal(initPayload.change_id, 'CHG-001')

    let state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(state.delta_tracking.current_change, 'CHG-001')
    assert.deepEqual(state.delta_tracking.applied_changes, [])

    const changeDir = path.join(path.dirname(statePath), 'changes', 'CHG-001')
    assert.equal(fs.existsSync(path.join(changeDir, 'delta.json')), true)
    assert.equal(fs.existsSync(path.join(changeDir, 'intent.md')), true)
    assert.equal(fs.existsSync(path.join(changeDir, 'review-status.json')), true)

    const applyResult = runNode(cliScript, ['delta', 'apply', '--change-id', 'CHG-001'], { cwd: root, env: extraEnv })
    assert.equal(applyResult.status, 0, applyResult.stderr)
    const applyPayload = JSON.parse(applyResult.stdout)
    assert.equal(applyPayload.applied, true)

    state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.deepEqual(state.delta_tracking.applied_changes, ['CHG-001'])
  })

  await t.test('legacy delta command keeps confirmation gate and does not edit plan before apply', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-delta-legacy-'))
    const [extraEnv, home] = makeCliEnv(root)
    writeProjectConfig(root, 'proj-test')
    const statePath = createCanonicalStateFile(home, 'proj-test', 'running', ['T1'])
    const planPath = path.join(root, '.claude', 'plans', 'test.md')
    fs.mkdirSync(path.dirname(planPath), { recursive: true })
    fs.writeFileSync(planPath, PLAN_FIXTURE)

    const deltaResult = runNode(cliScript, ['delta', '新增导出字段'], { cwd: root, env: extraEnv })
    assert.equal(deltaResult.status, 0, deltaResult.stderr)
    const deltaPayload = JSON.parse(deltaResult.stdout)
    assert.equal(deltaPayload.delta_created, true)
    assert.equal(deltaPayload.trigger_type, 'requirement')

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(state.delta_tracking.current_change, 'CHG-001')
    assert.deepEqual(state.delta_tracking.applied_changes, [])

    const changeDir = path.join(path.dirname(statePath), 'changes', 'CHG-001')
    const reviewStatus = JSON.parse(fs.readFileSync(path.join(changeDir, 'review-status.json'), 'utf8'))
    assert.equal(reviewStatus.status, 'draft')

    const planContent = fs.readFileSync(planPath, 'utf8')
    assert.equal((planContent.match(/## T3:/g) || []).length, 0)
    assert.doesNotMatch(planContent, /响应增量变更 CHG-001/)
  })

  await t.test('delta apply is idempotent and does not duplicate task blocks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-delta-apply-'))
    const [extraEnv, home] = makeCliEnv(root)
    writeProjectConfig(root, 'proj-test')
    const statePath = createCanonicalStateFile(home, 'proj-test', 'running', ['T1'])
    const planPath = path.join(root, '.claude', 'plans', 'test.md')
    fs.mkdirSync(path.dirname(planPath), { recursive: true })
    fs.writeFileSync(planPath, PLAN_FIXTURE)

    const initResult = runNode(
      cliScript,
      ['delta', 'init', '--type', 'requirement', '--source', '新增导出字段', '--description', '导出字段变更'],
      { cwd: root, env: extraEnv }
    )
    assert.equal(initResult.status, 0, initResult.stderr)

    const changeDir = path.join(path.dirname(statePath), 'changes', 'CHG-001')
    const deltaPath = path.join(changeDir, 'delta.json')
    const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'))
    delta.task_deltas = [
      {
        action: 'add',
        task_markdown: `## T3: 增量任务\n- **阶段**: implement\n- **Spec 参考**: §1\n- **Plan 参考**: P3\n- **状态**: pending\n- **actions**: edit_file\n- **步骤**:\n  - A3: 处理增量变更 → 完成增量任务\n`,
      },
    ]
    fs.writeFileSync(deltaPath, `${JSON.stringify(delta, null, 2)}\n`)

    const firstApplyResult = runNode(cliScript, ['delta', 'apply', '--change-id', 'CHG-001'], { cwd: root, env: extraEnv })
    assert.equal(firstApplyResult.status, 0, firstApplyResult.stderr)
    const secondApplyResult = runNode(cliScript, ['delta', 'apply', '--change-id', 'CHG-001'], { cwd: root, env: extraEnv })
    assert.equal(secondApplyResult.status, 0, secondApplyResult.stderr)

    const secondApplyPayload = JSON.parse(secondApplyResult.stdout)
    assert.equal(secondApplyPayload.already_applied, true)

    const planContent = fs.readFileSync(planPath, 'utf8')
    assert.equal((planContent.match(/## T3: 增量任务/g) || []).length, 1)
  })

  await t.test('detectDeltaTrigger recognizes Windows autogen paths as api changes', () => {
    const trigger = lifecycleCmds.detectDeltaTrigger('packages\\api\\lib\\autogen\\teamApi.ts', repoRoot)
    assert.equal(trigger.type, 'api')
    assert.equal(trigger.source, 'packages\\api\\lib\\autogen\\teamApi.ts')
  })

  await t.test('session-start ignores active team runtime artifacts for ordinary workflow context', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-team-isolation-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')
    fs.mkdirSync(path.join(root, '.claude', 'specs'), { recursive: true })
    fs.writeFileSync(path.join(root, '.claude', 'specs', 'index.md'), '# Workflow Spec Index\nWORKFLOW-ONLY\n')

    withHome(home, () => {
      createCanonicalStateFile(home, 'proj-test', 'running', ['T1'])
      createTeamRuntimeArtifacts(home, root, 'proj-test', 'superpowers-analysis', { status: 'planning' })

      const sessionResult = runHook(sessionStartHook, {}, { cwd: root, env: { HOME: home } })
      assert.equal(sessionResult.status, 0)
      assert.match(sessionResult.stdout, /<workflow-context>/)
      assert.match(sessionResult.stdout, /WORKFLOW-ONLY/)
      assert.doesNotMatch(sessionResult.stdout, /TEAM-ONLY:superpowers-analysis/)
      assert.doesNotMatch(sessionResult.stdout, /superpowers-analysis/)
      assert.doesNotMatch(sessionResult.stdout, /team-plan/)
    })
  })

  await t.test('archived team runtime artifacts do not bleed into ordinary workflow session start', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-team-archived-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')
    fs.mkdirSync(path.join(root, '.claude', 'specs'), { recursive: true })
    fs.writeFileSync(path.join(root, '.claude', 'specs', 'index.md'), '# Workflow Spec Index\nWORKFLOW-ONLY\n')

    withHome(home, () => {
      createCanonicalStateFile(home, 'proj-test', 'planned', ['T1'])
      createTeamRuntimeArtifacts(home, root, 'proj-test', 'none', { status: 'archived', teamName: 'none' })

      const sessionResult = runHook(sessionStartHook, {}, { cwd: root, env: { HOME: home } })
      assert.equal(sessionResult.status, 0)
      assert.match(sessionResult.stdout, /显式 `\/workflow execute`|显式 \/workflow execute/)
      assert.match(sessionResult.stdout, /team-guardrail/)
      assert.doesNotMatch(sessionResult.stdout, /TEAM-ONLY:none/)
      assert.doesNotMatch(sessionResult.stdout, /项目: none/)
      assert.doesNotMatch(sessionResult.stdout, /superpowers-analysis/)
    })
  })

  await t.test('team CLI auto-resolves active runtime only for explicit team commands', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-team-cli-'))
    const [extraEnv, home] = makeCliEnv(tmpRoot)
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')

    createTeamRuntimeArtifacts(home, root, 'proj-test', 'superpowers-analysis', { status: 'planning' })

    const statusResult = runNode(path.join(repoRoot, 'core', 'utils', 'team', 'team-cli.js'), ['status', '--project-id', 'proj-test', '--project-root', root], { cwd: root, env: extraEnv })
    assert.equal(statusResult.status, 0, statusResult.stderr)
    const statusPayload = JSON.parse(statusResult.stdout)
    assert.equal(statusPayload.team_id, 'superpowers-analysis')
    assert.equal(statusPayload.team_name, 'superpowers-analysis')
    assert.equal(statusPayload.governance.explicit_invocation_only, true)
  })

  await t.test('session-start and task/quality hooks enforce workflow guardrails', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-hooks-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')
    fs.mkdirSync(path.join(root, '.claude', 'specs'), { recursive: true })
    fs.writeFileSync(path.join(root, '.claude', 'specs', 'index.md'), '# Spec Index\n')

    withHome(home, () => {
      const statePath = createCanonicalStateFile(home, 'proj-test', 'planned', ['T1'])
      const plannedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      plannedState.tasks_file = 'tasks.md'
      plannedState.requirement_baseline = { summary_path: '.claude/analysis/baseline.md' }
      fs.mkdirSync(path.join(root, '.claude', 'analysis'), { recursive: true })
      fs.writeFileSync(path.join(root, '.claude', 'analysis', 'baseline.md'), '## 关键约束\nA\n\n## 必须保留\nB\n')
      fs.writeFileSync(statePath, JSON.stringify(plannedState, null, 2))
      createWorkflowPlan(home, 'proj-test', 'tasks.md', '## T1: 执行任务\n- **actions**: edit_file, quality_review\n- **验证命令**: node -e "process.exit(0)"\n')

      const sessionResult = runHook(sessionStartHook, {}, { cwd: root, env: { HOME: home } })
      assert.equal(sessionResult.status, 0)
      assert.match(sessionResult.stdout, /workflow-guardrail/)
      assert.match(sessionResult.stdout, /team-guardrail/)
      assert.match(sessionResult.stdout, /不能直接进入实现|显式 `\/workflow execute`|显式 \/workflow execute/)

      const blockedTask = runHook(preExecuteHook, {
        tool_name: 'Task',
        tool_input: { description: '执行 T1' },
      }, { cwd: root, env: { HOME: home } })
      assert.equal(blockedTask.status, 0)
      const blockedPayload = JSON.parse(blockedTask.stdout)
      assert.equal(blockedPayload.continue, false)
      assert.match(blockedPayload.reason, /当前 workflow 状态为 planned/)

      const runningState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      runningState.status = 'running'
      runningState.review_status.user_spec_review = {
        status: 'pending',
        review_mode: 'human_gate',
        reviewed_at: null,
        reviewer: 'user',
        next_action: null,
      }
      fs.writeFileSync(statePath, JSON.stringify(runningState, null, 2))

      const reviewBlockedTask = runHook(preExecuteHook, {
        tool_name: 'Task',
        tool_input: { description: '执行 T1' },
      }, { cwd: root, env: { HOME: home } })
      const reviewBlockedPayload = JSON.parse(reviewBlockedTask.stdout)
      assert.equal(reviewBlockedPayload.continue, false)
      assert.match(reviewBlockedPayload.reason, /User Spec Review 尚未 approved/)

      runningState.quality_gates = {
        T1: {
          overall_passed: false,
          last_decision: 'revise',
          stage1: { passed: false, attempts: 1 },
          stage2: { passed: false, attempts: 0 },
        },
      }
      runningState.review_status = {
        user_spec_review: {
          status: 'approved',
          review_mode: 'human_gate',
          reviewed_at: '2026-04-10T00:00:00.000Z',
          reviewer: 'user',
          next_action: 'continue_to_plan_generation',
        },
      }
      fs.writeFileSync(statePath, JSON.stringify(runningState, null, 2))

      const injectedTask = runHook(preExecuteHook, {
        tool_name: 'Task',
        tool_input: { description: '执行 T1' },
      }, { cwd: root, env: { HOME: home } })
      const injectedPayload = JSON.parse(injectedTask.stdout)
      assert.equal(injectedPayload.continue, true)
      assert.match(injectedPayload.message, /已注入任务上下文/)
      assert.match(injectedPayload.tool_input.description, /verification-commands/)
      assert.match(injectedPayload.tool_input.description, /quality-gate-state/)
      assert.match(injectedPayload.tool_input.description, /team-guardrail/)

      const teamContextBlocked = runHook(preExecuteHook, {
        tool_name: 'Task',
        tool_input: { description: '执行 T1', team_id: 'alpha-team', team_name: 'Alpha Team' },
      }, { cwd: root, env: { HOME: home } })
      const teamContextBlockedPayload = JSON.parse(teamContextBlocked.stdout)
      assert.equal(teamContextBlockedPayload.continue, false)
      assert.match(teamContextBlockedPayload.reason, /禁止透传 team 上下文字段/)

      const gateFail = runHook(qualityGateHook, {}, { cwd: root, env: { HOME: home } })
      const gateFailPayload = JSON.parse(gateFail.stdout)
      assert.equal(gateFailPayload.continue, false)
      assert.match(gateFailPayload.reason, /quality_gates\.T1/)

      const runningStatePassed = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      runningStatePassed.quality_gates = {
        T1: {
          overall_passed: true,
          last_decision: 'pass',
          stage1: { passed: true, attempts: 1 },
          stage2: { passed: true, attempts: 1 },
        },
      }
      fs.writeFileSync(statePath, JSON.stringify(runningStatePassed, null, 2))

      const gatePass = runHook(qualityGateHook, {}, { cwd: root, env: { HOME: home } })
      const gatePassPayload = JSON.parse(gatePass.stdout)
      assert.equal(gatePassPayload.continue, true)
      assert.match(gatePassPayload.reason, /所有验证与质量关卡均通过/)
    })
  })

  await t.test('team runtime requires explicit invocation and rejects reserved team identifiers', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'team-runtime-guard-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')
    createTeamRuntimeArtifacts(home, root, 'proj-test', 'team-alpha')

    withHome(home, () => {
      const executeWithoutSource = teamLifecycle.cmdTeamExecute({ projectRoot: root })
      assert.equal(executeWithoutSource.error, 'team runtime 仅允许通过显式 /team 或 team-workflow 入口访问')

      const statusWithoutSource = teamLifecycle.cmdTeamStatus({ projectRoot: root })
      assert.equal(statusWithoutSource.error, 'team runtime 仅允许通过显式 /team 或 team-workflow 入口访问')

      const archiveWithoutSource = teamLifecycle.cmdTeamArchive({ projectRoot: root })
      assert.equal(archiveWithoutSource.error, 'team runtime 仅允许通过显式 /team 或 team-workflow 入口访问')

      const executeReserved = teamLifecycle.cmdTeamExecute({ projectRoot: root, teamId: 'none', invocationSource: 'team-command' })
      assert.equal(executeReserved.error, 'team_id 包含保留哨兵值，疑似上层传入了脏 team 上下文')

      const cliStatus = runNode(teamCliScript, ['status', '--project-id', 'proj-test', '--project-root', root], { cwd: root, env: { HOME: home } })
      assert.equal(cliStatus.status, 0, cliStatus.stderr)
      const cliStatusPayload = JSON.parse(cliStatus.stdout)
      assert.equal(cliStatusPayload.team_id, 'team-alpha')
      assert.equal(cliStatusPayload.governance.explicit_invocation_only, true)
    })
  })

  await t.test('workflow hooks ignore team runtime and reject inherited team fields', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-team-isolation-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')
    fs.mkdirSync(path.join(root, '.claude', 'specs'), { recursive: true })
    fs.writeFileSync(path.join(root, '.claude', 'specs', 'index.md'), '# Spec Index\n')
    createTeamRuntimeArtifacts(home, root, 'proj-test', 'team-superpowers', { teamName: 'superpowers-analysis' })

    withHome(home, () => {
      const sessionResult = runHook(sessionStartHook, {}, { cwd: root, env: { HOME: home } })
      assert.equal(sessionResult.status, 0)
      assert.match(sessionResult.stdout, /team-guardrail/)
      assert.doesNotMatch(sessionResult.stdout, /superpowers-analysis/)
      assert.doesNotMatch(sessionResult.stdout, /team-superpowers/)

      const noWorkflowTask = runHook(preExecuteHook, {
        tool_name: 'Task',
        tool_input: { description: '执行普通任务', team_name: 'superpowers-analysis' },
      }, { cwd: root, env: { HOME: home } })
      assert.equal(noWorkflowTask.status, 0)
      const noWorkflowPayload = JSON.parse(noWorkflowTask.stdout)
      assert.equal(noWorkflowPayload.continue, false)
      assert.match(noWorkflowPayload.reason, /禁止直接派发执行型 Task|禁止透传 team 上下文字段/)

      const statePath = createCanonicalStateFile(home, 'proj-test', 'running', ['T1'])
      const runningState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      runningState.tasks_file = 'tasks.md'
      runningState.quality_gates = { T1: { overall_passed: true, last_decision: 'pass' } }
      fs.writeFileSync(statePath, JSON.stringify(runningState, null, 2))
      createWorkflowPlan(home, 'proj-test', 'tasks.md', '## T1: 执行任务\n- **actions**: edit_file\n- **验证命令**: node -e "process.exit(0)"\n')

      const inheritedTeamTask = runHook(preExecuteHook, {
        tool_name: 'Task',
        tool_input: { description: '执行 T1', team_name: 'superpowers-analysis' },
      }, { cwd: root, env: { HOME: home } })
      const inheritedTeamPayload = JSON.parse(inheritedTeamTask.stdout)
      assert.equal(inheritedTeamPayload.continue, false)
      assert.match(inheritedTeamPayload.reason, /禁止透传 team 上下文字段/)
    })
  })

  await t.test('team cleanup requires archived runtime and preserves repo artifacts', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'team-runtime-cleanup-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')
    const archivedStatePath = createTeamRuntimeArtifacts(home, root, 'proj-test', 'team-cleanup', { status: 'archived' })
    const runtimeDir = path.dirname(archivedStatePath)
    const repoSpec = path.join(root, '.claude', 'specs', 'team-cleanup.team.md')
    const repoPlan = path.join(root, '.claude', 'plans', 'team-cleanup.team.md')

    withHome(home, () => {
      const cleanupWithoutSource = teamLifecycle.cmdTeamCleanup({ projectRoot: root, projectId: 'proj-test', teamId: 'team-cleanup' })
      assert.equal(cleanupWithoutSource.error, 'team runtime 仅允许通过显式 /team 或 team-workflow 入口访问')

      const cleanupMissingId = teamLifecycle.cmdTeamCleanup({ projectRoot: root, projectId: 'proj-test', invocationSource: 'team-command' })
      assert.equal(cleanupMissingId.error, '缺少 teamId；/team cleanup 只允许显式指定已归档的目标 runtime')

      const cleanupReserved = teamLifecycle.cmdTeamCleanup({ projectRoot: root, projectId: 'proj-test', teamId: 'none', invocationSource: 'team-command' })
      assert.equal(cleanupReserved.error, 'team_id 包含保留哨兵值，疑似上层传入了脏 team 上下文')

      const cleanupResult = teamLifecycle.cmdTeamCleanup({ projectRoot: root, projectId: 'proj-test', teamId: 'team-cleanup', invocationSource: 'team-command' })
      assert.equal(cleanupResult.cleaned, true)
      assert.equal(fs.existsSync(runtimeDir), false)
      assert.equal(fs.existsSync(repoSpec), true)
      assert.equal(fs.existsSync(repoPlan), true)
    })
  })

  await t.test('team cleanup rejects non-archived runtime and CLI cleanup works for archived target', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'team-runtime-cleanup-cli-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root, 'proj-test')
    createTeamRuntimeArtifacts(home, root, 'proj-test', 'team-running', { status: 'planning' })
    createTeamRuntimeArtifacts(home, root, 'proj-test', 'team-archived', { status: 'archived' })

    withHome(home, () => {
      const cleanupRunning = teamLifecycle.cmdTeamCleanup({ projectRoot: root, projectId: 'proj-test', teamId: 'team-running', invocationSource: 'team-command' })
      assert.equal(cleanupRunning.error, 'cannot cleanup non-archived team runtime')
      assert.equal(cleanupRunning.next_action, 'archive-team-runtime-first')

      const cliCleanup = runNode(teamCliScript, ['cleanup', '--project-id', 'proj-test', '--project-root', root, '--team-id', 'team-archived'], { cwd: root, env: { HOME: home } })
      assert.equal(cliCleanup.status, 0, cliCleanup.stderr)
      const cliCleanupPayload = JSON.parse(cliCleanup.stdout)
      assert.equal(cliCleanupPayload.cleaned, true)
      assert.equal(cliCleanupPayload.team_id, 'team-archived')
      assert.equal(fs.existsSync(path.join(home, '.claude', 'workflows', 'proj-test', 'teams', 'team-archived')), false)
    })
  })

  await t.test('installer keeps workflow hooks opt-in and can inject them explicitly', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-installer-'))
    const settingsPath = path.join(tmpRoot, 'settings.json')
    const hooksDir = path.join(repoRoot, 'core', 'hooks')

    const injected = await installer.ensureWorkflowHooks(settingsPath, hooksDir)
    assert.equal(injected.injected, true)
    assert.deepEqual(injected.events.sort(), ['PostToolUse', 'PreToolUse', 'SessionStart'])

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.ok(Array.isArray(settings.hooks.SessionStart))
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'Task')
    assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /quality-gate-loop\.js/)
  })

  await t.test('sync and link CLI expose workflow hook option in help output', () => {
    const syncHelp = runNode(path.join(repoRoot, 'bin', 'agent-workflow.js'), ['sync', '--help'], { cwd: repoRoot })
    const linkHelp = runNode(path.join(repoRoot, 'bin', 'agent-workflow.js'), ['link', '--help'], { cwd: repoRoot })
    assert.equal(syncHelp.status, 0)
    assert.equal(linkHelp.status, 0)
    assert.match(syncHelp.stdout, /--workflow-hooks/)
    assert.match(linkHelp.stdout, /--workflow-hooks/)
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
    assert.equal(startPayload.plan_file, null)
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

  await t.test('split-scope spec review returns workflow to idle so a new start can proceed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-cli-split-scope-'))
    const [extraEnv, home] = makeCliEnv(root)

    const startResult = runNode(cliScript, ['start', '实现导出功能'], { cwd: root, env: extraEnv })
    assert.equal(startResult.status, 0, startResult.stderr)

    const splitResult = runNode(
      cliScript,
      ['spec-review', '--choice', '需要拆分范围'],
      { cwd: root, env: extraEnv }
    )
    assert.equal(splitResult.status, 0, splitResult.stderr)
    const splitPayload = JSON.parse(splitResult.stdout)
    assert.equal(splitPayload.workflow_status, 'idle')
    assert.equal(splitPayload.spec_review_status, 'rejected')

    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'config', 'project-config.json'), 'utf8'))
    const statePath = workflowStatePath(home, config.project.id)
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'idle')

    const restartResult = runNode(cliScript, ['start', '实现新的缩小范围需求'], { cwd: root, env: extraEnv })
    assert.equal(restartResult.status, 0, restartResult.stderr)
    const restartPayload = JSON.parse(restartResult.stdout)
    assert.equal(restartPayload.started, true)
  })

  await t.test('workflow init self-heal preserves blocked task status', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-cli-init-'))
    const [extraEnv, home] = makeCliEnv(root)
    writeProjectConfig(root, 'proj-test')

    const planPath = path.join(root, '.claude', 'plans', 'recovery.md')
    fs.mkdirSync(path.dirname(planPath), { recursive: true })
    fs.writeFileSync(planPath, [
      '## T1: 等待依赖',
      '- **状态**: blocked',
      '- **actions**: edit_file',
      '',
      '## T2: 后续任务',
      '- **状态**: pending',
      '- **actions**: edit_file',
      '',
    ].join('\n'))

    const initResult = runNode(cliScript, ['init'], { cwd: root, env: extraEnv })
    assert.equal(initResult.status, 0, initResult.stderr)
    const initPayload = JSON.parse(initResult.stdout)
    assert.equal(initPayload.initialized, true)
    assert.equal(initPayload.workflow_status, 'blocked')
    assert.deepEqual(initPayload.progress.blocked, ['T1'])

    const state = JSON.parse(fs.readFileSync(workflowStatePath(home, 'proj-test'), 'utf8'))
    assert.equal(state.status, 'blocked')
    assert.deepEqual(state.current_tasks, ['T1'])
    assert.deepEqual(state.progress.blocked, ['T1'])
  })

  await t.test('workflow init self-heal does not bind an unrelated spec to quick-plan recovery', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-cli-init-unrelated-spec-'))
    const [extraEnv, home] = makeCliEnv(root)
    writeProjectConfig(root, 'proj-test')

    const planPath = path.join(root, '.claude', 'plans', 'recovery.md')
    const unrelatedSpecPath = path.join(root, '.claude', 'specs', 'other.md')
    fs.mkdirSync(path.dirname(planPath), { recursive: true })
    fs.mkdirSync(path.dirname(unrelatedSpecPath), { recursive: true })
    fs.writeFileSync(planPath, PLAN_FIXTURE)
    fs.writeFileSync(unrelatedSpecPath, '# Unrelated Spec\n')

    const initResult = runNode(cliScript, ['init'], { cwd: root, env: extraEnv })
    assert.equal(initResult.status, 0, initResult.stderr)
    const initPayload = JSON.parse(initResult.stdout)
    assert.equal(initPayload.initialized, true)
    assert.equal(initPayload.spec_file, null)
    assert.equal(initPayload.upgrade_required, true)
    assert.equal(initPayload.spec_review_status, 'skipped')

    const state = JSON.parse(fs.readFileSync(workflowStatePath(home, 'proj-test'), 'utf8'))
    assert.equal(state.spec_file, null)
    assert.equal(state.review_status.user_spec_review.status, 'skipped')
    assert.equal(state.review_status.user_spec_review.requires_degradation_ack, true)
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

  await t.test('buildExecuteEntry blocks execute when user spec review is missing', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-spec-gate-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root)

    withHome(home, () => {
      const statePath = createCanonicalStateFile(home, 'proj-test', 'planned', ['T1'])
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      state.review_status = {
        user_spec_review: {
          status: 'pending',
          review_mode: 'human_gate',
          reviewed_at: null,
          reviewer: 'user',
          next_action: null,
        },
      }
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

      const result = executionSequencer.buildExecuteEntry('execute', null, null, root)
      assert.equal(result.entry_action, 'none')
      assert.equal(result.can_resume, false)
      assert.equal(result.reason, 'user_spec_review_required')
      assert.match(result.message, /Phase 1\.1/)
    })
  })

  await t.test('buildExecuteEntry blocks degraded quick-plan execution until user confirms downgrade', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-skipped-spec-gate-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root)

    withHome(home, () => {
      const statePath = createCanonicalStateFile(home, 'proj-test', 'planned', ['T1'])
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      state.spec_file = null
      state.review_status = {
        user_spec_review: {
          status: 'skipped',
          review_mode: 'human_gate',
          reviewed_at: '2026-04-11T00:00:00.000Z',
          reviewer: 'system-recovery',
          next_action: 'execute',
          requires_degradation_ack: true,
          acknowledged_degradation_at: null,
          acknowledged_degradation_by: null,
          acknowledged_degradation_source: null,
        },
      }
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

      const result = executionSequencer.buildExecuteEntry('execute', null, null, root)
      assert.equal(result.entry_action, 'none')
      assert.equal(result.can_resume, false)
      assert.equal(result.reason, 'spec_upgrade_required')
      assert.match(result.message, /execute --force/)
    })
  })

  await t.test('buildExecuteEntry --force persists degraded execution acknowledgement', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-skipped-spec-force-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root)

    withHome(home, () => {
      const statePath = createCanonicalStateFile(home, 'proj-test', 'planned', ['T1'])
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      state.spec_file = null
      state.review_status = {
        user_spec_review: {
          status: 'skipped',
          review_mode: 'human_gate',
          reviewed_at: '2026-04-11T00:00:00.000Z',
          reviewer: 'system-recovery',
          next_action: 'execute',
          requires_degradation_ack: true,
          acknowledged_degradation_at: null,
          acknowledged_degradation_by: null,
          acknowledged_degradation_source: null,
        },
      }
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

      const result = executionSequencer.buildExecuteEntry('execute', null, null, root, { force: true })
      assert.equal(result.entry_action, 'execute')
      assert.equal(result.can_resume, true)
      assert.equal(result.degraded_execution_acknowledged, true)

      const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(persisted.review_status.user_spec_review.status, 'skipped')
      assert.equal(Boolean(persisted.review_status.user_spec_review.acknowledged_degradation_at), true)
      assert.equal(persisted.review_status.user_spec_review.requires_degradation_ack, false)
      assert.equal(persisted.git_status.user_acknowledged_degradation, true)
    })
  })

  await t.test('buildExecuteEntry rejects execute while workflow is still in spec_review', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-spec-review-'))
    const home = path.join(tmpRoot, 'home')
    const root = path.join(tmpRoot, 'project')
    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(root, { recursive: true })
    writeProjectConfig(root)

    withHome(home, () => {
      createCanonicalStateFile(home, 'proj-test', 'spec_review', [])
      const result = executionSequencer.buildExecuteEntry('execute', null, null, root)
      assert.equal(result.entry_action, 'none')
      assert.equal(result.can_resume, false)
      assert.equal(result.reason, 'status_not_executable')
      assert.match(result.message, /User Spec Review/)
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
