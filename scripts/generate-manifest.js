#!/usr/bin/env node
// Generate canonical knowledge-template migration manifest.
// Schema aligns with Trellis D:/code/Trellis/.trellis/spec/cli/backend/migrations.md:
//   migrations[].type ∈ { rename, rename-dir, safe-file-delete, delete }
//   uses `from` uniformly (not `path`)
//   NO top-level `update.skip` — skip logic is a downstream .claude/config.yaml setting.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const TEMPLATES_DIR = path.join('core', 'specs', 'knowledge-templates')
const MANIFESTS_DIR = path.join(REPO_ROOT, TEMPLATES_DIR, 'manifests')
const DOCS_CHANGELOG_EN = path.join(REPO_ROOT, 'docs-site', 'changelog')
const DOCS_CHANGELOG_ZH = path.join(REPO_ROOT, 'docs-site', 'zh', 'changelog')
const DOCS_JSON = path.join(REPO_ROOT, 'docs-site', 'docs.json')

function git(args, opts = {}) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', ...opts })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return String(result.stdout || '').trim()
}

function gitTry(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  return result.status === 0 ? String(result.stdout || '').trim() : null
}

function resolvePreviousTag() {
  const override = process.env.PREV_TAG
  if (override) return override
  const latest = gitTry(['describe', '--tags', '--abbrev=0'])
  return latest || null
}

function collectChanges(prevTag) {
  if (!prevTag) {
    // No previous tag — treat everything as additions, no migrations.
    return { renames: [], renameDirs: [], deletes: [], allTouchedByFromDir: new Map() }
  }
  const range = `${prevTag}..HEAD`
  const output = gitTry(['diff', '--name-status', '-M', range, '--', TEMPLATES_DIR])
  if (!output) return { renames: [], renameDirs: [], deletes: [], allTouchedByFromDir: new Map() }

  const renames = []
  const deletes = []
  // Track every change that touched a file inside each "from" directory so we
  // can determine whether a dir rename is truly a whole-directory migration
  // (every file originally under dir A must be part of the same A→B move).
  const allTouchedByFromDir = new Map()
  const addTouched = (fromPath) => {
    const dir = path.posix.dirname(normalize(fromPath))
    if (!allTouchedByFromDir.has(dir)) allTouchedByFromDir.set(dir, [])
    allTouchedByFromDir.get(dir).push(normalize(fromPath))
  }

  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const status = parts[0]
    if (status.startsWith('R')) {
      const from = parts[1]
      const to = parts[2]
      renames.push({ from, to })
      addTouched(from)
    } else if (status === 'D') {
      deletes.push({ from: parts[1] })
      addTouched(parts[1])
    } else if (status === 'M' || status.startsWith('T') || status === 'A') {
      // Modifications / type-changes / additions against the same "from" dir
      // disqualify it from being treated as a whole-directory rename.
      addTouched(parts[parts.length - 1])
    }
  }
  return {
    renames,
    renameDirs: collapseDirRenames(renames, allTouchedByFromDir, prevTag),
    deletes,
    allTouchedByFromDir,
  }
}

function collapseDirRenames(renames, allTouchedByFromDir, prevTag) {
  // Group renames that share a common prefix transformation (dir → dir).
  const grouped = new Map()
  for (const { from, to } of renames) {
    const fromDir = path.posix.dirname(normalize(from))
    const toDir = path.posix.dirname(normalize(to))
    if (fromDir === toDir) continue
    const key = `${fromDir}→${toDir}`
    if (!grouped.has(key)) grouped.set(key, { from: fromDir, to: toDir, renames: [] })
    grouped.get(key).renames.push({ from: normalize(from), to: normalize(to) })
  }

  const result = []
  for (const entry of grouped.values()) {
    // Promote to rename-dir only when both conditions hold:
    // (a) every diff entry that touched `entry.from` is part of this same A→B move
    // (b) `entry.from` no longer exists under HEAD (the whole directory is gone)
    const touched = allTouchedByFromDir.get(entry.from) || []
    const renamePathsFrom = new Set(entry.renames.map((r) => r.from))
    const allTouchedAreThisMove = touched.length > 0 && touched.every((p) => renamePathsFrom.has(p))
    if (!allTouchedAreThisMove) continue
    if (dirExistsAtHead(entry.from)) continue
    result.push(entry)
  }
  return result
}

function dirExistsAtHead(dir) {
  const out = gitTry(['ls-tree', '-d', '--name-only', 'HEAD', dir])
  return Boolean(out && out.trim())
}

function sha256OfGitPath(ref, filePath) {
  // Use raw bytes (no encoding / no trim) to match Trellis spec:
  // allowed_hashes stores bare 64-char hex digests over the exact file content.
  const result = spawnSync('git', ['show', `${ref}:${filePath}`], { cwd: REPO_ROOT })
  if (result.status !== 0 || !result.stdout) return null
  return crypto.createHash('sha256').update(result.stdout).digest('hex')
}

function loadProtectedPaths() {
  const protectedFile = path.join(REPO_ROOT, TEMPLATES_DIR, 'protected_paths.json')
  if (!fs.existsSync(protectedFile)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(protectedFile, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function loadAllowedHashes() {
  const allowedFile = path.join(REPO_ROOT, TEMPLATES_DIR, 'allowed_hashes.json')
  if (!fs.existsSync(allowedFile)) return {}
  try {
    return JSON.parse(fs.readFileSync(allowedFile, 'utf8'))
  } catch {
    return {}
  }
}

function buildMigrations({ renames, renameDirs, deletes, prevTag }) {
  const migrations = []
  const dirsCollapsed = new Set()

  for (const entry of renameDirs) {
    migrations.push({ type: 'rename-dir', from: normalize(entry.from), to: normalize(entry.to) })
    dirsCollapsed.add(`${entry.from}→${entry.to}`)
  }

  for (const { from, to } of renames) {
    const fromDir = path.posix.dirname(normalize(from))
    const toDir = path.posix.dirname(normalize(to))
    if (dirsCollapsed.has(`${fromDir}→${toDir}`)) continue
    migrations.push({ type: 'rename', from: normalize(from), to: normalize(to) })
  }

  const protectedPaths = loadProtectedPaths()
  const allowedHashes = loadAllowedHashes()

  for (const { from } of deletes) {
    const normalized = normalize(from)
    if (protectedPaths.some((p) => normalized === p || normalized.startsWith(`${p}/`))) {
      continue
    }
    const allowed = allowedHashes[normalized]
    if (Array.isArray(allowed) && prevTag) {
      const actualHash = sha256OfGitPath(prevTag, from)
      if (actualHash && allowed.includes(actualHash)) {
        migrations.push({ type: 'safe-file-delete', from: normalized, allowed_hashes: allowed })
        continue
      }
    }
    migrations.push({ type: 'delete', from: normalized, reason: 'removed in this release' })
  }

  return { migrations, protectedPaths }
}

function normalize(p) {
  return String(p || '').split(path.sep).join('/')
}

function writeManifest({ version, previous, migrations, protectedPaths, breaking, notes, recommendMigrate, changelog }) {
  fs.mkdirSync(MANIFESTS_DIR, { recursive: true })
  const manifest = {
    version,
    previous,
    recommendMigrate,
    notes,
    breaking,
    migrations,
    protected_paths: protectedPaths,
    changelog,
  }
  const outPath = path.join(MANIFESTS_DIR, `v${version}.json`)
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return outPath
}

function buildChangelogMdx(lang, { version, previous, migrations, recommendMigrate, notes }) {
  const title = lang === 'zh' ? `v${version} 变更记录` : `v${version} Changelog`
  const previousLine = previous
    ? lang === 'zh' ? `上一版本：${previous}` : `Previous: ${previous}`
    : lang === 'zh' ? '首次发布' : 'Initial release'
  const recommendLine = recommendMigrate
    ? lang === 'zh' ? '建议升级：是' : 'Recommended migrate: yes'
    : lang === 'zh' ? '建议升级：否' : 'Recommended migrate: no'
  const migrationsHeader = lang === 'zh' ? '## 迁移项' : '## Migrations'
  const migrationLines = migrations.length
    ? migrations.map((m) => `- \`${m.type}\` — ${m.from}${m.to ? ` → ${m.to}` : ''}`).join('\n')
    : (lang === 'zh' ? '_（本次无结构迁移）_' : '_(no structural migrations in this release)_')
  return [
    '---',
    `title: "${title}"`,
    `version: "${version}"`,
    '---',
    '',
    `# ${title}`,
    '',
    previousLine,
    '',
    recommendLine,
    '',
    notes ? `> ${notes}` : '',
    '',
    migrationsHeader,
    '',
    migrationLines,
    '',
  ].join('\n')
}

function writeDocsSiteChangelog(version, payload) {
  if (!fs.existsSync(path.join(REPO_ROOT, 'docs-site'))) {
    return { skipped: true }
  }
  fs.mkdirSync(DOCS_CHANGELOG_EN, { recursive: true })
  fs.mkdirSync(DOCS_CHANGELOG_ZH, { recursive: true })
  const enPath = path.join(DOCS_CHANGELOG_EN, `v${version}.mdx`)
  const zhPath = path.join(DOCS_CHANGELOG_ZH, `v${version}.mdx`)
  fs.writeFileSync(enPath, buildChangelogMdx('en', payload), 'utf8')
  fs.writeFileSync(zhPath, buildChangelogMdx('zh', payload), 'utf8')
  return { skipped: false, enPath, zhPath }
}

function updateDocsJson(version) {
  if (!fs.existsSync(DOCS_JSON)) return { skipped: true }
  const raw = fs.readFileSync(DOCS_JSON, 'utf8')
  let doc
  try {
    doc = JSON.parse(raw)
  } catch {
    return { skipped: true, reason: 'invalid_json' }
  }
  doc.changelog = doc.changelog || []
  const entry = { version, date: new Date().toISOString().slice(0, 10) }
  const existing = doc.changelog.findIndex((item) => item && item.version === version)
  if (existing >= 0) {
    doc.changelog[existing] = entry
  } else {
    doc.changelog.unshift(entry)
  }
  fs.writeFileSync(DOCS_JSON, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  return { skipped: false }
}

function main() {
  const version = process.argv[2]
  if (!version) {
    process.stderr.write('Usage: node scripts/generate-manifest.js <new-version>\n')
    process.exit(1)
  }
  const prevTag = resolvePreviousTag()
  const previous = prevTag ? prevTag.replace(/^v/, '') : null
  const changes = collectChanges(prevTag)
  const { migrations, protectedPaths } = buildMigrations({ ...changes, prevTag })

  const breaking = migrations
    .filter((m) => m.type === 'delete' || m.type === 'rename-dir')
    .map((m) => `${m.type} ${m.from}${m.to ? ` → ${m.to}` : ''}`)

  const payload = {
    version,
    previous,
    migrations,
    protectedPaths,
    breaking,
    notes: prevTag ? `Release ${version} based on ${prevTag}` : `Initial release ${version}`,
    recommendMigrate: migrations.some((m) => m.type !== 'rename'),
    changelog: `Generated from ${prevTag || '(no previous tag)'}..HEAD`,
  }

  const manifestPath = writeManifest(payload)
  const docs = writeDocsSiteChangelog(version, payload)
  const docsJson = updateDocsJson(version)

  const summary = {
    manifest: path.relative(REPO_ROOT, manifestPath),
    migrations_count: migrations.length,
    docs_site: docs.skipped ? 'skipped (no docs-site/)' : 'written',
    docs_json: docsJson.skipped ? 'skipped' : 'updated',
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

if (require.main === module) main()

module.exports = {
  collectChanges,
  buildMigrations,
  buildChangelogMdx,
  normalize,
}
