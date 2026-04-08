#!/usr/bin/env node

function createEvidence(command, exitCode, outputSummary, passed, artifactRef) {
  const evidence = {
    command,
    exit_code: exitCode,
    output_summary: String(outputSummary || '').slice(0, 500),
    timestamp: new Date().toISOString(),
    passed: Boolean(passed),
  }
  if (artifactRef) evidence.artifact_ref = artifactRef
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
    pass_condition: 'quality_gates[taskId].overall_passed === true',
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
  return { valid: missingFields.length === 0, missing_fields: missingFields }
}

function validateVerificationOrder(evidence, stateUpdated, planUpdated, qualityGatePassed = true) {
  const result = evidence ? validateEvidence(evidence) : { valid: false, missing_fields: ['evidence'] }
  const violations = []
  if (!result.valid) violations.push('missing_or_invalid_evidence')
  if ((stateUpdated || planUpdated) && !result.valid) violations.push('updated_before_verification')
  if (!qualityGatePassed) violations.push('quality_gate_not_passed')
  return { valid: violations.length === 0, violations }
}

function parseArgs(argv) {
  const args = [...argv]
  const options = {}
  while (args.length && args[0].startsWith('--')) {
    const flag = args.shift()
    if (flag === '--cmd') options.cmd = args.shift()
    else if (flag === '--exit-code') options.exitCode = Number(args.shift())
    else if (flag === '--output') options.output = args.shift()
    else if (flag === '--passed') options.passed = true
    else if (flag === '--artifact-ref') options.artifactRef = args.shift()
  }
  return { command: args.shift(), args, options }
}

function main() {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'create') {
    process.stdout.write(`${JSON.stringify(createEvidence(options.cmd, options.exitCode, options.output, options.passed, options.artifactRef), null, 2)}\n`)
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
  validateVerificationOrder,
}

if (require.main === module) main()
