#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { getCodeSpecsDir } = require('./path_utils')

const FRONTEND_FRAMEWORKS = new Set(['react', 'vue', 'angular', 'svelte', 'solid', 'preact', 'next', 'nuxt', 'remix', 'qwik'])
const BACKEND_FRAMEWORKS = new Set(['express', 'fastify', 'nest', 'koa', 'go', 'gin', 'django', 'flask', 'fastapi', 'rails', 'spring', 'spring-boot', 'rust', 'actix'])

// framework -> 栈模板名；命中任一 framework 即推断对应栈
const FRAMEWORK_TO_STACK = {
  vue: 'vue-nuxt',
  nuxt: 'vue-nuxt',
  react: 'react-next',
  next: 'react-next',
  express: 'node-express',
  fastify: 'node-express',
  nest: 'node-express',
}

function resolveStackFromFrameworks(frameworks = []) {
  const lower = frameworks.map((item) => String(item || '').toLowerCase().trim()).filter(Boolean)
  for (const fw of lower) {
    if (FRAMEWORK_TO_STACK[fw]) return FRAMEWORK_TO_STACK[fw]
  }
  return null
}

function resolveTemplatesDir() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'specs', 'spec-templates'),
    path.join(os.homedir(), '.agents', 'agent-workflow', 'core', 'specs', 'spec-templates'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
  }
  return candidates[0]
}

// v2.2: 栈模板根目录（完整目录模板）
function resolveStackTemplatesDir() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'specs', 'stack-templates'),
    path.join(os.homedir(), '.agents', 'agent-workflow', 'core', 'specs', 'stack-templates'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
  }
  return candidates[0]
}

// 加载栈模板 manifest；失败返回 null（允许 bootstrap 继续按 frameworks 推断）
function loadStackTemplate(stackName) {
  if (!stackName) return null
  const stackDir = path.join(resolveStackTemplatesDir(), stackName)
  const manifestPath = path.join(stackDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return { ...manifest, stackDir, manifestPath }
  } catch {
    return null
  }
}

// 根据 layer 名生成叙事化标题（如 "Backend Development Guidelines"）
function narrativeLayerTitle(layer) {
  const map = {
    frontend: 'Frontend Development Guidelines',
    backend: 'Backend Development Guidelines',
    'unit-test': 'Unit Test Guidelines',
    test: 'Test Guidelines',
    docs: 'Documentation Guidelines',
  }
  if (map[layer]) return map[layer]
  // fallback：首字母大写 + Development Guidelines
  const label = String(layer || 'Code')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return `${label} Development Guidelines`
}

// 拷贝栈模板文件（走 render 替换占位符）
// scope: 'core' | 'full' | 'minimal'
function copyStackLayerFiles({ stack, layer, targetDir, scope = 'core', pkg = '' }) {
  const copied = []
  if (!stack || !stack.stackDir || !stack.layers || !stack.layers[layer]) return copied
  const layerSrcDir = path.join(stack.stackDir, layer)
  if (!fs.existsSync(layerSrcDir)) return copied

  const renderValues = {
    layer_name: narrativeLayerTitle(layer),
    layer: layer,
    package_name: pkg,
    package: pkg,
  }

  const renderCopy = (src, dst) => {
    if (!fs.existsSync(src)) return false
    if (fs.existsSync(dst)) return false
    const raw = fs.readFileSync(src, 'utf8')
    const rendered = renderTemplate(raw, renderValues)
    fs.writeFileSync(dst, rendered, 'utf8')
    return true
  }

  // 总是拷贝 index.md（若存在）
  const indexSrc = path.join(layerSrcDir, 'index.md')
  const indexDst = path.join(targetDir, 'index.md')
  if (renderCopy(indexSrc, indexDst)) copied.push(indexDst)

  if (scope === 'minimal') return copied

  const layerCfg = stack.layers[layer] || {}
  const coreTopics = Array.isArray(layerCfg.core) ? layerCfg.core : []
  const optionalTopics = Array.isArray(layerCfg.optional) ? layerCfg.optional : []
  const topics = scope === 'full' ? [...coreTopics, ...optionalTopics] : coreTopics

  for (const topic of topics) {
    const src = path.join(layerSrcDir, `${topic}.md`)
    const dst = path.join(targetDir, `${topic}.md`)
    if (renderCopy(src, dst)) copied.push(dst)
  }

  return copied
}

function readTemplate(name) {
  const templatesDir = resolveTemplatesDir()
  const filePath = path.join(templatesDir, name)
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function renderTemplate(template, values = {}) {
  let output = String(template || '')
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{{${key}}}`).join(String(value ?? ''))
  }
  return output
}

function classifyFrameworks(frameworks = []) {
  const lower = frameworks.map((item) => String(item || '').toLowerCase().trim()).filter(Boolean)
  const hasFrontend = lower.some((item) => FRONTEND_FRAMEWORKS.has(item))
  const hasBackend = lower.some((item) => BACKEND_FRAMEWORKS.has(item))
  return { hasFrontend, hasBackend }
}

// v2.2: layer 解析拆分为 bootstrap 期和 runtime 期两套优先级
// runtime 以真实目录发现优先，bootstrap 以模板声明优先
function resolveLayersForBootstrap({ stack, frameworks = [] } = {}) {
  // 1. 栈模板 manifest 显式声明
  if (stack && stack.layers && typeof stack.layers === 'object') {
    const declared = Object.keys(stack.layers)
    if (declared.length > 0) return { layers: declared, source: 'stack.manifest' }
  }
  // 2. tech.frameworks 推断
  const { hasFrontend, hasBackend } = classifyFrameworks(frameworks)
  const layers = []
  if (hasFrontend) layers.push('frontend')
  if (hasBackend) layers.push('backend')
  if (layers.length > 0) return { layers, source: 'frameworks' }
  // 3. fallback
  return { layers: ['frontend'], source: 'fallback' }
}

function resolveLayersForRuntime({ baseDir, pkg, layersHint } = {}) {
  // 1. 扫描真实目录：{baseDir}/{pkg}/*/index.md
  const pkgDir = path.join(baseDir, pkg)
  if (fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory()) {
    const layers = []
    for (const entry of fs.readdirSync(pkgDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (fs.existsSync(path.join(pkgDir, entry.name, 'index.md'))) {
        layers.push(entry.name)
      }
    }
    if (layers.length > 0) return { layers, source: 'existing-index' }
  }
  // 2. config 的 runtime.layersHint
  if (layersHint && Array.isArray(layersHint[pkg]) && layersHint[pkg].length > 0) {
    return { layers: layersHint[pkg].slice(), source: 'config.layersHint' }
  }
  // 3. soft warning：让调用方提示用户 --layer
  return {
    layers: [],
    source: null,
    warning: `package "${pkg}" 下未找到任何 layer index.md；请用 --layer 指定或先跑 /spec-bootstrap。`,
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return { written: false, reason: 'exists', path: filePath }
  fs.writeFileSync(filePath, content, 'utf8')
  return { written: true, path: filePath }
}

function rmTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// --reset 的完整清理：code-specs 目录 + 00-task + 子目录 + config.codeSpecs 残留字段
// 保留用户手工配的 codeSpecs.packages，避免 reset 丢失白名单。
function resetBootstrapState({ projectRoot, baseDir }) {
  if (fs.existsSync(baseDir)) rmTree(baseDir)

  const tasksDir = path.join(projectRoot, '.claude', 'tasks')
  const legacyTask = path.join(tasksDir, '00-bootstrap-guidelines.md')
  if (fs.existsSync(legacyTask)) fs.rmSync(legacyTask, { force: true })
  const subTaskDir = path.join(tasksDir, 'spec-bootstrap')
  if (fs.existsSync(subTaskDir)) rmTree(subTaskDir)

  const { configPath, config } = loadProjectConfig(projectRoot)
  if (config && config.codeSpecs) {
    const preservedPackages = config.codeSpecs.packages
    config.codeSpecs = preservedPackages ? { packages: preservedPackages } : {}
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function buildRootIndex() {
  return readTemplate('index-template.md') || '# Project Code Specs\n'
}

function buildLayerIndex(layerName, description) {
  const template = readTemplate('layer-index-template.md')
  if (!template) return `# ${layerName} Code Specs\n`
  return renderTemplate(template, {
    layer_name: layerName,
    layer_description: description,
  })
}

function buildGuidesIndex() {
  const template = readTemplate('guides-index-template.md')
  if (!template) return '# Guides\n\n> 共享思考清单。\n'
  return template
}

function buildLocalDoc() {
  const template = readTemplate('local-template.md')
  const date = today()
  return renderTemplate(template, {
    canonical_date: date,
    reason_or_none: '(待填写)',
    none_yet: '(none yet)',
    date,
    package_name: '(待填写)',
  })
}

function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return { configPath, config: null }
  try {
    return { configPath, config: JSON.parse(fs.readFileSync(configPath, 'utf8')) }
  } catch {
    return { configPath, config: null }
  }
}

function updateBootstrapStatus(projectRoot, status) {
  const { configPath, config } = loadProjectConfig(projectRoot)
  if (!config) return { updated: false, reason: 'no_config', path: configPath }
  config.codeSpecs = config.codeSpecs || {}
  config.codeSpecs.bootstrapStatus = status
  config.codeSpecs.updatedAt = new Date().toISOString()
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return { updated: true, path: configPath, status }
}

function readBootstrapStatus(projectRoot) {
  const { config } = loadProjectConfig(projectRoot)
  if (!config || !config.codeSpecs) return null
  return config.codeSpecs.bootstrapStatus || null
}

// v3 Stage A3：monorepo + 未设 runtime.scope 时自动写 "active_task"。
// 单包项目不写（无意义），已有值（包括 null）不覆盖。
function initRuntimeScope(projectRoot) {
  const { configPath, config } = loadProjectConfig(projectRoot)
  if (!config) return { updated: false, reason: 'no_config' }
  const projectType = (config.project || {}).type
  if (projectType !== 'monorepo') return { updated: false, reason: 'not_monorepo' }
  config.codeSpecs = config.codeSpecs || {}
  config.codeSpecs.runtime = config.codeSpecs.runtime || {}
  if (Object.prototype.hasOwnProperty.call(config.codeSpecs.runtime, 'scope')) {
    return { updated: false, reason: 'already_set', value: config.codeSpecs.runtime.scope }
  }
  config.codeSpecs.runtime.scope = 'active_task'
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return { updated: true, path: configPath, value: 'active_task' }
}

function countCodeSpecsStats(projectRoot) {
  const dirInfo = getCodeSpecsDir(projectRoot)
  if (!dirInfo.exists) return { exists: false, total: 0, filled: 0, draft: 0 }
  let total = 0
  let filled = 0
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      total += 1
      try {
        const content = fs.readFileSync(full, 'utf8')
        if (!/\(To be filled|\{\{[^}]+\}\}/.test(content)) filled += 1
      } catch { /* skip */ }
    }
  }
  walk(dirInfo.path)
  return { exists: true, total, filled, draft: total - filled }
}

// v2.2: packages 解析支持 codeSpecs.packages.include / exclude
// - monorepo: include 显式声明优先；未声明且走 fallback 检测时给 warning
// - single-package: 自动推断单包，不强制 include
function matchesPatterns(name, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false
  for (const raw of patterns) {
    const pattern = String(raw || '').trim()
    if (!pattern) continue
    // 简单 glob 支持：* 匹配任意字符
    const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    if (regex.test(name)) return true
  }
  return false
}

function resolvePackages({ projectRoot, config }) {
  const codeSpecsPkgCfg = (((config || {}).codeSpecs || {}).packages) || {}
  const includeList = Array.isArray(codeSpecsPkgCfg.include) ? codeSpecsPkgCfg.include.map((x) => String(x).trim()).filter(Boolean) : null
  const excludePatterns = Array.isArray(codeSpecsPkgCfg.exclude) ? codeSpecsPkgCfg.exclude : []

  const applyExclude = (list) => list.filter((name) => !matchesPatterns(name, excludePatterns))

  // 1. codeSpecs.packages.include 显式声明（最高优先级）
  if (includeList && includeList.length > 0) {
    return { packages: applyExclude(includeList), source: 'config.codeSpecs.packages.include' }
  }

  // 2. 历史字段 monorepo.packages（向后兼容）
  const monorepoPackages = ((config || {}).monorepo || {}).packages
  if (Array.isArray(monorepoPackages) && monorepoPackages.length > 0) {
    const list = monorepoPackages.map((item) => String(item).trim()).filter(Boolean)
    if (list.length > 0) return { packages: applyExclude(list), source: 'config.monorepo.packages' }
  }

  const projectType = ((config || {}).project || {}).type

  // 3. monorepo 未显式声明 include → 自动扫描（应用默认过滤器，给 warning 推荐显式 include）
  if (projectType === 'monorepo') {
    const detected = detectWorkspacePackages(projectRoot)
    if (detected.packages.length > 0) {
      const filtered = applyDefaultFilters({
        packages: applyExclude(detected.packages),
        config,
      })
      return {
        packages: filtered.included,
        source: detected.source,
        autoExcluded: filtered.autoExcluded,
        warning: 'monorepo 未显式配置 codeSpecs.packages.include，已自动展开 workspace 并应用默认过滤器（archived / auxiliary / config-only）。建议运行交互式选择或手动声明 include 白名单。',
      }
    }
    return {
      packages: [],
      source: null,
      error: 'monorepo_packages_unresolved',
      message: 'project.type=monorepo，但未声明 codeSpecs.packages.include / monorepo.packages，且未能从 pnpm-workspace.yaml / package.json workspaces / lerna.json 检测到 workspace。请在 project-config.json 补上 codeSpecs.packages.include 后重跑。',
    }
  }

  // 4. single-package：自动推断
  const projectName = ((config || {}).project || {}).name
    || readPackageJsonName(projectRoot)
    || path.basename(path.resolve(projectRoot))
  return { packages: applyExclude([projectName]), source: 'project.name' }
}

// 自动过滤 archived / auxiliary / config-only 包。
// 可通过 codeSpecs.packages.skipDefaultFilters 关闭；configPackagePatterns 可覆盖匹配规则。
function applyDefaultFilters({ packages, config }) {
  const cfg = config || {}
  const codeSpecsPkgCfg = ((cfg.codeSpecs || {}).packages) || {}
  if (codeSpecsPkgCfg.skipDefaultFilters === true) {
    return { included: packages.slice(), autoExcluded: { archived: [], auxiliary: [], configOnly: [] } }
  }
  const archived = new Set((cfg.structure && cfg.structure.archivedApps) || [])
  const auxiliary = new Set((cfg.structure && cfg.structure.auxiliaryApps) || [])
  const configPatterns = Array.isArray(codeSpecsPkgCfg.configPackagePatterns)
    ? codeSpecsPkgCfg.configPackagePatterns
    : ['*-config', '*-preset', 'tsconfig', 'tsconfig-*']

  const bucket = { archived: [], auxiliary: [], configOnly: [] }
  const included = []
  for (const name of packages) {
    if (archived.has(name)) { bucket.archived.push(name); continue }
    if (auxiliary.has(name)) { bucket.auxiliary.push(name); continue }
    if (matchesPatterns(name, configPatterns)) { bucket.configOnly.push(name); continue }
    included.push(name)
  }
  return { included, autoExcluded: bucket }
}

function readPackageJsonName(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
    return pkg && pkg.name ? String(pkg.name).replace(/^@[^/]+\//, '') : null
  } catch {
    return null
  }
}

function detectWorkspacePackages(projectRoot) {
  const root = path.resolve(projectRoot)

  const fromPnpm = readPnpmWorkspaces(root)
  if (fromPnpm.length > 0) return { packages: fromPnpm, source: 'pnpm-workspace.yaml' }

  const fromPackageJson = readPackageJsonWorkspaces(root)
  if (fromPackageJson.length > 0) return { packages: fromPackageJson, source: 'package.json#workspaces' }

  const fromLerna = readLernaWorkspaces(root)
  if (fromLerna.length > 0) return { packages: fromLerna, source: 'lerna.json' }

  return { packages: [], source: null }
}

function readPnpmWorkspaces(root) {
  const file = path.join(root, 'pnpm-workspace.yaml')
  if (!fs.existsSync(file)) return []
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const patterns = []
    let inPackages = false
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      if (/^packages\s*:/i.test(trimmed)) { inPackages = true; continue }
      if (inPackages) {
        const match = trimmed.match(/^-\s*['"]?([^'"]+)['"]?\s*$/)
        if (match) { patterns.push(match[1]); continue }
        if (!/^[-\s]/.test(line)) break
      }
    }
    return expandWorkspacePatterns(root, patterns)
  } catch {
    return []
  }
}

function readPackageJsonWorkspaces(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const ws = pkg && pkg.workspaces
    const patterns = Array.isArray(ws) ? ws : Array.isArray(ws && ws.packages) ? ws.packages : []
    return expandWorkspacePatterns(root, patterns)
  } catch {
    return []
  }
}

function readLernaWorkspaces(root) {
  const file = path.join(root, 'lerna.json')
  if (!fs.existsSync(file)) return []
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    return expandWorkspacePatterns(root, Array.isArray(cfg.packages) ? cfg.packages : [])
  } catch {
    return []
  }
}

function expandWorkspacePatterns(root, patterns) {
  const results = new Set()
  for (const raw of patterns) {
    const pattern = String(raw || '').trim().replace(/\/+$/, '')
    if (!pattern || pattern.startsWith('!')) continue
    if (pattern.endsWith('/*')) {
      const parentRel = pattern.slice(0, -2)
      const parent = path.join(root, parentRel)
      if (!fs.existsSync(parent)) continue
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (fs.existsSync(path.join(parent, entry.name, 'package.json'))) {
          results.add(entry.name)
        }
      }
    } else if (!pattern.includes('*')) {
      const full = path.join(root, pattern)
      if (fs.existsSync(path.join(full, 'package.json'))) {
        results.add(path.basename(full))
      }
    }
  }
  return Array.from(results)
}

function detectLegacyLayout(baseDir) {
  const legacyFrontend = path.join(baseDir, 'frontend')
  const legacyBackend = path.join(baseDir, 'backend')
  const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory()
  if (isDir(legacyFrontend) || isDir(legacyBackend)) {
    return { isLegacy: true, paths: [legacyFrontend, legacyBackend].filter(isDir) }
  }
  return { isLegacy: false, paths: [] }
}

function initCodeSpecsSkeleton({
  projectRoot = process.cwd(),
  frameworks = [],
  force = false,
  reset = false,
  stack: stackName = null,
  noStack = false,
  scope = 'core', // 'core' | 'full' | 'minimal'
} = {}) {
  const root = path.resolve(projectRoot)
  const dirInfo = getCodeSpecsDir(root)
  const baseDir = dirInfo.exists ? dirInfo.path : path.join(root, '.claude', 'code-specs')

  const legacy = detectLegacyLayout(baseDir)
  if (legacy.isLegacy && !reset) {
    return {
      baseDir,
      generated: [],
      error: 'legacy_layout_detected',
      message: '检测到旧版布局（.claude/code-specs/{frontend,backend}/）。本项目已切换为 {package}/{layer}/ 二维结构，不提供自动迁移。确认无重要数据后使用 init --reset 重建。',
      legacyPaths: legacy.paths.map((p) => path.relative(root, p)),
    }
  }

  if (reset) {
    resetBootstrapState({ projectRoot: root, baseDir })
  }
  ensureDir(baseDir)

  const { config } = loadProjectConfig(root)
  const packageResolution = resolvePackages({ projectRoot: root, config })
  if (packageResolution.error) {
    return {
      baseDir,
      generated: [],
      error: packageResolution.error,
      message: packageResolution.message,
    }
  }
  const packages = packageResolution.packages
  if (!packages.length) {
    // packages 被默认 filters 吃光时不能继续写骨架/00-task，否则 firstPackage 会被伪造为 'app'
    // 指向不存在的路径。要求用户放宽 filters 或显式声明 include 白名单。
    const autoExcluded = packageResolution.autoExcluded || null
    return {
      baseDir,
      generated: [],
      error: 'packages_all_excluded',
      message: autoExcluded
        ? 'monorepo 的所有 workspace 包都被默认过滤器（archived / auxiliary / config-only）吃掉了。请声明 codeSpecs.packages.include 白名单，或设置 codeSpecs.packages.skipDefaultFilters=true 放宽过滤。'
        : '未解析到任何 package，请声明 codeSpecs.packages.include。',
      autoExcluded,
    }
  }

  // v2.2: 加载栈模板（可选）
  // 栈决策优先级：--no-stack 显式跳过 > --stack 显式指定 > frameworks 推断 > 无（空骨架）
  let resolvedStackName = stackName
  let stackSource = stackName ? 'explicit' : 'none'
  if (!noStack && !stackName) {
    const inferred = resolveStackFromFrameworks(frameworks)
    if (inferred) {
      resolvedStackName = inferred
      stackSource = 'inferred'
    }
  }
  if (noStack) {
    resolvedStackName = null
    stackSource = 'disabled'
  }
  const stack = resolvedStackName ? loadStackTemplate(resolvedStackName) : null
  if (resolvedStackName && !stack && stackSource === 'inferred') {
    // 推断出的栈不存在模板时回退为 none，而不是报 warning
    resolvedStackName = null
    stackSource = 'fallback'
  }
  const stackWarning = stackName && !stack && stackSource === 'explicit'
    ? `未找到栈模板 "${stackName}"，已回退到 frameworks 推断。期望路径：${path.join(resolveStackTemplatesDir(), stackName)}`
    : null

  const layerResolution = resolveLayersForBootstrap({ stack, frameworks })
  const defaultLayers = layerResolution.layers
  const { hasFrontend, hasBackend } = classifyFrameworks(frameworks)

  const generated = []
  const copiedByStack = []

  const rootIndex = path.join(baseDir, 'index.md')
  const rootResult = writeIfMissing(rootIndex, buildRootIndex())
  if (rootResult.written) generated.push(path.relative(root, rootIndex))

  // 生成 layer：优先用栈模板拷贝；无栈模板时回退到空 index.md
  const generateLayer = (pkg, layer, description) => {
    const dir = path.join(baseDir, pkg, layer)
    ensureDir(dir)

    if (stack && stack.layers && stack.layers[layer]) {
      const copied = copyStackLayerFiles({ stack, layer, targetDir: dir, scope, pkg })
      for (const abs of copied) {
        const rel = path.relative(root, abs)
        generated.push(rel)
        copiedByStack.push(rel)
      }
      // 栈模板若没有 index.md，兜底写一份默认
      const layerIndex = path.join(dir, 'index.md')
      if (!fs.existsSync(layerIndex)) {
        const res = writeIfMissing(layerIndex, buildLayerIndex(`${pkg} / ${layer}`, description))
        if (res.written) generated.push(path.relative(root, layerIndex))
      }
    } else {
      const layerIndex = path.join(dir, 'index.md')
      const res = writeIfMissing(layerIndex, buildLayerIndex(`${pkg} / ${layer}`, description))
      if (res.written) generated.push(path.relative(root, layerIndex))
    }
  }

  // 决定每个 package 生成哪些 layer
  const layersPerPackage = force
    ? ['frontend', 'backend']
    : defaultLayers

  for (const pkg of packages) {
    for (const layer of layersPerPackage) {
      const desc = layer === 'frontend'
        ? '前端代码规范（convention 风格；契约类用 contract 模板）'
        : layer === 'backend'
          ? '后端代码规范（convention 风格；契约类用 contract 模板）'
          : `${layer} 代码规范`
      generateLayer(pkg, layer, desc)
    }
  }

  const guidesDir = path.join(baseDir, 'guides')
  ensureDir(guidesDir)
  const guidesIndex = path.join(guidesDir, 'index.md')
  const guidesRes = writeIfMissing(guidesIndex, buildGuidesIndex())
  if (guidesRes.written) generated.push(path.relative(root, guidesIndex))

  const localPath = path.join(baseDir, 'local.md')
  const localRes = writeIfMissing(localPath, buildLocalDoc())
  if (localRes.written) generated.push(path.relative(root, localPath))

  // v2.2 Change 10: 写入 .template-hashes.json
  const hashesPath = writeTemplateHashes({ baseDir, stack })
  if (hashesPath) generated.push(path.relative(root, hashesPath))

  // v2.2 Change 1d: 生成 00-bootstrap-guidelines 任务
  const bootstrapResult = writeBootstrapTask({
    root,
    stack,
    stackName: stack ? stack.name || resolvedStackName : null,
    generated: copiedByStack,
    packages,
    layers: layersPerPackage,
    config,
  })
  if (bootstrapResult && bootstrapResult.taskPath) generated.push(path.relative(root, bootstrapResult.taskPath))

  const configUpdate = updateBootstrapStatus(root, 'done')
  initRuntimeScope(root)

  const pendingPackages = packageResolution.autoExcluded
    ? {
        included: packages,
        autoExcluded: packageResolution.autoExcluded,
      }
    : null

  const plan = bootstrapResult && bootstrapResult.plan
  const taskFilePathRel = bootstrapResult && bootstrapResult.taskPath
    ? path.relative(root, bootstrapResult.taskPath)
    : null
  const nextActions = plan
    ? {
        primary: taskFilePathRel
          ? {
              type: 'open-file',
              path: taskFilePathRel,
              hint: `按任务书第一步从 ${plan.firstPackage} 开始`,
            }
          : null,
        firstTargetFile: plan.firstTargetFile,
        firstTargetSourceDir: plan.firstTargetSourceDir,
        grepHint: plan.grepHint,
        referenceFile: plan.referenceFile,
        estimatedTimePerFile: '10-15min',
        commitHint: 'git add .claude/code-specs/ .claude/tasks/ .claude/config/project-config.json && git commit',
        remainingPackages: plan.remainingPackages,
      }
    : null

  return {
    baseDir,
    packages,
    packagesSource: packageResolution.source,
    packagesWarning: packageResolution.warning || null,
    pendingPackages,
    generated,
    hasFrontend,
    hasBackend,
    stack: stack ? stack.name || resolvedStackName : null,
    stackSource,
    stackWarning,
    scope,
    layers: layersPerPackage,
    layersSource: layerResolution.source,
    reset,
    configUpdate,
    nextActions,
  }
}

// v2.2: .template-hashes.json 写入（取代 local.md 的 Template Baseline 表）
function writeTemplateHashes({ baseDir, stack }) {
  const templatesDir = resolveTemplatesDir()
  const templateFiles = [
    'convention-template.md',
    'code-spec-template.md',
    'layer-index-template.md',
    'index-template.md',
    'local-template.md',
    'guides-index-template.md',
    'guide-template.md',
  ]
  const baselines = {}
  for (const name of templateFiles) {
    const p = path.join(templatesDir, name)
    if (!fs.existsSync(p)) continue
    try {
      const content = fs.readFileSync(p)
      baselines[name] = 'sha256:' + crypto.createHash('sha256').update(content).digest('hex')
    } catch { /* skip */ }
  }
  const payload = {
    version: detectCanonicalVersion(),
    recordedAt: new Date().toISOString(),
    stack: stack ? stack.name || null : null,
    baselines,
  }
  const hashesPath = path.join(baseDir, '.template-hashes.json')
  if (!fs.existsSync(hashesPath)) {
    fs.writeFileSync(hashesPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    return hashesPath
  }
  return null
}

function detectCanonicalVersion() {
  const manifestsDir = path.join(resolveTemplatesDir(), 'manifests')
  if (!fs.existsSync(manifestsDir)) return 'unknown'
  try {
    const files = fs.readdirSync(manifestsDir).filter((n) => /^v\d+\.\d+\.\d+\.json$/.test(n)).sort()
    if (files.length === 0) return 'unknown'
    const latest = files[files.length - 1]
    const manifest = JSON.parse(fs.readFileSync(path.join(manifestsDir, latest), 'utf8'))
    return manifest.version || latest.replace(/^v|\.json$/g, '')
  } catch {
    return 'unknown'
  }
}

// v2.2 Change 1d: 生成 00-bootstrap-guidelines.md 任务文件
// 核心原则：Document Reality, Not Ideals
function writeBootstrapTask({ root, stack, stackName, generated, packages, layers, config }) {
  const tasksDir = path.join(root, '.claude', 'tasks')
  // 若已有 workflow tasks，放到子目录避免冲突
  const hasExistingTasks = fs.existsSync(tasksDir) && fs.readdirSync(tasksDir)
    .some((name) => /^\d{2}-/.test(name) && !name.startsWith('00-bootstrap-guidelines'))
  const targetDir = hasExistingTasks ? path.join(tasksDir, 'spec-bootstrap') : tasksDir
  ensureDir(targetDir)
  const taskPath = path.join(targetDir, '00-bootstrap-guidelines.md')
  const plan = computeBootstrapPlan({ projectRoot: root, stack, stackName, generated, packages, layers, config })
  if (fs.existsSync(taskPath)) {
    return { taskPath: null, plan }
  }

  const template = readTemplate('bootstrap-task-template.md')
  const renderValues = {
    date: today(),
    stack_name: stackName || '(未指定)',
    packages: plan.sortedPackages.join(', '),
    layers: layers.join(', '),
    file_list: plan.fileListMarkdown,
    first_package: plan.firstPackage,
    first_layer: plan.firstLayer,
    first_topic: plan.firstTopic,
    first_target_file: plan.firstTargetFile,
    first_target_source_dir: plan.firstTargetSourceDir || `(请手动定位 ${plan.firstPackage} 源码目录)`,
    grep_hint: plan.grepHint,
    reference_block: plan.referenceFile
      ? `**参考范例**：打开 \`${plan.referenceFile}\` 看一下填满后的样子再动手，可省掉"不知道该写什么"的来回。`
      : '',
    remaining_packages_block: buildRemainingPackagesBlock(plan.remainingPackages, plan.firstLayer, plan.firstTopic),
  }
  const content = template
    ? renderTemplate(template, renderValues)
    : buildDefaultBootstrapTask(renderValues)

  fs.writeFileSync(taskPath, content, 'utf8')
  return { taskPath, plan }
}

// 计算 bootstrap plan：首靶子 package / layer / topic / grepHint / 剩余包顺序
// 同时服务 writeBootstrapTask（任务文件渲染）与 nextActions（skill 输出）
function computeBootstrapPlan({ projectRoot, stack, stackName, generated, packages, layers, config }) {
  const sortedPackages = computePackageFillOrder({ config, packages })
  const firstPackage = sortedPackages[0] || packages[0]
  if (!firstPackage) {
    throw new Error('computeBootstrapPlan called with empty packages; caller must guard packages.length > 0')
  }
  const firstLayer = pickFirstLayer({ stack, layers })
  const firstTopic = pickFirstTopic({ stack, layer: firstLayer })
  const firstTargetFile = `.claude/code-specs/${firstPackage}/${firstLayer}/${firstTopic}.md`
  const firstTargetSourceDir = resolvePackageSourceDir({ projectRoot, pkg: firstPackage, config })
  const grepHint = buildGrepHint({ stack, stackName, layer: firstLayer, topic: firstTopic, sourceDir: firstTargetSourceDir })
  const referenceFile = resolveReferenceFile({ stack, stackName, layer: firstLayer, topic: firstTopic })
  const fileListMarkdown = generated.length > 0
    ? generated.map((f) => `- \`${f}\``).join('\n')
    : '- （本次未由栈模板生成主题文件，请先跑 /spec-update 手动创建或指定 --stack）'
  return {
    sortedPackages,
    firstPackage,
    firstLayer,
    firstTopic,
    firstTargetFile,
    firstTargetSourceDir,
    grepHint,
    referenceFile,
    fileListMarkdown,
    remainingPackages: sortedPackages.slice(1),
  }
}

// 寻找 _reference/{topic}.md 参考范例；不存在返回 null
function resolveReferenceFile({ stack, stackName, layer, topic }) {
  const name = (stack && stack.name) || stackName
  if (!name) return null
  const stacksDir = resolveStackTemplatesDir()
  const candidates = [
    path.join(stacksDir, name, '_reference', `${topic}.md`),
    path.join(stacksDir, name, '_reference', layer, `${topic}.md`),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// 按 config 线索推断 package 填充优先级：主应用 > active apps > sharedLibs（引用数降序） > 字母序
function computePackageFillOrder({ config, packages }) {
  const list = Array.isArray(packages) ? packages.slice() : []
  if (list.length <= 1) return list
  const cfg = config || {}
  const apps = (cfg.structure && cfg.structure.apps) || cfg.apps || {}
  const archived = new Set(((cfg.structure || {}).archivedApps) || [])
  const auxiliary = new Set(((cfg.structure || {}).auxiliaryApps) || [])
  const sharedLibs = (cfg.structure && cfg.structure.sharedLibs) || {}

  const weightOf = (name) => {
    const entry = apps[name]
    if (entry && entry.isMainApp) return 0
    if (entry && entry.status === 'active') return 1
    if (entry) return 2
    if (sharedLibs[name]) {
      const refs = sharedLibs[name].customPaths
      const count = Array.isArray(refs) ? refs.length : (refs && typeof refs === 'object' ? Object.keys(refs).length : 0)
      return 3 - Math.min(count, 2) * 0.01 // 引用越多越靠前，但仍晚于 apps
    }
    if (archived.has(name)) return 10
    if (auxiliary.has(name)) return 9
    return 4
  }

  return list
    .map((name, idx) => ({ name, idx, weight: weightOf(name) }))
    .sort((a, b) => (a.weight - b.weight) || a.name.localeCompare(b.name) || (a.idx - b.idx))
    .map((item) => item.name)
}

function pickFirstLayer({ stack, layers }) {
  if (stack && stack.layers) {
    const declared = Object.keys(stack.layers)
    if (declared.includes('frontend')) return 'frontend'
    if (declared.length > 0) return declared[0]
  }
  if (Array.isArray(layers) && layers.length > 0) return layers[0]
  return 'frontend'
}

function pickFirstTopic({ stack, layer }) {
  if (stack && stack.layers && stack.layers[layer] && Array.isArray(stack.layers[layer].core) && stack.layers[layer].core.length > 0) {
    return stack.layers[layer].core[0]
  }
  // 无栈时 fallback 到 directory-structure（任何项目都有目录可填）
  return 'directory-structure'
}

// 根据 config 推断 package 的源码目录（供 grep 命令用）
function resolvePackageSourceDir({ projectRoot, pkg, config }) {
  const cfg = config || {}
  const apps = (cfg.structure && cfg.structure.apps) || {}
  const sharedLibs = (cfg.structure && cfg.structure.sharedLibs) || {}
  const entry = apps[pkg] || sharedLibs[pkg]
  if (entry && typeof entry.path === 'string' && entry.path) return entry.path
  const projectType = ((cfg.project) || {}).type
  if (projectType === 'monorepo') {
    for (const parent of ['apps', 'packages']) {
      const candidate = path.join(projectRoot, parent, pkg)
      if (fs.existsSync(candidate)) return `${parent}/${pkg}`
    }
    return `apps/${pkg}`
  }
  return '.'
}

function buildGrepHint({ stack, stackName, layer, topic, sourceDir }) {
  const dir = sourceDir || '.'
  if (topic === 'component-guidelines') {
    if (stackName === 'vue-nuxt' || (stack && stack.frameworks && stack.frameworks.includes('vue'))) {
      return `grep -rl '<script setup lang="ts">' ${dir}/components/ 2>/dev/null | head -3`
    }
    if (stackName === 'react-next' || (stack && stack.frameworks && stack.frameworks.some((f) => ['react', 'next'].includes(f)))) {
      return `grep -rl 'export default function' ${dir}/components/ 2>/dev/null | head -3`
    }
    return `ls ${dir}/components 2>/dev/null | head -5`
  }
  if (topic === 'directory-structure') {
    return `ls -1 ${dir} 2>/dev/null | head -20`
  }
  if (topic === 'error-handling') {
    return `grep -rl 'try {' ${dir}/src 2>/dev/null | head -3`
  }
  return `ls ${dir} 2>/dev/null | head -10`
}

function buildRemainingPackagesBlock(remaining, layer, topic) {
  if (!Array.isArray(remaining) || remaining.length === 0) {
    return '_（无剩余 package，本次只纳管了 1 个包。）_'
  }
  const header = `剩余 ${remaining.length} 个 package 按同样节奏处理，每个包改 \`${layer}/${topic}.md\` 这类 core 主题：`
  const body = remaining.map((p, i) => `${i + 1}. ${p}`).join('\n')
  return `${header}\n\n${body}`
}

function buildDefaultBootstrapTask(values) {
  const {
    stack_name,
    packages,
    layers,
    file_list,
    first_package,
    first_layer,
    first_topic,
    first_target_file,
    first_target_source_dir,
    grep_hint,
    remaining_packages_block,
  } = values
  return `# 00 Bootstrap Guidelines

> 首任务：把 bootstrap 生成的骨架填成真实规范。

## 本次生成的文件

- Stack: ${stack_name}
- Packages: ${packages}
- Layers: ${layers}

${file_list}

## 核心原则

1. **Document Reality, Not Ideals** — 记录项目真实做法，不是理想规范
2. **2–3 个真实代码例子** — 每个主题文件至少挑 2–3 段本仓库真实代码填入
3. **1 个 anti-pattern** — 每个主题文件至少补 1 个"我们踩过的坑"
4. **每条规则配 Why** — 一句话说明原因即可

## 第一步：从 ${first_package} 开始

打开 \`${first_target_file}\`：

1. 找一段本仓库真实代码（推荐近期改过的文件）：
   \`\`\`bash
   ${grep_hint}
   \`\`\`
2. 打开其中一个，复制核心片段替换文件里第一条 Rule 的代码块占位
3. 检查默认 Rule 是否符合项目实际做法，不符合就改
4. Common Mistakes 默认给的是通用反例，换成**项目真的踩过的坑**（看 git log / issue 找一个）
5. 把 \`${first_package}/${first_layer}/index.md\` Guidelines Index 里本行 Status 从 \`Draft\` 改成 \`Done\`

**预计耗时**：10–15 分钟/文件，第一个文件做完后剩下的按套路来。

## 第二步：扩展到剩余 package

${remaining_packages_block}

## 验收

- [ ] \`${first_target_file}\` 已填入真实代码 + Why + anti-pattern
- [ ] 对应 index.md 的 Status 列已更新
- [ ] 运行 \`/spec-review\` 确认无 no-examples / no-rationale 告警
`
}

function markSkipped(projectRoot = process.cwd()) {
  return updateBootstrapStatus(path.resolve(projectRoot), 'skipped')
}

// 扫描本次 bootstrap 刚生成的文件，统计仍含占位符的数量。
// 与 /spec-review 的 draft lint 的区别：本函数只看本次新生成的骨架，
// review 看的是全库长期存量；两者展示场景不重叠。
// 对齐 Codex review 的收敛：不全树扫，显式排除 local.md，避免把 Changelog 模板里的 {{date}} 占位符误报。
function scanEmptyTemplates({ projectRoot = process.cwd(), files = [] } = {}) {
  const root = path.resolve(projectRoot)
  const exclude = new Set(['local.md'])
  const report = { total: 0, withPlaceholders: 0, files: [] }
  for (const rel of files) {
    const base = path.basename(rel)
    if (exclude.has(base)) continue
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    report.total += 1
    let content = ''
    try { content = fs.readFileSync(abs, 'utf8') } catch { continue }
    if (/\(To be filled\)|\{\{[^}]+\}\}/.test(content)) {
      report.withPlaceholders += 1
      report.files.push(path.relative(root, abs).replace(/\\/g, '/'))
    }
  }
  return report
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : null
  }
  if (command === 'status') {
    const root = option('--project-root') || process.cwd()
    const status = readBootstrapStatus(root)
    const stats = countCodeSpecsStats(root)
    process.stdout.write(`${JSON.stringify({ bootstrapStatus: status, ...stats })}\n`)
    return
  }
  if (command === 'init') {
    const root = option('--project-root') || process.cwd()
    const frameworks = String(option('--frameworks') || '').split(',').map((item) => item.trim()).filter(Boolean)
    const force = args.includes('--force')
    const reset = args.includes('--reset')
    const stack = option('--stack') || null
    const noStack = args.includes('--no-stack')
    let scope = 'core'
    if (args.includes('--full')) scope = 'full'
    else if (args.includes('--minimal')) scope = 'minimal'
    const result = initCodeSpecsSkeleton({ projectRoot: root, frameworks, force, reset, stack, noStack, scope })
    if (!result.error && Array.isArray(result.generated) && result.generated.length) {
      // 审计时排除 .template-hashes.json（非 markdown）与 00-bootstrap-guidelines.md（任务文件，不是 spec）
      const auditFiles = result.generated.filter((f) => f.endsWith('.md') && !f.endsWith('00-bootstrap-guidelines.md'))
      result.emptyTemplateAudit = scanEmptyTemplates({ projectRoot: root, files: auditFiles })
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.error) process.exitCode = 2
    return
  }
  if (command === 'audit-empty') {
    const root = option('--project-root') || process.cwd()
    const filesArg = option('--files') || ''
    const files = filesArg.split(',').map((item) => item.trim()).filter(Boolean)
    process.stdout.write(`${JSON.stringify(scanEmptyTemplates({ projectRoot: root, files }))}\n`)
    return
  }
  if (command === 'skip') {
    const root = option('--project-root') || process.cwd()
    process.stdout.write(`${JSON.stringify(markSkipped(root))}\n`)
    return
  }
  process.stderr.write('Usage: node spec_bootstrap.js <status|init|skip|audit-empty> [--project-root <path>] [--frameworks a,b,c] [--stack <name>|--no-stack] [--force] [--reset] [--full|--minimal] [--files a.md,b.md]\n')
  process.exitCode = 1
}

module.exports = {
  classifyFrameworks,
  resolveStackFromFrameworks,
  FRAMEWORK_TO_STACK,
  initCodeSpecsSkeleton,
  markSkipped,
  readBootstrapStatus,
  initRuntimeScope,
  countCodeSpecsStats,
  resolveTemplatesDir,
  resolveStackTemplatesDir,
  loadStackTemplate,
  copyStackLayerFiles,
  resolveLayersForBootstrap,
  resolveLayersForRuntime,
  resolvePackages,
  applyDefaultFilters,
  detectWorkspacePackages,
  detectLegacyLayout,
  scanEmptyTemplates,
  writeTemplateHashes,
  writeBootstrapTask,
  computePackageFillOrder,
}

if (require.main === module) main()
