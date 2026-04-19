#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TaskCreated / TaskCompleted Hook — 仅对原生 agent team 产生的任务守门。
 *
 * 用法：
 *   node team-task-guard.js created     // TaskCreated hook
 *   node team-task-guard.js completed   // TaskCompleted hook
 *
 * 关键约束：
 *   - 官方 TaskCreated/TaskCompleted 事件不仅在 agent team 场景触发，也会在普通
 *     会话、/workflow-execute 等路径的 TaskCreate / TaskUpdate 时触发（payload
 *     里 team_name / teammate_name 可能不存在）。
 *   - 为避免污染非 team 场景，本脚本只有在 payload 带 team_name 或 teammate_name
 *     时才介入；其他场景直接 exit 0 放行，不做任何检查。
 *
 * 校验字段严格对齐官方 schema：task_subject（必有）、task_description（可选）。
 *
 * 规则：
 *   - created:   task_subject 为空 → 退 2
 *   - completed: task_subject / task_description 含 TODO / FIXME / 待验证 等
 *                未完成占位符 → 退 2
 *   - 其他情况放行；内部异常也放行，保证不误伤。
 */

'use strict';

const fs = require('fs');

const ACTION = (process.argv[2] || '').toLowerCase();
const UNFINISHED_MARKERS = [
  /\btodo\b/i,
  /\bfixme\b/i,
  /待验证/,
  /待确认/,
  /待补充/,
  /pending verification/i,
];

function readHookPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isBlank(value) {
  return typeof value !== 'string' || !value.trim();
}

function hasUnfinishedMarker(text) {
  if (typeof text !== 'string') return false;
  return UNFINISHED_MARKERS.some((re) => re.test(text));
}

function isTeamContext(payload) {
  return Boolean(payload?.team_name || payload?.teammate_name);
}

function checkCreated(payload) {
  if (isBlank(payload.task_subject)) {
    return 'TaskCreated: task_subject 为空，请补一个能看出交付物的标题后重试';
  }
  return null;
}

function checkCompleted(payload) {
  if (hasUnfinishedMarker(payload.task_subject) || hasUnfinishedMarker(payload.task_description)) {
    return 'TaskCompleted: task_subject / task_description 仍含 TODO / FIXME / 待验证 等占位符，请补齐完成证据后重试';
  }
  return null;
}

function main() {
  const payload = readHookPayload();

  if (!isTeamContext(payload)) {
    process.exit(0);
  }

  let reason = null;
  if (ACTION === 'created') {
    reason = checkCreated(payload);
  } else if (ACTION === 'completed') {
    reason = checkCompleted(payload);
  }

  if (reason) {
    process.stderr.write(`[team-task-guard:${ACTION}] ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[team-task-guard] 内部异常放行: ${err.message}\n`);
  process.exit(0);
}
