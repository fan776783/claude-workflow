#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * WorktreeCreate Hook — 串行化 git worktree add 防止并行竞争。
 *
 * 解决多个 subagent 同时创建 worktree 时 .git/config.lock 竞争导致失败的问题。
 * 上游 Bug: https://github.com/anthropics/claude-code/issues/34645
 *
 * 原理：
 *   使用 mkdir 原子锁（跨平台）串行化 worktree 创建请求。
 *   锁采用"创建后不主动释放 + 自动过期"策略：
 *     - hook 获取锁后输出 allow 并退出（不释放锁文件）
 *     - 下一个 hook 等待锁过期后才获取锁
 *     - 过期时间覆盖一次 git worktree add 操作（默认 10 秒）
 *
 * 配置方法（.claude/settings.json）:
 *   {
 *     "hooks": {
 *       "WorktreeCreate": [
 *         {
 *           "hooks": [{
 *             "type": "command",
 *             "command": "node .agents/agent-workflow/hooks/worktree-serialize.js"
 *           }]
 *         }
 *       ]
 *     }
 *   }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ============================================
// 配置常量
// ============================================

// 锁自动过期时间：覆盖一次 git worktree add 操作
const AUTO_EXPIRE_MS = 10000;

// 获取锁的总超时（超时后强制放行，避免永久阻塞）
const DEADLINE_MS = 30000;

// 重试退避参数
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 2000;
const RETRY_JITTER_MS = 200;

// ============================================
// 工具函数
// ============================================

/**
 * 获取 git 公共目录（主仓库的 .git 目录）。
 * 在 worktree 内部 .git 是文件而非目录，
 * 使用 --git-common-dir 确保获取主仓库路径。
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
    // 回退：尝试直接使用 .git
    const fallback = path.resolve('.git');
    if (fs.existsSync(fallback) && fs.statSync(fallback).isDirectory()) {
      return fallback;
    }
    return null;
  }
}

/**
 * 非阻塞 sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 计算带抖动的退避延迟
 */
function backoffDelay(attempt) {
  const base = Math.min(RETRY_BASE_MS * Math.pow(1.5, attempt), RETRY_MAX_MS);
  const jitter = Math.random() * RETRY_JITTER_MS;
  return Math.floor(base + jitter);
}

/**
 * 读取锁信息
 */
function readLockInfo(lockInfoPath) {
  try {
    const content = fs.readFileSync(lockInfoPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 检查进程是否存活
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查锁是否可以被清理
 * 条件：过期 或 持有进程已死亡（同机器时检查 PID）
 */
function canCleanupLock(lockInfo) {
  if (!lockInfo || !lockInfo.timestamp) return true;

  // 检查是否过期
  const elapsed = Date.now() - lockInfo.timestamp;
  if (elapsed > AUTO_EXPIRE_MS) return true;

  // 同机器检查 PID 存活
  if (lockInfo.hostname === os.hostname() && lockInfo.pid) {
    if (!isProcessAlive(lockInfo.pid)) return true;
  }

  return false;
}

/**
 * 尝试清理锁目录
 */
function cleanupLock(lockDir) {
  try {
    // 先删除 info.json
    const infoPath = path.join(lockDir, 'info.json');
    try { fs.unlinkSync(infoPath); } catch { /* 忽略 */ }

    // 再删除目录
    fs.rmdirSync(lockDir);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// 主逻辑
// ============================================

async function main() {
  // 1. 读取 stdin（hook input）
  let hookInput = {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) {
      hookInput = JSON.parse(raw);
    }
  } catch {
    // stdin 读取失败不影响核心逻辑
  }

  // 2. 获取锁路径
  const gitCommonDir = getGitCommonDir();
  if (!gitCommonDir) {
    // 非 git 仓库，直接放行
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const lockDir = path.join(gitCommonDir, 'worktree-serialize.lock');
  const lockInfoPath = path.join(lockDir, 'info.json');

  // 3. 获取锁（带超时）
  const startTime = Date.now();
  let attempt = 0;
  let acquired = false;

  while (Date.now() - startTime < DEADLINE_MS) {
    try {
      // mkdir 原子操作：目录不存在则创建成功，已存在则抛 EEXIST
      fs.mkdirSync(lockDir);
      acquired = true;

      // 写入锁信息（用于过期和 PID 检测）
      const lockInfo = {
        pid: process.pid,
        hostname: os.hostname(),
        timestamp: Date.now(),
        nonce: crypto.randomBytes(8).toString('hex'),
        worktree: hookInput.worktree_name || 'unknown',
      };

      try {
        fs.writeFileSync(lockInfoPath, JSON.stringify(lockInfo, null, 2));
      } catch {
        // 写入失败不阻碍串行化，目录锁本身足够
      }

      break;

    } catch (err) {
      if (err.code === 'EEXIST') {
        // 锁已存在，检查是否可清理
        const existingInfo = readLockInfo(lockInfoPath);

        if (canCleanupLock(existingInfo)) {
          // 锁可清理（过期或进程死亡）
          if (cleanupLock(lockDir)) {
            continue; // 重试获取
          }
        }

        // 锁仍被持有，等待
        const delay = backoffDelay(attempt);
        await sleep(delay);
        attempt++;

      } else if (err.code === 'ENOENT') {
        // 父目录不存在（git common dir 已被清理等极端情况）
        // 直接放行
        break;

      } else {
        // 其他错误，直接放行
        process.stderr.write(
          `[worktree-serialize] 获取锁时发生意外错误: ${err.message}\n`
        );
        break;
      }
    }
  }

  // 4. 超时放行日志
  if (!acquired && Date.now() - startTime >= DEADLINE_MS) {
    process.stderr.write(
      `[worktree-serialize] 获取锁超时(${DEADLINE_MS}ms)，强制放行\n`
    );
  }

  // 5. 注意：故意不释放锁！
  // 锁文件留在磁盘上，通过 AUTO_EXPIRE_MS 自动过期。
  // 这确保在 hook 退出后、git worktree add 执行期间，
  // 其他 hook 仍能感知到锁的存在，从而实现串行化。

  // 6. 输出结果
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[worktree-serialize] 致命错误: ${err.message}\n`);
  // 出错时放行，避免阻塞 worktree 创建
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
});
