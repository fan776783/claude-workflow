// @pic/claude-workflow
// Claude Code 工作流工具包

const installer = require('./installer');

// 核心工具
const ulid = require('./ulid');
const fileLock = require('./file-lock');
const atomicWrite = require('./atomic-write');

// 存储管理
const storageManager = require('./storage-manager');
const contentHash = require('./content-hash');
const slugManager = require('./slug-manager');

// 版本控制
const versionControl = require('./version-control');
const schemaMigration = require('./schema-migration');

// 工作流功能
const discussionManager = require('./discussion-manager');
const promptEnhancer = require('./prompt-enhancer');
const agentContract = require('./agent-contract');
const sensitiveData = require('./sensitive-data');

// 迁移工具
const legacyMigrator = require('./legacy-migrator');

module.exports = {
  // 安装器
  ...installer,
  version: require('../package.json').version,

  // ULID 生成
  ulid: ulid.ulid,
  generatePlanId: ulid.generatePlanId,
  generateRunId: ulid.generateRunId,
  generateDecisionId: ulid.generateDecisionId,
  isValidUlid: ulid.isValidUlid,

  // 文件锁
  RenewableLock: fileLock.RenewableLock,
  withLock: fileLock.withLock,
  checkLockStatus: fileLock.checkLockStatus,

  // 原子写入
  atomicWriteFile: atomicWrite.atomicWriteFile,
  atomicWriteJson: atomicWrite.atomicWriteJson,
  atomicWriteFileWithFallback: atomicWrite.atomicWriteFileWithFallback,
  safeReadJson: atomicWrite.safeReadJson,
  fileExists: atomicWrite.fileExists,
  ensureDir: atomicWrite.ensureDir,

  // 存储管理
  WorkflowStorage: storageManager.WorkflowStorage,
  PlanStorage: storageManager.PlanStorage,
  RunStorage: storageManager.RunStorage,
  generateProjectId: storageManager.generateProjectId,

  // ContentHash
  normalizeContent: contentHash.normalizeContent,
  computeContentHash: contentHash.computeContentHash,
  verifyContentHash: contentHash.verifyContentHash,
  SyncMode: contentHash.SyncMode,
  StablePathSync: contentHash.StablePathSync,

  // Slug 管理
  generateSlug: slugManager.generateSlug,
  isValidSlug: slugManager.isValidSlug,
  SlugManager: slugManager.SlugManager,
  ProjectDetector: slugManager.ProjectDetector,

  // 版本控制
  VersionStatus: versionControl.VersionStatus,
  PlanVersionControl: versionControl.PlanVersionControl,

  // Schema 迁移
  CURRENT_SCHEMA_VERSION: schemaMigration.CURRENT_SCHEMA_VERSION,
  SchemaMigrator: schemaMigration.SchemaMigrator,
  PlanSchemaMigrator: schemaMigration.PlanSchemaMigrator,
  RunSchemaMigrator: schemaMigration.RunSchemaMigrator,

  // 讨论管理
  DecisionType: discussionManager.DecisionType,
  DiscussionStatus: discussionManager.DiscussionStatus,
  DiscussionManager: discussionManager.DiscussionManager,
  IterationSession: discussionManager.IterationSession,

  // Prompt 增强
  EnhancementStrategy: promptEnhancer.EnhancementStrategy,
  PromptEnhancer: promptEnhancer.PromptEnhancer,
  EnhancementStorage: promptEnhancer.EnhancementStorage,

  // Agent 合同
  AgentType: agentContract.AgentType,
  OutputFormat: agentContract.OutputFormat,
  AgentContract: agentContract.AgentContract,
  getContract: agentContract.getContract,
  listContracts: agentContract.listContracts,

  // 敏感数据
  SensitiveDataHandler: sensitiveData.SensitiveDataHandler,
  getSensitiveDataHandler: sensitiveData.getSensitiveDataHandler,

  // 迁移工具
  LegacyMigrator: legacyMigrator.LegacyMigrator,
  runMigration: legacyMigrator.runMigration,
  verifyMigration: legacyMigrator.verifyMigration
};
