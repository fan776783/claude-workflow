#!/usr/bin/env node
/** @file 项目配置 setup - 从 lifecycle_cmds.js 拆出的项目 ID / config / legacy 迁移逻辑 */

const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { validateProjectId } = require('./path_utils')

function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function extractProjectId(config) {
  if (!config) return null
  const project = config.project || {}
  const projectId = project.id || config.projectId
  if (!projectId || !validateProjectId(projectId)) return null
  return projectId
}

function summarizeText(value, limit = 80) {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim()
  if (collapsed.length <= limit) return collapsed
  return `${collapsed.slice(0, limit - 3).trimEnd()}...`
}

function slugifyFilename(value) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? slug.slice(0, 80) : ''
}

function projectNameSlug(projectRoot) {
  const base = path.basename(path.resolve(projectRoot))
  const slug = String(base || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? slug.slice(0, 32).replace(/-+$/g, '') : ''
}

function stableProjectId(projectRoot) {
  const resolved = path.resolve(projectRoot)
  const hash = crypto.createHash('md5').update(String(resolved).toLowerCase()).digest('hex').slice(0, 12)
  const slug = projectNameSlug(resolved)
  return slug ? `${slug}-${hash}` : hash
}

function isLegacyStableProjectId(projectId) {
  return /^[a-f0-9]{12}$/.test(String(projectId || ''))
}

function detectGitHead(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0) return null
  const commit = String(result.stdout || '').trim()
  return commit || null
}

function buildProjectConfig(projectRoot, existing = null, forcedProjectId = null) {
  const current = { ...(existing || {}) }
  const project = { ...((current.project) || {}) }
  const tech = { ...((current.tech) || {}) }
  const workflow = { ...((current.workflow) || {}) }

  let projectId = forcedProjectId || project.id || current.projectId
  if (!projectId || !validateProjectId(projectId)) projectId = stableProjectId(projectRoot)

  project.id = projectId
  project.name = project.name || path.basename(projectRoot)
  project.type = project.type || 'single'
  project.bkProjectId = project.bkProjectId || null

  if (!('packageManager' in tech)) tech.packageManager = 'unknown'
  if (!('buildTool' in tech)) tech.buildTool = 'unknown'
  if (!('frameworks' in tech)) tech.frameworks = []
  if (!('enableBKMCP' in workflow)) workflow.enableBKMCP = false

  current.project = project
  current.tech = tech
  current.workflow = workflow
  current._scanMode = current._scanMode || 'auto-healed'
  return current
}

function planLegacyProjectIdMigration(projectRoot) {
  const root = path.resolve(projectRoot)
  const config = loadProjectConfig(root)
  const currentId = extractProjectId(config)
  if (!currentId || !isLegacyStableProjectId(currentId)) return { needed: false }

  const newId = stableProjectId(root)
  if (newId === currentId) return { needed: false }

  const workflowsRoot = path.join(os.homedir(), '.claude', 'workflows')
  const oldDir = path.join(workflowsRoot, currentId)
  const newDir = path.join(workflowsRoot, newId)
  return {
    needed: true,
    currentId,
    newId,
    oldDir,
    newDir,
    oldDirExists: fs.existsSync(oldDir),
    newDirExists: fs.existsSync(newDir),
    configPath: path.join(root, '.claude', 'config', 'project-config.json'),
  }
}

function applyLegacyProjectIdMigration(projectRoot) {
  const root = path.resolve(projectRoot)
  const plan = planLegacyProjectIdMigration(root)
  if (!plan.needed) return { migrated: false, reason: 'not_legacy' }

  if (plan.newDirExists) {
    return { migrated: false, reason: 'target_state_dir_exists', ...plan }
  }

  const config = loadProjectConfig(root) || {}
  const project = { ...(config.project || {}) }
  project.id = plan.newId
  const updated = { ...config, project }
  if (typeof config.projectId === 'string') updated.projectId = plan.newId
  fs.mkdirSync(path.dirname(plan.configPath), { recursive: true })
  fs.writeFileSync(plan.configPath, `${JSON.stringify(updated, null, 2)}\n`)

  if (plan.oldDirExists) {
    fs.mkdirSync(path.dirname(plan.newDir), { recursive: true })
    fs.renameSync(plan.oldDir, plan.newDir)
  }

  return { migrated: true, ...plan }
}

function ensureProjectConfig(projectRoot, forcedProjectId = null) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  const existing = loadProjectConfig(projectRoot)
  const currentProjectId = extractProjectId(existing)
  const needsWrite = !existing || !currentProjectId || (forcedProjectId != null && currentProjectId !== forcedProjectId)

  if (!needsWrite && existing) return [existing, configPath, false]

  const config = buildProjectConfig(projectRoot, existing, forcedProjectId)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return [config, configPath, true]
}

module.exports = {
  loadProjectConfig,
  extractProjectId,
  summarizeText,
  slugifyFilename,
  projectNameSlug,
  stableProjectId,
  isLegacyStableProjectId,
  detectGitHead,
  buildProjectConfig,
  planLegacyProjectIdMigration,
  applyLegacyProjectIdMigration,
  ensureProjectConfig,
}
