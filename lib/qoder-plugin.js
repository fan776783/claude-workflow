/**
 * Qoder Plugin 分支的核心模块。
 *
 * Qoder CLI（`qodercli`）支持 Claude Code 同款 Plugin 机制：commands / skills /
 * agents / hooks(hooks.json) 全部原生加载，包括 workflow 的 SessionStart /
 * PreToolUse 治理 hook。因此 Qoder 与 Claude Code 一样走 Plugin 分发，不经过
 * installer 的逐 skill mount。
 *
 *   canonical: ~/.agents/agent-workflow/core   ← 插件根（含 .claude-plugin/plugin.json + hooks/hooks.json）
 *   install  : qodercli plugins install <canonical>/core --scope user
 *
 * 与 lib/claude-code-plugin.js 的差异：
 *   - Qoder 一步安装本地目录，无需 marketplace add；
 *   - Qoder 按目录名命名插件 → id 为 "core@local"；
 *   - 无 v5.x 残留概念（Qoder 从未走过 installer mount）。
 *
 * 对外暴露：
 *   ensureQoderPluginInstalled: sync 调用的主入口
 *   inspectStatus            : status 命令用
 *   diagnose                 : doctor 命令用
 *   printGuidance            : qodercli 不可用时的手动指引
 */

'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const qoderCli = require('../scripts/qoder-cli');

// canonical 下的插件目录名。
const PLUGIN_DIR_NAME = 'core';
// Qoder 安装本地目录后按目录名命名插件，marketplace 记为 "local"。
const INSTALLED_PLUGIN_NAME = 'core';
const INSTALLED_PLUGIN_ID = 'core@local';
const INSTALL_SCOPE = 'user';

function getQoderHome() {
  return process.env.QODER_CONFIG_DIR || path.join(os.homedir(), '.qoder');
}

function getPluginDir(canonicalDir) {
  return path.join(canonicalDir, PLUGIN_DIR_NAME);
}

/**
 * 判断 plugins list 的某条目是否是我们的插件。
 * 兼容 id="core@local" / name="core" 等不同字段写法。
 */
function isOurPlugin(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const id = String(entry.id || '');
  const name = String(entry.name || entry.plugin || '');
  return id === INSTALLED_PLUGIN_ID
    || id.split('@')[0] === INSTALLED_PLUGIN_NAME
    || name === INSTALLED_PLUGIN_NAME;
}

/**
 * 打印 qodercli 不可用时的手动指引。
 */
function printGuidance({ canonicalDir, logger = console }) {
  const pluginDir = getPluginDir(canonicalDir);
  const lines = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Qoder 通过 Plugin 机制管理（与 Claude Code 同款）',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '未检测到 `qodercli` CLI，无法自动安装 Plugin。请手动执行：',
    '',
    `    qodercli plugins install ${pluginDir} --scope ${INSTALL_SCOPE}`,
    '',
    '安装后在 Qoder 会话中运行 `/plugins reload` 生效。',
    '',
  ];
  for (const line of lines) logger.log(line);
}

/**
 * sync 命令 qoder 分支的主入口。
 *
 * @param {Object} opts
 * @param {string} opts.canonicalDir   - canonical 目录（已由调用方 ensureCanonicalInstalled 准备），插件在其 core/ 下
 * @param {Object} [opts.options]      - CLI options（yes, dryRun 等）
 * @param {Object} [opts.logger]       - 替代 console，方便测试
 */
async function ensureQoderPluginInstalled({ canonicalDir, options = {}, logger = console } = {}) {
  const result = {
    success: false,
    cliDetected: null,
    pluginInstalled: null,
    reason: null,
  };

  // 1. 探测 qodercli CLI
  const cli = await qoderCli.detectQoderCli();
  result.cliDetected = cli;
  if (!cli.available) {
    printGuidance({ canonicalDir, logger });
    result.reason = 'cli-not-found';
    return result;
  }

  const pluginDir = getPluginDir(canonicalDir);

  // 2. dry-run：只打印将执行的动作
  if (options.dryRun) {
    logger.log(`  [dry-run] qodercli plugins install ${pluginDir} --scope ${INSTALL_SCOPE}`);
    result.reason = 'dry-run';
    result.success = true;
    return result;
  }

  // 3. plugin install（幂等 —— 重复安装会重新装，Qoder 不报错）
  const installResult = await qoderCli.pluginInstall(pluginDir, { scope: INSTALL_SCOPE });
  result.pluginInstalled = installResult;
  if (!installResult.success) {
    logger.log(`[qoder-plugin] plugin install failed: ${installResult.stderr || installResult.code}`);
    result.reason = 'install-failed';
    return result;
  }

  result.success = true;
  return result;
}

/**
 * 查询 Plugin 安装状态。
 */
async function inspectStatus({ canonicalDir } = {}) {
  const state = {
    installed: false,
    version: null,
    scope: null,
    residue: null,
  };

  const cli = await qoderCli.detectQoderCli();
  state.cliAvailable = cli.available;

  if (cli.available) {
    const listed = await qoderCli.pluginList();
    if (listed.success && Array.isArray(listed.parsed)) {
      const entry = listed.parsed.find(isOurPlugin);
      if (entry) {
        state.installed = Boolean(entry.enabled !== false);
        state.version = entry.version || null;
        state.scope = entry.scope || null;
      }
    }
  }

  // 回退路径：直接看 ~/.qoder/plugins/cache/local/core/
  if (!state.installed) {
    const cacheRoot = path.join(getQoderHome(), 'plugins', 'cache', 'local', INSTALLED_PLUGIN_NAME);
    if (await fs.pathExists(cacheRoot)) {
      state.installed = true;
      state.scope = INSTALL_SCOPE;
    }
  }

  return state;
}

/**
 * doctor 命令的综合诊断。
 */
async function diagnose({ canonicalDir } = {}) {
  const result = { ok: [], issues: [], suggestions: [] };

  const cli = await qoderCli.detectQoderCli();
  if (cli.available) {
    result.ok.push(`qodercli CLI 可用 (${cli.version})`);
  } else {
    result.issues.push('qodercli CLI 不在 PATH');
    result.suggestions.push('安装 Qoder CLI 并确保 `qodercli` 命令可用，或手动 `qodercli plugins install`');
  }

  const status = await inspectStatus({ canonicalDir });
  if (status.installed) {
    result.ok.push(`Qoder Plugin 已安装 (v${status.version || 'unknown'})`);
  } else {
    result.issues.push('Qoder Plugin 未安装');
    result.suggestions.push('运行 `agent-workflow sync` 自动安装 Plugin');
  }

  return result;
}

module.exports = {
  PLUGIN_DIR_NAME,
  INSTALLED_PLUGIN_NAME,
  INSTALLED_PLUGIN_ID,
  INSTALL_SCOPE,
  isOurPlugin,
  printGuidance,
  ensureQoderPluginInstalled,
  inspectStatus,
  diagnose,
};
