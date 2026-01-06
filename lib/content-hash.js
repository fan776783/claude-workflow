/**
 * ContentHash 规范化与 stablePath 同步
 *
 * ContentHash 规范化（最小规范化，不改变语义）：
 * 1. 编码：UTF-8
 * 2. 换行：CRLF → LF, CR → LF
 * 3. 文件末尾：确保有且仅有一个换行符
 * 4. 不修改行内空白
 *
 * stablePath 同步模式：
 * - none: 不添加任何标记
 * - frontmatter: 使用 YAML front-matter
 * - comment: 使用 HTML 注释（文件末尾）
 * - sidecar: 使用旁路文件（.sync.json）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteFile, atomicWriteJson, safeReadJson } = require('./atomic-write');

/**
 * 规范化内容（用于哈希计算）
 * @param {string} content 原始内容
 * @returns {string} 规范化后的内容
 */
function normalizeContent(content) {
  if (typeof content !== 'string') {
    content = String(content);
  }

  // 1. CRLF → LF, CR → LF
  let normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. 确保有且仅有一个换行符结尾
  normalized = normalized.replace(/\n*$/, '\n');

  return normalized;
}

/**
 * 计算内容哈希
 * @param {string} content 内容
 * @returns {string} sha256:{hex}
 */
function computeContentHash(content) {
  const normalized = normalizeContent(content);
  const hash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * 验证内容哈希
 * @param {string} content 内容
 * @param {string} expectedHash 期望的哈希值
 * @returns {boolean}
 */
function verifyContentHash(content, expectedHash) {
  const actualHash = computeContentHash(content);
  return actualHash === expectedHash;
}

/**
 * stablePath 同步模式
 */
const SyncMode = {
  NONE: 'none',
  FRONTMATTER: 'frontmatter',
  COMMENT: 'comment',
  SIDECAR: 'sidecar'
};

/**
 * stablePath 同步管理器
 */
class StablePathSync {
  constructor(options = {}) {
    this.mode = options.mode || SyncMode.FRONTMATTER;
    this.planId = options.planId;
    this.versionId = options.versionId;
  }

  /**
   * 写入带同步标记的内容
   * @param {string} filePath 目标文件路径
   * @param {string} content 内容
   * @returns {Promise<void>}
   */
  async write(filePath, content) {
    switch (this.mode) {
      case SyncMode.NONE:
        await this.writeNone(filePath, content);
        break;
      case SyncMode.FRONTMATTER:
        await this.writeFrontmatter(filePath, content);
        break;
      case SyncMode.COMMENT:
        await this.writeComment(filePath, content);
        break;
      case SyncMode.SIDECAR:
        await this.writeSidecar(filePath, content);
        break;
      default:
        throw new Error(`Unknown sync mode: ${this.mode}`);
    }
  }

  /**
   * 读取内容（去除同步标记）
   * @param {string} filePath 文件路径
   * @returns {Promise<{content: string, meta: object|null}>}
   */
  async read(filePath) {
    const raw = await fs.promises.readFile(filePath, 'utf8');

    switch (this.mode) {
      case SyncMode.NONE:
        return { content: raw, meta: null };
      case SyncMode.FRONTMATTER:
        return this.parseFrontmatter(raw);
      case SyncMode.COMMENT:
        return this.parseComment(raw);
      case SyncMode.SIDECAR:
        return this.parseSidecar(filePath, raw);
      default:
        return { content: raw, meta: null };
    }
  }

  /**
   * 检测文件的同步元数据
   * @param {string} filePath 文件路径
   * @returns {Promise<object|null>}
   */
  async detectMeta(filePath) {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');

      // 尝试 frontmatter
      const fmResult = this.parseFrontmatter(raw);
      if (fmResult.meta) return fmResult.meta;

      // 尝试 comment
      const cmResult = this.parseComment(raw);
      if (cmResult.meta) return cmResult.meta;

      // 尝试 sidecar
      const scResult = await this.parseSidecar(filePath, raw);
      if (scResult.meta) return scResult.meta;

      return null;
    } catch {
      return null;
    }
  }

  // ========== 私有方法 ==========

  async writeNone(filePath, content) {
    await atomicWriteFile(filePath, normalizeContent(content));
  }

  async writeFrontmatter(filePath, content) {
    const meta = this.buildMeta(content);
    const frontmatter = [
      '---',
      `plan_id: ${meta.planId}`,
      `version: ${meta.versionId}`,
      `content_hash: ${meta.contentHash}`,
      `synced_at: ${meta.syncedAt}`,
      '---',
      ''
    ].join('\n');

    // 移除已有的 frontmatter
    const cleanContent = this.stripFrontmatter(content);
    const finalContent = frontmatter + normalizeContent(cleanContent);

    await atomicWriteFile(filePath, finalContent);
  }

  async writeComment(filePath, content) {
    const meta = this.buildMeta(content);
    const comment = [
      '',
      '<!-- claude-workflow-sync',
      `plan_id: ${meta.planId}`,
      `version: ${meta.versionId}`,
      `content_hash: ${meta.contentHash}`,
      `synced_at: ${meta.syncedAt}`,
      '-->'
    ].join('\n');

    // 移除已有的 comment
    const cleanContent = this.stripComment(content);
    const finalContent = normalizeContent(cleanContent) + comment + '\n';

    await atomicWriteFile(filePath, finalContent);
  }

  async writeSidecar(filePath, content) {
    const meta = this.buildMeta(content);
    const sidecarPath = filePath + '.sync.json';

    // 写入主文件
    await atomicWriteFile(filePath, normalizeContent(content));

    // 写入 sidecar 文件
    await atomicWriteJson(sidecarPath, meta);
  }

  buildMeta(content) {
    return {
      planId: this.planId || 'unknown',
      versionId: this.versionId || 0,
      contentHash: computeContentHash(content),
      syncedAt: new Date().toISOString()
    };
  }

  parseFrontmatter(raw) {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return { content: raw, meta: null };
    }

    const [, frontmatter, content] = match;
    const meta = {};

    for (const line of frontmatter.split('\n')) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        const value = valueParts.join(':').trim();
        switch (key.trim()) {
          case 'plan_id':
            meta.planId = value;
            break;
          case 'version':
            meta.versionId = parseInt(value, 10);
            break;
          case 'content_hash':
            meta.contentHash = value;
            break;
          case 'synced_at':
            meta.syncedAt = value;
            break;
        }
      }
    }

    return {
      content: content,
      meta: Object.keys(meta).length > 0 ? meta : null
    };
  }

  parseComment(raw) {
    const match = raw.match(/([\s\S]*?)<!-- claude-workflow-sync\n([\s\S]*?)-->\s*$/);
    if (!match) {
      return { content: raw, meta: null };
    }

    const [, content, commentBody] = match;
    const meta = {};

    for (const line of commentBody.split('\n')) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        const value = valueParts.join(':').trim();
        switch (key.trim()) {
          case 'plan_id':
            meta.planId = value;
            break;
          case 'version':
            meta.versionId = parseInt(value, 10);
            break;
          case 'content_hash':
            meta.contentHash = value;
            break;
          case 'synced_at':
            meta.syncedAt = value;
            break;
        }
      }
    }

    return {
      content: content.trim() + '\n',
      meta: Object.keys(meta).length > 0 ? meta : null
    };
  }

  async parseSidecar(filePath, raw) {
    const sidecarPath = filePath + '.sync.json';
    const meta = await safeReadJson(sidecarPath);

    return {
      content: raw,
      meta
    };
  }

  stripFrontmatter(content) {
    return content.replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  stripComment(content) {
    return content.replace(/\n?<!-- claude-workflow-sync\n[\s\S]*?-->\s*$/, '');
  }
}

/**
 * 检测内容是否有变更
 * @param {string} content 当前内容
 * @param {string} originalHash 原始哈希
 * @returns {boolean}
 */
function hasContentChanged(content, originalHash) {
  return computeContentHash(content) !== originalHash;
}

/**
 * 生成内容差异摘要
 * @param {string} oldContent 旧内容
 * @param {string} newContent 新内容
 * @returns {object}
 */
function diffSummary(oldContent, newContent) {
  const oldLines = normalizeContent(oldContent).split('\n');
  const newLines = normalizeContent(newContent).split('\n');

  return {
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    lineDelta: newLines.length - oldLines.length,
    oldHash: computeContentHash(oldContent),
    newHash: computeContentHash(newContent)
  };
}

module.exports = {
  normalizeContent,
  computeContentHash,
  verifyContentHash,
  hasContentChanged,
  diffSummary,
  SyncMode,
  StablePathSync
};
