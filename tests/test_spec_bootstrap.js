const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const bootstrap = require(path.join(workflowDir, 'spec_bootstrap.js'))

function writeConfig(root, patch = {}) {
  const configPath = path.join(root, '.claude', 'config', 'project-config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const baseline = { project: { id: 'abc123', name: 'test', type: 'single' }, tech: { frameworks: [] } }
  fs.writeFileSync(configPath, `${JSON.stringify({ ...baseline, ...patch }, null, 2)}\n`)
  return configPath
}

test('spec_bootstrap', async (t) => {
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

  await t.test('initCodeSpecsSkeleton creates frontend + guides for react', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-bootstrap-'))
    writeConfig(root)
    const result = bootstrap.initCodeSpecsSkeleton({ projectRoot: root, frameworks: ['react'] })
    const pkgDir = path.join(root, '.claude', 'code-specs', 'test')
    assert.ok(fs.existsSync(path.join(root, '.claude', 'code-specs', 'index.md')))
    assert.ok(fs.existsSync(path.join(pkgDir, 'frontend', 'index.md')))
    assert.ok(fs.existsSync(path.join(root, '.claude', 'code-specs', 'guides', 'index.md')))
    assert.ok(!fs.existsSync(path.join(pkgDir, 'backend', 'index.md')))
    assert.ok(fs.existsSync(path.join(root, '.claude', 'code-specs', 'local.md')))
    assert.equal(result.hasFrontend, true)
    assert.equal(result.hasBackend, false)
  })

  await t.test('initCodeSpecsSkeleton force flag creates both layers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-bootstrap-'))
    writeConfig(root)
    bootstrap.initCodeSpecsSkeleton({ projectRoot: root, frameworks: [], force: true })
    const pkgDir = path.join(root, '.claude', 'code-specs', 'test')
    assert.ok(fs.existsSync(path.join(pkgDir, 'frontend', 'index.md')))
    assert.ok(fs.existsSync(path.join(pkgDir, 'backend', 'index.md')))
    assert.ok(fs.existsSync(path.join(root, '.claude', 'code-specs', 'guides', 'index.md')))
  })

  await t.test('initCodeSpecsSkeleton is idempotent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-bootstrap-'))
    writeConfig(root)
    bootstrap.initCodeSpecsSkeleton({ projectRoot: root, frameworks: ['vue'] })
    const layerIndex = path.join(root, '.claude', 'code-specs', 'test', 'frontend', 'index.md')
    fs.writeFileSync(layerIndex, '# custom content\n')
    bootstrap.initCodeSpecsSkeleton({ projectRoot: root, frameworks: ['vue'] })
    const after = fs.readFileSync(layerIndex, 'utf8')
    assert.equal(after, '# custom content\n', 'existing files must not be overwritten')
  })

  await t.test('initCodeSpecsSkeleton updates bootstrapStatus to done', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-bootstrap-'))
    writeConfig(root)
    bootstrap.initCodeSpecsSkeleton({ projectRoot: root, frameworks: ['react'] })
    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'config', 'project-config.json'), 'utf8'))
    assert.equal(config.codeSpecs.bootstrapStatus, 'done')
  })

  await t.test('markSkipped sets bootstrapStatus to skipped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-bootstrap-'))
    writeConfig(root)
    bootstrap.markSkipped(root)
    assert.equal(bootstrap.readBootstrapStatus(root), 'skipped')
  })

  await t.test('countCodeSpecsStats returns zero when not initialized', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-bootstrap-'))
    writeConfig(root)
    const stats = bootstrap.countCodeSpecsStats(root)
    assert.equal(stats.exists, false)
    assert.equal(stats.total, 0)
  })

  await t.test('countCodeSpecsStats distinguishes filled vs draft', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-bootstrap-'))
    writeConfig(root)
    bootstrap.initCodeSpecsSkeleton({ projectRoot: root, frameworks: ['react'] })
    const filledPath = path.join(root, '.claude', 'code-specs', 'test', 'frontend', 'components.md')
    fs.writeFileSync(filledPath, '# Components\n\nFully filled content without placeholders.\n')
    const stats = bootstrap.countCodeSpecsStats(root)
    assert.equal(stats.exists, true)
    assert.ok(stats.total >= 4)
    assert.ok(stats.filled >= 1)
  })
})
