const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const compliance = require(path.join(workflowDir, 'knowledge_compliance.js'))

function initGitRepo(root) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  spawnSync('git', ['init', '-q'], { cwd: root, env })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root, env })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: root, env })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, env })
  return env
}

function gitCommit(root, env, message = 'snap') {
  spawnSync('git', ['add', '-A'], { cwd: root, env })
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', message], { cwd: root, env })
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, env, encoding: 'utf8' })
  return String(result.stdout || '').trim()
}

function writeKnowledgeRule(root, layer, filename, rulesYaml) {
  const dir = path.join(root, '.claude', 'knowledge', layer)
  fs.mkdirSync(dir, { recursive: true })
  const content = `# ${filename}\n\n## Machine-checkable Rules\n\n\`\`\`yaml\n${rulesYaml}\n\`\`\`\n`
  fs.writeFileSync(path.join(dir, filename), content)
}

test('knowledge_compliance', async (t) => {
  await t.test('extractRuleBlocks finds yaml fences under correct section', () => {
    const content = [
      '# Spec',
      '',
      '## Machine-checkable Rules',
      '',
      '```yaml',
      'id: a',
      '```',
      '',
      '```yaml',
      'id: b',
      '```',
      '',
      '## Not Rules',
      '',
      '```yaml',
      'id: c',
      '```',
    ].join('\n')
    const blocks = compliance.extractRuleBlocks(content)
    assert.equal(blocks.length, 2)
  })

  await t.test('normalizeRule rejects unknown kind or severity', () => {
    const good = compliance.normalizeRule({ id: 'x', kind: 'forbid', severity: 'blocking', pattern: 'foo' }, 'src.md')
    assert.ok(good)
    assert.equal(good.id, 'x')
    assert.equal(compliance.normalizeRule({ kind: 'invalid', severity: 'blocking', pattern: 'x' }, 'src.md'), null)
    assert.equal(compliance.normalizeRule({ kind: 'forbid', severity: 'purple', pattern: 'x' }, 'src.md'), null)
    assert.equal(compliance.normalizeRule({ kind: 'forbid', severity: 'blocking' }, 'src.md'), null, 'missing pattern')
    assert.equal(compliance.normalizeRule({ kind: 'forbid', severity: 'blocking', pattern: '[' }, 'src.md'), null, 'invalid regex')
  })

  await t.test('globToRegex handles extensions braces', () => {
    const regex = compliance.globToRegex('**/*.{ts,tsx}')
    assert.ok(regex.test('src/a/b.ts'))
    assert.ok(regex.test('c.tsx'))
    assert.ok(!regex.test('a.js'))
  })

  await t.test('parseDiff extracts file, new-line numbers, additions only', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -0,0 +1,2 @@',
      '+const x: any = 1',
      '+const y = 2',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -5,0 +6,1 @@',
      '+deleted line removed',
    ].join('\n')
    const hunks = compliance.parseDiff(diff)
    assert.ok(hunks.some((h) => h.file === 'src/a.ts' && h.line === 1 && h.text.includes('any')))
    assert.ok(hunks.some((h) => h.file === 'src/b.ts' && h.line === 6))
  })

  await t.test('checkCompliance returns compliant when no rules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    gitCommit(root, env, 'init')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: null })
    assert.equal(result.compliant, true)
    assert.equal(result.rules_count, 0)
  })

  await t.test('checkCompliance flags blocking violation on forbidden pattern', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    writeKnowledgeRule(root, 'frontend', 'types.md', [
      'id: forbid-any',
      'severity: blocking',
      'kind: forbid',
      'pattern: ":\\\\s*any\\\\b"',
      'applies_to: "**/*.ts"',
      'message: "禁止 any"',
    ].join('\n'))
    const base = gitCommit(root, env, 'base')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const x: any = 1\n')
    gitCommit(root, env, 'offender')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: base })
    assert.equal(result.compliant, false)
    assert.equal(result.violations.length, 1)
    assert.equal(result.violations[0].rule, 'forbid-any')
    assert.equal(result.violations[0].severity, 'blocking')
    assert.equal(result.violations[0].file, 'src/a.ts')
  })

  await t.test('checkCompliance returns warning for kind warn', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    writeKnowledgeRule(root, 'frontend', 'todos.md', [
      'id: warn-todo',
      'severity: warning',
      'kind: warn',
      'pattern: "TODO"',
    ].join('\n'))
    const base = gitCommit(root, env, 'base')
    fs.writeFileSync(path.join(root, 'a.txt'), 'TODO: clean up\n')
    gitCommit(root, env, 'todo')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: base })
    assert.equal(result.compliant, true, 'warnings do not block')
    assert.equal(result.warnings.length, 1)
    assert.equal(result.violations.length, 0)
  })

  await t.test('checkCompliance require kind blocks when pattern missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    writeKnowledgeRule(root, 'backend', 'license.md', [
      'id: require-license-header',
      'severity: blocking',
      'kind: require',
      'pattern: "SPDX-License-Identifier"',
      'applies_to: "**/*.js"',
    ].join('\n'))
    const base = gitCommit(root, env, 'base')
    fs.writeFileSync(path.join(root, 'lib.js'), 'module.exports = 1\n')
    gitCommit(root, env, 'no-license')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: base })
    assert.equal(result.compliant, false)
    assert.equal(result.violations[0].rule, 'require-license-header')
  })

  await t.test('guides/ files are excluded from rule scanning', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    writeKnowledgeRule(root, 'guides', 'checklist.md', [
      'id: forbid-debug',
      'severity: blocking',
      'kind: forbid',
      'pattern: "console\\\\.log"',
    ].join('\n'))
    const base = gitCommit(root, env, 'base')
    fs.writeFileSync(path.join(root, 'a.js'), 'console.log("bad")\n')
    gitCommit(root, env, 'offender')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: base })
    assert.equal(result.rules_count, 0, 'guides/ must not contribute rules')
    assert.equal(result.compliant, true)
  })

  await t.test('malformed rules are silently dropped, not thrown', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    writeKnowledgeRule(root, 'frontend', 'broken.md', 'nonsense yaml without valid fields')
    gitCommit(root, env, 'base')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: null })
    assert.equal(result.compliant, true)
    assert.equal(result.rules_count, 0)
  })

  await t.test('working-tree violation is caught when base commit is provided (regression P1-1)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    writeKnowledgeRule(root, 'frontend', 'types.md', [
      'id: forbid-any',
      'severity: blocking',
      'kind: forbid',
      'pattern: ":\\\\s*any\\\\b"',
      'applies_to: "**/*.ts"',
    ].join('\n'))
    const base = gitCommit(root, env, 'base')
    // Working-tree change — NOT committed
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const x: any = 1\n')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: base })
    assert.equal(result.compliant, false, 'working-tree changes must be inspected even when baseCommit is set')
    assert.equal(result.violations[0].rule, 'forbid-any')
    assert.equal(result.violations[0].file, 'src/a.ts')
  })

  await t.test('require rule catches deletion of required pattern (regression P1-2)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    writeKnowledgeRule(root, 'backend', 'license.md', [
      'id: require-license-header',
      'severity: blocking',
      'kind: require',
      'pattern: "SPDX-License-Identifier"',
      'applies_to: "**/*.js"',
    ].join('\n'))
    fs.writeFileSync(path.join(root, 'lib.js'), '// SPDX-License-Identifier: MIT\nmodule.exports = 1\n')
    const base = gitCommit(root, env, 'base-with-header')
    // Delete the required header — pure deletion inside existing file
    fs.writeFileSync(path.join(root, 'lib.js'), 'module.exports = 1\n')
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: base })
    assert.equal(result.compliant, false, 'require rule must flag deletion of required pattern')
    assert.equal(result.violations[0].rule, 'require-license-header')
    assert.equal(result.violations[0].file, 'lib.js')
  })

  await t.test('git failure produces a blocking violation, not a silent pass', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    // no git init on purpose
    writeKnowledgeRule(root, 'frontend', 'types.md', [
      'id: forbid-any',
      'severity: blocking',
      'kind: forbid',
      'pattern: "any"',
    ].join('\n'))
    const result = compliance.checkCompliance({ projectRoot: root, baseCommit: null })
    assert.equal(result.compliant, false, 'git failure must not fail open')
    assert.ok(result.error, 'error must be preserved')
    assert.equal(result.violations[0].rule, 'git-diff-failed')
    assert.equal(result.violations[0].severity, 'blocking')
  })

  await t.test('collectChangedFiles includes deletions and renames', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compliance-'))
    const env = initGitRepo(root)
    fs.writeFileSync(path.join(root, 'a.js'), 'const a = 1\n')
    fs.writeFileSync(path.join(root, 'b.js'), 'const b = 2\n')
    const base = gitCommit(root, env, 'base')
    fs.unlinkSync(path.join(root, 'a.js'))
    fs.writeFileSync(path.join(root, 'b.js'), 'const b = 3\n')
    const res = compliance.collectChangedFiles(root, base)
    assert.equal(res.ok, true)
    const statuses = new Map(res.files.map((f) => [f.file, f.status]))
    assert.equal(statuses.get('a.js'), 'D')
    assert.equal(statuses.get('b.js'), 'M')
  })
})
