#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const PROFILE_DIR = path.resolve(__dirname, '..', '..', 'specs', 'workflow-runtime', 'role-profiles')

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function parseFrontmatter(content) {
  const text = String(content || '')
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { attributes: {}, body: text.trim() }
  const [, rawFrontmatter, body] = match
  const lines = rawFrontmatter.split('\n')
  const attributes = {}
  let currentKey = null
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    const listMatch = line.match(/^\s+-\s+(.*)$/)
    if (listMatch && currentKey) {
      if (!Array.isArray(attributes[currentKey])) attributes[currentKey] = []
      attributes[currentKey].push(listMatch[1].trim())
      continue
    }
    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kvMatch) continue
    const [, key, rawValue] = kvMatch
    currentKey = key
    if (rawValue === '') {
      attributes[key] = []
      continue
    }
    if (rawValue === 'true') attributes[key] = true
    else if (rawValue === 'false') attributes[key] = false
    else attributes[key] = rawValue.trim()
  }
  return { attributes, body: body.trim() }
}

function readRoleProfiles(profileDir = PROFILE_DIR) {
  if (!fs.existsSync(profileDir)) return []
  return fs.readdirSync(profileDir)
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => {
      const filePath = path.join(profileDir, entry)
      const { attributes, body } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'))
      return {
        id: entry.replace(/\.md$/, ''),
        file: filePath,
        phase: attributes.phase || null,
        role: attributes.role || null,
        applies_when: safeArray(attributes.applies_when),
        source: attributes.source || 'system',
        agent_compatible: attributes.agent_compatible !== false,
        prompt: body,
      }
    })
}

function classifyRoleSignals(requirementContent = '', analysisPatterns = [], discussionArtifact = null, extra = {}) {
  const text = [requirementContent, extra.taskName, extra.summary, safeArray(extra.requirementIds).join(' '), safeArray(extra.criticalConstraints).join(' ')].filter(Boolean).join('\n')
  const frameworksText = safeArray(analysisPatterns).map((pattern) => String((pattern || {}).name || '')).join(' ')
  const combined = `${text}\n${frameworksText}`
  const ui = /页面|界面|表单|列表|弹窗|导航|dashboard|modal|ui|component|layout|样式|前端/i.test(combined)
  const workspace = /同步|sync|agent|workspace|工作区|目录/i.test(combined)
  const security = /auth|token|session|permission|role|credential|secret|oauth|jwt|鉴权|认证|授权|权限|密钥/i.test(combined)
  const data = /database|schema|migration|repository|sql|orm|prisma|query|数据层|数据库|迁移/i.test(combined)
  const backend_heavy = /api|controller|handler|route|service|repository|backend|server|接口|后端|服务/i.test(combined) || data
  const clarificationCount = safeArray((discussionArtifact || {}).clarifications).length
  return {
    ui,
    workspace,
    security,
    data,
    backend_heavy,
    clarification_count: clarificationCount,
  }
}

function deriveSignalTags(signals = {}) {
  const tags = []
  if (signals.security) tags.push('security', 'auth')
  if (signals.data) tags.push('data')
  if (signals.backend_heavy) tags.push('backend_heavy')
  if (signals.ui) tags.push('ui')
  if (signals.workspace) tags.push('workspace')
  tags.push('default')
  return [...new Set(tags)]
}

function defaultRoleForPhase(phase = '') {
  if (phase === 'plan_generation') return 'planner'
  if (phase === 'plan_review') return 'reviewer'
  if (phase === 'quality_review_stage2') return 'reviewer'
  return 'reviewer'
}

function matchProfileScore(profile, tags = []) {
  const applies = safeArray(profile.applies_when)
  let score = 0
  for (const tag of tags) {
    if (applies.includes(tag)) score += tag === 'default' ? 1 : 10
  }
  return score
}

function resolveRoleProfile(phase, signals = {}, collaboration = {}, sessions = {}, profiles = readRoleProfiles()) {
  const tags = deriveSignalTags(signals)
  const matching = profiles.filter((profile) => profile.phase === phase)
  let selected = null
  let bestScore = -1
  for (const profile of matching) {
    const score = matchProfileScore(profile, tags)
    if (score > bestScore) {
      bestScore = score
      selected = profile
    }
  }
  if (!selected) {
    return {
      phase,
      role: defaultRoleForPhase(phase),
      profile: null,
      tags,
      source: 'system',
      agent_compatible: false,
      prompt: '',
    }
  }
  return {
    phase,
    role: selected.role || defaultRoleForPhase(phase),
    profile: selected.id,
    tags,
    source: selected.source || 'system',
    agent_compatible: Boolean(selected.agent_compatible),
    prompt: selected.prompt,
    file: selected.file,
    collaboration_mode: (collaboration || {}).mode || null,
    platform: (sessions || {}).platform || null,
  }
}

function buildInjectedContext(subject = {}, profile = {}, signals = {}, artifacts = {}) {
  return {
    phase: profile.phase || null,
    role: profile.role || null,
    profile: profile.profile || null,
    subject: {
      kind: subject.kind || null,
      ref: subject.ref || null,
      requirement_ids: safeArray(subject.requirement_ids),
      critical_constraints: safeArray(subject.critical_constraints),
    },
    signals,
    artifacts: {
      spec_file: artifacts.spec_file || null,
      plan_file: artifacts.plan_file || null,
      discussion_artifact: artifacts.discussion_artifact || null,
      diff_window: artifacts.diff_window || null,
    },
  }
}

function buildAgentPrompt(profile = {}, injectedContext = {}, platform = 'unknown') {
  const lines = []
  if (profile.prompt) lines.push(profile.prompt.trim())
  lines.push('')
  lines.push('Injected runtime context:')
  lines.push(JSON.stringify({ platform, context: injectedContext }, null, 2))
  return lines.join('\n').trim()
}

module.exports = {
  PROFILE_DIR,
  parseFrontmatter,
  readRoleProfiles,
  classifyRoleSignals,
  deriveSignalTags,
  defaultRoleForPhase,
  resolveRoleProfile,
  buildInjectedContext,
  buildAgentPrompt,
}
