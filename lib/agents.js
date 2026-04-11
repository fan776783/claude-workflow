/**
 * Agent 配置模块
 * 定义支持的 AI 编码工具及其配置
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const home = os.homedir();
const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const CANONICAL_DIR_NAME = 'agent-workflow';
const LOG_PREFIX = '[agent-workflow]';
const COMMANDS_DIR = 'commands';
const SKILLS_DIR = 'skills';
const AGENTS_DIR = 'agents';
const MANAGED_NAMESPACE_DIR = '.agent-workflow';

// 我们安装的目录，检测时需要排除
const OUR_INSTALLED_DIRS = [SKILLS_DIR, MANAGED_NAMESPACE_DIR];

/**
 * 检查目录是否有除了我们安装的内容之外的文件
 * 用于判断 Agent 是否真正安装
 */
function hasOtherContent(dirPath, ignoredEntries = OUR_INSTALLED_DIRS) {
  if (!fs.existsSync(dirPath)) return false;

  try {
    const entries = fs.readdirSync(dirPath);
    const otherEntries = entries.filter(entry => {
      if (ignoredEntries.includes(entry)) return false;
      if (entry === '.DS_Store') return false;
      return true;
    });
    return otherEntries.length > 0;
  } catch {
    return false;
  }
}

/**
 * 检查特定文件是否存在
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * 支持的 Agent 配置
 * @type {Object.<string, AgentConfig>}
 */
const agents = {
  antigravity: {
    name: 'antigravity',
    displayName: 'Antigravity',
    skillsDir: '.agent/skills',
    globalSkillsDir: path.join(home, '.gemini', 'antigravity', 'skills'),
    detectInstalled: () => hasOtherContent(path.join(home, '.gemini', 'antigravity')),
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    agentsDir: '.claude/agents',
    globalSkillsDir: path.join(claudeHome, 'skills'),
    globalAgentsDir: path.join(claudeHome, 'agents'),
    detectInstalled: () => {
      return fileExists(path.join(claudeHome, 'settings.json'))
        || fileExists(path.join(claudeHome, 'settings.local.json'))
        || fileExists(path.join(claudeHome, 'projects'))
        || hasOtherContent(claudeHome, [...OUR_INSTALLED_DIRS, AGENTS_DIR]);
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.codex/skills',
    globalSkillsDir: path.join(codexHome, 'skills'),
    detectInstalled: () => {
      return fileExists(path.join(codexHome, '.codex-global-state.json'))
        || fileExists(path.join(codexHome, 'instructions.md'))
        || hasOtherContent(codexHome);
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.cursor/skills',
    globalSkillsDir: path.join(home, '.cursor', 'skills'),
    detectInstalled: () => {
      const cursorDir = path.join(home, '.cursor');
      return fileExists(path.join(cursorDir, 'argv.json'))
        || fileExists(path.join(cursorDir, 'extensions'))
        || hasOtherContent(cursorDir);
    },
  },
  droid: {
    name: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: path.join(home, '.factory', 'skills'),
    detectInstalled: () => {
      const factoryDir = path.join(home, '.factory');
      return fileExists(path.join(factoryDir, 'auth.encrypted'))
        || fileExists(path.join(factoryDir, 'artifacts'))
        || hasOtherContent(factoryDir);
    },
  },
  'gemini-cli': {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.gemini/skills',
    globalSkillsDir: path.join(home, '.gemini', 'skills'),
    detectInstalled: () => {
      const geminiDir = path.join(home, '.gemini');
      return fileExists(path.join(geminiDir, 'GEMINI.md'))
        || fileExists(path.join(geminiDir, '.env'))
        || fileExists(path.join(geminiDir, 'settings.json'));
    },
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.github/skills',
    globalSkillsDir: path.join(home, '.copilot', 'skills'),
    detectInstalled: () => hasOtherContent(path.join(home, '.copilot')),
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.opencode/skills',
    globalSkillsDir: path.join(configHome, 'opencode', 'skills'),
    detectInstalled: () => {
      const opencodeDir = path.join(configHome, 'opencode');
      return fileExists(path.join(opencodeDir, 'config.json'))
        || fileExists(path.join(opencodeDir, 'bun.lock'))
        || hasOtherContent(opencodeDir);
    },
  },
  qoder: {
    name: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: path.join(home, '.qoder', 'skills'),
    detectInstalled: () => hasOtherContent(path.join(home, '.qoder')),
  },
};

/**
 * 检测已安装的 Agent
 * @returns {string[]} 已安装的 Agent 名称列表
 */
function detectInstalledAgents() {
  return Object.entries(agents)
    .filter(([_, config]) => config.detectInstalled())
    .map(([name]) => name);
}

/**
 * 获取 canonical 目录路径
 * @param {boolean} global - 是否为全局安装
 * @param {string} cwd - 当前工作目录（项目级安装时使用）
 * @returns {string} canonical 目录路径
 */
function getCanonicalDir(global = true, cwd = process.cwd()) {
  const baseDir = global ? home : cwd;
  return path.join(baseDir, '.agents', CANONICAL_DIR_NAME);
}

/**
 * 获取 Agent 根目录路径
 * @param {string} agentName - Agent 名称
 * @param {boolean} global - 是否为全局安装
 * @param {string} cwd - 当前工作目录
 * @returns {string|null} Agent 根目录路径
 */
function getAgentBaseDir(agentName, global = true, cwd = process.cwd()) {
  const agent = agents[agentName];
  if (!agent) return null;

  if (global) {
    return path.dirname(agent.globalSkillsDir);
  }
  return path.join(cwd, path.dirname(agent.skillsDir));
}

/**
 * 获取 Agent 的 skills 目录路径
 * @param {string} agentName - Agent 名称
 * @param {boolean} global - 是否为全局安装
 * @param {string} cwd - 当前工作目录（项目级安装时使用）
 * @returns {string|null} skills 目录路径，Agent 不存在时返回 null
 */
function getAgentSkillsDir(agentName, global = true, cwd = process.cwd()) {
  const agent = agents[agentName];
  if (!agent) return null;

  if (global) {
    return agent.globalSkillsDir;
  }
  return path.join(cwd, agent.skillsDir);
}

function getAgentCommandsDir(agentName, global = true, cwd = process.cwd()) {
  const agentBaseDir = getAgentBaseDir(agentName, global, cwd);
  if (!agentBaseDir) return null;
  return path.join(agentBaseDir, COMMANDS_DIR);
}

function getAgentCommandNamespaceDir(agentName, global = true, cwd = process.cwd()) {
  // 各 Agent 工具要求命令文件直接放在 commands/ 目录下，不支持子目录嵌套。
  // 每个 Agent 已有自己的命名空间隔离（~/.claude/、~/.cursor/ 等），无需再在 commands 下做二级隔离。
  return getAgentCommandsDir(agentName, global, cwd);
}

function getAgentManagedDir(agentName, global = true, cwd = process.cwd()) {
  const agentBaseDir = getAgentBaseDir(agentName, global, cwd);
  if (!agentBaseDir) return null;
  return path.join(agentBaseDir, MANAGED_NAMESPACE_DIR);
}

function getAgentManagedSubdir(agentName, subdir, global = true, cwd = process.cwd()) {
  const managedDir = getAgentManagedDir(agentName, global, cwd);
  if (!managedDir) return null;
  return path.join(managedDir, subdir);
}

/**
 * 获取 Agent 某个目录的路径
 * @param {string} agentName - Agent 名称
 * @param {string} dirName - 目录名
 * @param {boolean} global - 是否为全局安装
 * @param {string} cwd - 当前工作目录
 * @returns {string|null} 目录路径
 */
function getAgentDirPath(agentName, dirName, global = true, cwd = process.cwd()) {
  const agentBaseDir = getAgentBaseDir(agentName, global, cwd);
  if (!agentBaseDir) return null;
  return path.join(agentBaseDir, dirName);
}

/**
 * 获取所有支持的 Agent 名称
 * @returns {string[]} Agent 名称列表
 */
function getAllAgentNames() {
  return Object.keys(agents);
}

/**
 * 获取 Agent 配置
 * @param {string} agentName - Agent 名称
 * @returns {AgentConfig|null} Agent 配置，不存在时返回 null
 */
function getAgentConfig(agentName) {
  return agents[agentName] || null;
}

/**
 * 解析 Agent 参数
 * 支持: 单个名称、逗号分隔列表、'*' 表示全部、'detected' 表示已检测到的
 * @param {string} agentArg - Agent 参数
 * @returns {string[]} Agent 名称列表
 */
function parseAgentArg(agentArg) {
  if (!agentArg) {
    return detectInstalledAgents();
  }

  if (agentArg === '*') {
    return getAllAgentNames();
  }

  if (agentArg === 'detected') {
    return detectInstalledAgents();
  }

  const names = agentArg.split(',').map(s => s.trim()).filter(Boolean);
  const validNames = names.filter(name => agents[name]);
  const invalidNames = names.filter(name => !agents[name]);

  if (invalidNames.length > 0) {
    console.warn(`${LOG_PREFIX} 未知的 Agent: ${invalidNames.join(', ')}`);
  }

  return validNames;
}

/**
 * 获取 Agent 的 subagents 目录路径（仅 claude-code 支持）
 * @param {string} agentName - Agent 名称
 * @param {boolean} global - 是否为全局安装
 * @param {string} cwd - 当前工作目录
 * @returns {string|null} subagents 目录路径
 */
function getAgentSubagentsDir(agentName, global = true, cwd = process.cwd()) {
  const agent = agents[agentName];
  if (!agent || !agent.agentsDir) return null;

  if (global) {
    return agent.globalAgentsDir || null;
  }
  return path.join(cwd, agent.agentsDir);
}

module.exports = {
  agents,
  COMMANDS_DIR,
  SKILLS_DIR,
  MANAGED_NAMESPACE_DIR,
  detectInstalledAgents,
  getCanonicalDir,
  getAgentBaseDir,
  getAgentDirPath,
  getAgentSkillsDir,
  getAgentCommandsDir,
  getAgentCommandNamespaceDir,
  getAgentManagedDir,
  getAgentManagedSubdir,
  getAgentSubagentsDir,
  getAllAgentNames,
  getAgentConfig,
  parseAgentArg,
};
