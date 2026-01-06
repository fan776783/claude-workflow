/**
 * Schema 版本迁移
 *
 * 特性：
 * - 所有数据结构添加 schemaVersion 字段
 * - 读取时检查版本，低版本自动迁移
 * - 高版本兼容读取（忽略未知字段）
 */

const { safeReadJson, atomicWriteJson } = require('./atomic-write');

// 当前 Schema 版本
const CURRENT_SCHEMA_VERSION = 1;

/**
 * 迁移函数注册表
 * key: `${fromVersion}->${toVersion}`
 * value: 迁移函数
 */
const migrations = new Map();

/**
 * 注册迁移函数
 * @param {number} fromVersion 源版本
 * @param {number} toVersion 目标版本
 * @param {Function} migrateFn 迁移函数
 */
function registerMigration(fromVersion, toVersion, migrateFn) {
  const key = `${fromVersion}->${toVersion}`;
  migrations.set(key, migrateFn);
}

/**
 * 获取迁移路径
 * @param {number} fromVersion 源版本
 * @param {number} toVersion 目标版本
 * @returns {number[]} 版本路径
 */
function getMigrationPath(fromVersion, toVersion) {
  const path = [fromVersion];
  let current = fromVersion;

  while (current < toVersion) {
    // 查找下一个可用的迁移
    let nextVersion = null;

    for (let v = current + 1; v <= toVersion; v++) {
      const key = `${current}->${v}`;
      if (migrations.has(key)) {
        nextVersion = v;
        break;
      }
    }

    if (nextVersion === null) {
      // 尝试逐版本迁移
      const key = `${current}->${current + 1}`;
      if (migrations.has(key)) {
        nextVersion = current + 1;
      } else {
        throw new Error(`No migration path from version ${current} to ${toVersion}`);
      }
    }

    path.push(nextVersion);
    current = nextVersion;
  }

  return path;
}

/**
 * 执行迁移
 * @param {object} data 数据
 * @param {number} fromVersion 源版本
 * @param {number} toVersion 目标版本
 * @returns {object} 迁移后的数据
 */
function migrate(data, fromVersion, toVersion) {
  if (fromVersion === toVersion) {
    return data;
  }

  if (fromVersion > toVersion) {
    // 高版本兼容读取，不做迁移
    console.warn(`Data version (${fromVersion}) is newer than current (${toVersion}), reading with compatibility mode`);
    return data;
  }

  const path = getMigrationPath(fromVersion, toVersion);
  let result = { ...data };

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    const key = `${from}->${to}`;
    const migrateFn = migrations.get(key);

    if (migrateFn) {
      result = migrateFn(result);
      result.schemaVersion = to;
    }
  }

  return result;
}

/**
 * Schema 迁移管理器
 */
class SchemaMigrator {
  constructor(options = {}) {
    this.currentVersion = options.currentVersion || CURRENT_SCHEMA_VERSION;
    this.dataType = options.dataType || 'unknown';
  }

  /**
   * 读取并迁移数据
   * @param {string} filePath 文件路径
   * @param {object} defaultValue 默认值
   * @returns {Promise<object>}
   */
  async readAndMigrate(filePath, defaultValue = null) {
    const data = await safeReadJson(filePath, defaultValue);

    if (!data) {
      return defaultValue;
    }

    const dataVersion = data.schemaVersion || 0;

    if (dataVersion < this.currentVersion) {
      const migrated = migrate(data, dataVersion, this.currentVersion);
      // 保存迁移后的数据
      await atomicWriteJson(filePath, migrated);
      return migrated;
    }

    return data;
  }

  /**
   * 验证数据版本
   * @param {object} data 数据
   * @returns {object} 验证结果
   */
  validate(data) {
    if (!data) {
      return { valid: false, reason: 'Data is null or undefined' };
    }

    const dataVersion = data.schemaVersion || 0;

    if (dataVersion === 0) {
      return {
        valid: false,
        reason: 'Missing schemaVersion field',
        needsMigration: true,
        fromVersion: 0
      };
    }

    if (dataVersion < this.currentVersion) {
      return {
        valid: true,
        needsMigration: true,
        fromVersion: dataVersion,
        toVersion: this.currentVersion
      };
    }

    if (dataVersion > this.currentVersion) {
      return {
        valid: true,
        needsMigration: false,
        warning: `Data version (${dataVersion}) is newer than current (${this.currentVersion})`
      };
    }

    return { valid: true, needsMigration: false };
  }

  /**
   * 确保数据有版本号
   * @param {object} data 数据
   * @returns {object}
   */
  ensureVersion(data) {
    if (!data.schemaVersion) {
      return {
        ...data,
        schemaVersion: this.currentVersion
      };
    }
    return data;
  }
}

// ========== 内置迁移函数 ==========

// v0 -> v1: 添加基础字段
registerMigration(0, 1, (data) => {
  return {
    ...data,
    schemaVersion: 1,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString()
  };
});

// ========== Plan 迁移 ==========

/**
 * Plan Schema 迁移器
 */
class PlanSchemaMigrator extends SchemaMigrator {
  constructor() {
    super({ dataType: 'plan', currentVersion: CURRENT_SCHEMA_VERSION });
  }
}

// Plan v0 -> v1
registerMigration(0, 1, (data) => {
  // 旧格式可能没有 versions 数组
  const versions = data.versions || [];

  // 如果有旧的 content 字段，转换为版本
  if (data.content && versions.length === 0) {
    versions.push({
      versionId: 1,
      path: 'v1.md',
      contentHash: data.contentHash || '',
      status: 'draft',
      author: data.author || 'unknown',
      createdAt: data.createdAt || new Date().toISOString(),
      summary: ''
    });
  }

  return {
    schemaVersion: 1,
    planId: data.planId || data.id,
    slug: data.slug || data.planId || data.id,
    displayName: data.displayName || data.name || 'Untitled',
    description: data.description || '',
    currentVersion: versions.length,
    stablePath: data.stablePath || '',
    versions,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString()
  };
});

// ========== Run 迁移 ==========

/**
 * Run Schema 迁移器
 */
class RunSchemaMigrator extends SchemaMigrator {
  constructor() {
    super({ dataType: 'run', currentVersion: CURRENT_SCHEMA_VERSION });
  }
}

// Run v0 -> v1
registerMigration(0, 1, (data) => {
  // 旧格式的 workflow-memory.json 转换
  return {
    schemaVersion: 1,
    runId: data.runId || data.id,
    planId: data.planId || '',
    planVersionAtStart: data.planVersionAtStart || 1,
    task: data.task || {
      name: data.task_name,
      description: data.description
    },
    enhancement: data.enhancement || {},
    steps: (data.steps || []).map((step, index) => ({
      id: step.id || index + 1,
      name: step.name,
      action: step.action,
      status: step.status || 'pending',
      qualityGate: step.quality_gate || step.qualityGate,
      threshold: step.threshold,
      actualScore: step.actual_score || step.actualScore
    })),
    currentStepId: data.current_step_id || data.currentStepId || 0,
    totalSteps: data.total_steps || data.totalSteps || 0,
    decisions: data.decisions || [],
    qualityGatesBypassed: data.quality_gates_bypassed || data.qualityGatesBypassed || [],
    artifacts: data.artifacts || {},
    status: data.status || 'pending',
    startedAt: data.started_at || data.startedAt || new Date().toISOString(),
    updatedAt: data.updated_at || data.updatedAt || new Date().toISOString(),
    completedAt: data.completed_at || data.completedAt
  };
});

// ========== Index 迁移 ==========

/**
 * Index Schema 迁移器
 */
class IndexSchemaMigrator extends SchemaMigrator {
  constructor() {
    super({ dataType: 'index', currentVersion: CURRENT_SCHEMA_VERSION });
  }
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  registerMigration,
  getMigrationPath,
  migrate,
  SchemaMigrator,
  PlanSchemaMigrator,
  RunSchemaMigrator,
  IndexSchemaMigrator
};
