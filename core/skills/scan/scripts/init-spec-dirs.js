#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const INDEX_TEMPLATE = `# {layer} 层规范

## Pre-Development Checklist

在修改 {layer} 层代码前，请确认：

- [ ] 阅读了相关的 [思维指南](../guides/index.md)
- [ ] 了解了项目的错误处理模式
- [ ] 检查了可复用的现有组件

## 规范文件

| 文件 | 说明 |
|------|------|
| *(待补充)* | 随项目演进添加 |

## Quality Check

完成修改后，请确认：

- [ ] 代码风格与项目现有代码一致
- [ ] 错误处理遵循项目约定
- [ ] 有适当的测试覆盖
`

const GUIDES_INDEX_NOTE = `
## 思维指南

本项目的思维指南位于 \`guides/\` 目录：

- [代码复用检查清单](./guides/code-reuse-checklist.md)
- [跨层检查清单](./guides/cross-layer-checklist.md)
- [AI 审查误报指南](./guides/ai-review-false-positive-guide.md)
`

const ROOT_INDEX_TEMPLATE = `# 项目规范索引

> 此目录包含项目级编码规范和思维指南。
> AI 在执行任务前应阅读相关层的规范文件。

## 层级规范

{layers_table}

{guides_note}

## 维护说明

- 发现新的编码模式时，更新对应层的规范文件
- 使用 \`/update-spec\` 或手动编辑持久化新规范
- 规范文件应提交到 Git，确保团队共享
`

const STACK_LAYERS = {
  react: ['frontend', 'shared'],
  vue: ['frontend', 'shared'],
  angular: ['frontend', 'shared'],
  next: ['frontend', 'backend', 'shared'],
  nuxt: ['frontend', 'backend', 'shared'],
  express: ['backend', 'shared'],
  fastapi: ['backend', 'shared'],
  django: ['backend', 'shared'],
  flask: ['backend', 'shared'],
  spring: ['backend', 'shared'],
  nest: ['backend', 'shared'],
  electron: ['frontend', 'backend', 'shared'],
  'react-native': ['frontend', 'shared'],
  flutter: ['frontend', 'shared'],
}

function detectLayers(projectConfig = {}) {
  const layers = new Set()
  const frameworks = Array.isArray(projectConfig.frameworks) ? projectConfig.frameworks : []
  for (const fw of frameworks) {
    const name = typeof fw === 'string' ? fw.toLowerCase() : String((fw || {}).name || '').toLowerCase()
    for (const [key, layerList] of Object.entries(STACK_LAYERS)) {
      if (name.includes(key)) layerList.forEach((layer) => layers.add(layer))
    }
  }

  const languages = Array.isArray(projectConfig.languages) ? projectConfig.languages : []
  for (const lang of languages) {
    const name = typeof lang === 'string' ? lang.toLowerCase() : String((lang || {}).name || '').toLowerCase()
    if (['python', 'java', 'go', 'rust', 'c#'].includes(name)) layers.add('backend')
    if (['typescript', 'javascript'].includes(name) && layers.size === 0) {
      ;['frontend', 'backend', 'shared'].forEach((layer) => layers.add(layer))
    }
  }

  if (layers.size === 0) {
    layers.add('backend')
    layers.add('shared')
  }

  return [...layers].sort()
}

function initSpecDirs(projectRoot, layers = null, force = false) {
  const specsDir = path.join(projectRoot, '.claude', 'specs')
  const result = { created: [], skipped: [], layers: [] }

  let resolvedLayers = layers
  if (!resolvedLayers || resolvedLayers.length === 0) {
    const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      resolvedLayers = detectLayers(config)
    } else {
      resolvedLayers = ['backend', 'shared']
    }
  }

  result.layers = resolvedLayers

  for (const layer of resolvedLayers) {
    const layerDir = path.join(specsDir, layer)
    const indexFile = path.join(layerDir, 'index.md')
    if (fs.existsSync(indexFile) && !force) {
      result.skipped.push(path.relative(projectRoot, indexFile))
      continue
    }
    fs.mkdirSync(layerDir, { recursive: true })
    fs.writeFileSync(indexFile, INDEX_TEMPLATE.replaceAll('{layer}', layer))
    result.created.push(path.relative(projectRoot, indexFile))
  }

  const rootIndex = path.join(specsDir, 'index.md')
  if (!fs.existsSync(rootIndex) || force) {
    let layersTable = '| 层 | 路径 |\n|---|------|\n'
    for (const layer of resolvedLayers) {
      layersTable += `| ${layer} | [${layer}/index.md](./${layer}/index.md) |\n`
    }
    fs.mkdirSync(specsDir, { recursive: true })
    fs.writeFileSync(rootIndex, ROOT_INDEX_TEMPLATE.replace('{layers_table}', layersTable).replace('{guides_note}', GUIDES_INDEX_NOTE))
    result.created.push(path.relative(projectRoot, rootIndex))
  }

  return result
}

function main() {
  const args = [...process.argv.slice(2)]
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : null
  }
  const projectRoot = option('--project-root')
  if (!projectRoot) {
    process.stderr.write('Usage: node init-spec-dirs.js --project-root /path/to/project [--layers a,b] [--force]\n')
    process.exitCode = 1
    return
  }
  const layers = option('--layers') ? option('--layers').split(',').map((item) => item.trim()).filter(Boolean) : null
  const result = initSpecDirs(projectRoot, layers, args.includes('--force'))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

module.exports = {
  INDEX_TEMPLATE,
  GUIDES_INDEX_NOTE,
  ROOT_INDEX_TEMPLATE,
  STACK_LAYERS,
  detectLayers,
  initSpecDirs,
}

if (require.main === module) main()
