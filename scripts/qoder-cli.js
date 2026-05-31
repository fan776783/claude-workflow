/**
 * 封装 Qoder CLI (`qodercli`) 的 plugins 子命令。
 *
 * 设计与 scripts/claude-cli.js 对齐：统一用 execFile（不用 exec，避免 shell 注入），
 * 带 timeout；失败不抛异常，返回 { success: false, stderr } 形态让调用方处理。
 *
 * Qoder CLI 是 Claude Code 同款 Plugin 机制的实现：
 *   qodercli plugins install <local-dir> --scope <scope>
 *   qodercli plugins uninstall <name>   --scope <scope>
 *   qodercli plugins list --json
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const QUICK_TIMEOUT_MS = 10_000;
const IS_WINDOWS = process.platform === 'win32';

let cachedBinary = null;

/**
 * 在 PATH 中解析 qodercli 可执行文件。
 *
 * Windows 下 npm 安装的 CLI 通常是 `qodercli.cmd` shim，而 Node 的 execFile
 * 不会自动追加 PATHEXT，因此需要我们手动遍历 PATHEXT 找到实际文件路径。
 */
function resolveQoderBinary() {
  if (cachedBinary) return cachedBinary;
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = IS_WINDOWS
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((s) => s.toLowerCase())
    : [''];
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `qodercli${ext}`);
      try {
        if (fs.statSync(candidate).isFile()) {
          cachedBinary = candidate;
          return cachedBinary;
        }
      } catch (_) {
        // 不存在，继续
      }
    }
  }
  return null;
}

function runQoder(args, options = {}) {
  const bin = resolveQoderBinary();
  if (!bin) {
    return Promise.reject(Object.assign(new Error('qodercli CLI not found in PATH'), { code: 'ENOENT' }));
  }
  // Windows 下 .cmd/.bat 不能被 execFile 直接执行（EINVAL），需要走 cmd.exe /c。
  // 注意 cmd.exe 的参数是单个字符串，需要自行做引号转义。
  if (IS_WINDOWS && /\.(cmd|bat)$/i.test(bin)) {
    const quote = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
    const cmdline = [quote(bin), ...args.map(quote)].join(' ');
    return execFileP('cmd.exe', ['/d', '/s', '/c', cmdline], { ...options, windowsVerbatimArguments: true });
  }
  return execFileP(bin, args, options);
}

/**
 * 探测 qodercli CLI 是否可用。
 * @returns {Promise<{available: boolean, version: string|null}>}
 */
async function detectQoderCli() {
  try {
    const { stdout } = await runQoder(['--version'], { timeout: 5_000 });
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
 * qodercli plugins install <dir> --scope <scope>
 * dir 为本地插件目录（canonical 的 core/）。重复安装是幂等的，Qoder 会重新装。
 */
async function pluginInstall(dir, { scope = 'user' } = {}) {
  return wrapResult(
    runQoder(['plugins', 'install', dir, '--scope', scope], {
      timeout: DEFAULT_TIMEOUT_MS,
    })
  );
}

/**
 * qodercli plugins uninstall <name> --scope <scope>
 */
async function pluginUninstall(name, { scope = 'user' } = {}) {
  return wrapResult(
    runQoder(['plugins', 'uninstall', name, '--scope', scope], {
      timeout: DEFAULT_TIMEOUT_MS,
    })
  );
}

/**
 * qodercli plugins list --json
 * 成功时 stdout 是 JSON 数组，每项形如 { id: "core@local", version, scope, enabled, installPath }。
 */
async function pluginList() {
  const result = await wrapResult(
    runQoder(['plugins', 'list', '--json'], { timeout: QUICK_TIMEOUT_MS })
  );
  if (!result.success) return result;
  try {
    return { ...result, parsed: JSON.parse(result.stdout) };
  } catch (err) {
    return { ...result, success: false, parseError: err.message };
  }
}

module.exports = {
  detectQoderCli,
  pluginInstall,
  pluginUninstall,
  pluginList,
};
