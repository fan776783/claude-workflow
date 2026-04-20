#!/usr/bin/env node
/** @file PreToolUse(Task) Hook — 在 Task 工具调用前注入 workflow 上下文并执行治理检查 */

const fs = require('fs')
const path = require('path')
const {
  getWorkflowRuntime,
  getCurrentTaskId,
  getTaskBlock,
  getCurrentTask,
  getTaskVerificationCommands,
  getSpecContent,
  getThinkingGuides,
  getCodeSpecsContextScoped,
  resolveActiveCodeSpecsScope,
  collectSpecFiles,
  renderSpecFiles,
} = require('../utils/workflow/task_runtime')
const { deriveEffectiveStatus, getReviewResult, getSpecReviewGateViolation } = require('../utils/workflow/workflow_types')

/**
 * 从 Markdown 内容中提取指定标题下的段落
 * @param {string} content - Markdown 文本
 * @param {string} heading - 要提取的标题文本
 * @param {number} [maxChars=2000] - 最大返回字符数
 * @returns {string} 提取的段落内容
 */
function extractSection(content, heading, maxChars = 2000) {
  const pattern = new RegExp(`^(#{1,4})\\s+${heading.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n\\1\\s|$)`, 'm')
  const match = String(content || '').match(pattern)
  if (!match) return ''
  const section = match[2].trim()
  return section.length > maxChars ? section.slice(0, maxChars) : section
}

/**
 * 获取当前 workflow 运行时信息
 * @returns {object} workflow 运行时对象
 */
function findWorkflowState() {
  return getWorkflowRuntime(process.cwd())
}

/**
 * 判定 Task 派发来源。Claude Code 原生 Task tool 在派发 subagent 时会在
 * `tool_input.subagent_type` 填入 agent 类型（Explore / general-purpose / 自定义）；
 * 主会话内部调用 Task（罕见）时该字段缺失。
 *
 * 派发端也可以在 `tool_input.metadata.execution_origin` 里写 'main-session' 强制覆盖，
 * 让自我调用豁免 subagent 分流。
 *
 * 返回：
 *   { origin: 'subagent' | 'main-session', role: string | null }
 * role：subagent_type 原值，或 metadata.subagent_role 的显式值。
 */
function classifyTaskOrigin(toolInput) {
  const meta = (toolInput && typeof toolInput.metadata === 'object' && toolInput.metadata) ? toolInput.metadata : {}
  const explicitOrigin = typeof meta.execution_origin === 'string' ? meta.execution_origin.trim().toLowerCase() : ''
  if (explicitOrigin === 'main-session') return { origin: 'main-session', role: null }
  if (explicitOrigin === 'subagent') {
    const role = typeof meta.subagent_role === 'string' && meta.subagent_role.trim()
      ? meta.subagent_role.trim()
      : (typeof toolInput?.subagent_type === 'string' && toolInput.subagent_type.trim() ? toolInput.subagent_type.trim() : null)
    return { origin: 'subagent', role }
  }
  const subagentType = typeof toolInput?.subagent_type === 'string' ? toolInput.subagent_type.trim() : ''
  if (subagentType) return { origin: 'subagent', role: subagentType }
  return { origin: 'main-session', role: null }
}

/**
 * 主会话 Task 的 context：task block / spec / quality gate / scoped code-specs（digest）
 */
function buildMainSessionContext(runtime) {
  const parts = []
  const state = runtime?.state
  const projectRoot = runtime?.projectRoot || process.cwd()
  const taskId = getCurrentTaskId(runtime)
  if (!taskId) return ''

  const task = getCurrentTask(runtime)
  const taskBlock = getTaskBlock(runtime, taskId)
  if (taskBlock) {
    parts.push(`<current-task>\n${taskBlock.slice(0, 3000)}\n</current-task>`)
    const verificationCommands = getTaskVerificationCommands(task)
    if (verificationCommands.length) {
      parts.push(`<verification-commands>\n${verificationCommands.map((item) => `- ${item}`).join('\n')}\n</verification-commands>`)
    }
  }

  const specContent = getSpecContent(projectRoot, state)
  if (specContent) parts.push(`<spec-context>\n${specContent}\n</spec-context>`)

  const qualityGate = getReviewResult(state, taskId)
  if (qualityGate) {
    parts.push(`<quality-gate-state>\nlast_decision: ${qualityGate.last_decision || 'unknown'}\noverall_passed: ${qualityGate.overall_passed === true}\n</quality-gate-state>`)
  }

  const scope = resolveActiveCodeSpecsScope(runtime)
  // v3 Stage B2: scopeDenied 时主会话降级为 paths-only 提示
  if (scope && scope.scopeDenied) {
    const denied = collectSpecFiles(projectRoot, scope, {})
    const body = renderSpecFiles(denied, { mode: 'paths-only' })
    if (body) parts.push(`<project-code-specs role="advisory" scope="scope-denied">\n${body}\n</project-code-specs>`)
  } else {
    const codeSpecs = getCodeSpecsContextScoped(projectRoot, scope)
    if (codeSpecs) {
      const labels = []
      labels.push(scope && scope.activePackage ? `scope="${scope.activePackage}"` : 'scope="full-tree"')
      if (scope && scope.taskLayer) labels.push(`layer="${scope.taskLayer}"`)
      if (scope && Array.isArray(scope.changedFileHints) && scope.changedFileHints.length) {
        labels.push(`hints="${scope.changedFileHints.length}"`)
      }
      parts.push(`<project-code-specs role="advisory" ${labels.join(' ')}>\n${codeSpecs}\n</project-code-specs>`)
    }
  }

  const guides = getThinkingGuides(projectRoot)
  if (guides && guides.files.length) {
    parts.push(`<reminder>修改代码前请参考 ${guides.displayPath}/ 中的思维指南。</reminder>`)
    if (guides.legacyWarning) parts.push(`<guides-warning>\n${guides.legacyWarning}\n</guides-warning>`)
  }

  return parts.join('\n\n')
}

/**
 * subagent Task 的 context：按 subagent_role 定制
 *   implement / general-purpose → full task + spec + dev specs（digest, scope 收窄）
 *   check / code-reviewer / diff-review → task + spec + 所有 layer 的 checklist/spec（更全）
 *   research / Explore / Plan → 只给 task 描述 + spec 指针 + code-specs 路径清单
 */
function buildSubagentContext(runtime, role) {
  const parts = []
  const state = runtime?.state
  const projectRoot = runtime?.projectRoot || process.cwd()
  const taskId = getCurrentTaskId(runtime)
  if (!taskId) return ''

  const normalizedRole = (role || '').toLowerCase()
  const isResearch = /\b(research|explore|plan)\b/.test(normalizedRole)
  const isCheck = /\b(check|review|reviewer)\b/.test(normalizedRole)

  const task = getCurrentTask(runtime)
  const taskBlock = getTaskBlock(runtime, taskId)
  if (taskBlock) {
    parts.push(`<current-task subagent_role="${role || 'unknown'}">\n${taskBlock.slice(0, 3000)}\n</current-task>`)
    if (!isResearch) {
      const verificationCommands = getTaskVerificationCommands(task)
      if (verificationCommands.length) {
        parts.push(`<verification-commands>\n${verificationCommands.map((item) => `- ${item}`).join('\n')}\n</verification-commands>`)
      }
    }
  }

  const specContent = getSpecContent(projectRoot, state)
  if (specContent && !isResearch) parts.push(`<spec-context>\n${specContent}\n</spec-context>`)

  if (!isResearch) {
    const qualityGate = getReviewResult(state, taskId)
    if (qualityGate) {
      parts.push(`<quality-gate-state>\nlast_decision: ${qualityGate.last_decision || 'unknown'}\noverall_passed: ${qualityGate.overall_passed === true}\n</quality-gate-state>`)
    }
  }

  const scope = resolveActiveCodeSpecsScope(runtime)
  if (scope && scope.scopeDenied) {
    const denied = collectSpecFiles(projectRoot, scope, {})
    const body = renderSpecFiles(denied, { mode: 'paths-only' })
    if (body) parts.push(`<project-code-specs role="advisory" scope="scope-denied">\n${body}\n</project-code-specs>`)
  } else if (isResearch) {
    // research / explore / plan：只给路径清单，不读正文
    const collection = collectSpecFiles(projectRoot, scope || null, {})
    const body = renderSpecFiles(collection, { mode: 'paths-only' })
    if (body) parts.push(`<project-code-specs role="advisory" scope="paths-only:subagent=${role || 'research'}">\n${body}\n</project-code-specs>`)
  } else if (isCheck) {
    // check / review：全量 layer index + checklist，不做 layer hint 收窄
    const checkScope = scope ? { ...scope, taskLayer: null } : null
    const collection = collectSpecFiles(projectRoot, checkScope, {})
    const body = renderSpecFiles(collection, { mode: 'digest', maxChars: 3000 })
    if (body) parts.push(`<project-code-specs role="advisory" scope="${scope?.activePackage || 'full-tree'}:subagent=${role}">\n${body}\n</project-code-specs>`)
  } else {
    // implement / general-purpose：沿用 scoped digest
    const codeSpecs = getCodeSpecsContextScoped(projectRoot, scope)
    if (codeSpecs) {
      const labels = []
      labels.push(scope && scope.activePackage ? `scope="${scope.activePackage}"` : 'scope="full-tree"')
      if (scope && scope.taskLayer) labels.push(`layer="${scope.taskLayer}"`)
      if (role) labels.push(`subagent="${role}"`)
      parts.push(`<project-code-specs role="advisory" ${labels.join(' ')}>\n${codeSpecs}\n</project-code-specs>`)
    }
  }

  return parts.join('\n\n')
}

/**
 * 构建当前任务的上下文片段 — dispatcher：按 Task 派发来源（主会话 vs subagent）选不同 builder。
 * 对外行为保持幂等：同一次 Task 调用只会走其中一个分支，不会双注入。
 * @param {object} runtime - workflow 运行时对象
 * @param {object} toolInput - Task tool 原始输入
 * @returns {string} 拼接后的上下文 XML 片段
 */
function buildTaskContext(runtime, toolInput = {}) {
  const { origin, role } = classifyTaskOrigin(toolInput)
  if (origin === 'subagent') return buildSubagentContext(runtime, role)
  return buildMainSessionContext(runtime)
}

/**
 * 构建放行结果对象
 * @param {string|null} [message=null] - 附加消息
 * @param {object|null} [patchedToolInput=null] - 修改后的工具输入（用于注入上下文）
 * @returns {{ continue: true, message?: string, tool_input?: object }} 放行结果
 */
function buildAllowResult(message = null, patchedToolInput = null) {
  const result = { continue: true }
  if (message) result.message = message
  if (patchedToolInput) {
    result.tool_input = patchedToolInput
    result.patched_tool_input = patchedToolInput
    result.hookSpecificOutput = { tool_input: patchedToolInput }
  }
  return result
}

/**
 * 构建阻止结果对象
 * @param {string} reason - 阻止原因
 * @returns {{ continue: false, reason: string }} 阻止结果
 */
function buildBlockResult(reason) {
  return { continue: false, reason }
}

/**
 * PreToolUse(Task) hook 主流程：读取 hook 输入 → 治理检查 → 注入任务上下文 → 输出结果
 */
function main() {
  let hookInput = {}
  try {
    const raw = fs.readFileSync(0, 'utf8')
    hookInput = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] Hook 输入解析失败，治理阻断。')))
    return
  }

  if (hookInput.tool_name !== 'Task') {
    process.stdout.write(JSON.stringify(buildAllowResult()))
    return
  }

  const toolInput = typeof hookInput.tool_input === 'object' && hookInput.tool_input ? hookInput.tool_input : {}
  const runtime = findWorkflowState()
  const state = runtime?.state
  if (!state) {
    if (runtime?.stateParseError) {
      process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] workflow 状态文件解析失败 (${runtime.stateParseError})，治理阻断。请检查 ${runtime.statePath || 'workflow-state.json'} 是否损坏。`)))
      return
    }
    process.stdout.write(JSON.stringify(buildAllowResult('[workflow-hook] 未发现活动 workflow，跳过上下文注入。')))
    return
  }

  const gateViolation = getSpecReviewGateViolation(state)
  if (gateViolation) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] Phase 1.1 User Spec Review 尚未 approved，禁止派发执行型 Task。请先回到 spec_review 完成人工确认。')))
    return
  }

  const effective = deriveEffectiveStatus(state)
  const canDispatch = effective.status === 'running' || (effective.status === 'halted' && effective.halt_reason === 'governance')
  if (!canDispatch) {
    process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] 当前 workflow 状态为 ${state.status}${effective.halt_reason ? `/${effective.halt_reason}` : ''}，不允许直接派发执行型 Task。请先走对应的 workflow 命令路径。`)))
    return
  }

  const currentTaskId = (state.current_tasks || [])[0]
  if (!currentTaskId) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] 当前没有 active task，禁止派发执行型 Task。请先通过 `/workflow-execute` 解析下一步任务。')))
    return
  }

  if (!state.spec_file || !state.plan_file) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] 缺少 spec_file 或 plan_file，执行上下文不完整。请先修复 workflow 状态后再继续。')))
    return
  }

  const taskDescription = toolInput.description || ''
  const context = buildTaskContext(runtime, toolInput)

  if (!context) {
    process.stdout.write(JSON.stringify(buildAllowResult('[workflow-hook] 未注入额外上下文：当前任务缺少可提取上下文。')))
    return
  }

  const { origin, role } = classifyTaskOrigin(toolInput)
  const originLabel = origin === 'subagent' ? `subagent:${role || 'unknown'}` : 'main-session'
  const patchedToolInput = { ...toolInput, description: `${context}\n\n---\n\n${taskDescription}` }
  const result = buildAllowResult(`[workflow-hook] 已注入任务上下文 (${context.length} 字符, ${originLabel})`, patchedToolInput)
  process.stdout.write(JSON.stringify(result))
}

try {
  main()
} catch (error) {
  process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] Hook 内部异常，治理阻断: ${error instanceof Error ? error.message : String(error)}`)))
  process.exitCode = 0
}
