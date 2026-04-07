const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function stableProjectId(projectRoot) {
  return crypto.createHash('md5').update(projectRoot.toLowerCase()).digest('hex').slice(0, 12)
}

function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function ensureProjectConfig(projectRoot, forcedProjectId) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  const existing = loadProjectConfig(projectRoot)
  const current = existing ? { ...existing } : {}
  const project = { ...(current.project || {}) }
  const tech = { ...(current.tech || {}) }
  const workflow = { ...(current.workflow || {}) }
  const projectId = forcedProjectId || project.id || current.projectId || stableProjectId(projectRoot)

  project.id = projectId
  project.name = project.name || path.basename(projectRoot)
  project.type = project.type || 'single'
  project.bkProjectId = project.bkProjectId || null
  tech.packageManager = tech.packageManager || 'unknown'
  tech.buildTool = tech.buildTool || 'unknown'
  tech.frameworks = tech.frameworks || []
  workflow.enableBKMCP = workflow.enableBKMCP || false

  const config = { ...current, project, tech, workflow, _scanMode: current._scanMode || 'auto-healed' }
  const configHealed = !existing || existing.project?.id !== projectId
  if (configHealed) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  }
  return { config, configHealed, configPath }
}

function resolveRequirementInput(requirement, projectRoot) {
  const candidate = requirement.endsWith('.md') ? path.resolve(projectRoot, requirement) : null
  if (candidate && fs.existsSync(candidate)) {
    return {
      requirementSource: path.relative(projectRoot, candidate),
      requirementText: fs.readFileSync(candidate, 'utf8'),
      sourcePath: candidate,
    }
  }
  return { requirementSource: 'inline', requirementText: requirement, sourcePath: null }
}

function deriveTaskName(requirementText, sourcePath) {
  if (sourcePath) return path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]/g, ' ').trim() || 'Team Task'
  const collapsed = requirementText.replace(/\s+/g, ' ').trim()
  return (collapsed.slice(0, 48) || 'Team Task').trim()
}

function buildTechStackSummary(config) {
  const tech = config.tech || {}
  const parts = [tech.packageManager || 'unknown', tech.buildTool || 'unknown']
  if (Array.isArray(tech.frameworks) && tech.frameworks.length) parts.push(tech.frameworks.join('/'))
  return parts.join(' | ')
}

function estimateGapCount(requirementText) {
  return (requirementText.match(/[？?]/g) || []).length
}

function shouldRunDiscussion(requirementText, requirementSource, { noDiscuss = false } = {}) {
  if (noDiscuss) return false
  if (requirementSource === 'inline' && requirementText.trim().length <= 100) return false
  return estimateGapCount(requirementText) > 0 || requirementText.trim().length > 100
}

function shouldRunUxDesignGate(requirementText, config) {
  const text = requirementText.toLowerCase()
  const frameworks = ((config.tech || {}).frameworks || []).map((item) => String(item).toLowerCase())
  return /ui|页面|界面|组件|ux|交互/.test(requirementText) || frameworks.some((item) => /react|vue|svelte|next/.test(item)) || /frontend/.test(text)
}

function buildDiscussionArtifact(requirementSource) {
  return {
    requirement_source: requirementSource,
    clarifications: [],
    created_at: new Date().toISOString(),
  }
}

module.exports = {
  buildDiscussionArtifact,
  buildTechStackSummary,
  deriveTaskName,
  ensureProjectConfig,
  estimateGapCount,
  resolveRequirementInput,
  shouldRunDiscussion,
  shouldRunUxDesignGate,
  stableProjectId,
}
