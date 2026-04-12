#!/usr/bin/env node

const fs = require('fs')
const { findPlaceholders } = require('./traceability')

const CLI_COMMAND_REGEX = /(?:sub\.add_parser\(\s*"([a-z0-9_-]+)"|command === '([a-z0-9_-]+)')/gi
const WORKFLOW_COMMAND_DOC_REGEX = /\/workflow\s+([a-z0-9_-]+)/gi
const SCRIPT_REF_REGEX = /`(?:scripts\/)?([a-zA-Z0-9_./-]+\.(?:py|js))`/g

const REQUIRED_PLAN_TEMPLATE_MARKERS = ['{{task_name}}', '{{spec_file}}', '{{tasks}}', '{{requirement_coverage}}', '## Requirement Coverage', '## Tasks', '## Self-Review Checklist']
const REQUIRED_SPEC_TEMPLATE_MARKERS = ['{{task_name}}', '{{critical_constraints}}', '{{scope_summary}}', '{{acceptance_criteria}}', '## 2. Scope', '## 3. Constraints', '## 7. Acceptance Criteria']
const REQUIRED_TASK_FIELD_MARKERS = ['阶段', 'Spec 参考', 'Plan 参考', '需求 ID', 'actions', '步骤']
const IGNORED_DOC_COMMANDS = new Set(['action'])
const IGNORED_PLACEHOLDER_LINE_HINTS = ['placeholder', 'no placeholders', 'no tbd', '搜索 tbd/todo', '禁止 tbd/todo', '替换为实际内容', '占位符', 'similar to task', 'implement later', 'fill in details', 'write tests for', 'add appropriate', 'plan failure', '"tbd"', '"todo"', '“tbd”', '“todo”']

function unique(items) {
  return [...new Set(items)]
}

function extractCliCommands(cliContent) {
  const commands = []
  for (const match of String(cliContent || '').matchAll(CLI_COMMAND_REGEX)) {
    const command = match[1] || match[2]
    if (command) commands.push(command)
  }
  return unique(commands)
}

function extractDocumentedWorkflowCommands(docContent) {
  return unique([...String(docContent || '').matchAll(WORKFLOW_COMMAND_DOC_REGEX)].map((match) => match[1])).filter((command) => !IGNORED_DOC_COMMANDS.has(command))
}

function extractScriptRefs(docContent) {
  return unique([...String(docContent || '').matchAll(SCRIPT_REF_REGEX)].map((match) => match[1]))
}

function findNonInstructionalPlaceholders(content) {
  const placeholders = []
  for (const line of String(content || '').split(/\r?\n/)) {
    const lowered = line.toLowerCase()
    if (IGNORED_PLACEHOLDER_LINE_HINTS.some((hint) => lowered.includes(hint))) continue
    placeholders.push(...findPlaceholders(line))
  }
  return unique(placeholders).sort()
}

function validateSpecTemplate(specTemplateContent) {
  const missingMarkers = REQUIRED_SPEC_TEMPLATE_MARKERS.filter((marker) => !String(specTemplateContent || '').includes(marker))
  const placeholders = findNonInstructionalPlaceholders(specTemplateContent)
  return { ok: !(missingMarkers.length || placeholders.length), missing_markers: missingMarkers, placeholders }
}

function validatePlanTemplate(planTemplateContent) {
  const missingMarkers = REQUIRED_PLAN_TEMPLATE_MARKERS.filter((marker) => !String(planTemplateContent || '').includes(marker))
  const missingTaskFields = REQUIRED_TASK_FIELD_MARKERS.filter((marker) => !String(planTemplateContent || '').includes(marker))
  const placeholders = findNonInstructionalPlaceholders(planTemplateContent)
  return { ok: !(missingMarkers.length || missingTaskFields.length || placeholders.length), missing_markers: missingMarkers, missing_task_fields: missingTaskFields, placeholders }
}

function validateCommandContract(cliContent, documentedCommands) {
  const implemented = extractCliCommands(cliContent)
  const documented = unique(documentedCommands)
  const missing = documented.filter((command) => !implemented.includes(command))
  return { ok: missing.length === 0, implemented_commands: implemented, documented_commands: documented, missing_commands: missing }
}

function validateScriptReferences(docContents, existingScriptNames) {
  const referenced = unique((docContents || []).flatMap((content) => extractScriptRefs(content)))
  const existing = new Set((existingScriptNames || []).flatMap((name) => {
    const normalized = String(name || '')
    const base = normalized.split('/').pop()
    return [normalized, base, `utils/workflow/${base}`, `./${base}`]
  }))
  const missing = referenced.filter((ref) => {
    const base = String(ref || '').split('/').pop()
    return !existing.has(ref) && !existing.has(base)
  })
  return { ok: missing.length === 0, referenced_scripts: referenced, missing_scripts: missing }
}

function validateWorkflowDocContracts(cliContent, overviewDocContent, specTemplateContent, planTemplateContent, otherDocContents, existingScriptNames) {
  const commandDocs = [...(overviewDocContent ? [overviewDocContent] : []), ...(otherDocContents || [])]
  const documentedCommands = unique(commandDocs.flatMap((content) => extractDocumentedWorkflowCommands(content)))
  const commandContract = validateCommandContract(cliContent, documentedCommands)
  const specTemplateContract = validateSpecTemplate(specTemplateContent)
  const planTemplateContract = validatePlanTemplate(planTemplateContent)
  const scriptReferenceContract = validateScriptReferences(commandDocs, existingScriptNames)
  const docPlaceholders = unique([...commandDocs, specTemplateContent, planTemplateContent].flatMap((content) => findNonInstructionalPlaceholders(content)))
  return {
    ok: commandContract.ok && specTemplateContract.ok && planTemplateContract.ok && scriptReferenceContract.ok && docPlaceholders.length === 0,
    command_contract: commandContract,
    spec_template_contract: specTemplateContract,
    plan_template_contract: planTemplateContract,
    script_reference_contract: scriptReferenceContract,
    doc_placeholders: docPlaceholders,
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function parseRepeatedOption(args, flag) {
  const values = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) values.push(args[i + 1])
  }
  return values
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  if (command === 'cli-commands') {
    process.stdout.write(`${JSON.stringify({ commands: extractCliCommands(readText(args[0])) })}\n`)
    return
  }
  if (command === 'doc-commands') {
    process.stdout.write(`${JSON.stringify({ commands: extractDocumentedWorkflowCommands(readText(args[0])) })}\n`)
    return
  }
  if (command === 'spec-template') {
    process.stdout.write(`${JSON.stringify(validateSpecTemplate(readText(args[0]))) }\n`)
    return
  }
  if (command === 'plan-template') {
    process.stdout.write(`${JSON.stringify(validatePlanTemplate(readText(args[0]))) }\n`)
    return
  }
  if (command === 'workflow-contracts') {
    const cliFile = args[args.indexOf('--cli') + 1]
    const overviewIdx = args.indexOf('--overview')
    const overviewContent = overviewIdx >= 0 ? readText(args[overviewIdx + 1]) : ''
    const specTemplateFile = args[args.indexOf('--spec-template') + 1]
    const planTemplateFile = args[args.indexOf('--plan-template') + 1]
    const docs = parseRepeatedOption(args, '--doc')
    const scripts = parseRepeatedOption(args, '--script')
    process.stdout.write(`${JSON.stringify(validateWorkflowDocContracts(readText(cliFile), overviewContent, readText(specTemplateFile), readText(planTemplateFile), docs.map(readText), scripts))}\n`)
    return
  }
  process.stderr.write('Usage: node doc_contracts.js <cli-commands|doc-commands|spec-template|plan-template|workflow-contracts> ...\n')
  process.exitCode = 1
}

module.exports = {
  extractCliCommands,
  extractDocumentedWorkflowCommands,
  extractScriptRefs,
  validateSpecTemplate,
  validatePlanTemplate,
  validateCommandContract,
  validateScriptReferences,
  findNonInstructionalPlaceholders,
  validateWorkflowDocContracts,
}

if (require.main === module) main()
