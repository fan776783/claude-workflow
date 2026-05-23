#!/usr/bin/env node
/** @file Cursor beforeShellExecution Hook — 每次 shell 命令前注入一行 shell context：active task slug + git branch。lite runtime 避免 plan 文件解析；spawnSync git 是单次最大成本（~10-30ms），未做缓存以保持 branch 切换实时性 */

require('./_utf8')

const path = require('path')
const { spawnSync } = require('child_process')
const { normalizeWindowsShellPath } = require('../utils/workflow/path_utils')
const { getWorkflowRuntimeLite } = require('../utils/workflow/task_runtime')
const { shouldSkipInjection } = require('./_skip')

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
  const runtime = getWorkflowRuntimeLite(projectRoot)
  const taskSlug = runtime.state ? (runtime.state.current_tasks || [])[0] || null : null
  const branch = getGitBranch(projectRoot)
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
