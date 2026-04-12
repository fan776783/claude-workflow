#!/usr/bin/env node

/** 并行分派结果收集器 —— 负责冲突检测、聚合验证和分组结果汇总 */

const { spawnSync } = require('child_process')
const { readRegistry, writeRegistry, getGroupStatus } = require('./agent_registry')

/**
 * 检测 agent 对应 worktree 的当前分支名
 * @param {object} agent - agent 条目（需含 worktree_path）
 * @returns {string|null} 分支名，无法检测时返回 null
 */
function detectBranchForAgent(agent) {
  const worktreePath = agent.worktree_path
  if (!worktreePath) return null

  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  if (result.status !== 0) return null
  const branch = String(result.stdout || '').trim()
  if (!branch || branch === 'HEAD') return null
  return branch
}

/**
 * 使用 git merge-tree 检查指定分支与 HEAD 的合并兼容性
 * @param {string} root - 仓库根目录
 * @param {string} branch - 待检查的分支名
 * @returns {object} 包含 ok（是否无冲突）、stderr、stdout
 */
function checkMergeCompatibility(root, branch) {
  const result = spawnSync('git', ['merge-tree', '--write-tree', '--quiet', 'HEAD', branch], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  return {
    ok: result.status === 0,
    stderr: String(result.stderr || '').trim(),
    stdout: String(result.stdout || '').trim(),
  }
}

/**
 * 检测指定分组中已完成 agent 的合并冲突，有冲突时标记 group 并建议顺序降级
 * @param {string} groupId - 分组 ID
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 冲突检测结果，含 has_conflicts、conflicts 列表和建议
 */
function detectMergeConflicts(groupId, projectRoot = null) {
  const root = projectRoot || process.cwd()
  const registry = readRegistry(root)
  const group = registry.groups?.[groupId]
  if (!group) return { error: `Group ${groupId} not found` }

  const agents = (group.agent_ids || []).map((agentId) => registry.agents?.[agentId]).filter(Boolean)
  const conflicts = []
  const cleanMerges = []

  for (const agent of agents) {
    if (agent.status !== 'completed') continue

    const branch = detectBranchForAgent(agent)
    if (!branch) {
      cleanMerges.push(agent.task_id)
      continue
    }

    const result = checkMergeCompatibility(root, branch)
    if (!result.ok) {
      conflicts.push({
        task_id: agent.task_id,
        agent_id: agent.agent_id,
        branch,
        error: (result.stderr || result.error || '').slice(0, 300),
      })
    } else {
      cleanMerges.push(agent.task_id)
    }
  }

  const hasConflicts = conflicts.length > 0
  if (hasConflicts) {
    group.conflict_detected = true
    writeRegistry(registry, root)
  }

  return {
    group_id: groupId,
    has_conflicts: hasConflicts,
    conflicts,
    clean_merges: cleanMerges,
    recommendation: hasConflicts ? 'sequential_fallback' : 'merge_all',
  }
}

/**
 * 在指定目录下依次执行验证命令，收集每条命令的通过状态和输出
 * @param {string[]} commands - 待执行的 shell 命令列表
 * @param {string|null} cwd - 工作目录
 * @param {number} timeout - 单条命令超时秒数
 * @returns {object[]} 每条命令的执行结果（含 passed、exit_code、output）
 */
function runAggregateVerification(commands, cwd = null, timeout = 120) {
  const root = cwd || process.cwd()
  const results = []

  for (const command of commands || []) {
    const result = spawnSync(command, [], {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      timeout: timeout * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })

    if (result.error && result.error.code === 'ETIMEDOUT') {
      results.push({
        command,
        exit_code: -1,
        passed: false,
        output: `Timeout after ${timeout}s`,
      })
      continue
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`.slice(0, 500)
    results.push({
      command,
      exit_code: typeof result.status === 'number' ? result.status : -1,
      passed: result.status === 0,
      output,
    })
  }

  return results
}

/**
 * 汇总指定分组的执行结果：统计完成/失败/运行中数量，检测冲突，运行验证命令
 * @param {string} groupId - 分组 ID
 * @param {string[]|null} verificationCommands - 聚合验证命令列表
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 汇总结果，含状态、冲突信息、验证结果和建议
 */
function collectGroupResults(groupId, verificationCommands = null, projectRoot = null) {
  const root = projectRoot || process.cwd()
  const groupStatus = getGroupStatus(groupId, root)
  if (groupStatus.error) return groupStatus

  const agents = groupStatus.agents || []
  const completed = agents.filter((agent) => agent?.status === 'completed')
  const failed = agents.filter((agent) => agent?.status === 'failed')
  const stillRunning = agents.filter((agent) => agent?.status === 'running')

  const result = {
    group_id: groupId,
    total_agents: agents.length,
    completed: completed.length,
    failed: failed.length,
    still_running: stillRunning.length,
    completed_tasks: completed.map((agent) => agent.task_id),
    failed_tasks: failed.map((agent) => ({ task_id: agent.task_id, output: agent.output_summary || '' })),
  }

  if (stillRunning.length > 0) {
    result.status = 'partial'
    result.waiting_for = stillRunning.map((agent) => agent.task_id)
    return result
  }

  const conflictResult = detectMergeConflicts(groupId, root)
  result.conflicts = conflictResult

  if (verificationCommands) {
    const verification = runAggregateVerification(verificationCommands, root)
    result.verification = verification
    result.all_verified = verification.every((item) => item.passed)
  } else {
    result.all_verified = true
  }

  if (conflictResult.has_conflicts) {
    result.status = 'conflict'
    result.recommendation = 'sequential_fallback'
  } else if (failed.length > 0) {
    result.status = 'partial_failure'
    result.recommendation = 'continue_with_failures'
  } else {
    result.status = 'success'
    result.recommendation = 'merge_all'
  }

  result.collected_at = new Date().toISOString()
  return result
}

function parseOption(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function collectVerifyValues(args) {
  const index = args.indexOf('--verify')
  if (index < 0) return undefined
  const values = []
  for (let i = index + 1; i < args.length; i += 1) {
    if (args[i].startsWith('--')) break
    values.push(args[i])
  }
  return values
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function main() {
  const args = process.argv.slice(2)
  const command = args.shift()

  if (command === 'collect') {
    if (!hasFlag(args, '--group-id')) {
      process.stderr.write('Missing required arguments\n')
      process.exitCode = 1
      return
    }
    printJson(collectGroupResults(parseOption(args, '--group-id'), collectVerifyValues(args)))
    return
  }

  if (command === 'check-conflicts') {
    if (!hasFlag(args, '--group-id')) {
      process.stderr.write('Missing required arguments\n')
      process.exitCode = 1
      return
    }
    printJson(detectMergeConflicts(parseOption(args, '--group-id')))
    return
  }

  process.stderr.write('Usage: node result_collector.js <collect|check-conflicts> ...\n')
  process.exitCode = 1
}

const _detect_branch_for_agent = detectBranchForAgent
const _check_merge_compatibility = checkMergeCompatibility
const detect_merge_conflicts = detectMergeConflicts
const run_aggregate_verification = runAggregateVerification
const collect_group_results = collectGroupResults

module.exports = {
  detectBranchForAgent,
  checkMergeCompatibility,
  detectMergeConflicts,
  runAggregateVerification,
  collectGroupResults,
  _detect_branch_for_agent,
  _check_merge_compatibility,
  detect_merge_conflicts,
  run_aggregate_verification,
  collect_group_results,
}

if (require.main === module) main()
