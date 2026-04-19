#!/usr/bin/env node

// Platform parity validator：对齐 core/specs/platform-parity.md 的硬契约。
// 读取 lib/agents.js 与 lib/installer.js 的静态配置，检查 canonical 表面与 agent mount 声明之间是否一致。
// 只做静态检查，不触碰真实文件系统以外的东西；所有规则都应该能在 prepublish 阶段稳定运行。

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CORE_DIR = path.resolve(__dirname, '..')
const AGENTS_MODULE_PATH = path.join(REPO_ROOT, 'lib', 'agents.js')
const INSTALLER_MODULE_PATH = path.join(REPO_ROOT, 'lib', 'installer.js')

// 与 platform-parity.md "必须存在的 agents" 清单保持一致。
const REQUIRED_AGENTS = [
  'antigravity',
  'claude-code',
  'codex',
  'cursor',
  'droid',
  'gemini-cli',
  'github-copilot',
  'opencode',
  'qoder',
]

const REQUIRED_AGENT_FIELDS = ['name', 'displayName', 'skillsDir', 'globalSkillsDir', 'detectInstalled']

const INSTALLER_EXPECTED_CONSTANTS = {
  COMMANDS_DIR: 'commands',
  SKILLS_DIR: 'skills',
  MANAGED_NAMESPACE_DIR: '.agent-workflow',
}

const INSTALLER_REQUIRED_TEMPLATE_DIRS = ['agents', 'commands', 'docs', 'hooks', 'skills', 'specs', 'utils']
const INSTALLER_REQUIRED_MANAGED_DIRS = ['docs', 'hooks', 'specs', 'utils']

function listCoreTopLevelDirs() {
  if (!fs.existsSync(CORE_DIR)) return []
  return fs.readdirSync(CORE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function listSkills() {
  const skillsRoot = path.join(CORE_DIR, 'skills')
  if (!fs.existsSync(skillsRoot)) return []
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function listCommandMarkdowns() {
  const commandsRoot = path.join(CORE_DIR, 'commands')
  if (!fs.existsSync(commandsRoot)) return []
  return fs.readdirSync(commandsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}

function loadAgents() {
  delete require.cache[require.resolve(AGENTS_MODULE_PATH)]
  return require(AGENTS_MODULE_PATH)
}

function loadInstaller() {
  delete require.cache[require.resolve(INSTALLER_MODULE_PATH)]
  return require(INSTALLER_MODULE_PATH)
}

function validatePlatformParity() {
  const errors = []
  const warnings = []

  // 1) Agents map 必须覆盖 REQUIRED_AGENTS
  let agentsMod
  try {
    agentsMod = loadAgents()
  } catch (err) {
    return { ok: false, errors: [`无法加载 lib/agents.js: ${err.message}`], warnings }
  }
  const agentMap = agentsMod.agents || {}
  const agentNames = Object.keys(agentMap).sort()
  for (const required of REQUIRED_AGENTS) {
    if (!agentMap[required]) errors.push(`lib/agents.js 缺少必须支持的 agent: ${required}`)
  }

  // 2) 每个 agent 字段必须完整且类型正确
  for (const [name, cfg] of Object.entries(agentMap)) {
    for (const field of REQUIRED_AGENT_FIELDS) {
      if (!(field in cfg) || cfg[field] == null || cfg[field] === '') {
        errors.push(`lib/agents.js[${name}] 缺少必填字段: ${field}`)
        continue
      }
      if (field === 'detectInstalled' && typeof cfg.detectInstalled !== 'function') {
        errors.push(`lib/agents.js[${name}].detectInstalled 必须是函数`)
      }
      if (field === 'skillsDir' && !/skills$/.test(String(cfg.skillsDir))) {
        errors.push(`lib/agents.js[${name}].skillsDir 必须以 "skills" 结尾: ${cfg.skillsDir}`)
      }
      if (field === 'skillsDir' && String(cfg.skillsDir).startsWith('skills')) {
        errors.push(`lib/agents.js[${name}].skillsDir 不得指向 canonical skills 根: ${cfg.skillsDir}`)
      }
    }
  }

  // 3) Installer 常量
  let installerMod
  try {
    installerMod = loadInstaller()
  } catch (err) {
    return { ok: false, errors: errors.concat(`无法加载 lib/installer.js: ${err.message}`), warnings }
  }
  for (const [key, expected] of Object.entries(INSTALLER_EXPECTED_CONSTANTS)) {
    if (installerMod[key] !== expected) {
      errors.push(`lib/installer.js 常量 ${key} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(installerMod[key])}`)
    }
  }

  // 4) TEMPLATE_DIRS / MANAGED_DIRS 必须覆盖 canonical 实际存在的一级目录
  const actualCoreDirs = listCoreTopLevelDirs()
  const installerSource = fs.readFileSync(INSTALLER_MODULE_PATH, 'utf8')
  const templateDirsMatch = installerSource.match(/const TEMPLATE_DIRS\s*=\s*\[([^\]]*)\]/)
  const managedDirsMatch = installerSource.match(/const MANAGED_DIRS\s*=\s*\[([^\]]*)\]/)
  const parseList = (raw) => String(raw || '').split(',').map((x) => x.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean)
  const templateDirs = templateDirsMatch ? parseList(templateDirsMatch[1]) : []
  const managedDirs = managedDirsMatch ? parseList(managedDirsMatch[1]) : []

  for (const required of INSTALLER_REQUIRED_TEMPLATE_DIRS) {
    if (!templateDirs.includes(required)) {
      errors.push(`lib/installer.js TEMPLATE_DIRS 缺少: ${required}`)
    }
  }
  for (const dir of actualCoreDirs) {
    if (!templateDirs.includes(dir)) {
      errors.push(`core/${dir}/ 存在但未在 lib/installer.js TEMPLATE_DIRS 中登记`)
    }
  }
  for (const required of INSTALLER_REQUIRED_MANAGED_DIRS) {
    if (!managedDirs.includes(required)) {
      errors.push(`lib/installer.js MANAGED_DIRS 缺少: ${required}`)
    }
  }
  if (managedDirs.includes('skills') || managedDirs.includes('commands')) {
    errors.push(`lib/installer.js MANAGED_DIRS 不应包含 skills / commands，这两类走单独 mount 路径`)
  }

  // 5) 每个 skill 目录必须含 SKILL.md
  const skills = listSkills()
  for (const skill of skills) {
    const skillPath = path.join(CORE_DIR, 'skills', skill, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      errors.push(`core/skills/${skill}/ 缺少 SKILL.md`)
    }
  }

  // 6) command 与 skill 命名对齐（只做警告）
  const commands = listCommandMarkdowns().map((f) => f.replace(/\.md$/, ''))
  const skillSet = new Set(skills)
  for (const cmd of commands) {
    if (!skillSet.has(cmd)) {
      warnings.push(`core/commands/${cmd}.md 没有对应的 core/skills/${cmd}/`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    agentNames,
    templateDirs,
    managedDirs,
    skills,
    commands,
  }
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  if (!command || command === 'validate') {
    const result = validatePlatformParity()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exitCode = 1
    return
  }
  process.stderr.write('Usage: node platform_parity.js [validate]\n')
  process.exitCode = 1
}

module.exports = {
  REQUIRED_AGENTS,
  REQUIRED_AGENT_FIELDS,
  INSTALLER_EXPECTED_CONSTANTS,
  INSTALLER_REQUIRED_TEMPLATE_DIRS,
  INSTALLER_REQUIRED_MANAGED_DIRS,
  validatePlatformParity,
}

if (require.main === module) main()
