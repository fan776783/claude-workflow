const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const {
  lintPlaceholder,
  checkRequirementCoverage,
  derivePlanSummary,
  scoreConfidence,
  cmdPlanReview,
  cmdPlanEdit,
  lintAnchorIntegrity,
  detectPlanVersion,
  buildNarrativeTasksBody,
  renderTemplate,
  lintMandatoryReading,
  lintCommandSyntax,
  lintPatternFidelity,
} = require(path.join(workflowDir, 'plan_composer.js'))
const { ensureStateDefaults } = require(path.join(workflowDir, 'workflow_types.js'))
const { getWorkflowStatePath } = require(path.join(workflowDir, 'path_utils.js'))

// ---------- lintPlaceholder ----------

test('lintPlaceholder happy path returns empty hits for clean plan', () => {
  const result = lintPlaceholder('## T1: foo\n- **需求 ID**: R-001\n- **验证命令**: npm test\n')
  assert.deepEqual(result, { hits: [] })
})

test('lintPlaceholder catches English + Chinese + Similar to Task N + template residue', () => {
  const sample = [
    '# Plan',
    '## T1: TODO finish later',
    '- 待补充 内容',
    '- 引用 Similar to Task 3 的实现',
    '- 模板字段 {{unrendered}} 未替换',
  ].join('\n')
  const result = lintPlaceholder(sample)
  const tokens = result.hits.map((h) => h.token).sort()
  assert.ok(tokens.includes('TODO'), 'should catch TODO')
  assert.ok(tokens.includes('待补充'), 'should catch 待补充')
  assert.ok(tokens.includes('unrendered_template'), 'should catch {{unrendered}}')
  assert.ok(tokens.some((t) => /Similar to Task/i.test(t)), 'should catch Similar to Task N')
})

test('lintPlaceholder handles empty / non-string input safely', () => {
  assert.deepEqual(lintPlaceholder(''), { hits: [] })
  assert.deepEqual(lintPlaceholder(null), { hits: [] })
  assert.deepEqual(lintPlaceholder(undefined), { hits: [] })
})

// F-01 regression: instructional lines must not be flagged as placeholder hits.
test('lintPlaceholder skips instructional lines containing TBD/TODO keywords (F-01 regression)', () => {
  const instructional = [
    '- [ ] **Placeholder scan** — 搜索 TBD/TODO/模糊描述，全部替换为实际内容',
    '禁止 TBD/TODO 出现在 plan',
    '> No placeholders allowed: TBD, TODO',
  ].join('\n')
  const result = lintPlaceholder(instructional)
  // All three lines are instructional; none should produce hits despite containing TBD/TODO.
  assert.deepEqual(result.hits, [], `expected zero hits on instructional text, got ${JSON.stringify(result.hits)}`)
})

// F-15 regression: case-insensitive matching for English placeholder tokens.
test('lintPlaceholder catches lowercase tbd / todo (F-15 regression)', () => {
  const lower = lintPlaceholder('- todo: finish this\n- tbd: pick algorithm\n')
  const tokens = lower.hits.map((h) => h.token)
  assert.ok(tokens.includes('TODO'), `lowercase todo should be caught, got ${JSON.stringify(lower.hits)}`)
  assert.ok(tokens.includes('TBD'), `lowercase tbd should be caught, got ${JSON.stringify(lower.hits)}`)
})

test('lintPlaceholder still catches real TBD/TODO in non-instructional context', () => {
  const real = '## T1: implement\n- TODO finish this\n- TBD: pick algorithm\n'
  const result = lintPlaceholder(real)
  const tokens = result.hits.map((h) => h.token).sort()
  assert.ok(tokens.includes('TODO'), 'should catch real TODO')
  assert.ok(tokens.includes('TBD'), 'should catch real TBD')
})

// F-06 regression: hint must not be a broad single word that swallows real placeholder lines.
test('lintPlaceholder catches real TODO even when line contains "placeholder" word (F-06 regression)', () => {
  const result = lintPlaceholder('- TODO placeholder implementation')
  const tokens = result.hits.map((h) => h.token)
  assert.ok(tokens.includes('TODO'), `real TODO should be caught even when line mentions "placeholder", got ${JSON.stringify(result.hits)}`)
})

test('lintPlaceholder catches real 待补充 even when line contains "占位符" word (F-06 regression)', () => {
  const result = lintPlaceholder('- 占位符 待补充')
  const tokens = result.hits.map((h) => h.token)
  assert.ok(tokens.includes('待补充'), `real 待补充 should be caught even when line mentions 占位符, got ${JSON.stringify(result.hits)}`)
})

test('lintPlaceholder on real plan-template.md produces no TBD/TODO hits (F-01 regression)', () => {
  const tmplPath = path.join(repoRoot, 'core', 'specs', 'workflow-templates', 'plan-template.md')
  const tmpl = fs.readFileSync(tmplPath, 'utf8')
  const result = lintPlaceholder(tmpl)
  const blockingHits = result.hits.filter((h) => h.token === 'TBD' || h.token === 'TODO')
  assert.deepEqual(blockingHits, [], `template's Self-Review Checklist must not trigger placeholder hits, got ${JSON.stringify(blockingHits)}`)
})

// ---------- checkRequirementCoverage (v2: task-dir records as the plan side) ----------

test('checkRequirementCoverage covered/uncovered split', () => {
  const spec = '- R-001 first\n- R-002 second\n- R-003 third (not in plan)\n'
  const tasks = [
    { id: 'T1', requirement_ids: ['R-001'] },
    { id: 'T2', requirement_ids: ['R-002'] },
  ]
  const result = checkRequirementCoverage(tasks, spec)
  assert.deepEqual(result.uncovered_ids, ['R-003'])
  assert.deepEqual(result.covered_ids.sort(), ['R-001', 'R-002'])
  assert.deepEqual(result.partial_ids, [])
})

test('checkRequirementCoverage detects partial coverage (spec >=2 mentions, single task)', () => {
  const spec = '## §2: R-001 first\n## §5: R-001 again referenced\n'
  const tasks = [{ id: 'T1', requirement_ids: ['R-001'] }]
  const result = checkRequirementCoverage(tasks, spec)
  assert.deepEqual(result.partial_ids, ['R-001'])
  assert.deepEqual(result.covered_ids, ['R-001'])
  assert.deepEqual(result.uncovered_ids, [])
})

test('checkRequirementCoverage returns spec_missing note when spec empty', () => {
  const result = checkRequirementCoverage([{ id: 'T1', requirement_ids: ['R-001'] }], '')
  assert.equal(result.note, 'spec_missing')
  assert.deepEqual(result.uncovered_ids, [])
})

// F-07 regression: only §2.1 In Scope R-IDs count; Out of Scope / Blocked / Constraints don't.
test('checkRequirementCoverage ignores R-IDs outside §2.1 In Scope section (F-07 regression)', () => {
  const spec = [
    '## 2. Scope',
    '',
    '### 2.1 In Scope',
    '- R-001: must do this',
    '',
    '### 2.2 Out of Scope',
    '- R-099: explicitly deferred',
    '',
    '### 2.3 Blocked',
    '- R-077: waiting on upstream',
    '',
    '## 3. Constraints',
    '- R-001 should respect transactions (referenced for context, not new req)',
  ].join('\n')
  const tasks = [{ id: 'T1', requirement_ids: ['R-001'] }]
  const result = checkRequirementCoverage(tasks, spec)
  assert.deepEqual(result.uncovered_ids, [], 'out-of-scope / blocked / constraints R-IDs must not be uncovered')
  assert.deepEqual(result.covered_ids, ['R-001'])
})

test('checkRequirementCoverage falls back to whole-doc scan when no §2.1 In Scope heading (back-compat)', () => {
  const spec = '## Some legacy spec\n- R-001 first\n- R-002 second'
  const tasks = [{ id: 'T1', requirement_ids: ['R-001'] }]
  const result = checkRequirementCoverage(tasks, spec)
  assert.deepEqual(result.uncovered_ids, ['R-002'], 'legacy specs without §2.1 should still trigger coverage')
})

test('checkRequirementCoverage ignores malformed / non R-NNN requirement_ids entries', () => {
  const spec = '### 2.1 In Scope\n- R-001 alpha\n- R-002 beta\n'
  const tasks = [{ id: 'T1', requirement_ids: [' R-001 ', 'R-002', 'not-an-id', ''] }]
  const result = checkRequirementCoverage(tasks, spec)
  assert.deepEqual(result.uncovered_ids, [], 'whitespace-wrapped IDs should be recognized, junk ignored')
  assert.deepEqual(result.covered_ids.sort(), ['R-001', 'R-002'])
})

// ---------- lintTaskAtomicity (v2: task-dir records) ----------

test('lintTaskAtomicity fires when task declares N>=5 sub-items but acceptance has fewer bullets', () => {
  const { lintTaskAtomicity } = require(path.join(workflowDir, 'plan_composer.js'))
  const tasks = [
    { id: 'T1', name: '实现 8 个筛选项', task_text: '为列表页实现 8 个筛选项。', acceptance: ['筛选生效'] },
    { id: 'T2', name: '实现 2 个按钮', acceptance: ['按钮可点'] },
  ]
  const result = lintTaskAtomicity(tasks)
  assert.equal(result.checked_tasks, 2)
  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].task_id, 'T1')
  assert.equal(result.warnings[0].declared_subitems, 8)
})

test('lintTaskAtomicity passes when acceptance bullets cover declared sub-items', () => {
  const { lintTaskAtomicity } = require(path.join(workflowDir, 'plan_composer.js'))
  const tasks = [
    { id: 'T1', name: '实现 5 个字段', acceptance: ['a', 'b', 'c', 'd', 'e'] },
  ]
  const result = lintTaskAtomicity(tasks)
  assert.deepEqual(result.warnings, [])
})

test('checkRequirementCoverage degrades to all-uncovered when tasks carry no requirement_ids (legacy/compat)', () => {
  const spec = '### 2.1 In Scope\n- R-001 alpha\n'
  const tasks = [{ id: 'T1' }]
  const result = checkRequirementCoverage(tasks, spec)
  assert.deepEqual(result.uncovered_ids, ['R-001'])
  assert.deepEqual(result.covered_ids, [])
})

// ---------- derivePlanSummary (v2: task-dir records) ----------

test('derivePlanSummary extracts paths + task table + interaction legend', () => {
  const tasks = [
    { id: 'T1', name: 'foo', phase: 'implement', files: ['src/foo.ts'], depends: [], interaction: 'HITL', requirement_ids: ['R-001'] },
    { id: 'T2', name: 'bar', phase: 'test', depends: ['T1'], requirement_ids: ['R-002'] },
  ]
  const summary = derivePlanSummary(tasks, { spec_file: '/x/spec.md', plan_file: '/x/plan.md' })
  assert.equal(summary.paths.spec, '/x/spec.md')
  assert.equal(summary.paths.plan, '/x/plan.md')
  assert.equal(summary.task_count, 2)
  assert.equal(summary.task_table[0].id, 'T1')
  assert.equal(summary.task_table[0].phase, 'implement')
  assert.equal(summary.task_table[0].interaction, 'HITL')
  assert.equal(summary.task_table[0].deliverable, 'src/foo.ts')
  assert.equal(summary.task_table[1].interaction, 'AFK')
  assert.equal(summary.task_table[1].deps, 'T1')
  assert.equal(summary.req_stats.total_referenced, 2)
  assert.equal(summary.req_stats.tasks_with_refs, 2)
  assert.ok(summary.interaction_legend.includes('AFK'))
})

// ---------- scoreConfidence ----------

test('scoreConfidence full marks rubric', () => {
  // v2：confidence 读 task.json 记录（patterns[] / verification{commands,expected_output} / phase）。
  const tasks = [
    {
      id: 'T1', phase: 'implement',
      patterns: [{ file: 'src/x.ts' }, { file: 'src/y.ts' }, { file: 'src/z.ts' }],
      verification: { commands: ['npm test -- a'], expected_output: ['PASS'] },
    },
    {
      id: 'T2', phase: 'test',
      verification: { commands: ['npm test -- b'], expected_output: ['PASS'] },
    },
  ]
  const result = scoreConfidence(tasks, {
    coverage: { covered_ids: ['R-001', 'R-002'], uncovered_ids: [], partial_ids: [] },
  })
  assert.equal(result.breakdown.prd_coverage, 3)
  assert.equal(result.breakdown.patterns, 2)
  assert.equal(result.breakdown.verification, 3)
  assert.equal(result.breakdown.test_task, 2)
  assert.equal(result.score, 10)
  assert.equal(result.level, 'high')
})

test('scoreConfidence partial coverage drops PRD by 1', () => {
  const result = scoreConfidence([{ id: 'T1' }], {
    coverage: { covered_ids: ['R-001'], uncovered_ids: [], partial_ids: ['R-001'] },
  })
  assert.equal(result.breakdown.prd_coverage, 2, 'partial → +2 not +3')
})

test('scoreConfidence verification needs both commands and expected_output', () => {
  const tasks = [{ id: 'T1', verification: { commands: ['npm test'], expected_output: [] } }]
  const result = scoreConfidence(tasks, {
    coverage: { covered_ids: ['R-001'], uncovered_ids: [], partial_ids: [] },
  })
  assert.equal(result.breakdown.verification, 0, '只有 commands 没有 expected_output → 不给分')
})

test('scoreConfidence level boundaries', () => {
  const empty = scoreConfidence([], {})
  assert.equal(empty.score, 0)
  assert.equal(empty.level, 'low')
})

// F-10 regression: confidence dimensions capped by command_syntax / pattern_fidelity lint failures.
// task 本身达标（commands+expected）但 commandSyntax 报 issue → 仍封顶 0。
test('scoreConfidence verification capped at 0 when commandSyntax has issues (F-10 regression)', () => {
  const tasks = [{ id: 'T1', phase: 'implement', verification: { commands: ['npm test'], expected_output: ['PASS'] } }]
  const result = scoreConfidence(tasks, {
    coverage: { covered_ids: ['R-001'], uncovered_ids: [], partial_ids: [] },
    commandSyntax: { issues: [{ task: 'T1', kinds: ['bracket_mismatch'] }] },
  })
  assert.equal(result.breakdown.verification, 0, 'broken command should cap verification dim')
})

test('scoreConfidence patterns capped at 0 when patternFidelity has unresolved (F-10 regression)', () => {
  const tasks = [{ id: 'T1', patterns: [{ file: 'src/x.ts' }, { file: 'src/y.ts' }, { file: 'src/z.ts' }] }]
  const result = scoreConfidence(tasks, {
    coverage: { covered_ids: ['R-001'], uncovered_ids: [], partial_ids: [] },
    patternFidelity: { unresolved: [{ file: 'src/x.ts', reason: 'file_not_found' }] },
  })
  assert.equal(result.breakdown.patterns, 0, 'unresolved patterns should cap patterns dim')
})

// ---------- cmdPlanReview integration ----------

function setupSandboxState({ planContent, specContent, currentTasks }) {
  const projectId = `cli${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
  const statePath = getWorkflowStatePath(projectId)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-'))
  const planPath = path.join(tmpDir, 'plan.md')
  const specPath = path.join(tmpDir, 'spec.md')
  fs.writeFileSync(planPath, planContent)
  fs.writeFileSync(specPath, specContent)
  const state = ensureStateDefaults({
    project_id: projectId,
    status: 'planned',
    plan_file: planPath,
    spec_file: specPath,
    ...(currentTasks ? { current_tasks: currentTasks } : {}),
  })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return { projectId, statePath, tmpDir, planPath, specPath }
}

test('cmdPlanReview ready=true for clean plan covering all requirements', () => {
  const plan = [
    '## T1: foo',
    '- **阶段**: implement',
    '- **需求 ID**: R-001',
    '- **验证命令**: npm test',
    '- **验证期望**: PASS',
  ].join('\n')
  const spec = 'R-001 the only requirement'
  // C-1 不变式：planned ⟹ current_tasks[0]=firstTaskId（缺失会被 current_tasks_empty 正确拦下，非本测试关注点）。
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: plan, specContent: spec, currentTasks: ['T1'] })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, true, `expected ready=true, got ${JSON.stringify(result)}`)
    assert.deepEqual(result.coverage.uncovered_ids, [])
    assert.equal(result.lints.placeholder.hits.length, 0)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanReview ready=false when placeholder hit', () => {
  const plan = '## T1: TODO finish\n- **需求 ID**: R-001\n- **验证命令**: npm test\n- **验证期望**: PASS\n'
  const spec = 'R-001'
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: plan, specContent: spec })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, false)
    assert.ok(result.lints.placeholder.hits.length > 0)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// approve 后 spec.md 被人工编辑引入占位 → spec_placeholder 复检挡 ready（plan 侧干净，仅 spec 触发）。
// 防带占位 spec 在 approve 与 plan-review 之间流入 execute。
test('cmdPlanReview ready=false when spec.md gains placeholder post-approve (spec_placeholder gate)', () => {
  const plan = '## T1: foo\n- **需求 ID**: R-001\n- **验证命令**: npm test\n- **验证期望**: PASS\n'
  const spec = 'R-001 the requirement\n- TODO 后续补充约束\n'
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: plan, specContent: spec, currentTasks: ['T1'] })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, false, `spec placeholder must block ready, got ${JSON.stringify(result)}`)
    assert.equal(result.lints.placeholder.hits.length, 0, 'plan side is clean — only spec triggers')
    assert.ok(result.lints.spec_placeholder.hits.length > 0, 'spec_placeholder must carry hits')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// T8/FR-7: coverage 降为 advisory —— uncovered_ids 不再卡 ready，但仍作为字段返回。
test('cmdPlanReview ready=true when requirement uncovered (coverage advisory only)', () => {
  const plan = '## T1: foo\n- **需求 ID**: R-001\n- **验证命令**: npm test\n- **验证期望**: PASS\n'
  const spec = 'R-001 R-999 second untouched requirement'
  // C-1 不变式：planned ⟹ current_tasks[0]=firstTaskId（缺失会被 current_tasks_empty 正确拦下，非本测试关注点）。
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: plan, specContent: spec, currentTasks: ['T1'] })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, true, `uncovered must not block ready (advisory), got ${JSON.stringify(result)}`)
    assert.deepEqual(result.coverage.uncovered_ids, ['R-999'], 'coverage still returned as advisory field')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanReview returns error when no active workflow', () => {
  const result = cmdPlanReview('nonexistent-project-id-xyz', repoRoot)
  assert.ok(result.error, 'should return error for missing workflow')
})

// F-13 regression: missing/unreadable spec must block ready (cannot verify traceability).
test('cmdPlanReview blocks ready when spec_file is missing on disk (F-13 regression)', () => {
  const plan = '## T1: foo\n- **需求 ID**: R-001\n- **验证命令**: npm test\n- **验证期望**: PASS\n'
  const { projectId, statePath, tmpDir, specPath } = setupSandboxState({ planContent: plan, specContent: 'R-001' })
  fs.rmSync(specPath, { force: true })  // simulate deleted spec
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, false, `missing spec must block ready, got ${JSON.stringify({ ready: result.ready, spec_status: result.spec_status })}`)
    assert.equal(result.spec_status, 'spec_file_missing')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// P3 golden：v2 task-dir 驱动 plan-review 的 rich 维度（patterns/mandatory/verification/confidence），
// plan.md 仅叙述（无 task block）。验证 lint/confidence 已切到 task.json 源。
test('cmdPlanReview v2: lints/confidence 读 task-dir（叙述 plan.md 无 task block）', () => {
  const taskStore = require(path.join(workflowDir, 'task_store.js'))
  const plan = '# 叙述\n机器 task 源为 task-dir。\n'
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: plan, specContent: 'R-001 only', currentTasks: ['T1'] })
  taskStore.replaceAllTasks(projectId, [{
    id: 'T1', phase: 'test', status: 'pending',
    patterns: [
      { file: 'core/utils/workflow/plan_composer.js' },
      { file: 'core/utils/workflow/task_store.js' },
      { file: 'package.json' },
    ],
    mandatory_reading: [{ path: 'README.md', line_hint: '1-5', reason: 'ctx' }],
    verification: { commands: ['npm test'], expected_output: ['PASS'] },
    acceptance: ['R-001 covered'],
  }])
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.deepEqual(result.lints.pattern_fidelity.unresolved, [], 'patterns 引用真实文件 → 无 unresolved（来自 task-dir）')
    assert.equal(result.lints.mandatory_reading.declared, true, 'mandatory_reading 来自 task-dir')
    assert.deepEqual(result.lints.command_syntax.issues, [])
    assert.equal(result.confidence.breakdown.patterns, 2, '3 个 resolved patterns → +2')
    assert.equal(result.confidence.breakdown.verification, 3, 'commands+expected_output 双非空 → +3')
    assert.equal(result.confidence.breakdown.test_task, 2, 'phase=test → +2')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(path.join(path.dirname(statePath), 'tasks'), { recursive: true, force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanReview v2: 坏 pattern file → pattern_fidelity unresolved（task-dir 来源）', () => {
  const taskStore = require(path.join(workflowDir, 'task_store.js'))
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: '# 叙述\n', specContent: 'R-001', currentTasks: ['T1'] })
  taskStore.replaceAllTasks(projectId, [{ id: 'T1', patterns: [{ file: 'nope/missing.ts' }] }])
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.lints.pattern_fidelity.unresolved.length, 1, '坏 pattern 来自 task-dir')
    assert.equal(result.lints.pattern_fidelity.unresolved[0].reason, 'file_not_found')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(path.join(path.dirname(statePath), 'tasks'), { recursive: true, force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------- Phase B: lintAnchorIntegrity ----------

const V2_PLAN_FIXTURE = `---
version: 2
---
<!-- WF:ANCHOR:file_structure:begin -->
files
<!-- WF:ANCHOR:file_structure:end -->
<!-- WF:ANCHOR:tasks:begin -->
<!-- WF:ANCHOR:task:T1:begin -->
## T1: foo
- **需求 ID**: R-001
- **验证命令**: npm test
- **验证期望**: PASS
<!-- WF:ANCHOR:task:T1:end -->
<!-- WF:ANCHOR:tasks:end -->
<!-- WF:ANCHOR:verification_summary:begin -->
table
<!-- WF:ANCHOR:verification_summary:end -->
`

test('lintAnchorIntegrity intact v2 plan returns no orphans/missing', () => {
  const result = lintAnchorIntegrity(V2_PLAN_FIXTURE)
  assert.deepEqual(result.orphans, [])
  assert.deepEqual(result.missing, [])
  assert.ok(result.observed_ids.includes('task:T1'))
})

test('lintAnchorIntegrity catches orphan when end anchor missing', () => {
  const broken = V2_PLAN_FIXTURE.replace('<!-- WF:ANCHOR:tasks:end -->', '')
  const result = lintAnchorIntegrity(broken)
  assert.equal(result.orphans.length, 1)
  assert.equal(result.orphans[0].id, 'tasks')
})

test('lintAnchorIntegrity reports missing top-level anchors on v1 plan', () => {
  const v1 = '## T1: legacy\n- **需求 ID**: R-001\n'
  const result = lintAnchorIntegrity(v1)
  // top-level + task:T1 all missing (caller decides whether to enforce based on plan_version)
  assert.ok(result.missing.includes('file_structure'))
  assert.ok(result.missing.includes('tasks'))
  assert.ok(!result.missing.includes('verification_summary'), 'verification_summary anchor retired from expected set')
})

// F-12 regression: observed task:* anchor without matching `## Tn:` heading = stale.
test('lintAnchorIntegrity flags stale task anchors without matching heading (F-12 regression)', () => {
  const planWithStaleAnchor = [
    '---',
    'version: 2',
    '---',
    '<!-- WF:ANCHOR:file_structure:begin -->',
    '<!-- WF:ANCHOR:file_structure:end -->',
    '<!-- WF:ANCHOR:tasks:begin -->',
    '<!-- WF:ANCHOR:task:T1:begin -->',
    '## T2: renamed but anchor left as T1',  // mismatch on purpose
    '<!-- WF:ANCHOR:task:T1:end -->',
    '<!-- WF:ANCHOR:tasks:end -->',
    '<!-- WF:ANCHOR:verification_summary:begin -->',
    '<!-- WF:ANCHOR:verification_summary:end -->',
  ].join('\n')
  const result = lintAnchorIntegrity(planWithStaleAnchor)
  assert.ok(result.stale.includes('task:T1'), `stale task:T1 should be flagged, got ${JSON.stringify(result)}`)
  assert.ok(result.missing.includes('task:T2'), `missing task:T2 should be flagged, got ${JSON.stringify(result)}`)
})

// `### Tn:` headings count as tasks (consistent with other lints that accept both ## and ###).
test('lintAnchorIntegrity treats ### Tn: heading as a task (heading-style consistency)', () => {
  const planWithSubHeading = [
    '---',
    'version: 2',
    '---',
    '<!-- WF:ANCHOR:file_structure:begin -->',
    '<!-- WF:ANCHOR:file_structure:end -->',
    '<!-- WF:ANCHOR:tasks:begin -->',
    '<!-- WF:ANCHOR:task:T1:begin -->',
    '### T1: triple-hash heading',
    '<!-- WF:ANCHOR:task:T1:end -->',
    '<!-- WF:ANCHOR:tasks:end -->',
    '<!-- WF:ANCHOR:verification_summary:begin -->',
    '<!-- WF:ANCHOR:verification_summary:end -->',
  ].join('\n')
  const result = lintAnchorIntegrity(planWithSubHeading)
  assert.deepEqual(result.missing, [], `### T1: should be recognized, got missing=${JSON.stringify(result.missing)}`)
  assert.deepEqual(result.stale, [], `task:T1 should not be stale, got stale=${JSON.stringify(result.stale)}`)
})

// F-11 regression: every `## Tn:` heading must have a task:Tn anchor pair in v2 plans.
test('lintAnchorIntegrity flags missing task:Tn anchors (F-11 regression)', () => {
  const v2NoTaskAnchors = [
    '---',
    'version: 2',
    '---',
    '<!-- WF:ANCHOR:file_structure:begin -->',
    '<!-- WF:ANCHOR:file_structure:end -->',
    '<!-- WF:ANCHOR:tasks:begin -->',
    '## T1: foo',
    '## T2: bar',
    '<!-- WF:ANCHOR:tasks:end -->',
    '<!-- WF:ANCHOR:verification_summary:begin -->',
    '<!-- WF:ANCHOR:verification_summary:end -->',
  ].join('\n')
  const result = lintAnchorIntegrity(v2NoTaskAnchors)
  assert.ok(result.missing.includes('task:T1'), `expected task:T1 in missing, got ${JSON.stringify(result.missing)}`)
  assert.ok(result.missing.includes('task:T2'), `expected task:T2 in missing, got ${JSON.stringify(result.missing)}`)
})

// ---------- Phase B: detectPlanVersion ----------

test('detectPlanVersion returns 2 from v2 front matter', () => {
  assert.equal(detectPlanVersion(V2_PLAN_FIXTURE), 2)
})

test('detectPlanVersion returns null when no front matter', () => {
  assert.equal(detectPlanVersion('## T1: legacy\n'), null)
})

// ---------- Phase B: cmdPlanEdit ----------

test('cmdPlanEdit v2 plan replace_between succeeds + anchors intact', () => {
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({
    planContent: V2_PLAN_FIXTURE,
    specContent: 'R-001',
  })
  const contentFile = path.join(tmpDir, 'new-tasks.md')
  fs.writeFileSync(contentFile, '<!-- WF:ANCHOR:task:T1:begin -->\n## T1: replaced\n- **需求 ID**: R-001\n<!-- WF:ANCHOR:task:T1:end -->')
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      mode: 'replace_between',
      contentFile,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.written, true, `expected written, got ${JSON.stringify(result)}`)
    assert.equal(result.anchors_intact, true)
    const updated = fs.readFileSync(planPath, 'utf8')
    assert.ok(updated.includes('## T1: replaced'))
    assert.ok(updated.includes('WF:ANCHOR:tasks:begin'), 'top anchor still present')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanEdit v1 plan default rejects with legacy_plan_no_anchors', () => {
  const v1Plan = '## T1: legacy\n- **需求 ID**: R-001\n'
  const { projectId, statePath, tmpDir } = setupSandboxState({ planContent: v1Plan, specContent: 'R-001' })
  const contentFile = path.join(tmpDir, 'x.md')
  fs.writeFileSync(contentFile, 'new content')
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      contentFile,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.error, 'legacy_plan_no_anchors', `expected legacy error, got ${JSON.stringify(result)}`)
    assert.ok(result.suggestion)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanEdit v1 plan with --allow-legacy overwrites whole file', () => {
  const v1Plan = '## T1: legacy\n- **需求 ID**: R-001\n'
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({ planContent: v1Plan, specContent: 'R-001' })
  const contentFile = path.join(tmpDir, 'x.md')
  fs.writeFileSync(contentFile, '# Brand New Plan')
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      contentFile,
      allowLegacy: true,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.written, true)
    assert.equal(result.legacy_overwrite, true)
    assert.equal(fs.readFileSync(planPath, 'utf8'), '# Brand New Plan')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// F-02 regression: replace_full + --allow-anchor-change must reject content
// that drops required top-level anchors (missing != orphans).
// F-05 regression: replacement content with `$&` / `$1` / `$$` metachars must be inserted verbatim.
test('cmdPlanEdit preserves $-sequence metachars verbatim in replace_between (F-05 regression)', () => {
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({
    planContent: V2_PLAN_FIXTURE,
    specContent: 'R-001',
  })
  const contentFile = path.join(tmpDir, 'dollar-content.md')
  // newContent contains shell/regex metachars common in plan code blocks: $1 $& $$ $'foo'
  const literalContent = "regex sub: s/(\\d+)/$1/g  shell: echo $$ pid; awk '{print $&}'"
  fs.writeFileSync(contentFile, literalContent)
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      mode: 'replace_between',
      contentFile,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.written, true, `expected write, got ${JSON.stringify(result)}`)
    const updated = fs.readFileSync(planPath, 'utf8')
    assert.ok(updated.includes(literalContent), `dollar sequences must be preserved verbatim. got: ${updated}`)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanEdit preserves $-sequence metachars verbatim in replace_full (F-05 regression)', () => {
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({
    planContent: V2_PLAN_FIXTURE,
    specContent: 'R-001',
  })
  const contentFile = path.join(tmpDir, 'dollar-full.md')
  const literalContent = [
    '<!-- WF:ANCHOR:tasks:begin -->',
    '<!-- WF:ANCHOR:task:T1:begin -->',
    '## T1: shell snippet',
    '- **需求 ID**: R-001',
    "- code: echo $$ pid; sed 's/foo/$&/' | awk '{print $1}'",
    '<!-- WF:ANCHOR:task:T1:end -->',
    '<!-- WF:ANCHOR:tasks:end -->',
  ].join('\n')
  fs.writeFileSync(contentFile, literalContent)
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      mode: 'replace_full',
      contentFile,
      allowAnchorChange: true,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.written, true, `expected write, got ${JSON.stringify(result)}`)
    const updated = fs.readFileSync(planPath, 'utf8')
    assert.ok(updated.includes("echo $$ pid"), 'shell $$ must be preserved')
    assert.ok(updated.includes("sed 's/foo/$&/'"), '$& must be preserved')
    assert.ok(updated.includes("awk '{print $1}'"), '$1 must be preserved')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanEdit replace_full --allow-anchor-change rejects content omitting required anchor (F-02 regression)', () => {
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({
    planContent: V2_PLAN_FIXTURE,
    specContent: 'R-001',
  })
  const contentFile = path.join(tmpDir, 'no-tasks-anchor.md')
  // Replacement content has NO anchor at all → after replace_full, top-level `tasks` anchor pair vanishes.
  fs.writeFileSync(contentFile, '## T1: orphaned content\n- **需求 ID**: R-001\n')
  const planBefore = fs.readFileSync(planPath, 'utf8')
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      mode: 'replace_full',
      contentFile,
      allowAnchorChange: true,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.error, 'anchor_integrity_broken_after_edit', `expected guard to fire, got ${JSON.stringify(result)}`)
    assert.ok(Array.isArray(result.missing) && result.missing.includes('tasks'), `missing should include tasks anchor, got ${JSON.stringify(result.missing)}`)
    // Plan must not be mutated when guard fires.
    assert.equal(fs.readFileSync(planPath, 'utf8'), planBefore, 'plan should be unchanged when integrity guard rejects')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanEdit replace_full --allow-anchor-change accepts content that keeps required anchors', () => {
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({
    planContent: V2_PLAN_FIXTURE,
    specContent: 'R-001',
  })
  const contentFile = path.join(tmpDir, 'keeps-anchor.md')
  // Provide the full replacement including the begin/end anchor pair around new content.
  fs.writeFileSync(contentFile, [
    '<!-- WF:ANCHOR:tasks:begin -->',
    '<!-- WF:ANCHOR:task:T1:begin -->',
    '## T1: rebuilt',
    '- **需求 ID**: R-001',
    '<!-- WF:ANCHOR:task:T1:end -->',
    '<!-- WF:ANCHOR:tasks:end -->',
  ].join('\n'))
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      mode: 'replace_full',
      contentFile,
      allowAnchorChange: true,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.written, true, `expected write, got ${JSON.stringify(result)}`)
    const updated = fs.readFileSync(planPath, 'utf8')
    assert.ok(updated.includes('## T1: rebuilt'))
    assert.ok(updated.includes('WF:ANCHOR:tasks:begin'))
    assert.ok(updated.includes('WF:ANCHOR:tasks:end'))
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// F-09 regression: CRLF line endings must work; pattern-mismatch must error, not silent no-op.
test('cmdPlanEdit handles CRLF line endings without silent no-op (F-09 regression)', () => {
  const crlfPlan = V2_PLAN_FIXTURE.replace(/\n/g, '\r\n')
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({
    planContent: crlfPlan,
    specContent: '### 2.1 In Scope\n- R-001\n',
  })
  const contentFile = path.join(tmpDir, 'new.md')
  // New content must include task:T1 anchor pair to satisfy F-11 (every ## Tn: needs anchor).
  fs.writeFileSync(contentFile, [
    '<!-- WF:ANCHOR:task:T1:begin -->',
    '## T1: edited via CRLF plan',
    '- **需求 ID**: R-001',
    '<!-- WF:ANCHOR:task:T1:end -->',
  ].join('\n'))
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      mode: 'replace_between',
      contentFile,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.written, true, `CRLF plan should still be editable, got ${JSON.stringify(result)}`)
    const updated = fs.readFileSync(planPath, 'utf8')
    assert.ok(updated.includes('edited via CRLF plan'), 'edit must actually apply')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// F-14 regression: plan-edit must reject edits that orphan state.current_tasks.
test('cmdPlanEdit rejects edit that orphans state.current_tasks (F-14 regression)', () => {
  const { projectId, statePath, tmpDir, planPath } = setupSandboxState({
    planContent: V2_PLAN_FIXTURE,
    specContent: '### 2.1 In Scope\n- R-001\n',
    currentTasks: ['T1'],
  })
  const contentFile = path.join(tmpDir, 'rename.md')
  // Replacement renames T1 → T99, leaving state.current_tasks=['T1'] orphan.
  fs.writeFileSync(contentFile, [
    '<!-- WF:ANCHOR:task:T99:begin -->',
    '## T99: renamed',
    '- **需求 ID**: R-001',
    '<!-- WF:ANCHOR:task:T99:end -->',
  ].join('\n'))
  const planBefore = fs.readFileSync(planPath, 'utf8')
  try {
    const result = cmdPlanEdit({
      anchor: 'tasks',
      mode: 'replace_between',
      contentFile,
      projectId,
      projectRoot: repoRoot,
    })
    assert.equal(result.error, 'current_tasks_orphaned_by_edit', `expected guard, got ${JSON.stringify(result)}`)
    assert.deepEqual(result.orphaned_task_ids, ['T1'])
    assert.equal(fs.readFileSync(planPath, 'utf8'), planBefore, 'plan must not be mutated')
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanEdit rejects when anchor not found in v2 plan', () => {
  const { projectId, statePath, tmpDir } = setupSandboxState({
    planContent: V2_PLAN_FIXTURE,
    specContent: 'R-001',
  })
  const contentFile = path.join(tmpDir, 'x.md')
  fs.writeFileSync(contentFile, 'new')
  try {
    const result = cmdPlanEdit({
      anchor: 'nonexistent_anchor',
      contentFile,
      projectId,
      projectRoot: repoRoot,
    })
    assert.match(result.error, /锚点未找到/)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------- Phase B: cmdPlanReview anchor integration ----------

test('cmdPlanReview v2 plan with broken anchor → ready=false', () => {
  const broken = V2_PLAN_FIXTURE.replace('<!-- WF:ANCHOR:tasks:end -->', '')
  const { projectId, statePath, tmpDir } = setupSandboxState({
    planContent: broken,
    specContent: 'R-001',
  })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, false)
    assert.ok(result.lints.anchor_integrity.orphans.length > 0)
    assert.equal(result.lints.anchor_integrity.plan_version, 2)
    assert.equal(result.lints.anchor_integrity.enforced, true)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cmdPlanReview v1 plan with no anchors → ready=true (anchor not enforced)', () => {
  const v1 = '## T1: foo\n- **需求 ID**: R-001\n- **验证命令**: npm test\n- **验证期望**: PASS\n'
  const { projectId, statePath, tmpDir } = setupSandboxState({
    planContent: v1,
    specContent: 'R-001',
    // C-1 不变式：planned ⟹ current_tasks[0]=firstTaskId（缺失会被 current_tasks_empty 正确拦下，非本测试关注点）。
    currentTasks: ['T1'],
  })
  try {
    const result = cmdPlanReview(projectId, repoRoot)
    assert.equal(result.ready, true, `expected ready=true for v1, got ${JSON.stringify(result)}`)
    assert.equal(result.lints.anchor_integrity.enforced, false)
  } finally {
    fs.rmSync(statePath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------- Phase B: Anchor rendering pipeline survival ----------

// ---------- Phase C: lintMandatoryReading ----------

test('lintMandatoryReading no entries → declared=false, no block', () => {
  const result = lintMandatoryReading([{ id: 'T1' }])
  assert.equal(result.declared, false)
  assert.deepEqual(result.violations, [])
})

test('lintMandatoryReading well-formed entries → declared=true, no violations', () => {
  const tasks = [{
    id: 'T1',
    mandatory_reading: [
      { path: 'src/a.ts', line_hint: '1-50', reason: 'core logic' },
      { path: 'src/b.ts', line_hint: '100', reason: 'helper' },
    ],
  }]
  const result = lintMandatoryReading(tasks)
  assert.equal(result.declared, true)
  assert.deepEqual(result.violations, [])
})

test('lintMandatoryReading malformed line_hint → violation', () => {
  const tasks = [{ id: 'T1', mandatory_reading: [{ path: 'src/a.ts', line_hint: 'entire file', reason: 'core' }] }]
  const result = lintMandatoryReading(tasks)
  assert.equal(result.declared, true)
  assert.equal(result.violations.length, 1)
})

// 行号可选：line_hint 留空 = 合规,implementer 自读定位。
test('lintMandatoryReading empty line_hint → no violation (line numbers optional)', () => {
  const tasks = [{
    id: 'T1',
    mandatory_reading: [
      { path: 'src/a.ts', line_hint: '', reason: 'core logic' },
      { path: 'src/b.ts', line_hint: '100', reason: 'helper' },
    ],
  }]
  const result = lintMandatoryReading(tasks)
  assert.equal(result.declared, true)
  assert.deepEqual(result.violations, [], `empty line_hint must be compliant, got ${JSON.stringify(result)}`)
})

// 跨 task 的 mandatory_reading 条目都要被检查，不能漏（多 task 聚合不漏项）。
test('lintMandatoryReading inspects entries across all tasks', () => {
  const tasks = [
    { id: 'T1', mandatory_reading: [{ path: 'src/a.ts', line_hint: '1-50' }] },
    { id: 'T2', mandatory_reading: [{ path: 'src/b.ts', line_hint: 'entire file' }] },
  ]
  const result = lintMandatoryReading(tasks)
  assert.equal(result.declared, true)
  assert.equal(result.violations.length, 1, `每个 task 的条目都须检查, got ${JSON.stringify(result)}`)
})

// ---------- Phase C: lintCommandSyntax ----------

test('lintCommandSyntax happy path → no issues', () => {
  const tasks = [{ id: 'T1', verification: { commands: ['npm test -- a.test.ts'], expected_output: ['PASS'] } }]
  const result = lintCommandSyntax(tasks)
  assert.deepEqual(result.issues, [])
})

test('lintCommandSyntax catches unclosed bracket', () => {
  const tasks = [{ id: 'T1', verification: { commands: ['npm test (foo'] } }]
  const result = lintCommandSyntax(tasks)
  assert.equal(result.issues.length, 1)
  assert.ok(result.issues[0].kinds.includes('bracket_mismatch'))
})

test('lintCommandSyntax catches trailing pipe and unclosed quote', () => {
  const tasks = [{ id: 'T1', verification: { commands: ['npm test "abc |'] } }]
  const result = lintCommandSyntax(tasks)
  assert.equal(result.issues.length, 1)
  assert.ok(result.issues[0].kinds.includes('trailing_pipe'))
  assert.ok(result.issues[0].kinds.includes('double_quote_unclosed'))
})

// ---------- Phase C: lintPatternFidelity ----------

test('lintPatternFidelity catches missing file', () => {
  const tasks = [{ id: 'T1', patterns: [{ file: 'nonexistent/file.ts', line: '1-10', note: 'p' }] }]
  const result = lintPatternFidelity(tasks, repoRoot)
  assert.equal(result.unresolved.length, 1)
  assert.equal(result.unresolved[0].reason, 'file_not_found')
})

test('lintPatternFidelity accepts existing file', () => {
  const tasks = [{ id: 'T1', patterns: [{ file: 'core/utils/workflow/plan_composer.js', line: '1-10' }] }]
  const result = lintPatternFidelity(tasks, repoRoot)
  assert.equal(result.unresolved.length, 0)
})

test('lintPatternFidelity catches line out of range', () => {
  const tasks = [{ id: 'T1', patterns: [{ file: 'package.json', line: '9999-10000' }] }]
  const result = lintPatternFidelity(tasks, repoRoot)
  assert.equal(result.unresolved.length, 1)
  assert.equal(result.unresolved[0].reason, 'line_out_of_range')
})

test('plan-template + buildNarrativeTasksBody render pipeline preserves anchors', () => {
  const templatePath = path.join(repoRoot, 'core', 'specs', 'workflow-templates', 'plan-template.md')
  const template = fs.readFileSync(templatePath, 'utf8')
  // Verify template itself has anchors around {{tasks}} and other sections
  assert.ok(template.includes('<!-- WF:ANCHOR:file_structure:begin -->'))
  assert.ok(template.includes('<!-- WF:ANCHOR:tasks:begin -->'))

  // Render with minimal stub（v2 渲染链：{{tasks}} 只装人类可读叙述，不再注入结构化 task block）
  const tasksBody = buildNarrativeTasksBody([
    { id: 'R-001', summary: 'foo', spec_section: '§2', acceptance_signal: 'works' },
    { id: 'R-002', summary: 'bar', spec_section: '§3', acceptance_signal: 'ok' },
  ])
  const stubValues = {
    requirement_source: 'inline',
    created_at: 'now',
    spec_file: 'spec.md',
    task_name: 't',
    goal: 'g',
    architecture_summary: 'a',
    tech_stack: 'ts',
    role_profile: 'planner',
    context_profile: '{}',
    injected_context_summary: '-',
    files_create: '-',
    files_modify: '-',
    files_test: '-',
    tasks: tasksBody,
  }
  const rendered = renderTemplate(template, stubValues)
  // Top-level anchors survive
  assert.ok(rendered.includes('<!-- WF:ANCHOR:file_structure:begin -->'))
  assert.ok(rendered.includes('<!-- WF:ANCHOR:tasks:begin -->'))
  // Narrative body lands inside the tasks section, with no structured task-level anchors
  const tasksBeginIdx = rendered.indexOf('<!-- WF:ANCHOR:tasks:begin -->')
  const tasksEndIdx = rendered.indexOf('<!-- WF:ANCHOR:tasks:end -->')
  const t1Idx = rendered.indexOf('R-001')
  assert.ok(t1Idx > tasksBeginIdx && t1Idx < tasksEndIdx, 'narrative body inside tasks section')
  assert.ok(!rendered.includes('<!-- WF:ANCHOR:task:T1:begin -->'), 'no structured task anchors in v2 narrative plan')
  // No unrendered placeholders
  assert.ok(!rendered.match(/\{\{tasks\}\}/), 'tasks placeholder rendered')
  // Integrity check
  const integrity = lintAnchorIntegrity(rendered)
  assert.deepEqual(integrity.orphans, [], 'all anchors paired after render')
  assert.deepEqual(integrity.missing, [], 'all top-level anchors present')
})
