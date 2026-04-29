#!/usr/bin/env node
/** @file 任务状态工具 - 状态 emoji 映射、标题状态提取、任务 ID 校验等基础工具函数 */

const { addUnique, escapeRegExp } = require('./collection_utils')

const STATUS_EMOJI_REGEX = /(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u
const STRIP_STATUS_EMOJI_REGEX = /\s*(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u

const EMOJI_TO_STATUS = {
  '✅': 'completed',
  '⏳': 'in_progress',
  '❌': 'failed',
  '⏭️': 'skipped',
  '⏭\uFE0F': 'skipped',
  '⏭': 'skipped',
}

const STATUS_TO_EMOJI = {
  completed: '✅',
  in_progress: '⏳',
  failed: '❌',
  skipped: '⏭️',
}

/**
 * 根据任务状态字符串返回对应的 emoji
 * @param {string} status - 任务状态（如 'completed'、'failed'）
 * @returns {string} 对应的 emoji 字符，无匹配时返回空字符串
 */
function getStatusEmoji(status) {
  const value = String(status || '')
  for (const [key, emoji] of Object.entries(STATUS_TO_EMOJI)) {
    if (value.includes(key)) return emoji
  }
  return ''
}

/**
 * 从任务标题中提取状态 emoji 并转换为状态字符串
 * @param {string} title - 任务标题文本
 * @returns {string|null} 状态字符串（如 'completed'），无匹配时返回 null
 */
function extractStatusFromTitle(title) {
  const match = String(title || '').match(STATUS_EMOJI_REGEX)
  if (!match) return null
  return EMOJI_TO_STATUS[match[0].trim()] || null
}

/**
 * 移除标题末尾的状态 emoji
 * @param {string} title - 任务标题文本
 * @returns {string} 去除 emoji 后的标题
 */
function stripStatusEmoji(title) {
  return String(title || '').replace(STRIP_STATUS_EMOJI_REGEX, '').trim()
}

/**
 * 校验任务 ID 格式是否合法（T + 数字）
 * @param {string} taskId - 任务 ID
 * @returns {boolean} 是否合法
 */
function validateTaskId(taskId) {
  return /^T\d+$/.test(String(taskId || ''))
}

function main() {
  const [, , command, arg] = process.argv
  if (command === 'emoji') {
    process.stdout.write(`${JSON.stringify({ emoji: getStatusEmoji(arg) })}\n`)
    return
  }
  if (command === 'extract') {
    process.stdout.write(`${JSON.stringify({ status: extractStatusFromTitle(arg) }, null, 2)}\n`)
    return
  }
  if (command === 'validate') {
    process.stdout.write(`${JSON.stringify({ valid: validateTaskId(arg) })}\n`)
    return
  }
  process.stderr.write('Usage: node status_utils.js <emoji|extract|validate> <value>\n')
  process.exitCode = 1
}

module.exports = {
  STATUS_EMOJI_REGEX,
  STRIP_STATUS_EMOJI_REGEX,
  getStatusEmoji,
  extractStatusFromTitle,
  stripStatusEmoji,
  addUnique,
  escapeRegExp,
  validateTaskId,
}

if (require.main === module) main()
