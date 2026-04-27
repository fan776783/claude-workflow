#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Claude Code 跨平台桌面通知 Hook。
 *
 * 用法（由 settings.json 注入）：
 *   node notify.js <Event> [title] [body]
 *
 *   <Event>：Claude Code hook 事件名（Stop / Notification / ...）
 *   [title] [body]：可选覆盖，缺省从 EVENT_MAP 或 notify.config.json 取
 *
 * 行为：
 *   - 从 stdin 读 Claude Code hook payload JSON（参考 team-task-guard.js 模式）
 *   - 按 process.platform 派发到对应 backend
 *   - 任何异常落到 stderr，exit 0（通知失败不应阻塞 Claude Code）
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { notifyDarwin, notifyWin32, notifyLinux } = require('./notify-backends');

const EVENT_MAP = {
  Stop: {
    title: '✅ 任务完成',
    body: 'Claude Code 已完成当前回合',
    sound: 'default',
  },
  Notification: {
    title: '⚠️ 等待继续输入中',
    body: 'Claude Code 需要你的输入',
    sound: 'default',
  },
};

// Config 查找顺序（优先级高 → 低）：
//   1. ~/.claude/notify.config.json                              （Plugin 模式下用户覆盖）
//   2. ~/.claude/.agent-workflow/notify.config.json              （legacy installer 留下的用户覆盖）
//   3. ${CLAUDE_PLUGIN_ROOT}/hooks/notify.config.default.json    （Plugin 自带默认，无用户覆盖时使用）
function resolveConfigPath() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'notify.config.json'),
    path.join(os.homedir(), '.claude', '.agent-workflow', 'notify.config.json'),
  ];
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks', 'notify.config.default.json'));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readHookPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadConfig() {
  const configPath = resolveConfigPath();
  if (!configPath) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function resolveMessage(event, { argTitle, argBody, payload, config }) {
  const base = EVENT_MAP[event] || EVENT_MAP.Stop;
  const override = (config.events && config.events[event]) || {};

  // Notification 事件：Claude Code 官方 payload 里带 message 字段，优先用它作 body
  const payloadMessage = typeof payload?.message === 'string' ? payload.message : null;

  return {
    title: firstNonEmpty(argTitle, override.title, base.title) || 'Claude Code',
    body: firstNonEmpty(argBody, override.body, payloadMessage, base.body) || '',
    sound: override.sound || base.sound || 'default',
  };
}

function dispatch(event, message, config) {
  const platforms = config.platforms || {};
  if (process.platform === 'darwin') {
    const opts = platforms.darwin || {};
    notifyDarwin({
      ...message,
      terminalBundleOverride: opts.terminalBundleOverride || null,
    });
    return;
  }
  if (process.platform === 'win32') {
    const opts = platforms.win32 || {};
    notifyWin32({ ...message, aumid: opts.aumid || null });
    return;
  }
  if (process.platform === 'linux') {
    const opts = platforms.linux || {};
    notifyLinux({ ...message, urgency: opts.urgency || 'normal' });
    return;
  }
  process.stderr.write(`[notify] unsupported platform: ${process.platform}\n`);
}

function main() {
  const event = process.argv[2] || 'Stop';
  const argTitle = process.argv[3];
  const argBody = process.argv[4];

  const payload = readHookPayload();
  const config = loadConfig();

  if (config.enabled === false) {
    process.exit(0);
  }

  // 只处理已知事件 — 未知事件（例如被误配到其他 hook）直接放行
  if (!EVENT_MAP[event] && !argTitle) {
    process.exit(0);
  }

  const message = resolveMessage(event, { argTitle, argBody, payload, config });

  try {
    dispatch(event, message, config);
  } catch (err) {
    process.stderr.write(`[notify] 派发失败: ${err.message}\n`);
  }

  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[notify] 内部异常放行: ${err.message}\n`);
  process.exit(0);
}
