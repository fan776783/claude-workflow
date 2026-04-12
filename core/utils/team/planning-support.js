/** Team 规划辅助 —— 提供项目配置管理、需求解析、讨论/UX 门控判断等规划阶段支持函数 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

/**
 * 根据项目根目录生成稳定的 12 位 MD5 哈希 ID
 * @param {string} projectRoot - 项目根目录
 * @returns {string} 12 位十六进制项目 ID
 */
function stableProjectId(projectRoot) {
  return crypto.createHash('md5').update(projectRoot.toLowerCase()).digest('hex').slice(0, 12)
}

/**
 * 加载项目配置文件，不存在或解析失败时返回 null
 * @param {string} projectRoot - 项目根目录
 * @returns {object|null} 项目配置对象
 */
function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 确保项目配置文件存在且包含必要字段，缺失时自动补全并写入
 * @param {string} projectRoot - 项目根目录
 * @param {string|null} forcedProjectId - 强制使用的项目 ID
 * @returns {object} 包含 config、configHealed、configPath
 */
function ensureProjectConfig(projectRoot, forcedProjectId) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  const existing = loadProjectConfig(projectRoot)
  const current = existing ? { ...existing } : {}
  const project = { ...(current.project || {}) }
  const tech = { ...(current.tech || {}) }
  const workflow = { ...(current.workflow || {}) }
  const projectId = forcedProjectId || project.id || current.projectId || stableProjectId(projectRoot)

  project.id = projectId
  project.name = project.name || path.basename(projectRoot)
  project.type = project.type || 'single'
  project.bkProjectId = project.bkProjectId || null
  tech.packageManager = tech.packageManager || 'unknown'
  tech.buildTool = tech.buildTool || 'unknown'
  tech.frameworks = tech.frameworks || []
  workflow.enableBKMCP = workflow.enableBKMCP || false

  const config = { ...current, project, tech, workflow, _scanMode: current._scanMode || 'auto-healed' }
  const configHealed = !existing || existing.project?.id !== projectId
  if (configHealed) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  }
  return { config, configHealed, configPath }
}

/**
 * 解析需求输入：如果是 .md 文件路径则读取内容，否则视为内联文本
 * @param {string} requirement - 需求文本或 .md 文件路径
 * @param {string} projectRoot - 项目根目录
 * @returns {object} 包含 requirementSource、requirementText、sourcePath
 */
function resolveRequirementInput(requirement, projectRoot) {
  const candidate = requirement.endsWith('.md') ? path.resolve(projectRoot, requirement) : null
  if (candidate && fs.existsSync(candidate)) {
    return {
      requirementSource: path.relative(projectRoot, candidate),
      requirementText: fs.readFileSync(candidate, 'utf8'),
      sourcePath: candidate,
    }
  }
  return { requirementSource: 'inline', requirementText: requirement, sourcePath: null }
}

/**
 * 从需求文本或文件路径推导任务名称
 * @param {string} requirementText - 需求文本
 * @param {string|null} sourcePath - 需求文件路径
 * @returns {string} 推导出的任务名称
 */
function deriveTaskName(requirementText, sourcePath) {
  if (sourcePath) return path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]/g, ' ').trim() || 'Team Task'
  const collapsed = requirementText.replace(/\s+/g, ' ').trim()
  return (collapsed.slice(0, 48) || 'Team Task').trim()
}

/**
 * 从项目配置中构建技术栈摘要文本
 * @param {object} config - 项目配置对象
 * @returns {string} 技术栈摘要（如 "npm | vite | react/next"）
 */
function buildTechStackSummary(config) {
  const tech = config.tech || {}
  const parts = [tech.packageManager || 'unknown', tech.buildTool || 'unknown']
  if (Array.isArray(tech.frameworks) && tech.frameworks.length) parts.push(tech.frameworks.join('/'))
  return parts.join(' | ')
}

/**
 * 估算需求文本中的疑问标记数量
 * @param {string} requirementText - 需求文本
 * @returns {number} 疑问标记（？/?）的数量
 */
function estimateGapCount(requirementText) {
  return (requirementText.match(/[？?]/g) || []).length
}

/**
 * 判断是否需要运行需求讨论环节
 * @param {string} requirementText - 需求文本
 * @param {string} requirementSource - 需求来源（inline 或文件路径）
 * @param {object} options - 选项，含 noDiscuss
 * @returns {boolean} 需要讨论时返回 true
 */
function shouldRunDiscussion(requirementText, requirementSource, { noDiscuss = false } = {}) {
  if (noDiscuss) return false
  if (requirementSource === 'inline' && requirementText.trim().length <= 100) return false
  return estimateGapCount(requirementText) > 0 || requirementText.trim().length > 100
}

/**
 * 判断是否需要运行 UX 设计门控（基于需求文本和框架检测）
 * @param {string} requirementText - 需求文本
 * @param {object} config - 项目配置对象
 * @returns {boolean} 需要 UX 门控时返回 true
 */
function shouldRunUxDesignGate(requirementText, config) {
  const text = requirementText.toLowerCase()
  const frameworks = ((config.tech || {}).frameworks || []).map((item) => String(item).toLowerCase())
  return /ui|页面|界面|组件|ux|交互/.test(requirementText) || frameworks.some((item) => /react|vue|svelte|next/.test(item)) || /frontend/.test(text)
}

/**
 * 构建讨论产物的初始结构
 * @param {string} requirementSource - 需求来源
 * @returns {object} 讨论产物对象，含 requirement_source、clarifications、created_at
 */
function buildDiscussionArtifact(requirementSource) {
  return {
    requirement_source: requirementSource,
    clarifications: [],
    created_at: new Date().toISOString(),
  }
}

module.exports = {
  buildDiscussionArtifact,
  buildTechStackSummary,
  deriveTaskName,
  ensureProjectConfig,
  estimateGapCount,
  resolveRequirementInput,
  shouldRunDiscussion,
  shouldRunUxDesignGate,
  stableProjectId,
}
