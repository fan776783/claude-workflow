#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')
const { getCodeSpecsDir } = require('./path_utils')

const FRONTEND_FRAMEWORKS = new Set(['react', 'vue', 'angular', 'svelte', 'solid', 'preact', 'next', 'nuxt', 'remix', 'qwik'])
const BACKEND_FRAMEWORKS = new Set(['express', 'fastify', 'nest', 'koa', 'go', 'gin', 'django', 'flask', 'fastapi', 'rails', 'spring', 'spring-boot', 'rust', 'actix'])

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

function resolvePackages({ projectRoot, config }) {
  const monorepoPackages = ((config || {}).monorepo || {}).packages
  if (Array.isArray(monorepoPackages) && monorepoPackages.length > 0) {
    const list = monorepoPackages.map((item) => String(item).trim()).filter(Boolean)
    if (list.length > 0) return { packages: list, source: 'config.monorepo.packages' }
  }

  const projectType = ((config || {}).project || {}).type
  if (projectType === 'monorepo') {
    const detected = detectWorkspacePackages(projectRoot)
    if (detected.packages.length > 0) {
      return { packages: detected.packages, source: detected.source }
    }
    return {
      packages: [],
      source: null,
      error: 'monorepo_packages_unresolved',
      message: 'project.type=monorepo，但 config.monorepo.packages 为空，且未能从 pnpm-workspace.yaml / package.json workspaces / lerna.json 中检测到 workspace。请在 project-config.json 补上 monorepo.packages 后重跑。',
    }
  }

  const projectName = ((config || {}).project || {}).name
    || readPackageJsonName(projectRoot)
    || path.basename(path.resolve(projectRoot))
  return { packages: [projectName], source: 'project.name' }
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

function initCodeSpecsSkeleton({ projectRoot = process.cwd(), frameworks = [], force = false, reset = false } = {}) {
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

  if (reset && fs.existsSync(baseDir)) {
    rmTree(baseDir)
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
  const { hasFrontend, hasBackend } = classifyFrameworks(frameworks)
  const generated = []

  const rootIndex = path.join(baseDir, 'index.md')
  const rootResult = writeIfMissing(rootIndex, buildRootIndex())
  if (rootResult.written) generated.push(path.relative(root, rootIndex))

  const generateLayer = (pkg, layer, description) => {
    const dir = path.join(baseDir, pkg, layer)
    ensureDir(dir)
    const layerIndex = path.join(dir, 'index.md')
    const res = writeIfMissing(layerIndex, buildLayerIndex(`${pkg} / ${layer}`, description))
    if (res.written) generated.push(path.relative(root, layerIndex))
  }

  for (const pkg of packages) {
    if (hasFrontend || force) {
      generateLayer(pkg, 'frontend', '前端代码规范与契约（7 段 code-spec）')
    }
    if (hasBackend || force) {
      generateLayer(pkg, 'backend', '后端代码规范与契约（7 段 code-spec）')
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

  const configUpdate = updateBootstrapStatus(root, 'done')

  return {
    baseDir,
    packages,
    packagesSource: packageResolution.source,
    generated,
    hasFrontend,
    hasBackend,
    reset,
    configUpdate,
  }
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
    const result = initCodeSpecsSkeleton({ projectRoot: root, frameworks, force, reset })
    if (!result.error && Array.isArray(result.generated) && result.generated.length) {
      result.emptyTemplateAudit = scanEmptyTemplates({ projectRoot: root, files: result.generated })
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
  process.stderr.write('Usage: node spec_bootstrap.js <status|init|skip|audit-empty> [--project-root <path>] [--frameworks a,b,c] [--force] [--reset] [--files a.md,b.md]\n')
  process.exitCode = 1
}

module.exports = {
  classifyFrameworks,
  initCodeSpecsSkeleton,
  markSkipped,
  readBootstrapStatus,
  countCodeSpecsStats,
  resolveTemplatesDir,
  resolvePackages,
  detectWorkspacePackages,
  detectLegacyLayout,
  scanEmptyTemplates,
}

if (require.main === module) main()
