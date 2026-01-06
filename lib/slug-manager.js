/**
 * Slug 管理与 ProjectId 生成
 *
 * Slug 生命周期管理：
 * - 目录名始终使用 planId（确保唯一性）
 * - slug 作为别名，存储在 meta.json
 * - 提供 slug → planId 查找功能
 * - slug 变更不移动目录
 *
 * ProjectId 定义：
 * - 基于项目根目录绝对路径
 * - MD5 哈希取前 12 位
 * - 同一路径始终生成相同 ID
 */

const path = require('path');
const crypto = require('crypto');

/**
 * 生成 projectId
 * @param {string} projectPath 项目路径
 * @returns {string} 12 位十六进制字符串
 */
function generateProjectId(projectPath) {
  const absolutePath = path.resolve(projectPath);
  return crypto.createHash('md5')
    .update(absolutePath)
    .digest('hex')
    .substring(0, 12);
}

/**
 * 验证 projectId 格式
 * @param {string} id projectId
 * @returns {boolean}
 */
function isValidProjectId(id) {
  return typeof id === 'string' && /^[a-f0-9]{12}$/.test(id);
}

/**
 * 生成 slug
 * @param {string} text 原始文本
 * @returns {string}
 */
function generateSlug(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .toLowerCase()
    // 中文转拼音首字母（简化处理：保留中文）
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    // 空白转连字符
    .replace(/\s+/g, '-')
    // 多个连字符合并
    .replace(/-+/g, '-')
    // 去除首尾连字符
    .replace(/^-|-$/g, '')
    // 限制长度
    .substring(0, 50);
}

/**
 * 验证 slug 格式
 * @param {string} slug slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') {
    return false;
  }
  // 允许小写字母、数字、连字符、中文
  return /^[\w\u4e00-\u9fa5-]+$/.test(slug) && slug.length <= 50;
}

/**
 * 规范化 slug
 * @param {string} slug 原始 slug
 * @returns {string}
 */
function normalizeSlug(slug) {
  if (!slug) return '';
  return generateSlug(slug);
}

/**
 * Slug 管理器
 */
class SlugManager {
  constructor(planStorage) {
    this.planStorage = planStorage;
    this.cache = new Map(); // slug → planId 缓存
    this.cacheTime = 0;
    this.cacheTTL = 60000; // 1 分钟缓存
  }

  /**
   * 通过 slug 查找 planId
   * @param {string} slug slug 别名
   * @returns {Promise<string|null>}
   */
  async findBySlug(slug) {
    // 检查缓存
    if (this.isCacheValid() && this.cache.has(slug)) {
      return this.cache.get(slug);
    }

    // 重建缓存
    await this.rebuildCache();

    return this.cache.get(slug) || null;
  }

  /**
   * 检查 slug 是否可用
   * @param {string} slug slug
   * @param {string} excludePlanId 排除的 planId（用于更新时）
   * @returns {Promise<boolean>}
   */
  async isSlugAvailable(slug, excludePlanId = null) {
    const existingPlanId = await this.findBySlug(slug);
    if (!existingPlanId) return true;
    if (excludePlanId && existingPlanId === excludePlanId) return true;
    return false;
  }

  /**
   * 生成唯一 slug
   * @param {string} baseSlug 基础 slug
   * @param {string} excludePlanId 排除的 planId
   * @returns {Promise<string>}
   */
  async generateUniqueSlug(baseSlug, excludePlanId = null) {
    let slug = normalizeSlug(baseSlug);
    if (!slug) {
      slug = 'plan';
    }

    // 检查是否可用
    if (await this.isSlugAvailable(slug, excludePlanId)) {
      return slug;
    }

    // 添加数字后缀
    let counter = 1;
    while (counter < 1000) {
      const candidateSlug = `${slug}-${counter}`;
      if (await this.isSlugAvailable(candidateSlug, excludePlanId)) {
        return candidateSlug;
      }
      counter++;
    }

    // 极端情况：使用时间戳
    return `${slug}-${Date.now()}`;
  }

  /**
   * 更新 slug
   * @param {string} planId 计划 ID
   * @param {string} newSlug 新 slug
   * @returns {Promise<boolean>}
   */
  async updateSlug(planId, newSlug) {
    const normalized = normalizeSlug(newSlug);
    if (!normalized) {
      throw new Error('Invalid slug');
    }

    // 检查是否可用
    if (!await this.isSlugAvailable(normalized, planId)) {
      throw new Error(`Slug already in use: ${normalized}`);
    }

    // 更新计划元数据
    await this.planStorage.updatePlan(planId, { slug: normalized });

    // 更新缓存
    this.invalidateCache();

    return true;
  }

  /**
   * 重建缓存
   */
  async rebuildCache() {
    this.cache.clear();

    const plans = await this.planStorage.listPlans();
    for (const plan of plans) {
      if (plan.slug) {
        this.cache.set(plan.slug, plan.planId);
      }
    }

    this.cacheTime = Date.now();
  }

  /**
   * 检查缓存是否有效
   * @returns {boolean}
   */
  isCacheValid() {
    return Date.now() - this.cacheTime < this.cacheTTL;
  }

  /**
   * 使缓存失效
   */
  invalidateCache() {
    this.cacheTime = 0;
  }
}

/**
 * 项目路径检测器
 */
class ProjectDetector {
  /**
   * 检测项目根目录
   * @param {string} startPath 起始路径
   * @returns {string|null}
   */
  static detectRoot(startPath) {
    let currentPath = path.resolve(startPath);

    while (currentPath !== path.dirname(currentPath)) {
      // 检查常见的项目标识文件
      const markers = [
        'package.json',
        '.git',
        'Cargo.toml',
        'go.mod',
        'pyproject.toml',
        'pom.xml',
        'build.gradle',
        '.claude'
      ];

      for (const marker of markers) {
        try {
          const markerPath = path.join(currentPath, marker);
          require('fs').accessSync(markerPath);
          return currentPath;
        } catch {
          // 继续检查
        }
      }

      currentPath = path.dirname(currentPath);
    }

    // 未找到项目根目录，返回起始路径
    return path.resolve(startPath);
  }

  /**
   * 获取项目信息
   * @param {string} projectPath 项目路径
   * @returns {object}
   */
  static getProjectInfo(projectPath) {
    const absolutePath = path.resolve(projectPath);
    const projectId = generateProjectId(absolutePath);
    const projectName = path.basename(absolutePath);

    let packageInfo = null;
    try {
      const packageJsonPath = path.join(absolutePath, 'package.json');
      packageInfo = require(packageJsonPath);
    } catch {
      // 忽略
    }

    return {
      projectId,
      projectPath: absolutePath,
      projectName: packageInfo?.name || projectName,
      version: packageInfo?.version,
      description: packageInfo?.description
    };
  }
}

module.exports = {
  generateProjectId,
  isValidProjectId,
  generateSlug,
  isValidSlug,
  normalizeSlug,
  SlugManager,
  ProjectDetector
};
