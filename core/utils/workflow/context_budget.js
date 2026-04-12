#!/usr/bin/env node
/**
 * @file 上下文预算管理 - 提供 token 估算、复杂度检测、预算阈值评估和上下文进度条生成
 */

const fs = require('fs')

/**
 * 根据字符数粗略估算 token 数量（约 4 字符 = 1 token）
 * @param {...string} contents - 一个或多个文本内容
 * @returns {number} 估算的 token 数
 */
function estimateTokens(...contents) {
  const totalChars = contents.reduce((sum, content) => sum + (content ? String(content).length : 0), 0)
  return Math.round(totalChars / 4)
}

/**
 * 根据动作数、文件数等信号判断任务复杂度
 * @param {number} actionsCount - 动作数量
 * @param {number} fileCount - 涉及文件数量
 * @param {boolean} isQualityGate - 是否为质量关卡
 * @param {boolean} hasStructuredSteps - 是否包含结构化步骤
 * @returns {'simple'|'medium'|'complex'} 复杂度等级
 */
function detectComplexity(actionsCount, fileCount, isQualityGate, hasStructuredSteps) {
  if (isQualityGate || hasStructuredSteps || fileCount > 1) return 'complex'
  if (actionsCount > 2) return 'medium'
  return 'simple'
}

/**
 * 根据复杂度和当前使用率计算单次可执行的最大任务数
 * @param {string} complexity - 复杂度等级（simple/medium/complex）
 * @param {number} usagePercent - 当前上下文使用百分比
 * @returns {number} 最大可执行任务数
 */
function calculateMaxTasks(complexity, usagePercent) {
  const baseLimit = { simple: 8, medium: 5, complex: 3 }[complexity] || 5
  if (usagePercent >= 80) return 1
  if (usagePercent >= 70) return Math.max(2, baseLimit - 3)
  if (usagePercent >= 50) return Math.max(3, baseLimit - 1)
  return baseLimit
}

/**
 * 评估预计使用率是否触达各级预算阈值
 * @param {number} projectedUsagePercent - 预计使用百分比
 * @param {number} warningThreshold - 警告阈值（默认 60）
 * @param {number} dangerThreshold - 危险阈值（默认 80）
 * @param {number} hardHandoffThreshold - 强制交接阈值（默认 90）
 * @returns {Object} 包含 level 和各阈值命中状态的评估结果
 */
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

/**
 * 预估下一轮操作的 token 消耗总量
 * @param {number} currentTokens - 当前已用 token 数
 * @param {number} executionCost - 执行消耗（默认 8000）
 * @param {number} verificationCost - 验证消耗（默认 5000）
 * @param {number} reviewCost - 审查消耗（默认 0）
 * @param {number} safetyBuffer - 安全缓冲（默认 4000）
 * @returns {Object} 各项消耗明细和预计总量
 */
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

/**
 * 生成可视化的上下文使用率进度条字符串
 * @param {number} usagePercent - 使用百分比
 * @param {number} warningThreshold - 警告阈值（默认 60）
 * @param {number} dangerThreshold - 危险阈值（默认 80）
 * @returns {string} 带颜色 emoji 的进度条字符串，如 [🟩🟩🟨🟥░░] 45%
 */
function generateContextBar(usagePercent, warningThreshold = 60, dangerThreshold = 80) {
  const filled = Math.round(usagePercent / 5)
  let bar = ''
  for (let i = 0; i < 20; i += 1) {
    if (i < filled) bar += i >= dangerThreshold / 5 ? '🟥' : i >= warningThreshold / 5 ? '🟨' : '🟩'
    else bar += '░'
  }
  return `[${bar}] ${Math.round(usagePercent)}%`
}

/**
 * 解析 CLI 参数，提取子命令和选项
 * @param {string[]} argv - 命令行参数数组
 * @returns {{command: string, args: string[], options: Object}} 解析结果
 */
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
