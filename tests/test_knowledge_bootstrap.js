const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const bootstrap = require(path.join(workflowDir, 'knowledge_bootstrap.js'))

function writeConfig(root, patch = {}) {
  const configPath = path.join(root, '.claude', 'config', 'project-config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const baseline = { project: { id: 'abc123', name: 'test', type: 'single' }, tech: { frameworks: [] } }
  fs.writeFileSync(configPath, `${JSON.stringify({ ...baseline, ...patch }, null, 2)}\n`)
  return configPath
}

test('knowledge_bootstrap', async (t) => {
  await t.test('classifyFrameworks detects frontend', () => {
    const result = bootstrap.classifyFrameworks(['react', 'typescript'])
    assert.equal(result.hasFrontend, true)
    assert.equal(result.hasBackend, false)
  })

  await t.test('classifyFrameworks detects backend', () => {
    const result = bootstrap.classifyFrameworks(['express'])
    assert.equal(result.hasFrontend, false)
    assert.equal(result.hasBackend, true)
  })

  await t.test('classifyFrameworks detects both in fullstack', () => {
    const result = bootstrap.classifyFrameworks(['vue', 'fastify'])
    assert.equal(result.hasFrontend, true)
    assert.equal(result.hasBackend, true)
  })

  await t.test('classifyFrameworks is empty for unknown', () => {
    const result = bootstrap.classifyFrameworks([])
    assert.equal(result.hasFrontend, false)
    assert.equal(result.hasBackend, false)
  })

  await t.test('initKnowledgeSkeleton creates frontend + guides for react', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-bootstrap-'))
    writeConfig(root)
    const result = bootstrap.initKnowledgeSkeleton({ projectRoot: root, frameworks: ['react'] })
    const pkgDir = path.join(root, '.claude', 'knowledge', 'test')
    assert.ok(fs.existsSync(path.join(root, '.claude', 'knowledge', 'index.md')))
    assert.ok(fs.existsSync(path.join(pkgDir, 'frontend', 'index.md')))
    assert.ok(fs.existsSync(path.join(root, '.claude', 'knowledge', 'guides', 'index.md')))
    assert.ok(!fs.existsSync(path.join(pkgDir, 'backend', 'index.md')))
    assert.ok(fs.existsSync(path.join(root, '.claude', 'knowledge', 'local.md')))
    assert.equal(result.hasFrontend, true)
    assert.equal(result.hasBackend, false)
  })

  await t.test('initKnowledgeSkeleton force flag creates both layers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-bootstrap-'))
    writeConfig(root)
    bootstrap.initKnowledgeSkeleton({ projectRoot: root, frameworks: [], force: true })
    const pkgDir = path.join(root, '.claude', 'knowledge', 'test')
    assert.ok(fs.existsSync(path.join(pkgDir, 'frontend', 'index.md')))
    assert.ok(fs.existsSync(path.join(pkgDir, 'backend', 'index.md')))
    assert.ok(fs.existsSync(path.join(root, '.claude', 'knowledge', 'guides', 'index.md')))
  })

  await t.test('initKnowledgeSkeleton is idempotent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-bootstrap-'))
    writeConfig(root)
    bootstrap.initKnowledgeSkeleton({ projectRoot: root, frameworks: ['vue'] })
    const layerIndex = path.join(root, '.claude', 'knowledge', 'test', 'frontend', 'index.md')
    fs.writeFileSync(layerIndex, '# custom content\n')
    bootstrap.initKnowledgeSkeleton({ projectRoot: root, frameworks: ['vue'] })
    const after = fs.readFileSync(layerIndex, 'utf8')
    assert.equal(after, '# custom content\n', 'existing files must not be overwritten')
  })

  await t.test('initKnowledgeSkeleton updates bootstrapStatus to done', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-bootstrap-'))
    writeConfig(root)
    bootstrap.initKnowledgeSkeleton({ projectRoot: root, frameworks: ['react'] })
    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'config', 'project-config.json'), 'utf8'))
    assert.equal(config.knowledge.bootstrapStatus, 'done')
  })

  await t.test('markSkipped sets bootstrapStatus to skipped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-bootstrap-'))
    writeConfig(root)
    bootstrap.markSkipped(root)
    assert.equal(bootstrap.readBootstrapStatus(root), 'skipped')
  })

  await t.test('countKnowledgeStats returns zero when not initialized', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-bootstrap-'))
    writeConfig(root)
    const stats = bootstrap.countKnowledgeStats(root)
    assert.equal(stats.exists, false)
    assert.equal(stats.total, 0)
  })

  await t.test('countKnowledgeStats distinguishes filled vs draft', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-bootstrap-'))
    writeConfig(root)
    bootstrap.initKnowledgeSkeleton({ projectRoot: root, frameworks: ['react'] })
    const filledPath = path.join(root, '.claude', 'knowledge', 'test', 'frontend', 'components.md')
    fs.writeFileSync(filledPath, '# Components\n\nFully filled content without placeholders.\n')
    const stats = bootstrap.countKnowledgeStats(root)
    assert.equal(stats.exists, true)
    assert.ok(stats.total >= 4)
    assert.ok(stats.filled >= 1)
  })
})
