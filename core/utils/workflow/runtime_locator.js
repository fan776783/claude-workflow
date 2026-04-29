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
  return summarizeText(requirementText, 48) || 'Workflow Task'
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
