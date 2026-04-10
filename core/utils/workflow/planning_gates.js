#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const { classifyRoleSignals } = require('./role_injection')

const UI_KEYWORDS_REGEX = /页面|界面|表单|列表|面板|弹窗|导航|路由|仪表盘|编辑器|sidebar|tab|modal|dashboard|GUI|桌面|desktop|窗口|window/i
const UI_BROAD_KEYWORDS_REGEX = /UI|界面|页面|组件|布局|样式|交互|显示|渲染|视图|前端/i
const WORKSPACE_KEYWORDS_REGEX = /同步|sync|agent|workspace|工作区|目录/i

function shouldRunDiscussion(requirementContent, requirementSource, noDiscuss = false, gapCount = 0) {
  if (noDiscuss) return false
  if (requirementSource === 'inline' && String(requirementContent || '').trim().length <= 100 && gapCount === 0) return false
  return true
}

function estimateGapCount(requirementContent, requirementSource) {
  const content = String(requirementContent || '').trim()
  if (requirementSource === 'inline' && content.length <= 100) return 0
  return content ? 1 : 0
}

function buildDiscussionArtifact(requirementSource, clarifications = [], selectedApproach = null, unresolvedDependencies = []) {
  return {
    requirementSource,
    clarifications,
    selectedApproach: selectedApproach || null,
    unresolvedDependencies,
  }
}

function shouldRunUxDesignGate(requirementContent, analysisPatterns = [], discussionArtifact = null) {
  const content = String(requirementContent || '')
  if (UI_KEYWORDS_REGEX.test(content)) return true
  const hasFrontend = (analysisPatterns || []).some((pattern) => /react|vue|angular|svelte|tauri|electron|next\.?js|nuxt|vite/i.test(String((pattern || {}).name || '')))
  if (hasFrontend && UI_BROAD_KEYWORDS_REGEX.test(content)) return true
  const clarifications = ((discussionArtifact || {}).clarifications) || []
  return clarifications.some((clarification) => ['behavior', 'edge-case'].includes(clarification.dimension))
}

function needsWorkspaceDetection(requirementContent) {
  return WORKSPACE_KEYWORDS_REGEX.test(String(requirementContent || ''))
}

function deriveRoleSignals(requirementContent, analysisPatterns = [], discussionArtifact = null, extra = {}) {
  return classifyRoleSignals(requirementContent, analysisPatterns, discussionArtifact, extra)
}

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

function buildSpecReviewSummary(specContent) {
  const allSections = String(specContent || '').split(/^(?=## \d)/m)
  const targetPrefixes = ['## 2.', '## 3.', '## 7.']
  return allSections.filter((s) => targetPrefixes.some((p) => s.trimStart().startsWith(p))).map((s) => s.trim()).join('\n\n')
}


function mapSpecReviewChoice(choice) {
  return {
    'Spec 正确，生成 Plan': { status: 'approved', next_action: 'continue_to_plan_generation', workflow_status: 'planning' },
    'Spec 正确，继续': { status: 'approved', next_action: 'continue_to_plan_generation', workflow_status: 'planning' },
    '需要修改 Spec': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation', workflow_status: 'spec_review' },
    '页面分层需要调整': { status: 'revise_required', next_action: 'return_to_phase_0_3_ux_design_gate', workflow_status: 'spec_review' },
    '缺少用户流程': { status: 'revise_required', next_action: 'return_to_phase_0_3_ux_design_gate', workflow_status: 'spec_review' },
    '缺少需求细节': { status: 'revise_required', next_action: 'return_to_phase_1_spec_generation_preserve_requirement_details', workflow_status: 'spec_review' },
    '需要拆分范围': { status: 'rejected', next_action: 'split_scope', workflow_status: 'idle' },
  }[choice] || { status: 'pending', next_action: null, workflow_status: 'spec_review' }
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
  process.stderr.write('Usage: node planning_gates.js <discussion|ux-gate|workspaces|spec-review-choice> ...\n')
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
}

if (require.main === module) main()
