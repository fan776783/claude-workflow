#!/usr/bin/env node

// task.md 渲染器（v2）——从 task.json 规范化记录渲染人读执行正文。
// 单向：task.json（结构化权威）→ task.md（渲染产物）。execute 期逐字注入 implementer，不回解析。
// 段落布局对齐旧 plan.md task block（task_bundle 时代 implementer 已熟悉），仅 emit 有内容的段。
//
// 渲染源字段（见 task-dir-schema.md v2）：name / task_text / acceptance[] / constraints[] /
// patterns[]{file,line?,note} / mandatory_reading[]{path,reason,symbols[],line_hint} / files[] / verification{commands}。

function renderTaskMd(record = {}) {
  const r = record || {}
  const lines = []
  const title = r.name ? `${r.id || ''}: ${r.name}`.trim() : String(r.id || 'task')
  lines.push(`# ${title}`, '')

  if (r.task_text && String(r.task_text).trim()) {
    lines.push(String(r.task_text).trim(), '')
  }

  if (Array.isArray(r.acceptance) && r.acceptance.length) {
    lines.push('## 验收项')
    for (const item of r.acceptance) lines.push(`- ${String(item).trim()}`)
    lines.push('')
  }

  if (Array.isArray(r.constraints) && r.constraints.length) {
    lines.push('## 关键约束')
    for (const item of r.constraints) lines.push(`- ${String(item).trim()}`)
    lines.push('')
  }

  if (Array.isArray(r.patterns) && r.patterns.length) {
    lines.push('## Patterns to Mirror')
    for (const p of r.patterns) {
      if (!p || !p.file) continue
      const loc = p.line ? `\`${p.file}\`:${p.line}` : `\`${p.file}\``
      lines.push(p.note ? `- ${loc} — ${p.note}` : `- ${loc}`)
    }
    lines.push('')
  }

  if (Array.isArray(r.mandatory_reading) && r.mandatory_reading.length) {
    lines.push('## Mandatory Reading')
    for (const m of r.mandatory_reading) {
      if (!m || !m.path) continue
      let line = `- \`${m.path}\``
      if (m.line_hint) line += ` (lines ${m.line_hint})`
      const hasSymbols = Array.isArray(m.symbols) && m.symbols.length
      if (hasSymbols) line += ` — symbols: ${m.symbols.join(', ')}`
      if (m.reason) line += `${hasSymbols || m.line_hint ? '; ' : ' — '}${m.reason}`
      lines.push(line)
    }
    lines.push('')
  }

  if (Array.isArray(r.files) && r.files.length) {
    lines.push('## 写作用域')
    for (const f of r.files) lines.push(`- \`${String(f).trim()}\``)
    lines.push('')
  }

  if (r.verification && Array.isArray(r.verification.commands) && r.verification.commands.length) {
    lines.push('## 验证命令', '```bash', ...r.verification.commands.map(String), '```', '')
  }

  return `${lines.join('\n').trim()}\n`
}

module.exports = { renderTaskMd }
