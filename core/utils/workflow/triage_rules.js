#!/usr/bin/env node
/**
 * @file triage_rules.js — 触达文件分诊：判断哪些 touched 文件应归入 in_scope / out_of_scope
 *
 * 双层 denylist：硬编码默认（保守，宁可错杀进 out_of_scope） + project-config.json
 * 的 workflow.triageDenylist 数组追加。匹配命中即标记 reason。
 *
 * CommonJS。不 require 任何 .mjs —— codex job 结果直接读文件路径 + JSON.parse。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

// 硬编码默认 denylist。每条规则带类别 id，命中时写进 reasons。
// 保守原则：这些路径几乎不可能是 task 的合法产物。
const DEFAULT_DENYLIST = [
  { pattern: '.claude/settings.*', rule_id: 'denylist:claude_settings' },
  { pattern: '*-lock.yaml', rule_id: 'denylist:lockfile' },
  { pattern: '*-lock.json', rule_id: 'denylist:lockfile' },
  { pattern: '.env', rule_id: 'denylist:env' },
  { pattern: '.env.*', rule_id: 'denylist:env' },
  { pattern: '.pnpm-store/**', rule_id: 'denylist:cache' },
  { pattern: 'node_modules/**', rule_id: 'denylist:cache' },
]

/**
 * 最简 glob 匹配 helper —— 仅支持 `*`（不跨 `/`）与 `**`（跨任意层级）。
 * 不引入 minimatch 等新依赖。
 *
 * @param {string} pattern glob 规则
 * @param {string} target  待匹配路径（已归一化为 `/` 分隔）
 * @returns {boolean}
 */
function globMatch(pattern, target) {
  let regex = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '/' && pattern[i + 1] === '*' && pattern[i + 2] === '*') {
      // `/**` —— 该目录自身及其下任意层级。`dir/**` 同时匹配 `dir` 与 `dir/a/b`。
      // 不消费 `**` 之后的 `/`：中段 `a/**/b` 借后续字面 `/b` 保持层级语义。
      regex += '(/.*)?'
      i += 2
    } else if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // 非 `/` 前导的 `**` —— 跨任意层级（含 `/`）。
        regex += '.*'
        i += 1
      } else {
        // 单 `*` —— 匹配除 `/` 外任意字符。
        regex += '[^/]*'
      }
    } else if ('.+?^${}()|[]\\'.includes(ch)) {
      regex += `\\${ch}`
    } else {
      regex += ch
    }
  }
  return new RegExp(`^${regex}$`).test(target)
}

function normalizePath(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * 评估一组 touched 文件的分诊结果。
 *
 * @param {string[]} touchedFiles  codex job 报告的触达文件列表
 * @param {object|null} projectConfig  project-config.json 内容（用于读 workflow.triageDenylist）
 * @returns {{in_scope:string[], out_of_scope:string[], suggested_reverts:string[], reasons:object}}
 */
function evaluateTriage(touchedFiles, projectConfig) {
  const files = Array.isArray(touchedFiles) ? touchedFiles : []

  const projectDenylist = (projectConfig &&
    projectConfig.workflow &&
    Array.isArray(projectConfig.workflow.triageDenylist))
    ? projectConfig.workflow.triageDenylist
    : []

  const rules = [
    ...DEFAULT_DENYLIST,
    ...projectDenylist
      .map((pattern) => String(pattern || '').trim())
      .filter(Boolean)
      .map((pattern) => ({ pattern, rule_id: 'denylist:project_config' })),
  ]

  const inScope = []
  const outOfScope = []
  const reasons = {}

  for (const rawFile of files) {
    const file = normalizePath(rawFile)
    if (!file) continue
    let matched = null
    for (const rule of rules) {
      if (globMatch(normalizePath(rule.pattern), file)) {
        matched = rule
        break
      }
    }
    // 用归一化后的 file 作为存储元素与 reasons key：`./x.ts` 与 `x.ts` 视为同一文件，
    // 避免 suggested_reverts 出现指向同一路径的重复/歧义条目。
    if (matched) {
      if (!outOfScope.includes(file)) outOfScope.push(file)
      reasons[file] = matched.rule_id
    } else if (!inScope.includes(file)) {
      inScope.push(file)
    }
  }

  return {
    in_scope: inScope,
    out_of_scope: outOfScope,
    suggested_reverts: [...outOfScope],
    reasons,
  }
}

/**
 * 定位并读取 codex job 结果，拿 touchedFiles[]。
 *
 * codex job 落盘于 ~/.claude/tmp/codex-jobs/<bucket>/<jobId>.json。
 * bucket 名不可预测，遍历各子目录找匹配 `<jobId>.json` 的文件。
 *
 * @param {string} jobId  codex job id
 * @param {string} _projectRoot  项目根（保留参数，codex job 目录不受项目根约束）
 * @returns {{touchedFiles:string[]}|{error:string}}
 */
function loadCodexJobResult(jobId, _projectRoot) {
  const id = String(jobId || '').trim()
  if (!id) return { error: 'codex job not found' }

  const jobsRoot = path.join(os.homedir(), '.claude', 'tmp', 'codex-jobs')
  if (!fs.existsSync(jobsRoot)) return { error: 'codex job not found' }

  let buckets
  try {
    buckets = fs.readdirSync(jobsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return { error: 'codex job not found' }
  }

  for (const bucket of buckets) {
    const jobFile = path.join(jobsRoot, bucket, `${id}.json`)
    if (!fs.existsSync(jobFile)) continue
    try {
      const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'))
      return { touchedFiles: Array.isArray(job.touchedFiles) ? job.touchedFiles : [] }
    } catch {
      return { error: 'codex job not found' }
    }
  }

  return { error: 'codex job not found' }
}

module.exports = {
  DEFAULT_DENYLIST,
  globMatch,
  evaluateTriage,
  loadCodexJobResult,
}
