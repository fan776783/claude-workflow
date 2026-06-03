/**
 * 封装 Antigravity CLI (`agy`) 的 plugin 子命令。
 *
 * 设计与 scripts/qoder-cli.js 对齐：统一用 execFile（不用 exec，避免 shell 注入），
 * 带 timeout；失败不抛异常，返回 { success: false, stderr } 形态让调用方处理。
 *
 * Antigravity CLI 是 Gemini CLI 的后继者（Gemini CLI 2026-06-18 停服）。它支持
 * Claude/Gemini 同款 Plugin 机制：
 *   agy plugin install <local-dir>   把目录下的 plugin.json + skills/agents/commands/hooks
 *                                    复制（快照）到共享插件库 ~/.gemini/config/plugins/<name>/
 *   agy plugin uninstall <name>      按 plugin.json 的 name 卸载
 *   agy plugin list                  默认输出 JSON：{ "imports": [ { name, source, ... } ] }
 *                                    —— 空时输出纯文本 "No imported plugins."（需兜底解析）
 *
 * 注意：install 没有 --scope 参数（与 qodercli 不同），且是快照复制 —— core/ 更新后
 * 需要重新 install 才能刷新，sync 每次重跑即可（幂等覆盖）。
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const { resolveCliBinary } = require('./cli-resolve');

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const QUICK_TIMEOUT_MS = 10_000;
const IS_WINDOWS = process.platform === 'win32';

let cachedBinary = null;

/**
 * 解析 agy 可执行文件路径。
 *
 * 走 scripts/cli-resolve.js 的多级解析（PATH → 已知安装目录如 ~/.local/bin → 登录 shell /
 * where），与 claude-cli / qoder-cli 共用同一套逻辑。agy 安装器默认落 ~/.local/bin/agy，
 * 正好在 cli-resolve 的已知目录里。
 */
function resolveAntigravityBinary() {
  if (cachedBinary) return cachedBinary;
  cachedBinary = resolveCliBinary('agy');
  return cachedBinary;
}

function runAgy(args, options = {}) {
  const bin = resolveAntigravityBinary();
  if (!bin) {
    return Promise.reject(Object.assign(new Error('agy CLI not found in PATH'), { code: 'ENOENT' }));
  }
  // Windows 下 .cmd/.bat 不能被 execFile 直接执行（EINVAL），需要走 cmd.exe /c。
  if (IS_WINDOWS && /\.(cmd|bat)$/i.test(bin)) {
    const quote = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
    const cmdline = [quote(bin), ...args.map(quote)].join(' ');
    return execFileP('cmd.exe', ['/d', '/s', '/c', cmdline], { ...options, windowsVerbatimArguments: true });
  }
  return execFileP(bin, args, options);
}

/**
 * 探测 agy CLI 是否可用。
 * @returns {Promise<{available: boolean, version: string|null}>}
 */
async function detectAntigravityCli() {
  try {
    const { stdout } = await runAgy(['--version'], { timeout: 5_000 });
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
 * agy plugin install <dir>
 * dir 为本地插件目录（canonical 的 core/，含根级 plugin.json）。
 * agy 会把内容快照复制到共享插件库；重复安装幂等覆盖。
 */
async function pluginInstall(dir) {
  return wrapResult(
    runAgy(['plugin', 'install', dir], { timeout: DEFAULT_TIMEOUT_MS })
  );
}

/**
 * agy plugin uninstall <name>
 * name 为 plugin.json 里的 name（"agent-workflow"）。
 */
async function pluginUninstall(name) {
  return wrapResult(
    runAgy(['plugin', 'uninstall', name], { timeout: DEFAULT_TIMEOUT_MS })
  );
}

/**
 * agy plugin list
 *
 * 非空时 stdout 是 JSON：{ "imports": [ { name, source, importedAt, components } ] }。
 * 空时 stdout 是纯文本 "No imported plugins." —— 兜底解析成 { imports: [] }。
 *
 * @returns {Promise<{success, stdout, stderr, parsed?: {imports: Array}, parseError?: string}>}
 */
async function pluginList() {
  const result = await wrapResult(
    runAgy(['plugin', 'list'], { timeout: QUICK_TIMEOUT_MS })
  );
  if (!result.success) return result;
  const text = String(result.stdout || '').trim();
  // 空列表是纯文本而非 JSON
  if (!text || /no imported plugins/i.test(text)) {
    return { ...result, parsed: { imports: [] } };
  }
  try {
    const parsed = JSON.parse(text);
    // 归一化：确保 imports 是数组
    if (!Array.isArray(parsed.imports)) parsed.imports = [];
    return { ...result, parsed };
  } catch (err) {
    return { ...result, success: false, parseError: err.message };
  }
}

module.exports = {
  detectAntigravityCli,
  pluginInstall,
  pluginUninstall,
  pluginList,
};
