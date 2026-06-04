#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function createEvidence(command, exitCode, outputSummary, passed, artifactRef, requireFiles) {
  const evidence = {
    command,
    exit_code: exitCode,
    output_summary: String(outputSummary || '').slice(0, 500),
    timestamp: new Date().toISOString(),
    passed: Boolean(passed),
  }
  if (artifactRef) evidence.artifact_ref = artifactRef
  if (Array.isArray(requireFiles) && requireFiles.length) {
    evidence.require_files = requireFiles.map((f) => path.resolve(f))
  }
  return evidence
}

const ACTION_VERIFICATION_MAP = {
  create_file: {
    description: '运行相关测试 或 语法检查',
    pass_condition: '测试通过 或 无语法错误',
  },
  edit_file: {
    description: '运行相关测试 或 语法检查',
    pass_condition: '测试通过 或 无语法错误',
  },
  run_tests: {
    description: '读取测试输出',
    pass_condition: '全部通过，exit_code = 0',
  },
  quality_review: {
    description: '读取两阶段审查结果',
    pass_condition: 'reviewer PASS（内存确认，不持久化）',
  },
  git_commit: {
    description: 'git log -1 --format="%H %s"',
    pass_condition: 'commit hash 存在且消息匹配',
  },
}

function getVerificationInfo(action) {
  return ACTION_VERIFICATION_MAP[action] || null
}

function getVerificationCommands(actions) {
  const result = []
  const seen = new Set()
  for (const action of actions || []) {
    const info = getVerificationInfo(action)
    if (!info || seen.has(info.description)) continue
    result.push({ action, ...info })
    seen.add(info.description)
  }
  return result
}

function validateEvidence(evidence) {
  const required = ['command', 'exit_code', 'output_summary', 'timestamp', 'passed']
  const missingFields = required.filter((field) => !(field in (evidence || {})))
  if (missingFields.length) return { valid: false, missing_fields: missingFields }

  const violations = []

  // 新鲜度校验：timestamp 必须在 15 分钟内
  const FRESHNESS_WINDOW_MS = 15 * 60 * 1000
  const age = Date.now() - new Date(evidence.timestamp).getTime()
  if (Number.isNaN(age) || age > FRESHNESS_WINDOW_MS) {
    violations.push(`evidence_stale:${Math.round(age / 1000)}s`)
  }

  // 一致性校验：passed 与 exit_code 逻辑一致
  if (evidence.passed && evidence.exit_code !== 0) {
    violations.push(`inconsistent:passed=true,exit_code=${evidence.exit_code}`)
  }
  if (!evidence.passed && evidence.exit_code === 0 && !evidence.artifact_ref) {
    violations.push('inconsistent:passed=false,exit_code=0,no_artifact_ref')
  }

  // 必需文件校验：require_files 列出的文件必须存在
  if (Array.isArray(evidence.require_files)) {
    for (const f of evidence.require_files) {
      if (!fs.existsSync(f)) violations.push(`missing_required_files:${f}`)
    }
  }

  return { valid: violations.length === 0, missing_fields: [], violations }
}

function parseArgs(argv) {
  const args = [...argv]
  const positionals = []
  const options = {}
  let command = null

  while (args.length) {
    const token = args.shift()
    if (!command && !token.startsWith('--')) {
      command = token
      continue
    }
    if (token === '--cmd') options.cmd = args.shift()
    else if (token === '--exit-code') options.exitCode = Number(args.shift())
    else if (token === '--output') options.output = args.shift()
    else if (token === '--passed') options.passed = true
    else if (token === '--artifact-ref') options.artifactRef = args.shift()
    else if (token === '--require-files') {
      const v = args.shift()
      options.requireFiles = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
    }
    else positionals.push(token)
  }

  return { command, args: positionals, options }
}

function main() {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'create') {
    const evidence = createEvidence(options.cmd, options.exitCode, options.output, options.passed, options.artifactRef, options.requireFiles)
    const validation = validateEvidence(evidence)
    process.stdout.write(`${JSON.stringify({ ...evidence, validation }, null, 2)}\n`)
    if (!validation.valid) process.exitCode = 1
    return
  }
  if (command === 'info') {
    process.stdout.write(`${JSON.stringify(getVerificationCommands(args), null, 2)}\n`)
    return
  }
  process.stderr.write('Usage: node verification.js <create|info> ...\n')
  process.exitCode = 1
}

module.exports = {
  createEvidence,
  getVerificationInfo,
  getVerificationCommands,
  validateEvidence,
}

if (require.main === module) main()
