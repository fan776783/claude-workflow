/**
 * HMAC 敏感信息处理
 *
 * 特性：
 * - 本机随机生成 32 字节密钥
 * - 密钥存储在 ~/.claude/.secret-key
 * - 使用 HMAC-SHA-256
 * - 无法通过字典枚举反推原文
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { atomicWriteFile, ensureDir } = require('./atomic-write');

// 密钥文件路径
const SECRET_KEY_PATH = path.join(os.homedir(), '.claude', '.secret-key');

// 密钥长度（字节）
const KEY_LENGTH = 32;

/**
 * 获取或创建密钥
 * @returns {Promise<Buffer>}
 */
async function getOrCreateSecretKey() {
  try {
    const keyHex = await fs.promises.readFile(SECRET_KEY_PATH, 'utf8');
    return Buffer.from(keyHex.trim(), 'hex');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 密钥不存在，创建新密钥
      return createSecretKey();
    }
    throw error;
  }
}

/**
 * 创建新密钥
 * @returns {Promise<Buffer>}
 */
async function createSecretKey() {
  const key = crypto.randomBytes(KEY_LENGTH);
  const keyHex = key.toString('hex');

  await ensureDir(path.dirname(SECRET_KEY_PATH));
  await atomicWriteFile(SECRET_KEY_PATH, keyHex, { mode: 0o600 });

  return key;
}

/**
 * 轮换密钥
 * @returns {Promise<{oldKey: Buffer, newKey: Buffer}>}
 */
async function rotateSecretKey() {
  let oldKey = null;

  try {
    const keyHex = await fs.promises.readFile(SECRET_KEY_PATH, 'utf8');
    oldKey = Buffer.from(keyHex.trim(), 'hex');

    // 备份旧密钥
    const backupPath = `${SECRET_KEY_PATH}.backup.${Date.now()}`;
    await fs.promises.copyFile(SECRET_KEY_PATH, backupPath);
  } catch {
    // 忽略
  }

  const newKey = await createSecretKey();

  return { oldKey, newKey };
}

/**
 * 计算 HMAC
 * @param {string} data 数据
 * @param {Buffer} key 密钥
 * @returns {string}
 */
function computeHmac(data, key) {
  return crypto.createHmac('sha256', key)
    .update(data)
    .digest('hex');
}

/**
 * 敏感信息处理器
 */
class SensitiveDataHandler {
  constructor() {
    this.key = null;
    this.initialized = false;
  }

  /**
   * 初始化
   */
  async init() {
    if (!this.initialized) {
      this.key = await getOrCreateSecretKey();
      this.initialized = true;
    }
  }

  /**
   * 确保已初始化
   */
  async ensureInit() {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * 哈希敏感数据
   * @param {string} data 敏感数据
   * @returns {Promise<string>}
   */
  async hash(data) {
    await this.ensureInit();
    return `hmac:${computeHmac(String(data), this.key)}`;
  }

  /**
   * 验证哈希
   * @param {string} data 原始数据
   * @param {string} hash 哈希值
   * @returns {Promise<boolean>}
   */
  async verify(data, hash) {
    await this.ensureInit();

    if (!hash.startsWith('hmac:')) {
      return false;
    }

    const expectedHash = await this.hash(data);
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(expectedHash)
    );
  }

  /**
   * 哈希路径（用于存储时隐藏真实路径）
   * @param {string} filePath 文件路径
   * @returns {Promise<string>}
   */
  async hashPath(filePath) {
    const absolutePath = path.resolve(filePath);
    return this.hash(absolutePath);
  }

  /**
   * 哈希用户标识
   * @param {string} userId 用户 ID
   * @returns {Promise<string>}
   */
  async hashUserId(userId) {
    return this.hash(userId);
  }

  /**
   * 哈希主机名
   * @param {string} hostname 主机名
   * @returns {Promise<string>}
   */
  async hashHostname(hostname) {
    return this.hash(hostname);
  }

  /**
   * 处理对象中的敏感字段
   * @param {object} obj 对象
   * @param {string[]} sensitiveFields 敏感字段列表
   * @returns {Promise<object>}
   */
  async hashObjectFields(obj, sensitiveFields) {
    await this.ensureInit();

    const result = { ...obj };

    for (const field of sensitiveFields) {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = await this.hash(String(result[field]));
      }
    }

    return result;
  }

  /**
   * 轮换密钥并重新哈希数据
   * @param {object[]} dataItems 数据项列表
   * @param {string[]} sensitiveFields 敏感字段列表
   * @param {Function} getOriginalValue 获取原始值的函数
   * @returns {Promise<object[]>}
   */
  async rotateAndRehash(dataItems, sensitiveFields, getOriginalValue) {
    const { oldKey, newKey } = await rotateSecretKey();
    this.key = newKey;

    const results = [];

    for (const item of dataItems) {
      const newItem = { ...item };

      for (const field of sensitiveFields) {
        if (item[field] !== undefined) {
          // 获取原始值（需要外部提供）
          const originalValue = await getOriginalValue(item, field);
          if (originalValue) {
            newItem[field] = await this.hash(originalValue);
          }
        }
      }

      results.push(newItem);
    }

    return results;
  }

  /**
   * 检查密钥是否存在
   * @returns {Promise<boolean>}
   */
  async hasSecretKey() {
    try {
      await fs.promises.access(SECRET_KEY_PATH);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取密钥信息（不暴露密钥本身）
   * @returns {Promise<object>}
   */
  async getKeyInfo() {
    try {
      const stats = await fs.promises.stat(SECRET_KEY_PATH);
      return {
        exists: true,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        size: stats.size
      };
    } catch {
      return {
        exists: false
      };
    }
  }
}

// 单例实例
let instance = null;

/**
 * 获取敏感数据处理器实例
 * @returns {SensitiveDataHandler}
 */
function getSensitiveDataHandler() {
  if (!instance) {
    instance = new SensitiveDataHandler();
  }
  return instance;
}

module.exports = {
  getOrCreateSecretKey,
  createSecretKey,
  rotateSecretKey,
  computeHmac,
  SensitiveDataHandler,
  getSensitiveDataHandler,
  SECRET_KEY_PATH
};
