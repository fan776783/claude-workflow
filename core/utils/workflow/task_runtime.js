#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { detectProjectIdFromRoot, getWorkflowsDir, getThinkingGuidesDir, getKnowledgeDir } = require('./path_utils')
const { findTaskById, extractTaskBlock } = require('./task_parser')

function readFile(targetPath, fallback = '') {
  try {
    return fs.readFileSync(targetPath, 'utf8')
  } catch {
    return fallback
  }
}

function readJson(targetPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback
    return { __parse_error: true, path: targetPath, message: err instanceof Error ? err.message : String(err) }
  }
}

function resolveRuntimeRelativePath(baseDir, relativePath) {
  if (!baseDir || !relativePath || path.isAbsolute(relativePath)) return null
  const normalized = path.normalize(relativePath)
  if (normalized.split(path.sep).includes('..')) return null
  return path.join(baseDir, normalized)
}

function getWorkflowRuntime(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot)
  const projectId = detectProjectIdFromRoot(root)
  if (!projectId) {
    return {
      projectRoot: root,
      projectId: null,
      workflowDir: null,
      statePath: null,
      state: null,
      tasksPath: null,
      tasksContent: '',
      currentTaskId: null,
      currentTask: null,
      currentTaskBlock: '',
    }
  }

  const workflowDir = getWorkflowsDir(projectId)
  const statePath = workflowDir ? path.join(workflowDir, 'workflow-state.json') : null
  const rawState = statePath && fs.existsSync(statePath) ? readJson(statePath) : null
  const parseError = rawState && rawState.__parse_error
  const state = parseError ? null : rawState
  const planFileRef = state ? (state.plan_file || state.tasks_file || '') : ''
  const tasksPath = planFileRef ? (path.isAbsolute(planFileRef) ? planFileRef : path.join(root, planFileRef)) : null
  const tasksContent = tasksPath && fs.existsSync(tasksPath) ? readFile(tasksPath) : ''
  const currentTaskId = (state?.current_tasks || [])[0] || null
  const currentTask = currentTaskId && tasksContent ? findTaskById(tasksContent, currentTaskId) : null
  const currentTaskBlock = currentTaskId && tasksContent ? extractTaskBlock(tasksContent, currentTaskId) : ''

  return {
    projectRoot: root,
    projectId,
    workflowDir,
    statePath,
    state,
    stateParseError: parseError ? rawState.message : null,
    tasksPath,
    tasksContent,
    currentTaskId,
    currentTask,
    currentTaskBlock,
  }
}

function getCurrentTask(runtime) {
  return runtime?.currentTask || null
}

function getCurrentTaskId(runtime) {
  return runtime?.currentTaskId || null
}

function getTaskBlock(runtime, taskId = null) {
  const resolvedTaskId = taskId || getCurrentTaskId(runtime)
  if (!runtime?.tasksContent || !resolvedTaskId) return ''
  return extractTaskBlock(runtime.tasksContent, resolvedTaskId)
}

function getTaskActions(task) {
  return [...(task?.actions || [])].filter(Boolean)
}

function getTaskVerification(task) {
  return task?.verification || null
}

function getTaskVerificationCommands(task) {
  return [...(getTaskVerification(task)?.commands || [])].filter(Boolean)
}

function getSpecContent(projectRoot, state, maxChars = 2000) {
  const specFile = state?.spec_file || ''
  if (!specFile) return ''
  const specPath = path.join(path.resolve(projectRoot || process.cwd()), specFile)
  const specContent = readFile(specPath)
  if (!specContent) return ''
  return specContent.length > maxChars ? specContent.slice(0, maxChars) : specContent
}

function getThinkingGuides(projectRoot = process.cwd()) {
  const dirInfo = getThinkingGuidesDir(projectRoot)
  if (!dirInfo) return null

  const files = fs.readdirSync(dirInfo.path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'index.md' && entry.name.endsWith('.md'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirInfo.path, entry.name),
      displayPath: `${dirInfo.displayPath}/${entry.name}`.replace(/\\/g, '/'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    ...dirInfo,
    files,
    legacyWarning: dirInfo.source === 'legacy'
      ? `检测到旧路径 ${path.relative(path.resolve(projectRoot), dirInfo.path).replace(/\\/g, '/')}，建议迁移到 ${dirInfo.displayPath}`
      : null,
  }
}

function isPathUnderRoot(filePath, allowedPrefix) {
  if (!allowedPrefix) return true
  try {
    // lstat 必须为普通文件/目录；拒绝符号链接
    const lstat = fs.lstatSync(filePath)
    if (lstat.isSymbolicLink()) return false
    const resolved = fs.realpathSync(filePath)
    return resolved === allowedPrefix || resolved.startsWith(allowedPrefix + path.sep)
  } catch {
    return false
  }
}

function safeReadKnowledge(filePath, allowedPrefix, maxLen) {
  if (!fs.existsSync(filePath)) return null
  if (!isPathUnderRoot(filePath, allowedPrefix)) return null
  const content = readFile(filePath)
  return maxLen ? content.slice(0, maxLen) : content
}

// 防止 knowledge 内容中嵌入的 </project-knowledge> / <system-reminder> 等标记破坏 hook 注入结构
function sanitizeKnowledgeBody(content) {
  return String(content || '')
    .replace(/<\/project-knowledge>/gi, '&lt;/project-knowledge&gt;')
    .replace(/<(\/?system[^>]*)>/gi, '&lt;$1&gt;')
    .replace(/<(\/?workflow-context[^>]*)>/gi, '&lt;$1&gt;')
}

function formatKnowledgeBlock(label, content) {
  const trimmed = String(content || '').trim()
  if (!trimmed) return null
  return `### ${label}\n${sanitizeKnowledgeBody(trimmed)}`
}

function collectMarkdownFiles(dir, allowedPrefix = null) {
  if (!fs.existsSync(dir)) return []
  const results = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    // 符号链接一律拒绝
    if (entry.isSymbolicLink()) continue
    if (allowedPrefix && !isPathUnderRoot(full, allowedPrefix)) continue
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full, allowedPrefix))
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md') {
      results.push(full)
    }
  }
  return results
}

function getKnowledgeContext(projectRoot = process.cwd(), maxChars = 2000) {
  const dirInfo = getKnowledgeDir(projectRoot)
  if (!dirInfo.exists) return null
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path

  const parts = []
  let totalLen = 0
  const rootIndexBudget = Math.min(300, maxChars)
  const rootContent = safeReadKnowledge(path.join(dirInfo.path, 'index.md'), allowedPrefix, rootIndexBudget)
  if (rootContent) {
    parts.push(sanitizeKnowledgeBody(String(rootContent).trim()))
    totalLen += rootContent.length
  }

  const layers = fs.readdirSync(dirInfo.path, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of layers) {
    const layerIndex = path.join(dirInfo.path, entry.name, 'index.md')
    const snippet = safeReadKnowledge(layerIndex, allowedPrefix, 150)
    if (!snippet) continue
    const block = formatKnowledgeBlock(`${entry.name}/index.md`, snippet)
    if (!block) continue
    const blockLen = block.length + 2
    if (totalLen + blockLen > maxChars) continue
    parts.push(block)
    totalLen += blockLen
  }

  const knowledgeFiles = collectMarkdownFiles(dirInfo.path, allowedPrefix)
  for (const filePath of knowledgeFiles) {
    const relativePath = path.relative(path.resolve(projectRoot), filePath).replace(/\\/g, '/')
    const remaining = maxChars - totalLen
    if (remaining <= 80) break
    const snippet = safeReadKnowledge(filePath, allowedPrefix, Math.min(600, remaining - 32))
    if (!snippet) continue
    const block = formatKnowledgeBlock(relativePath, snippet)
    if (!block) continue
    const blockLen = block.length + 2
    if (totalLen + blockLen > maxChars) continue
    parts.push(block)
    totalLen += blockLen
  }

  return parts.length ? parts.join('\n\n') : null
}

function getKnowledgeFiles(projectRoot = process.cwd()) {
  const dirInfo = getKnowledgeDir(projectRoot)
  if (!dirInfo.exists) return []
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path
  return collectMarkdownFiles(dirInfo.path, allowedPrefix).map((f) => ({
    path: f,
    relativePath: path.relative(path.resolve(projectRoot), f).replace(/\\/g, '/'),
  }))
}

module.exports = {
  readFile,
  readJson,
  resolveRuntimeRelativePath,
  getWorkflowRuntime,
  getCurrentTask,
  getCurrentTaskId,
  getTaskBlock,
  getTaskActions,
  getTaskVerification,
  getTaskVerificationCommands,
  getSpecContent,
  getThinkingGuides,
  getKnowledgeContext,
  getKnowledgeFiles,
}
