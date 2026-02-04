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

// 我们安装的目录，检测时需要排除
const OUR_INSTALLED_DIRS = ['skills', 'commands', 'prompts', 'utils', 'specs'];

/**
 * 检查目录是否有除了我们安装的内容之外的文件
 * 用于判断 Agent 是否真正安装
 */
function hasOtherContent(dirPath) {
  if (!fs.existsSync(dirPath)) return false;

  try {
    const entries = fs.readdirSync(dirPath);
    // 过滤掉我们安装的目录和隐藏文件
    const otherEntries = entries.filter(entry => {
      // 排除我们安装的目录
      if (OUR_INSTALLED_DIRS.includes(entry)) return false;
      // 排除 .DS_Store
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
    // Antigravity 会在 ~/.gemini/antigravity 下创建配置
    detectInstalled: () => hasOtherContent(path.join(home, '.gemini', 'antigravity')),
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: path.join(claudeHome, 'skills'),
    // Claude Code 会创建 settings.json 或 projects 目录
    detectInstalled: () => {
      return fileExists(path.join(claudeHome, 'settings.json')) ||
             fileExists(path.join(claudeHome, 'settings.local.json')) ||
             fileExists(path.join(claudeHome, 'projects')) ||
             hasOtherContent(claudeHome);
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.codex/skills',
    globalSkillsDir: path.join(codexHome, 'skills'),
    // Codex 会创建 .codex-global-state.json
    detectInstalled: () => {
      return fileExists(path.join(codexHome, '.codex-global-state.json')) ||
             fileExists(path.join(codexHome, 'instructions.md')) ||
             hasOtherContent(codexHome);
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.cursor/skills',
    globalSkillsDir: path.join(home, '.cursor', 'skills'),
    // Cursor 会创建 argv.json 或 extensions 目录
    detectInstalled: () => {
      const cursorDir = path.join(home, '.cursor');
      return fileExists(path.join(cursorDir, 'argv.json')) ||
             fileExists(path.join(cursorDir, 'extensions')) ||
             hasOtherContent(cursorDir);
    },
  },
  droid: {
    name: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: path.join(home, '.factory', 'skills'),
    // Droid 会创建 auth.encrypted 或 artifacts 目录
    detectInstalled: () => {
      const factoryDir = path.join(home, '.factory');
      return fileExists(path.join(factoryDir, 'auth.encrypted')) ||
             fileExists(path.join(factoryDir, 'artifacts')) ||
             hasOtherContent(factoryDir);
    },
  },
  'gemini-cli': {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.gemini/skills',
    globalSkillsDir: path.join(home, '.gemini', 'skills'),
    // Gemini CLI 会创建 GEMINI.md 或 .env
    detectInstalled: () => {
      const geminiDir = path.join(home, '.gemini');
      return fileExists(path.join(geminiDir, 'GEMINI.md')) ||
             fileExists(path.join(geminiDir, '.env')) ||
             fileExists(path.join(geminiDir, 'settings.json'));
    },
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.github/skills',
    globalSkillsDir: path.join(home, '.copilot', 'skills'),
    // GitHub Copilot 会创建配置文件
    detectInstalled: () => hasOtherContent(path.join(home, '.copilot')),
  },
  kilo: {
    name: 'kilo',
    displayName: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    globalSkillsDir: path.join(home, '.kilocode', 'skills'),
    // Kilo Code 会创建配置文件
    detectInstalled: () => hasOtherContent(path.join(home, '.kilocode')),
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.opencode/skills',
    globalSkillsDir: path.join(configHome, 'opencode', 'skills'),
    // OpenCode 会创建 config.json 或其他配置
    detectInstalled: () => {
      const opencodeDir = path.join(configHome, 'opencode');
      return fileExists(path.join(opencodeDir, 'config.json')) ||
             fileExists(path.join(opencodeDir, 'bun.lock')) ||
             hasOtherContent(opencodeDir);
    },
  },
  qoder: {
    name: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: path.join(home, '.qoder', 'skills'),
    // Qoder 会创建配置文件
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
  return path.join(baseDir, '.agents', 'claude-workflow');
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

  // 逗号分隔列表
  const names = agentArg.split(',').map(s => s.trim()).filter(Boolean);
  const validNames = names.filter(name => agents[name]);
  const invalidNames = names.filter(name => !agents[name]);

  if (invalidNames.length > 0) {
    console.warn(`[claude-workflow] 未知的 Agent: ${invalidNames.join(', ')}`);
  }

  return validNames;
}

module.exports = {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  getAgentSkillsDir,
  getAllAgentNames,
  getAgentConfig,
  parseAgentArg,
};
