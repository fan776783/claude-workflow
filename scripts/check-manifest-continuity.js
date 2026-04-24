#!/usr/bin/env node
// Pre-release gate: every npm-published version must have a local manifest.
//
// `spec_migrate.js` walks the previous→current manifest chain; a missing link
// silently halts migration (`terminated: 'manifest_not_published'`), leaving
// users on adjacent versions with broken update paths.
//
// Emergency bypass: SKIP_MANIFEST_CONTINUITY=1 (loud banner; only for
// re-rolls that knowingly accept the tradeoff).

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const pc = require('picocolors')

const REPO_ROOT = path.resolve(__dirname, '..')
const MANIFESTS_DIR = path.join(REPO_ROOT, 'core', 'specs', 'spec-templates', 'manifests')
const PACKAGE_NAME = '@justinfan/agent-workflow'
const ENV_FILE = path.join(REPO_ROOT, '.env')

const manifestFile = (version) => `v${version}.json`

// Pre-v5.1.0 versions shipped before the spec-template manifest system existed.
// Do NOT extend this list — a new gap means someone is about to break the
// migration chain; fix the root cause (restore from git, or change the release
// plan) instead of whitelisting.
const KNOWN_GAPS = new Set([
  '4.0.0', '4.1.0',
  '5.0.0', '5.0.1', '5.0.2', '5.0.3',
])

function loadRegistryUrl() {
  if (process.env.NPM_REGISTRY_URL) return process.env.NPM_REGISTRY_URL
  if (!fs.existsSync(ENV_FILE)) return null
  const content = fs.readFileSync(ENV_FILE, 'utf8')
  const match = content.match(/^\s*NPM_REGISTRY_URL\s*=\s*["']?(.+?)["']?\s*$/m)
  return match ? match[1] : null
}

function readLocalManifestVersions() {
  if (!fs.existsSync(MANIFESTS_DIR)) return new Set()
  return new Set(
    fs.readdirSync(MANIFESTS_DIR)
      .map((f) => f.match(/^v(\d+\.\d+\.\d+)\.json$/)?.[1])
      .filter(Boolean)
  )
}

function fetchNpmVersions(registryUrl) {
  try {
    const output = execSync(
      `npm view ${PACKAGE_NAME} versions --json --registry=${registryUrl}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000 }
    )
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch (err) {
    const stderr = (err.stderr && err.stderr.toString()) || ''
    if (stderr.includes('E404') || stderr.includes('not found')) return []
    throw err
  }
}

function main() {
  if (process.env.SKIP_MANIFEST_CONTINUITY === '1') {
    console.error(pc.yellow('⚠  SKIP_MANIFEST_CONTINUITY=1 — bypassing manifest/npm continuity check.'))
    console.error(pc.yellow('   Only use this for emergency re-rolls with explicit sign-off.\n'))
    return
  }

  const registryUrl = loadRegistryUrl()
  if (!registryUrl) {
    console.error(pc.red('✗ NPM_REGISTRY_URL not set.'))
    console.error('  Add it to .env or export it before running this check.')
    process.exit(1)
  }

  const localVersions = readLocalManifestVersions()
  const npmVersions = fetchNpmVersions(registryUrl)
  const newGaps = npmVersions.filter((v) => !localVersions.has(v) && !KNOWN_GAPS.has(v))

  if (newGaps.length > 0) {
    console.error(pc.red('✗ Manifest / npm continuity check failed.\n'))
    console.error(pc.red('Published-but-missing manifests (not in KNOWN_GAPS):'))
    newGaps.forEach((v) => console.error(`  - ${manifestFile(v)}`))
    console.error(
      `\nA version on npm without its local manifest breaks the spec-template\n` +
      `migration chain for users on adjacent versions.\n\n` +
      `Fix options:\n` +
      `  1. Restore the manifest from git history:\n` +
      `       git log --all -- core/specs/spec-templates/manifests/${manifestFile('<version>')}\n` +
      `       git checkout <commit-before-delete> -- core/specs/spec-templates/manifests/${manifestFile('<version>')}\n` +
      `  2. If the version should never have been published, deprecate on npm\n` +
      `     AND accept the gap by adding to KNOWN_GAPS — adjacent-version users\n` +
      `     still get broken chains, so weigh carefully.\n\n` +
      pc.dim('Emergency bypass (NOT recommended): SKIP_MANIFEST_CONTINUITY=1 <command>\n')
    )
    process.exit(1)
  }

  console.log(
    pc.green('✓') + ` Manifest continuity OK — ${localVersions.size} local, ` +
    `${npmVersions.length} published (${KNOWN_GAPS.size} historical gaps whitelisted).`
  )
}

main()
