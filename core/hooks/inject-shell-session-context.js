#!/usr/bin/env node
/** @file Cursor beforeShellExecution Hook — 每次 shell 命令前注入一行 shell context：active task slug + git branch，让命令有 workflow 感知。输出极简，避免污染 shell 输出可读性 */

require('./_utf8')

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { normalizeWindowsShellPath } = require('../utils/workflow/path_utils')
const { getWorkflowRuntime } = require('../utils/workflow/task_runtime')
const { shouldSkipInjection } = require('./_skip')

function findProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function getGitBranch(root) {
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8', cwd: root, timeout: 2000,
    })
    if (result.status === 0) return (result.stdout || '').trim() || null
  } catch {}
  return null
}

function main() {
  if (shouldSkipInjection()) return
  const projectRoot = path.resolve(normalizeWindowsShellPath(process.cwd()))
  const config = findProjectConfig(projectRoot)

  const branch = getGitBranch(projectRoot)
  let taskSlug = null
  if (config) {
    const projectId = (config.project || {}).id || config.projectId || ''
    const runtime = getWorkflowRuntime(projectRoot)
    const state = projectId && runtime.projectId === projectId ? runtime.state : null
    if (state) taskSlug = (state.current_tasks || [])[0] || null
  }

  if (!branch && !taskSlug) return

  const bits = []
  if (taskSlug) bits.push(`task=${taskSlug}`)
  if (branch) bits.push(`branch=${branch}`)
  process.stdout.write(`<shell-context>${bits.join(' ')}</shell-context>`)
}

try {
  main()
} catch {
  process.exitCode = 0
}
