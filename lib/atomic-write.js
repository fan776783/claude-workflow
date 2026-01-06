/**
 * 跨平台原子写入
 *
 * 特性：
 * - POSIX: write tmp → fsync(tmp) → rename → fsync(dir)
 * - Windows: write tmp → FlushFileBuffers → unlink target → rename
 * - 随机临时文件名防止冲突
 * - 失败时记录诊断信息
 * - 支持降级为普通写入
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 跨平台原子写入文件
 * @param {string} filePath 目标文件路径
 * @param {string|Buffer} content 文件内容
 * @param {object} options 选项
 * @param {number} options.mode 文件权限
 * @param {string} options.encoding 编码
 * @returns {Promise<void>}
 */
async function atomicWriteFile(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  const filename = path.basename(filePath);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tempPath = path.join(dir, `.${filename}.tmp.${process.pid}.${randomSuffix}`);

  try {
    // 确保目录存在
    await fs.promises.mkdir(dir, { recursive: true });

    // 写入临时文件
    const fd = await fs.promises.open(tempPath, 'w', options.mode);
    try {
      await fd.writeFile(content, { encoding: options.encoding || 'utf8' });
      await fd.sync();  // fsync 文件内容
    } finally {
      await fd.close();
    }

    // 平台特定的替换逻辑
    if (process.platform === 'win32') {
      // Windows: 先删除目标文件（如果存在）
      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      // 然后重命名
      await fs.promises.rename(tempPath, filePath);
    } else {
      // POSIX: rename 是原子操作
      await fs.promises.rename(tempPath, filePath);

      // fsync 父目录（确保目录项更新持久化）
      try {
        const dirFd = await fs.promises.open(dir, 'r');
        try {
          await dirFd.sync();
        } finally {
          await dirFd.close();
        }
      } catch {
        // 某些文件系统不支持目录 fsync，忽略
      }
    }

  } catch (error) {
    // 清理临时文件
    try {
      await fs.promises.unlink(tempPath);
    } catch {}

    // 记录诊断信息
    const diagInfo = {
      error: error.message,
      code: error.code,
      platform: process.platform,
      filePath,
      tempPath,
      timestamp: new Date().toISOString()
    };
    console.error('原子写入失败:', JSON.stringify(diagInfo));

    throw error;
  }
}

/**
 * 原子写入 JSON 文件
 * @param {string} filePath 目标文件路径
 * @param {object} data JSON 数据
 * @param {object} options 选项
 * @returns {Promise<void>}
 */
async function atomicWriteJson(filePath, data, options = {}) {
  const content = JSON.stringify(data, null, 2) + '\n';
  await atomicWriteFile(filePath, content, options);
}

/**
 * 带降级的原子写入
 * 在不支持原子操作的环境（网络盘、某些容器卷）降级为普通写入
 * @param {string} filePath 目标文件路径
 * @param {string|Buffer} content 文件内容
 * @param {object} options 选项
 * @returns {Promise<{atomic: boolean}>}
 */
async function atomicWriteFileWithFallback(filePath, content, options = {}) {
  try {
    await atomicWriteFile(filePath, content, options);
    return { atomic: true };
  } catch (error) {
    // 检测是否是不支持原子操作的错误
    const isUnsupportedError =
      error.code === 'EXDEV' ||           // 跨设备 rename
      error.code === 'ENOTSUP' ||         // 不支持的操作
      error.code === 'EPERM' ||           // 权限问题（某些网络盘）
      (error.message && error.message.includes('network'));

    if (isUnsupportedError) {
      console.warn(`⚠️ 原子写入不支持，降级为普通写入：${filePath}`);

      // 确保目录存在
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

      // 普通写入
      await fs.promises.writeFile(filePath, content, options);
      return { atomic: false };
    }

    throw error;
  }
}

/**
 * 带降级的原子写入 JSON
 * @param {string} filePath 目标文件路径
 * @param {object} data JSON 数据
 * @param {object} options 选项
 * @returns {Promise<{atomic: boolean}>}
 */
async function atomicWriteJsonWithFallback(filePath, data, options = {}) {
  const content = JSON.stringify(data, null, 2) + '\n';
  return atomicWriteFileWithFallback(filePath, content, options);
}

/**
 * 安全读取 JSON 文件
 * @param {string} filePath 文件路径
 * @param {object} defaultValue 默认值（文件不存在或解析失败时返回）
 * @returns {Promise<object>}
 */
async function safeReadJson(filePath, defaultValue = null) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaultValue;
    }
    // JSON 解析失败
    if (error instanceof SyntaxError) {
      console.warn(`⚠️ JSON 解析失败：${filePath}`);
      return defaultValue;
    }
    throw error;
  }
}

/**
 * 检查文件是否存在
 * @param {string} filePath 文件路径
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保目录存在
 * @param {string} dirPath 目录路径
 * @returns {Promise<void>}
 */
async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

module.exports = {
  atomicWriteFile,
  atomicWriteJson,
  atomicWriteFileWithFallback,
  atomicWriteJsonWithFallback,
  safeReadJson,
  fileExists,
  ensureDir
};
