/**
 * 跨 CLI 共享的可执行文件解析器。
 *
 * 背景：原先 claude-cli / qoder-cli 只扫 `process.env.PATH` 里的文件。但"终端能跑
 * `claude` 却检测不到"很常见——PATH 由 shell profile（.zshrc/.zprofile/PowerShell
 * $PROFILE）注入、或 claude 装在 `~/.local/bin` 这种 npm/node 子进程 PATH 没收录的
 * 目录时，纯 `process.env.PATH` 扫描就漏检。
 *
 * 解析顺序（命中即返回）：
 *   1. process.env.PATH         —— 最快，覆盖绝大多数正常安装
 *   2. 已知安装目录             —— ~/.local/bin、~/.claude/local、npm 全局 bin、Homebrew 等
 *   3. 登录 shell / where 解析  —— 让用户的 shell（含 profile 改的 PATH）或 Windows
 *                                  `where` 去找，精确捕捉"终端能跑"的那条路径。仅在 1/2
 *                                  落空时触发，带短超时，绝不阻塞正常路径。
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';
const SHELL_TIMEOUT_MS = 4_000;

/**
 * Windows 下要尝试的扩展名集合（小写）。即便 PATHEXT 被改坏，也补齐常见项。
 * 非 Windows 返回 ['']（无扩展名）。
 */
function candidateExts() {
  if (!IS_WINDOWS) return [''];
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const exts = raw
    .split(';')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const ext of ['.exe', '.cmd', '.bat', '.com']) {
    if (!exts.includes(ext)) exts.push(ext);
  }
  return exts;
}

function fileInDir(dir, name, exts) {
  for (const ext of exts) {
    const candidate = path.join(dir, `${name}${ext}`);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) {
      // 不存在，继续
    }
  }
  return null;
}

function fromPath(name, exts) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const hit = fileInDir(dir, name, exts);
    if (hit) return hit;
  }
  return null;
}

/**
 * 常见安装目录——PATH 没收录但终端往往能通过 profile 找到。
 */
function knownDirs() {
  const home = os.homedir();
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, 'bin'),
  ];
  if (IS_WINDOWS) {
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    if (localAppData) {
      dirs.push(path.join(localAppData, 'Programs'));
      dirs.push(path.join(localAppData, 'npm'));
    }
    if (appData) dirs.push(path.join(appData, 'npm'));
  } else {
    dirs.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin');
  }
  return dirs;
}

function fromKnownDirs(name, exts) {
  for (const dir of knownDirs()) {
    const hit = fileInDir(dir, name, exts);
    if (hit) return hit;
  }
  return null;
}

/**
 * 让系统解析器去找：Windows 用 `where`，POSIX 用登录+交互式 shell 跑 `command -v`，
 * 这样 .zshrc/.zprofile 等 profile 注入的 PATH 也能生效。仅取"看起来像路径且确实存在"
 * 的行，避免 profile 打印的噪声。失败/超时静默返回 null。
 */
function fromShellResolution(name) {
  try {
    if (IS_WINDOWS) {
      const out = execFileSync('where', [name], {
        timeout: SHELL_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
      const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          if (fs.statSync(line).isFile()) return line;
        } catch (_) { /* 继续 */ }
      }
    } else {
      const shell = process.env.SHELL || '/bin/sh';
      const out = execFileSync(shell, ['-lic', `command -v ${name} 2>/dev/null`], {
        timeout: SHELL_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
      const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // 末尾优先：command -v 的输出通常是最后一行；只认绝对路径且确实是文件
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.startsWith('/')) continue;
        try {
          if (fs.statSync(line).isFile()) return line;
        } catch (_) { /* 继续 */ }
      }
    }
  } catch (_) {
    // 解析失败/超时 —— 静默降级
  }
  return null;
}

/**
 * 解析 CLI 可执行文件的实际路径。找不到返回 null。
 * @param {string} name - 不带扩展名的命令名，如 'claude' / 'qodercli'
 * @returns {string|null}
 */
function resolveCliBinary(name) {
  const exts = candidateExts();
  return (
    fromPath(name, exts) ||
    fromKnownDirs(name, exts) ||
    fromShellResolution(name) ||
    null
  );
}

module.exports = {
  resolveCliBinary,
  candidateExts,
  knownDirs,
  IS_WINDOWS,
};
