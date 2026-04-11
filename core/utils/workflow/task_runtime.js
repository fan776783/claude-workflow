#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { detectProjectIdFromRoot, getWorkflowsDir, getThinkingGuidesDir } = require('./path_utils')
const { findTaskById, extractTaskBlock } = require('./task_parser')

function readFile(targetPath, fallback = '') {
  try {
    return fs.readFileSync(targetPath, 'utf8')
  } catch {
    return fallback
  }
}

function readJson(targetPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'))
  } catch {
    return fallback
  }
}

function resolveRuntimeRelativePath(baseDir, relativePath) {
  if (!baseDir || !relativePath || path.isAbsolute(relativePath)) return null
  const normalized = path.normalize(relativePath)
  if (normalized.split(path.sep).includes('..')) return null
  return path.join(baseDir, normalized)
}

function getWorkflowRuntime(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot)
  const projectId = detectProjectIdFromRoot(root)
  if (!projectId) {
    return {
      projectRoot: root,
      projectId: null,
      workflowDir: null,
      statePath: null,
      state: null,
      tasksPath: null,
      tasksContent: '',
      currentTaskId: null,
      currentTask: null,
      currentTaskBlock: '',
    }
  }

  const workflowDir = getWorkflowsDir(projectId)
  const statePath = workflowDir ? path.join(workflowDir, 'workflow-state.json') : null
  const state = statePath && fs.existsSync(statePath) ? readJson(statePath) : null
  const tasksPath = state ? resolveRuntimeRelativePath(workflowDir, state.tasks_file || '') : null
  const tasksContent = tasksPath && fs.existsSync(tasksPath) ? readFile(tasksPath) : ''
  const currentTaskId = (state?.current_tasks || [])[0] || null
  const currentTask = currentTaskId && tasksContent ? findTaskById(tasksContent, currentTaskId) : null
  const currentTaskBlock = currentTaskId && tasksContent ? extractTaskBlock(tasksContent, currentTaskId) : ''

  return {
    projectRoot: root,
    projectId,
    workflowDir,
    statePath,
    state,
    tasksPath,
    tasksContent,
    currentTaskId,
    currentTask,
    currentTaskBlock,
  }
}

function getCurrentTask(runtime) {
  return runtime?.currentTask || null
}

function getCurrentTaskId(runtime) {
  return runtime?.currentTaskId || null
}

function getTaskBlock(runtime, taskId = null) {
  const resolvedTaskId = taskId || getCurrentTaskId(runtime)
  if (!runtime?.tasksContent || !resolvedTaskId) return ''
  return extractTaskBlock(runtime.tasksContent, resolvedTaskId)
}

function getTaskActions(task) {
  return [...(task?.actions || [])].filter(Boolean)
}

function getTaskVerification(task) {
  return task?.verification || null
}

function getTaskVerificationCommands(task) {
  return [...(getTaskVerification(task)?.commands || [])].filter(Boolean)
}

function getSpecContent(projectRoot, state, maxChars = 2000) {
  const specFile = state?.spec_file || ''
  if (!specFile) return ''
  const specPath = path.join(path.resolve(projectRoot || process.cwd()), specFile)
  const specContent = readFile(specPath)
  if (!specContent) return ''
  return specContent.length > maxChars ? specContent.slice(0, maxChars) : specContent
}

function getThinkingGuides(projectRoot = process.cwd()) {
  const dirInfo = getThinkingGuidesDir(projectRoot)
  if (!dirInfo) return null

  const files = fs.readdirSync(dirInfo.path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'index.md' && entry.name.endsWith('.md'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirInfo.path, entry.name),
      displayPath: `${dirInfo.displayPath}/${entry.name}`.replace(/\\/g, '/'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    ...dirInfo,
    files,
    legacyWarning: dirInfo.source === 'legacy'
      ? `检测到旧路径 ${path.relative(path.resolve(projectRoot), dirInfo.path).replace(/\\/g, '/')}，建议迁移到 ${dirInfo.displayPath}`
      : null,
  }
}

module.exports = {
  readFile,
  readJson,
  resolveRuntimeRelativePath,
  getWorkflowRuntime,
  getCurrentTask,
  getCurrentTaskId,
  getTaskBlock,
  getTaskActions,
  getTaskVerification,
  getTaskVerificationCommands,
  getSpecContent,
  getThinkingGuides,
}
