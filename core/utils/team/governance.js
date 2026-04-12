/** Team 治理规则 —— 定义显式触发约束，禁止自动升级和关键词触发 */

const EXPLICIT_TRIGGER_GOVERNANCE = {
  explicit_invocation_only: true,
  auto_trigger_allowed: false,
  keyword_trigger_allowed: false,
  natural_language_autostart_allowed: false,
  workflow_auto_upgrade_allowed: false,
  parallel_boundaries_promotes_team: false,
  parallel_dispatch_mode: 'internal-team-only',
}

/**
 * 构建治理记录对象，返回显式触发约束的副本
 * @returns {object} 治理规则对象
 */
function buildGovernanceRecord() {
  return { ...EXPLICIT_TRIGGER_GOVERNANCE }
}

module.exports = {
  EXPLICIT_TRIGGER_GOVERNANCE,
  buildGovernanceRecord,
}
