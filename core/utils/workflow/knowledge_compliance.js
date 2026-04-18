#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { getKnowledgeDir } = require('./path_utils')

const VALID_SEVERITIES = new Set(['blocking', 'warning'])
const VALID_KINDS = new Set(['forbid', 'require', 'warn'])

function listKnowledgeFiles(projectRoot) {
  const dirInfo = getKnowledgeDir(projectRoot)
  if (!dirInfo.exists) return []
  const results = []
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'guides') continue // guides 仅思考清单，不参与机读
        walk(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      if (entry.name === 'index.md' || entry.name === 'local.md') continue
      results.push(full)
    }
  }
  walk(dirInfo.path)
  return results
}

function extractRuleBlocks(content) {
  const sectionMatch = content.match(/##\s+Machine-checkable Rules[\s\S]*?(?=\n##\s+|$)/i)
  if (!sectionMatch) return []
  const section = sectionMatch[0]
  const blocks = []
  const fenceRegex = /```ya?ml\s*\n([\s\S]*?)```/g
  let match
  while ((match = fenceRegex.exec(section)) !== null) {
    blocks.push(match[1])
  }
  return blocks
}

function unescapeDoubleQuoted(value) {
  return String(value || '').replace(/\\(.)/g, (_, ch) => {
    if (ch === 'n') return '\n'
    if (ch === 't') return '\t'
    if (ch === 'r') return '\r'
    if (ch === '0') return '\0'
    return ch
  })
}

function parseYamlBlock(block) {
  const result = {}
  const lines = String(block || '').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '')
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = unescapeDoubleQuoted(value.slice(1, -1))
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function normalizeRule(raw, source) {
  if (!raw || typeof raw !== 'object') return null
  const kind = String(raw.kind || '').toLowerCase()
  const severity = String(raw.severity || '').toLowerCase()
  if (!VALID_KINDS.has(kind)) return null
  if (!VALID_SEVERITIES.has(severity)) return null
  if (!raw.pattern) return null
  let regex
  try {
    regex = new RegExp(raw.pattern)
  } catch {
    return null
  }
  return {
    id: String(raw.id || 'unnamed'),
    kind,
    severity,
    pattern: String(raw.pattern),
    regex,
    applies_to: raw.applies_to ? String(raw.applies_to) : null,
    message: String(raw.message || ''),
    source,
  }
}

function globToRegex(pattern) {
  if (!pattern) return null
  let regex = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      regex += '.*'
      i += 2
      if (pattern[i] === '/') i += 1
      continue
    }
    if (ch === '*') { regex += '[^/]*'; i += 1; continue }
    if (ch === '?') { regex += '[^/]'; i += 1; continue }
    if (ch === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) { regex += '\\{'; i += 1; continue }
      const options = pattern.slice(i + 1, end).split(',').map((opt) => opt.trim()).filter(Boolean)
      regex += `(?:${options.map((opt) => opt.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`
      i = end + 1
      continue
    }
    if ('.+^$()|[]\\'.includes(ch)) { regex += `\\${ch}`; i += 1; continue }
    regex += ch
    i += 1
  }
  try {
    return new RegExp(`^${regex}$`)
  } catch {
    return null
  }
}

function ruleAppliesToFile(rule, filePath) {
  if (!rule.applies_to) return true
  const normalized = filePath.replace(/\\/g, '/')
  const regex = globToRegex(rule.applies_to)
  if (!regex) return true
  return regex.test(normalized)
}

function loadRules(projectRoot) {
  const files = listKnowledgeFiles(projectRoot)
  const rules = []
  for (const file of files) {
    let content = ''
    try { content = fs.readFileSync(file, 'utf8') } catch { continue }
    const blocks = extractRuleBlocks(content)
    for (const block of blocks) {
      const raw = parseYamlBlock(block)
      const rule = normalizeRule(raw, path.relative(projectRoot, file).replace(/\\/g, '/'))
      if (rule) rules.push(rule)
    }
  }
  return rules
}

function runGit(args, projectRoot) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0) return { ok: false, stdout: '', stderr: String(result.stderr || '') }
  return { ok: true, stdout: String(result.stdout || ''), stderr: '' }
}

function collectChangedFiles(projectRoot, baseCommit) {
  const args = ['diff', '--name-status']
  if (baseCommit) args.push(baseCommit)
  const res = runGit(args, projectRoot)
  if (!res.ok) return { ok: false, files: [], stderr: res.stderr }
  const files = []
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line) continue
    const parts = line.split('\t')
    const status = String(parts[0] || '').trim()
    if (!status) continue
    const letter = status.charAt(0)
    if (letter === 'R' || letter === 'C') {
      const src = parts[1]
      const dst = parts[2] || parts[1]
      if (dst) files.push({ status: letter, file: dst.replace(/\\/g, '/') })
      if (src && src !== dst) files.push({ status: 'D', file: src.replace(/\\/g, '/') })
    } else {
      const file = parts[1]
      if (file) files.push({ status: letter, file: file.replace(/\\/g, '/') })
    }
  }
  // Include untracked files — forbid rules must not be bypassed by "forget to git add"
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], projectRoot)
  if (untracked.ok) {
    for (const line of untracked.stdout.split(/\r?\n/)) {
      const file = line.trim()
      if (!file) continue
      files.push({ status: 'U', file: file.replace(/\\/g, '/') })
    }
  }
  return { ok: true, files, stderr: '' }
}

function syntheticHunksForFile(projectRoot, file) {
  const abs = path.join(projectRoot, file)
  try {
    const content = fs.readFileSync(abs, 'utf8')
    const lines = content.split(/\r?\n/)
    const hunks = []
    for (let i = 0; i < lines.length; i += 1) {
      hunks.push({ file: file.replace(/\\/g, '/'), line: i + 1, text: lines[i] })
    }
    return hunks
  } catch {
    return []
  }
}

function parseDiff(diffText) {
  const hunks = []
  if (!diffText) return hunks
  const lines = diffText.split(/\r?\n/)
  let currentFile = null
  let newLineNo = 0
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/ b\/(.+)$/)
      currentFile = match ? match[1] : null
      newLineNo = 0
      continue
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim()
      if (target === '/dev/null') { currentFile = null; continue }
      currentFile = target.replace(/^b\//, '')
      continue
    }
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)(?:,\d+)?/)
      if (match) newLineNo = parseInt(match[1], 10) - 1
      continue
    }
    if (!currentFile) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLineNo += 1
      hunks.push({ file: currentFile, line: newLineNo, text: line.slice(1) })
      continue
    }
    if (line.startsWith('-')) continue
    newLineNo += 1
  }
  return hunks
}

function readFileAtHead(projectRoot, file) {
  const abs = path.join(projectRoot, file)
  try { return fs.readFileSync(abs, 'utf8') } catch { return null }
}

function checkRequireRule(rule, changedFileRecords, projectRoot) {
  const violations = []
  for (const record of changedFileRecords) {
    if (record.status === 'D') continue
    if (!ruleAppliesToFile(rule, record.file)) continue
    const content = readFileAtHead(projectRoot, record.file)
    if (content === null) {
      violations.push({
        file: record.file,
        line: 0,
        rule: rule.id,
        knowledge_source: rule.source,
        severity: rule.severity,
        message: rule.message || `required pattern missing (file not readable): ${rule.pattern}`,
      })
      continue
    }
    if (!rule.regex.test(content)) {
      violations.push({
        file: record.file,
        line: 0,
        rule: rule.id,
        knowledge_source: rule.source,
        severity: rule.severity,
        message: rule.message || `missing required pattern: ${rule.pattern}`,
      })
    }
  }
  return violations
}

function checkForbidRule(rule, hunks) {
  const violations = []
  for (const hunk of hunks) {
    if (!ruleAppliesToFile(rule, hunk.file)) continue
    if (rule.regex.test(hunk.text)) {
      violations.push({
        file: hunk.file,
        line: hunk.line,
        rule: rule.id,
        knowledge_source: rule.source,
        severity: rule.severity,
        message: rule.message || `forbidden pattern matched: ${rule.pattern}`,
        snippet: hunk.text.trim().slice(0, 200),
      })
    }
  }
  return violations
}

function checkCompliance({ projectRoot = process.cwd(), baseCommit = null } = {}) {
  const root = path.resolve(projectRoot)
  const rules = loadRules(root)
  if (!rules.length) {
    return { compliant: true, rules_count: 0, violations: [], warnings: [], checked_files: 0, base_commit: baseCommit }
  }

  // Review surface = (base..HEAD if base given) ∪ working tree (staged + unstaged).
  // `git diff [base]` without `..HEAD` expands to exactly this surface.
  const diffArgs = ['diff', '--unified=0']
  if (baseCommit) diffArgs.push(baseCommit)
  const diffRes = runGit(diffArgs, root)
  const nameStatus = collectChangedFiles(root, baseCommit)

  if (!diffRes.ok || !nameStatus.ok) {
    const stderr = [diffRes.stderr, nameStatus.stderr].filter(Boolean).join(' | ')
    return {
      compliant: false,
      rules_count: rules.length,
      violations: [{
        file: '<git>',
        line: 0,
        rule: 'git-diff-failed',
        knowledge_source: 'knowledge_compliance',
        severity: 'blocking',
        message: `git diff failed while computing review surface: ${stderr || 'unknown error'}`,
      }],
      warnings: [],
      checked_files: 0,
      base_commit: baseCommit,
      error: `git diff failed: ${stderr || 'unknown error'}`,
    }
  }

  const hunks = parseDiff(diffRes.stdout)
  const changedFileRecords = nameStatus.files
  // For untracked files, treat every line as an added hunk so forbid rules apply.
  for (const record of changedFileRecords) {
    if (record.status === 'U') {
      for (const hunk of syntheticHunksForFile(root, record.file)) hunks.push(hunk)
    }
  }

  const violations = []
  const warnings = []
  for (const rule of rules) {
    let matches = []
    if (rule.kind === 'forbid' || rule.kind === 'warn') {
      matches = checkForbidRule(rule, hunks)
    } else if (rule.kind === 'require') {
      matches = checkRequireRule(rule, changedFileRecords, root)
    }
    for (const match of matches) {
      if (match.severity === 'blocking') violations.push(match)
      else warnings.push(match)
    }
  }

  return {
    compliant: violations.length === 0,
    rules_count: rules.length,
    violations,
    warnings,
    checked_files: changedFileRecords.length,
    base_commit: baseCommit,
  }
}

function formatReport(result) {
  const lines = []
  lines.push(`Rules loaded: ${result.rules_count}`)
  lines.push(`Files changed: ${result.checked_files}`)
  lines.push(`Blocking violations: ${result.violations.length}`)
  lines.push(`Warnings: ${result.warnings.length}`)
  for (const v of result.violations) {
    lines.push(`  [BLOCK] ${v.file}:${v.line} (${v.rule}) — ${v.message} @ ${v.knowledge_source}`)
  }
  for (const w of result.warnings) {
    lines.push(`  [WARN ] ${w.file}:${w.line} (${w.rule}) — ${w.message} @ ${w.knowledge_source}`)
  }
  return lines.join('\n')
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : null
  }
  if (command === 'check') {
    const projectRoot = option('--project-root') || process.cwd()
    const baseCommit = option('--base-commit')
    const format = option('--format') || 'json'
    const result = checkCompliance({ projectRoot, baseCommit })
    if (format === 'text') {
      process.stdout.write(`${formatReport(result)}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    }
    process.exitCode = result.compliant ? 0 : 2
    return
  }
  if (command === 'rules') {
    const projectRoot = option('--project-root') || process.cwd()
    const rules = loadRules(path.resolve(projectRoot)).map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, source: r.source, applies_to: r.applies_to }))
    process.stdout.write(`${JSON.stringify({ rules })}\n`)
    return
  }
  process.stderr.write('Usage: node knowledge_compliance.js <check|rules> [--project-root <path>] [--base-commit <sha>] [--format json|text]\n')
  process.exitCode = 1
}

module.exports = {
  listKnowledgeFiles,
  extractRuleBlocks,
  parseYamlBlock,
  normalizeRule,
  loadRules,
  parseDiff,
  checkCompliance,
  globToRegex,
  ruleAppliesToFile,
  collectChangedFiles,
}

if (require.main === module) main()
