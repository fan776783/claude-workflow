/**
 * 计划版本控制
 *
 * 特性：
 * - 版本号简单递增（1, 2, 3...）
 * - 支持版本状态流转（draft → approved → superseded）
 * - 版本间 diff 生成与存储
 * - 版本回滚与比较
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteFile, atomicWriteJson, safeReadJson } = require('./atomic-write');
const { withLock } = require('./file-lock');
const { computeContentHash, normalizeContent } = require('./content-hash');

/**
 * 版本状态
 */
const VersionStatus = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  SUPERSEDED: 'superseded'
};

/**
 * 计划版本控制器
 */
class PlanVersionControl {
  constructor(planStorage) {
    this.planStorage = planStorage;
  }

  /**
   * 创建新版本
   * @param {string} planId 计划 ID
   * @param {string} content 版本内容
   * @param {object} options 选项
   * @returns {Promise<object>} 版本信息
   */
  async createVersion(planId, content, options = {}) {
    const plan = await this.planStorage.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    const versionId = plan.currentVersion + 1;
    const normalizedContent = normalizeContent(content);
    const contentHash = computeContentHash(normalizedContent);

    // 检查内容是否有变化
    if (plan.versions.length > 0) {
      const lastVersion = plan.versions[plan.versions.length - 1];
      if (lastVersion.contentHash === contentHash) {
        throw new Error('Content unchanged, no new version created');
      }
    }

    // 生成 diff（如果有前一版本）
    let diffRef = null;
    if (plan.currentVersion > 0 && options.generateDiff !== false) {
      const prevContent = await this.getVersionContent(planId, plan.currentVersion);
      if (prevContent) {
        diffRef = await this.saveDiff(planId, plan.currentVersion, versionId, prevContent, normalizedContent);
      }
    }

    // 创建版本
    const version = await this.planStorage.addVersion(planId, normalizedContent, {
      status: options.status || VersionStatus.DRAFT,
      author: options.author || 'unknown',
      summary: options.summary || '',
      basedOn: plan.currentVersion > 0 ? plan.currentVersion : undefined,
      diffRef,
      changes: options.changes
    });

    return version;
  }

  /**
   * 获取版本内容
   * @param {string} planId 计划 ID
   * @param {number} versionId 版本号
   * @returns {Promise<string|null>}
   */
  async getVersionContent(planId, versionId) {
    const plan = await this.planStorage.getPlan(planId);
    if (!plan) return null;

    const version = plan.versions.find(v => v.versionId === versionId);
    if (!version) return null;

    const planDir = path.join(this.planStorage.plansDir, planId);
    const versionPath = path.join(planDir, version.path);

    try {
      return await fs.promises.readFile(versionPath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * 获取版本信息
   * @param {string} planId 计划 ID
   * @param {number} versionId 版本号
   * @returns {Promise<object|null>}
   */
  async getVersion(planId, versionId) {
    const plan = await this.planStorage.getPlan(planId);
    if (!plan) return null;

    return plan.versions.find(v => v.versionId === versionId) || null;
  }

  /**
   * 更新版本状态
   * @param {string} planId 计划 ID
   * @param {number} versionId 版本号
   * @param {string} status 新状态
   * @returns {Promise<object>}
   */
  async updateVersionStatus(planId, versionId, status) {
    if (!Object.values(VersionStatus).includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const plan = await this.planStorage.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    const versionIndex = plan.versions.findIndex(v => v.versionId === versionId);
    if (versionIndex === -1) {
      throw new Error(`Version not found: ${versionId}`);
    }

    // 如果设置为 approved，将之前的 approved 版本设为 superseded
    if (status === VersionStatus.APPROVED) {
      for (let i = 0; i < plan.versions.length; i++) {
        if (plan.versions[i].status === VersionStatus.APPROVED) {
          plan.versions[i].status = VersionStatus.SUPERSEDED;
        }
      }
    }

    plan.versions[versionIndex].status = status;

    await this.planStorage.updatePlan(planId, { versions: plan.versions });

    return plan.versions[versionIndex];
  }

  /**
   * 批准版本
   * @param {string} planId 计划 ID
   * @param {number} versionId 版本号
   * @returns {Promise<object>}
   */
  async approveVersion(planId, versionId) {
    return this.updateVersionStatus(planId, versionId, VersionStatus.APPROVED);
  }

  /**
   * 获取当前批准的版本
   * @param {string} planId 计划 ID
   * @returns {Promise<object|null>}
   */
  async getApprovedVersion(planId) {
    const plan = await this.planStorage.getPlan(planId);
    if (!plan) return null;

    return plan.versions.find(v => v.status === VersionStatus.APPROVED) || null;
  }

  /**
   * 获取最新版本
   * @param {string} planId 计划 ID
   * @returns {Promise<object|null>}
   */
  async getLatestVersion(planId) {
    const plan = await this.planStorage.getPlan(planId);
    if (!plan || plan.versions.length === 0) return null;

    return plan.versions[plan.versions.length - 1];
  }

  /**
   * 列出所有版本
   * @param {string} planId 计划 ID
   * @returns {Promise<object[]>}
   */
  async listVersions(planId) {
    const plan = await this.planStorage.getPlan(planId);
    if (!plan) return [];

    return plan.versions;
  }

  /**
   * 比较两个版本
   * @param {string} planId 计划 ID
   * @param {number} fromVersion 起始版本
   * @param {number} toVersion 目标版本
   * @returns {Promise<object>}
   */
  async compareVersions(planId, fromVersion, toVersion) {
    const fromContent = await this.getVersionContent(planId, fromVersion);
    const toContent = await this.getVersionContent(planId, toVersion);

    if (!fromContent || !toContent) {
      throw new Error('Version content not found');
    }

    return {
      from: fromVersion,
      to: toVersion,
      diff: this.generateUnifiedDiff(fromContent, toContent, fromVersion, toVersion),
      summary: this.generateDiffSummary(fromContent, toContent)
    };
  }

  /**
   * 基于版本创建新版本（分支）
   * @param {string} planId 计划 ID
   * @param {number} baseVersion 基础版本
   * @param {string} content 新内容
   * @param {object} options 选项
   * @returns {Promise<object>}
   */
  async branchFromVersion(planId, baseVersion, content, options = {}) {
    return this.createVersion(planId, content, {
      ...options,
      basedOn: baseVersion
    });
  }

  /**
   * 保存 diff 文件
   * @param {string} planId 计划 ID
   * @param {number} fromVersion 起始版本
   * @param {number} toVersion 目标版本
   * @param {string} fromContent 起始内容
   * @param {string} toContent 目标内容
   * @returns {Promise<string>} diff 文件路径
   */
  async saveDiff(planId, fromVersion, toVersion, fromContent, toContent) {
    const planDir = path.join(this.planStorage.plansDir, planId);
    const diffsDir = path.join(planDir, 'diffs');
    const diffFileName = `v${fromVersion}-v${toVersion}.diff`;
    const diffPath = path.join(diffsDir, diffFileName);

    const diff = this.generateUnifiedDiff(fromContent, toContent, fromVersion, toVersion);
    await atomicWriteFile(diffPath, diff);

    return `diffs/${diffFileName}`;
  }

  /**
   * 生成统一 diff 格式
   * @param {string} fromContent 起始内容
   * @param {string} toContent 目标内容
   * @param {number} fromVersion 起始版本
   * @param {number} toVersion 目标版本
   * @returns {string}
   */
  generateUnifiedDiff(fromContent, toContent, fromVersion, toVersion) {
    const fromLines = fromContent.split('\n');
    const toLines = toContent.split('\n');

    const header = [
      `--- v${fromVersion}.md`,
      `+++ v${toVersion}.md`
    ];

    // 简化的 diff 实现（行级比较）
    const changes = [];
    const maxLen = Math.max(fromLines.length, toLines.length);

    let contextStart = -1;
    let contextLines = [];

    for (let i = 0; i < maxLen; i++) {
      const fromLine = fromLines[i];
      const toLine = toLines[i];

      if (fromLine === toLine) {
        if (contextStart >= 0) {
          contextLines.push(` ${fromLine || ''}`);
        }
      } else {
        if (contextStart < 0) {
          contextStart = Math.max(0, i - 3);
          // 添加上下文
          for (let j = contextStart; j < i; j++) {
            contextLines.push(` ${fromLines[j] || ''}`);
          }
        }

        if (fromLine !== undefined && (toLine === undefined || fromLine !== toLine)) {
          contextLines.push(`-${fromLine}`);
        }
        if (toLine !== undefined && (fromLine === undefined || fromLine !== toLine)) {
          contextLines.push(`+${toLine}`);
        }
      }
    }

    if (contextLines.length > 0) {
      changes.push(`@@ -${contextStart + 1},${fromLines.length} +${contextStart + 1},${toLines.length} @@`);
      changes.push(...contextLines);
    }

    return [...header, ...changes].join('\n');
  }

  /**
   * 生成 diff 摘要
   * @param {string} fromContent 起始内容
   * @param {string} toContent 目标内容
   * @returns {object}
   */
  generateDiffSummary(fromContent, toContent) {
    const fromLines = fromContent.split('\n');
    const toLines = toContent.split('\n');

    let additions = 0;
    let deletions = 0;
    let modifications = 0;

    const maxLen = Math.max(fromLines.length, toLines.length);

    for (let i = 0; i < maxLen; i++) {
      const fromLine = fromLines[i];
      const toLine = toLines[i];

      if (fromLine === undefined && toLine !== undefined) {
        additions++;
      } else if (fromLine !== undefined && toLine === undefined) {
        deletions++;
      } else if (fromLine !== toLine) {
        modifications++;
      }
    }

    return {
      additions,
      deletions,
      modifications,
      totalChanges: additions + deletions + modifications,
      fromLineCount: fromLines.length,
      toLineCount: toLines.length
    };
  }

  /**
   * 验证版本完整性
   * @param {string} planId 计划 ID
   * @param {number} versionId 版本号
   * @returns {Promise<boolean>}
   */
  async verifyVersionIntegrity(planId, versionId) {
    const version = await this.getVersion(planId, versionId);
    if (!version) return false;

    const content = await this.getVersionContent(planId, versionId);
    if (!content) return false;

    const actualHash = computeContentHash(content);
    return actualHash === version.contentHash;
  }

  /**
   * 修复版本哈希
   * @param {string} planId 计划 ID
   * @param {number} versionId 版本号
   * @returns {Promise<boolean>}
   */
  async fixVersionHash(planId, versionId) {
    const plan = await this.planStorage.getPlan(planId);
    if (!plan) return false;

    const versionIndex = plan.versions.findIndex(v => v.versionId === versionId);
    if (versionIndex === -1) return false;

    const content = await this.getVersionContent(planId, versionId);
    if (!content) return false;

    const actualHash = computeContentHash(content);
    plan.versions[versionIndex].contentHash = actualHash;

    await this.planStorage.updatePlan(planId, { versions: plan.versions });
    return true;
  }
}

module.exports = {
  VersionStatus,
  PlanVersionControl
};
