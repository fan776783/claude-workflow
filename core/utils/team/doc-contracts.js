/** Team 文档契约验证 —— 检查命令实现与文档的一致性、脚本引用完整性和占位符残留 */

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

/**
 * 对数组去重
 * @param {Array} items - 输入数组
 * @returns {Array} 去重后的数组
 */
function unique(items) {
  return [...new Set(items)]
}

/**
 * 从 CLI 源码中提取已实现的命令名称
 * @param {string} cliContent - CLI 入口文件内容
 * @returns {string[]} 去重后的命令名列表
 */
function extractCliCommands(cliContent) {
  const commands = []
  const ifRegex = /command === '([a-z0-9_-]+)'/gi
  for (const match of cliContent.matchAll(ifRegex)) {
    commands.push(match[1])
  }
  return unique(commands)
}

/**
 * 从文档内容中提取 /team 子命令名称
 * @param {string} docContent - 文档文本
 * @returns {string[]} 去重后的子命令列表（排除忽略项）
 */
function extractDocumentedTeamCommands(docContent) {
  return unique([...docContent.matchAll(/\/team\s+([a-z0-9_-]+)/gi)].map((match) => match[1])).filter(
    (command) => !IGNORED_DOC_COMMANDS.has(command)
  )
}

/**
 * 从文档中提取引用的 utils/team/ 脚本文件名
 * @param {string} docContent - 文档文本
 * @returns {string[]} 去重后的脚本文件名列表
 */
function extractScriptRefs(docContent) {
  return unique(
    [...docContent.matchAll(/`(?:core\/utils\/team\/|(?:\.\.\/)*\.\.\/utils\/team\/)([a-zA-Z0-9_./-]+\.js)`/g)].map(
      (match) => match[1]
    )
  )
}

/**
 * 查找文档中非指令性的占位符（TBD/TODO/待补充等），排除规则说明行
 * @param {string} content - 文档文本
 * @returns {string[]} 去重排序后的占位符列表
 */
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

/**
 * 验证 CLI 实现是否覆盖了文档中记录的所有命令
 * @param {string} cliContent - CLI 源码内容
 * @param {string[]} documentedCommands - 文档中记录的命令列表
 * @returns {object} 验证结果，含 ok、implemented_commands、missing_commands
 */
function validateCommandContract(cliContent, documentedCommands) {
  const implemented = extractCliCommands(cliContent)
  const documented = unique(documentedCommands)
  const missing = documented.filter((command) => !implemented.includes(command))
  return { ok: missing.length === 0, implemented_commands: implemented, documented_commands: documented, missing_commands: missing }
}

/**
 * 验证文档中引用的脚本文件是否都实际存在
 * @param {string[]} docContents - 文档内容数组
 * @param {string[]} existingScriptNames - 实际存在的脚本文件名列表
 * @returns {object} 验证结果，含 ok、referenced_scripts、missing_scripts
 */
function validateScriptReferences(docContents, existingScriptNames) {
  const referenced = unique(docContents.flatMap((content) => extractScriptRefs(content)))
  const existing = new Set(existingScriptNames)
  const missing = referenced.filter((ref) => !existing.has(ref))
  return { ok: missing.length === 0, referenced_scripts: referenced, missing_scripts: missing }
}

/**
 * 综合验证 team 文档契约：命令覆盖、脚本引用完整性、占位符残留
 * @param {object} params - 验证参数
 * @param {string} params.cliFile - CLI 入口文件路径
 * @param {string} params.overviewFile - 概览文档路径
 * @param {string[]} params.docFiles - 其他文档文件路径列表
 * @param {string[]} params.scriptFiles - 实际存在的脚本文件名列表
 * @returns {object} 综合验证结果，含 ok、command_contract、script_reference_contract、doc_placeholders
 */
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
