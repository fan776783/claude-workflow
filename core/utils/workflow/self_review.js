#!/usr/bin/env node

const fs = require('fs')
const { validateWorkflowDocContracts } = require('./doc_contracts')
const { parseTasksV2 } = require('./task_parser')
const {
  validatePlanTraceability,
  validateSpecTraceability,
} = require('./traceability')

function buildRequirements(items = []) {
  return items.filter((item) => item.id).map((item) => ({
    id: item.id,
    summary: item.summary || '',
    scope_status: item.scope_status || 'in_scope',
    constraints: item.constraints || [],
    owner: item.owner || 'shared',
    exclusion_reason: item.exclusion_reason || null,
  }))
}

function runSpecSelfReview(requirements, specContent, uxArtifact = null) {
  const requirementRecords = buildRequirements(requirements)
  const result = validateSpecTraceability(requirementRecords, specContent)
  const uxChecks = {
    flowchart_present: Boolean((uxArtifact || {}).flowchart),
    page_hierarchy_present: Boolean((uxArtifact || {}).pageHierarchy),
  }
  result.ux_checks = uxChecks
  result.ok = uxArtifact ? result.ok && Object.values(uxChecks).every(Boolean) : result.ok
  return result
}

function runPlanSelfReview(requirements, planContent) {
  const requirementRecords = buildRequirements(requirements)
  const tasks = parseTasksV2(planContent)
  const result = validatePlanTraceability(requirementRecords, tasks)
  const tasksMissingVerification = tasks.filter((task) => !task.verification || !(task.verification.commands || []).length).map((task) => task.id)
  result.tasks_missing_verification = tasksMissingVerification
  result.ok = result.ok && tasksMissingVerification.length === 0
  return result
}

function runDocContractReview(cliContent, overviewDocContent, planTemplateContent, otherDocContents, existingScriptNames) {
  return validateWorkflowDocContracts(cliContent, overviewDocContent, planTemplateContent, otherDocContents, existingScriptNames)
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  if (command === 'spec') {
    const requirements = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    const specContent = fs.readFileSync(args[1], 'utf8')
    const uxIndex = args.indexOf('--ux-json')
    const uxArtifact = uxIndex >= 0 ? JSON.parse(args[uxIndex + 1]) : {}
    process.stdout.write(`${JSON.stringify(runSpecSelfReview(requirements, specContent, uxArtifact))}\n`)
    return
  }
  if (command === 'plan') {
    const requirements = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    const planContent = fs.readFileSync(args[1], 'utf8')
    process.stdout.write(`${JSON.stringify(runPlanSelfReview(requirements, planContent))}\n`)
    return
  }
  process.stderr.write('Usage: node self_review.js <spec|plan> ...\n')
  process.exitCode = 1
}

module.exports = {
  buildRequirements,
  runSpecSelfReview,
  runPlanSelfReview,
  runDocContractReview,
}

if (require.main === module) main()
