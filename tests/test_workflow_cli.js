const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const {
  cmdResumeFromGovernanceHalt,
  cmdSetReportPath,
} = require(path.join(workflowDir, 'workflow_cli.js'))
const { ensureStateDefaults } = require(path.join(workflowDir, 'workflow_types.js'))
const { getWorkflowStatePath } = require(path.join(workflowDir, 'path_utils.js'))

function setupSandboxState({ status = 'halted', haltReason = 'governance', reviewReportPath = null } = {}) {
  const projectId = `cli${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
  const statePath = getWorkflowStatePath(projectId)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const state = ensureStateDefaults({
    project_id: projectId,
    status,
    halt_reason: haltReason,
    plan_file: '/tmp/fake-plan.md',
    spec_file: '/tmp/fake-spec.md',
    review_report_path: reviewReportPath,
  })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return { projectId, statePath }
}

function cleanup(projectId) {
  try {
    const statePath = getWorkflowStatePath(projectId)
    const workflowDirPath = path.dirname(statePath)
    if (fs.existsSync(workflowDirPath)) {
      fs.rmSync(workflowDirPath, { recursive: true, force: true })
    }
  } catch {}
}

test('cmdResumeFromGovernanceHalt', async (t) => {
  await t.test('clears halt and returns running when halt_reason=governance', () => {
    const { projectId, statePath } = setupSandboxState({ status: 'halted', haltReason: 'governance' })
    try {
      const result = cmdResumeFromGovernanceHalt(projectId, null)
      assert.equal(result.resumed, true)
      assert.equal(result.workflow_status, 'running')
      assert.equal(result.previous_halt_reason, 'governance')
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(state.status, 'running')
      assert.equal(state.halt_reason, null)
    } finally {
      cleanup(projectId)
    }
  })

  await t.test('rejects when halt_reason is not governance', () => {
    const { projectId } = setupSandboxState({ status: 'halted', haltReason: 'failure' })
    try {
      const result = cmdResumeFromGovernanceHalt(projectId, null)
      assert.equal(result.error != null, true)
      assert.equal(result.halt_reason, 'failure')
    } finally {
      cleanup(projectId)
    }
  })

  await t.test('rejects when status is not halted', () => {
    const { projectId } = setupSandboxState({ status: 'running', haltReason: null })
    try {
      const result = cmdResumeFromGovernanceHalt(projectId, null)
      assert.equal(result.error != null, true)
      assert.equal(result.state_status, 'running')
    } finally {
      cleanup(projectId)
    }
  })
})

test('cmdSetReportPath', async (t) => {
  await t.test('writes review_report_path on running workflow', () => {
    const { projectId, statePath } = setupSandboxState({ status: 'running', haltReason: null })
    try {
      const result = cmdSetReportPath('~/.claude/workflows/x/reports/foo-0520.md', projectId, null)
      assert.equal(result.updated, true)
      assert.equal(result.review_report_path, '~/.claude/workflows/x/reports/foo-0520.md')
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(state.review_report_path, '~/.claude/workflows/x/reports/foo-0520.md')
    } finally {
      cleanup(projectId)
    }
  })

  await t.test('unset clears review_report_path', () => {
    const { projectId, statePath } = setupSandboxState({ status: 'running', haltReason: null, reviewReportPath: '/tmp/r.md' })
    try {
      const result = cmdSetReportPath(null, projectId, null, { unset: true })
      assert.equal(result.updated, true)
      assert.equal(result.review_report_path, null)
      assert.equal(result.previous_value, '/tmp/r.md')
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(state.review_report_path, null)
    } finally {
      cleanup(projectId)
    }
  })

  await t.test('rejects empty path without --unset', () => {
    const { projectId } = setupSandboxState({ status: 'running', haltReason: null })
    try {
      const result = cmdSetReportPath('', projectId, null)
      assert.equal(result.error != null, true)
    } finally {
      cleanup(projectId)
    }
  })
})
