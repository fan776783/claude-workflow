const fs = require('fs')

const IGNORED_DOC_COMMANDS = new Set(['action'])
const PLACEHOLDER_REGEX = /\b(?:TBD|TODO|待补充|待确认|similar to Task)\b/gi
const IGNORED_PLACEHOLDER_LINE_HINTS = [
  'placeholder',
  'no placeholders',
  'no tbd',
  '搜索 tbd/todo',
  '禁止 tbd/todo',
  '替换为实际内容',
  '占位符',
  'similar to task',
  'implement later',
  'fill in details',
  'write tests for',
  'add appropriate',
  'plan failure',
]

function unique(items) {
  return [...new Set(items)]
}

function extractCliCommands(cliContent) {
  const commands = []
  const ifRegex = /command === '([a-z0-9_-]+)'/gi
  for (const match of cliContent.matchAll(ifRegex)) {
    commands.push(match[1])
  }
  return unique(commands)
}

function extractDocumentedTeamCommands(docContent) {
  return unique([...docContent.matchAll(/\/team\s+([a-z0-9_-]+)/gi)].map((match) => match[1])).filter(
    (command) => !IGNORED_DOC_COMMANDS.has(command)
  )
}

function extractScriptRefs(docContent) {
  return unique(
    [...docContent.matchAll(/`(?:core\/utils\/team\/|(?:\.\.\/)*\.\.\/utils\/team\/)([a-zA-Z0-9_./-]+\.js)`/g)].map(
      (match) => match[1]
    )
  )
}

function findNonInstructionalPlaceholders(content) {
  const placeholders = []
  for (const line of content.split(/\r?\n/)) {
    const lowered = line.toLowerCase()
    if (IGNORED_PLACEHOLDER_LINE_HINTS.some((hint) => lowered.includes(hint))) continue
    for (const match of line.matchAll(PLACEHOLDER_REGEX)) {
      placeholders.push(match[0])
    }
  }
  return unique(placeholders).sort()
}

function validateCommandContract(cliContent, documentedCommands) {
  const implemented = extractCliCommands(cliContent)
  const documented = unique(documentedCommands)
  const missing = documented.filter((command) => !implemented.includes(command))
  return { ok: missing.length === 0, implemented_commands: implemented, documented_commands: documented, missing_commands: missing }
}

function validateScriptReferences(docContents, existingScriptNames) {
  const referenced = unique(docContents.flatMap((content) => extractScriptRefs(content)))
  const existing = new Set(existingScriptNames)
  const missing = referenced.filter((ref) => !existing.has(ref))
  return { ok: missing.length === 0, referenced_scripts: referenced, missing_scripts: missing }
}

function validateTeamContracts({ cliFile, overviewFile, docFiles = [], scriptFiles = [] }) {
  const cliContent = fs.readFileSync(cliFile, 'utf8')
  const overviewContent = fs.readFileSync(overviewFile, 'utf8')
  const otherDocs = docFiles.map((file) => fs.readFileSync(file, 'utf8'))
  const commandDocs = [overviewContent, ...otherDocs]
  const documentedCommands = unique(commandDocs.flatMap((content) => extractDocumentedTeamCommands(content)))
  const commandContract = validateCommandContract(cliContent, documentedCommands)
  const scriptReferenceContract = validateScriptReferences(commandDocs, scriptFiles)
  const docPlaceholders = unique(commandDocs.flatMap((content) => findNonInstructionalPlaceholders(content)))
  return {
    ok: commandContract.ok && scriptReferenceContract.ok && docPlaceholders.length === 0,
    command_contract: commandContract,
    script_reference_contract: scriptReferenceContract,
    doc_placeholders: docPlaceholders,
  }
}

module.exports = {
  validateTeamContracts,
}
