const EXPLICIT_TRIGGER_GOVERNANCE = {
  explicit_invocation_only: true,
  auto_trigger_allowed: false,
  keyword_trigger_allowed: false,
  natural_language_autostart_allowed: false,
  workflow_auto_upgrade_allowed: false,
  parallel_boundaries_promotes_team: false,
  parallel_dispatch_mode: 'internal-team-only',
}

function buildGovernanceRecord() {
  return { ...EXPLICIT_TRIGGER_GOVERNANCE }
}

module.exports = {
  EXPLICIT_TRIGGER_GOVERNANCE,
  buildGovernanceRecord,
}
