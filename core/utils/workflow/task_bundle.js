#!/usr/bin/env node
/**
 * @file task_bundle.js — task-bundle 构建：读当前 workflow 的 plan.md，提取单个 task 的
 *   结构化执行 bundle（task_text + AC + constraints + patterns + mandatory-reading +
 *   verification + write-scope guardrails）。
 *
 * controller 派发 implementer subagent 前调一次，按固定字段填充 prompt 模板，
 * 取代手工 Read plan.md 切片。
 *
 * CommonJS。task block 定位/提取一律复用 task_parser，不自写解析。
 */

const fs = require('fs')
const { getWorkflowStatePath } = require('./path_utils')
const { readState } = require('./state_manager')
const taskStore = require('./task_store')
const {
  findTaskById,
  extractTaskBlock,
  extractField,
  extractListField,
} = require('./task_parser')
const { escapeRegExp } = require('./status_utils')

// Operational mirror of `core/specs/shared/subagent-worker-contract.md` § Invariants
// for write_serial_worker. Subagents read the prompt, not the contract doc — keep aligned.
const DEFAULT_FORBIDDEN_ACTIONS = [
  'Do not modify files outside allowed_write_paths; if scope expansion is required, return DONE_WITH_CONCERNS with type "scope" first.',
  'Do not edit spec, plan, workflow state, or review artifacts unless the task explicitly lists them.',
  'Do not commit, amend, rebase, reset, or change git remotes.',
  'Do not add dependencies, run formatters, rename files, or perform cleanup outside the task scope.',
]

function uniqueNonEmpty(items) {
  return [...new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean))]
}

/**
 * 把 `**字段名**` 之后的缩进 bullet 列表抠出来，返回每行去掉 `- ` 前缀的原文数组。
 *
 * 缩进语义：以该 section 内 **第一个匹配 bullet** 的 leading-whitespace 长度为 base indent，
 * 之后只接受缩进 === base indent 的 bullet 为同级条目；缩进更深的 bullet 视为上一条的
 * continuation（阐述用子 bullet），skip 不 push；缩进更浅 / 下一个顶级 `- **字段**` /
 * 标题 / EOF 仍是终止条件。
 *
 * @param {string} block  task markdown 块
 * @param {string} label  字段名（如 `Patterns to Mirror`）
 * @returns {string[]}
 */
function extractBulletSection(block, label) {
  const lines = String(block || '').split('\n')
  const headerPattern = new RegExp(`^\\s*-\\s*\\*\\*${escapeRegExp(label)}\\*\\*\\s*:?\\s*$`)
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (headerPattern.test(lines[i])) {
      start = i + 1
      break
    }
  }
  if (start < 0) return []
  const items = []
  let baseIndent = -1
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*-\s*\*\*[^*]+\*\*\s*:?/.test(line)) break // 下一个顶级字段
    if (/^#{1,6}\s/.test(line)) break // 标题
    const bulletMatch = line.match(/^(\s+)-\s+(.+?)\s*$/)
    if (bulletMatch) {
      const indent = bulletMatch[1].length
      if (baseIndent < 0) baseIndent = indent
      if (indent === baseIndent) items.push(bulletMatch[2].trim())
      else if (indent > baseIndent) continue // 更深缩进 = 上一条的子 bullet，skip
      else break // 缩进更浅 → section 结束
    } else if (line.trim() === '') {
      continue
    } else if (/^-\s/.test(line)) {
      break // 顶级非字段 bullet（理论不出现）
    }
  }
  return items
}

/**
 * 提取验收项 → string[]。优先抠 `**验收项**` 之后的缩进 bullet；
 * 若该字段为单行内联串（无后续 bullet），复用 task_parser.extractListField 按逗号拆。
 *
 * @param {string} block
 * @returns {string[]}
 */
function extractAcceptanceCriteria(block) {
  const bullets = extractBulletSection(block, '验收项')
  if (bullets.length) return bullets
  // inline fallback：复用 task_parser.extractListField（按 `,` 拆 + trim + 去空），
  // 与本文件原 `split(/,\s*/)` 行为等价（验收项不含 spec 引用类括号逗号，无需 splitTopLevelCsv）。
  return extractListField(block, '验收项')
}

/**
 * 在顶层逗号处拆分字符串（中/英文逗号），不拆 `（）`/`()` 括号内的逗号。
 * 关键约束行形如 `C-1（含逗号的说明）, C-3（…）, C-7（…）` —— 顶层 `, ` 才是 C-item 分隔符。
 *
 * @param {string} value
 * @returns {string[]}
 */
function splitTopLevelCsv(value) {
  const text = String(value || '')
  const parts = []
  let depth = 0
  let current = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '（' || ch === '(') depth += 1
    else if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === '，') && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map((item) => item.trim()).filter(Boolean)
}

/**
 * 提取关键约束 → string[]。`**关键约束**` 多为单行逗号串（含引用 spec 的 C-* 编号），
 * 按顶层逗号拆（不拆括号内逗号）；若以缩进 bullet 形式给出则抠 bullet。
 *
 * @param {string} block
 * @returns {string[]}
 */
function extractCriticalConstraints(block) {
  const bullets = extractBulletSection(block, '关键约束')
  if (bullets.length) return bullets
  // inline 行用 task_parser.extractField 取值，再走 splitTopLevelCsv：
  // extractListField 只按 `,` 拆且不识别中文逗号/括号嵌套，无法替代 splitTopLevelCsv
  // （关键约束行形如 `C-1（含逗号说明）, C-3（…）`，顶层 `, ` 才是分隔符）。
  const inline = extractField(block, '关键约束')
  if (!inline) return []
  return splitTopLevelCsv(inline)
}

/**
 * 解析单条 Patterns to Mirror bullet → `{file, line?, note}`。
 * 形如 `` `path/to/file.js`:123 — note `` 或 `` `path:func` (line 88-99) — note ``。
 *
 * @param {string} raw  bullet 原文
 * @returns {{file:string, line?:string, note:string}}
 */
function parsePatternBullet(raw) {
  const text = String(raw || '').trim()
  // 拆 note：首个 ` — ` / ` - ` 之后视为说明。
  let head = text
  let note = ''
  const noteMatch = text.match(/^(.*?)\s+[—–-]\s+(.+)$/)
  if (noteMatch) {
    head = noteMatch[1].trim()
    note = noteMatch[2].trim()
  }
  // head 形如 `path`:line / `path:func`(行号) / path
  let file = head
  let line
  // `…`:NN 形式
  const colonLine = head.match(/^`([^`]+)`\s*:\s*(\d[\d\s-]*)\s*$/)
  if (colonLine) {
    file = colonLine[1].trim()
    line = colonLine[2].trim()
  } else {
    // `path`(line NN-MM) 或 `path` (NN)
    const parenLine = head.match(/^`([^`]+)`\s*\(?\s*(?:line\s*)?(\d[\d\s-]*)\s*\)?\s*$/i)
    if (parenLine) {
      file = parenLine[1].trim()
      line = parenLine[2].trim()
    } else {
      // 仅反引号包裹的路径
      const bareTick = head.match(/^`([^`]+)`\s*$/)
      if (bareTick) file = bareTick[1].trim()
      else file = head.replace(/`/g, '').trim()
    }
  }
  const result = { file, note }
  if (line) result.line = line
  return result
}

/**
 * 提取 Patterns to Mirror → `[{file, line?, note}]`。缺失该段 → `[]`。
 *
 * @param {string} block
 * @returns {Array<{file:string, line?:string, note:string}>}
 */
function extractPatternsToMirror(block) {
  return extractBulletSection(block, 'Patterns to Mirror').map(parsePatternBullet)
}

/**
 * 解析单条 Mandatory Reading bullet → `{path, reason, symbols, line_hint}`。
 * bullet 形如 `` `path` — why ``、`` `path` (lines 10-20) — why ``，
 * 或 `` `path` — symbols: Foo, bar; why ``。
 * Symbols 列表用顶层逗号拆分(`splitTopLevelCsv` 已经处理 `()` 嵌套)；
 * `;` 与 `—` 作为 symbols clause 的终止符,故 symbol 名本身不可包含分号或破折号。
 *
 * @param {string} raw
 * @returns {{path:string, reason:string, symbols:string[], line_hint:string}}
 */
function parseMandatoryReadingBullet(raw) {
  const text = String(raw || '').trim()
  const dashMatch = text.match(/^(.*?)\s+[—–-]\s+(.+)$/)
  const head = (dashMatch ? dashMatch[1] : text).trim()
  const tail = (dashMatch ? dashMatch[2] : '').trim()
  const tick = head.match(/`([^`]+)`/) || text.match(/`([^`]+)`/)
  const pathValue = tick ? tick[1].trim() : head.replace(/`/g, '').trim()
  const lineMatch = text.match(/(?:lines?|line_hint)\s*[:#]?\s*([0-9]+(?:[,\s-]+[0-9]+)*)/i)
  const symbolMatch = text.match(/(?:symbols?|符号)\s*[:：]\s*([^;；—–]+)/i)
  const symbols = symbolMatch ? splitTopLevelCsv(symbolMatch[1]) : []
  const reason = tail
    .replace(/(?:symbols?|符号)\s*[:：]\s*[^;；—–]+[;；]?\s*/i, '')
    .replace(/\(?\s*(?:lines?|line_hint)\s*[:#]?\s*[0-9]+(?:[,\s-]+[0-9]+)*\s*\)?/ig, '')
    .replace(/^[\s—–\-:;,，]+/, '')
    .trim()
  return {
    path: pathValue,
    reason,
    symbols,
    line_hint: lineMatch ? lineMatch[1].trim() : '',
  }
}

/**
 * 提取 Mandatory Reading → `[{path, reason, symbols, line_hint}]`。缺失该段 → `[]`。
 *
 * @param {string} block
 * @returns {Array<{path:string, reason:string, symbols:string[], line_hint:string}>}
 */
function extractMandatoryReading(block) {
  return extractBulletSection(block, 'Mandatory Reading')
    .map(parseMandatoryReadingBullet)
    .filter((item) => item.path)
}

function buildAllowedWritePaths(task) {
  if (!task || typeof task.all_files !== 'function') return []
  return uniqueNonEmpty(task.all_files())
}

/**
 * 提取验证段 → `{ command, require_files, expected }`。
 * command 取 `**验证命令**` 后 fenced code block 内容（或单行内联值）；
 * expected 取 `**验证期望**` 行原文。
 *
 * @param {string} block
 * @returns {{command:string, require_files:string[], expected:string}}
 */
function extractVerification(block) {
  const text = String(block || '')
  let command = ''
  // `**验证命令**:` 之后的 fenced code block
  const fenced = text.match(/-\s*\*\*验证命令\*\*\s*:\s*\n\s*```[^\n]*\n([\s\S]*?)\n\s*```/)
  if (fenced) {
    command = fenced[1].split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
  } else {
    // inline fallback 不复用 task_parser.extractField：后者会 strip 反引号，
    // 而验证命令常以 `` `node …` `` 形式给出，strip 后 CLI 命令文本失真。
    // 保留原行解析（不动反引号）。
    const cmdMatch = text.match(new RegExp(`^\\s*-\\s*\\*\\*${escapeRegExp('验证命令')}\\*\\*\\s*:\\s*(.+?)\\s*$`, 'm'))
    command = cmdMatch ? cmdMatch[1].trim() : ''
  }
  // 验证期望为说明性文本，反引号无语义负载，复用 task_parser.extractField。
  const expected = extractField(block, '验证期望') || ''
  // require_files 一期保留字段（暂未从 plan 提取，预留给后续 verification 前置文件检查）。
  return { command, require_files: [], expected }
}

/**
 * 构建单个 task 的执行 bundle。
 *
 * @param {string} taskId  task 编号（如 `T1`）
 * @param {object} [opts]
 * @param {string} [opts.projectId]   项目 ID（用于解析 state 路径）
 * @param {string} [opts.projectRoot] 项目根（保留参数，与上游 CLI 对齐）
 * @param {string} [opts.statePath]   显式覆盖 state 文件路径
 * @returns {object} `{task_id, task_text, acceptance_criteria, critical_constraints,
 *   patterns_to_mirror, mandatory_reading, verification, allowed_write_paths,
 *   forbidden_actions}` 或 `{error, task_id}`
 */
function buildTaskBundle(taskId, opts = {}) {
  const { projectId, statePath: statePathOverride } = opts || {}
  // P2.3：task-bundle 仅服务 legacy plan.md workflow。检测到 v2 task-dir（schema_version≥2）→ 不参与，
  // 引导走 task-dir（execute 从 task-dir 取全切片，无需 per-task task-bundle）。
  if (projectId) {
    const dirTasks = taskStore.listTasks(projectId)
    if (dirTasks.length && dirTasks.some((t) => Number(t.schema_version) >= taskStore.CURRENT_SCHEMA_VERSION)) {
      return {
        legacy: true,
        deprecated: true,
        task_id: taskId,
        error: 'task-bundle 仅用于 legacy plan.md workflow；当前为 v2 task-dir workflow，execute 从 task-dir(task.json + task.md)取全切片，无需 task-bundle。',
      }
    }
  }
  const statePath = statePathOverride || getWorkflowStatePath(projectId)
  if (!statePath) return { error: 'workflow state path not resolvable', task_id: taskId }
  if (!fs.existsSync(statePath)) return { error: '没有活跃的工作流', task_id: taskId }

  const state = readState(statePath, projectId)
  const planFile = state.plan_file
  if (!planFile || !fs.existsSync(planFile)) {
    return { error: 'plan file not found', task_id: taskId }
  }

  const content = fs.readFileSync(planFile, 'utf8')
  const task = findTaskById(content, taskId)
  if (!task) return { error: 'task_id not found', task_id: taskId }

  const block = extractTaskBlock(content, taskId)
  return {
    legacy: true,
    task_id: taskId,
    task_text: block,
    acceptance_criteria: extractAcceptanceCriteria(block),
    critical_constraints: extractCriticalConstraints(block),
    patterns_to_mirror: extractPatternsToMirror(block),
    mandatory_reading: extractMandatoryReading(block),
    allowed_write_paths: buildAllowedWritePaths(task),
    forbidden_actions: [...DEFAULT_FORBIDDEN_ACTIONS],
    verification: extractVerification(block),
  }
}

module.exports = {
  buildTaskBundle,
  extractBulletSection,
  extractAcceptanceCriteria,
  extractCriticalConstraints,
  parsePatternBullet,
  extractPatternsToMirror,
  parseMandatoryReadingBullet,
  extractMandatoryReading,
  buildAllowedWritePaths,
  extractVerification,
  splitTopLevelCsv,
}
