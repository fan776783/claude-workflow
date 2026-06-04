#!/usr/bin/env node
/**
 * @file 工作流日志管理 - 提供会话记录的增删查改，支持按项目隔离存储
 */

const fs = require('fs')
const path = require('path')
const { detectProjectIdFromRoot, getWorkflowsDir } = require('./path_utils')

/** 单个索引文件中保留的最大会话数 */
const MAX_SESSIONS_PER_INDEX = 100

/** T6 证据摘要协议：session 摘要必须为结构化对象，含以下 4 字段。 */
const EVIDENCE_FIELDS = ['commands_run', 'diff_summary', 'coverage_evidence', 'unverified_items']

/** 缺字段时回显的填写模板（错误信息附带，让上游一次补齐）。 */
const EVIDENCE_TEMPLATE = Object.freeze({
  commands_run: ['例如：pnpm lint', 'pnpm test'],
  diff_summary: '简述本次 diff 范围（改了哪些文件/模块）',
  coverage_evidence: '覆盖的 R-XX / Acceptance Criteria 锚点',
  unverified_items: ['未在浏览器手动验证 / 等待联调的功能点'],
})

// 单一契约：string summary 包装成 evidence 最小结构（与 advance --journal 路径同形），
// `journal add --summary "string"` 与 `advance --journal "string"` 行为一致，不再 hard-reject。
function wrapStringSummary(summary) {
  if (typeof summary !== 'string' || summary === '') return summary
  return { commands_run: [], diff_summary: summary, coverage_evidence: '', unverified_items: [] }
}

function validateEvidenceSummary(summary) {
  if (summary == null || summary === '') return { valid: false, errors: ['evidence summary is required'], reason: 'missing' }
  if (typeof summary !== 'object' || Array.isArray(summary)) {
    return { valid: false, errors: [`summary must be a JSON object, got ${Array.isArray(summary) ? 'array' : typeof summary}`], reason: 'wrong_type' }
  }
  const errors = []
  for (const field of EVIDENCE_FIELDS) {
    if (!(field in summary)) { errors.push(`missing field: ${field}`); continue }
    if (field === 'commands_run' || field === 'unverified_items') {
      if (!Array.isArray(summary[field])) errors.push(`${field} must be array`)
    } else {
      if (typeof summary[field] !== 'string') errors.push(`${field} must be string`)
    }
  }
  return { valid: errors.length === 0, errors, reason: errors.length === 0 ? 'ok' : 'incomplete' }
}

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
function cmdAdd(projectId, title, workflowId = null, tasksCompleted = [], rawSummary = null, decisions = [], nextSteps = []) {
  // T6 校验：写入前校验 evidence summary 结构（4 字段）。string 先包装为最小 evidence 结构（单一契约），
  // 对象输入仍须含齐 4 字段，缺即 throw 并附模板。
  const summary = wrapStringSummary(rawSummary)
  const validation = validateEvidenceSummary(summary)
  if (!validation.valid) {
    const err = new Error(`evidence summary invalid: ${validation.errors.join('; ')}`)
    err.code = 'EVIDENCE_SUMMARY_INVALID'
    err.template = EVIDENCE_TEMPLATE
    err.required_fields = [...EVIDENCE_FIELDS]
    err.reason = validation.reason
    throw err
  }
  const journalDir = getJournalDir(projectId)
  const index = readIndex(journalDir)
  const sessionId = Number(index.total_sessions || 0) + 1
  const sessionData = {
    id: sessionId,
    title,
    date: new Date().toISOString(),
    workflow_id: workflowId,
    tasks_completed: tasksCompleted || [],
    summary,
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
        // summary 兼容两形态：evidence 对象（wrapStringSummary/advance --journal 落盘）取 diff_summary
        // 摘要展示，legacy string 原样——直接 String() 会把对象渲染成 '[object Object]'。
        const rawSummary = data.summary
        const summaryText = typeof rawSummary === 'string'
          ? rawSummary
          : (rawSummary && typeof rawSummary === 'object') ? String(rawSummary.diff_summary || '') : ''
        matches.push({ id: data.id, title: data.title, date: data.date, summary: summaryText.slice(0, 200) })
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
  if (command === 'add') {
    // T6：--summary-json 传 evidence 结构对象；保留 --summary 兼容入参但触发 hard-reject 返回模板。
    let summaryInput = null
    const summaryJson = option('--summary-json')
    if (summaryJson) {
      try { summaryInput = JSON.parse(summaryJson) } catch (err) {
        process.stdout.write(`${JSON.stringify({ error: `--summary-json invalid JSON: ${err.message}`, template: EVIDENCE_TEMPLATE, required_fields: EVIDENCE_FIELDS }, null, 2)}\n`)
        process.exitCode = 1
        return
      }
    } else if (option('--summary')) {
      summaryInput = option('--summary')
    }
    try {
      result = cmdAdd(projectId, option('--title'), option('--workflow-id') || null, split(option('--tasks-completed')), summaryInput, split(option('--decisions')), split(option('--next-steps')))
    } catch (err) {
      if (err && err.code === 'EVIDENCE_SUMMARY_INVALID') {
        process.stdout.write(`${JSON.stringify({ error: err.message, code: err.code, reason: err.reason, required_fields: err.required_fields, template: err.template }, null, 2)}\n`)
        process.exitCode = 1
        return
      }
      throw err
    }
  }
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
  EVIDENCE_FIELDS,
  EVIDENCE_TEMPLATE,
  validateEvidenceSummary,
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
