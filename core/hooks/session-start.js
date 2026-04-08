#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { getWorkflowStatePath } = require('../utils/workflow/path_utils')

function shouldSkip() {
  return process.env.CLAUDE_NON_INTERACTIVE === '1'
}

function readFile(targetPath, fallback = '') {
  try {
    return fs.readFileSync(targetPath, 'utf8')
  } catch {
    return fallback
  }
}

function findProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function findWorkflowState(projectId) {
  const statePath = getWorkflowStatePath(projectId)
  if (!statePath || !fs.existsSync(statePath)) return null
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

function collectSpecIndices(projectRoot) {
  const specsDir = path.join(projectRoot, '.claude', 'specs')
  if (!fs.existsSync(specsDir) || !fs.statSync(specsDir).isDirectory()) return ''

  const indices = []
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.isFile() && entry.name === 'index.md') {
        const rel = path.relative(projectRoot, fullPath)
        const content = readFile(fullPath)
        if (content.trim()) indices.push(`### ${rel}\n${content.slice(0, 500)}`)
      }
    }
  }
  walk(specsDir)
  return indices.join('\n\n')
}

function determineNextAction(state) {
  if (!state) return '没有活跃的工作流。使用 `/workflow start` 开始新任务。'
  const status = state.status || 'idle'
  const currentTasks = state.current_tasks || []
  const progress = state.progress || {}
  const completed = progress.completed || []

  if (status === 'idle') return '使用 `/workflow start` 开始新的工作流。'
  if (status === 'planned') return '规划已完成。使用 `/workflow execute` 开始执行。'
  if (status === 'spec_review') return 'Spec 等待确认。请审查 Spec 文档后确认继续。'
  if (status === 'running') return `工作流执行中，当前任务: ${currentTasks[0] || '?'}。使用 /workflow execute 继续。`
  if (status === 'paused') return '工作流已暂停。使用 `/workflow execute` 恢复执行。'
  if (status === 'failed') return `任务 ${currentTasks[0] || '?'} 失败: ${state.failure_reason || '未知'}。使用 /workflow execute --retry 重试。`
  if (status === 'blocked') return '工作流被阻塞。使用 `/workflow unblock <dep>` 解除依赖。'
  if (status === 'completed') return `工作流已完成 (${completed.length} 任务)。使用 /workflow archive 归档。`
  if (status === 'archived') return '工作流已归档。使用 `/workflow start` 开始新任务。'
  return `当前状态: ${status}。使用 \/workflow status 查看详情。`
}

function main() {
  if (shouldSkip()) return
  const projectRoot = process.cwd()
  const config = findProjectConfig(projectRoot)
  if (!config) return

  const project = config.project || {}
  const projectId = project.id || config.projectId || ''
  const projectName = project.name || config.projectName || path.basename(projectRoot)
  const state = projectId ? findWorkflowState(projectId) : null
  const specs = collectSpecIndices(projectRoot)

  const parts = []
  parts.push('<workflow-context>')
  parts.push('<project-info>')
  parts.push(`项目: ${projectName}`)
  parts.push(`项目 ID: ${projectId}`)
  const frameworks = Array.isArray(config.frameworks) ? config.frameworks : []
  if (frameworks.length) {
    const tech = frameworks.slice(0, 5).map((item) => typeof item === 'string' ? item : item.name || '').filter(Boolean).join(', ')
    if (tech) parts.push(`技术栈: ${tech}`)
  }
  parts.push('</project-info>')

  if (state) {
    parts.push('<active-workflow>')
    parts.push(`状态: ${state.status || 'unknown'}`)
    const progress = state.progress || {}
    const completed = progress.completed || []
    const tasksFile = state.tasks_file || ''
    parts.push(`已完成: ${completed.length} 任务${tasksFile ? ` (任务文件: ${tasksFile})` : ''}`)
    const current = state.current_tasks || []
    if (current.length) parts.push(`当前任务: ${current.join(', ')}`)
    const usage = ((state.contextMetrics || {}).usagePercent) || 0
    if (usage > 0) parts.push(`上下文使用率: ${usage}%`)
    parts.push('</active-workflow>')
  }

  parts.push('<next-action>')
  parts.push(determineNextAction(state))
  parts.push('</next-action>')

  if (specs) {
    parts.push('<project-specs>')
    parts.push(specs)
    parts.push('</project-specs>')
  }

  const guidesDir = path.join(projectRoot, '.claude', '.agent-workflow', 'specs', 'guides')
  if (fs.existsSync(guidesDir) && fs.statSync(guidesDir).isDirectory()) {
    parts.push('<thinking-guides>')
    parts.push('项目包含思维指南，修改代码前请参考:')
    for (const name of fs.readdirSync(guidesDir).sort()) {
      if (name !== 'index.md' && name.endsWith('.md')) parts.push(`  - .claude/.agent-workflow/specs/guides/${name}`)
    }
    parts.push('</thinking-guides>')
  }

  parts.push('</workflow-context>')
  process.stdout.write(parts.join('\n'))
}

try {
  main()
} catch {
  process.exitCode = 0
}
