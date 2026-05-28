const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const {
  cmdSetContractDigestPath,
  cmdWriteHandoff,
  cmdReadHandoff,
  resolveHelpRequest,
} = require(path.join(workflowDir, 'workflow_cli.js'))
const { ensureStateDefaults } = require(path.join(workflowDir, 'workflow_types.js'))
const { getWorkflowStatePath, getHandoffPath } = require(path.join(workflowDir, 'path_utils.js'))

function setupSandboxState({ status = 'running', haltReason = null, contractDigestPath = null } = {}) {
  const projectId = `cli${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
  const statePath = getWorkflowStatePath(projectId)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const state = ensureStateDefaults({
    project_id: projectId,
    status,
    halt_reason: haltReason,
    plan_file: '/tmp/fake-plan.md',
    spec_file: '/tmp/fake-spec.md',
    contract_digest_path: contractDigestPath,
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

// Removed test suites 'cmdResumeFromGovernanceHalt' and 'cmdSetReportPath' — both commands were retired
// in the lean-execute refactor (governance halt resume + review_report_path / set-report-path persistence).
// workflow_cli.js no longer exports cmdResumeFromGovernanceHalt / cmdSetReportPath.

test('getHandoffPath', async (t) => {
  await t.test('returns handoff/{from-phase}.md under workflows dir for whitelisted phase', () => {
    const expected = path.join(os.homedir(), '.claude', 'workflows', 'demo123', 'handoff', 'spec.md')
    assert.equal(getHandoffPath('demo123', 'spec'), expected)
  })

  await t.test('returns null for non-whitelisted fromPhase', () => {
    assert.equal(getHandoffPath('demo123', 'review'), null)
  })

  await t.test('returns null for invalid projectId', () => {
    assert.equal(getHandoffPath('../etc', 'spec'), null)
  })
})

test('cmdWriteHandoff', async (t) => {
  await t.test('writes 5-line freshness header + body from state', () => {
    const { projectId, statePath } = setupSandboxState({ status: 'running', haltReason: null })
    const contentFile = path.join(os.tmpdir(), `handoff-body-${Date.now()}.md`)
    fs.writeFileSync(contentFile, '## Decisions\n- chose A over B\n## Risks\n- none')
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      const result = cmdWriteHandoff({ fromPhase: 'spec', toPhase: 'plan', contentFile, projectId, projectRoot: null })
      assert.equal(result.error, undefined)
      assert.equal(result.written, true)
      assert.equal(result.path, getHandoffPath(projectId, 'spec'))
      const written = fs.readFileSync(result.path, 'utf8')
      const lines = written.split('\n')
      assert.equal(lines[0], 'from: spec')
      assert.equal(lines[1], 'to: plan')
      assert.equal(lines[2], `state_updated_at: ${state.updated_at}`)
      assert.equal(lines[3], `spec_file: ${state.spec_file}`)
      assert.equal(lines[4], `plan_file: ${state.plan_file}`)
      assert.ok(written.includes('## Decisions'))
      assert.ok(written.includes('- chose A over B'))
    } finally {
      fs.rmSync(contentFile, { force: true })
      cleanup(projectId)
    }
  })

  await t.test('rejects body with more than 20 lines and does not write file', () => {
    const { projectId } = setupSandboxState({ status: 'running', haltReason: null })
    const contentFile = path.join(os.tmpdir(), `handoff-big-${Date.now()}.md`)
    fs.writeFileSync(contentFile, Array.from({ length: 21 }, (_, i) => `line ${i}`).join('\n'))
    try {
      const result = cmdWriteHandoff({ fromPhase: 'spec', toPhase: 'plan', contentFile, projectId, projectRoot: null })
      assert.equal(result.error != null, true)
      assert.equal(fs.existsSync(getHandoffPath(projectId, 'spec')), false)
    } finally {
      fs.rmSync(contentFile, { force: true })
      cleanup(projectId)
    }
  })
})

test('cmdReadHandoff', async (t) => {
  await t.test('returns fresh + body when header matches current state', () => {
    const { projectId } = setupSandboxState({ status: 'running', haltReason: null })
    const contentFile = path.join(os.tmpdir(), `handoff-read-fresh-${Date.now()}.md`)
    fs.writeFileSync(contentFile, '## Decisions\n- chose A over B\n## Risks\n- none')
    try {
      const write = cmdWriteHandoff({ fromPhase: 'spec', toPhase: 'plan', contentFile, projectId, projectRoot: null })
      assert.equal(write.written, true)
      const result = cmdReadHandoff({ from: 'spec', projectId, projectRoot: null })
      assert.equal(result.fresh, true)
      assert.equal(result.reason, undefined)
      assert.ok(result.content.includes('## Decisions'))
      assert.ok(result.content.includes('- chose A over B'))
      // 正文不含 header 行
      assert.ok(!result.content.includes('state_updated_at:'))
      assert.ok(!result.content.includes('from: spec'))
    } finally {
      fs.rmSync(contentFile, { force: true })
      cleanup(projectId)
    }
  })

  await t.test('returns stale + read-full fallback when spec_file differs from current state', () => {
    const { projectId, statePath } = setupSandboxState({ status: 'running', haltReason: null })
    const contentFile = path.join(os.tmpdir(), `handoff-read-stale-${Date.now()}.md`)
    fs.writeFileSync(contentFile, '## Decisions\n- stale check')
    try {
      const write = cmdWriteHandoff({ fromPhase: 'spec', toPhase: 'plan', contentFile, projectId, projectRoot: null })
      assert.equal(write.written, true)
      // 篡改当前 state.spec_file → header 不再匹配
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      state.spec_file = '/tmp/other-spec.md'
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
      const result = cmdReadHandoff({ from: 'spec', projectId, projectRoot: null })
      assert.equal(result.fresh, false)
      assert.equal(result.reason, 'stale')
      assert.equal(result.fallback, 'read-full')
    } finally {
      fs.rmSync(contentFile, { force: true })
      cleanup(projectId)
    }
  })

  await t.test('returns missing + read-full fallback when handoff file is absent', () => {
    const { projectId } = setupSandboxState({ status: 'running', haltReason: null })
    try {
      const result = cmdReadHandoff({ from: 'spec', projectId, projectRoot: null })
      assert.equal(result.fresh, false)
      assert.equal(result.reason, 'missing')
      assert.equal(result.fallback, 'read-full')
    } finally {
      cleanup(projectId)
    }
  })
})

test('cmdSetContractDigestPath', async (t) => {
  await t.test('writes contract_digest_path on running workflow', () => {
    const { projectId, statePath } = setupSandboxState({ status: 'running', haltReason: null })
    try {
      const result = cmdSetContractDigestPath('~/.claude/workflows/x/digests/contract-0525.md', projectId, null)
      assert.equal(result.updated, true)
      assert.equal(result.contract_digest_path, '~/.claude/workflows/x/digests/contract-0525.md')
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(state.contract_digest_path, '~/.claude/workflows/x/digests/contract-0525.md')
    } finally {
      cleanup(projectId)
    }
  })

  await t.test('unset clears contract_digest_path', () => {
    const { projectId, statePath } = setupSandboxState({ status: 'running', haltReason: null, contractDigestPath: '/tmp/d.md' })
    try {
      const result = cmdSetContractDigestPath(null, projectId, null, { unset: true })
      assert.equal(result.updated, true)
      assert.equal(result.contract_digest_path, null)
      assert.equal(result.previous_value, '/tmp/d.md')
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(state.contract_digest_path, null)
    } finally {
      cleanup(projectId)
    }
  })

  await t.test('rejects empty path without --unset', () => {
    const { projectId } = setupSandboxState({ status: 'running', haltReason: null })
    try {
      const result = cmdSetContractDigestPath('', projectId, null)
      assert.equal(result.error != null, true)
    } finally {
      cleanup(projectId)
    }
  })
})

test('resolveHelpRequest', async (t) => {
  const help = (argv) => resolveHelpRequest(argv)

  await t.test('command-pos --help/-h → top-level help', () => {
    assert.deepEqual(help(['--help']), { command: null })
    assert.deepEqual(help(['-h']), { command: null })
    assert.deepEqual(help(['--project-id', 'X', '--help']), { command: null })
  })

  await t.test('--help immediately after command → that subcommand help', () => {
    assert.deepEqual(help(['plan-edit', '--help']), { command: 'plan-edit' })
    assert.deepEqual(help(['advance', '-h']), { command: 'advance' })
    assert.deepEqual(help(['--project-id', 'X', 'journal', '--help']), { command: 'journal' })
  })

  await t.test('trailing --help after a positional → NOT help (runs command)', () => {
    // 回归：`advance T1 --help` 不得被劫持成 help → 否则 T1 静默不推进
    assert.equal(help(['advance', 'T1', '--help']), null)
    assert.equal(help(['journal', 'search', '--help']), null)
    assert.equal(help(['journal', 'search', '-h']), null)
    assert.equal(help(['set-contract-digest-path', '/tmp/x.md', '--help']), null)
  })

  await t.test('--help as a flag value → NOT help (documented suppression)', () => {
    assert.equal(help(['set-contract-digest-path', '--path', '--help']), null)
    assert.equal(help(['--project-id', '--help']), null)
  })

  await t.test('no --help anywhere → null', () => {
    assert.equal(help([]), null)
    assert.equal(help(['plan-edit', '--anchor', 'tasks']), null)
  })
})
