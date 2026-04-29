#!/usr/bin/env node
/**
 * @file lifecycle_cmds.js — 桥接文件，保持 workflow_cli / hooks / tests / markdown 字符串引用向后兼容
 *
 * 实际实现拆分在：
 *   - project_setup.js       项目 config / ID / legacy 迁移
 *   - runtime_locator.js     workflow runtime 定位（跨 plan/delta/archive 共用）
 *   - plan_composer.js       Plan 生成 / Spec Review 命令
 *   - delta_archive_cmds.js  Delta 变更流转 / 归档 / 解除阻塞
 *
 * 保持 36 个导出键与拆分前完全一致。
 */

const projectSetup = require('./project_setup')
const runtimeLocator = require('./runtime_locator')
const planComposer = require('./plan_composer')
const deltaArchive = require('./delta_archive_cmds')

module.exports = {
  // project_setup (11)
  loadProjectConfig: projectSetup.loadProjectConfig,
  extractProjectId: projectSetup.extractProjectId,
  summarizeText: projectSetup.summarizeText,
  slugifyFilename: projectSetup.slugifyFilename,
  stableProjectId: projectSetup.stableProjectId,
  projectNameSlug: projectSetup.projectNameSlug,
  isLegacyStableProjectId: projectSetup.isLegacyStableProjectId,
  planLegacyProjectIdMigration: projectSetup.planLegacyProjectIdMigration,
  applyLegacyProjectIdMigration: projectSetup.applyLegacyProjectIdMigration,
  buildProjectConfig: projectSetup.buildProjectConfig,
  ensureProjectConfig: projectSetup.ensureProjectConfig,

  // runtime_locator (4)
  resolveRequirementInput: runtimeLocator.resolveRequirementInput,
  deriveTaskName: runtimeLocator.deriveTaskName,
  buildTechStackSummary: runtimeLocator.buildTechStackSummary,
  resolveWorkflowRuntime: runtimeLocator.resolveWorkflowRuntime,

  // plan_composer (9, cmdStart 是 cmdPlan 的 alias)
  renderTemplate: planComposer.renderTemplate,
  extractRequirementItems: planComposer.extractRequirementItems,
  buildRequirementCoverage: planComposer.buildRequirementCoverage,
  renderRequirementCoverage: planComposer.renderRequirementCoverage,
  buildPRDCoverageReport: planComposer.buildPRDCoverageReport,
  buildPlanTasks: planComposer.buildPlanTasks,
  cmdPlan: planComposer.cmdPlan,
  cmdStart: planComposer.cmdPlan,
  cmdSpecReview: planComposer.cmdSpecReview,

  // delta_archive_cmds (12)
  detectDeltaTrigger: deltaArchive.detectDeltaTrigger,
  cmdDelta: deltaArchive.cmdDelta,
  cmdDeltaInit: deltaArchive.cmdDeltaInit,
  cmdDeltaImpact: deltaArchive.cmdDeltaImpact,
  cmdDeltaApply: deltaArchive.cmdDeltaApply,
  cmdDeltaFail: deltaArchive.cmdDeltaFail,
  cmdDeltaSync: deltaArchive.cmdDeltaSync,
  cmdArchive: deltaArchive.cmdArchive,
  cmdUnblock: deltaArchive.cmdUnblock,
  recoverArchiveTombstone: deltaArchive.recoverArchiveTombstone,
  ARCHIVE_MARKER_FILE: deltaArchive.ARCHIVE_MARKER_FILE,
  ARCHIVE_MARKER_VERSION: deltaArchive.ARCHIVE_MARKER_VERSION,
}
