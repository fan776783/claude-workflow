#!/usr/bin/env node
/**
 * @file lifecycle_cmds.js — 桥接文件，re-export lifecycle 各模块的函数给 workflow_cli / hooks / tests。
 *
 * 实际实现拆分在：
 *   - project_setup.js       项目 config / ID
 *   - runtime_locator.js     workflow runtime 定位（跨 plan/delta/archive 共用）
 *   - plan_composer.js       Plan 生成 / Spec Review 命令
 *   - delta_archive_cmds.js  Delta 变更流转 / 归档 / 解除阻塞
 */

const projectSetup = require('./project_setup')
const runtimeLocator = require('./runtime_locator')
const planComposer = require('./plan_composer')
const deltaArchive = require('./delta_archive_cmds')

module.exports = {
  // project_setup
  loadProjectConfig: projectSetup.loadProjectConfig,
  extractProjectId: projectSetup.extractProjectId,
  summarizeText: projectSetup.summarizeText,
  slugifyFilename: projectSetup.slugifyFilename,
  stableProjectId: projectSetup.stableProjectId,
  projectNameSlug: projectSetup.projectNameSlug,
  buildProjectConfig: projectSetup.buildProjectConfig,
  ensureProjectConfig: projectSetup.ensureProjectConfig,

  // runtime_locator (4)
  resolveRequirementInput: runtimeLocator.resolveRequirementInput,
  deriveTaskName: runtimeLocator.deriveTaskName,
  buildTechStackSummary: runtimeLocator.buildTechStackSummary,
  resolveWorkflowRuntime: runtimeLocator.resolveWorkflowRuntime,

  // plan_composer
  renderTemplate: planComposer.renderTemplate,
  extractRequirementItems: planComposer.extractRequirementItems,
  buildRequirementCoverage: planComposer.buildRequirementCoverage,
  cmdPlan: planComposer.cmdPlan,
  cmdSpecReview: planComposer.cmdSpecReview,
  cmdPlanReview: planComposer.cmdPlanReview,
  cmdPlanEdit: planComposer.cmdPlanEdit,
  lintAnchorIntegrity: planComposer.lintAnchorIntegrity,

  // delta_archive_cmds
  detectDeltaTrigger: deltaArchive.detectDeltaTrigger,
  cmdDeltaInit: deltaArchive.cmdDeltaInit,
  cmdDeltaImpact: deltaArchive.cmdDeltaImpact,
  cmdDeltaApply: deltaArchive.cmdDeltaApply,
  cmdDeltaFail: deltaArchive.cmdDeltaFail,
  cmdDeltaSync: deltaArchive.cmdDeltaSync,
  cmdArchive: deltaArchive.cmdArchive,
  cmdUnblock: deltaArchive.cmdUnblock,
  cmdAcceptDeviation: deltaArchive.cmdAcceptDeviation,
  recoverArchiveTombstone: deltaArchive.recoverArchiveTombstone,
  ARCHIVE_MARKER_FILE: deltaArchive.ARCHIVE_MARKER_FILE,
  ARCHIVE_MARKER_VERSION: deltaArchive.ARCHIVE_MARKER_VERSION,
}
