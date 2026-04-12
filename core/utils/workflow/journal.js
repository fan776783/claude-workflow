#!/usr/bin/env node
/**
 * @file 工作流日志管理 - 提供会话记录的增删查改，支持按项目隔离存储
 */

const fs = require('fs')
const path = require('path')
const { detectProjectIdFromRoot, getWorkflowsDir } = require('./path_utils')

/** 单个索引文件中保留的最大会话数 */
const MAX_SESSIONS_PER_INDEX = 100

/**
 * 获取指定项目的日志存储目录路径
 * @param {string} projectId - 项目 ID
 * @returns {string} 日志目录绝对路径
 */
function getJournalDir(projectId) {
  const workflowsDir = getWorkflowsDir(projectId)
  if (!workflowsDir) throw new Error(`invalid project id: ${projectId}`)
  return path.join(workflowsDir, 'journal')
}

/**
 * 读取日志索引文件，不存在时返回空索引结构
 * @param {string} journalDir - 日志目录路径
 * @returns {Object} 索引对象，包含 version、total_sessions、sessions 等字段
 */
function readIndex(journalDir) {
  const indexPath = path.join(journalDir, 'index.json')
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    } catch {}
  }
  return { version: '1.0', total_sessions: 0, last_updated: null, sessions: [] }
}

/**
 * 将索引对象写入日志目录，自动更新 last_updated 时间戳
 * @param {string} journalDir - 日志目录路径
 * @param {Object} index - 索引对象
 */
function writeIndex(journalDir, index) {
  fs.mkdirSync(journalDir, { recursive: true })
  index.last_updated = new Date().toISOString()
  fs.writeFileSync(path.join(journalDir, 'index.json'), JSON.stringify(index, null, 2))
}

/**
 * 将单个会话数据写入 sessions 子目录的 JSON 文件
 * @param {string} journalDir - 日志目录路径
 * @param {number} sessionId - 会话 ID
 * @param {Object} data - 会话数据对象
 * @returns {string} 写入的文件名
 */
function writeSession(journalDir, sessionId, data) {
  const sessionsDir = path.join(journalDir, 'sessions')
  fs.mkdirSync(sessionsDir, { recursive: true })
  const filename = `session-${String(sessionId).padStart(3, '0')}.json`
  fs.writeFileSync(path.join(sessionsDir, filename), JSON.stringify(data, null, 2))
  return filename
}

/**
 * 添加一条新的会话记录到日志
 * @param {string} projectId - 项目 ID
 * @param {string} title - 会话标题
 * @param {string|null} workflowId - 关联的工作流 ID
 * @param {string[]} tasksCompleted - 已完成的任务 ID 列表
 * @param {string|null} summary - 会话摘要
 * @param {string[]} decisions - 决策记录列表
 * @param {string[]} nextSteps - 后续步骤列表
 * @returns {{added: boolean, session_id: number, file: string}} 添加结果
 */
function cmdAdd(projectId, title, workflowId = null, tasksCompleted = [], summary = null, decisions = [], nextSteps = []) {
  const journalDir = getJournalDir(projectId)
  const index = readIndex(journalDir)
  const sessionId = Number(index.total_sessions || 0) + 1
  const sessionData = {
    id: sessionId,
    title,
    date: new Date().toISOString(),
    workflow_id: workflowId,
    tasks_completed: tasksCompleted || [],
    summary: summary || '',
    decisions: decisions || [],
    next_steps: nextSteps || [],
  }
  const filename = writeSession(journalDir, sessionId, sessionData)
  index.total_sessions = sessionId
  index.sessions.push({
    id: sessionId,
    title,
    date: sessionData.date,
    file: filename,
    workflow_id: workflowId,
    tasks_count: (tasksCompleted || []).length,
  })
  if (index.sessions.length > MAX_SESSIONS_PER_INDEX) index.sessions = index.sessions.slice(-MAX_SESSIONS_PER_INDEX)
  writeIndex(journalDir, index)
  return { added: true, session_id: sessionId, file: filename }
}

/**
 * 列出最近的会话记录
 * @param {string} projectId - 项目 ID
 * @param {number} limit - 返回的最大条数（默认 20）
 * @returns {{total: number, showing: number, sessions: Object[]}} 会话列表
 */
function cmdList(projectId, limit = 20) {
  const index = readIndex(getJournalDir(projectId))
  const recent = [...(index.sessions || [])].slice(-limit).reverse()
  return { total: index.total_sessions || 0, showing: recent.length, sessions: recent }
}

/**
 * 按关键词搜索会话记录
 * @param {string} projectId - 项目 ID
 * @param {string} keyword - 搜索关键词
 * @returns {{matches: Object[], count: number, keyword: string}} 匹配结果
 */
function cmdSearch(projectId, keyword) {
  const sessionsDir = path.join(getJournalDir(projectId), 'sessions')
  if (!fs.existsSync(sessionsDir)) return { matches: [], count: 0 }
  const keywordLower = String(keyword || '').toLowerCase()
  const matches = []
  for (const file of fs.readdirSync(sessionsDir).filter((entry) => entry.startsWith('session-')).sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'))
      if (JSON.stringify(data).toLowerCase().includes(keywordLower)) {
        matches.push({ id: data.id, title: data.title, date: data.date, summary: String(data.summary || '').slice(0, 200) })
      }
    } catch {}
  }
  return { matches, count: matches.length, keyword }
}

/**
 * 获取指定 ID 的会话详情
 * @param {string} projectId - 项目 ID
 * @param {number} sessionId - 会话 ID
 * @returns {Object} 会话数据对象，不存在时返回 error 字段
 */
function cmdGet(projectId, sessionId) {
  const filepath = path.join(getJournalDir(projectId), 'sessions', `session-${String(sessionId).padStart(3, '0')}.json`)
  if (!fs.existsSync(filepath)) return { error: `Session ${sessionId} not found` }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'))
}

/**
 * 从项目根目录检测项目 ID
 * @param {string} projectRoot - 项目根目录路径
 * @returns {string|null} 项目 ID
 */
function detectProjectId(projectRoot) {
  return detectProjectIdFromRoot(projectRoot)
}

function main() {
  const args = [...process.argv.slice(2)]
  let projectId = null
  const projectIndex = args.indexOf('--project-id')
  if (projectIndex >= 0) {
    projectId = args[projectIndex + 1]
    args.splice(projectIndex, 2)
  }
  const command = args.shift()
  projectId = projectId || detectProjectId()
  if (!projectId) {
    process.stdout.write(`${JSON.stringify({ error: '无法检测项目 ID，请使用 --project-id 指定' })}\n`)
    process.exitCode = 1
    return
  }
  const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : ''
  }
  let result
  if (command === 'add') result = cmdAdd(projectId, option('--title'), option('--workflow-id') || null, split(option('--tasks-completed')), option('--summary') || null, split(option('--decisions')), split(option('--next-steps')))
  else if (command === 'list') result = cmdList(projectId, Number(option('--limit') || 20))
  else if (command === 'search') result = cmdSearch(projectId, args[0])
  else if (command === 'get') result = cmdGet(projectId, Number(args[0]))
  else {
    process.stderr.write('Usage: node journal.js [--project-id ID] <add|list|search|get> ...\n')
    process.exitCode = 1
    return
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

module.exports = {
  MAX_SESSIONS_PER_INDEX,
  getJournalDir,
  readIndex,
  writeIndex,
  writeSession,
  cmdAdd,
  cmdList,
  cmdSearch,
  cmdGet,
  detectProjectId,
}

if (require.main === module) main()
