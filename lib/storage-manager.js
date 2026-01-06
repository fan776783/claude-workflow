/**
 * Plan/Run 存储管理器
 *
 * 存储结构：
 * ~/.claude/workflows/{projectId}/
 * ├── plans/                           # Plan 级存储（长期资产）
 * │   ├── index.json                   # 计划索引（可重建缓存）
 * │   └── {planId}/                    # 每个计划一个目录
 * │       ├── meta.json                # 计划元数据（真相源）
 * │       ├── v1.md, v2.md             # 版本文件
 * │       └── diffs/                   # diff 文件
 * │
 * └── runs/                            # Run 级存储（运行态）
 *     ├── current.json                 # 当前活跃 run 指针
 *     └── {runId}.json                 # 每次运行的记录
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { atomicWriteJson, safeReadJson, ensureDir } = require('./atomic-write');
const { withLock } = require('./file-lock');
const { generatePlanId, generateRunId } = require('./ulid');

// Schema 版本
const SCHEMA_VERSION = 1;

// 索引过期时间（1小时）
const INDEX_STALE_THRESHOLD = 60 * 60 * 1000;

/**
 * 生成 projectId
 * 基于项目根目录绝对路径的 MD5 哈希前 12 位
 * @param {string} projectPath 项目路径
 * @returns {string}
 */
function generateProjectId(projectPath) {
  const absolutePath = path.resolve(projectPath);
  return crypto.createHash('md5')
    .update(absolutePath)
    .digest('hex')
    .substring(0, 12);
}

/**
 * 获取工作流存储根目录
 * @param {string} projectId 项目 ID
 * @returns {string}
 */
function getWorkflowRoot(projectId) {
  return path.join(os.homedir(), '.claude', 'workflows', projectId);
}

/**
 * Plan 存储管理器
 */
class PlanStorage {
  constructor(projectId) {
    this.projectId = projectId;
    this.root = getWorkflowRoot(projectId);
    this.plansDir = path.join(this.root, 'plans');
    this.indexPath = path.join(this.plansDir, 'index.json');
  }

  /**
   * 初始化存储目录
   */
  async init() {
    await ensureDir(this.plansDir);
  }

  /**
   * 创建新计划
   * @param {object} options 计划选项
   * @returns {Promise<object>} 计划元数据
   */
  async createPlan(options = {}) {
    const planId = generatePlanId();
    const planDir = path.join(this.plansDir, planId);

    const meta = {
      schemaVersion: SCHEMA_VERSION,
      planId,
      slug: options.slug || planId,
      displayName: options.displayName || 'Untitled Plan',
      description: options.description || '',
      currentVersion: 0,
      stablePath: options.stablePath || '',
      versions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await ensureDir(planDir);
    await ensureDir(path.join(planDir, 'diffs'));
    await atomicWriteJson(path.join(planDir, 'meta.json'), meta);

    // 更新索引
    await this.updateIndex(planId, meta);

    return meta;
  }

  /**
   * 获取计划元数据
   * @param {string} planId 计划 ID
   * @returns {Promise<object|null>}
   */
  async getPlan(planId) {
    const metaPath = path.join(this.plansDir, planId, 'meta.json');
    return safeReadJson(metaPath);
  }

  /**
   * 更新计划元数据
   * @param {string} planId 计划 ID
   * @param {object} updates 更新内容
   * @returns {Promise<object>}
   */
  async updatePlan(planId, updates) {
    const planDir = path.join(this.plansDir, planId);
    const metaPath = path.join(planDir, 'meta.json');

    return withLock(metaPath, 'update-plan', async () => {
      const meta = await safeReadJson(metaPath);
      if (!meta) {
        throw new Error(`Plan not found: ${planId}`);
      }

      const updated = {
        ...meta,
        ...updates,
        planId, // 不允许修改 planId
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date().toISOString()
      };

      await atomicWriteJson(metaPath, updated);
      await this.updateIndex(planId, updated);

      return updated;
    });
  }

  /**
   * 添加计划版本
   * @param {string} planId 计划 ID
   * @param {string} content 版本内容
   * @param {object} options 版本选项
   * @returns {Promise<object>} 版本信息
   */
  async addVersion(planId, content, options = {}) {
    const planDir = path.join(this.plansDir, planId);
    const metaPath = path.join(planDir, 'meta.json');

    return withLock(metaPath, 'add-version', async () => {
      const meta = await safeReadJson(metaPath);
      if (!meta) {
        throw new Error(`Plan not found: ${planId}`);
      }

      const versionId = meta.currentVersion + 1;
      const versionPath = `v${versionId}.md`;
      const contentHash = this.computeContentHash(content);

      const version = {
        versionId,
        path: versionPath,
        contentHash,
        status: options.status || 'draft',
        author: options.author || 'unknown',
        createdAt: new Date().toISOString(),
        summary: options.summary || '',
        basedOn: options.basedOn,
        diffRef: options.diffRef,
        changes: options.changes
      };

      // 写入版本文件
      await atomicWriteJson(
        path.join(planDir, versionPath),
        content,
        { encoding: 'utf8' }
      );

      // 更新元数据
      meta.versions.push(version);
      meta.currentVersion = versionId;
      meta.updatedAt = new Date().toISOString();

      await atomicWriteJson(metaPath, meta);
      await this.updateIndex(planId, meta);

      return version;
    });
  }

  /**
   * 计算内容哈希
   * @param {string} content 内容
   * @returns {string}
   */
  computeContentHash(content) {
    const normalized = this.normalizeContent(content);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return `sha256:${hash}`;
  }

  /**
   * 规范化内容（用于哈希计算）
   * @param {string} content 内容
   * @returns {string}
   */
  normalizeContent(content) {
    // 1. CRLF → LF, CR → LF
    let normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // 2. 确保有且仅有一个换行符结尾
    normalized = normalized.replace(/\n*$/, '\n');
    return normalized;
  }

  /**
   * 更新索引
   * @param {string} planId 计划 ID
   * @param {object} meta 计划元数据
   */
  async updateIndex(planId, meta) {
    await withLock(this.indexPath, 'update-index', async () => {
      const index = await safeReadJson(this.indexPath, {
        schemaVersion: SCHEMA_VERSION,
        plans: {},
        updatedAt: null
      });

      index.plans[planId] = {
        planId: meta.planId,
        slug: meta.slug,
        displayName: meta.displayName,
        currentVersion: meta.currentVersion,
        status: meta.versions.length > 0
          ? meta.versions[meta.versions.length - 1].status
          : 'draft',
        updatedAt: meta.updatedAt
      };
      index.updatedAt = new Date().toISOString();

      await atomicWriteJson(this.indexPath, index);
    });
  }

  /**
   * 通过 slug 查找 planId
   * @param {string} slug slug 别名
   * @returns {Promise<string|null>}
   */
  async findBySlug(slug) {
    const index = await this.getIndex();
    for (const [planId, info] of Object.entries(index.plans)) {
      if (info.slug === slug) {
        return planId;
      }
    }
    return null;
  }

  /**
   * 获取索引（自动重建过期索引）
   * @returns {Promise<object>}
   */
  async getIndex() {
    const index = await safeReadJson(this.indexPath);

    // 检查索引是否需要重建
    if (!index || this.isIndexStale(index)) {
      return this.rebuildIndex();
    }

    return index;
  }

  /**
   * 检查索引是否过期
   * @param {object} index 索引
   * @returns {boolean}
   */
  isIndexStale(index) {
    if (!index.updatedAt) return true;
    const age = Date.now() - new Date(index.updatedAt).getTime();
    return age > INDEX_STALE_THRESHOLD;
  }

  /**
   * 重建索引
   * @returns {Promise<object>}
   */
  async rebuildIndex() {
    const index = {
      schemaVersion: SCHEMA_VERSION,
      plans: {},
      updatedAt: new Date().toISOString()
    };

    try {
      const entries = await fs.promises.readdir(this.plansDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'index.json') continue;

        const metaPath = path.join(this.plansDir, entry.name, 'meta.json');
        const meta = await safeReadJson(metaPath);

        if (meta && meta.planId) {
          index.plans[meta.planId] = {
            planId: meta.planId,
            slug: meta.slug,
            displayName: meta.displayName,
            currentVersion: meta.currentVersion,
            status: meta.versions.length > 0
              ? meta.versions[meta.versions.length - 1].status
              : 'draft',
            updatedAt: meta.updatedAt
          };
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('索引重建警告:', error.message);
      }
    }

    // 保存重建的索引
    await atomicWriteJson(this.indexPath, index);

    return index;
  }

  /**
   * 列出所有计划
   * @returns {Promise<object[]>}
   */
  async listPlans() {
    const index = await this.getIndex();
    return Object.values(index.plans);
  }

  /**
   * 删除计划
   * @param {string} planId 计划 ID
   */
  async deletePlan(planId) {
    const planDir = path.join(this.plansDir, planId);

    // 删除计划目录
    await fs.promises.rm(planDir, { recursive: true, force: true });

    // 更新索引
    await withLock(this.indexPath, 'delete-plan', async () => {
      const index = await safeReadJson(this.indexPath, { plans: {} });
      delete index.plans[planId];
      index.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.indexPath, index);
    });
  }
}

/**
 * Run 存储管理器
 */
class RunStorage {
  constructor(projectId) {
    this.projectId = projectId;
    this.root = getWorkflowRoot(projectId);
    this.runsDir = path.join(this.root, 'runs');
    this.currentPath = path.join(this.runsDir, 'current.json');
  }

  /**
   * 初始化存储目录
   */
  async init() {
    await ensureDir(this.runsDir);
  }

  /**
   * 创建新运行记录
   * @param {string} planId 关联的计划 ID
   * @param {object} options 运行选项
   * @returns {Promise<object>}
   */
  async createRun(planId, options = {}) {
    const runId = generateRunId();

    const run = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      planId,
      planVersionAtStart: options.planVersion || 1,
      task: options.task || {},
      enhancement: options.enhancement || {},
      steps: options.steps || [],
      currentStepId: 0,
      totalSteps: options.steps ? options.steps.length : 0,
      decisions: [],
      qualityGatesBypassed: [],
      artifacts: {},
      status: 'pending',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    await atomicWriteJson(path.join(this.runsDir, `${runId}.json`), run);

    // 设置为当前活跃运行
    await this.setCurrentRun(runId);

    return run;
  }

  /**
   * 获取运行记录
   * @param {string} runId 运行 ID
   * @returns {Promise<object|null>}
   */
  async getRun(runId) {
    return safeReadJson(path.join(this.runsDir, `${runId}.json`));
  }

  /**
   * 更新运行记录
   * @param {string} runId 运行 ID
   * @param {object} updates 更新内容
   * @returns {Promise<object>}
   */
  async updateRun(runId, updates) {
    const runPath = path.join(this.runsDir, `${runId}.json`);

    return withLock(runPath, 'update-run', async () => {
      const run = await safeReadJson(runPath);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      const updated = {
        ...run,
        ...updates,
        runId, // 不允许修改 runId
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date().toISOString()
      };

      await atomicWriteJson(runPath, updated);
      return updated;
    });
  }

  /**
   * 设置当前活跃运行
   * @param {string} runId 运行 ID
   */
  async setCurrentRun(runId) {
    await atomicWriteJson(this.currentPath, {
      runId,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * 获取当前活跃运行
   * @returns {Promise<object|null>}
   */
  async getCurrentRun() {
    const current = await safeReadJson(this.currentPath);
    if (!current || !current.runId) {
      return null;
    }
    return this.getRun(current.runId);
  }

  /**
   * 清除当前活跃运行
   */
  async clearCurrentRun() {
    try {
      await fs.promises.unlink(this.currentPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  /**
   * 添加决策记录
   * @param {string} runId 运行 ID
   * @param {object} decision 决策信息
   */
  async addDecision(runId, decision) {
    const runPath = path.join(this.runsDir, `${runId}.json`);

    return withLock(runPath, 'add-decision', async () => {
      const run = await safeReadJson(runPath);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      run.decisions.push({
        ...decision,
        timestamp: new Date().toISOString()
      });
      run.updatedAt = new Date().toISOString();

      await atomicWriteJson(runPath, run);
      return run;
    });
  }

  /**
   * 更新步骤状态
   * @param {string} runId 运行 ID
   * @param {number} stepId 步骤 ID
   * @param {object} updates 更新内容
   */
  async updateStep(runId, stepId, updates) {
    const runPath = path.join(this.runsDir, `${runId}.json`);

    return withLock(runPath, 'update-step', async () => {
      const run = await safeReadJson(runPath);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      const stepIndex = run.steps.findIndex(s => s.id === stepId);
      if (stepIndex === -1) {
        throw new Error(`Step not found: ${stepId}`);
      }

      run.steps[stepIndex] = {
        ...run.steps[stepIndex],
        ...updates
      };
      run.updatedAt = new Date().toISOString();

      await atomicWriteJson(runPath, run);
      return run;
    });
  }

  /**
   * 列出所有运行记录
   * @param {object} options 过滤选项
   * @returns {Promise<object[]>}
   */
  async listRuns(options = {}) {
    const runs = [];

    try {
      const entries = await fs.promises.readdir(this.runsDir);

      for (const entry of entries) {
        if (!entry.endsWith('.json') || entry === 'current.json') continue;

        const run = await safeReadJson(path.join(this.runsDir, entry));
        if (!run) continue;

        // 过滤
        if (options.planId && run.planId !== options.planId) continue;
        if (options.status && run.status !== options.status) continue;

        runs.push(run);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('列出运行记录警告:', error.message);
      }
    }

    // 按开始时间排序（最新在前）
    runs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    return runs;
  }

  /**
   * 删除运行记录
   * @param {string} runId 运行 ID
   */
  async deleteRun(runId) {
    const runPath = path.join(this.runsDir, `${runId}.json`);
    await fs.promises.unlink(runPath).catch(() => {});

    // 如果是当前运行，清除指针
    const current = await safeReadJson(this.currentPath);
    if (current && current.runId === runId) {
      await this.clearCurrentRun();
    }
  }
}

/**
 * 工作流存储管理器（统一入口）
 */
class WorkflowStorage {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.projectId = generateProjectId(projectPath);
    this.plans = new PlanStorage(this.projectId);
    this.runs = new RunStorage(this.projectId);
  }

  /**
   * 初始化存储
   */
  async init() {
    await this.plans.init();
    await this.runs.init();
  }

  /**
   * 获取项目元数据路径
   */
  getProjectMetaPath() {
    return path.join(getWorkflowRoot(this.projectId), '.project-meta.json');
  }

  /**
   * 保存项目元数据
   * @param {object} meta 元数据
   */
  async saveProjectMeta(meta) {
    await atomicWriteJson(this.getProjectMetaPath(), {
      ...meta,
      projectPath: this.projectPath,
      projectId: this.projectId,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * 获取项目元数据
   * @returns {Promise<object|null>}
   */
  async getProjectMeta() {
    return safeReadJson(this.getProjectMetaPath());
  }
}

module.exports = {
  generateProjectId,
  getWorkflowRoot,
  PlanStorage,
  RunStorage,
  WorkflowStorage,
  SCHEMA_VERSION
};
