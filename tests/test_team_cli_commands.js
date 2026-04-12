const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const CLI_PATH = path.resolve(__dirname, '../core/utils/team/team-cli.js')

function runCli(args) {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8', timeout: 10000 })
    return { exitCode: 0, stdout, parsed: JSON.parse(stdout) }
  } catch (err) {
    return { exitCode: err.status || 1, stderr: err.stderr || '', stdout: err.stdout || '' }
  }
}

describe('team-cli context/next/advance', () => {
  const projectId = 'test-cli-cmds'
  const teamId = 'test-team-1'
  const teamsDir = path.join(os.homedir(), '.claude', 'workflows', projectId, 'teams', teamId)
  const statePath = path.join(teamsDir, 'team-state.json')
  const boardPath = path.join(teamsDir, 'team-task-board.json')

  before(() => {
    fs.mkdirSync(teamsDir, { recursive: true })
    const state = {
      project_id: projectId,
      team_id: teamId,
      team_name: 'test-team',
      status: 'running',
      team_phase: 'team-exec',
      spec_file: '.claude/specs/test.md',
      plan_file: '.claude/plans/test.md',
      team_tasks_file: boardPath,
      current_tasks: ['B1'],
      worker_roster: [
        { worker_id: 'orchestrator-1', role: 'orchestrator', writable: false, status: 'running' },
        { worker_id: 'implementer-1', role: 'implementer', writable: true, status: 'idle' },
      ],
      team_review: { overall_passed: false, reviewed_at: null, notes: [] },
      fix_loop: { attempt: 0, current_failed_boundaries: [] },
      progress: { completed: [], failed: [], skipped: [], blocked: [] },
      activation: { mode: 'explicit-team-command', entry: 'team', auto_trigger_allowed: false },
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    const board = [
      { id: 'B1', phase: 'implement', status: 'completed', lifecycle: { run_state: 'verified', attempt: 0, last_transition_at: new Date().toISOString() } },
      { id: 'B2', phase: 'implement', status: 'pending', blocked_by: [] },
      { id: 'B3', phase: 'implement', status: 'pending', blocked_by: ['B2'] },
    ]
    fs.writeFileSync(boardPath, JSON.stringify(board, null, 2))
  })

  after(() => {
    fs.rmSync(path.join(os.homedir(), '.claude', 'workflows', projectId), { recursive: true, force: true })
  })

  it('context returns valid JSON with expected fields', () => {
    const { exitCode, parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'context'])
    assert.equal(exitCode, 0)
    assert.ok(parsed.team_phase)
    assert.ok(parsed.board_summary)
    assert.ok(parsed.governance_signals !== undefined)
    assert.ok(parsed.team_review !== undefined)
  })

  it('context board_summary has correct totals', () => {
    const { parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'context'])
    assert.equal(parsed.board_summary.total, 3)
    assert.equal(parsed.board_summary.completed, 1)
    assert.equal(parsed.board_summary.pending, 2)
  })

  it('next returns available boundary', () => {
    const { exitCode, parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'next'])
    assert.equal(exitCode, 0)
    assert.equal(parsed.boundary_id, 'B2')
    assert.equal(parsed.claimable_role, 'implementer')
    assert.equal(parsed.dependencies_met, true)
  })

  it('advance B2 succeeds', () => {
    const { exitCode, parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'advance', 'B2'])
    assert.equal(exitCode, 0)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.advanced_boundary, 'B2')
    assert.equal(parsed.board_updated, true)
    assert.equal(parsed.state_updated, true)
  })

  it('after advance B2, next returns null (B3 blocked by B2 in metadata)', () => {
    const { parsed } = runCli(['--project-id', projectId, '--team-id', teamId, 'next'])
    // B3 has blocked_by: ['B2'] in its metadata, so it's not in available_claims
    // The next command correctly returns null since no unblocked boundaries remain
    assert.equal(parsed.boundary_id, null)
  })

  it('context with no runtime returns error', () => {
    const { exitCode } = runCli(['--project-id', 'nonexistent', '--team-id', 'nope', 'context'])
    assert.equal(exitCode, 1)
  })

  it('next with no runtime returns error', () => {
    const { exitCode } = runCli(['--project-id', 'nonexistent', '--team-id', 'nope', 'next'])
    assert.equal(exitCode, 1)
  })
})
