const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { canEnterPhase, getPhaseTransitionReason, inferTeamPhase } = require('../core/utils/team/phase-controller')

describe('canEnterPhase', () => {
  const emptyBoard = []
  const validBoard = [
    { id: 'B1', phase: 'implement', status: 'pending' },
    { id: 'B2', phase: 'implement', status: 'pending' },
  ]
  const completedBoard = [
    { id: 'B1', phase: 'implement', status: 'completed' },
    { id: 'B2', phase: 'implement', status: 'completed' },
  ]
  const failedBoard = [
    { id: 'B1', phase: 'implement', status: 'completed' },
    { id: 'B2', phase: 'implement', status: 'failed' },
  ]
  const activePlanningBoard = [
    { id: 'B1', phase: 'planning', status: 'pending' },
  ]

  it('team-exec: empty board returns empty_board', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: true }] }, emptyBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'empty_board')
  })

  it('team-exec: no writable worker returns no_writable_worker', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: false }] }, validBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no_writable_worker')
  })

  it('team-exec: planning not complete returns planning_not_complete', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: true }] }, activePlanningBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'planning_not_complete')
  })

  it('team-exec: valid state returns ok', () => {
    const result = canEnterPhase('team-exec', { worker_roster: [{ writable: true }] }, validBoard)
    assert.equal(result.ok, true)
  })

  it('team-verify: active boundaries returns active_boundaries', () => {
    const result = canEnterPhase('team-verify', {}, validBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'active_boundaries')
  })

  it('team-verify: failed boundaries returns has_failed_boundaries', () => {
    const result = canEnterPhase('team-verify', {}, failedBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'has_failed_boundaries')
  })

  it('team-verify: all completed returns ok', () => {
    const result = canEnterPhase('team-verify', {}, completedBoard)
    assert.equal(result.ok, true)
  })

  it('team-fix: no failed boundaries returns no_failed_boundaries', () => {
    const result = canEnterPhase('team-fix', {}, completedBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no_failed_boundaries')
  })

  it('team-fix: has failed boundaries returns ok', () => {
    const result = canEnterPhase('team-fix', {}, failedBoard)
    assert.equal(result.ok, true)
  })

  it('invalid phase returns invalid_phase', () => {
    const result = canEnterPhase('bogus-phase', {}, validBoard)
    assert.equal(result.ok, false)
    assert.match(result.reason, /invalid_phase/)
  })

  it('terminal phase returns target_is_terminal', () => {
    const result = canEnterPhase('completed', {}, validBoard)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'target_is_terminal')
  })
})

describe('getPhaseTransitionReason', () => {
  it('team-exec with all implement completed returns team-verify', () => {
    const board = [{ id: 'B1', phase: 'implement', status: 'completed' }]
    const result = getPhaseTransitionReason(board, 'team-exec')
    assert.equal(result.next_phase, 'team-verify')
    assert.equal(result.reason, 'all_boundaries_completed')
  })

  it('team-exec with active implement returns team-exec', () => {
    const board = [{ id: 'B1', phase: 'implement', status: 'in_progress' }]
    const result = getPhaseTransitionReason(board, 'team-exec')
    assert.equal(result.next_phase, 'team-exec')
    assert.equal(result.reason, 'implement_in_progress')
  })

  it('team-exec with failed implement returns team-fix', () => {
    const board = [{ id: 'B1', phase: 'implement', status: 'failed' }]
    const result = getPhaseTransitionReason(board, 'team-exec')
    assert.equal(result.next_phase, 'team-fix')
    assert.equal(result.reason, 'implement_failures_detected')
  })

  it('team-plan with active planning returns team-plan', () => {
    const board = [{ id: 'B1', phase: 'planning', status: 'pending' }]
    const result = getPhaseTransitionReason(board, 'team-plan')
    assert.equal(result.next_phase, 'team-plan')
    assert.equal(result.reason, 'planning_in_progress')
  })

  it('team-plan with completed planning returns team-exec', () => {
    const board = [{ id: 'B1', phase: 'planning', status: 'completed' }]
    const result = getPhaseTransitionReason(board, 'team-plan')
    assert.equal(result.next_phase, 'team-exec')
    assert.equal(result.reason, 'planning_completed')
  })

  it('team-fix with active fix returns team-fix', () => {
    const board = [{ id: 'B1', phase: 'fix', status: 'in_progress' }]
    const result = getPhaseTransitionReason(board, 'team-fix')
    assert.equal(result.next_phase, 'team-fix')
    assert.equal(result.reason, 'fix_in_progress')
  })

  it('team-fix with completed fix returns team-verify', () => {
    const board = [{ id: 'B1', phase: 'fix', status: 'completed' }]
    const result = getPhaseTransitionReason(board, 'team-fix')
    assert.equal(result.next_phase, 'team-verify')
    assert.equal(result.reason, 'fixes_completed')
  })

  it('terminal phase returns itself', () => {
    const result = getPhaseTransitionReason([], 'completed')
    assert.equal(result.next_phase, 'completed')
    assert.equal(result.reason, 'terminal_phase')
  })

  it('invalid phase returns failed', () => {
    const result = getPhaseTransitionReason([], 'bogus')
    assert.equal(result.next_phase, 'failed')
    assert.match(result.reason, /invalid_phase/)
  })
})

describe('inferTeamPhase enhanced', () => {
  it('invalid phase still returns failed string (backward compat)', () => {
    const result = inferTeamPhase([], 'bogus-phase')
    assert.equal(result, 'failed')
  })
})
