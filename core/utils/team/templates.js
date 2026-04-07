const fs = require('fs')
const path = require('path')

function renderTemplate(template, values) {
  return Object.entries(values).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, String(value)), template)
}

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
