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
 * approve → workflow_status 'planned'（与 cmdPlan/cmdSpecReview 实际推进一致——两个消费者在
 * approve 分支用 status==='approved' 判定并推 planned，本字段仅 non-approve 分支被读取；
 * 保持字段自洽，防未来消费者直读 workflow_status 落错状态）。
 * @param {string} choice - 用户选择的审查结论文本
 * @returns {Object} 包含 status、next_action、workflow_status 的映射结果
 */
function mapSpecReviewChoice(choice) {
  return {
    'Spec 正确，生成 Plan': { status: 'approved', next_action: 'continue_to_plan_generation', workflow_status: 'planned' },
    'Spec 正确，继续': { status: 'approved', next_action: 'continue_to_plan_generation', workflow_status: 'planned' },
    '需要修改 Spec': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation', workflow_status: 'spec_review' },
    '页面分层需要调整': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation', workflow_status: 'spec_review' },
    '缺少用户流程': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation', workflow_status: 'spec_review' },
    '缺少需求细节': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation_preserve_requirement_details', workflow_status: 'spec_review' },
    '需要拆分范围': { status: 'rejected', next_action: 'split_scope', workflow_status: 'idle' },
  }[choice] || { status: 'pending', next_action: null, workflow_status: 'spec_review' }
}

/**
 * FR-6：机器 review（codex spec/plan + execute 两段 review）默认不自动触发，
 * 仅在 project-config.json 显式开启或命令 flag 显式开启时才走原 signal 判定。
 * 沿用现有 `config.workflow.<flag>` 读取范式（参见 triage_rules workflow.triageDenylist /
 * readiness workflow.readiness）。
 *
 * config 形态（任一为真即开启 codex 自动 review）：
 *   { workflow: { review: { codex: true } } }   // 细粒度
 *   { workflow: { review: true } }                // 整体开关
 *
 * @param {Object|null} config - project-config.json 内容
 * @returns {boolean}
 */
function isMachineReviewEnabled(config) {
  const review = config && config.workflow && config.workflow.review
  if (review === true) return true
  if (review && typeof review === 'object') return review.codex === true || review.enabled === true
  return false
}

/**
 * 判断是否需要执行 Codex Spec 审查（advisory-to-human）
 *
 * FR-6 降级：默认 return false（review 自动触发已改为显式开关）；
 * 仅当 `options.reviewEnabled === true`（config/flag 显式开启）时才走原 signal 判定。
 * 注意：降级的是「自动触发」，不是删除 review 能力——显式开启后两段判定完整恢复。
 *
 * @param {string} specContent - Spec 文档内容
 * @param {Object} [signals={}] - deriveRoleSignals 输出的结构化信号
 * @param {Object} [options={}] - { reviewEnabled?: boolean } 显式开关
 * @returns {{ run: boolean, reason: string|null }} 是否触发及触发原因
 */
function shouldRunCodexSpecReview(specContent, signals = {}, options = {}) {
  if (options.reviewEnabled !== true) return { run: false, reason: 'review-gating-disabled' }
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

const UI_KEYWORDS_REGEX = /页面|界面|表单|列表|面板|弹窗|导航|路由|仪表盘|编辑器|sidebar|tab|modal|dashboard|GUI|桌面|desktop|窗口|window/i
const UI_BROAD_KEYWORDS_REGEX = /UI|界面|页面|组件|布局|样式|交互|显示|渲染|视图|前端/i
const FRONTEND_FRAMEWORK_REGEX = /react|vue|angular|svelte|tauri|electron|next\.?js|nuxt|vite/i
const UX_CLARIFICATION_DIMENSIONS = new Set(['behavior', 'ui', 'ux', 'interaction', 'user-facing'])

/**
 * 判断是否需要进入 discussion（需求澄清）阶段
 * @param {string} requirementText - 需求文本
 * @param {string} requirementSource - 需求来源（'inline' / 文件路径）
 * @param {boolean} noDiscuss - 用户是否显式跳过 discussion
 * @param {number} gapCount - 检测到的需求缺口计数
 * @returns {boolean}
 */
function shouldRunDiscussion(requirementText, requirementSource, noDiscuss, gapCount) {
  if (noDiscuss) return false
  const trimmed = String(requirementText || '').trim()
  const shortInline = requirementSource === 'inline' && trimmed.length <= 100 && (gapCount || 0) === 0
  return !shortInline
}

/**
 * 判断是否需要触发 UX design gate
 * @param {string} requirementText - 需求文本
 * @param {Array<Object>} analysisPatterns - 项目分析模式（含 frontend framework 的 { name } 列表）
 * @param {Object|null} discussionArtifact - 讨论阶段产物，含 clarifications[]
 * @returns {boolean}
 */
function shouldRunUxDesignGate(requirementText, analysisPatterns = [], discussionArtifact = null) {
  const text = String(requirementText || '')
  if (UI_KEYWORDS_REGEX.test(text)) return true
  const hasFrontend = (analysisPatterns || []).some((p) => FRONTEND_FRAMEWORK_REGEX.test(String((p || {}).name || '')))
  if (hasFrontend && UI_BROAD_KEYWORDS_REGEX.test(text)) return true
  if (hasFrontend && discussionArtifact) {
    const clarifications = Array.isArray(discussionArtifact.clarifications) ? discussionArtifact.clarifications : []
    if (clarifications.some((c) => c && UX_CLARIFICATION_DIMENSIONS.has(String(c.dimension || '').toLowerCase()))) return true
  }
  return false
}

/**
 * 判断是否需要执行 Codex Plan 审查（bounded-autofix）
 *
 * FR-6 降级：默认 return false；仅当 `options.reviewEnabled === true` 时走原 signal 判定。
 *
 * @param {string} planContent
 * @param {string} specContent
 * @param {Object} [signals={}]
 * @param {Object} [options={}] - { reviewEnabled?: boolean } 显式开关
 */
function shouldRunCodexPlanReview(planContent, specContent, signals = {}, options = {}) {
  if (options.reviewEnabled !== true) return { run: false, reason: 'review-gating-disabled' }
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
    const reviewEnabled = args.includes('--review-enabled')
    process.stdout.write(`${JSON.stringify(shouldRunCodexSpecReview(content, signals, { reviewEnabled }))}\n`)
    return
  }
  if (command === 'codex-plan-review') {
    const planContent = args.shift() || ''
    const specContent = args.shift() || ''
    const signalsIndex = args.indexOf('--signals-json')
    const signals = signalsIndex >= 0 ? JSON.parse(args[signalsIndex + 1]) : {}
    const reviewEnabled = args.includes('--review-enabled')
    process.stdout.write(`${JSON.stringify(shouldRunCodexPlanReview(planContent, specContent, signals, { reviewEnabled }))}\n`)
    return
  }
  process.stderr.write('Usage: node planning_gates.js <workspaces|spec-review-choice|codex-spec-review|codex-plan-review> ...\n')
  process.exitCode = 1
}

module.exports = {
  deriveRoleSignals,
  detectAgentWorkspaces,
  mapSpecReviewChoice,
  isMachineReviewEnabled,
  shouldRunCodexSpecReview,
  shouldRunCodexPlanReview,
  shouldRunDiscussion,
  shouldRunUxDesignGate,
  UI_KEYWORDS_REGEX,
  UI_BROAD_KEYWORDS_REGEX,
  FRONTEND_FRAMEWORK_REGEX,
}

if (require.main === module) main()
