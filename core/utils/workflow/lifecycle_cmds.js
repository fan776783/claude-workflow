#!/usr/bin/env node

const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { getWorkflowStatePath, getWorkflowsDir, validateProjectId } = require('./path_utils')
const {
  applyTaskDeltas,
  buildTaskDeltaExamples,
  createDeltaArtifacts,
  summarizeTaskDeltas,
  toPrettyJson,
} = require('./plan_delta')
const {
  markDeltaApplied,
  markDependencyUnblocked,
  readState,
  recordDeltaChange,
  updateCodexPlanReview,
  updateCodexSpecReview,
  updateContextInjection,
  updateDiscussionRecord,
  updatePlanReviewRecord,
  updateUserSpecReview,
  updateUxDesignRecord,
  writeState,
} = require('./state_manager')
const { detectProjectId, detectProjectRoot, resolveStateAndTasks } = require('./task_manager')
const { parseTasksV2, taskToDict } = require('./task_parser')
const { buildMinimumState, ensureStateDefaults } = require('./workflow_types')
const { reconcileBlockedTasks } = require('./dependency_checker')
const {
  buildDiscussionArtifact,
  buildSpecReviewSummary,
  deriveRoleSignals,
  detectAgentWorkspaces,
  estimateGapCount,
  mapSpecReviewChoice,
  needsWorkspaceDetection,
  shouldRunCodexPlanReview,
  shouldRunCodexSpecReview,
  shouldRunDiscussion,
  shouldRunUxDesignGate,
  validateUxArtifact,
} = require('./planning_gates')
const {
  buildInjectedContext,
  buildAgentPrompt,
  resolveRoleProfile,
} = require('./role_injection')

function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

function extractProjectId(config) {
  if (!config) return null
  const project = config.project || {}
  const projectId = project.id || config.projectId
  if (!projectId || !validateProjectId(projectId)) return null
  return projectId
}

function summarizeText(value, limit = 80) {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim()
  if (collapsed.length <= limit) return collapsed
  return `${collapsed.slice(0, limit - 3).trimEnd()}...`
}

function slugifyFilename(value) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? slug.slice(0, 80) : ''
}

function stableProjectId(projectRoot) {
  return crypto.createHash('md5').update(String(path.resolve(projectRoot)).toLowerCase()).digest('hex').slice(0, 12)
}

function detectGitHead(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0) return null
  const commit = String(result.stdout || '').trim()
  return commit || null
}

function buildProjectConfig(projectRoot, existing = null, forcedProjectId = null) {
  const current = { ...(existing || {}) }
  const project = { ...((current.project) || {}) }
  const tech = { ...((current.tech) || {}) }
  const workflow = { ...((current.workflow) || {}) }

  let projectId = forcedProjectId || project.id || current.projectId
  if (!projectId || !validateProjectId(projectId)) projectId = stableProjectId(projectRoot)

  project.id = projectId
  project.name = project.name || path.basename(projectRoot)
  project.type = project.type || 'single'
  project.bkProjectId = project.bkProjectId || null

  if (!('packageManager' in tech)) tech.packageManager = 'unknown'
  if (!('buildTool' in tech)) tech.buildTool = 'unknown'
  if (!('frameworks' in tech)) tech.frameworks = []
  if (!('enableBKMCP' in workflow)) workflow.enableBKMCP = false

  current.project = project
  current.tech = tech
  current.workflow = workflow
  current._scanMode = current._scanMode || 'auto-healed'
  return current
}

function ensureProjectConfig(projectRoot, forcedProjectId = null) {
  const configPath = path.join(projectRoot, '.claude', 'config', 'project-config.json')
  const existing = loadProjectConfig(projectRoot)
  const currentProjectId = extractProjectId(existing)
  const needsWrite = !existing || !currentProjectId || (forcedProjectId != null && currentProjectId !== forcedProjectId)

  if (!needsWrite && existing) return [existing, configPath, false]

  const config = buildProjectConfig(projectRoot, existing, forcedProjectId)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return [config, configPath, true]
}

function renderTemplate(template, values) {
  let rendered = String(template || '')
  for (const [key, value] of Object.entries(values || {})) {
    rendered = rendered.split(`{{${key}}}`).join(value)
  }
  return rendered
}

function resolveRequirementInput(requirement, projectRoot) {
  const candidate = requirement.endsWith('.md') ? path.resolve(projectRoot, requirement) : path.resolve(projectRoot, requirement)
  if (String(requirement || '').toLowerCase().endsWith('.md') && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    let display = candidate
    const relative = path.relative(projectRoot, candidate)
    if (relative && !relative.startsWith('..')) display = relative
    return [display, fs.readFileSync(candidate, 'utf8'), candidate]
  }
  return ['inline', requirement, null]
}

function deriveTaskName(requirementText, sourcePath) {
  if (sourcePath) return path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]/g, ' ').trim() || 'Workflow Task'
  return summarizeText(requirementText, 48) || 'Workflow Task'
}

function buildTechStackSummary(config) {
  const tech = (config || {}).tech || {}
  const parts = [String(tech.packageManager || 'unknown'), String(tech.buildTool || 'unknown')]
  if ((tech.frameworks || []).length) parts.push(tech.frameworks.map((item) => String(item)).join('/'))
  return parts.join(' | ')
}

function resolveWorkflowRuntime(projectId = null, projectRoot = null) {
  const root = detectProjectRoot(projectRoot)
  const config = loadProjectConfig(root)
  const resolvedProjectId = projectId || extractProjectId(config) || detectProjectId(root)
  if (!resolvedProjectId || !validateProjectId(resolvedProjectId)) return [null, root, null, null, null]

  const workflowDir = getWorkflowsDir(resolvedProjectId)
  const statePath = getWorkflowStatePath(resolvedProjectId)
  if (!workflowDir || !statePath) return [resolvedProjectId, root, null, null, null]

  const state = fs.existsSync(statePath) ? readState(statePath, resolvedProjectId) : null
  return [resolvedProjectId, root, workflowDir, statePath, state]
}

function extractRequirementItems(requirementText, summary) {
  const text = String(requirementText || '')
  const bulletLike = text.split(/\n/).map((line) => line.trim()).filter((line) => /^[-*\d]+[.)\s]|^[A-Za-z]\./.test(line))
  const paragraphs = String(requirementText || '').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  const seedItems = bulletLike.length >= 2 ? bulletLike : (paragraphs.length ? paragraphs : [String(requirementText || '').trim()].filter(Boolean))
  return seedItems.map((item, index) => {
    const normalized = summarizeText(item, 120)
    const lowered = item.toLowerCase()
    const type = /异常|边界|edge|error|empty|无权限|失败/.test(item) ? 'edge_case'
      : /按钮|页面|界面|弹窗|交互|flow|导航/.test(item) ? 'ux'
      : /必须|不得|限制|上限|only|must|should/.test(item) ? 'constraint'
      : /待确认|待补充|待定|question|unknown|unclear/.test(item) ? 'unresolved'
      : /如果|当|条件|状态|判断|逻辑/.test(item) ? 'logic'
      : 'functional'
    const hasHighRisk = /必须|不得|only|must|按钮|字段|上限|排序|异常|边界|角色|权限/.test(item)
    return {
      id: `R-${String(index + 1).padStart(3, '0')}`,
      source_excerpt: item,
      normalized_summary: normalized,
      summary: normalized,
      type,
      scope_status: 'in_scope',
      acceptance_signal: `确认 ${normalized} 可工作`,
      spec_targets: type === 'constraint' ? ['Constraints'] : type === 'ux' ? ['User-facing Behavior', 'Acceptance Criteria'] : ['Scope', 'Acceptance Criteria'],
      constraints: hasHighRisk ? [normalized] : [],
      must_preserve: hasHighRisk,
      owner: /后端|接口|API|server|backend/.test(lowered) ? 'backend' : /前端|页面|UI|交互|frontend/.test(lowered) ? 'frontend' : 'shared',
      exclusion_reason: null,
    }
  })
}

function buildRequirementCoverage(items) {
  return (items || []).filter((item) => item.scope_status === 'in_scope').map((item, index) => ({
    id: item.id,
    summary: item.normalized_summary,
    spec_section: item.type === 'constraint' ? '§3' : item.type === 'ux' ? '§4' : item.type === 'logic' ? '§5' : '§2',
    covered_by_tasks: [`T${index + 1}`],
    coverage_status: 'covered',
    type: item.type,
    owner: item.owner,
    acceptance_signal: item.acceptance_signal,
    must_preserve: Boolean(item.must_preserve),
    protected_details: (item.constraints && item.constraints.length) ? item.constraints : [],
  }))
}

function inferRequirementType(summary) {
  const value = String(summary || '')
  if (/异常|边界|edge|error|empty|无权限|失败/.test(value)) return 'edge_case'
  if (/按钮|页面|界面|弹窗|交互|flow|导航/.test(value)) return 'ux'
  if (/必须|不得|限制|上限|only|must|should/.test(value)) return 'constraint'
  if (/如果|当|条件|状态|判断|逻辑/.test(value)) return 'logic'
  return 'functional'
}

function inferRequirementOwner(summary) {
  const lowered = String(summary || '').toLowerCase()
  if (/后端|接口|api|server|backend/.test(lowered)) return 'backend'
  if (/前端|页面|ui|交互|frontend/.test(lowered)) return 'frontend'
  return 'shared'
}

function extractSubsection(content, heading) {
  const lines = String(content || '').split('\n')
  const headingPattern = new RegExp(`^###\\s+(?:\\d+(?:\\.\\d+)*\\s*)?${String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*)$`)
  let startIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (headingPattern.test(lines[index].trim())) {
      startIndex = index + 1
      break
    }
  }
  if (startIndex < 0) return ''

  const collected = []
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^###\s+/.test(line) || /^##\s+/.test(line) || /^---\s*$/.test(line.trim())) break
    collected.push(line)
  }
  return collected.join('\n').trim()
}

function extractNamedSection(content, heading) {
  const lines = String(content || '').split('\n')
  const headingPattern = new RegExp(`^##\\s+(?:\\d+\\.\\s*)?${String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*)$`)
  let startIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (headingPattern.test(lines[index].trim())) {
      startIndex = index + 1
      break
    }
  }
  if (startIndex < 0) return ''

  const collected = []
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^##\s+/.test(line)) break
    collected.push(line)
  }
  return collected.join('\n').trim()
}

function collectBulletLines(sectionContent) {
  return String(sectionContent || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
}

function buildRequirementCoverageFromSpec(specContent) {
  const scopeSection = extractNamedSection(specContent, 'Scope')
  const inScopeLines = collectBulletLines(extractSubsection(scopeSection, 'In Scope'))
  const constraintsSection = extractNamedSection(specContent, 'Constraints')
  const acceptanceSection = extractNamedSection(specContent, 'Acceptance Criteria')

  const constraintMap = {}
  const sharedConstraints = []
  for (const line of collectBulletLines(constraintsSection)) {
    const text = line.replace(/^-\s+/, '').trim()
    const match = text.match(/^(R-\d{3}):\s*(.+)$/)
    if (match) {
      constraintMap[match[1]] = constraintMap[match[1]] || []
      constraintMap[match[1]].push(match[2].trim())
    } else if (text) {
      sharedConstraints.push(text)
    }
  }

  const acceptanceMap = {}
  for (const line of collectBulletLines(acceptanceSection)) {
    const text = line.replace(/^-\s+/, '').trim()
    const match = text.match(/^(?:\[[ xX]?\]\s*)?(R-\d{3}):\s*(.+)$/)
    if (!match) continue
    acceptanceMap[match[1]] = match[2].trim()
  }

  return inScopeLines.map((line, index) => {
    const text = line.replace(/^-\s+/, '').trim()
    const match = text.match(/^(R-\d{3}):\s*(.+)$/)
    const id = match ? match[1] : `R-${String(index + 1).padStart(3, '0')}`
    const summary = (match ? match[2] : text).trim()
    const type = inferRequirementType(summary)
    const protectedDetails = [...sharedConstraints, ...((constraintMap[id]) || [])]
    return {
      id,
      summary,
      spec_section: type === 'constraint' ? '§3' : type === 'ux' ? '§4' : type === 'logic' ? '§5' : '§2',
      covered_by_tasks: [`T${index + 1}`],
      coverage_status: 'covered',
      type,
      owner: inferRequirementOwner(summary),
      acceptance_signal: acceptanceMap[id] || `确认 ${summary} 可工作`,
      must_preserve: protectedDetails.length > 0,
      protected_details: protectedDetails,
    }
  })
}

function renderRequirementCoverage(requirementCoverage) {
  const rows = requirementCoverage || []
  if (!rows.length) return '| - | - | - | - | - |'
  return rows.map((row) => `| ${row.id} | ${row.summary} | ${row.spec_section} | ${(row.covered_by_tasks || []).join(', ')} | ${row.coverage_status} |`).join('\n')
}

function buildPRDCoverageReport(items, specContent) {
  const segments = (items || []).map((item) => {
    const keywords = item.normalized_summary.split(/\s+/).filter((w) => w.length > 1)
    const keywordHits = keywords.filter((kw) => specContent.includes(kw))
    const coverage = keywordHits.length / Math.max(keywords.length, 1)
    const status = coverage >= 0.7 ? 'covered' : coverage >= 0.3 ? 'partial' : 'uncovered'

    // 只在实际命中时填写 matchedSpecSections
    const matchedSections = []
    if (status !== 'uncovered') {
      for (const target of (item.spec_targets || [])) {
        if (specContent.includes(target) || keywordHits.length > 0) matchedSections.push(target)
      }
    }

    // 检测高风险特征缺失
    const missingDetails = []
    const excerpt = item.source_excerpt || ''
    if (/\d+|最[多少]|公式|枚举/.test(excerpt)) {
      const numbers = excerpt.match(/\d+/g) || []
      const missingNumbers = numbers.filter((n) => !specContent.includes(n))
      if (missingNumbers.length) missingDetails.push(`精确值未保留：${missingNumbers.join('、')}`)
    }
    if (/不支持|不展示|禁[止用]|不可|不得/.test(excerpt)) {
      const negPatterns = excerpt.match(/(?:不支持|不展示|禁[止用]|不可|不得)[^。，；\n]*/g) || []
      for (const neg of negPatterns) {
        if (!specContent.includes(neg.substring(0, 6).trim())) missingDetails.push(`否定约束未保留："${neg.trim()}"`)
      }
    }
    if (/联动|根据.*拉取|条件.*展示/.test(excerpt)) {
      const linkPatterns = excerpt.match(/(?:联动|根据[^。，；\n]*拉取|条件[^。，；\n]*展示)/g) || []
      for (const link of linkPatterns) {
        if (!specContent.includes(link.substring(0, 8).trim())) missingDetails.push(`联动关系未保留："${link.trim()}"`)
      }
    }
    if (/改[名为]|替换|更换|重命名/.test(excerpt)) {
      const refactorPatterns = excerpt.match(/(?:改[名为]|替换|更换|重命名)[^。，；\n]*/g) || []
      for (const r of refactorPatterns) {
        if (!specContent.includes(r.substring(0, 8).trim())) missingDetails.push(`改造指令未保留："${r.trim()}"`)
      }
    }

    // 有关键细节缺失时，covered 降级为 partial
    const finalStatus = (missingDetails.length && status === 'covered') ? 'partial' : status

    return {
      segmentId: item.id,
      status: finalStatus,
      matchedSpecSections: matchedSections,
      missingDetails,
      confidence: coverage,
      excerpt: item.source_excerpt,
      type: item.type,
    }
  })
  const covered = segments.filter((s) => s.status === 'covered').length
  const partial = segments.filter((s) => s.status === 'partial').length
  const uncovered = segments.filter((s) => s.status === 'uncovered').length
  return {
    generatedAt: new Date().toISOString(),
    totalSegments: segments.length,
    covered,
    partial,
    uncovered,
    coverageRate: (covered + partial * 0.5) / Math.max(segments.length, 1),
    segments,
  }
}

function buildTaskBlock(entry, index, allEntries = []) {
  const taskId = `T${index + 1}`
  const depends = index > 0 ? [`T${index}`] : []
  const fileSlug = entry.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const fileBucket = entry.owner === 'frontend' ? 'src/ui' : entry.owner === 'backend' ? 'src/server' : 'src/shared'
  const testBucket = entry.owner === 'frontend' ? 'tests/ui' : entry.owner === 'backend' ? 'tests/server' : 'tests/shared'
  const actionList = entry.type === 'constraint'
    ? ['审阅约束落点', '补齐实现限制', '补齐验证断言']
    : entry.type === 'ux'
      ? ['审阅交互路径', '实现界面行为', '补齐交互验证']
      : ['审阅现有实现', '实现需求变更', '补齐验证']
  const steps = [
    `  - A1: 审阅 ${entry.id} 对应的现有实现与 ${entry.spec_section} → 确认最小改动范围（验证：需求边界清晰）`,
    `  - A2: 实现 ${entry.summary} → 让行为满足 Spec 与 Requirement Coverage（验证：${entry.acceptance_signal || '目标能力可验证'}）`,
    `  - A3: 运行验证并核对 ${entry.id} → 确认 requirement_ids / 关键约束 / 验收项一致（验证：相关检查全部通过）`,
  ].join('\n')
  const criticalConstraints = (entry.protected_details && entry.protected_details.length ? entry.protected_details : ['保持现有功能不受影响']).join(', ')
  return `## ${taskId}: 实现 ${entry.id} ${entry.summary}
- **阶段**: implement
- **Spec 参考**: ${entry.spec_section}, §7
- **Plan 参考**: P${index + 1}
- **需求 ID**: ${entry.id}
- **创建文件**: ${fileBucket}/${fileSlug}.ts
- **修改文件**: .claude/specs/${fileSlug}.md
- **测试文件**: ${testBucket}/${fileSlug}.test.ts
- **关键约束**: ${criticalConstraints}
- **验收项**: ${entry.acceptance_signal || entry.summary}
- **依赖**: ${depends.join(', ') || '无'}
- **质量关卡**: ${entry.must_preserve ? 'true' : 'false'}
- **状态**: pending
- **actions**: ${actionList.join(', ')}
- **步骤**:
${steps}
- **验证命令**: npm test -- ${fileSlug}.test.ts
- **验证期望**: PASS, ${entry.id} covered
`
}

function buildPlanTasks(requirementCoverage = []) {
  if (!requirementCoverage.length) {
    return `## T1: 实现核心需求
- **阶段**: implement
- **Spec 参考**: §2, §5, §7
- **Plan 参考**: P1
- **需求 ID**: R-001
- **创建文件**: src/shared/r-001.ts
- **修改文件**: .claude/specs/r-001.md
- **测试文件**: tests/shared/r-001.test.ts
- **关键约束**: 保持现有功能不受影响, 仅实现当前明确范围
- **验收项**: 核心需求完成, 结果可验证
- **依赖**: 无
- **质量关卡**: false
- **状态**: pending
- **actions**: 阅读现有实现, 落实最小改动, 完成必要验证
- **步骤**:
  - A1: 阅读现有实现与 Spec/Requirement Coverage → 明确最小改动方案（验证：改动范围收敛）
  - A2: 实施代码修改与必要验证 → 输出满足验收项的结果（验证：核心需求可验证完成）
- **验证命令**: npm test -- r-001.test.ts
- **验证期望**: PASS
`
  }
  return requirementCoverage.map((entry, index, allEntries) => buildTaskBlock(entry, index, allEntries)).join('\n')
}

function inferPlanRelativeFromSpec(specRelative, taskName) {
  const normalizedSpec = String(specRelative || '').replace(/\\/g, '/')
  if (normalizedSpec.startsWith('.claude/specs/')) {
    return normalizedSpec.replace('.claude/specs/', '.claude/plans/')
  }
  const slug = slugifyFilename(taskName) || 'workflow-task'
  return path.join('.claude', 'plans', `${slug}.md`).replace(/\\/g, '/')
}

function cmdPlan(requirement, force = false, noDiscuss = false, projectId = null, projectRoot = null, specChoice = 'Spec 正确，生成 Plan') {
  const root = detectProjectRoot(projectRoot)
  if (projectId && !validateProjectId(projectId)) return { error: `非法项目 ID: ${projectId}` }

  const [config, , configHealed] = ensureProjectConfig(root, projectId)
  const resolvedProjectId = extractProjectId(config)
  if (!resolvedProjectId) return { error: '无法初始化项目配置' }

  const workflowDir = getWorkflowsDir(resolvedProjectId)
  if (!workflowDir) return { error: `无法解析工作流目录: ${resolvedProjectId}` }

  const statePath = path.join(workflowDir, 'workflow-state.json')
  if (fs.existsSync(statePath)) {
    const existingState = ensureStateDefaults(readState(statePath))
    if (existingState.status !== 'archived' && existingState.status !== 'idle' && !force) {
      return { error: '已存在未归档工作流，请先归档或使用 --force 覆盖', project_id: resolvedProjectId, state_status: existingState.status }
    }
  }

  const [requirementSource, requirementText, sourcePath] = resolveRequirementInput(requirement, root)
  const taskName = deriveTaskName(requirementText, sourcePath)
  const summary = summarizeText(requirementText, 120)
  const slug = slugifyFilename(taskName) || `workflow-${crypto.createHash('md5').update(requirementText).digest('hex').slice(0, 12)}`

  const specRelative = path.join('.claude', 'specs', `${slug}.md`)
  const planRelative = path.join('.claude', 'plans', `${slug}.md`)
  const specPath = path.join(root, specRelative)
  const planPath = path.join(root, planRelative)

  if (!force) {
    if (fs.existsSync(specPath)) return { error: `Spec 已存在: ${specRelative.replace(/\\/g, '/')}` }
    if (fs.existsSync(planPath)) return { error: `Plan 已存在: ${planRelative.replace(/\\/g, '/')}` }
  }

  const gapCount = estimateGapCount(requirementText, requirementSource)
  const discussionRequired = shouldRunDiscussion(requirementText, requirementSource, noDiscuss, gapCount)
  const discussionArtifact = buildDiscussionArtifact(requirementSource)
  const discussionPath = path.join(workflowDir, 'discussion-artifact.json')

  const analysisPatterns = (((config.tech) || {}).frameworks || []).map((framework) => ({ name: framework }))
  const roleSignals = deriveRoleSignals(requirementText, analysisPatterns, discussionArtifact, { taskName, summary })
  const planProfile = resolveRoleProfile('plan_generation', roleSignals)
  const planReviewProfile = resolveRoleProfile('plan_review', roleSignals)
  const executionReviewProfile = resolveRoleProfile('quality_review_stage2', roleSignals)
  const roleContextPath = path.join(workflowDir, 'role-context.json')
  const planInjectedContext = buildInjectedContext(
    { kind: 'document', ref: specRelative.replace(/\\/g, '/'), requirement_ids: [], critical_constraints: [] },
    planProfile,
    roleSignals,
    { spec_file: specRelative.replace(/\\/g, '/'), plan_file: planRelative.replace(/\\/g, '/') }
  )
  const planAgentPrompt = buildAgentPrompt(planProfile, planInjectedContext, 'claude-code')
  const roleContextArtifact = {
    schema_version: '1',
    signals: roleSignals,
    planning: {
      plan_generation: { role: planProfile.role, profile: planProfile.profile },
      plan_review: { role: planReviewProfile.role, profile: planReviewProfile.profile },
    },
    execution: {
      quality_review_stage2: { role: executionReviewProfile.role, profile: executionReviewProfile.profile },
    },
    prompts: {
      plan_generation: { preview: planAgentPrompt },
      quality_review_stage2: {
        preview: buildAgentPrompt(
          executionReviewProfile,
          buildInjectedContext(
            { kind: 'diff_window', ref: 'HEAD', requirement_ids: [], critical_constraints: [] },
            executionReviewProfile,
            roleSignals,
            { spec_file: specRelative.replace(/\\/g, '/'), plan_file: planRelative.replace(/\\/g, '/') }
          ),
          'claude-code'
        ),
      },
    },
  }
  const uxRequired = shouldRunUxDesignGate(requirementText, analysisPatterns, discussionArtifact)
  const uxPath = path.join(workflowDir, 'ux-design-artifact.json')

  let uxArtifact = null
  let uxValidation = { ok: true, missing: [], scenario_count: 0, page_count: 0 }
  if (uxRequired) {
    uxArtifact = {
      flowchart: {
        mermaidCode: 'flowchart TD\n  A[Start] --> B[Complete]',
        scenarios: [
          { name: '首次使用', description: '初始进入', coveredNodes: ['A'] },
          { name: '核心操作', description: '执行主路径', coveredNodes: ['B'] },
          { name: '异常处理', description: '处理边界情况', coveredNodes: ['B'] },
        ],
      },
      pageHierarchy: {
        pages: [{ level: 'L0', name: taskName, features: [summary], navigation: 'direct' }],
        navigation: { type: 'router', routes: ['/'] },
      },
      detectedWorkspaces: needsWorkspaceDetection(requirementText) ? detectAgentWorkspaces(require('os').homedir()) : [],
    }
    uxValidation = validateUxArtifact(uxArtifact)
  }

  const now = new Date().toISOString()
  const templateRoot = path.resolve(__dirname, '..', '..', 'specs', 'workflow-templates')
  const specTemplate = fs.readFileSync(path.join(templateRoot, 'spec-template.md'), 'utf8')
  const planTemplate = fs.readFileSync(path.join(templateRoot, 'plan-template.md'), 'utf8')

  const requirementItems = extractRequirementItems(requirementText, summary)
  const requirementCoverage = buildRequirementCoverage(requirementItems)

  const specContent = renderTemplate(specTemplate, {
    requirement_source: requirementSource,
    created_at: now,
    task_name: taskName,
    context_summary: `- 原始需求来源: ${requirementSource}\n- 需求摘要: ${summary}`,
    scope_summary: requirementItems.filter((item) => item.scope_status === 'in_scope').map((item) => `- ${item.id}: ${item.normalized_summary}`).join('\n') || `- ${summary}`,
    out_of_scope_summary: '- 未在原始需求中明确提出的扩展项不纳入本次范围',
    blocked_summary: '- 无',
    critical_constraints: requirementItems.filter((item) => item.constraints.length).map((item) => `- ${item.id}: ${item.constraints.join(', ')}`).join('\n') || '- 保持现有功能不受影响\n- 优先复用现有模块与状态管理能力',
    user_facing_behavior: `- 按需求实现并交付：${summary}`,
    architecture_summary: `- 以现有代码结构为基线，采用最小必要改动完成需求\n- 优先复用现有模块、状态流转与验证能力`,
    file_structure: `- ${specRelative.replace(/\\/g, '/')}\n- ${planRelative.replace(/\\/g, '/')}`,
    acceptance_criteria: requirementItems.map((item) => `- [ ] ${item.id}: ${item.acceptance_signal || item.normalized_summary}`).join('\n') || `- [ ] ${summary}`,
    implementation_slices: requirementItems.map((item, index) => `- Slice ${index + 1}：响应 ${item.id} / ${item.normalized_summary}`).join('\n') || `- Slice 1：响应 ${summary}`,
  })

  const specReview = mapSpecReviewChoice(specChoice)
  const shouldGeneratePlan = specReview.status === 'approved'
  const planRequirementCoverage = buildRequirementCoverageFromSpec(specContent)
  const planContent = shouldGeneratePlan
    ? renderTemplate(planTemplate, {
      requirement_source: requirementSource,
      created_at: now,
      spec_file: specRelative.replace(/\\/g, '/'),
      task_name: taskName,
      goal: summary,
      architecture_summary: '基于现有实现做最小必要改动，并复用已有模块与状态流转能力。',
      tech_stack: buildTechStackSummary(config),
      role_profile: planProfile.profile || planProfile.role || 'planner',
      context_profile: JSON.stringify({ signals: roleSignals, phase: planProfile.phase }),
      injected_context_summary: `- role: ${planProfile.role || 'planner'}\n- profile: ${planProfile.profile || 'default'}\n- signals: ${Object.entries(roleSignals).filter(([, value]) => Boolean(value)).map(([key]) => key).join(', ') || 'default'}`,
      files_create: `- ${specRelative.replace(/\\/g, '/')}\n- ${planRelative.replace(/\\/g, '/')}`,
      files_modify: '- 无',
      files_test: '- 无',
      requirement_coverage: renderRequirementCoverage(planRequirementCoverage),
      tasks: buildPlanTasks(planRequirementCoverage),
    })
    : null

  const parsedTasks = planContent ? parseTasksV2(planContent) : []
  if (planContent && !parsedTasks.length) return { error: '生成的 Plan 未通过任务解析' }

  fs.mkdirSync(path.dirname(specPath), { recursive: true })
  fs.mkdirSync(workflowDir, { recursive: true })
  fs.writeFileSync(specPath, specContent)
  if (planContent) {
    fs.mkdirSync(path.dirname(planPath), { recursive: true })
    fs.writeFileSync(planPath, planContent)
  }
  const prdCoverageReport = buildPRDCoverageReport(requirementItems, specContent)
  fs.writeFileSync(path.join(workflowDir, 'prd-spec-coverage.json'), `${JSON.stringify(prdCoverageReport, null, 2)}\n`)
  fs.writeFileSync(discussionPath, `${JSON.stringify(discussionArtifact, null, 2)}\n`)
  fs.writeFileSync(roleContextPath, `${JSON.stringify(roleContextArtifact, null, 2)}\n`)
  if (uxArtifact) fs.writeFileSync(uxPath, `${JSON.stringify(uxArtifact, null, 2)}\n`)

  const finalWorkflowStatus = shouldGeneratePlan ? 'planned' : specReview.workflow_status
  const state = ensureStateDefaults(buildMinimumState(
    resolvedProjectId,
    shouldGeneratePlan ? planRelative.replace(/\\/g, '/') : null,
    specRelative.replace(/\\/g, '/'),
    shouldGeneratePlan && parsedTasks.length ? [parsedTasks[0].id] : [],
    finalWorkflowStatus
  ))
  state.initial_head_commit = detectGitHead(root)
  state.plan_file = shouldGeneratePlan ? planRelative.replace(/\\/g, '/') : null
  state.project_root = root
  state.task_name = taskName
  state.requirement_source = requirementSource
  state.requirement_text = requirementText
  updateDiscussionRecord(state, discussionPath, (discussionArtifact.clarifications || []).length, !discussionRequired)

  const codexSpecResult = shouldRunCodexSpecReview(specContent, roleSignals)
  const codexPlanResult = shouldRunCodexPlanReview(planContent || '', specContent, roleSignals)
  updateContextInjection(state, {
    schema_version: '1',
    signals: roleSignals,
    planning: {
      plan_generation: { role: planProfile.role, profile: planProfile.profile },
      plan_review: { role: planReviewProfile.role, profile: planReviewProfile.profile },
      codex_spec_review: { triggered: codexSpecResult.run, reason: codexSpecResult.reason },
      codex_plan_review: { triggered: codexPlanResult.run, reason: codexPlanResult.reason },
    },
    execution: {
      quality_review_stage2: { role: executionReviewProfile.role, profile: executionReviewProfile.profile },
    },
    artifact_path: path.relative(root, roleContextPath).replace(/\\/g, '/'),
  })
  const existingSpecReview = (state.review_status || {}).codex_spec_review || {}
  if (!existingSpecReview.status || existingSpecReview.status === 'pending' || existingSpecReview.status === 'skipped') {
    updateCodexSpecReview(state, { status: codexSpecResult.run ? 'pending' : 'skipped', trigger_reason: codexSpecResult.reason })
  }
  if (shouldGeneratePlan) {
    updateCodexPlanReview(state, { status: codexPlanResult.run ? 'pending' : 'skipped', trigger_reason: codexPlanResult.reason })
  }
  if (shouldGeneratePlan) {
    updatePlanReviewRecord(state, {
      status: 'pending',
      review_mode: 'machine_loop',
      reviewer: 'subagent',
      role: planReviewProfile.role,
      profile: planReviewProfile.profile,
      signals_snapshot: roleSignals,
      next_action: 'compile_tasks',
    })
  }
  if (uxArtifact) {
    updateUxDesignRecord(state, uxPath, uxValidation.scenario_count, uxValidation.page_count, uxValidation.ok)
  }
  updateUserSpecReview(state, specReview.status, specReview.next_action)
  if (!shouldGeneratePlan) state.current_tasks = []
  writeState(statePath, state)

  return {
    started: true,
    project_id: resolvedProjectId,
    config_healed: configHealed,
    workflow_status: state.status,
    spec_file: specRelative.replace(/\\/g, '/'),
    plan_file: shouldGeneratePlan ? planRelative.replace(/\\/g, '/') : null,
    task_count: parsedTasks.length,
    current_tasks: state.current_tasks || [],
    discussion_required: discussionRequired,
    ux_gate_required: uxRequired,
    awaiting_user_spec_review: !shouldGeneratePlan,
    spec_review_summary: buildSpecReviewSummary(specContent),
  }
}

function cmdSpecReview(specChoice, projectId = null, projectRoot = null) {
  const choice = String(specChoice || '').trim()
  if (!choice) return { error: '缺少 Spec Review 选择，请使用 --choice 传入用户结论' }

  const specReview = mapSpecReviewChoice(choice)
  if (specReview.status === 'pending') {
    return { error: `无法识别的 Spec Review 选择: ${choice}` }
  }

  const [resolvedProjectId, root, workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return { error: '没有活跃的工作流' }

  const normalizedState = ensureStateDefaults(state)
  if (normalizedState.status !== 'spec_review') {
    return { error: '当前工作流不在 spec_review 状态', project_id: resolvedProjectId, state_status: normalizedState.status }
  }

  updateUserSpecReview(normalizedState, specReview.status, specReview.next_action)
  normalizedState.current_tasks = []

  if (specReview.status !== 'approved') {
    normalizedState.status = specReview.workflow_status
    writeState(statePath, normalizedState)
    return {
      review_recorded: true,
      project_id: resolvedProjectId,
      workflow_status: normalizedState.status,
      plan_file: normalizedState.plan_file || null,
      awaiting_user_spec_review: normalizedState.status === 'spec_review',
      spec_review_status: normalizedState.review_status.user_spec_review.status,
    }
  }

  const config = loadProjectConfig(root)
  if (!config) return { error: '缺少项目配置，无法继续生成 Plan' }

  const specRelative = String(normalizedState.spec_file || '').replace(/\\/g, '/')
  if (!specRelative) return { error: '缺少 spec_file，无法继续生成 Plan', project_id: resolvedProjectId }
  const specPath = path.join(root, specRelative)
  if (!fs.existsSync(specPath)) return { error: 'spec 文件不存在，无法继续生成 Plan', project_id: resolvedProjectId }
  const specContent = fs.readFileSync(specPath, 'utf8')

  const requirementText = String(normalizedState.requirement_text || specContent).trim()
  const requirementSource = normalizedState.requirement_source || 'inline'
  const taskName = normalizedState.task_name || deriveTaskName(requirementText, null)
  const summary = summarizeText(extractSubsection(extractNamedSection(specContent, 'Scope'), 'In Scope') || requirementText, 120)

  const planRelative = inferPlanRelativeFromSpec(normalizedState.plan_file || specRelative, taskName)
  const planPath = path.join(root, planRelative)
  const discussionArtifact = buildDiscussionArtifact(requirementSource)
  const analysisPatterns = (((config.tech) || {}).frameworks || []).map((framework) => ({ name: framework }))
  const roleSignals = deriveRoleSignals(requirementText, analysisPatterns, discussionArtifact, { taskName, summary })
  const planProfile = resolveRoleProfile('plan_generation', roleSignals)
  const planReviewProfile = resolveRoleProfile('plan_review', roleSignals)
  const executionReviewProfile = resolveRoleProfile('quality_review_stage2', roleSignals)
  const roleContextPath = path.join(workflowDir, 'role-context.json')
  const planInjectedContext = buildInjectedContext(
    { kind: 'document', ref: specRelative, requirement_ids: [], critical_constraints: [] },
    planProfile,
    roleSignals,
    { spec_file: specRelative, plan_file: planRelative }
  )
  const roleContextArtifact = {
    schema_version: '1',
    signals: roleSignals,
    planning: {
      plan_generation: { role: planProfile.role, profile: planProfile.profile },
      plan_review: { role: planReviewProfile.role, profile: planReviewProfile.profile },
    },
    execution: {
      quality_review_stage2: { role: executionReviewProfile.role, profile: executionReviewProfile.profile },
    },
    prompts: {
      plan_generation: { preview: buildAgentPrompt(planProfile, planInjectedContext, 'claude-code') },
      quality_review_stage2: {
        preview: buildAgentPrompt(
          executionReviewProfile,
          buildInjectedContext(
            { kind: 'diff_window', ref: 'HEAD', requirement_ids: [], critical_constraints: [] },
            executionReviewProfile,
            roleSignals,
            { spec_file: specRelative, plan_file: planRelative }
          ),
          'claude-code'
        ),
      },
    },
  }

  const templateRoot = path.resolve(__dirname, '..', '..', 'specs', 'workflow-templates')
  const planTemplate = fs.readFileSync(path.join(templateRoot, 'plan-template.md'), 'utf8')
  const requirementCoverage = buildRequirementCoverageFromSpec(specContent)
  const planContent = renderTemplate(planTemplate, {
    requirement_source: requirementSource,
    created_at: new Date().toISOString(),
    spec_file: specRelative,
    task_name: taskName,
    goal: summary,
    architecture_summary: '基于现有实现做最小必要改动，并复用已有模块与状态流转能力。',
    tech_stack: buildTechStackSummary(config),
    role_profile: planProfile.profile || planProfile.role || 'planner',
    context_profile: JSON.stringify({ signals: roleSignals, phase: planProfile.phase }),
    injected_context_summary: `- role: ${planProfile.role || 'planner'}\n- profile: ${planProfile.profile || 'default'}\n- signals: ${Object.entries(roleSignals).filter(([, value]) => Boolean(value)).map(([key]) => key).join(', ') || 'default'}`,
    files_create: `- ${specRelative}\n- ${planRelative}`,
    files_modify: '- 无',
    files_test: '- 无',
    requirement_coverage: renderRequirementCoverage(requirementCoverage),
    tasks: buildPlanTasks(requirementCoverage),
  })
  const parsedTasks = parseTasksV2(planContent)
  if (!parsedTasks.length) return { error: '生成的 Plan 未通过任务解析', project_id: resolvedProjectId }

  fs.mkdirSync(path.dirname(planPath), { recursive: true })
  fs.writeFileSync(planPath, planContent)
  fs.writeFileSync(roleContextPath, `${JSON.stringify(roleContextArtifact, null, 2)}\n`)

  normalizedState.status = 'planned'
  normalizedState.plan_file = planRelative
  normalizedState.project_root = root
  if (!normalizedState.initial_head_commit) normalizedState.initial_head_commit = detectGitHead(root)
  normalizedState.task_name = taskName
  normalizedState.requirement_source = requirementSource
  normalizedState.requirement_text = requirementText
  normalizedState.current_tasks = [parsedTasks[0].id]
  const codexSpecTrigger = shouldRunCodexSpecReview(specContent, roleSignals)
  const codexPlanTrigger = shouldRunCodexPlanReview(planContent, specContent, roleSignals)
  updateContextInjection(normalizedState, {
    schema_version: '1',
    signals: roleSignals,
    planning: {
      plan_generation: { role: planProfile.role, profile: planProfile.profile },
      plan_review: { role: planReviewProfile.role, profile: planReviewProfile.profile },
      codex_spec_review: { triggered: codexSpecTrigger.run, reason: codexSpecTrigger.reason },
      codex_plan_review: { triggered: codexPlanTrigger.run, reason: codexPlanTrigger.reason },
    },
    execution: {
      quality_review_stage2: { role: executionReviewProfile.role, profile: executionReviewProfile.profile },
    },
    artifact_path: path.relative(root, roleContextPath).replace(/\\/g, '/'),
  })
  const existingSpecCodexReview = (normalizedState.review_status || {}).codex_spec_review || {}
  if (!existingSpecCodexReview.status || existingSpecCodexReview.status === 'pending' || existingSpecCodexReview.status === 'skipped') {
    updateCodexSpecReview(normalizedState, { status: codexSpecTrigger.run ? 'pending' : 'skipped', trigger_reason: codexSpecTrigger.reason })
  }
  updateCodexPlanReview(normalizedState, { status: codexPlanTrigger.run ? 'pending' : 'skipped', trigger_reason: codexPlanTrigger.reason })
  updatePlanReviewRecord(normalizedState, {
    status: 'pending',
    review_mode: 'machine_loop',
    reviewer: 'subagent',
    role: planReviewProfile.role,
    profile: planReviewProfile.profile,
    signals_snapshot: roleSignals,
    next_action: 'compile_tasks',
  })
  writeState(statePath, normalizedState)

  return {
    review_recorded: true,
    project_id: resolvedProjectId,
    workflow_status: normalizedState.status,
    spec_file: specRelative,
    plan_file: planRelative,
    task_count: parsedTasks.length,
    current_tasks: normalizedState.current_tasks,
    awaiting_user_spec_review: false,
    spec_review_status: normalizedState.review_status.user_spec_review.status,
  }
}

function detectDeltaTrigger(source, projectRoot) {
  const raw = String(source || '').trim()
  if (!raw) return { type: 'sync', source: null, description: '执行 API 同步' }
  const absolute = path.isAbsolute(raw) ? raw : path.join(projectRoot, raw)
  const normalizedSource = raw.replace(/\\/g, '/')
  if (raw.endsWith('.md') && fs.existsSync(absolute)) return { type: 'prd', source: raw, description: `PRD 更新: ${path.basename(raw)}` }
  if (raw.endsWith('Api.ts') || normalizedSource.includes('/autogen/') || raw.endsWith('.api.ts')) return { type: 'api', source: raw, description: `API 变更: ${raw}` }
  return { type: 'requirement', source: raw, description: summarizeText(raw, 120) }
}

// --- Delta 子命令 ---

const VALID_CHANGE_ID_PATTERN = /^CHG-\d{3,}$/

function validateChangeId(changeId) {
  if (!changeId || !VALID_CHANGE_ID_PATTERN.test(changeId)) {
    return { error: `非法 change-id: ${changeId}。格式须为 CHG-NNN` }
  }
  return null
}

function resolveActiveDelta(projectId, projectRoot) {
  const [resolvedProjectId, root, workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return [null, null, null, null, null, { error: '没有活跃的工作流' }]

  const normalizedState = ensureStateDefaults(state)
  if (normalizedState.status === 'archived') return [null, null, null, null, null, { error: '当前工作流已归档，无法追加 delta' }]

  return [resolvedProjectId, workflowDir, statePath, normalizedState, root, null]
}

function cmdDeltaInit(triggerType, source, description, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, root, err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  const trigger = { type: triggerType || 'requirement', source: source || null, description: description || `${triggerType || 'requirement'} 变更` }
  const tracking = normalizedState.delta_tracking || (normalizedState.delta_tracking = {})
  const parentChange = tracking.current_change || null
  const changeId = recordDeltaChange(normalizedState, null, false)

  const changeDir = path.join(workflowDir, 'changes', changeId)
  fs.mkdirSync(changeDir, { recursive: true })

  const artifacts = createDeltaArtifacts(changeId, trigger, parentChange)
  fs.writeFileSync(path.join(changeDir, 'delta.json'), toPrettyJson(artifacts.delta))
  fs.writeFileSync(path.join(changeDir, 'intent.md'), artifacts.intent)
  fs.writeFileSync(path.join(changeDir, 'review-status.json'), toPrettyJson(artifacts.review_status))

  writeState(statePath, normalizedState)

  return {
    delta_created: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    trigger_type: trigger.type,
    change_dir: changeDir,
    parent_change: parentChange,
  }
}

function cmdDeltaImpact(changeId, tasksAdded, tasksModified, tasksRemoved, riskLevel, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, , err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  if (!changeId) return { error: '缺少 --change-id' }
  const changeIdErr = validateChangeId(changeId)
  if (changeIdErr) return changeIdErr
  const changeDir = path.join(workflowDir, 'changes', changeId)
  const deltaPath = path.join(changeDir, 'delta.json')
  if (!fs.existsSync(deltaPath)) return { error: `变更记录不存在: ${changeId}` }

  const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'))
  delta.impact_analysis = {
    summary: `新增 ${tasksAdded || 0} / 修改 ${tasksModified || 0} / 废弃 ${tasksRemoved || 0}`,
    tasks_added: Number(tasksAdded || 0),
    tasks_modified: Number(tasksModified || 0),
    tasks_removed: Number(tasksRemoved || 0),
    risk_level: riskLevel || 'low',
    affected_tasks: delta.impact_analysis?.affected_tasks || [],
    affected_files: delta.impact_analysis?.affected_files || [],
  }
  delta.status = 'analyzed'
  fs.writeFileSync(deltaPath, toPrettyJson(delta))

  return {
    impact_recorded: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    impact: delta.impact_analysis,
  }
}

function cmdDeltaApply(changeId, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, root, err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  if (!changeId) return { error: '缺少 --change-id' }
  const changeIdErr = validateChangeId(changeId)
  if (changeIdErr) return changeIdErr
  const changeDir = path.join(workflowDir, 'changes', changeId)
  const deltaPath = path.join(changeDir, 'delta.json')
  if (!fs.existsSync(deltaPath)) return { error: `变更记录不存在: ${changeId}` }

  const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'))
  if (delta.status === 'applied') {
    markDeltaApplied(normalizedState, changeId)
    writeState(statePath, normalizedState)
    return {
      applied: true,
      already_applied: true,
      project_id: resolvedProjectId,
      change_id: changeId,
      workflow_status: normalizedState.status,
      task_delta_summary: { add: 0, modify: 0, remove: 0 },
    }
  }

  delta.status = 'applied'
  delta.applied_at = new Date().toISOString()
  fs.writeFileSync(deltaPath, toPrettyJson(delta))
  markDeltaApplied(normalizedState, changeId)

  // 更新 review-status
  const reviewStatusPath = path.join(changeDir, 'review-status.json')
  if (fs.existsSync(reviewStatusPath)) {
    const reviewStatus = JSON.parse(fs.readFileSync(reviewStatusPath, 'utf8'))
    reviewStatus.status = 'approved'
    reviewStatus.reviewed_at = new Date().toISOString()
    reviewStatus.review_mode = 'human_gate'
    fs.writeFileSync(reviewStatusPath, toPrettyJson(reviewStatus))
  }

  // 应用 task deltas（如有）
  let taskDeltaSummary = { add: 0, modify: 0, remove: 0 }
  const taskDeltas = delta.task_deltas || []
  if (taskDeltas.length) {
    const [, , tasksContent, tasksPath] = resolveStateAndTasks(resolvedProjectId, root)
    if (tasksContent && tasksPath) {
      fs.writeFileSync(tasksPath, applyTaskDeltas(tasksContent, taskDeltas))
      taskDeltaSummary = summarizeTaskDeltas(taskDeltas)
    }
  }

  writeState(statePath, normalizedState)

  return {
    applied: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    workflow_status: normalizedState.status,
    task_delta_summary: taskDeltaSummary,
  }
}

function cmdDeltaFail(changeId, errorMessage, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, , err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  if (!changeId) return { error: '缺少 --change-id' }
  const changeIdErr = validateChangeId(changeId)
  if (changeIdErr) return changeIdErr
  const changeDir = path.join(workflowDir, 'changes', changeId)
  const deltaPath = path.join(changeDir, 'delta.json')
  if (!fs.existsSync(deltaPath)) return { error: `变更记录不存在: ${changeId}` }

  const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'))
  delta.status = 'failed'
  delta.error = String(errorMessage || '').substring(0, 500)
  delta.failed_at = new Date().toISOString()
  fs.writeFileSync(deltaPath, toPrettyJson(delta))

  writeState(statePath, normalizedState)

  return {
    failed: true,
    project_id: resolvedProjectId,
    change_id: changeId,
  }
}

function cmdDeltaSync(dependency, projectId = null, projectRoot = null) {
  const [resolvedProjectId, workflowDir, statePath, normalizedState, root, err] = resolveActiveDelta(projectId, projectRoot)
  if (err) return err

  const dep = String(dependency || 'api_spec').trim()

  // 1. 初始化变更记录
  const trigger = { type: 'sync', source: dep, description: `同步 ${dep} 并解除阻塞` }
  const tracking = normalizedState.delta_tracking || (normalizedState.delta_tracking = {})
  const parentChange = tracking.current_change || null
  const changeId = recordDeltaChange(normalizedState)
  const changeDir = path.join(workflowDir, 'changes', changeId)
  fs.mkdirSync(changeDir, { recursive: true })

  // 2. 解除阻塞
  markDependencyUnblocked(normalizedState, dep)
  const [, , tasksContent] = resolveStateAndTasks(resolvedProjectId, root)
  let newlyUnblocked = []
  if (tasksContent) {
    const tasks = parseTasksV2(tasksContent).map(taskToDict)
    const reconciliation = reconcileBlockedTasks(tasks, normalizedState.unblocked || [], ((normalizedState.progress || {}).blocked) || [])
    if (!normalizedState.progress) normalizedState.progress = {}
    normalizedState.progress.blocked = reconciliation.blocked
    newlyUnblocked = reconciliation.newly_unblocked
    if (normalizedState.status === 'blocked' && !reconciliation.blocked.length) normalizedState.status = 'running'
  }

  // 3. 写入审计记录（先审计后生效）
  const artifacts = createDeltaArtifacts(changeId, trigger, parentChange)
  artifacts.delta.status = 'applied'
  artifacts.delta.applied_at = new Date().toISOString()
  artifacts.delta.impact_analysis.summary = `同步 ${dep}，解除 ${newlyUnblocked.length} 个任务阻塞`
  artifacts.review_status.status = 'auto_applied'
  artifacts.review_status.review_mode = 'sync'
  artifacts.review_status.reviewed_at = new Date().toISOString()

  fs.writeFileSync(path.join(changeDir, 'delta.json'), toPrettyJson(artifacts.delta))
  fs.writeFileSync(path.join(changeDir, 'intent.md'), artifacts.intent)
  fs.writeFileSync(path.join(changeDir, 'review-status.json'), toPrettyJson(artifacts.review_status))

  // 4. 持久化状态（后生效）
  writeState(statePath, normalizedState)

  return {
    synced: true,
    project_id: resolvedProjectId,
    change_id: changeId,
    dependency: dep,
    workflow_status: normalizedState.status,
    newly_unblocked_tasks: newlyUnblocked,
    known_unblocked: normalizedState.unblocked || [],
  }
}

// Legacy: 保留旧的单参数调用模式用于向后兼容
function cmdDelta(source = '', projectId = null, projectRoot = null) {
  const root = detectProjectRoot(projectRoot)
  const trigger = detectDeltaTrigger(source, root)
  return cmdDeltaInit(trigger.type, trigger.source, trigger.description, projectId, projectRoot)
}

function cmdArchive(summary = false, projectId = null, projectRoot = null) {
  const [resolvedProjectId, , workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return { error: '没有可归档的工作流' }

  const normalizedState = ensureStateDefaults(state)
  if (normalizedState.status !== 'completed') return { error: '只有 completed 状态的工作流可以归档', state_status: normalizedState.status }

  const changesDir = path.join(workflowDir, 'changes')
  const archiveDir = path.join(workflowDir, 'archive')
  fs.mkdirSync(archiveDir, { recursive: true })

  const archivedChanges = []
  if (fs.existsSync(changesDir)) {
    for (const entry of fs.readdirSync(changesDir).sort()) {
      const source = path.join(changesDir, entry)
      if (!entry.startsWith('CHG-') || !fs.statSync(source).isDirectory()) continue
      const destination = path.join(archiveDir, entry)
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true })
      fs.renameSync(source, destination)
      archivedChanges.push(entry)
    }
  }

  let summaryPath = null
  if (summary) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
    summaryPath = path.join(archiveDir, `archive-summary-${timestamp}.md`)
    const progress = normalizedState.progress || {}
    fs.writeFileSync(summaryPath, ['# 工作流归档摘要', '', `- 项目 ID: ${resolvedProjectId}`, `- Task: ${normalizedState.task_name || 'N/A'}`, `- Spec: ${normalizedState.spec_file || 'N/A'}`, `- Plan: ${normalizedState.plan_file || 'N/A'}`, `- 已归档变更: ${archivedChanges.length ? archivedChanges.join(', ') : '无'}`, `- 已完成任务: ${(progress.completed || []).length}`, `- 已跳过任务: ${(progress.skipped || []).length}`, `- 失败任务: ${(progress.failed || []).length}`, ''].join('\n'))
  }

  normalizedState.status = 'archived'
  normalizedState.archived_at = new Date().toISOString()
  if (!normalizedState.delta_tracking) normalizedState.delta_tracking = {}
  normalizedState.delta_tracking.current_change = null
  writeState(statePath, normalizedState)

  return { archived: true, project_id: resolvedProjectId, archived_changes: archivedChanges, archive_dir: archiveDir, summary_file: summaryPath, workflow_status: normalizedState.status }
}

function cmdUnblock(dependency, projectId = null, projectRoot = null) {
  const [resolvedProjectId, root, , statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !statePath || !state) return { error: '没有活跃的工作流' }

  const dep = String(dependency || '').trim()
  if (!dep) return { error: '缺少要解除的依赖标识' }

  const normalizedState = ensureStateDefaults(state)
  markDependencyUnblocked(normalizedState, dep)

  const [, , tasksContent] = resolveStateAndTasks(resolvedProjectId, root)
  let newlyUnblocked = []
  if (tasksContent) {
    const tasks = parseTasksV2(tasksContent).map(taskToDict)
    const reconciliation = reconcileBlockedTasks(tasks, normalizedState.unblocked || [], ((normalizedState.progress || {}).blocked) || [])
    if (!normalizedState.progress) normalizedState.progress = {}
    normalizedState.progress.blocked = reconciliation.blocked
    newlyUnblocked = reconciliation.newly_unblocked
    if (normalizedState.status === 'blocked' && !reconciliation.blocked.length) normalizedState.status = 'running'
  }

  writeState(statePath, normalizedState)
  return { unblocked: true, project_id: resolvedProjectId, dependency: dep, workflow_status: normalizedState.status, known_unblocked: normalizedState.unblocked || [], newly_unblocked_tasks: newlyUnblocked }
}

module.exports = {
  loadProjectConfig,
  extractProjectId,
  summarizeText,
  slugifyFilename,
  stableProjectId,
  buildProjectConfig,
  ensureProjectConfig,
  renderTemplate,
  resolveRequirementInput,
  deriveTaskName,
  buildTechStackSummary,
  resolveWorkflowRuntime,
  buildPlanTasks,
  extractRequirementItems,
  buildRequirementCoverage,
  renderRequirementCoverage,
  buildPRDCoverageReport,

  cmdPlan,
  cmdStart: cmdPlan,
  cmdSpecReview,
  detectDeltaTrigger,
  cmdDelta,
  cmdDeltaInit,
  cmdDeltaImpact,
  cmdDeltaApply,
  cmdDeltaFail,
  cmdDeltaSync,
  cmdArchive,
  cmdUnblock,
}
