/**
 * ULID 生成工具
 *
 * ULID (Universally Unique Lexicographically Sortable Identifier)
 * - 26 字符，Crockford Base32 编码
 * - 时间有序，单调递增
 * - 无碰撞（同毫秒内随机部分递增）
 * - URL 安全
 */

const crypto = require('crypto');

// Crockford Base32 字符集（排除 I, L, O, U 避免混淆）
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

// 上次生成的时间戳和随机部分（用于单调递增）
let lastTime = 0;
let lastRandom = new Array(RANDOM_LEN).fill(0);

/**
 * 生成 ULID
 * @returns {string} 26 字符的 ULID
 */
function ulid() {
  const now = Date.now();

  if (now === lastTime) {
    // 同毫秒内，随机部分递增
    incrementRandom();
  } else {
    // 新毫秒，重新生成随机部分
    lastTime = now;
    generateRandom();
  }

  return encodeTime(now) + encodeRandom();
}

/**
 * 编码时间戳部分（10 字符）
 */
function encodeTime(time) {
  let str = '';
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    str = ENCODING[mod] + str;
    time = Math.floor(time / ENCODING_LEN);
  }
  return str;
}

/**
 * 编码随机部分（16 字符）
 */
function encodeRandom() {
  let str = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[lastRandom[i]];
  }
  return str;
}

/**
 * 生成新的随机部分
 */
function generateRandom() {
  const bytes = crypto.randomBytes(RANDOM_LEN);
  for (let i = 0; i < RANDOM_LEN; i++) {
    lastRandom[i] = bytes[i] % ENCODING_LEN;
  }
}

/**
 * 递增随机部分（保证单调递增）
 */
function incrementRandom() {
  for (let i = RANDOM_LEN - 1; i >= 0; i--) {
    if (lastRandom[i] < ENCODING_LEN - 1) {
      lastRandom[i]++;
      return;
    }
    lastRandom[i] = 0;
  }
  // 溢出（极端情况），等待下一毫秒
  throw new Error('ULID random overflow');
}

/**
 * 解析 ULID 的时间戳
 * @param {string} id ULID
 * @returns {number} Unix 时间戳（毫秒）
 */
function decodeTime(id) {
  if (typeof id !== 'string' || id.length !== 26) {
    throw new Error('Invalid ULID');
  }

  const timeStr = id.substring(0, TIME_LEN).toUpperCase();
  let time = 0;

  for (let i = 0; i < TIME_LEN; i++) {
    const char = timeStr[i];
    const index = ENCODING.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid ULID character: ${char}`);
    }
    time = time * ENCODING_LEN + index;
  }

  return time;
}

/**
 * 生成带前缀的 ID
 * @param {string} prefix 前缀（如 'plan', 'run', 'dec'）
 * @returns {string} 带前缀的 ID
 */
function generateId(prefix) {
  return `${prefix}-${ulid()}`;
}

/**
 * 生成 Plan ID
 * @returns {string} plan-{ulid}
 */
function generatePlanId() {
  return generateId('plan');
}

/**
 * 生成 Run ID
 * @returns {string} run-{ulid}
 */
function generateRunId() {
  return generateId('run');
}

/**
 * 生成 Decision ID
 * @returns {string} dec-{ulid}
 */
function generateDecisionId() {
  return generateId('dec');
}

/**
 * 验证 ULID 格式
 * @param {string} id ULID 或带前缀的 ID
 * @returns {boolean}
 */
function isValidUlid(id) {
  if (typeof id !== 'string') return false;

  // 支持带前缀的格式
  const parts = id.split('-');
  const ulidPart = parts.length > 1 ? parts.slice(1).join('-') : id;

  if (ulidPart.length !== 26) return false;

  const upper = ulidPart.toUpperCase();
  for (let i = 0; i < 26; i++) {
    if (ENCODING.indexOf(upper[i]) === -1) return false;
  }

  return true;
}

module.exports = {
  ulid,
  decodeTime,
  generateId,
  generatePlanId,
  generateRunId,
  generateDecisionId,
  isValidUlid
};
