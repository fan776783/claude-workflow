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
  process.stderr.write('Usage: node verification.js create --cmd <cmd> --exit-code <n> --output <summary> [--passed] [--artifact-ref <ref>] [--require-files <csv>]\n')
  process.exitCode = 1
}

module.exports = {
  createEvidence,
  validateEvidence,
}

if (require.main === module) main()
