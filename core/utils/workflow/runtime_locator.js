#!/usr/bin/env node
/** @file 运行时 locator - 跨 plan / delta / archive / unblock 共用的 workflow runtime 定位与需求输入归一化 */

const fs = require('fs')
const path = require('path')

const { getWorkflowStatePath, getWorkflowsDir, validateProjectId } = require('./path_utils')
const { detectProjectRoot } = require('./task_manager')
const { readState } = require('./state_manager')
const { loadProjectConfig, extractProjectId, summarizeText } = require('./project_setup')

function resolveRequirementInput(requirement, projectRoot) {
  const candidate = requirement.endsWith('.md') ? path.resolve(projectRoot, requirement) : path.resolve(projectRoot, requirement)
  if (String(requirement || '').toLowerCase().endsWith('.md') && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    let display = candidate
    const relative = path.relative(projectRoot, candidate)
    if (relative && !relative.startsWith('..')) display = relative
    return [display, fs.readFileSync(candidate, 'utf8'), candidate]
  }
  return ['inline', requirement, null]
}

function deriveTaskName(requirementText, sourcePath) {
  if (sourcePath) return path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]/g, ' ').trim() || 'Workflow Task'
  // 1) 去掉常见分类前缀: 需求：/ 标题：/ task: 之类（这类是 category，左侧无意义）
  let text = String(requirementText || '').trim()
  const prefixStripped = text.replace(/^(需求|标题|主题|task|title|requirement|story)\s*[：:]\s*/i, '')
  const hadPrefix = prefixStripped !== text
  text = prefixStripped
  // 2) 按句子分隔符切首段
  const segments = text.split(/[。.；;\n]/).map((s) => s.trim()).filter(Boolean)
  let head = segments[0] || ''
  // 3) 含冒号时的 title/value 启发式：
  //    - 前缀已 strip → 直接用 head（已经是 value）
  //    - 否则若左侧 4-20 字 且 比右侧短 ≥4 字 → 视为 `title:detail`，取左侧（标题）
  //    - 否则取右侧（视为 `category:value`）
  if (!hadPrefix) {
    const colonParts = head.split(/[：:]/).map((s) => s.trim()).filter(Boolean)
    if (colonParts.length >= 2) {
      const left = colonParts[0]
      const right = colonParts.slice(1).join(': ')
      // 已去掉 需求/标题/task 等 category 前缀，残留的冒号绝大多数是 title:detail。
      // 左侧 4-20 字视为标题；过短(<4)说明是 category，回落右侧。
      head = (left.length >= 4 && left.length <= 20) ? left : (right || left)
    }
  }
  const hasCJK = /[一-鿿]/.test(head)
  const limit = hasCJK ? 24 : 48
  if (head && head.length <= limit) return head
  return summarizeText(head || text, limit) || 'Workflow Task'
}

function buildTechStackSummary(config) {
  const tech = (config || {}).tech || {}
  const parts = [String(tech.packageManager || 'unknown'), String(tech.buildTool || 'unknown')]
  if ((tech.frameworks || []).length) parts.push(tech.frameworks.map((item) => String(item)).join('/'))
  return parts.join(' | ')
}

function resolveWorkflowRuntime(projectId = null, projectRoot = null) {
  const root = detectProjectRoot(projectRoot)
  const config = loadProjectConfig(root)
  const resolvedProjectId = projectId || extractProjectId(config)
  if (!resolvedProjectId || !validateProjectId(resolvedProjectId)) return [null, root, null, null, null]

  const workflowDir = getWorkflowsDir(resolvedProjectId)
  const statePath = getWorkflowStatePath(resolvedProjectId)
  if (!workflowDir || !statePath) return [resolvedProjectId, root, null, null, null]

  const state = fs.existsSync(statePath) ? readState(statePath, resolvedProjectId) : null
  return [resolvedProjectId, root, workflowDir, statePath, state]
}

module.exports = {
  resolveRequirementInput,
  deriveTaskName,
  buildTechStackSummary,
  resolveWorkflowRuntime,
}
