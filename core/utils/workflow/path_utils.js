#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')

const WORKFLOW_STATE_FILENAME = 'workflow-state.json'
const THINKING_GUIDES_DISPLAY_PATH = '.claude/.agent-workflow/specs/guides'
const THINKING_GUIDES_MANAGED_SEGMENTS = ['.claude', '.agent-workflow', 'specs', 'guides']
const THINKING_GUIDES_LEGACY_SEGMENTS = ['.claude', 'specs', 'guides']

function resolveUnder(baseDir, relativePath) {
  if (!relativePath) return null
  if (path.isAbsolute(relativePath)) return null
  if (relativePath.includes('..')) return null
  if (!/^[a-zA-Z0-9_./-]+$/.test(relativePath)) return null
  if (/^\/|\/\/|\/\s*$/.test(relativePath)) return null

  const resolved = path.resolve(baseDir, relativePath)
  const normalizedBase = path.resolve(baseDir)
  if (resolved !== normalizedBase && !resolved.startsWith(`${normalizedBase}${path.sep}`)) return null
  return resolved
}

function validateProjectId(projectId) {
  return /^[a-zA-Z0-9_-]+$/.test(String(projectId || ''))
}

function getWorkflowsDir(projectId) {
  if (!validateProjectId(projectId)) return null
  return path.join(os.homedir(), '.claude', 'workflows', projectId)
}

function getWorkflowStatePath(projectId) {
  const workflowsDir = getWorkflowsDir(projectId)
  return workflowsDir ? path.join(workflowsDir, WORKFLOW_STATE_FILENAME) : null
}

function isCanonicalWorkflowStatePath(statePath, projectId) {
  if (!statePath) return false
  const candidate = path.resolve(statePath)
  const workflowsRoot = path.resolve(path.join(os.homedir(), '.claude', 'workflows'))
  if (!candidate.startsWith(`${workflowsRoot}${path.sep}`)) return false
  if (path.basename(candidate) !== WORKFLOW_STATE_FILENAME) return false
  const relative = path.relative(workflowsRoot, path.dirname(candidate)).split(path.sep)
  if (relative.length !== 1) return false
  const detectedProjectId = relative[0]
  if (!validateProjectId(detectedProjectId)) return false
  const canonical = getWorkflowStatePath(projectId || detectedProjectId)
  return Boolean(canonical && candidate === path.resolve(canonical))
}

function assertCanonicalWorkflowStatePath(statePath, projectId) {
  if (!isCanonicalWorkflowStatePath(statePath, projectId)) {
    throw new Error('workflow-state.json must be stored under ~/.claude/workflows/{projectId}/workflow-state.json; project-local .claude/workflow-state.json is forbidden')
  }
  return path.resolve(statePath)
}

function detectProjectIdFromRoot(projectRoot) {
  const root = projectRoot ? path.resolve(projectRoot) : process.cwd()
  const configPath = path.join(root, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const project = config.project || {}
    const projectId = project.id || config.projectId
    return validateProjectId(projectId) ? String(projectId) : null
  } catch {
    return null
  }
}

function getThinkingGuidesDir(projectRoot, options = {}) {
  const { allowLegacy = true } = options
  const root = projectRoot ? path.resolve(projectRoot) : process.cwd()
  const managedDir = path.join(root, ...THINKING_GUIDES_MANAGED_SEGMENTS)
  if (fs.existsSync(managedDir) && fs.statSync(managedDir).isDirectory()) {
    return {
      path: managedDir,
      displayPath: THINKING_GUIDES_DISPLAY_PATH,
      source: 'managed',
    }
  }

  if (!allowLegacy) return null

  const legacyDir = path.join(root, ...THINKING_GUIDES_LEGACY_SEGMENTS)
  if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory()) {
    return {
      path: legacyDir,
      displayPath: THINKING_GUIDES_DISPLAY_PATH,
      source: 'legacy',
    }
  }

  return null
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'resolve') {
    process.stdout.write(`${JSON.stringify({ resolved: resolveUnder(args[0], args[1]) })}\n`)
    return
  }
  if (command === 'validate-id') {
    process.stdout.write(`${JSON.stringify({ valid: validateProjectId(args[0]) })}\n`)
    return
  }
  if (command === 'workflows-dir') {
    process.stdout.write(`${JSON.stringify({ path: getWorkflowsDir(args[0]) })}\n`)
    return
  }
  if (command === 'workflow-state-path') {
    process.stdout.write(`${JSON.stringify({ path: getWorkflowStatePath(args[0]) })}\n`)
    return
  }
  if (command === 'validate-state-path') {
    const projectId = args[2] === '--project-id' ? args[3] : undefined
    process.stdout.write(`${JSON.stringify({ valid: isCanonicalWorkflowStatePath(args[0], projectId) })}\n`)
    return
  }
  process.stderr.write('Usage: node path_utils.js <resolve|validate-id|workflows-dir|workflow-state-path|validate-state-path> ...\n')
  process.exitCode = 1
}

module.exports = {
  WORKFLOW_STATE_FILENAME,
  resolveUnder,
  validateProjectId,
  getWorkflowsDir,
  getWorkflowStatePath,
  isCanonicalWorkflowStatePath,
  assertCanonicalWorkflowStatePath,
  detectProjectIdFromRoot,
  getThinkingGuidesDir,
  THINKING_GUIDES_DISPLAY_PATH,
}

if (require.main === module) main()
