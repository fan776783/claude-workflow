#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')
const { getKnowledgeDir } = require('./path_utils')

const FRONTEND_FRAMEWORKS = new Set(['react', 'vue', 'angular', 'svelte', 'solid', 'preact', 'next', 'nuxt', 'remix', 'qwik'])
const BACKEND_FRAMEWORKS = new Set(['express', 'fastify', 'nest', 'koa', 'go', 'gin', 'django', 'flask', 'fastapi', 'rails', 'spring', 'spring-boot', 'rust', 'actix'])

function resolveTemplatesDir() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'specs', 'knowledge-templates'),
    path.join(os.homedir(), '.agents', 'agent-workflow', 'core', 'specs', 'knowledge-templates'),
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

function today() {
  return new Date().toISOString().slice(0, 10)
}

function buildRootIndex() {
  return readTemplate('index-template.md') || '# Project Knowledge Base\n'
}

function buildLayerIndex(layerName, description) {
  const template = readTemplate('layer-index-template.md')
  if (!template) return `# ${layerName} Knowledge\n`
  return renderTemplate(template, {
    layer_name: layerName,
    layer_description: description,
  })
}

function buildLocalDoc() {
  const template = readTemplate('local-template.md')
  const date = today()
  return renderTemplate(template, {
    canonical_date: date,
    reason_or_none: '(待填写)',
    none_yet: '(none yet)',
    date,
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
  config.knowledge = config.knowledge || {}
  config.knowledge.bootstrapStatus = status
  config.knowledge.updatedAt = new Date().toISOString()
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return { updated: true, path: configPath, status }
}

function readBootstrapStatus(projectRoot) {
  const { config } = loadProjectConfig(projectRoot)
  if (!config || !config.knowledge) return null
  return config.knowledge.bootstrapStatus || null
}

function countKnowledgeStats(projectRoot) {
  const dirInfo = getKnowledgeDir(projectRoot)
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

function initKnowledgeSkeleton({ projectRoot = process.cwd(), frameworks = [], force = false } = {}) {
  const root = path.resolve(projectRoot)
  const dirInfo = getKnowledgeDir(root)
  const baseDir = dirInfo.exists ? dirInfo.path : path.join(root, '.claude', 'knowledge')
  ensureDir(baseDir)

  const { hasFrontend, hasBackend } = classifyFrameworks(frameworks)
  const generated = []

  const rootIndex = path.join(baseDir, 'index.md')
  const rootResult = writeIfMissing(rootIndex, buildRootIndex())
  if (rootResult.written) generated.push(path.relative(root, rootIndex))

  if (hasFrontend || force) {
    const dir = path.join(baseDir, 'frontend')
    ensureDir(dir)
    const layerIndex = path.join(dir, 'index.md')
    const res = writeIfMissing(layerIndex, buildLayerIndex('Frontend', '前端代码规范与契约（code-spec 层，强制契约）'))
    if (res.written) generated.push(path.relative(root, layerIndex))
  }

  if (hasBackend || force) {
    const dir = path.join(baseDir, 'backend')
    ensureDir(dir)
    const layerIndex = path.join(dir, 'index.md')
    const res = writeIfMissing(layerIndex, buildLayerIndex('Backend', '后端代码规范与契约（code-spec 层，强制契约）'))
    if (res.written) generated.push(path.relative(root, layerIndex))
  }

  const guidesDir = path.join(baseDir, 'guides')
  ensureDir(guidesDir)
  const guidesIndex = path.join(guidesDir, 'index.md')
  const guidesRes = writeIfMissing(guidesIndex, buildLayerIndex('Guides', '思考检查清单（thinking 层，只作指针不重复规则）'))
  if (guidesRes.written) generated.push(path.relative(root, guidesIndex))

  const localPath = path.join(baseDir, 'local.md')
  const localRes = writeIfMissing(localPath, buildLocalDoc())
  if (localRes.written) generated.push(path.relative(root, localPath))

  const configUpdate = updateBootstrapStatus(root, 'done')

  return {
    baseDir,
    generated,
    hasFrontend,
    hasBackend,
    configUpdate,
  }
}

function markSkipped(projectRoot = process.cwd()) {
  return updateBootstrapStatus(path.resolve(projectRoot), 'skipped')
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
    const stats = countKnowledgeStats(root)
    process.stdout.write(`${JSON.stringify({ bootstrapStatus: status, ...stats })}\n`)
    return
  }
  if (command === 'init') {
    const root = option('--project-root') || process.cwd()
    const frameworks = String(option('--frameworks') || '').split(',').map((item) => item.trim()).filter(Boolean)
    const force = args.includes('--force')
    const result = initKnowledgeSkeleton({ projectRoot: root, frameworks, force })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  if (command === 'skip') {
    const root = option('--project-root') || process.cwd()
    process.stdout.write(`${JSON.stringify(markSkipped(root))}\n`)
    return
  }
  process.stderr.write('Usage: node knowledge_bootstrap.js <status|init|skip> [--project-root <path>] [--frameworks a,b,c] [--force]\n')
  process.exitCode = 1
}

module.exports = {
  classifyFrameworks,
  initKnowledgeSkeleton,
  markSkipped,
  readBootstrapStatus,
  countKnowledgeStats,
  resolveTemplatesDir,
}

if (require.main === module) main()
