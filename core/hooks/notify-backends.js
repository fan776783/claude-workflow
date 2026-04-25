#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * 平台后端：把 { title, body, sound } 投递成系统原生桌面通知。
 * 零第三方依赖 — 只用 Node 内置模块 + 系统自带命令（osascript / terminal-notifier / powershell / notify-send）。
 *
 * 导出：notifyDarwin / notifyWin32 / notifyLinux
 */

'use strict';

const { execFileSync } = require('child_process');

const AUMID = 'ClaudeCode.AgentWorkflow.Notify';

const MAC_TERMINAL_BUNDLES = [
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'org.tabby',
  'dev.warp.Warp-Stable',
  'dev.warp.Warp-Preview',
  'net.kovidgoyal.kitty',
  'com.mitchellh.ghostty',
];

// TERM_PROGRAM 是终端进程自己设的环境变量，Claude Code 继承它 —— 用这个比 osascript
// 查 frontmost process 快 50-200ms，且不触发 TCC 权限弹窗。
const TERM_PROGRAM_BUNDLE_MAP = {
  'Apple_Terminal': 'com.apple.Terminal',
  'iTerm.app': 'com.googlecode.iterm2',
  'WarpTerminal': 'dev.warp.Warp-Stable',
  'ghostty': 'com.mitchellh.ghostty',
  'WezTerm': 'com.github.wez.wezterm',
  'kitty': 'net.kovidgoyal.kitty',
  'tabby': 'org.tabby',
  'Hyper': 'co.zeit.hyper',
};

function hasCommand(bin) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : '/usr/bin/which', [bin], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────
// macOS

function detectTerminalBundle(override) {
  if (typeof override === 'string' && override.trim()) return override.trim();

  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram && TERM_PROGRAM_BUNDLE_MAP[termProgram]) {
    return TERM_PROGRAM_BUNDLE_MAP[termProgram];
  }

  // env var 缺失或未知终端：退到 osascript 查 frontmost process。此路径会触发
  // TCC 授权弹窗，首次可能失败 —— 最终兜底 Terminal.app。
  const whose = MAC_TERMINAL_BUNDLES.map((b) => `bundle identifier is "${b}"`).join(' or ');
  const script = `tell application "System Events" to get bundle identifier of first process whose (${whose}) and frontmost is true`;
  try {
    const out = execFileSync('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch {}
  return 'com.apple.Terminal';
}

function notifyDarwin({ title, body, sound, terminalBundleOverride }) {
  if (hasCommand('terminal-notifier')) {
    try {
      execFileSync(
        'terminal-notifier',
        [
          '-title', title,
          '-message', body,
          '-sound', sound || 'default',
          '-activate', detectTerminalBundle(terminalBundleOverride),
          '-group', 'claude_code',
        ],
        { stdio: 'ignore', timeout: 3000 }
      );
      return;
    } catch {
      // terminal-notifier 可能因权限 / 包签名问题失败 — 往下走 osascript fallback
    }
  }

  // 纯 osascript fallback：有通知但无法点击激活终端
  const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const src =
    `display notification "${esc(body)}" with title "${esc(title)}" sound name "${esc(sound || 'default')}"`;
  try {
    execFileSync('/usr/bin/osascript', ['-e', src], { stdio: 'ignore', timeout: 3000 });
  } catch (err) {
    process.stderr.write(`[notify:darwin] osascript 失败: ${err.message}\n`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Windows

// WinRT toast：title/body 通过环境变量传入；here-string 只做变量展开不做 XML 转义，
// 所以 title/body 里的 < > & " ' 必须先手动转义成 XML 实体再插入，否则 LoadXml 抛异常静默失败。
const PS_TOAST_SCRIPT = `
$ErrorActionPreference='Stop'
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null
[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]|Out-Null
function _xe($s) { return ($s -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' -replace '"','&quot;' -replace "'",'&apos;') }
$t = _xe $env:AW_TITLE
$b = _xe $env:AW_BODY
$xml=@"
<toast><visual><binding template="ToastGeneric"><text>$t</text><text>$b</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>
"@
$doc=New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast=New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:AW_AUMID).Show($toast)
`;

function notifyWin32({ title, body, aumid }) {
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_TOAST_SCRIPT],
      {
        stdio: 'ignore',
        timeout: 5000,
        windowsHide: true,
        env: {
          ...process.env,
          AW_AUMID: aumid || AUMID,
          AW_TITLE: String(title || ''),
          AW_BODY: String(body || ''),
        },
      }
    );
  } catch (err) {
    process.stderr.write(`[notify:win32] toast 失败: ${err.message}\n`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Linux

function notifyLinux({ title, body, urgency }) {
  try {
    execFileSync('notify-send', [`--urgency=${urgency || 'normal'}`, String(title || ''), String(body || '')], {
      stdio: 'ignore',
      timeout: 3000,
    });
  } catch {
    process.stderr.write(`[notify] ${title} — ${body}\n`);
  }
}

module.exports = {
  AUMID,
  notifyDarwin,
  notifyWin32,
  notifyLinux,
};
