#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TeammateIdle Hook — 原生 agent team 队友即将空闲时守门。
 *
 * 前提：官方 TeammateIdle 事件只在 agent team 场景触发，payload 带 team_name。
 *       没有 team_name 时直接放行（防御性兜底，不做猜测式 fallback）。
 *
 * 职责（只做两件事）：
 *   1. 仍有未完成任务 → 退出码 2，留住队友继续认领。
 *   2. 任务板清空 → 通过 stderr 指示队友给 Team Lead 发一条 message，
 *      请求其执行 `clean up team`，然后退 0 放行 idle；cleanup 由 Lead 会话侧
 *      按 team.md 指引完成，hook 不再代行 Lead-only 指令。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const OPEN_STATUSES = new Set(['pending', 'in_progress']);

function readHookPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function resolveClaudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function resolveTeamName(payload) {
  const value = payload?.team_name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function countOpenTasks(teamName, claudeHome) {
  if (!teamName) return { open: 0, total: 0 };
  const tasksDir = path.join(claudeHome, 'tasks', teamName);
  let entries;
  try {
    entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  } catch {
    return { open: 0, total: 0 };
  }

  let open = 0;
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const content = fs.readFileSync(path.join(tasksDir, entry.name), 'utf8');
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : [data];
      for (const task of items) {
        if (!task || typeof task !== 'object') continue;
        total += 1;
        const status = String(task.status || task.state || '').toLowerCase();
        if (!status || OPEN_STATUSES.has(status)) open += 1;
      }
    } catch {
      // malformed task file ignored
    }
  }
  return { open, total };
}

function main() {
  const payload = readHookPayload();
  const claudeHome = resolveClaudeHome();
  const teamName = resolveTeamName(payload);

  if (!teamName) {
    process.exit(0);
  }

  const teammate = payload?.teammate_name || 'teammate';
  const { open, total } = countOpenTasks(teamName, claudeHome);

  if (open > 0) {
    process.stderr.write(
      `[team-idle] 任务板仍有 ${open}/${total} 个未完成任务，${teammate} 请继续认领或推进，不要空闲。\n`
    );
    process.exit(2);
  }

  process.stderr.write(
    `[team-idle] 任务板已清空（team=${teamName}）。${teammate} 请给 Team Lead 发一条 message：` +
      `「任务板已清空，建议执行 clean up team 收尾」，然后正常 idle。cleanup 由 Lead 执行，` +
      `有活跃队友时需先 shutdown 再 clean up team。\n`
  );
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[team-idle] 内部异常放行: ${err.message}\n`);
  process.exit(0);
}
