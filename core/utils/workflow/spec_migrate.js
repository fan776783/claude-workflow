#!/usr/bin/env node
/**
 * @file spec_migrate.js — v3 Stage C
 *
 * 对外导出：
 *   planMigration({ fromVersion, toVersion, projectRoot, manifestsDir })
 *     返回 { chain, apply, skip, conflicts, rollbackKey, failedPartial, terminated }
 *   applyMigration(plan, { projectRoot, manifestsDir, write })
 *     按序执行 plan.apply，写 rollback 记录；失败时返回 { status: 'failed_partial', ... }
 *
 * 本模块不主动写 .template-hashes.json.version，由调用方（spec-update skill）
 * 在成功后自行更新；失败时写 migrationStatus=failed_partial。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getCodeSpecsDir } = require('./path_utils')

const DEFAULT_MANIFESTS_DIR = path.join(__dirname, '..', '..', 'specs', 'spec-templates', 'manifests')
const PRE_5_2 = 'pre-5.2'

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function listManifests(manifestsDir) {
  if (!fs.existsSync(manifestsDir)) return []
  return fs.readdirSync(manifestsDir)
    .filter((name) => /^v[\w.\-]+\.json$/.test(name))
    .map((name) => ({ name, fullPath: path.join(manifestsDir, name) }))
    .map(({ name, fullPath }) => ({ name, fullPath, doc: readJson(fullPath) }))
    .filter((entry) => entry.doc && entry.doc.version)
}

// 构造 previous → version 有向图，找 from → to 的最短路径。
// PRE_5_2 作为虚拟起点：所有 `previous` 不在 manifests 图内的 manifest 视为 pre-5.2 的直接后继。
function findChain(manifests, fromVersion, toVersion) {
  if (fromVersion === toVersion) return []
  const versionSet = new Set(manifests.map((m) => m.doc.version))
  const byPrevious = new Map()
  for (const m of manifests) {
    const prev = m.doc.previous && versionSet.has(m.doc.previous) ? m.doc.previous : PRE_5_2
    if (!byPrevious.has(prev)) byPrevious.set(prev, [])
    byPrevious.get(prev).push(m)
  }
  const queue = [[fromVersion, []]]
  const visited = new Set([fromVersion])
  while (queue.length) {
    const [cur, pathSoFar] = queue.shift()
    const nexts = byPrevious.get(cur) || []
    for (const next of nexts) {
      if (visited.has(next.doc.version)) continue
      const newPath = [...pathSoFar, next]
      if (next.doc.version === toVersion) return newPath
      visited.add(next.doc.version)
      queue.push([next.doc.version, newPath])
    }
  }
  return null
}

function resolveManifestTargetVersion(manifests) {
  if (!manifests.length) return null
  // 取 version 字段最"新"的（按语义版本粗排：长度 + 字符串比较兜底）
  const sorted = [...manifests].sort((a, b) => {
    const va = a.doc.version.split('.').map((s) => parseInt(s, 10) || 0)
    const vb = b.doc.version.split('.').map((s) => parseInt(s, 10) || 0)
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const da = va[i] || 0
      const db = vb[i] || 0
      if (da !== db) return da - db
    }
    return 0
  })
  return sorted[sorted.length - 1].doc.version
}

function computeHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
  } catch {
    return null
  }
}

function isProtected(targetPath, protectedPaths) {
  if (!protectedPaths || !protectedPaths.length) return false
  const rel = targetPath.replace(/\\/g, '/')
  for (const raw of protectedPaths) {
    const pattern = String(raw || '').replace(/\\/g, '/')
    if (!pattern) continue
    // 支持简单 {pkg} / {layer} 占位 + * 通配
    const re = new RegExp('^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{[a-z_]+\\\}/gi, '[A-Za-z0-9_.\\-]+')
      .replace(/\*/g, '.*') + '$')
    if (re.test(rel)) return true
  }
  return false
}

function hasVariableMarker(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return /\{\{[^}]+\}\}/.test(content)
  } catch {
    return false
  }
}

/**
 * planMigration: dry-run，返回每条 migration 的分流结果。
 */
function planMigration({ fromVersion, toVersion, projectRoot, manifestsDir = DEFAULT_MANIFESTS_DIR } = {}) {
  const manifests = listManifests(manifestsDir)
  if (!manifests.length) {
    return { terminated: true, reason: 'no_manifests_published', chain: [], apply: [], skip: [], conflicts: [] }
  }

  const targetVersion = toVersion || resolveManifestTargetVersion(manifests)
  const baseline = fromVersion || PRE_5_2
  const knownVersions = new Set(manifests.map((m) => m.doc.version))

  if (fromVersion && fromVersion !== PRE_5_2 && !knownVersions.has(fromVersion)) {
    return {
      terminated: true,
      reason: `unknown_baseline:${fromVersion}`,
      chain: [],
      apply: [],
      skip: [],
      conflicts: [],
    }
  }
  if (!knownVersions.has(targetVersion)) {
    return {
      terminated: true,
      reason: `manifest_not_published:${targetVersion}`,
      chain: [],
      apply: [],
      skip: [],
      conflicts: [],
    }
  }

  const chain = findChain(manifests, baseline, targetVersion)
  if (chain === null) {
    return {
      terminated: true,
      reason: `chain_not_reachable:${baseline}->${targetVersion}`,
      chain: [],
      apply: [],
      skip: [],
      conflicts: [],
    }
  }
  if (!chain.length) {
    return { terminated: false, chain: [], apply: [], skip: [], conflicts: [], rollbackKey: null }
  }

  const specsDir = getCodeSpecsDir(projectRoot)
  const root = specsDir.exists ? specsDir.path : path.join(projectRoot || process.cwd(), '.claude', 'code-specs')
  const apply = []
  const skip = []
  const conflicts = []

  for (const step of chain) {
    const manifest = step.doc
    const protectedPaths = Array.isArray(manifest.protected_paths) ? manifest.protected_paths : []
    const migrations = Array.isArray(manifest.migrations) ? manifest.migrations : []

    migrations.forEach((entry, idx) => {
      const ref = { manifestFile: step.name, manifestVersion: manifest.version, index: idx, entry }
      const { type } = entry
      if (type === 'rename' || type === 'rename-dir') {
        const src = path.join(root, entry.from)
        const dst = path.join(root, entry.to)
        if (!fs.existsSync(src)) {
          skip.push({ ...ref, reason: 'source_missing' })
          return
        }
        if (fs.existsSync(dst)) {
          conflicts.push({ ...ref, reason: 'target_exists' })
          return
        }
        apply.push({ ...ref, plan: { action: type, src, dst } })
      } else if (type === 'rename-section') {
        const target = path.join(root, entry.file)
        if (!fs.existsSync(target)) {
          skip.push({ ...ref, reason: 'file_missing' })
          return
        }
        if (hasVariableMarker(target)) {
          skip.push({ ...ref, reason: 'variable_marker_present' })
          return
        }
        apply.push({ ...ref, plan: { action: 'rename-section', target, from: entry.from, to: entry.to } })
      } else if (type === 'delete-section') {
        const target = path.join(root, entry.file)
        if (!fs.existsSync(target)) {
          skip.push({ ...ref, reason: 'file_missing' })
          return
        }
        if (hasVariableMarker(target)) {
          skip.push({ ...ref, reason: 'variable_marker_present' })
          return
        }
        apply.push({ ...ref, plan: { action: 'delete-section', target, section: entry.section } })
      } else if (type === 'safe-file-delete') {
        const target = path.join(root, entry.path)
        if (!fs.existsSync(target)) {
          skip.push({ ...ref, reason: 'file_missing' })
          return
        }
        if (isProtected(entry.path, protectedPaths)) {
          skip.push({ ...ref, reason: 'protected_path' })
          return
        }
        if (hasVariableMarker(target)) {
          skip.push({ ...ref, reason: 'variable_marker_present' })
          return
        }
        const actualHash = computeHash(target)
        const expectedHashes = Array.isArray(entry.allowed_hashes)
          ? entry.allowed_hashes
          : (entry.guard && entry.guard.hashBefore ? [entry.guard.hashBefore] : [])
        if (!expectedHashes.length || !expectedHashes.includes(actualHash)) {
          skip.push({ ...ref, reason: 'hash_mismatch_user_modified', actualHash })
          return
        }
        apply.push({ ...ref, plan: { action: 'safe-file-delete', target } })
      } else if (type === 'delete') {
        const target = path.join(root, entry.path)
        if (!fs.existsSync(target)) {
          skip.push({ ...ref, reason: 'file_missing' })
          return
        }
        // protected_paths 命中 → 降级为 safe-file-delete 语义（本条直接 skip + 提示）
        if (isProtected(entry.path, protectedPaths)) {
          skip.push({ ...ref, reason: 'protected_path_delete_downgraded' })
          return
        }
        apply.push({ ...ref, plan: { action: 'delete', target } })
      } else {
        skip.push({ ...ref, reason: `unknown_operation:${type}` })
      }
    })
  }

  const rollbackKey = `${baseline}->${targetVersion}`
  return { terminated: false, chain: chain.map((c) => c.doc.version), apply, skip, conflicts, rollbackKey }
}

/**
 * applyMigration: 按 plan.apply 顺序执行，写 rollback 记录与 skip 记录。
 */
function applyMigration(plan, { projectRoot, manifestsDir = DEFAULT_MANIFESTS_DIR, write = (p, data) => fs.writeFileSync(p, data, 'utf8') } = {}) {
  const specsDir = getCodeSpecsDir(projectRoot)
  const root = specsDir.exists ? specsDir.path : path.join(projectRoot || process.cwd(), '.claude', 'code-specs')
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })

  const rollback = []
  let failed = null

  const writeRollback = () => {
    const p = path.join(root, '.migration-rollback.json')
    write(p, JSON.stringify({ rollbackKey: plan.rollbackKey, steps: rollback, failed }, null, 2) + '\n')
    return p
  }
  const writeSkipped = () => {
    if (!plan.skip || !plan.skip.length) return null
    const p = path.join(root, '.migration-skipped.json')
    write(p, JSON.stringify({ rollbackKey: plan.rollbackKey, skipped: plan.skip.map((s) => ({
      manifestVersion: s.manifestVersion,
      index: s.index,
      type: s.entry.type,
      reason: s.reason,
      actualHash: s.actualHash || null,
      entry: s.entry,
    })) }, null, 2) + '\n')
    return p
  }

  for (const step of plan.apply || []) {
    const { plan: op } = step
    try {
      if (op.action === 'rename' || op.action === 'rename-dir') {
        if (fs.existsSync(op.dst)) throw new Error(`target already exists: ${op.dst}`)
        fs.mkdirSync(path.dirname(op.dst), { recursive: true })
        fs.renameSync(op.src, op.dst)
        rollback.push({ step, result: 'ok' })
      } else if (op.action === 'rename-section') {
        const content = fs.readFileSync(op.target, 'utf8')
        const newContent = content.replace(new RegExp(`^${op.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`, 'm'), op.to)
        if (content === newContent) throw new Error(`section '${op.from}' not found in ${op.target}`)
        write(op.target, newContent)
        rollback.push({ step, result: 'ok' })
      } else if (op.action === 'delete-section') {
        const content = fs.readFileSync(op.target, 'utf8')
        const lines = content.split('\n')
        const startIdx = lines.findIndex((l) => l.trim() === op.section)
        if (startIdx < 0) throw new Error(`section '${op.section}' not found in ${op.target}`)
        let endIdx = lines.length
        for (let i = startIdx + 1; i < lines.length; i++) {
          if (/^##\s/.test(lines[i])) { endIdx = i; break }
        }
        const newLines = [...lines.slice(0, startIdx), ...lines.slice(endIdx)]
        write(op.target, newLines.join('\n'))
        rollback.push({ step, result: 'ok', removedLines: endIdx - startIdx })
      } else if (op.action === 'safe-file-delete' || op.action === 'delete') {
        fs.unlinkSync(op.target)
        rollback.push({ step, result: 'ok' })
      }
    } catch (err) {
      failed = { step, error: err instanceof Error ? err.message : String(err) }
      rollback.push({ step, result: 'failed', error: failed.error })
      break
    }
  }

  writeSkipped()
  const rollbackPath = writeRollback()

  if (failed) {
    return {
      status: 'failed_partial',
      rollbackKey: plan.rollbackKey,
      rollbackPath,
      failed,
      completedSteps: rollback.filter((r) => r.result === 'ok').length,
    }
  }
  return {
    status: 'ok',
    rollbackKey: plan.rollbackKey,
    rollbackPath,
    completedSteps: rollback.length,
  }
}

module.exports = {
  planMigration,
  applyMigration,
  PRE_5_2,
  // 测试 / 调试辅助
  _internals: {
    findChain,
    resolveManifestTargetVersion,
    computeHash,
    isProtected,
    hasVariableMarker,
    listManifests,
  },
}

if (require.main === module) {
  const argv = process.argv.slice(2)
  const mode = argv[0] || 'plan'
  const getArg = (flag) => {
    const idx = argv.indexOf(flag)
    return idx >= 0 ? argv[idx + 1] : null
  }
  if (mode === 'plan') {
    const plan = planMigration({
      fromVersion: getArg('--from'),
      toVersion: getArg('--to'),
      projectRoot: getArg('--project-root') || process.cwd(),
      manifestsDir: getArg('--manifests-dir') || DEFAULT_MANIFESTS_DIR,
    })
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
  } else {
    process.stderr.write('unknown mode; only "plan" is supported on CLI. Use applyMigration programmatically.\n')
    process.exit(1)
  }
}
