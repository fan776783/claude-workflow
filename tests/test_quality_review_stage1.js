const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const qualityReview = require(path.join(workflowDir, 'quality_review.js'))
const workflowTypes = require(path.join(workflowDir, 'workflow_types.js'))
const roleInjection = require(path.join(workflowDir, 'role_injection.js'))

test('workflow-review Stage 1 code-specs + Probe E plumbing', async (t) => {
  await t.test('pass gate records advisory code_specs_check with supplied findings_count', () => {
    const gate = qualityReview.buildPassGateResult(
      'T1',
      'base-123',
      'head-456',
      'T1',
      'T1',
      2,
      [],
      [],
      1,
      1,
      0,
      0,
      0,
      0,
      'subagent',
      {},
      'single_reviewer',
      null,
      null,
      { codeSpecsCheck: { performed: true, findingsCount: 3 } }
    )
    assert.equal(gate.overall_passed, true)
    assert.equal(gate.stage1.code_specs_check.performed, true)
    assert.equal(gate.stage1.code_specs_check.advisory, true)
    assert.equal(gate.stage1.code_specs_check.findings_count, 3)
    assert.equal(gate.stage1.cross_layer_depth_gap, undefined, 'pass path must not carry blocking field')
  })

  await t.test('fail gate with cross_layer_depth_gap surfaces blocking_issues entry', () => {
    const gate = qualityReview.buildFailedGateResult(
      'T2',
      'stage1',
      'base-123',
      'head-789',
      null,
      null,
      0,
      [],
      [],
      1,
      2,
      {},
      'subagent',
      {},
      {
        codeSpecsCheck: { performed: true, findingsCount: 1 },
        crossLayerDepthGap: {
          triggered: true,
          files: ['src/api/export.ts', 'src/migrations/20260419_add_export.sql'],
          specs: ['my-pkg/backend/export-api.md'],
          missingSections: ['Validation & Error Matrix', 'Tests Required'],
          description: 'Probe E triggered: infra path + spec depth gap',
        },
      }
    )
    assert.equal(gate.overall_passed, false)
    assert.equal(gate.last_decision, 'revise')
    assert.equal(gate.stage1.cross_layer_depth_gap.triggered, true)
    assert.deepEqual(gate.stage1.cross_layer_depth_gap.missing_sections, [
      'Validation & Error Matrix',
      'Tests Required',
    ])
    const blocker = gate.blocking_issues.find((x) => x.type === 'cross_layer_depth_gap')
    assert.ok(blocker, 'cross_layer_depth_gap must be present in blocking_issues')
    assert.equal(blocker.severity, 'critical')
    assert.deepEqual(blocker.files, [
      'src/api/export.ts',
      'src/migrations/20260419_add_export.sql',
    ])
    assert.deepEqual(blocker.specs, ['my-pkg/backend/export-api.md'])
    assert.deepEqual(blocker.missing_sections, ['Validation & Error Matrix', 'Tests Required'])
  })

  await t.test('fail gate merges Probe E entry when lastResult already carries blocking_issues (F1 regression guard)', () => {
    // 回归保护：外部 reviewer 产出的 `blocking_issues` 与 Probe E 同时存在时，Probe E 条目必须被**追加**，不能被吞。
    const priorBlocker = { description: 'external reviewer finding', severity: 'important' }
    const gate = qualityReview.buildFailedGateResult(
      'T-F1',
      'stage1',
      'base-xyz',
      'head-xyz',
      null,
      null,
      0,
      [],
      [],
      1,
      2,
      { blocking_issues: [priorBlocker] },
      'subagent',
      {},
      {
        codeSpecsCheck: { performed: true, findingsCount: 0 },
        crossLayerDepthGap: {
          triggered: true,
          files: ['src/api/foo.ts'],
          specs: ['pkg/backend/foo.md'],
          missingSections: ['Tests Required'],
          description: '',
        },
      }
    )
    assert.equal(gate.blocking_issues.length, 2, 'both prior blocker and Probe E entry must be present')
    assert.ok(gate.blocking_issues.some((x) => x.description === 'external reviewer finding'), 'prior blocker preserved')
    assert.ok(gate.blocking_issues.some((x) => x.type === 'cross_layer_depth_gap'), 'Probe E entry appended')
  })

  await t.test('fail gate records issues_found >= 1 for pure Probe E failure (F2 regression guard)', () => {
    // 回归保护：只有 Probe E 触发时，stage1.issues_found 不得为 0（以前 extractIssueCount 漏算 cross_layer_depth_gap）。
    const gate = qualityReview.buildFailedGateResult(
      'T-F2',
      'stage1',
      'base-xyz',
      null,
      null,
      null,
      0,
      [],
      [],
      1,
      2,
      {}, // lastResult 里不带其它 finding
      'subagent',
      {},
      {
        codeSpecsCheck: { performed: true, findingsCount: 0 },
        crossLayerDepthGap: {
          triggered: true,
          files: ['src/api/bar.ts'],
          specs: ['pkg/backend/bar.md'],
          missingSections: ['Validation & Error Matrix', 'Tests Required'],
        },
      }
    )
    assert.equal(gate.stage1.passed, false)
    // missing_sections 有 2 条，extractIssueCount 至少应该报 2；缺省兜底也至少是 1。
    assert.ok(gate.stage1.issues_found >= 1,
      `pure Probe E failure must report issues_found >= 1, got ${gate.stage1.issues_found}`)
  })

  await t.test('fail gate without cross_layer_depth_gap behaves as before', () => {
    const gate = qualityReview.buildFailedGateResult(
      'T3',
      'stage1',
      'base-123',
      null,
      null,
      null,
      0,
      [],
      [],
      1,
      2,
      { missing: [{ description: 'missing requirement' }] },
      'subagent',
      {},
      { codeSpecsCheck: { performed: true, findingsCount: 0 } }
    )
    assert.equal(gate.stage1.cross_layer_depth_gap, undefined)
    const blocker = gate.blocking_issues.find((x) => x.type === 'cross_layer_depth_gap')
    assert.equal(blocker, undefined)
    // Code Specs Check still recorded as advisory
    assert.equal(gate.stage1.code_specs_check.advisory, true)
  })

  await t.test('normalizeQualityGateRecord backfills advisory code_specs_check on legacy records', () => {
    const legacy = {
      gate_task_id: 'T4',
      review_mode: 'machine_loop',
      last_decision: 'pass',
      stage1: { passed: true, attempts: 1 },
      stage2: { passed: true, attempts: 1 },
      overall_passed: true,
      reviewed_at: '2026-04-19T00:00:00.000Z',
    }
    const normalized = workflowTypes.normalizeQualityGateRecord('T4', legacy)
    assert.equal(normalized.stage1.code_specs_check.performed, false)
    assert.equal(normalized.stage1.code_specs_check.advisory, true)
    assert.equal(normalized.stage1.code_specs_check.findings_count, 0)
  })

  await t.test('classifyInfraDepth detects api / migrations / auth hits and counts layers', () => {
    const result = roleInjection.classifyInfraDepth([
      'src/api/export.ts',
      'src/services/exporter.ts',
      'src/components/ExportButton.tsx',
      'src/migrations/20260419_add.sql',
      'docs/readme.md',
    ])
    assert.equal(result.infra, true)
    assert.ok(result.infraFiles.includes('src/api/export.ts'))
    assert.ok(result.infraFiles.includes('src/migrations/20260419_add.sql'))
    assert.equal(result.layerCount >= 3, true, 'should detect api/service/ui/db layers')
  })

  await t.test('classifyInfraDepth returns empty on unrelated diffs', () => {
    const result = roleInjection.classifyInfraDepth(['README.md', 'docs/guide.md'])
    assert.equal(result.infra, false)
    assert.equal(result.layerCount, 0)
    assert.deepEqual(result.infraFiles, [])
  })
})
