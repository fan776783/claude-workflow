/**
 * 封装 Claude Code CLI 的 plugin 子命令。
 *
 * 所有调用统一用 execFile（不用 exec，避免 shell 注入），带 timeout。
 * 失败不抛异常，返回 { success: false, stderr } 形态让调用方处理。
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
 * 在 PATH 中解析 claude 可执行文件。
 *
 * Windows 下 npm 安装的 CLI 通常是 `claude.cmd` shim，而 Node 的 execFile
 * 不会自动追加 PATHEXT，因此需要我们手动遍历 PATHEXT 找到实际文件路径。
 */
function resolveClaudeBinary() {
  if (cachedBinary) return cachedBinary;
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = IS_WINDOWS
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((s) => s.toLowerCase())
    : [''];
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `claude${ext}`);
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

function runClaude(args, options = {}) {
  const bin = resolveClaudeBinary();
  if (!bin) {
    return Promise.reject(Object.assign(new Error('claude CLI not found in PATH'), { code: 'ENOENT' }));
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
 * 探测 claude CLI 是否可用。
 * @returns {Promise<{available: boolean, version: string|null}>}
 */
async function detectClaudeCli() {
  try {
    const { stdout } = await runClaude(['--version'], { timeout: 5_000 });
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
    runClaude(['plugin', 'marketplace', 'add', source, '--scope', scope], {
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
  return wrapResult(runClaude(args, { timeout: DEFAULT_TIMEOUT_MS }));
}

/**
 * claude plugin install <plugin>@<marketplace> --scope <scope>
 */
async function pluginInstall(plugin, marketplace, { scope = 'user' } = {}) {
  const target = `${plugin}@${marketplace}`;
  return wrapResult(
    runClaude(['plugin', 'install', target, '--scope', scope], {
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
    runClaude(['plugin', 'update', target, '--scope', scope], {
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
    runClaude(['plugin', 'list', '--json'], { timeout: QUICK_TIMEOUT_MS })
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
