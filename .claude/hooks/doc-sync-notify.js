#!/usr/bin/env node
/**
 * PostToolUse(Edit|Write|MultiEdit) hook：检测本次改动是否命中 .claude/doc-sync.json 中声明的本地文件，
 * 命中则通过 stderr 输出 <system-reminder>，提醒 Claude 立即用 mcp__mcp-router__update_document
 * 对绑定的钉钉 nodeId 做全量覆盖（mode=overwrite，markdown 为文件最新全量内容）。
 *
 * 本 hook 只发提醒，不自己调 MCP（MCP 工具仅在 Claude 会话内可用）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function findRepoRoot(startDir) {
  let dir = startDir;
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.claude', 'doc-sync.json'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdinSync() || '{}');
  } catch {
    return;
  }

  const toolName = payload.tool_name || payload.toolName || '';
  if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) return;

  const input = payload.tool_input || payload.toolInput || {};
  const filePath = input.file_path || input.filePath;
  if (!filePath) return;

  const cwd = payload.cwd || process.cwd();
  const repoRoot = findRepoRoot(cwd) || findRepoRoot(path.dirname(filePath)) || cwd;

  let configRaw;
  try {
    configRaw = fs.readFileSync(path.join(repoRoot, '.claude', 'doc-sync.json'), 'utf8');
  } catch {
    return;
  }

  let config;
  try {
    config = JSON.parse(configRaw);
  } catch {
    return;
  }

  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  if (!bindings.length) return;

  const absPath = path.resolve(filePath);
  const relPosix = path.relative(repoRoot, absPath).split(path.sep).join('/');

  const hit = bindings.find((b) => b && b.path === relPosix);
  if (!hit) return;

  const targets = Array.isArray(hit.targets) ? hit.targets.filter((t) => t && t.nodeId) : [];
  if (!targets.length) return;

  const lines = [
    '',
    '<system-reminder>',
    `Doc-sync hook triggered: 本地文件 \`${relPosix}\` 已变更，需要立即全量覆盖同步到以下钉钉文档。`,
    '',
    '操作步骤（本轮响应内完成，不要让用户手动执行）：',
    `1. 用 Read 读取 \`${absPath}\` 的最新全量内容`,
    '2. 对下列每一个 nodeId 调用一次 `mcp__mcp-router__update_document`，参数：',
    '   - `nodeId`: 如下所列',
    '   - `mode`: `overwrite`',
    '   - `markdown`: 文件完整内容（不要截断、不要省略，钉钉按 Markdown 渲染）',
    '3. 任一目标失败时，告知用户失败的 nodeId 和原因；成功的目标不回滚。',
    '',
    '同步目标：',
    ...targets.map((t) => `- nodeId=\`${t.nodeId}\`${t.name ? ` (${t.name})` : ''}`),
    '',
    '映射来源：`.claude/doc-sync.json`。若不应再同步，改该文件的 bindings。',
    '</system-reminder>',
    '',
  ];

  process.stderr.write(lines.join('\n'));
}

main();
