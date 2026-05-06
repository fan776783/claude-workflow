#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { detectProjectIdFromRoot, getWorkflowsDir, getThinkingGuidesDir, getCodeSpecsDir, safeReadJson } = require('./path_utils')
const { findTaskById, extractTaskBlock } = require('./task_parser')

function readFile(targetPath, fallback = '') {
  try {
    return fs.readFileSync(targetPath, 'utf8')
  } catch {
    return fallback
  }
}

function readJson(targetPath, fallback = null) {
  return safeReadJson(targetPath, fallback, (err, p) => ({
    __parse_error: true,
    path: p,
    message: err instanceof Error ? err.message : String(err),
  }))
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
  // 支持绝对路径（新格式）和相对路径（旧格式兼容）
  const specPath = path.isAbsolute(specFile) ? specFile : path.join(path.resolve(projectRoot || process.cwd()), specFile)
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

function safeReadCodeSpecs(filePath, allowedPrefix, maxLen) {
  if (!fs.existsSync(filePath)) return null
  if (!isPathUnderRoot(filePath, allowedPrefix)) return null
  const content = readFile(filePath)
  return maxLen ? content.slice(0, maxLen) : content
}

// 防止 code-specs 内容中嵌入的 </project-code-specs> / <system-reminder> 等标记破坏 hook 注入结构
function sanitizeCodeSpecsBody(content) {
  return String(content || '')
    .replace(/<\/project-code-specs>/gi, '&lt;/project-code-specs&gt;')
    .replace(/<(\/?system[^>]*)>/gi, '&lt;$1&gt;')
    .replace(/<(\/?workflow-context[^>]*)>/gi, '&lt;$1&gt;')
}

function formatCodeSpecsBlock(label, content) {
  const trimmed = String(content || '').trim()
  if (!trimmed) return null
  return `### ${label}\n${sanitizeCodeSpecsBody(trimmed)}`
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

// 合法的 code-specs package 目录名：仅允许 [A-Za-z0-9_.-]；拒绝 `/ \ ..` 等路径分隔符与路径跳转。
// 用于在 resolver / scoped reader 两处做白名单防御。
const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/
function isValidPackageName(name) {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') return false
  return PACKAGE_NAME_PATTERN.test(trimmed)
}

// Target Layer 白名单，必须与 task_parser.normalizeTargetLayer 保持一致。
const TASK_LAYER_WHITELIST = new Set(['frontend', 'backend', 'guides'])
function normalizeTaskLayer(value) {
  if (!value) return null
  const normalized = String(value).trim().toLowerCase()
  return TASK_LAYER_WHITELIST.has(normalized) ? normalized : null
}

// 任务声明的变更文件 hint 做基础清洗，防止进入 scope 时出现奇怪值
function normalizeChangedFileHints(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim().replace(/\\/g, '/')
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function collectTaskChangedHints(task) {
  if (!task || typeof task !== 'object') return []
  const files = task.files || {}
  const parts = []
  for (const key of ['create', 'modify', 'test']) {
    if (Array.isArray(files[key])) parts.push(...files[key])
  }
  return normalizeChangedFileHints(parts)
}

// 规范化 codeSpecs.runtime.scope 配置：
// "active_task"          → { mode: 'active_task' }
// ["pkg-a", "pkg-b"]     → { mode: 'allowlist', packages: ['pkg-a', 'pkg-b'] }
// null / 未设 / 非法值   → null
function normalizeRuntimeScope(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    return trimmed === 'active_task' ? { mode: 'active_task' } : null
  }
  if (Array.isArray(value)) {
    const packages = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry && isValidPackageName(entry))
    return packages.length ? { mode: 'allowlist', packages } : null
  }
  return null
}

// 解析本次 code-specs 读取应聚焦到哪个 package。
// 优先级：flag.package → codeSpecs.runtime.scope → 当前任务的 Package 字段 → 项目配置推断的单包名 → null（soft-fail）
// 单包回退链必须与 spec_bootstrap.resolvePackages 保持对齐：project.name → package.json#name → 仓库目录名。
// 任一来源解析出的 package 名必须通过 isValidPackageName 校验，否则视为未解析，走下一级回退。
//
// runtime.scope 语义（v3 新加）：
//   "active_task"          — 有 task 时等价 task.package；无 task 时 scopeDenied
//   [pkg-a, pkg-b]         — 只在当前 task.package 命中列表时认可；未命中 scopeDenied
// scopeDenied 时 reader 不自动回退全树，由调用方决定渲染（paths-only / 空段 / 提示）。
//
// scope 对象同时携带 taskLayer / changedFileHints 两个可选字段：
//   taskLayer        — 由任务显式声明的 frontend/backend/guides，供 scoped reader 收窄到单 layer
//   changedFileHints — 任务声明的 create/modify/test 文件列表，供 scoped reader 优先命中相关 spec
// 这两个字段**不参与** activePackage 的兜底判断，只对读取顺序起影响，缺失时回退现有行为。
function resolveActiveCodeSpecsScope(runtime, projectConfig = null, overrides = {}) {
  const task = getCurrentTask(runtime)
  const overrideLayer = normalizeTaskLayer(overrides && overrides.taskLayer)
  const taskLayer = overrideLayer || normalizeTaskLayer(task && task.target_layer)
  const overrideHints = normalizeChangedFileHints(overrides && overrides.changedFileHints)
  const changedFileHints = overrideHints.length ? overrideHints : collectTaskChangedHints(task)

  const withScopeExtras = (scope) => ({ ...scope, taskLayer, changedFileHints })

  const flagPackage = overrides && typeof overrides.package === 'string' ? overrides.package.trim() : ''
  if (flagPackage && isValidPackageName(flagPackage)) return withScopeExtras({ activePackage: flagPackage, source: 'flag' })

  const taskPackage = task && typeof task.package === 'string' ? task.package.trim() : ''

  const root = runtime && runtime.projectRoot ? runtime.projectRoot : process.cwd()
  let config = projectConfig
  if (!config) {
    try {
      const configPath = path.join(root, '.claude', 'config', 'project-config.json')
      if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch { /* ignore; fall through */ }
  }

  // runtime.scope 必须在 monorepo 提前 return 之前处理，否则字段永远不起效
  const runtimeScope = normalizeRuntimeScope(((config || {}).codeSpecs || {}).runtime?.scope)
  if (runtimeScope) {
    const taskPackageValid = taskPackage && isValidPackageName(taskPackage)
    if (runtimeScope.mode === 'active_task') {
      if (taskPackageValid) {
        return withScopeExtras({ activePackage: taskPackage, source: 'runtime-scope:active_task' })
      }
      return withScopeExtras({
        activePackage: null,
        source: 'runtime-scope-denied',
        scopeDenied: true,
        reason: 'codeSpecs.runtime.scope=active_task 但当前无 active task',
      })
    }
    if (runtimeScope.mode === 'allowlist') {
      if (taskPackageValid && runtimeScope.packages.includes(taskPackage)) {
        return withScopeExtras({ activePackage: taskPackage, source: 'runtime-scope:allowlist' })
      }
      return withScopeExtras({
        activePackage: null,
        source: 'runtime-scope-denied',
        scopeDenied: true,
        reason: `active task package '${taskPackage || 'none'}' 未落入 runtime.scope allowlist [${runtimeScope.packages.join(', ')}]`,
      })
    }
  }

  if (taskPackage && isValidPackageName(taskPackage)) return withScopeExtras({ activePackage: taskPackage, source: 'task' })

  const projectType = ((config || {}).project || {}).type
  // Monorepo 下不推断默认包，避免把其中一个包当默认污染别的包
  if (projectType === 'monorepo') return withScopeExtras({ activePackage: null, source: null })

  const configName = ((config || {}).project || {}).name
  if (configName) {
    const trimmed = String(configName).trim()
    if (isValidPackageName(trimmed)) return withScopeExtras({ activePackage: trimmed, source: 'config' })
  }
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (pkgJson && pkgJson.name) {
      const stripped = String(pkgJson.name).replace(/^@[^/]+\//, '')
      if (isValidPackageName(stripped)) return withScopeExtras({ activePackage: stripped, source: 'package-json' })
    }
  } catch { /* ignore */ }
  const repoDir = path.basename(path.resolve(root))
  if (isValidPackageName(repoDir)) return withScopeExtras({ activePackage: repoDir, source: 'repo-dir' })
  return withScopeExtras({ activePackage: null, source: null })
}

function readRootAndGuides(dirInfo, allowedPrefix, maxChars, rootIndexBudget = 300) {
  const parts = []
  let totalLen = 0
  const rootContent = safeReadCodeSpecs(path.join(dirInfo.path, 'index.md'), allowedPrefix, Math.min(rootIndexBudget, maxChars))
  if (rootContent) {
    parts.push(sanitizeCodeSpecsBody(String(rootContent).trim()))
    totalLen += rootContent.length
  }
  const guidesIndex = path.join(dirInfo.path, 'guides', 'index.md')
  if (fs.existsSync(guidesIndex) && totalLen < maxChars) {
    const snippet = safeReadCodeSpecs(guidesIndex, allowedPrefix, Math.min(200, maxChars - totalLen))
    if (snippet) {
      const block = formatCodeSpecsBlock('guides/index.md', snippet)
      if (block && totalLen + block.length + 2 <= maxChars) {
        parts.push(block)
        totalLen += block.length + 2
      }
    }
  }
  return { parts, totalLen }
}

// Build scoring key for changedFileHints：只取 hint 文件的 basename 以及去扩展名的 basename。
// 不再加父目录名 token —— 父目录名（如 "backend"）会匹配同 layer 下**所有** spec，
// 把"优先读取 hint 相关 spec"退化成按字母序排列。匹配策略与 hintMatchesSpec 严格对应。
function buildHintTokens(hints) {
  const tokens = new Set()
  for (const hint of hints || []) {
    const normalized = String(hint || '').replace(/\\/g, '/')
    if (!normalized) continue
    const segments = normalized.split('/').filter(Boolean)
    if (!segments.length) continue
    const last = segments[segments.length - 1]
    tokens.add(last.toLowerCase())
    const lastNoExt = last.replace(/\.[^./]+$/, '')
    if (lastNoExt && lastNoExt !== last) tokens.add(lastNoExt.toLowerCase())
  }
  return tokens
}

// 只按 spec basename（含/不含 .md 扩展名）匹配 hint token。
// 禁止对完整相对路径做 substring 搜索——那会让路径里任何一段（pkg 名 / layer 名）误命中。
function hintMatchesSpec(tokens, specPath) {
  if (!tokens || tokens.size === 0) return false
  const basename = path.basename(specPath).toLowerCase()
  if (tokens.has(basename)) return true
  const basenameNoExt = basename.replace(/\.md$/, '')
  if (basenameNoExt && tokens.has(basenameNoExt)) return true
  return false
}

function walkScopedContext(dirInfo, allowedPrefix, subDir, parts, startLen, maxChars, projectRoot, layerIndexBudget = 150, options = {}) {
  const { taskLayer = null, hintTokens = null } = options
  let totalLen = startLen
  const subRoot = path.join(dirInfo.path, subDir)
  if (!fs.existsSync(subRoot) || !fs.statSync(subRoot).isDirectory()) return totalLen
  let layers = fs.readdirSync(subRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))
  // taskLayer 显式声明且命中 layer 目录 → 只读该 layer；未命中 → 不做裁剪（维持现状）
  if (taskLayer) {
    const narrowed = layers.filter((e) => e.name.toLowerCase() === taskLayer)
    if (narrowed.length) layers = narrowed
  }
  for (const entry of layers) {
    const layerIndex = path.join(subRoot, entry.name, 'index.md')
    const snippet = safeReadCodeSpecs(layerIndex, allowedPrefix, layerIndexBudget)
    if (!snippet) continue
    const rel = `${subDir}/${entry.name}/index.md`
    const block = formatCodeSpecsBlock(rel, snippet)
    if (!block) continue
    const blockLen = block.length + 2
    if (totalLen + blockLen > maxChars) continue
    parts.push(block)
    totalLen += blockLen
  }
  const layerFilter = taskLayer
    ? new Set(layers.map((e) => path.join(subRoot, e.name)))
    : null
  const allFiles = collectMarkdownFiles(subRoot, allowedPrefix)
  const files = layerFilter
    ? allFiles.filter((f) => [...layerFilter].some((prefix) => f === prefix || f.startsWith(prefix + path.sep)))
    : allFiles
  // 有 hint tokens 时，先读命中 hint 的 spec，再读其他（在剩余预算内）
  const tokens = hintTokens && hintTokens.size > 0 ? hintTokens : null
  const ordered = tokens
    ? (() => {
        const hits = []
        const rest = []
        for (const filePath of files) {
          if (hintMatchesSpec(tokens, filePath)) hits.push(filePath)
          else rest.push(filePath)
        }
        return [...hits, ...rest]
      })()
    : files
  for (const filePath of ordered) {
    const relativePath = path.relative(path.resolve(projectRoot), filePath).replace(/\\/g, '/')
    const remaining = maxChars - totalLen
    if (remaining <= 80) break
    const snippet = safeReadCodeSpecs(filePath, allowedPrefix, Math.min(600, remaining - 32))
    if (!snippet) continue
    const block = formatCodeSpecsBlock(relativePath, snippet)
    if (!block) continue
    const blockLen = block.length + 2
    if (totalLen + blockLen > maxChars) continue
    parts.push(block)
    totalLen += blockLen
  }
  return totalLen
}

function getCodeSpecsContextScoped(projectRoot = process.cwd(), scope = null, maxChars = 2000, options = {}) {
  const dirInfo = getCodeSpecsDir(projectRoot)
  if (!dirInfo.exists) return null
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path

  // scopeDenied → 不回退全树；返回 null 让调用方自行决定渲染
  if (scope && scope.scopeDenied) return null

  const rawPackage = scope && scope.activePackage ? String(scope.activePackage) : null
  // 对 activePackage 再做一次白名单校验（防御 resolver 外路径、或调用方手工构造 scope）
  const activePackage = rawPackage && isValidPackageName(rawPackage) ? rawPackage : null
  const pkgDir = activePackage ? path.join(dirInfo.path, activePackage) : null
  const pkgExists = pkgDir && fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory()

  // 无 active package 或目录不存在 → 回退到全树（向后兼容；仅非 scopeDenied 场景）
  if (!pkgExists) return getCodeSpecsContext(projectRoot, maxChars)

  const rootIndexBudget = options.rootIndexBudget || 300
  const layerIndexBudget = options.layerIndexBudget || 150
  const taskLayer = normalizeTaskLayer(scope && scope.taskLayer)
  const hintTokens = buildHintTokens((scope && scope.changedFileHints) || [])
  const { parts, totalLen } = readRootAndGuides(dirInfo, allowedPrefix, maxChars, rootIndexBudget)
  let cursor = totalLen
  // 1) 扫描 {pkg}/ 子树；taskLayer 命中时只读该 layer，hint tokens 命中的 spec 优先读取
  cursor = walkScopedContext(dirInfo, allowedPrefix, activePackage, parts, cursor, maxChars, projectRoot, layerIndexBudget, { taskLayer, hintTokens })
  // 2) 扫描 guides/ 下的具体 guide 文件（index.md 已在 readRootAndGuides 中处理过）
  if (cursor < maxChars) {
    const guidesDir = path.join(dirInfo.path, 'guides')
    if (fs.existsSync(guidesDir)) {
      const files = collectMarkdownFiles(guidesDir, allowedPrefix)
      for (const filePath of files) {
        const relativePath = path.relative(path.resolve(projectRoot), filePath).replace(/\\/g, '/')
        const remaining = maxChars - cursor
        if (remaining <= 80) break
        const snippet = safeReadCodeSpecs(filePath, allowedPrefix, Math.min(600, remaining - 32))
        if (!snippet) continue
        const block = formatCodeSpecsBlock(relativePath, snippet)
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

function getCodeSpecsContext(projectRoot = process.cwd(), maxChars = 2000, options = {}) {
  const dirInfo = getCodeSpecsDir(projectRoot)
  if (!dirInfo.exists) return null
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path

  const rootIndexBudget = options.rootIndexBudget || Math.min(300, maxChars)
  const layerIndexBudget = options.layerIndexBudget || 150

  const parts = []
  let totalLen = 0
  const rootContent = safeReadCodeSpecs(path.join(dirInfo.path, 'index.md'), allowedPrefix, rootIndexBudget)
  if (rootContent) {
    parts.push(sanitizeCodeSpecsBody(String(rootContent).trim()))
    totalLen += rootContent.length
  }

  const layers = fs.readdirSync(dirInfo.path, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of layers) {
    const layerIndex = path.join(dirInfo.path, entry.name, 'index.md')
    const snippet = safeReadCodeSpecs(layerIndex, allowedPrefix, layerIndexBudget)
    if (!snippet) continue
    const block = formatCodeSpecsBlock(`${entry.name}/index.md`, snippet)
    if (!block) continue
    const blockLen = block.length + 2
    if (totalLen + blockLen > maxChars) continue
    parts.push(block)
    totalLen += blockLen
  }

  const codeSpecsFiles = collectMarkdownFiles(dirInfo.path, allowedPrefix)
  for (const filePath of codeSpecsFiles) {
    const relativePath = path.relative(path.resolve(projectRoot), filePath).replace(/\\/g, '/')
    const remaining = maxChars - totalLen
    if (remaining <= 80) break
    const snippet = safeReadCodeSpecs(filePath, allowedPrefix, Math.min(600, remaining - 32))
    if (!snippet) continue
    const block = formatCodeSpecsBlock(relativePath, snippet)
    if (!block) continue
    const blockLen = block.length + 2
    if (totalLen + blockLen > maxChars) continue
    parts.push(block)
    totalLen += blockLen
  }

  return parts.length ? parts.join('\n\n') : null
}

// ─── collector / renderer 抽层（v3 Stage A1） ─────────────────────────────
//
// 把"扫描 → 选文件 → 渲染正文"三步解耦：
//   collectSpecFiles(projectRoot, scope, options) → { files, scopeDenied, reason, dirInfo }
//   renderSpecFiles(collection, options)          → string | null
//
// 支持三种 mode：
//   'digest'     — 每文件最多 ~600 字，总预算裁剪（等价历史 getCodeSpecsContext* 行为）
//   'paths-only' — 只输出路径清单 + 一行引导，不读正文
//   'full'       — 每文件不做小预算截断，但仍受总 maxChars 限制
//
// files 条目结构：{ path, relativePath, section: 'root-index' | 'layer-index' | 'guide-index' | 'spec', priority }
// priority 越小越先读取；paths-only 模式下 priority 只影响列表顺序。
const COLLECTOR_DEFAULTS = Object.freeze({
  maxChars: 2000,
  rootIndexBudget: 300,
  layerIndexBudget: 150,
  perFileBudget: 600,
  mode: 'digest',
  pathsOnlyHint: '按 package/layer 用 Read 读取对应 index.md 展开 Pre-Development Checklist',
})

function resolveCollectorOptions(options = {}) {
  return {
    maxChars: options.maxChars || COLLECTOR_DEFAULTS.maxChars,
    rootIndexBudget: options.rootIndexBudget || COLLECTOR_DEFAULTS.rootIndexBudget,
    layerIndexBudget: options.layerIndexBudget || COLLECTOR_DEFAULTS.layerIndexBudget,
    perFileBudget: options.perFileBudget || COLLECTOR_DEFAULTS.perFileBudget,
    mode: options.mode || COLLECTOR_DEFAULTS.mode,
    pathsOnlyHint: options.pathsOnlyHint || COLLECTOR_DEFAULTS.pathsOnlyHint,
  }
}

// 只枚举，不读正文。用于 paths-only 模式、调用方想先看有哪些文件再决定怎么渲染。
function collectSpecFiles(projectRoot = process.cwd(), scope = null, options = {}) {
  const dirInfo = getCodeSpecsDir(projectRoot)
  if (!dirInfo.exists) {
    return { files: [], scopeDenied: false, reason: 'code-specs dir not found', dirInfo: null }
  }
  if (scope && scope.scopeDenied) {
    return { files: [], scopeDenied: true, reason: scope.reason || 'scope denied', dirInfo }
  }
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path
  const rawPackage = scope && scope.activePackage ? String(scope.activePackage) : null
  const activePackage = rawPackage && isValidPackageName(rawPackage) ? rawPackage : null
  const taskLayer = normalizeTaskLayer(scope && scope.taskLayer)
  const hintTokens = buildHintTokens((scope && scope.changedFileHints) || [])

  const files = []
  const rootIndex = path.join(dirInfo.path, 'index.md')
  if (fs.existsSync(rootIndex)) {
    files.push({
      path: rootIndex,
      relativePath: 'index.md',
      section: 'root-index',
      priority: 0,
    })
  }
  const guidesIndex = path.join(dirInfo.path, 'guides', 'index.md')
  if (fs.existsSync(guidesIndex)) {
    files.push({
      path: guidesIndex,
      relativePath: 'guides/index.md',
      section: 'guide-index',
      priority: 10,
    })
  }

  // scoped：只扫 {pkg}/
  const scanRoots = []
  if (activePackage) {
    const pkgDir = path.join(dirInfo.path, activePackage)
    if (fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory()) {
      scanRoots.push({ root: pkgDir, displayPrefix: activePackage })
    }
  } else {
    // 无 scope：扫 code-specs 下所有一级目录（除了 guides，已单独处理）
    for (const entry of fs.readdirSync(dirInfo.path, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (entry.name === 'guides') continue
      scanRoots.push({ root: path.join(dirInfo.path, entry.name), displayPrefix: entry.name })
    }
  }

  for (const { root, displayPrefix } of scanRoots) {
    const layers = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name))
    const filteredLayers = taskLayer
      ? layers.filter((e) => e.name.toLowerCase() === taskLayer)
      : layers
    const layersToScan = filteredLayers.length ? filteredLayers : layers

    for (const layer of layersToScan) {
      const layerPath = path.join(root, layer.name)
      const layerIndex = path.join(layerPath, 'index.md')
      if (fs.existsSync(layerIndex) && isPathUnderRoot(layerIndex, allowedPrefix)) {
        files.push({
          path: layerIndex,
          relativePath: `${displayPrefix}/${layer.name}/index.md`,
          section: 'layer-index',
          priority: 20,
        })
      }
      for (const specPath of collectMarkdownFiles(layerPath, allowedPrefix)) {
        const rel = path.relative(dirInfo.path, specPath).replace(/\\/g, '/')
        files.push({
          path: specPath,
          relativePath: rel,
          section: 'spec',
          priority: hintMatchesSpec(hintTokens, specPath) ? 30 : 40,
        })
      }
    }
  }

  // guides 目录下的具体 guide 文件
  const guidesDir = path.join(dirInfo.path, 'guides')
  if (fs.existsSync(guidesDir)) {
    for (const guidePath of collectMarkdownFiles(guidesDir, allowedPrefix)) {
      const rel = path.relative(dirInfo.path, guidePath).replace(/\\/g, '/')
      files.push({
        path: guidePath,
        relativePath: rel,
        section: 'spec',
        priority: hintMatchesSpec(hintTokens, guidePath) ? 35 : 45,
      })
    }
  }

  files.sort((a, b) => (a.priority - b.priority) || a.relativePath.localeCompare(b.relativePath))
  return { files, scopeDenied: false, reason: null, dirInfo }
}

// 把 collectSpecFiles 的结果渲染成最终 <project-code-specs> 体。
function renderSpecFiles(collection, options = {}) {
  if (!collection || !collection.dirInfo) return null
  const opts = resolveCollectorOptions(options)
  const { files, scopeDenied, reason, dirInfo } = collection
  const allowedPrefix = dirInfo.expectedPrefix || dirInfo.path

  if (scopeDenied) {
    return `_scope denied_: ${reason || 'runtime.scope 未命中'}（无 spec 注入）`
  }
  if (!files.length) return null

  if (opts.mode === 'paths-only') {
    const lines = files.map((f) => `- ${f.relativePath}`)
    return `${opts.pathsOnlyHint}\n\n${lines.join('\n')}`
  }

  const parts = []
  let totalLen = 0

  for (const file of files) {
    const remaining = opts.maxChars - totalLen
    if (remaining <= 80) break
    let sliceLen
    if (file.section === 'root-index') sliceLen = Math.min(opts.rootIndexBudget, remaining)
    else if (file.section === 'layer-index' || file.section === 'guide-index') sliceLen = Math.min(opts.layerIndexBudget, remaining)
    else if (opts.mode === 'full') sliceLen = remaining - 32
    else sliceLen = Math.min(opts.perFileBudget, remaining - 32)
    const snippet = safeReadCodeSpecs(file.path, allowedPrefix, sliceLen)
    if (!snippet) continue
    if (file.section === 'root-index') {
      const body = sanitizeCodeSpecsBody(String(snippet).trim())
      if (!body) continue
      parts.push(body)
      totalLen += body.length
    } else {
      const block = formatCodeSpecsBlock(file.relativePath, snippet)
      if (!block) continue
      const blockLen = block.length + 2
      if (totalLen + blockLen > opts.maxChars) continue
      parts.push(block)
      totalLen += blockLen
    }
  }
  return parts.length ? parts.join('\n\n') : null
}

function getCodeSpecsFiles(projectRoot = process.cwd()) {
  const dirInfo = getCodeSpecsDir(projectRoot)
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
  getCodeSpecsContext,
  getCodeSpecsContextScoped,
  getCodeSpecsFiles,
  collectSpecFiles,
  renderSpecFiles,
  resolveActiveCodeSpecsScope,
  normalizeRuntimeScope,
  isValidPackageName,
  normalizeTaskLayer,
  normalizeChangedFileHints,
  collectTaskChangedHints,
}
