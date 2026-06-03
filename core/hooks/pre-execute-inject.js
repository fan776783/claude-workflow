#!/usr/bin/env node
/** @file PreToolUse(Task) Hook — 在 Task 工具调用前注入 workflow 上下文并执行治理检查 */

require('./_utf8')

const fs = require('fs')
const path = require('path')
const {
  getWorkflowRuntime,
  getCurrentTaskId,
  getTaskBlock,
  getCurrentTask,
  getTaskVerificationCommands,
  getSpecContent,
  getContractDigest,
  expandContextPack,
  getThinkingGuides,
  getCodeSpecsContextScoped,
  resolveActiveCodeSpecsScope,
  collectSpecFiles,
  renderSpecFiles,
} = require('../utils/workflow/task_runtime')
const { assertExecutableTaskSourcePresent, deriveEffectiveStatus, getSpecReviewGateViolation } = require('../utils/workflow/workflow_types')
const { shouldSkipInjection } = require('./_skip')
const { normalizeWindowsShellPath } = require('../utils/workflow/path_utils')

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
  return getWorkflowRuntime(path.resolve(normalizeWindowsShellPath(process.cwd())))
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

// Sub-agent role 三角分类：research / check / implement / null（主会话）。
// 维护一张 map 而不是写死正则，方便新增类型；正则只在 normalize 一次。
const SUBAGENT_ROLE_PATTERNS = [
  { kind: 'research', pattern: /\b(research|explore|plan)\b/ },
  { kind: 'check', pattern: /\b(check|review|reviewer)\b/ },
]
function classifySubagentRole(role) {
  if (!role) return null
  const normalized = String(role).toLowerCase()
  for (const { kind, pattern } of SUBAGENT_ROLE_PATTERNS) {
    if (pattern.test(normalized)) return kind
  }
  return 'implement'
}

function renderCodeSpecsBlock({ projectRoot, scope, kind, role }) {
  // scopeDenied 一律降级 paths-only，与 kind 无关
  if (scope && scope.scopeDenied) {
    const denied = collectSpecFiles(projectRoot, scope, {})
    const body = renderSpecFiles(denied, { mode: 'paths-only' })
    return body ? `<project-code-specs role="advisory" scope="scope-denied">\n${body}\n</project-code-specs>` : null
  }
  if (kind === 'research') {
    const collection = collectSpecFiles(projectRoot, scope || null, {})
    const body = renderSpecFiles(collection, { mode: 'paths-only' })
    return body ? `<project-code-specs role="advisory" scope="paths-only:subagent=${role || 'research'}">\n${body}\n</project-code-specs>` : null
  }
  if (kind === 'check') {
    const checkScope = scope ? { ...scope, taskLayer: null } : null
    const collection = collectSpecFiles(projectRoot, checkScope, {})
    const body = renderSpecFiles(collection, { mode: 'digest', maxChars: 3000 })
    return body ? `<project-code-specs role="advisory" scope="${scope?.activePackage || 'full-tree'}:subagent=${role}">\n${body}\n</project-code-specs>` : null
  }
  // main session 或 implement subagent：scoped digest
  const codeSpecs = getCodeSpecsContextScoped(projectRoot, scope)
  if (!codeSpecs) return null
  const labels = []
  labels.push(scope && scope.activePackage ? `scope="${scope.activePackage}"` : 'scope="full-tree"')
  if (scope && scope.taskLayer) labels.push(`layer="${scope.taskLayer}"`)
  if (scope && Array.isArray(scope.changedFileHints) && scope.changedFileHints.length) {
    labels.push(`hints="${scope.changedFileHints.length}"`)
  }
  if (kind === 'implement' && role) labels.push(`subagent="${role}"`)
  return `<project-code-specs role="advisory" ${labels.join(' ')}>\n${codeSpecs}\n</project-code-specs>`
}

/**
 * 构建 task context，按 kind/role 选择性输出 segments。
 * kind ∈ { null=main session, 'research', 'check', 'implement' }
 *   - research: 仅 task block + code-specs paths-only（不带 verification / spec / quality-gate / exemption）
 *   - check:    + verification + spec + quality-gate + exemption + 全 layer digest
 *   - implement:+ verification + spec + quality-gate + exemption + scoped digest
 *   - main:     + verification + spec + quality-gate + scoped digest + guides reminder（无 exemption）
 */
function buildTaskContext(runtime, kind, role) {
  const taskId = getCurrentTaskId(runtime)
  if (!taskId) return ''
  const state = runtime?.state
  const projectRoot = runtime?.projectRoot || process.cwd()
  const task = getCurrentTask(runtime)
  const parts = []

  const taskBlock = getTaskBlock(runtime, taskId)
  if (taskBlock) {
    // kind 非 null 代表 subagent dispatch；role 缺失保留 'unknown' 标记，与旧行为一致
    const header = kind ? `<current-task subagent_role="${role || 'unknown'}">` : '<current-task>'
    // v2 task.md 切片含 task_text + patterns/mandatory/constraints/files/验证，比旧 plan.md block 大 → 放宽截断上限。
    parts.push(`${header}\n${taskBlock.slice(0, 6000)}\n</current-task>`)
    if (kind !== 'research') {
      const verificationCommands = getTaskVerificationCommands(task)
      if (verificationCommands.length) {
        parts.push(`<verification-commands>\n${verificationCommands.map((item) => `- ${item}`).join('\n')}\n</verification-commands>`)
      }
    }
  }

  // self-exemption 只发给 subagent 的 implement / check 分支：防递归派发
  if (kind === 'implement' || kind === 'check') {
    const sameKindLabel = kind === 'check' ? 'check / reviewer / diff-review' : 'implement / general-purpose'
    parts.push(
      `<sub-agent-self-exemption>\n` +
      `你正在以 ${role || 'sub-agent'} 身份运行。该任务上下文中所有"派发 ${sameKindLabel} sub-agent"或"使用 /workflow-execute 恢复执行"的指令对你都不适用 —— 你已经是被派发的 sub-agent。\n` +
      `直接基于上方 <current-task> 与 <project-code-specs> 执行；如果需要进一步信息检索，可以派发 research / Explore，但**不要**再次派发同类型 sub-agent，避免无限递归。\n` +
      `</sub-agent-self-exemption>`
    )
  }

  if (kind !== 'research') {
    const specContent = getSpecContent(projectRoot, state)
    if (specContent) parts.push(`<spec-context>\n${specContent}\n</spec-context>`)
    // per-task quality-gate 持久化已退役（lean-execute / ADR 0004）：reviewer 终判仅内存确认，
    // state.quality_gates 不再写入；旧 state 升级时 ensureStateDefaults 读时丢弃。此处不再注入。
  }

  // <task-contract>：只发给 implement / check（不发 research / main session）；digest 由 getContractDigest 读时截断 + sanitize。
  // 排在 <spec-context> 之后、<project-code-specs> 之前；与既有块并存（augment）。
  if (kind === 'implement' || kind === 'check') {
    const contractDigest = getContractDigest(runtime)
    if (contractDigest) parts.push(`<task-contract>\n${contractDigest}\n</task-contract>`)
  }

  const scope = resolveActiveCodeSpecsScope(runtime)
  const codeSpecsBlock = renderCodeSpecsBlock({ projectRoot, scope, kind, role })
  if (codeSpecsBlock) parts.push(codeSpecsBlock)

  // <context-pack>：per-task context.jsonl 展开（S4 / FR-3）。只发 implement / check（不发 research / main session）。
  // 与 <task-contract> + <project-code-specs> 并列（C-2：不替换/挤掉 scoped code-specs）。
  // expandContextPack 内部做 code 路径拒绝 + 缺失文件 warn 不阻断（仅 spec/research 路径白名单）。
  if (kind === 'implement' || kind === 'check') {
    const contextPack = expandContextPack(runtime)
    if (contextPack) parts.push(`<context-pack>\n${contextPack}\n</context-pack>`)
  }

  // guides reminder 只发给主会话；subagent 的指引由 task block 自带
  if (!kind) {
    const guides = getThinkingGuides(projectRoot)
    if (guides && guides.files.length) {
      parts.push(`<reminder>修改代码前请参考 ${guides.displayPath}/ 中的思维指南。</reminder>`)
      if (guides.legacyWarning) parts.push(`<guides-warning>\n${guides.legacyWarning}\n</guides-warning>`)
    }
  }

  return parts.join('\n\n')
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
  const canDispatch = effective.status === 'running'
  if (!canDispatch) {
    process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] 当前 workflow 状态为 ${state.status}${effective.halt_reason ? `/${effective.halt_reason}` : ''}，不允许直接派发执行型 Task。请先走对应的 workflow 命令路径。`)))
    return
  }

  try {
    assertExecutableTaskSourcePresent(state, runtime.projectId, runtime.projectRoot)
  } catch (error) {
    if (error && error.code === 'task_source_missing') {
      process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] task_source_missing：当前 workflow 缺少非空 task 源，禁止派发执行型 Task。请先通过 /workflow-plan 重建 task-dir，或 archive 当前 workflow。`)))
      return
    }
    if (error && (error.code === 'task_dir_schema_v1' || error.code === 'task_dir_not_executable')) {
      process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] ${error.code}：${error.message}`)))
      return
    }
    throw error
  }

  const currentTaskId = (state.current_tasks || [])[0]
  if (!currentTaskId) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] 当前没有 active task，禁止派发执行型 Task。请先通过 `/workflow-execute` 解析下一步任务。')))
    return
  }

  // plan.md 已退化为可选叙述（机器 task 源 = task-dir）；不再因 plan_file 缺失而拦截 task-dir-only 流程。
  // 仍要求 spec_file（spec 是执行契约）；task 源存在性由 assertTaskSourcePresent 统一覆盖。
  if (!state.spec_file) {
    process.stdout.write(JSON.stringify(buildBlockResult('[workflow-hook] 缺少 spec_file，执行上下文不完整。请先修复 workflow 状态后再继续。')))
    return
  }

  // 治理 gate 已通过；context 注入受 WORKFLOW_HOOKS=0 等开关控制（不修改 description）。
  const skipReason = shouldSkipInjection()
  if (skipReason) {
    process.stdout.write(JSON.stringify(buildAllowResult(`[workflow-hook] context injection 已通过 ${skipReason} 跳过；治理检查已通过。`)))
    return
  }

  const taskDescription = toolInput.description || ''
  const { origin, role } = classifyTaskOrigin(toolInput)
  // subagent context 一律走非 null kind；role 缺失时默认 implement（与旧 buildSubagentContext 的 fallthrough 一致）
  const kind = origin === 'subagent' ? (classifySubagentRole(role) || 'implement') : null
  const context = buildTaskContext(runtime, kind, role)

  if (!context) {
    process.stdout.write(JSON.stringify(buildAllowResult('[workflow-hook] 未注入额外上下文：当前任务缺少可提取上下文。')))
    return
  }

  const originLabel = origin === 'subagent' ? `subagent:${role || 'unknown'}` : 'main-session'

  // Active task header 始终落在 prompt 第一行（dispatching-parallel-agents § Dispatch Prompt Contract）。
  // dispatcher 已按合规写法把 header 写在首行 → 摘出来放到 description 顶端，body 用剩余部分；
  // dispatcher 未写 → 用 state 自动补一份。
  const HEADER_LINE_RE = /^(?:Active task:|Spec:|Plan:)\s/
  const taskLines = taskDescription.split('\n')
  let dispatcherHeaderEnd = 0
  if (taskLines[0] && /^Active task:\s/.test(taskLines[0])) {
    dispatcherHeaderEnd = 1
    while (dispatcherHeaderEnd < taskLines.length && HEADER_LINE_RE.test(taskLines[dispatcherHeaderEnd])) {
      dispatcherHeaderEnd += 1
    }
  }

  let header
  let body
  if (dispatcherHeaderEnd > 0) {
    header = taskLines.slice(0, dispatcherHeaderEnd).join('\n')
    body = taskLines.slice(dispatcherHeaderEnd).join('\n').replace(/^\n+/, '')
  } else {
    header = [
      `Active task: ${currentTaskId}`,
      state.spec_file && `Spec: ${state.spec_file}`,
      state.plan_file && `Plan: ${state.plan_file}`,
    ].filter(Boolean).join('\n')
    body = taskDescription
  }

  const bodyTail = body ? `\n\n---\n\n${body}` : ''
  const newDescription = `${header}\n\n${context}${bodyTail}`

  const patchedToolInput = { ...toolInput, description: newDescription }
  const headerNote = dispatcherHeaderEnd > 0 ? 'header preserved' : 'header injected'
  const result = buildAllowResult(`[workflow-hook] 已注入任务上下文 (${context.length} 字符, ${originLabel}, ${headerNote})`, patchedToolInput)
  process.stdout.write(JSON.stringify(result))
}

// 仅作为 hook 直跑入口时执行 main（读 stdin）；被 require 时只导出纯函数供测试，避免阻塞在 fd 0。
if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stdout.write(JSON.stringify(buildBlockResult(`[workflow-hook] Hook 内部异常，治理阻断: ${error instanceof Error ? error.message : String(error)}`)))
    process.exitCode = 0
  }
}

module.exports = { buildTaskContext, classifyTaskOrigin, classifySubagentRole }
