/**
 * Antigravity Plugin 分支的核心模块。
 *
 * Antigravity CLI（`agy`）是 Gemini CLI 的后继者（Gemini CLI 2026-06-18 停服）。它支持
 * Claude/Gemini 同款 Plugin 机制：commands / skills / agents / hooks 全部原生加载。因此
 * Antigravity 与 Claude Code 一样走 Plugin 分发，不经过 installer 的逐 skill mount。
 *
 *   canonical: ~/.agents/agent-workflow/core   ← 插件根（含根级 plugin.json + skills/ 等）
 *   install  : agy plugin install <canonical>/core
 *
 * 与 lib/claude-code-plugin.js 的差异：
 *   - agy plugin install 没有 --scope 参数；
 *   - agy 把插件内容快照复制到共享库 ~/.gemini/config/plugins/<name>/（CLI 与 Antigravity
 *     IDE 共用这个库 → 装一次两端可用）；
 *   - 插件按 plugin.json 的 name 命名（"agent-workflow"），list 输出 JSON { imports: [...] }；
 *   - 无 v5.x 残留概念（Antigravity 从未走过 installer mount）。
 *
 * 对外暴露：
 *   ensureAntigravityPluginInstalled: sync 调用的主入口
 *   inspectStatus                   : status 命令用
 *   diagnose                        : doctor 命令用
 *   printGuidance                   : agy 不可用时的手动指引
 */

'use strict';

const path = require('path');

const antigravityCli = require('../scripts/antigravity-cli');

// canonical 下的插件目录名。
const PLUGIN_DIR_NAME = 'core';
// agy 按 plugin.json 的 name 命名插件。
const INSTALLED_PLUGIN_NAME = 'agent-workflow';

function getPluginDir(canonicalDir) {
  return path.join(canonicalDir, PLUGIN_DIR_NAME);
}

/**
 * 判断 plugin list 的某条目是否是我们的插件。
 */
function isOurPlugin(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return String(entry.name || '') === INSTALLED_PLUGIN_NAME;
}

/**
 * 打印 agy 不可用时的手动指引。
 */
function printGuidance({ canonicalDir, logger = console }) {
  const pluginDir = getPluginDir(canonicalDir);
  const lines = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Antigravity 通过 Plugin 机制管理（与 Claude Code / Qoder 同款）',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '未检测到 `agy` CLI，无法自动安装 Plugin。请手动执行：',
    '',
    `    agy plugin install ${pluginDir}`,
    '',
    '安装后在 Antigravity 会话中运行 `/skills` 可查看已加载的技能。',
    '',
  ];
  for (const line of lines) logger.log(line);
}

/**
 * sync 命令 antigravity 分支的主入口。
 *
 * @param {Object} opts
 * @param {string} opts.canonicalDir   - canonical 目录（已由调用方 ensureCanonicalInstalled 准备），插件在其 core/ 下
 * @param {Object} [opts.options]      - CLI options（yes, dryRun 等）
 * @param {Object} [opts.logger]       - 替代 console，方便测试
 */
async function ensureAntigravityPluginInstalled({ canonicalDir, options = {}, logger = console } = {}) {
  const result = {
    success: false,
    cliDetected: null,
    pluginInstalled: null,
    reason: null,
  };

  // 1. 探测 agy CLI
  const cli = await antigravityCli.detectAntigravityCli();
  result.cliDetected = cli;
  if (!cli.available) {
    printGuidance({ canonicalDir, logger });
    result.reason = 'cli-not-found';
    return result;
  }

  const pluginDir = getPluginDir(canonicalDir);

  // 2. dry-run：只打印将执行的动作
  if (options.dryRun) {
    logger.log(`  [dry-run] agy plugin install ${pluginDir}`);
    result.reason = 'dry-run';
    result.success = true;
    return result;
  }

  // 3. plugin install（幂等 —— 快照复制，重复安装覆盖）
  const installResult = await antigravityCli.pluginInstall(pluginDir);
  result.pluginInstalled = installResult;
  if (!installResult.success) {
    logger.log(`[antigravity-plugin] plugin install failed: ${installResult.stderr || installResult.code}`);
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

  const cli = await antigravityCli.detectAntigravityCli();
  state.cliAvailable = cli.available;

  if (cli.available) {
    const listed = await antigravityCli.pluginList();
    if (listed.success && listed.parsed && Array.isArray(listed.parsed.imports)) {
      const entry = listed.parsed.imports.find(isOurPlugin);
      if (entry) {
        state.installed = true;
        // agy 的 imports 条目不带 version 字段，版本以 canonical plugin.json 为准（调用方按需读）
        state.version = entry.version || null;
        state.scope = entry.source || null;
      }
    }
  }

  return state;
}

/**
 * doctor 命令的综合诊断。
 */
async function diagnose({ canonicalDir } = {}) {
  const result = { ok: [], issues: [], suggestions: [] };

  const cli = await antigravityCli.detectAntigravityCli();
  if (cli.available) {
    result.ok.push(`agy CLI 可用 (${cli.version})`);
  } else {
    result.issues.push('agy CLI 不在 PATH');
    result.suggestions.push('安装 Antigravity CLI 并确保 `agy` 命令可用，或手动 `agy plugin install`');
  }

  const status = await inspectStatus({ canonicalDir });
  if (status.installed) {
    result.ok.push('Antigravity Plugin 已安装');
  } else if (cli.available) {
    result.issues.push('Antigravity Plugin 未安装');
    result.suggestions.push('运行 `agent-workflow sync` 自动安装 Plugin');
  }

  return result;
}

module.exports = {
  PLUGIN_DIR_NAME,
  INSTALLED_PLUGIN_NAME,
  getPluginDir,
  isOurPlugin,
  printGuidance,
  ensureAntigravityPluginInstalled,
  inspectStatus,
  diagnose,
};
