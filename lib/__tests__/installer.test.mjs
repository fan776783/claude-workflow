import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const installer = require('../installer.js')
const { agents, getAgentHooksFile, getAgentManagedDir } = require('../agents.js')

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..')
const CORE_ROOT = path.join(REPO_ROOT, 'core')

async function withTempDir(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inst-'))
  try {
    return await fn(tmp)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

test('exports: 主入口函数齐全', () => {
  for (const fn of [
    'installForAgents',
    'installToCanonical',
    'linkToAgents',
    'createSymlink',
    'getInstallationStatus',
  ]) {
    assert.equal(typeof installer[fn], 'function', `${fn} 应为 function`)
  }
})

test('常量：MANAGED_DIRS / TEMPLATE_DIRS / SKILLS_DIR / MANAGED_NAMESPACE_DIR', () => {
  assert.deepEqual(installer.MANAGED_DIRS, ['hooks', 'specs', 'utils'])
  assert.ok(installer.TEMPLATE_DIRS.includes('skills'))
  assert.equal(installer.SKILLS_DIR, 'skills')
  assert.equal(installer.MANAGED_NAMESPACE_DIR, '.agent-workflow')
})

test('createSymlink: 正常创建', async () => {
  await withTempDir(async (tmp) => {
    const target = path.join(tmp, 'target-dir')
    const link = path.join(tmp, 'link-dir')
    await fs.mkdir(target)
    const r = await installer.createSymlink(target, link, false)
    assert.equal(r.success, true)
    const stat = await fs.lstat(link)
    assert.equal(stat.isSymbolicLink(), true)
  })
})

test('createSymlink: 已存在同向 symlink 应幂等', async () => {
  await withTempDir(async (tmp) => {
    const target = path.join(tmp, 'target')
    const link = path.join(tmp, 'link')
    await fs.mkdir(target)
    await installer.createSymlink(target, link, false)
    const r2 = await installer.createSymlink(target, link, false)
    assert.equal(r2.success, true)
  })
})

test('installForAgents: 装到临时 cwd，cursor agent 落出 skills/commands/hooks.json', async () => {
  await withTempDir(async (tmp) => {
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['cursor'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0, `errors: ${JSON.stringify(result.errors)}`)
    assert.ok(result.canonicalDir)
    // canonical 存在
    assert.ok(await fs.stat(result.canonicalDir).then(s => s.isDirectory()))
    // cursor agentBaseDir 下 skills 应至少有几个 skill 目录
    const cursorBase = path.join(tmp, '.cursor')
    const skillsDir = path.join(cursorBase, 'skills')
    const skillEntries = await fs.readdir(skillsDir)
    assert.ok(skillEntries.length > 0, `skills 目录为空: ${skillsDir}`)
    // managed namespace 下 hooks/specs/utils
    const managedDir = path.join(cursorBase, '.agent-workflow')
    for (const sub of ['hooks', 'specs', 'utils']) {
      const stat = await fs.lstat(path.join(managedDir, sub))
      assert.ok(stat.isSymbolicLink() || stat.isDirectory(), `${sub} 应存在`)
    }
    // hooks.json 已派发
    const hooksFile = path.join(cursorBase, 'hooks.json')
    const hooksRaw = await fs.readFile(hooksFile, 'utf8')
    const hooksJson = JSON.parse(hooksRaw)
    assert.ok(hooksJson.hooks.sessionStart, 'cursor hooks.json 缺 sessionStart')
    assert.ok(hooksJson.hooks.preToolUse, 'cursor hooks.json 缺 preToolUse')
    assert.ok(hooksJson.hooks.beforeShellExecution, 'cursor hooks.json 缺 beforeShellExecution')
    // 模板变量已替换
    assert.equal(/\{\{HOOKS_DIR\}\}/.test(hooksRaw), false, 'HOOKS_DIR 占位符未替换')
    // 替换后命令含绝对路径指向 managedDir 下 hooks
    assert.ok(hooksRaw.includes(path.join(managedDir, 'hooks')), 'hooks.json 未指向 managedDir/hooks')
  })
})

test('installForAgents: codex 派发 .codex/hooks/hooks.json', async () => {
  await withTempDir(async (tmp) => {
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['codex'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0)
    const hooksFile = path.join(tmp, '.codex', 'hooks', 'hooks.json')
    const json = JSON.parse(await fs.readFile(hooksFile, 'utf8'))
    assert.ok(json.hooks.UserPromptSubmit, 'codex hooks.json 缺 UserPromptSubmit')
  })
})

test('installForAgents: copilot 派发 .github/copilot/hooks.json，含 bash+powershell 双命令', async () => {
  await withTempDir(async (tmp) => {
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['github-copilot'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0)
    const hooksFile = path.join(tmp, '.github', 'copilot', 'hooks.json')
    const json = JSON.parse(await fs.readFile(hooksFile, 'utf8'))
    assert.ok(json.hooks.SessionStart)
    const ups = json.hooks.userPromptSubmitted[0]
    assert.ok(ups.bash, 'copilot 缺 bash 命令分支')
    assert.ok(ups.powershell, 'copilot 缺 powershell 命令分支')
  })
})

test('installForAgents: 不支持 hooks 的 agent（gemini-cli）不报错也不派发 hooks.json', async () => {
  await withTempDir(async (tmp) => {
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['gemini-cli'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0)
    // gemini 没声明 hooksFile，应无任何 hooks.json
    const exists = await fs.access(path.join(tmp, '.gemini', 'hooks.json')).then(() => true).catch(() => false)
    assert.equal(exists, false)
  })
})

test('installForAgents: 未知 agent 不抛但标 unknown', async () => {
  await withTempDir(async (tmp) => {
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['nonexistent-agent'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    const r = result.agents['nonexistent-agent']
    assert.equal(r.success, false)
    assert.match(r.error, /Unknown/)
  })
})

test('installForAgents: 第二次安装幂等（不报错且 hooks.json 仍正确）', async () => {
  await withTempDir(async (tmp) => {
    const first = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['cursor'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(first.errors.length, 0)
    const second = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['cursor'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(second.errors.length, 0)
    const json = JSON.parse(await fs.readFile(path.join(tmp, '.cursor', 'hooks.json'), 'utf8'))
    assert.ok(json.hooks.sessionStart)
  })
})

test('agents 配置：cursor / codex / github-copilot 均声明 hooksFile + hooksTemplate', () => {
  for (const name of ['cursor', 'codex', 'github-copilot']) {
    const agent = agents[name]
    assert.ok(agent.hooksFile, `${name} 缺 hooksFile`)
    assert.ok(agent.globalHooksFile, `${name} 缺 globalHooksFile`)
    assert.ok(agent.hooksTemplate, `${name} 缺 hooksTemplate`)
    // 模板文件确实存在
    const templatePath = path.join(CORE_ROOT, 'hooks', 'agent-templates', agent.hooksTemplate)
    fs.access(templatePath).catch(() => {
      throw new Error(`${name} hooksTemplate 文件不存在: ${templatePath}`)
    })
  }
})

test('getAgentHooksFile: 不支持 hooks 的 agent 返回 null', () => {
  assert.equal(getAgentHooksFile('gemini-cli', false, '/tmp'), null)
  assert.equal(getAgentHooksFile('antigravity', false, '/tmp'), null)
})
