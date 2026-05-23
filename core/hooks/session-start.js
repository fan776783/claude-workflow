#!/usr/bin/env node
/** @file SessionStart Hook — 会话启动时注入项目配置、工作流状态和护栏提示 */

require('./_utf8')

const fs = require('fs')
const path = require('path')
const { normalizeWindowsShellPath, readProjectConfig } = require('../utils/workflow/path_utils')
const { getStatusMessages } = require('../utils/workflow/workflow_types')
const {
  getWorkflowRuntime,
  getThinkingGuides,
  getCodeSpecsContext,
  collectSpecFiles,
  renderSpecFiles,
  resolveActiveCodeSpecsScope,
} = require('../utils/workflow/task_runtime')
const { shouldSkipInjection } = require('./_skip')

/**
 * 安全读取文件内容
 * @param {string} targetPath - 文件路径
 * @param {string} [fallback=''] - 读取失败时的默认值
 * @returns {string} 文件内容或默认值
 */
function readFile(targetPath, fallback = '') {
  try {
    return fs.readFileSync(targetPath, 'utf8')
  } catch {
    return fallback
  }
}

/**
 * 递归收集 .claude/specs/ 下所有 index.md 的内容摘要
 * @param {string} projectRoot - 项目根目录
 * @returns {string} 拼接后的 spec 索引内容
 */
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


/**
 * SessionStart hook 主流程：读取项目配置和 workflow 状态，输出上下文与护栏信息
 */
function main() {
  if (shouldSkipInjection()) return
  const projectRoot = path.resolve(normalizeWindowsShellPath(process.cwd()))
  const config = readProjectConfig(projectRoot)
  if (!config) return

  const project = config.project || {}
  const projectId = project.id || config.projectId || ''
  const projectName = project.name || config.projectName || path.basename(projectRoot)
  const runtime = getWorkflowRuntime(projectRoot)
  const state = projectId && runtime.projectId === projectId ? runtime.state : null
  const stateParseError = runtime.stateParseError || null
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

  if (stateParseError) {
    parts.push('<workflow-warning>')
    parts.push(`workflow 状态文件解析失败: ${stateParseError}。请检查 workflow-state.json 是否损坏。`)
    parts.push('</workflow-warning>')
  }

  if (state) {
    parts.push('<active-workflow>')
    parts.push(`状态: ${state.status || 'unknown'}`)
    const progress = state.progress || {}
    const completed = progress.completed || []
    const tasksFile = state.plan_file || state.tasks_file || ''
    parts.push(`已完成: ${completed.length} 任务${tasksFile ? ` (任务文件: ${tasksFile})` : ''}`)
    const current = state.current_tasks || []
    if (current.length) parts.push(`当前任务: ${current.join(', ')}`)
    const usage = ((state.contextMetrics || {}).usagePercent) || 0
    if (usage > 0) parts.push(`上下文使用率: ${usage}%`)
    parts.push('</active-workflow>')
  }

  const { nextAction, guardrail } = getStatusMessages(state, { verbose: true })
  parts.push('<next-action>')
  parts.push(nextAction)
  parts.push('</next-action>')

  parts.push('<workflow-guardrail>')
  parts.push(guardrail)
  parts.push('</workflow-guardrail>')

  if (specs) {
    parts.push('<project-specs>')
    parts.push(specs)
    parts.push('</project-specs>')
  }

  const guides = getThinkingGuides(projectRoot)
  if (guides && guides.files.length) {
    parts.push('<thinking-guides>')
    parts.push('项目包含思维指南，修改代码前请参考:')
    for (const guide of guides.files) parts.push(`  - ${guide.displayPath}`)
    if (guides.legacyWarning) parts.push(`兼容提示: ${guides.legacyWarning}`)
    parts.push('</thinking-guides>')
  }

  // v3 Stage B1: paths-only 判定 + runtime.scope 优先级 + scopeDenied 渲染
  // 切 paths-only 的条件：
  //   1) monorepo + codeSpecs.runtime.scope 非 null 且解析出具体 activePackage（或 scopeDenied）
  //   2) 显式 env SPEC_INJECT_MODE=paths-only
  //   3) 估算 collector 产出的文件量 > 预算 70% 阈值
  const scope = resolveActiveCodeSpecsScope(runtime, config, {})
  const runtimeScopeConfigured = !!((config.codeSpecs || {}).runtime || {}).scope
  const projectType = (config.project || {}).type
  const envForcePathsOnly = process.env.SPEC_INJECT_MODE === 'paths-only'
  const sessionMaxChars = 2000
  let codeSpecsBlock = null
  let codeSpecsScopeAttr = 'overview'

  if (scope && scope.scopeDenied) {
    // scopeDenied → 输出空段 + 原因提示，不回退全树
    const denied = collectSpecFiles(projectRoot, scope, {})
    codeSpecsBlock = renderSpecFiles(denied, { mode: 'paths-only' })
    codeSpecsScopeAttr = 'scope-denied'
  } else {
    const collection = collectSpecFiles(projectRoot, scope || null, {})
    if (collection && collection.files.length) {
      // 估算字节：每文件 ~500 字内容 + 路径开销
      const estimated = collection.files.length * 520
      const pathsOnlyByBudget = estimated > sessionMaxChars * 0.7
      const pathsOnlyByRuntimeScope = projectType === 'monorepo'
        && runtimeScopeConfigured
        && scope && scope.activePackage
      const usePathsOnly = envForcePathsOnly || pathsOnlyByRuntimeScope || pathsOnlyByBudget
      if (usePathsOnly) {
        codeSpecsBlock = renderSpecFiles(collection, { mode: 'paths-only' })
        codeSpecsScopeAttr = scope && scope.activePackage ? `paths-only:${scope.activePackage}` : 'paths-only'
      } else {
        codeSpecsBlock = renderSpecFiles(collection, {
          mode: 'digest',
          maxChars: sessionMaxChars,
          rootIndexBudget: 200,
          layerIndexBudget: 120,
        })
      }
    } else if (collection && !collection.files.length && collection.dirInfo) {
      // code-specs 目录存在但空：简短提示
      codeSpecsBlock = '_code-specs 目录存在但无已填充内容（运行 `/spec-update` 开始沉淀）_'
      codeSpecsScopeAttr = 'empty'
    } else {
      // 无 code-specs 目录：兼容历史行为，保持静默
      codeSpecsBlock = getCodeSpecsContext(projectRoot, sessionMaxChars, { rootIndexBudget: 200, layerIndexBudget: 120 })
    }
  }

  if (codeSpecsBlock) {
    parts.push(`<project-code-specs role="advisory" scope="${codeSpecsScopeAttr}">`)
    parts.push(codeSpecsBlock)
    parts.push('</project-code-specs>')
  }

  parts.push('</workflow-context>')

  // first-reply-notice 默认 OFF：在 strict-output 交互场景（用户要求首轮 JSON / patch / commit message）
  // 注入"必须以中文 sentence 开头"会污染输出。用户想可视确认 SessionStart 已跑时，
  // 显式 export AGENT_WORKFLOW_FIRST_REPLY_NOTICE=1 启用。
  if (process.env.AGENT_WORKFLOW_FIRST_REPLY_NOTICE === '1') {
    parts.push('<first-reply-notice>')
    parts.push('On the first visible assistant reply in this session, begin with exactly one short Chinese sentence:')
    parts.push('SessionStart 已注入：workflow / 当前任务 / git / specs。')
    parts.push('Then continue. One-shot: do not repeat after the first reply in the same session.')
    parts.push('</first-reply-notice>')
  }

  process.stdout.write(parts.join('\n'))
}

try {
  main()
} catch {
  process.exitCode = 0
}
