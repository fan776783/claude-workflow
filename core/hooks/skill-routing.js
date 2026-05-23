#!/usr/bin/env node
/** @file Skill Routing Hook — UserPromptSubmit 注入 routing hint + PreToolUse(ToolSearch) deny skill 名误用 */

require('./_utf8')

const fs = require('fs')
const path = require('path')
const { shouldSkipInjection } = require('./_skip')

const TABLE_PATH = path.join(__dirname, 'skill-routing-table.json')

function emitAllow() {
  process.stdout.write(JSON.stringify({ continue: true }))
}

function loadTable() {
  try {
    return JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'))
  } catch (e) {
    process.stderr.write(`[skill-routing] table load failed: ${e.message}\n`)
    return null
  }
}

function matchFigma(text, table) {
  const rule = (table.url_rules || []).find((r) => r.id === 'figma')
  if (!rule) return null
  if (!new RegExp(rule.pattern, 'i').test(text)) return null
  const lower = text.toLowerCase()
  const hitImpl = (rule.intent_keywords.implement || []).some((k) => lower.includes(k.toLowerCase()))
  if (hitImpl) return { skill: rule.skill_implement, hint: rule.hint_implement }
  const hitData = (rule.intent_keywords.data || []).some((k) => lower.includes(k.toLowerCase()))
  if (hitData) return { skill: rule.skill_data, hint: rule.hint_data }
  return { skill: rule.fallback_skill, hint: rule.hint_data }
}

function matchAlidocs(text, table) {
  const rule = (table.url_rules || []).find((r) => r.id === 'alidocs')
  if (!rule) return null
  if (!new RegExp(rule.pattern, 'i').test(text)) return null
  return { skill: rule.skill, hint: rule.hint }
}

function handleUserPromptSubmit(input, table) {
  const prompt = String(input.prompt || '')
  if (!prompt) return { continue: true }

  const hints = []
  const figma = matchFigma(prompt, table)
  if (figma) hints.push(figma.hint)
  const alidocs = matchAlidocs(prompt, table)
  if (alidocs) hints.push(alidocs.hint)
  if (!hints.length) return { continue: true }

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `<skill-routing-hint>\n${hints.join('\n\n')}\n</skill-routing-hint>`,
    },
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findSkillNameHit(query, skillNames) {
  for (const name of skillNames) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(name)}([^a-z0-9]|$)`, 'i')
    if (re.test(query)) return name
  }
  return null
}

function handlePreToolUseToolSearch(input, table) {
  if (input.tool_name !== 'ToolSearch') return { continue: true }
  const ti = input.tool_input || {}
  const query = String(ti.query || '')
  if (!query) return { continue: true }
  const hit = findSkillNameHit(query, table.project_skill_names || [])
  if (!hit) return { continue: true }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `"${hit}" 是 skill 不是 deferred tool。使用 Skill(skill="agent-workflow:${hit}") 调用，参考 SessionStart 注入的 skill listing。`,
    },
  }
}

function main() {
  if (process.env.SKILL_ROUTING === '0' || shouldSkipInjection()) {
    emitAllow()
    return
  }

  let input = {}
  try {
    const raw = fs.readFileSync(0, 'utf8')
    input = raw.trim() ? JSON.parse(raw) : {}
  } catch (e) {
    process.stderr.write(`[skill-routing] input parse failed: ${e.message}\n`)
    emitAllow()
    return
  }

  const table = loadTable()
  if (!table) {
    emitAllow()
    return
  }

  const event = input.hook_event_name || input.hookEventName
  let result
  if (event === 'UserPromptSubmit') {
    result = handleUserPromptSubmit(input, table)
  } else if (event === 'PreToolUse') {
    result = handlePreToolUseToolSearch(input, table)
  } else {
    result = { continue: true }
  }

  process.stdout.write(JSON.stringify(result))
}

if (require.main === module) {
  try {
    main()
  } catch (e) {
    process.stderr.write(`[skill-routing] crash: ${e.message}\n`)
    emitAllow()
  }
}

module.exports = { matchFigma, matchAlidocs, findSkillNameHit }
