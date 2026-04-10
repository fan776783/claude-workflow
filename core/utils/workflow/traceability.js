#!/usr/bin/env node

const fs = require('fs')

const REQUIREMENT_ID_REGEX = /R-\d{3}/g
const PLACEHOLDER_REGEX = /\b(?:TBD|TODO|待补充|待确认|similar to Task)\b/gi

function extractRequirementIds(text) {
  const seen = []
  for (const requirementId of String(text || '').match(REQUIREMENT_ID_REGEX) || []) {
    if (!seen.includes(requirementId)) seen.push(requirementId)
  }
  return seen
}

function findPlaceholders(text) {
  return [...new Set((String(text || '').match(PLACEHOLDER_REGEX) || []).map((item) => item))].sort()
}

function tasksToTrace(tasks) {
  return (tasks || []).map((task) => ({
    id: task.id,
    name: task.name,
    spec_ref: task.spec_ref,
    requirement_ids: [...(task.requirement_ids || [])],
    files: typeof task.all_files === 'function' ? task.all_files() : [...((task.files || {}).create || []), ...((task.files || {}).modify || []), ...((task.files || {}).test || [])],
    step_count: (task.steps || []).length,
  }))
}

function validatePlanTraceability(requirements, tasks) {
  const inScopeIds = (requirements || []).filter((req) => req.scope_status === 'in_scope').map((req) => req.id)
  const traces = tasksToTrace(tasks)
  const covered = new Set()
  const tasksMissingSpecRef = []
  const tasksMissingRequirements = []
  const tasksWithPlaceholders = []
  for (const task of tasks || []) {
    if (!task.spec_ref || task.spec_ref === '§Unknown') tasksMissingSpecRef.push(task.id)
    if (!(task.requirement_ids || []).length) tasksMissingRequirements.push(task.id)
    for (const requirementId of task.requirement_ids || []) covered.add(requirementId)
    if (findPlaceholders(task.name).length || (task.steps || []).some((step) => findPlaceholders(step.description).length || findPlaceholders(step.expected).length)) {
      tasksWithPlaceholders.push(task.id)
    }
  }
  const missingRequirementIds = inScopeIds.filter((id) => !covered.has(id))
  return {
    ok: !(missingRequirementIds.length || tasksMissingSpecRef.length || tasksMissingRequirements.length || tasksWithPlaceholders.length),
    in_scope_requirement_ids: inScopeIds,
    covered_requirement_ids: [...covered].sort(),
    missing_requirement_ids: missingRequirementIds,
    tasks_missing_spec_ref: tasksMissingSpecRef,
    tasks_missing_requirement_ids: tasksMissingRequirements,
    tasks_with_placeholders: tasksWithPlaceholders,
    task_traces: traces,
  }
}

function extractSection(content, heading) {
  // 兼容旧格式 "## Heading" 和新格式 "## N. Heading"
  const allSections = String(content || '').split(/^(?=##+\s+)/m)
  const target = allSections.find((s) => {
    const firstLine = s.split('\n')[0] || ''
    // 移除 heading 标记和可选编号前缀后比较
    const stripped = firstLine.replace(/^##+\s+(?:\d+\.\s*)?/, '').trim()
    return stripped === heading || stripped.startsWith(heading)
  })
  if (!target) return ''
  // 移除第一行（标题行）后返回正文
  const lines = target.split('\n')
  return lines.slice(1).join('\n').trim()
}

function validateSpecTraceability(requirements, specContent) {
  const constraintsSection = extractSection(specContent, 'Constraints')
  const architectureSection = extractSection(specContent, 'Architecture and Module Design')
  const acceptanceSection = extractSection(specContent, 'Acceptance Criteria')
  const missingArchitectureRefs = []
  const missingAcceptanceRefs = []
  const missingConstraints = []
  const missingExclusionReason = []
  for (const req of requirements || []) {
    if (req.scope_status === 'in_scope') {
      if (!architectureSection.includes(req.id)) missingArchitectureRefs.push(req.id)
      if (!acceptanceSection.includes(req.id)) missingAcceptanceRefs.push(req.id)
    } else if (!req.exclusion_reason) {
      missingExclusionReason.push(req.id)
    }
    const absent = (req.constraints || []).filter((constraint) => constraint && !constraintsSection.includes(constraint))
    if (absent.length) missingConstraints.push({ requirement_id: req.id, constraints: absent })
  }
  return {
    ok: !(missingArchitectureRefs.length || missingAcceptanceRefs.length || missingConstraints.length || missingExclusionReason.length),
    missing_architecture_refs: missingArchitectureRefs,
    missing_acceptance_refs: missingAcceptanceRefs,
    missing_constraints: missingConstraints,
    missing_exclusion_reason: missingExclusionReason,
    placeholders: findPlaceholders(specContent),
  }
}

function summarizeExecutionCoverage(requirements, completedTaskIds, tasks) {
  const completed = new Set(completedTaskIds || [])
  const covered = new Set()
  const byRequirement = {}
  for (const task of tasks || []) {
    if (!completed.has(task.id)) continue
    for (const requirementId of task.requirement_ids || []) {
      covered.add(requirementId)
      if (!byRequirement[requirementId]) byRequirement[requirementId] = []
      byRequirement[requirementId].push(task.id)
    }
  }
  const inScopeIds = (requirements || []).filter((req) => req.scope_status === 'in_scope').map((req) => req.id)
  const missing = inScopeIds.filter((id) => !covered.has(id))
  return {
    ok: missing.length === 0,
    completed_task_ids: [...(completedTaskIds || [])],
    covered_requirement_ids: [...covered].sort(),
    missing_requirement_ids: missing,
    coverage_map: byRequirement,
  }
}

function main() {
  const [command, file] = process.argv.slice(2)
  if (command === 'extract-ids') {
    process.stdout.write(`${JSON.stringify({ requirement_ids: extractRequirementIds(fs.readFileSync(file, 'utf8')) })}\n`)
    return
  }
  if (command === 'placeholders') {
    process.stdout.write(`${JSON.stringify({ placeholders: findPlaceholders(fs.readFileSync(file, 'utf8')) })}\n`)
    return
  }
  process.stderr.write('Usage: node traceability.js <extract-ids|placeholders> <file>\n')
  process.exitCode = 1
}

module.exports = {
  extractRequirementIds,
  findPlaceholders,
  tasksToTrace,
  validatePlanTraceability,
  extractSection,
  validateSpecTraceability,
  summarizeExecutionCoverage,
}

if (require.main === module) main()
