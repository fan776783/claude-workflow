#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')

const WORKFLOW_STATE_FILENAME = 'workflow-state.json'
const THINKING_GUIDES_DISPLAY_PATH = '.claude/.agent-workflow/specs/guides'
const THINKING_GUIDES_MANAGED_SEGMENTS = ['.claude', '.agent-workflow', 'specs', 'guides']
const THINKING_GUIDES_LEGACY_SEGMENTS = ['.claude', 'specs', 'guides']
const CODE_SPECS_DIR_SEGMENTS = ['.claude', 'code-specs']

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

const HANDOFF_PHASES = ['spec', 'plan', 'execute']

function getHandoffDir(projectId) {
  const workflowsDir = getWorkflowsDir(projectId)
  return workflowsDir ? path.join(workflowsDir, 'handoff') : null
}

// handoff 落 handoff/{from-phase}.md（不入 state schema，覆盖式写）。
// fromPhase 仅允许 spec|plan|execute，非白名单或非法 projectId → null（不抛）。
function getHandoffPath(projectId, fromPhase) {
  if (!HANDOFF_PHASES.includes(fromPhase)) return null
  const handoffDir = getHandoffDir(projectId)
  return handoffDir ? path.join(handoffDir, `${fromPhase}.md`) : null
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

function readProjectConfig(projectRoot) {
  const root = projectRoot ? path.resolve(projectRoot) : path.resolve(normalizeWindowsShellPath(process.cwd()))
  const configPath = path.join(root, '.claude', 'config', 'project-config.json')
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function detectProjectIdFromRoot(projectRoot) {
  const config = readProjectConfig(projectRoot)
  if (!config) return null
  const project = config.project || {}
  const projectId = project.id || config.projectId
  return validateProjectId(projectId) ? String(projectId) : null
}

/**
 * 在 Windows 平台上把 Unix 风格的 shell 路径归一化为原生 Windows 路径。
 *
 *   /c/Users/...           → C:\Users\...   (Git Bash / MSYS2)
 *   /cygdrive/c/Users/...  → C:\Users\...   (Cygwin)
 *   /mnt/c/Users/...       → C:\Users\...   (WSL 路径泄漏)
 *
 * 已是 Windows 原生路径或不匹配的形态：直通（保守原则）。
 *
 * 必要性：Node 的 path.resolve 在 Windows 看到 `/d/xxx` 会前置当前驱动器（`D:\d\xxx`），
 * 导致 hook 找不到 `.claude/config/...`。
 */
const SHELL_DRIVE_RE = /^\/(?:cygdrive\/|mnt\/)?([A-Za-z])\/(.*)$/

function normalizeWindowsShellPath(p) {
  if (typeof p !== 'string' || !p) return p
  if (process.platform !== 'win32') return p
  const trimmed = p.trim()
  if (/^[A-Za-z]:[\/\\]/.test(trimmed)) return trimmed
  const m = SHELL_DRIVE_RE.exec(trimmed)
  if (!m) return trimmed
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`
}

function getThinkingGuidesDir(projectRoot, options = {}) {
  const { allowLegacy = true } = options
  const root = projectRoot ? path.resolve(projectRoot) : path.resolve(normalizeWindowsShellPath(process.cwd()))
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

function getCodeSpecsDir(projectRoot) {
  const root = projectRoot ? path.resolve(projectRoot) : path.resolve(normalizeWindowsShellPath(process.cwd()))
  const dir = path.join(root, ...CODE_SPECS_DIR_SEGMENTS)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { path: dir, exists: false }
  }
  try {
    const resolvedRoot = fs.realpathSync(root)
    const resolvedDir = fs.realpathSync(dir)
    const expectedPrefix = path.join(resolvedRoot, ...CODE_SPECS_DIR_SEGMENTS)
    // 必须严格位于 <root>/.claude/code-specs 下，拒绝符号链接指向仓库根或仓库外部
    if (resolvedDir !== expectedPrefix && !resolvedDir.startsWith(expectedPrefix + path.sep)) {
      return { path: dir, exists: false }
    }
    return { path: resolvedDir, exists: true, resolvedRoot, expectedPrefix }
  } catch {
    return { path: dir, exists: false }
  }
}

function safeReadJson(targetPath, fallback = null, onError = null) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback
    if (typeof onError === 'function') {
      try { return onError(err, targetPath) } catch { return fallback }
    }
    return fallback
  }
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
  getHandoffDir,
  getHandoffPath,
  isCanonicalWorkflowStatePath,
  assertCanonicalWorkflowStatePath,
  detectProjectIdFromRoot,
  readProjectConfig,
  getThinkingGuidesDir,
  THINKING_GUIDES_DISPLAY_PATH,
  getCodeSpecsDir,
  CODE_SPECS_DIR_SEGMENTS,
  safeReadJson,
  normalizeWindowsShellPath,
}

if (require.main === module) main()
