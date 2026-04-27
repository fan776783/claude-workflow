/**
 * 封装 Claude Code CLI 的 plugin 子命令。
 *
 * 所有调用统一用 execFile（不用 exec，避免 shell 注入），带 timeout。
 * 失败不抛异常，返回 { success: false, stderr } 形态让调用方处理。
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const QUICK_TIMEOUT_MS = 10_000;

/**
 * 探测 claude CLI 是否可用。
 * @returns {Promise<{available: boolean, version: string|null}>}
 */
async function detectClaudeCli() {
  try {
    const { stdout } = await execFileP('claude', ['--version'], { timeout: 5_000 });
    return { available: true, version: stdout.trim() };
  } catch (err) {
    return { available: false, version: null, error: err.code || err.message };
  }
}

function wrapResult(promise) {
  return promise.then(
    ({ stdout, stderr }) => ({ success: true, stdout: stdout || '', stderr: stderr || '' }),
    (err) => ({
      success: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
      code: err.code,
    })
  );
}

/**
 * claude plugin marketplace add <source> --scope <scope>
 */
async function marketplaceAdd(source, scope = 'user') {
  return wrapResult(
    execFileP('claude', ['plugin', 'marketplace', 'add', source, '--scope', scope], {
      timeout: DEFAULT_TIMEOUT_MS,
    })
  );
}

/**
 * claude plugin marketplace update <name>
 */
async function marketplaceUpdate(name) {
  const args = ['plugin', 'marketplace', 'update'];
  if (name) args.push(name);
  return wrapResult(execFileP('claude', args, { timeout: DEFAULT_TIMEOUT_MS }));
}

/**
 * claude plugin install <plugin>@<marketplace> --scope <scope>
 */
async function pluginInstall(plugin, marketplace, { scope = 'user' } = {}) {
  const target = `${plugin}@${marketplace}`;
  return wrapResult(
    execFileP('claude', ['plugin', 'install', target, '--scope', scope], {
      timeout: DEFAULT_TIMEOUT_MS,
    })
  );
}

/**
 * claude plugin update <plugin>@<marketplace> --scope <scope>
 */
async function pluginUpdate(plugin, marketplace, { scope = 'user' } = {}) {
  const target = `${plugin}@${marketplace}`;
  return wrapResult(
    execFileP('claude', ['plugin', 'update', target, '--scope', scope], {
      timeout: DEFAULT_TIMEOUT_MS,
    })
  );
}

/**
 * claude plugin list --json
 * 成功时 stdout 是 JSON 数组。
 */
async function pluginList() {
  const result = await wrapResult(
    execFileP('claude', ['plugin', 'list', '--json'], { timeout: QUICK_TIMEOUT_MS })
  );
  if (!result.success) return result;
  try {
    return { ...result, parsed: JSON.parse(result.stdout) };
  } catch (err) {
    return { ...result, success: false, parseError: err.message };
  }
}

module.exports = {
  detectClaudeCli,
  marketplaceAdd,
  marketplaceUpdate,
  pluginInstall,
  pluginUpdate,
  pluginList,
};
