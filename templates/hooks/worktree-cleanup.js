#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * WorktreeRemove Hook — 最佳努力清理 worktree。
 *
 * 在 worktree 删除时执行引用清理，同时释放串行化锁（如果存在），
 * 并回收 Claude Code 默认托管目录下的孤立 worktree 目录，
 * 帮助加速后续 worktree 创建。
 *
 * 配置方法（.claude/settings.json）:
 *   {
 *     "hooks": {
 *       "WorktreeRemove": [
 *         {
 *           "hooks": [{
 *             "type": "command",
 *             "command": "node .agents/agent-workflow/hooks/worktree-cleanup.js"
 *           }]
 *         }
 *       ]
 *     }
 *   }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function normalizePath(targetPath) {
  return path.resolve(targetPath);
}

/**
 * 获取 git 公共目录
 */
function getGitCommonDir() {
  try {
    const result = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return path.resolve(result);
  } catch {
    return null;
  }
}

/**
 * 获取仓库根目录
 */
function getRepoRoot() {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return path.resolve(result);
  } catch {
    return null;
  }
}

/**
 * 获取当前仍被 git 注册的 worktree 路径集合
 */
function listActiveWorktreePaths() {
  try {
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const active = new Set();
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        active.add(normalizePath(line.slice(9).trim()));
      }
    }
    return active;
  } catch {
    return new Set();
  }
}

/**
 * 仅清理 Claude Code 默认托管目录下的孤立 worktree 目录
 */
function cleanupManagedWorktreeDirs(repoRoot) {
  if (!repoRoot) return;

  const managedBaseDir = path.join(repoRoot, '.claude', 'worktrees');
  if (!fs.existsSync(managedBaseDir) || !fs.statSync(managedBaseDir).isDirectory()) {
    return;
  }

  const normalizedBaseDir = normalizePath(managedBaseDir);
  const activePaths = listActiveWorktreePaths();

  for (const entry of fs.readdirSync(managedBaseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(managedBaseDir, entry.name);
    const normalizedPath = normalizePath(fullPath);
    if (!normalizedPath.startsWith(`${normalizedBaseDir}${path.sep}`)) continue;
    if (activePaths.has(normalizedPath)) continue;

    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch {
      // 最佳努力，忽略错误
    }
  }
}

/**
 * 清理串行化锁（最佳努力）
 */
function cleanupSerializeLock(gitCommonDir) {
  if (!gitCommonDir) return;

  const lockDir = path.join(gitCommonDir, 'worktree-serialize.lock');
  try {
    const infoPath = path.join(lockDir, 'info.json');
    try { fs.unlinkSync(infoPath); } catch { /* 忽略 */ }
    fs.rmdirSync(lockDir);
  } catch {
    // 锁不存在或已被清理，忽略
  }
}

/**
 * 清理孤立 worktree 引用
 */
function pruneWorktrees() {
  try {
    execSync('git worktree prune', {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // 最佳努力，忽略错误
  }
}

function main() {
  // 1. 读取 stdin（hook input）
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) {
      JSON.parse(raw);
    }
  } catch {
    // stdin 读取失败不影响清理
  }

  const repoRoot = getRepoRoot();
  const gitCommonDir = getGitCommonDir();

  // 2. 清理孤立 worktree 引用
  pruneWorktrees();

  // 3. 回收 Claude Code 默认托管目录下的孤立 worktree 目录
  cleanupManagedWorktreeDirs(repoRoot);

  // 4. 释放串行化锁（加速后续创建）
  cleanupSerializeLock(gitCommonDir);

  // 5. 输出结果
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[worktree-cleanup] 错误: ${err.message}\n`);
  // 出错时放行
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}
