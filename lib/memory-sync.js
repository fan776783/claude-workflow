/**
 * Agent 全局 memory 文件分发。
 *
 * canonical 下的 memory 源（<canonical>/core/{AGENTS,GEMINI}.md，由 installToCanonical 落盘）
 * 按各工具原生文件名分发到对应 config home：
 *   AGENTS.md → Codex(~/.codex) / Cursor(~/.cursor) / Droid(~/.factory) /
 *               Copilot(~/.copilot) / OpenCode(~/.config/opencode)
 *   GEMINI.md → Antigravity(~/.gemini)
 * 目标路径由 lib/agents.js 各 agent 的 globalMemory.globalDest 声明。
 *
 * 语义对齐 lib/claude-code-plugin.js#syncClaudeMd（Claude 的 CLAUDE.md 仍由该模块负责，
 * 含 migration log，不走这里）：
 *   - 源不存在            → skipped(source-not-found)
 *   - 目标存在且内容相同  → skipped(identical)
 *   - 目标不存在          → create
 *   - 目标存在且内容不同  → 备份 <dest>.bak.<timestamp> 后 overwrite（历史不丢）
 */

'use strict';

const path = require('path');
const fs = require('fs-extra');

const { agents } = require('./agents');

/**
 * 2026-04-27T02-04-10-123Z：ISO 格式，冒号/句点换成短横线，
 * Windows 与 POSIX FS 都安全；保留毫秒避免同秒两次 sync 碰撞。
 */
function buildBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * 同步单个 memory 文件。
 * @param {Object} opts
 * @param {string} opts.canonicalDir - canonical 目录（其 core/ 下放 memory 源）
 * @param {string} opts.source       - 源文件名（如 'AGENTS.md'）
 * @param {string} opts.globalDest   - 目标绝对路径（工具 config home 下）
 * @returns {Promise<Object>} { skipped, reason?, action?, destPath, backup? }
 */
async function syncMemoryFile({ canonicalDir, source, globalDest } = {}) {
  const srcPath = path.join(canonicalDir, 'core', source);

  if (!(await fs.pathExists(srcPath))) {
    return { skipped: true, reason: 'source-not-found', srcPath };
  }

  const srcContent = await fs.readFile(srcPath, 'utf8');
  let action = 'create';
  let backupPath = null;

  if (await fs.pathExists(globalDest)) {
    const destContent = await fs.readFile(globalDest, 'utf8');
    if (srcContent === destContent) {
      return { skipped: true, reason: 'identical', destPath: globalDest };
    }
    action = 'overwrite';
    backupPath = `${globalDest}.bak.${buildBackupTimestamp()}`;
    await fs.copy(globalDest, backupPath, { overwrite: false });
  }

  await fs.ensureDir(path.dirname(globalDest));
  await fs.writeFile(globalDest, srcContent, 'utf8');

  return { skipped: false, action, destPath: globalDest, backup: backupPath };
}

/**
 * 为一批 agent 分发其声明的 globalMemory。没有 globalMemory 字段的 agent 直接跳过。
 * @param {Object} opts
 * @param {string} opts.canonicalDir
 * @param {string[]} opts.agentNames
 * @returns {Promise<Array<{agent, source, result}>>} 每个有 globalMemory 的 agent 一条记录
 */
async function syncAgentMemories({ canonicalDir, agentNames } = {}) {
  const out = [];
  for (const name of agentNames || []) {
    const mem = agents[name] && agents[name].globalMemory;
    if (!mem) continue;
    const result = await syncMemoryFile({
      canonicalDir,
      source: mem.source,
      globalDest: mem.globalDest,
    });
    out.push({ agent: name, source: mem.source, result });
  }
  return out;
}

module.exports = {
  buildBackupTimestamp,
  syncMemoryFile,
  syncAgentMemories,
};
