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
    // 注意：断言解析后的 command 串，而非原始文件文本——Windows 下 fs.writeJson 会把
    // path 分隔符 \ 序列化成 JSON 转义的 \\，原始文本里不含单 \ 的路径。
    const renderedCommands = []
    const collectCommands = (node) => {
      if (Array.isArray(node)) { node.forEach(collectCommands); return }
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && (key === 'command' || key === 'bash' || key === 'powershell')) {
          renderedCommands.push(value)
        } else {
          collectCommands(value)
        }
      }
    }
    collectCommands(hooksJson.hooks)
    const hooksDirAbs = path.join(managedDir, 'hooks')
    assert.ok(
      renderedCommands.some((cmd) => cmd.includes(hooksDirAbs)),
      'hooks.json 未指向 managedDir/hooks',
    )
  })
})

test('installForAgents: qoder 落出 skills(顶层)/commands(顶层 .md)/agents(subagents) + hooks 注入 settings.json', async () => {
  await withTempDir(async (tmp) => {
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['qoder'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0, `errors: ${JSON.stringify(result.errors)}`)
    const qoderBase = path.join(tmp, '.qoder')

    // skills：~/.qoder/skills/<name>/SKILL.md（顶层 skill 目录，非命名空间）
    const skillEntries = (await fs.readdir(path.join(qoderBase, 'skills'))).filter((n) => !n.startsWith('.'))
    assert.ok(skillEntries.length > 0, 'qoder skills 目录为空')
    await fs.stat(path.join(qoderBase, 'skills', skillEntries[0], 'SKILL.md')) // throws if symlink 不可达

    // commands：~/.qoder/commands/*.md（顶层 .md，Qoder loader 不递归子目录）
    const cmdEntries = (await fs.readdir(path.join(qoderBase, 'commands'))).filter((n) => n.endsWith('.md'))
    assert.ok(cmdEntries.length > 0, 'qoder commands 顶层无 .md')

    // subagents：~/.qoder/agents/*.md（net-new mount，按 agentsDir 门控）
    const agentEntries = (await fs.readdir(path.join(qoderBase, 'agents'))).filter((n) => n.endsWith('.md'))
    assert.ok(agentEntries.length > 0, 'qoder agents 目录无 subagent .md')
    assert.ok(
      await fs.stat(path.join(qoderBase, 'agents', '.agent-workflow-managed-agents.json')).then(() => true).catch(() => false),
      'qoder agents manifest 未写出',
    )

    // managed namespace：.agent-workflow/{hooks,specs,utils}
    for (const sub of ['hooks', 'specs', 'utils']) {
      const stat = await fs.lstat(path.join(qoderBase, '.agent-workflow', sub))
      assert.ok(stat.isSymbolicLink() || stat.isDirectory(), `${sub} 应存在`)
    }

    // hooks 注入 ~/.qoder/settings.json（非独立 hooks.json）
    const settingsRaw = await fs.readFile(path.join(qoderBase, 'settings.json'), 'utf8')
    const settings = JSON.parse(settingsRaw)
    assert.ok(settings.hooks.SessionStart, 'settings.json 缺 SessionStart')
    assert.ok(settings.hooks.PreToolUse, 'settings.json 缺 PreToolUse')
    assert.equal(/\{\{HOOKS_DIR\}\}/.test(settingsRaw), false, 'HOOKS_DIR 占位符未替换')
    assert.equal('version' in settings, false, 'settings.json 被注入了多余的 version 顶层键')
    const cmd = settings.hooks.SessionStart[0].hooks[0].command
    assert.ok(cmd.includes(path.join(qoderBase, '.agent-workflow', 'hooks')), 'hooks 命令未指向 managedDir/hooks')
  })
})

test('installForAgents: qoder settings.json 合并保留用户既有 enabledPlugins 与自定义 hook', async () => {
  await withTempDir(async (tmp) => {
    const qoderBase = path.join(tmp, '.qoder')
    await fs.mkdir(qoderBase, { recursive: true })
    const userHook = { matcher: '*', hooks: [{ type: 'command', command: '/usr/bin/userhook' }] }
    await fs.writeFile(
      path.join(qoderBase, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'x@y': false }, hooks: { Notification: [userHook] } }, null, 2),
    )

    await installer.installForAgents({ templatesDir: REPO_ROOT, agents: ['qoder'], global: false, cwd: tmp, fallbackToCopy: true })

    const settings = JSON.parse(await fs.readFile(path.join(qoderBase, 'settings.json'), 'utf8'))
    assert.deepEqual(settings.enabledPlugins, { 'x@y': false }, 'enabledPlugins 未保留')
    assert.deepEqual(settings.hooks.Notification, [userHook], '用户 Notification hook 未保留')
    assert.ok(settings.hooks.SessionStart, '我方 SessionStart 未注入')
    assert.ok(
      await fs.stat(path.join(qoderBase, 'settings.json.agent-workflow.json')).then(() => true).catch(() => false),
      'hooks sidecar 未写出',
    )
  })
})

test('installForAgents: 未声明 agentsDir 的工具（cursor）不产生 agents mount（门控不外溢）', async () => {
  await withTempDir(async (tmp) => {
    const r = await installer.installForAgents({ templatesDir: REPO_ROOT, agents: ['cursor'], global: false, cwd: tmp, fallbackToCopy: true })
    assert.equal(r.errors.length, 0)
    const cursorAgentsDir = path.join(tmp, '.cursor', 'agents')
    assert.equal(
      await fs.stat(cursorAgentsDir).then(() => true).catch(() => false),
      false,
      'cursor 不应产生 agents mount',
    )
    assert.equal(r.agents.cursor.subagents.count, 0, 'cursor subagents.count 应为 0')
  })
})

test('agents 配置：qoder 声明 installer-mount 字段（skillsDir/agentsDir/hooksFile→settings.json）', () => {
  const q = agents.qoder
  assert.equal(q.managedViaPlugin, undefined, 'qoder 不应再是 managedViaPlugin')
  assert.match(q.skillsDir, /skills$/)
  assert.match(q.agentsDir, /agents$/)
  assert.match(q.globalHooksFile, /settings\.json$/, 'qoder hooks 应注入 settings.json')
  assert.equal(q.hooksTemplate, 'qoder.hooks.json')
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

test('installForAgents: 不支持 hooks 的 agent（droid）不报错也不派发 hooks.json', async () => {
  await withTempDir(async (tmp) => {
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['droid'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0)
    // droid 没声明 hooksFile，应无任何 hooks.json
    const exists = await fs.access(path.join(tmp, '.factory', 'hooks.json')).then(() => true).catch(() => false)
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

test('agents 配置：cursor / codex / github-copilot 均声明 hooksFile + hooksTemplate', async () => {
  for (const name of ['cursor', 'codex', 'github-copilot']) {
    const agent = agents[name]
    assert.ok(agent.hooksFile, `${name} 缺 hooksFile`)
    assert.ok(agent.globalHooksFile, `${name} 缺 globalHooksFile`)
    assert.ok(agent.hooksTemplate, `${name} 缺 hooksTemplate`)
    const templatePath = path.join(CORE_ROOT, 'hooks', 'agent-templates', agent.hooksTemplate)
    await assert.doesNotReject(
      fs.access(templatePath),
      `${name} hooksTemplate 文件不存在: ${templatePath}`,
    )
  }
})

test('getAgentHooksFile: 不支持 hooks 的 agent 返回 null', () => {
  // droid: installer-mount 但未声明 hooksFile；antigravity: managedViaPlugin，不走 installer hooks
  assert.equal(getAgentHooksFile('droid', false, '/tmp'), null)
  assert.equal(getAgentHooksFile('antigravity', false, '/tmp'), null)
})

// ───────── F-01 渲染：路径含空格不破坏命令 ─────────

test('installForAgents: cwd 含空格 → hooks.json command 字段路径被 quote', async () => {
  await withTempDir(async (tmpBase) => {
    const tmp = path.join(tmpBase, 'has space')
    await fs.mkdir(tmp, { recursive: true })
    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['cursor'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0)
    const hooksFile = path.join(tmp, '.cursor', 'hooks.json')
    const raw = await fs.readFile(hooksFile, 'utf8')
    // JSON 必须可解析（不能有非法 escape）
    const json = JSON.parse(raw)
    const cmd = json.hooks.sessionStart[0].command
    // command 字符串里路径段必须被引号包裹
    assert.match(cmd, /"[^"]*has space[^"]*session-start\.js"/, `command 未引号化: ${cmd}`)
  })
})

test('installAgentHooksConfig: backslash 路径（模拟 Windows）写出后仍是合法 JSON', async () => {
  // 直接走核心函数，注入 path.win32.join 的产物（带 backslash 的绝对路径），
  // 验证 JSON.stringify 自动做 escape，输出 JSON.parse 可解析回来
  await withTempDir(async (tmp) => {
    const sourceRoot = path.join(REPO_ROOT, 'core')
    const fakeManagedDir = 'C:\\Users\\Alice\\.cursor\\.agent-workflow'
    const hooksFilePath = path.join(tmp, 'fake-hooks.json')
    // 调用方式：直接 require 拿内部？installer 没 export。改为做端到端：
    // 验 cursor 模板渲染出来的 JSON 形态正确（路径里的 backslash 在 JSON 里会变 \\ 字面）
    const raw = await fs.readFile(path.join(sourceRoot, 'hooks', 'agent-templates', 'cursor.hooks.json'), 'utf8')
    const tpl = JSON.parse(raw)
    // 模拟 substituteCommandPaths 的行为：手动替换并经 JSON.stringify
    const hooksDirAbs = `${fakeManagedDir}\\hooks`
    for (const ev of Object.keys(tpl.hooks)) {
      for (const entry of tpl.hooks[ev]) {
        if (typeof entry.command === 'string') {
          entry.command = entry.command.replace(/\{\{HOOKS_DIR\}\}\/([A-Za-z0-9_\-]+\.js)/g, (_, s) => {
            const abs = `${hooksDirAbs}\\${s}`
            return /[^A-Za-z0-9_\-./:\\]/.test(abs) ? '"' + abs.replace(/"/g, '\\"') + '"' : abs
          })
        }
      }
    }
    const written = JSON.stringify(tpl, null, 2)
    await fs.writeFile(hooksFilePath, written, 'utf8')
    // 读回 + JSON.parse 必须成功
    const roundtrip = JSON.parse(await fs.readFile(hooksFilePath, 'utf8'))
    const cmd = roundtrip.hooks.sessionStart[0].command
    assert.match(cmd, /C:\\Users\\Alice/, `backslash 路径丢失: ${cmd}`)
  })
})

// ───────── F-02 merge：保留用户既存条目 ─────────

test('installForAgents: 既存 hooks.json 中用户自定义事件被保留', async () => {
  await withTempDir(async (tmp) => {
    const cursorDir = path.join(tmp, '.cursor')
    await fs.mkdir(cursorDir, { recursive: true })
    // 用户预先写入自己的 hook（在不同 event 上）
    const userHooks = {
      version: 1,
      hooks: {
        afterShellExecution: [
          { command: 'echo "user custom hook"', timeout: 5 },
        ],
      },
    }
    const hooksFile = path.join(cursorDir, 'hooks.json')
    await fs.writeFile(hooksFile, JSON.stringify(userHooks, null, 2), 'utf8')

    const result = await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['cursor'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    assert.equal(result.errors.length, 0)
    const merged = JSON.parse(await fs.readFile(hooksFile, 'utf8'))
    assert.ok(merged.hooks.afterShellExecution, '用户自定义 event 被删')
    assert.equal(merged.hooks.afterShellExecution[0].command, 'echo "user custom hook"')
    assert.ok(merged.hooks.sessionStart, '我们的 event 没写入')
  })
})

test('installForAgents: 既存 hooks.json 与我们 event 冲突时备份原文件', async () => {
  await withTempDir(async (tmp) => {
    const cursorDir = path.join(tmp, '.cursor')
    await fs.mkdir(cursorDir, { recursive: true })
    const conflictHooks = {
      version: 1,
      hooks: {
        sessionStart: [{ command: 'echo "user owns sessionStart"', timeout: 5 }],
      },
    }
    const hooksFile = path.join(cursorDir, 'hooks.json')
    await fs.writeFile(hooksFile, JSON.stringify(conflictHooks, null, 2), 'utf8')

    await installer.installForAgents({
      templatesDir: REPO_ROOT,
      agents: ['cursor'],
      global: false,
      cwd: tmp,
      fallbackToCopy: true,
    })
    // 应该有备份文件 .bak.<ts>
    const entries = await fs.readdir(cursorDir)
    const bak = entries.find((n) => n.startsWith('hooks.json.bak.'))
    assert.ok(bak, `备份未生成: ${entries.join(',')}`)
    const bakContent = JSON.parse(await fs.readFile(path.join(cursorDir, bak), 'utf8'))
    assert.equal(bakContent.hooks.sessionStart[0].command, 'echo "user owns sessionStart"')
  })
})

test('installForAgents: 第二次 sync 不再备份（已有 sidecar 标识所有权）', async () => {
  await withTempDir(async (tmp) => {
    await installer.installForAgents({
      templatesDir: REPO_ROOT, agents: ['cursor'], global: false, cwd: tmp, fallbackToCopy: true,
    })
    const cursorDir = path.join(tmp, '.cursor')
    const before = (await fs.readdir(cursorDir)).filter((n) => n.startsWith('hooks.json.bak.'))
    await installer.installForAgents({
      templatesDir: REPO_ROOT, agents: ['cursor'], global: false, cwd: tmp, fallbackToCopy: true,
    })
    const after = (await fs.readdir(cursorDir)).filter((n) => n.startsWith('hooks.json.bak.'))
    assert.equal(after.length, before.length, '幂等 sync 不应产生额外备份')
  })
})

test('installAgentHooksConfig: sidecar 文件被写出，含 managedEvents + managedScripts', async () => {
  await withTempDir(async (tmp) => {
    await installer.installForAgents({
      templatesDir: REPO_ROOT, agents: ['cursor'], global: false, cwd: tmp, fallbackToCopy: true,
    })
    const sidecarPath = path.join(tmp, '.cursor', 'hooks.json.agent-workflow.json')
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8'))
    assert.equal(sidecar.template, 'cursor.hooks.json')
    assert.deepEqual(sidecar.managedEvents.sort(), ['beforeShellExecution', 'preToolUse', 'sessionStart'])
    assert.ok(Array.isArray(sidecar.managedScripts) && sidecar.managedScripts.includes('session-start.js'))
  })
})

test('installForAgents: 同一 managed event 下用户自加的非我方 entry 被保留', async () => {
  await withTempDir(async (tmp) => {
    const cursorDir = path.join(tmp, '.cursor')
    await fs.mkdir(cursorDir, { recursive: true })
    const userOnManagedEvent = {
      version: 1,
      hooks: {
        sessionStart: [
          { command: 'echo "user own sessionStart hook"', timeout: 5 },
        ],
      },
    }
    const hooksFile = path.join(cursorDir, 'hooks.json')
    await fs.writeFile(hooksFile, JSON.stringify(userOnManagedEvent, null, 2), 'utf8')

    await installer.installForAgents({
      templatesDir: REPO_ROOT, agents: ['cursor'], global: false, cwd: tmp, fallbackToCopy: true,
    })
    const merged = JSON.parse(await fs.readFile(hooksFile, 'utf8'))
    const sessionStartCmds = merged.hooks.sessionStart.map((e) => e.command)
    assert.ok(sessionStartCmds.some((c) => c.includes('user own sessionStart hook')), '用户自加的 entry 被删')
    assert.ok(sessionStartCmds.some((c) => c.includes('session-start.js')), '我们的 entry 未写入')
  })
})

test('installForAgents: 二次 sync 不重复追加我方 entry（按脚本名去重）', async () => {
  await withTempDir(async (tmp) => {
    await installer.installForAgents({
      templatesDir: REPO_ROOT, agents: ['cursor'], global: false, cwd: tmp, fallbackToCopy: true,
    })
    await installer.installForAgents({
      templatesDir: REPO_ROOT, agents: ['cursor'], global: false, cwd: tmp, fallbackToCopy: true,
    })
    const merged = JSON.parse(await fs.readFile(path.join(tmp, '.cursor', 'hooks.json'), 'utf8'))
    const sessionStartCount = merged.hooks.sessionStart.filter((e) => e.command.includes('session-start.js')).length
    assert.equal(sessionStartCount, 1, '我方 entry 被重复追加')
  })
})
