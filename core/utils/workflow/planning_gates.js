#!/usr/bin/env node
/** @file 规划阶段门控逻辑 - 讨论、UX 设计、Spec 审查等规划阶段的条件判断与产物构建 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { classifyRoleSignals } = require('./role_injection')

const UI_KEYWORDS_REGEX = /页面|界面|表单|列表|面板|弹窗|导航|路由|仪表盘|编辑器|sidebar|tab|modal|dashboard|GUI|桌面|desktop|窗口|window/i
const UI_BROAD_KEYWORDS_REGEX = /UI|界面|页面|组件|布局|样式|交互|显示|渲染|视图|前端/i
const WORKSPACE_KEYWORDS_REGEX = /同步|sync|agent|workspace|工作区|目录/i

/**
 * 判断是否需要执行需求讨论阶段
 * @param {string} requirementContent - 需求内容文本
 * @param {string} requirementSource - 需求来源类型（如 'inline'）
 * @param {boolean} [noDiscuss=false] - 是否强制跳过讨论
 * @param {number} [gapCount=0] - 需求缺口数量
 * @returns {boolean} 是否需要讨论
 */
function shouldRunDiscussion(requirementContent, requirementSource, noDiscuss = false, gapCount = 0) {
  if (noDiscuss) return false
  if (requirementSource === 'inline' && String(requirementContent || '').trim().length <= 100 && gapCount === 0) return false
  return true
}

/**
 * 估算需求内容中的缺口数量
 * @param {string} requirementContent - 需求内容文本
 * @param {string} requirementSource - 需求来源类型
 * @returns {number} 估算的缺口数
 */
function estimateGapCount(requirementContent, requirementSource) {
  const content = String(requirementContent || '').trim()
  if (requirementSource === 'inline' && content.length <= 100) return 0
  return content ? 1 : 0
}

/**
 * 构建讨论阶段产物对象
 * @param {string} requirementSource - 需求来源类型
 * @param {Array} [clarifications=[]] - 澄清项列表
 * @param {string|null} [selectedApproach=null] - 选定的实现方案
 * @param {Array} [unresolvedDependencies=[]] - 未解决的依赖列表
 * @returns {Object} 讨论产物对象
 */
function buildDiscussionArtifact(requirementSource, clarifications = [], selectedApproach = null, unresolvedDependencies = []) {
  return {
    requirementSource,
    clarifications,
    selectedApproach: selectedApproach || null,
    unresolvedDependencies,
  }
}

/**
 * 判断是否需要执行 UX 设计门控
 * @param {string} requirementContent - 需求内容文本
 * @param {Array} [analysisPatterns=[]] - 项目分析模式（如框架检测结果）
 * @param {Object|null} [discussionArtifact=null] - 讨论阶段产物
 * @returns {boolean} 是否需要 UX 设计门控
 */
function shouldRunUxDesignGate(requirementContent, analysisPatterns = [], discussionArtifact = null) {
  const content = String(requirementContent || '')
  if (UI_KEYWORDS_REGEX.test(content)) return true
  const hasFrontend = (analysisPatterns || []).some((pattern) => /react|vue|angular|svelte|tauri|electron|next\.?js|nuxt|vite/i.test(String((pattern || {}).name || '')))
  if (hasFrontend && UI_BROAD_KEYWORDS_REGEX.test(content)) return true
  const clarifications = ((discussionArtifact || {}).clarifications) || []
  return clarifications.some((clarification) => ['behavior', 'edge-case'].includes(clarification.dimension))
}

/**
 * 判断需求内容是否涉及工作区检测
 * @param {string} requirementContent - 需求内容文本
 * @returns {boolean} 是否需要工作区检测
 */
function needsWorkspaceDetection(requirementContent) {
  return WORKSPACE_KEYWORDS_REGEX.test(String(requirementContent || ''))
}

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
 * 校验 UX 设计产物的完整性
 * @param {Object} artifact - UX 设计产物对象
 * @returns {Object} 校验结果，包含 ok、missing、scenario_count、page_count
 */
function validateUxArtifact(artifact) {
  const flowchart = (artifact || {}).flowchart || {}
  const scenarios = flowchart.scenarios || []
  const pages = (((artifact || {}).pageHierarchy) || {}).pages || []
  const missing = []
  if (scenarios.length < 3) missing.push('flowchart_scenarios')
  const l0Count = pages.filter((page) => page.level === 'L0').length
  if (l0Count > 4) missing.push('l0_overflow')
  return { ok: missing.length === 0, missing, scenario_count: scenarios.length, page_count: pages.length }
}

/**
 * 从 Spec 内容中提取关键章节摘要，用于用户审查
 * @param {string} specContent - Spec 文档内容
 * @returns {string} 拼接后的关键章节摘要文本
 */
function buildSpecReviewSummary(specContent) {
  const allSections = String(specContent || '').split(/^(?=## \d)/m)
  const targetPrefixes = ['## 2.', '## 3.', '## 7.']
  return allSections.filter((s) => targetPrefixes.some((p) => s.trimStart().startsWith(p))).map((s) => s.trim()).join('\n\n')
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
    '页面分层需要调整': { status: 'revise_required', next_action: 'return_to_phase_0_3_ux_design_gate', workflow_status: 'spec_review' },
    '缺少用户流程': { status: 'revise_required', next_action: 'return_to_phase_0_3_ux_design_gate', workflow_status: 'spec_review' },
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
  if (command === 'discussion') {
    const content = args.shift()
    const sourceIndex = args.indexOf('--source')
    const noDiscuss = args.includes('--no-discuss')
    const gapIndex = args.indexOf('--gap-count')
    const source = sourceIndex >= 0 ? args[sourceIndex + 1] : 'inline'
    const gapCount = gapIndex >= 0 ? Number(args[gapIndex + 1]) : 0
    process.stdout.write(`${JSON.stringify({ run: shouldRunDiscussion(content, source, noDiscuss, gapCount) })}\n`)
    return
  }
  if (command === 'ux-gate') {
    const content = args.shift()
    const patternsIndex = args.indexOf('--patterns-json')
    const discussionIndex = args.indexOf('--discussion-json')
    const patterns = patternsIndex >= 0 ? JSON.parse(args[patternsIndex + 1]) : []
    const discussion = discussionIndex >= 0 ? JSON.parse(args[discussionIndex + 1]) : {}
    process.stdout.write(`${JSON.stringify({ run: shouldRunUxDesignGate(content, patterns, discussion) })}\n`)
    return
  }
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
  process.stderr.write('Usage: node planning_gates.js <discussion|ux-gate|workspaces|spec-review-choice|codex-spec-review|codex-plan-review> ...\n')
  process.exitCode = 1
}

module.exports = {
  shouldRunDiscussion,
  estimateGapCount,
  buildDiscussionArtifact,
  shouldRunUxDesignGate,
  needsWorkspaceDetection,
  detectAgentWorkspaces,
  validateUxArtifact,
  buildSpecReviewSummary,
  mapSpecReviewChoice,
  deriveRoleSignals,
  shouldRunCodexSpecReview,
  shouldRunCodexPlanReview,
}

if (require.main === module) main()
