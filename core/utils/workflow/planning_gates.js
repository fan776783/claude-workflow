#!/usr/bin/env node
/** @file 规划阶段门控逻辑 - Spec 审查映射、角色信号推导、Codex 审查触发、工作区检测 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { classifyRoleSignals } = require('./role_injection')

/**
 * 从需求内容中推导角色信号（委托给 role_injection 模块）
 * @param {string} requirementContent - 需求内容文本
 * @param {Array} [analysisPatterns=[]] - 项目分析模式
 * @param {Object|null} [discussionArtifact=null] - 讨论阶段产物
 * @param {Object} [extra={}] - 额外上下文信息
 * @returns {Object} 角色信号分类结果
 */
function deriveRoleSignals(requirementContent, analysisPatterns = [], discussionArtifact = null, extra = {}) {
  return classifyRoleSignals(requirementContent, analysisPatterns, discussionArtifact, extra)
}

/**
 * 检测系统中已安装的 AI 编码工具工作区
 * @param {string} homeDir - 用户主目录路径
 * @returns {Array<Object>} 检测到的工作区列表，每项包含 agent、path、detected
 */
function detectAgentWorkspaces(homeDir) {
  const home = path.resolve(homeDir || os.homedir())
  const cursorCandidates = [path.join(home, '.cursor'), path.join(home, '.config', 'Cursor'), path.join(home, 'AppData', 'Roaming', 'Cursor')]
  const cursorPath = cursorCandidates.find((candidate) => fs.existsSync(candidate)) || cursorCandidates[0]
  return [
    { agent: 'claude-code', path: path.join(home, '.claude'), detected: fs.existsSync(path.join(home, '.claude')) },
    { agent: 'cursor', path: cursorPath, detected: fs.existsSync(cursorPath) },
    { agent: 'codex', path: path.join(home, '.codex'), detected: fs.existsSync(path.join(home, '.codex')) },
  ]
}

/**
 * 将用户的 Spec 审查选择映射为状态和下一步动作
 * @param {string} choice - 用户选择的审查结论文本
 * @returns {Object} 包含 status、next_action、workflow_status 的映射结果
 */
function mapSpecReviewChoice(choice) {
  return {
    'Spec 正确，生成 Plan': { status: 'approved', next_action: 'continue_to_plan_generation', workflow_status: 'spec_review' },
    'Spec 正确，继续': { status: 'approved', next_action: 'continue_to_plan_generation', workflow_status: 'spec_review' },
    '需要修改 Spec': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation', workflow_status: 'spec_review' },
    '页面分层需要调整': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation', workflow_status: 'spec_review' },
    '缺少用户流程': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation', workflow_status: 'spec_review' },
    '缺少需求细节': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation_preserve_requirement_details', workflow_status: 'spec_review' },
    '需要拆分范围': { status: 'rejected', next_action: 'split_scope', workflow_status: 'idle' },
  }[choice] || { status: 'pending', next_action: null, workflow_status: 'spec_review' }
}

/**
 * 判断是否需要执行 Codex Spec 审查（advisory-to-human）
 * @param {string} specContent - Spec 文档内容
 * @param {Object} [signals={}] - deriveRoleSignals 输出的结构化信号
 * @returns {{ run: boolean, reason: string|null }} 是否触发及触发原因
 */
function shouldRunCodexSpecReview(specContent, signals = {}) {
  if (signals.security) return { run: true, reason: 'signal:security' }
  if (signals.backend_heavy) return { run: true, reason: 'signal:backend_heavy' }
  if (signals.data) return { run: true, reason: 'signal:data' }
  const SUPPLEMENT_REGEX = /migration|transaction|concurrency|rate.?limit/i
  if (SUPPLEMENT_REGEX.test(String(specContent || ''))) {
    const match = String(specContent || '').match(SUPPLEMENT_REGEX)
    return { run: true, reason: `regex:${match[0].toLowerCase()}` }
  }
  return { run: false, reason: null }
}

/**
 * 判断是否需要执行 Codex Plan 审查（bounded-autofix）
 * @param {string} planContent - Plan 文档内容
 * @param {string} specContent - Spec 文档内容（备用）
 * @param {Object} [signals={}] - deriveRoleSignals 输出的结构化信号
 * @returns {{ run: boolean, reason: string|null }} 是否触发及触发原因
 */
function shouldRunCodexPlanReview(planContent, specContent, signals = {}) {
  if (signals.security) return { run: true, reason: 'signal:security' }
  if (signals.backend_heavy) return { run: true, reason: 'signal:backend_heavy' }
  if (signals.data) return { run: true, reason: 'signal:data' }
  const SUPPLEMENT_REGEX = /migration|transaction|rollback|queue|worker|cron|webhook|oauth|jwt|rbac/i
  if (SUPPLEMENT_REGEX.test(String(planContent || ''))) {
    const match = String(planContent || '').match(SUPPLEMENT_REGEX)
    return { run: true, reason: `regex:${match[0].toLowerCase()}` }
  }
  return { run: false, reason: null }
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  if (command === 'workspaces') {
    const homeIndex = args.indexOf('--home')
    process.stdout.write(`${JSON.stringify({ workspaces: detectAgentWorkspaces(homeIndex >= 0 ? args[homeIndex + 1] : undefined) })}\n`)
    return
  }
  if (command === 'spec-review-choice') {
    process.stdout.write(`${JSON.stringify(mapSpecReviewChoice(args.shift()))}\n`)
    return
  }
  if (command === 'codex-spec-review') {
    const content = args.shift() || ''
    const signalsIndex = args.indexOf('--signals-json')
    const signals = signalsIndex >= 0 ? JSON.parse(args[signalsIndex + 1]) : {}
    process.stdout.write(`${JSON.stringify(shouldRunCodexSpecReview(content, signals))}\n`)
    return
  }
  if (command === 'codex-plan-review') {
    const planContent = args.shift() || ''
    const specContent = args.shift() || ''
    const signalsIndex = args.indexOf('--signals-json')
    const signals = signalsIndex >= 0 ? JSON.parse(args[signalsIndex + 1]) : {}
    process.stdout.write(`${JSON.stringify(shouldRunCodexPlanReview(planContent, specContent, signals))}\n`)
    return
  }
  process.stderr.write('Usage: node planning_gates.js <workspaces|spec-review-choice|codex-spec-review|codex-plan-review> ...\n')
  process.exitCode = 1
}

module.exports = {
  deriveRoleSignals,
  detectAgentWorkspaces,
  mapSpecReviewChoice,
  shouldRunCodexSpecReview,
  shouldRunCodexPlanReview,
}

if (require.main === module) main()
