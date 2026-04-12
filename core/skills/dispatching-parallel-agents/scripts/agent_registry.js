#!/usr/bin/env node

/** 并行 agent 注册表管理 —— 负责 agent 的注册、状态更新、查询和分组管理 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const REGISTRY_FILENAME = 'agent-registry.json'

/**
 * 返回当前时间的 ISO 格式字符串
 * @returns {string} ISO 时间戳
 */
function nowIso() {
  return new Date().toISOString()
}

/**
 * 获取注册表文件的绝对路径
 * @param {string|null} projectRoot - 项目根目录，默认使用 cwd
 * @returns {string} 注册表 JSON 文件路径
 */
function getRegistryPath(projectRoot = null) {
  const root = projectRoot || process.cwd()
  return path.join(root, '.claude', 'config', REGISTRY_FILENAME)
}

/**
 * 读取并解析注册表文件，文件不存在时返回空注册表
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 注册表对象，包含 agents 和 groups
 */
function readRegistry(projectRoot = null) {
  const filePath = getRegistryPath(projectRoot)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch {
    }
  }
  return { version: '1.0', agents: {}, groups: {} }
}

/**
 * 将注册表对象写入磁盘，自动更新 updated_at 时间戳
 * @param {object} registry - 注册表对象
 * @param {string|null} projectRoot - 项目根目录
 */
function writeRegistry(registry, projectRoot = null) {
  const filePath = getRegistryPath(projectRoot)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  registry.updated_at = nowIso()
  fs.writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
}

/**
 * 注册一个新的 agent 并写入注册表，同时维护所属 group 的成员列表
 * @param {string} taskId - 任务 ID
 * @param {string|null} worktreePath - worktree 路径（只读任务可为 null）
 * @param {string} boundary - 边界类型
 * @param {string} platform - 运行平台
 * @param {string|null} groupId - 所属分组 ID
 * @param {string|null} agentId - 自定义 agent ID，不传则自动生成
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 新注册的 agent 条目
 */
function registerAgent(taskId, worktreePath = null, boundary = 'auto', platform = 'claude-code', groupId = null, agentId = null, projectRoot = null) {
  const registry = readRegistry(projectRoot)
  const aid = agentId || `agent-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  const timestamp = nowIso()

  const entry = {
    agent_id: aid,
    task_id: taskId,
    boundary,
    platform,
    worktree_path: worktreePath,
    group_id: groupId,
    status: 'registered',
    created_at: timestamp,
    updated_at: timestamp,
    exit_code: null,
    output_summary: null,
  }

  registry.agents[aid] = entry

  if (groupId) {
    const groups = registry.groups || (registry.groups = {})
    const group = groups[groupId] || (groups[groupId] = {
      group_id: groupId,
      agent_ids: [],
      status: 'running',
      created_at: timestamp,
      conflict_detected: false,
    })
    if (!group.agent_ids.includes(aid)) group.agent_ids.push(aid)
  }

  writeRegistry(registry, projectRoot)
  return entry
}

/**
 * 更新指定 agent 的状态，并在所有成员完成时自动更新 group 状态
 * @param {string} agentId - agent ID
 * @param {string} status - 新状态（如 running / completed / failed）
 * @param {number|null} exitCode - 退出码
 * @param {string|null} outputSummary - 输出摘要（截断至 500 字符）
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 更新后的 agent 条目，或包含 error 的对象
 */
function updateAgentStatus(agentId, status, exitCode = null, outputSummary = null, projectRoot = null) {
  const registry = readRegistry(projectRoot)
  const agent = registry.agents?.[agentId]
  if (!agent) return { error: `Agent ${agentId} not found` }

  agent.status = status
  agent.updated_at = nowIso()
  if (exitCode !== null && exitCode !== undefined) agent.exit_code = exitCode
  if (outputSummary !== null && outputSummary !== undefined) agent.output_summary = String(outputSummary).slice(0, 500)

  const groupId = agent.group_id
  if (groupId && registry.groups?.[groupId]) {
    const group = registry.groups[groupId]
    const allAgents = (group.agent_ids || []).map((aid) => registry.agents?.[aid]).filter(Boolean)
    if (allAgents.length > 0 && allAgents.every((entry) => entry.status === 'completed' || entry.status === 'failed')) {
      group.status = allAgents.some((entry) => entry.status === 'failed') ? 'failed' : 'completed'
    }
  }

  writeRegistry(registry, projectRoot)
  return agent
}

/**
 * 列出注册表中的 agent，支持按状态和分组过滤
 * @param {string|null} statusFilter - 状态过滤条件
 * @param {string|null} groupFilter - 分组过滤条件
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object[]} 符合条件的 agent 列表
 */
function listAgents(statusFilter = null, groupFilter = null, projectRoot = null) {
  let agents = Object.values(readRegistry(projectRoot).agents || {})
  if (statusFilter) agents = agents.filter((agent) => agent.status === statusFilter)
  if (groupFilter) agents = agents.filter((agent) => agent.group_id === groupFilter)
  return agents
}

/**
 * 根据 ID 获取单个 agent 条目
 * @param {string} agentId - agent ID
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object|null} agent 条目，不存在时返回 null
 */
function getAgent(agentId, projectRoot = null) {
  return readRegistry(projectRoot).agents?.[agentId] || null
}

/**
 * 从注册表中移除指定 agent，同时清理其所属 group 的引用
 * @param {string} agentId - agent ID
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 移除结果或错误信息
 */
function removeAgent(agentId, projectRoot = null) {
  const registry = readRegistry(projectRoot)
  const agent = registry.agents?.[agentId]
  if (!agent) return { error: `Agent ${agentId} not found` }

  delete registry.agents[agentId]

  const groupId = agent.group_id
  if (groupId && registry.groups?.[groupId]) {
    const group = registry.groups[groupId]
    group.agent_ids = (group.agent_ids || []).filter((id) => id !== agentId)
    if (group.agent_ids.length === 0) delete registry.groups[groupId]
  }

  writeRegistry(registry, projectRoot)
  return { removed: true, agent_id: agentId }
}

/**
 * 获取指定分组的状态摘要，包含各状态的 agent 计数
 * @param {string} groupId - 分组 ID
 * @param {string|null} projectRoot - 项目根目录
 * @returns {object} 分组状态，含 agents 列表和各状态计数
 */
function getGroupStatus(groupId, projectRoot = null) {
  const registry = readRegistry(projectRoot)
  const group = registry.groups?.[groupId]
  if (!group) return { error: `Group ${groupId} not found` }

  const agents = (group.agent_ids || []).map((aid) => registry.agents?.[aid]).filter(Boolean)
  return {
    ...group,
    agents,
    completed_count: agents.filter((agent) => agent.status === 'completed').length,
    failed_count: agents.filter((agent) => agent.status === 'failed').length,
    running_count: agents.filter((agent) => agent.status === 'running').length,
  }
}

function parseOption(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
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
  let result

  if (!command) {
    process.stderr.write('Usage: node agent_registry.js <register|update|list|status|remove> ...\n')
    process.exitCode = 1
    return
  }

  if (command === 'register' && !hasFlag(args, '--task-id')) {
    process.stderr.write('Missing required arguments\n')
    process.exitCode = 1
    return
  }

  if (command === 'update' && (!hasFlag(args, '--agent-id') || !hasFlag(args, '--status'))) {
    process.stderr.write('Missing required arguments\n')
    process.exitCode = 1
    return
  }

  if (command === 'remove' && !hasFlag(args, '--agent-id')) {
    process.stderr.write('Missing required arguments\n')
    process.exitCode = 1
    return
  }

  if (command === 'register') {
    result = registerAgent(
      parseOption(args, '--task-id'),
      parseOption(args, '--worktree'),
      parseOption(args, '--boundary') || 'auto',
      parseOption(args, '--platform') || 'claude-code',
      parseOption(args, '--group-id'),
      parseOption(args, '--agent-id'),
    )
  } else if (command === 'update') {
    const exitCodeValue = parseOption(args, '--exit-code')
    result = updateAgentStatus(
      parseOption(args, '--agent-id'),
      parseOption(args, '--status'),
      exitCodeValue == null ? null : Number(exitCodeValue),
      parseOption(args, '--output'),
    )
  } else if (command === 'list') {
    const agents = listAgents(parseOption(args, '--status'), parseOption(args, '--group'))
    result = { agents, count: agents.length }
  } else if (command === 'status') {
    const groupId = parseOption(args, '--group-id')
    const agentId = parseOption(args, '--agent-id')
    if (groupId) {
      result = getGroupStatus(groupId)
    } else if (agentId) {
      result = getAgent(agentId) || { error: `Agent ${agentId} not found` }
    } else {
      const agents = listAgents()
      result = {
        total: agents.length,
        running: agents.filter((agent) => agent.status === 'running').length,
        completed: agents.filter((agent) => agent.status === 'completed').length,
        failed: agents.filter((agent) => agent.status === 'failed').length,
      }
    }
  } else if (command === 'remove') {
    result = removeAgent(parseOption(args, '--agent-id'))
  } else {
    process.stderr.write('Usage: node agent_registry.js <register|update|list|status|remove> ...\n')
    process.exitCode = 1
    return
  }

  printJson(result)
}

const _get_registry_path = getRegistryPath
const read_registry = readRegistry
const write_registry = writeRegistry
const register_agent = registerAgent
const update_agent_status = updateAgentStatus
const list_agents = listAgents
const get_agent = getAgent
const remove_agent = removeAgent
const get_group_status = getGroupStatus

module.exports = {
  REGISTRY_FILENAME,
  getRegistryPath,
  readRegistry,
  writeRegistry,
  registerAgent,
  updateAgentStatus,
  listAgents,
  getAgent,
  removeAgent,
  getGroupStatus,
  _get_registry_path,
  read_registry,
  write_registry,
  register_agent,
  update_agent_status,
  list_agents,
  get_agent,
  remove_agent,
  get_group_status,
}

if (require.main === module) main()
