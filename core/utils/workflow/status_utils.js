#!/usr/bin/env node

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

function getStatusEmoji(status) {
  const value = String(status || '')
  for (const [key, emoji] of Object.entries(STATUS_TO_EMOJI)) {
    if (value.includes(key)) return emoji
  }
  return ''
}

function extractStatusFromTitle(title) {
  const match = String(title || '').match(STATUS_EMOJI_REGEX)
  if (!match) return null
  return EMOJI_TO_STATUS[match[0].trim()] || null
}

function stripStatusEmoji(title) {
  return String(title || '').replace(STRIP_STATUS_EMOJI_REGEX, '').trim()
}

function addUnique(arr, item) {
  if (!arr.includes(item)) arr.push(item)
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
