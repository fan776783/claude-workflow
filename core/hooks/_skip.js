'use strict'
/**
 * 共享 skip helper：仅控制 hook 的 context 注入是否跳过；不影响治理 gate。
 * 调用方必须在跳过前先跑完任何治理逻辑（spec_review_gate、状态阻断等）。
 */

const SKIP_VARS = [
  ['WORKFLOW_HOOKS', '0'],
  ['AGENT_WORKFLOW_DISABLE_HOOKS', '1'],
  ['CLAUDE_NON_INTERACTIVE', '1'],
]

function shouldSkipInjection() {
  for (const [key, expected] of SKIP_VARS) {
    if (process.env[key] === expected) return key
  }
  return null
}

module.exports = { shouldSkipInjection }
