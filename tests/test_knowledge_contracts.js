const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const templateContracts = require(path.join(workflowDir, 'template_contracts.js'))
const platformParity = require(path.join(repoRoot, 'core', 'utils', 'platform_parity.js'))

test('knowledge contracts', async (t) => {
  await t.test('code-spec/layer-index/guides-index heading contracts all pass on canonical templates', () => {
    const result = templateContracts.validateKnowledgeTemplateHeadings()
    assert.equal(result.ok, true, JSON.stringify(result.errors))
  })

  await t.test('contract fails when a required heading is missing', () => {
    const fakeContracts = {
      'code-spec-template.md': ['## 1. Scope / Trigger', '## 999. Nonexistent Section'],
    }
    const result = templateContracts.validateKnowledgeTemplateHeadings(fakeContracts)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.heading === '## 999. Nonexistent Section'))
  })

  await t.test('code-spec template still advertises exactly 7 ordered sections', () => {
    const headings = templateContracts.TEMPLATE_CONTRACTS['code-spec-template.md']
    assert.equal(headings.length, 7)
    const prefixes = headings.map((h) => h.match(/^## (\d+)\./)[1])
    assert.deepEqual(prefixes, ['1', '2', '3', '4', '5', '6', '7'])
  })

  await t.test('layer-index template retains the 4 mandatory sections', () => {
    const headings = templateContracts.TEMPLATE_CONTRACTS['layer-index-template.md']
    assert.deepEqual(headings, [
      '## Overview',
      '## Guidelines Index',
      '## Pre-Development Checklist',
      '## Quality Check',
    ])
  })

  await t.test('guides-index template retains the 6 mandatory sections', () => {
    const headings = templateContracts.TEMPLATE_CONTRACTS['guides-index-template.md']
    assert.deepEqual(headings, [
      '## Overview',
      '## Thinking Triggers',
      '## Pre-Modification Rule',
      '## Guides Catalog',
      '## How to Use This Directory',
      '## Contributing',
    ])
  })

  await t.test('canonical templates physically contain the required headings verbatim', () => {
    for (const [file, expected] of Object.entries(templateContracts.TEMPLATE_CONTRACTS)) {
      const full = path.join(templateContracts.KNOWLEDGE_TEMPLATES_DIR, file)
      assert.equal(fs.existsSync(full), true, `missing ${file}`)
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/).map((l) => l.trim())
      for (const heading of expected) {
        assert.ok(lines.includes(heading), `${file} missing heading: ${heading}`)
      }
    }
  })

  await t.test('platform parity contract passes on the canonical repo layout', () => {
    const result = platformParity.validatePlatformParity()
    assert.equal(result.ok, true, JSON.stringify(result.errors))
  })

  await t.test('REQUIRED_AGENTS / REQUIRED_AGENT_FIELDS constants stay in sync with platform-parity spec', () => {
    // 9 个必须支持的 agents：与 core/specs/platform-parity.md 的清单逐字对齐。
    const expected = [
      'antigravity', 'claude-code', 'codex', 'cursor', 'droid',
      'gemini-cli', 'github-copilot', 'opencode', 'qoder',
    ]
    assert.deepEqual([...platformParity.REQUIRED_AGENTS].sort(), [...expected].sort(),
      'REQUIRED_AGENTS drift from platform-parity.md — docs or constants must be updated together')
    // 5 个必填字段也不能悄悄变动。
    assert.deepEqual(
      [...platformParity.REQUIRED_AGENT_FIELDS].sort(),
      ['detectInstalled', 'displayName', 'globalSkillsDir', 'name', 'skillsDir'].sort()
    )
  })

  await t.test('platform parity validator reports every required agent in agentNames', () => {
    // 真正的负路径（删 agent / 清字段）需要改 lib/agents.js 本身，风险高不做。
    // 这里做最小正路径断言：validator 的输出里必须能看到每个 REQUIRED_AGENTS 条目；
    // 如果 lib/agents.js 少登记一个，result.errors 会冒出对应错误。
    const result = platformParity.validatePlatformParity()
    for (const agent of platformParity.REQUIRED_AGENTS) {
      assert.ok(result.agentNames.includes(agent), `expected agent ${agent} in agents map`)
    }
    // 并且 errors 里不能有"lib/agents.js 缺少必须支持的 agent"之类的致命条目。
    const fatalAgentErrors = result.errors.filter((e) => /lib\/agents\.js 缺少必须支持的 agent/.test(e))
    assert.deepEqual(fatalAgentErrors, [])
  })

  await t.test('knowledge canonical layout has {pkg}/{layer} + shared guides/ contract', () => {
    // The canonical bootstrap produces this shape; we assert the layer-index template hints at it.
    const layerIndexContent = fs.readFileSync(
      path.join(templateContracts.KNOWLEDGE_TEMPLATES_DIR, 'layer-index-template.md'),
      'utf8'
    )
    assert.match(layerIndexContent, /\.\.\/\.\.\/guides\/index\.md/)
    const indexContent = fs.readFileSync(
      path.join(templateContracts.KNOWLEDGE_TEMPLATES_DIR, 'index-template.md'),
      'utf8'
    )
    assert.match(indexContent, /\{package\}\/\{layer\}\/index\.md/)
    assert.match(indexContent, /guides\/index\.md/)
  })
})
