/**
 * @file 模板工具 - 提供模板变量替换和团队模板文件加载功能
 */
const fs = require('fs')
const path = require('path')

/**
 * 将模板字符串中的 {{key}} 占位符替换为对应的值
 * @param {string} template - 包含 {{key}} 占位符的模板字符串
 * @param {Object} values - 键值对映射，key 对应占位符名称
 * @returns {string} 替换后的字符串
 */
function renderTemplate(template, values) {
  return Object.entries(values).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, String(value)), template)
}

/**
 * 从 specs/team-templates 目录加载 spec 和 plan 模板文件
 * @param {string} baseDir - 当前模块所在目录（用于定位模板根目录）
 * @returns {{specTemplate: string, planTemplate: string}} 模板内容对象
 */
function loadTeamTemplates(baseDir) {
  const templateRoot = path.join(baseDir, '..', '..', 'specs', 'team-templates')
  return {
    specTemplate: fs.readFileSync(path.join(templateRoot, 'spec-template.md'), 'utf8'),
    planTemplate: fs.readFileSync(path.join(templateRoot, 'plan-template.md'), 'utf8'),
  }
}

module.exports = {
  renderTemplate,
  loadTeamTemplates,
}
