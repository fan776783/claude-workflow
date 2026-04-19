#!/usr/bin/env node

// Code-specs template 契约：锁定 7 段 code-spec / 4 段 layer-index / 6 段 guides-index 的段落标题。
// canonical 模板发生 drift（段落改名 / 漏写）时，/workflow-review 的 Code Specs Check 与 Probe E
// 会因为读不到对应段落而失效。这里做最小集的 exact-heading 校验，scripts/validate.js 在 prepublish 时调用。

const fs = require('fs')
const path = require('path')

const SPEC_TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'specs', 'spec-templates')

// 每个模板声明必须出现的精确段标题。顺序与模板当前一致；若调整模板顺序，请同步这里。
const TEMPLATE_CONTRACTS = {
  'code-spec-template.md': [
    '## 1. Scope / Trigger',
    '## 2. Signatures',
    '## 3. Contracts',
    '## 4. Validation & Error Matrix',
    '## 5. Good / Base / Bad Cases',
    '## 6. Tests Required',
    '## 7. Wrong vs Correct',
  ],
  'layer-index-template.md': [
    '## Overview',
    '## Guidelines Index',
    '## Pre-Development Checklist',
    '## Quality Check',
  ],
  'guides-index-template.md': [
    '## Overview',
    '## Thinking Triggers',
    '## Pre-Modification Rule',
    '## Guides Catalog',
    '## How to Use This Directory',
    '## Contributing',
  ],
}

function readTemplate(relativeName) {
  const fullPath = path.join(SPEC_TEMPLATES_DIR, relativeName)
  if (!fs.existsSync(fullPath)) return { exists: false, content: '', path: fullPath }
  return { exists: true, content: fs.readFileSync(fullPath, 'utf8'), path: fullPath }
}

// exact-match：每个期望的 heading 必须作为整行出现。允许前后有空白，不允许层级或字样漂移（## → ### / 英文→中文）。
function validateSpecTemplateHeadings(contracts = TEMPLATE_CONTRACTS) {
  const errors = []
  for (const [relativeName, expectedHeadings] of Object.entries(contracts)) {
    const { exists, content, path: templatePath } = readTemplate(relativeName)
    if (!exists) {
      errors.push({ template: relativeName, code: 'missing_template', message: `模板文件不存在: ${templatePath}` })
      continue
    }
    const lines = content.split(/\r?\n/).map((line) => line.trim())
    for (const heading of expectedHeadings) {
      if (!lines.includes(heading)) {
        errors.push({ template: relativeName, code: 'missing_heading', heading, message: `模板 ${relativeName} 缺少必要段落: ${heading}` })
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  if (command === 'validate-spec-templates') {
    const result = validateSpecTemplateHeadings()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exitCode = 1
    return
  }
  process.stderr.write('Usage: node template_contracts.js validate-spec-templates\n')
  process.exitCode = 1
}

module.exports = {
  SPEC_TEMPLATES_DIR,
  TEMPLATE_CONTRACTS,
  validateSpecTemplateHeadings,
}

if (require.main === module) main()
