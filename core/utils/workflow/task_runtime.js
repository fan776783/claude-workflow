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

// 合法的 knowledge package 目录名：仅允许 [A-Za-z0-9_.-]；拒绝 `/ \ ..` 等路径分隔符与路径跳转。
// 用于在 resolver / scoped reader 两处做白名单防御。
const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/
function isValidPackageName(name) {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') return false
  return PACKAGE_NAME_PATTERN.test(trimmed)
}

// 解析本次 knowledge 读取应聚焦到哪个 package。
// 优先级：flag.package → 当前任务的 Package 字段 → 项目配置推断的单包名 → null（soft-fail）
// 单包回退链必须与 knowledge_bootstrap.resolvePackages 保持对齐：project.name → package.json#name → 仓库目录名。
// 任一来源解析出的 package 名必须通过 isValidPackageName 校验，否则视为未解析，走下一级回退。
function resolveActiveKnowledgeScope(runtime, projectConfig = null, overrides = {}) {
  const flagPackage = overrides && typeof overrides.package === 'string' ? overrides.package.trim() : ''
  if (flagPackage && isValidPackageName(flagPackage)) return { activePackage: flagPackage, source: 'flag' }

  const task = getCurrentTask(runtime)
  const taskPackage = task && typeof task.package === 'string' ? task.package.trim() : ''
  if (taskPackage && isValidPackageName(taskPackage)) return { activePackage: taskPackage, source: 'task' }

  const root = runtime && runtime.projectRoot ? runtime.projectRoot : process.cwd()
  let config = projectConfig
  if (!config) {
    try {
      const configPath = path.join(root, '.claude', 'config', 'project-config.json')
      if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch { /* ignore; fall through */ }
  }
  const projectType = ((config || {}).project || {}).type
  // Monorepo 下不推断默认包，避免把其中一个包当默认污染别的包
  if (projectType === 'monorepo') return { activePackage: null, source: null }

  const configName = ((config || {}).project || {}).name
  if (configName) {
    const trimmed = String(configName).trim()
    if (isValidPackageName(trimmed)) return { activePackage: trimmed, source: 'config' }
  }
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (pkgJson && pkgJson.name) {
      const stripped = String(pkgJson.name).replace(/^@[^/]+\//, '')
      if (isValidPackageName(stripped)) return { activePackage: stripped, source: 'package-json' }
    }
  } catch { /* ignore */ }
  const repoDir = path.basename(path.resolve(root))
  if (isValidPackageName(repoDir)) return { activePackage: repoDir, source: 'repo-dir' }
  return { activePackage: null, source: null }
}

function readRootAndGuides(dirInfo, allowedPrefix, maxChars, rootIndexBudget = 300) {
  const parts = []
  let totalLen = 0
  const rootContent = safeReadKnowledge(path.join(dirInfo.path, 'index.md'), allowedPrefix, Math.min(rootIndexBudget, maxChars))
  if (rootContent) {
    parts.push(sanitizeKnowledgeBody(String(rootContent).trim()))
    totalLen += rootContent.length
  }
  const guidesIndex = path.join(dirInfo.path, 'guides', 'index.md')
  if (fs.existsSync(guidesIndex) && totalLen < maxChars) {
    const snippet = safeReadKnowledge(guidesIndex, allowedPrefix, Math.min(200, maxChars - totalLen))
    if (snippet) {
      const block = formatKnowledgeBlock('guides/index.md', snippet)
      if (block && totalLen + block.length + 2 <= maxChars) {
        parts.push(block)
        totalLen += block.length + 2
      }
    }
  }
  return { parts, totalLen }
}

function walkScopedContext(dirInfo, allowedPrefix, subDir, parts, startLen, maxChars, projectRoot, layerIndexBudget = 150) {
  let totalLen = startLen
  const subRoot = path.join(dirInfo.path, subDir)
  if (!fs.existsSync(subRoot) || !fs.statSync(subRoot).isDirectory()) return totalLen
  const layers = fs.readdirSync(subRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of layers) {
    const layerIndex = path.join(subRoot, entry.name, 'index.md')
    const snippet = safeReadKnowledge(layerIndex, allowedPrefix, layerIndexBudget)
    if (!snippet) continue
    const rel = `${subDir}/${entry.name}/index.md`
    const block = formatKnowledgeBlock(rel, snippet)
    if (!block) continue
    const blockLen = block.length + 2
    if (totalLen + blockLen > maxChars) continue
    parts.push(block)
    totalLen += blockLen
  }
  const files = collectMarkdownFiles(subRoot, allowedPrefix)
  for (const filePath of files) {
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
  return totalLen
}

function getKnowledgeContextScoped(projectRoot = process.cwd(), scope = null, maxChars = 2000, options = {}) {
  const dirInfo = getKnowledgeDir(projectRoot)
  if (!dirInfo.exists) return null
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path
  const rawPackage = scope && scope.activePackage ? String(scope.activePackage) : null
  // 对 activePackage 再做一次白名单校验（防御 resolver 外路径、或调用方手工构造 scope）
  const activePackage = rawPackage && isValidPackageName(rawPackage) ? rawPackage : null
  const pkgDir = activePackage ? path.join(dirInfo.path, activePackage) : null
  const pkgExists = pkgDir && fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory()

  // 无 active package 或目录不存在 → 回退到全树（向后兼容）
  if (!pkgExists) return getKnowledgeContext(projectRoot, maxChars)

  const rootIndexBudget = options.rootIndexBudget || 300
  const layerIndexBudget = options.layerIndexBudget || 150
  const { parts, totalLen } = readRootAndGuides(dirInfo, allowedPrefix, maxChars, rootIndexBudget)
  let cursor = totalLen
  // 1) 扫描 {pkg}/ 子树
  cursor = walkScopedContext(dirInfo, allowedPrefix, activePackage, parts, cursor, maxChars, projectRoot, layerIndexBudget)
  // 2) 扫描 guides/ 下的具体 guide 文件（index.md 已在 readRootAndGuides 中处理过）
  if (cursor < maxChars) {
    const guidesDir = path.join(dirInfo.path, 'guides')
    if (fs.existsSync(guidesDir)) {
      const files = collectMarkdownFiles(guidesDir, allowedPrefix)
      for (const filePath of files) {
        const relativePath = path.relative(path.resolve(projectRoot), filePath).replace(/\\/g, '/')
        const remaining = maxChars - cursor
        if (remaining <= 80) break
        const snippet = safeReadKnowledge(filePath, allowedPrefix, Math.min(600, remaining - 32))
        if (!snippet) continue
        const block = formatKnowledgeBlock(relativePath, snippet)
        if (!block) continue
        const blockLen = block.length + 2
        if (cursor + blockLen > maxChars) continue
        parts.push(block)
        cursor += blockLen
      }
    }
  }

  return parts.length ? parts.join('\n\n') : null
}

function getKnowledgeContext(projectRoot = process.cwd(), maxChars = 2000, options = {}) {
  const dirInfo = getKnowledgeDir(projectRoot)
  if (!dirInfo.exists) return null
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path

  const rootIndexBudget = options.rootIndexBudget || Math.min(300, maxChars)
  const layerIndexBudget = options.layerIndexBudget || 150

  const parts = []
  let totalLen = 0
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
    const snippet = safeReadKnowledge(layerIndex, allowedPrefix, layerIndexBudget)
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
  getKnowledgeContextScoped,
  getKnowledgeFiles,
  resolveActiveKnowledgeScope,
  isValidPackageName,
}
