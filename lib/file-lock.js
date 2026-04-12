/**
 * 可续租文件锁
 *
 * 特性：
 * - 心跳续租（每 5 秒更新）
 * - 过期检测（60 秒无心跳视为过期）
 * - 进程存活检测（同机器检查 PID）
 * - nonce 防止 PID 复用误判
 * - 不默认强制抢锁
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// 配置常量
const HEARTBEAT_INTERVAL = 5000;   // 5 秒心跳
const STALE_THRESHOLD = 60000;     // 60 秒无心跳视为过期
const ACQUIRE_TIMEOUT = 10000;     // 10 秒获取超时
const RETRY_INTERVAL = 500;        // 重试间隔

/**
 * 可续租文件锁
 */
class RenewableLock {
  /**
   * @param {string} targetPath 要加锁的目标文件路径
   */
  constructor(targetPath) {
    this.lockPath = `${targetPath}.lock`;
    this.lockInfo = null;
    this.heartbeatInterval = null;
    this.acquired = false;
  }

  /**
   * 获取锁
   * @param {string} operation 操作描述
   * @param {number} timeout 超时时间（毫秒）
   * @returns {Promise<boolean>}
   */
  async acquire(operation, timeout = ACQUIRE_TIMEOUT) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // 尝试创建锁文件
        const lockInfo = {
          pid: process.pid,
          hostname: os.hostname(),
          startedAt: Date.now(),
          lastHeartbeat: Date.now(),
          nonce: crypto.randomBytes(8).toString('hex'),
          operation: operation || 'unknown'
        };

        await fs.promises.writeFile(
          this.lockPath,
          JSON.stringify(lockInfo, null, 2),
          { flag: 'wx' }  // O_EXCL - 文件存在则失败
        );

        this.lockInfo = lockInfo;
        this.acquired = true;
        this.startHeartbeat();
        return true;

      } catch (error) {
        if (error.code === 'EEXIST') {
          // 锁已存在，检查是否可以接管
          const canTakeover = await this.checkAndTakeover();
          if (canTakeover) {
            continue;  // 重试获取
          }

          // 等待后重试
          await this.sleep(RETRY_INTERVAL);
        } else if (error.code === 'ENOENT') {
          // 目录不存在，创建目录
          await fs.promises.mkdir(path.dirname(this.lockPath), { recursive: true });
        } else {
          throw error;
        }
      }
    }

    return false;
  }

  /**
   * 检查并尝试接管过期锁
   * @returns {Promise<boolean>} 是否成功清理了过期锁
   */
  async checkAndTakeover() {
    const existingLock = await this.readLockInfo();
    if (!existingLock) {
      return true;  // 锁文件已不存在
    }

    // 检查锁是否过期
    if (!this.isLockStale(existingLock)) {
      return false;  // 锁未过期
    }

    // 检查持有锁的进程是否还存活
    if (existingLock.hostname === os.hostname()) {
      // 同一机器，检查 PID
      if (this.isProcessAlive(existingLock.pid)) {
        // 进程还在但心跳停止，可能是卡死
        console.warn(`⚠️ 锁持有进程 ${existingLock.pid} 仍存活但心跳停止，等待...`);
        return false;
      }

      // 进程不存在，可以接管
      console.log(`🔓 检测到孤立锁（PID ${existingLock.pid} 已不存在），正在清理...`);
    } else {
      // 不同机器，只能依赖心跳超时
      console.log(`🔓 检测到过期锁（来自 ${existingLock.hostname}），正在清理...`);
    }

    // 尝试删除过期锁
    try {
      await fs.promises.unlink(this.lockPath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true;  // 已被其他进程删除
      }
      return false;
    }
  }

  /**
   * 检查锁是否过期
   * @param {object} lockInfo 锁信息对象
   * @returns {boolean} 是否已过期
   */
  isLockStale(lockInfo) {
    const timeSinceHeartbeat = Date.now() - lockInfo.lastHeartbeat;
    return timeSinceHeartbeat > STALE_THRESHOLD;
  }

  /**
   * 检查进程是否存活
   * @param {number} pid 进程 ID
   * @returns {boolean} 进程是否存活
   */
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);  // 发送信号 0 检查进程是否存在
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 启动心跳定时器，定期更新锁文件的心跳时间戳
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      if (!this.lockInfo || !this.acquired) {
        this.stopHeartbeat();
        return;
      }

      try {
        // 先读取当前锁信息，验证所有权
        const currentLock = await this.readLockInfo();
        if (!currentLock || currentLock.nonce !== this.lockInfo.nonce) {
          // 锁已被抢占
          console.warn('⚠️ 锁已被其他进程接管');
          this.acquired = false;
          this.stopHeartbeat();
          return;
        }

        // 更新心跳
        this.lockInfo.lastHeartbeat = Date.now();
        await fs.promises.writeFile(
          this.lockPath,
          JSON.stringify(this.lockInfo, null, 2)
        );
      } catch (error) {
        // 心跳失败
        console.warn('⚠️ 心跳更新失败:', error.message);
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳定时器
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 释放当前持有的锁，停止心跳并删除锁文件
   * @returns {Promise<void>}
   */
  async release() {
    this.stopHeartbeat();

    if (!this.acquired || !this.lockInfo) {
      return;
    }

    try {
      // 验证锁仍属于自己
      const currentLock = await this.readLockInfo();
      if (currentLock && currentLock.nonce === this.lockInfo.nonce) {
        await fs.promises.unlink(this.lockPath);
      }
    } catch (error) {
      // 忽略删除失败
    }

    this.acquired = false;
    this.lockInfo = null;
  }

  /**
   * 读取锁文件中的锁信息
   * @returns {Promise<object|null>} 锁信息对象，文件不存在或解析失败时返回 null
   */
  async readLockInfo() {
    try {
      const content = await fs.promises.readFile(this.lockPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 等待指定毫秒数
   * @param {number} ms 等待时间（毫秒）
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 检查当前是否持有锁
   * @returns {boolean}
   */
  isAcquired() {
    return this.acquired;
  }

  /**
   * 获取当前锁的详细信息
   * @returns {object|null} 锁信息对象，未持有锁时返回 null
   */
  getLockInfo() {
    return this.lockInfo;
  }
}

/**
 * 使用锁执行操作
 * @param {string} targetPath 目标文件路径
 * @param {string} operation 操作描述
 * @param {Function} fn 要执行的函数
 * @param {number} timeout 获取锁超时时间
 * @returns {Promise<any>}
 */
async function withLock(targetPath, operation, fn, timeout = ACQUIRE_TIMEOUT) {
  const lock = new RenewableLock(targetPath);

  if (!await lock.acquire(operation, timeout)) {
    const existingLock = await lock.readLockInfo();
    const holder = existingLock
      ? `${existingLock.hostname}:${existingLock.pid} (${existingLock.operation})`
      : 'unknown';
    throw new Error(`无法获取文件锁：${targetPath}\n当前持有者：${holder}`);
  }

  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * 检查文件是否被锁定
 * @param {string} targetPath 目标文件路径
 * @returns {Promise<{locked: boolean, lockInfo: object|null}>}
 */
async function checkLockStatus(targetPath) {
  const lockPath = `${targetPath}.lock`;

  try {
    const content = await fs.promises.readFile(lockPath, 'utf8');
    const lockInfo = JSON.parse(content);

    // 检查锁是否过期
    const timeSinceHeartbeat = Date.now() - lockInfo.lastHeartbeat;
    const isStale = timeSinceHeartbeat > STALE_THRESHOLD;

    return {
      locked: !isStale,
      lockInfo: {
        ...lockInfo,
        isStale,
        timeSinceHeartbeat
      }
    };
  } catch {
    return { locked: false, lockInfo: null };
  }
}

module.exports = {
  RenewableLock,
  withLock,
  checkLockStatus,
  HEARTBEAT_INTERVAL,
  STALE_THRESHOLD,
  ACQUIRE_TIMEOUT
};
