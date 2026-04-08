#!/usr/bin/env node

const fs = require('fs')

function estimateTokens(...contents) {
  const totalChars = contents.reduce((sum, content) => sum + (content ? String(content).length : 0), 0)
  return Math.round(totalChars / 4)
}

function detectComplexity(actionsCount, fileCount, isQualityGate, hasStructuredSteps) {
  if (isQualityGate || hasStructuredSteps || fileCount > 1) return 'complex'
  if (actionsCount > 2) return 'medium'
  return 'simple'
}

function calculateMaxTasks(complexity, usagePercent) {
  const baseLimit = { simple: 8, medium: 5, complex: 3 }[complexity] || 5
  if (usagePercent >= 80) return 1
  if (usagePercent >= 70) return Math.max(2, baseLimit - 3)
  if (usagePercent >= 50) return Math.max(3, baseLimit - 1)
  return baseLimit
}

function evaluateBudgetThresholds(projectedUsagePercent, warningThreshold = 60, dangerThreshold = 80, hardHandoffThreshold = 90) {
  const atWarning = projectedUsagePercent >= warningThreshold
  const atDanger = projectedUsagePercent >= dangerThreshold
  const atHardHandoff = projectedUsagePercent >= hardHandoffThreshold
  const level = atHardHandoff ? 'hard_handoff' : atDanger ? 'danger' : atWarning ? 'warning' : 'safe'
  return {
    level,
    at_warning: atWarning,
    at_danger: atDanger,
    at_hard_handoff: atHardHandoff,
    projected_usage_percent: projectedUsagePercent,
  }
}

function projectNextTurnCost(currentTokens, executionCost = 8000, verificationCost = 5000, reviewCost = 0, safetyBuffer = 4000) {
  const projectedTotal = currentTokens + executionCost + verificationCost + reviewCost + safetyBuffer
  return {
    current: currentTokens,
    execution: executionCost,
    verification: verificationCost,
    review: reviewCost,
    safety: safetyBuffer,
    projected_total: projectedTotal,
  }
}

function generateContextBar(usagePercent, warningThreshold = 60, dangerThreshold = 80) {
  const filled = Math.round(usagePercent / 5)
  let bar = ''
  for (let i = 0; i < 20; i += 1) {
    if (i < filled) bar += i >= dangerThreshold / 5 ? '🟥' : i >= warningThreshold / 5 ? '🟨' : '🟩'
    else bar += '░'
  }
  return `[${bar}] ${Math.round(usagePercent)}%`
}

function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift()
  const options = {}
  while (args.length && args[0].startsWith('--')) {
    const flag = args.shift()
    if (flag === '--actions') options.actions = Number(args.shift())
    else if (flag === '--files') options.files = Number(args.shift())
    else if (flag === '--quality-gate') options.qualityGate = true
    else if (flag === '--structured-steps') options.structuredSteps = true
    else if (flag === '--complexity') options.complexity = args.shift()
    else if (flag === '--usage') options.usage = Number(args.shift())
    else if (flag === '--projected-usage') options.projectedUsage = Number(args.shift())
    else if (flag === '--warning') options.warning = Number(args.shift())
    else if (flag === '--danger') options.danger = Number(args.shift())
    else if (flag === '--hard-handoff') options.hardHandoff = Number(args.shift())
  }
  return { command, args, options }
}

function main() {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'estimate') {
    const contents = args.map((file) => {
      try {
        return fs.readFileSync(file, 'utf8')
      } catch {
        return null
      }
    })
    process.stdout.write(`${JSON.stringify({ estimated_tokens: estimateTokens(...contents) })}\n`)
    return
  }
  if (command === 'complexity') {
    process.stdout.write(`${JSON.stringify({ complexity: detectComplexity(options.actions || 1, options.files || 1, Boolean(options.qualityGate), Boolean(options.structuredSteps)) })}\n`)
    return
  }
  if (command === 'max-tasks') {
    process.stdout.write(`${JSON.stringify({ max_consecutive_tasks: calculateMaxTasks(options.complexity, options.usage) })}\n`)
    return
  }
  if (command === 'budget') {
    process.stdout.write(`${JSON.stringify(evaluateBudgetThresholds(options.projectedUsage, options.warning, options.danger, options.hardHandoff))}\n`)
    return
  }
  if (command === 'context-bar') {
    process.stdout.write(`${JSON.stringify({ bar: generateContextBar(options.usage) })}\n`)
    return
  }
  process.stderr.write('Usage: node context_budget.js <estimate|complexity|max-tasks|budget|context-bar> ...\n')
  process.exitCode = 1
}

module.exports = {
  estimateTokens,
  detectComplexity,
  calculateMaxTasks,
  evaluateBudgetThresholds,
  projectNextTurnCost,
  generateContextBar,
}

if (require.main === module) main()
