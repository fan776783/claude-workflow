#!/usr/bin/env node

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
  markDependencyUnblocked,
  readState,
  recordDeltaChange,
  updateContextInjection,
  updateDiscussionRecord,
  updatePlanReviewRecord,
  updateRequirementBaselineRecord,
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

function buildRequirementBaseline(requirementText, summary, requirementSource) {
  const text = String(requirementText || '')
  const bulletLike = text.split(/\n/).map((line) => line.trim()).filter((line) => /^[-*\d]+[.)\s]|^[A-Za-z]\./.test(line))
  const paragraphs = String(requirementText || '').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  const seedItems = bulletLike.length >= 2 ? bulletLike : (paragraphs.length ? paragraphs : [String(requirementText || '').trim()].filter(Boolean))
  const items = seedItems.map((item, index) => {
    const normalized = summarizeText(item, 120)
    const lowered = item.toLowerCase()
    const type = /异常|边界|edge|error|empty|无权限|失败/.test(item) ? 'edge_case'
      : /按钮|页面|界面|弹窗|交互|flow|导航/.test(item) ? 'ux'
      : /必须|不得|限制|上限|only|must|should/.test(item) ? 'constraint'
      : /待确认|待补充|待定|question|unknown|unclear/.test(item) ? 'unresolved'
      : /如果|当|条件|状态|判断|逻辑/.test(item) ? 'logic'
      : 'functional'
    const mustPreserve = /必须|不得|only|must|按钮|字段|上限|排序|异常|边界|角色|权限/.test(item)
    return {
      id: `R-${String(index + 1).padStart(3, '0')}`,
      source_excerpt: item,
      normalized_summary: normalized,
      summary: normalized,
      type,
      scope_status: 'in_scope',
      must_preserve: mustPreserve,
      acceptance_signal: mustPreserve ? `验证 ${normalized}` : `确认 ${normalized} 可工作`,
      spec_targets: type === 'constraint' ? ['Constraints'] : type === 'ux' ? ['User-facing Behavior', 'Acceptance Criteria'] : ['Scope', 'Acceptance Criteria'],
      constraints: mustPreserve ? [normalized] : [],
      owner: /后端|接口|API|server|backend/.test(lowered) ? 'backend' : /前端|页面|UI|交互|frontend/.test(lowered) ? 'frontend' : 'shared',
      exclusion_reason: null,
    }
  })
  return {
    requirement_source: requirementSource,
    summary,
    items,
  }
}

function buildRequirementBaselineMarkdown(baseline) {
  const items = (baseline || {}).items || []
  const rows = items.map((item) => `| ${item.id} | ${item.type} | ${item.scope_status} | ${item.must_preserve ? 'yes' : 'no'} | ${item.normalized_summary} |`).join('\n') || '| - | - | - | - | - |'
  const protectedDetails = items.filter((item) => item.must_preserve).map((item) => `- ${item.id}: ${item.source_excerpt}`).join('\n') || '- 无'
  return [
    '# Requirement Baseline',
    '',
    `- Source: ${(baseline || {}).requirement_source || 'inline'}`,
    `- Total Requirements: ${items.length}`,
    '',
    '## Requirement Items',
    '',
    '| ID | Type | Scope | Must Preserve | Summary |',
    '|----|------|-------|---------------|---------|',
    rows,
    '',
    '## Critical Constraints',
    '',
    protectedDetails,
    '',
  ].join('\n')
}

function renderPreservedRequirementDetails(requirementBaseline) {
  const items = (requirementBaseline || []).filter((item) => item.must_preserve)
  if (!items.length) return '- 无需要额外保留的原始细节'
  return items.map((item) => `- ${item.id}: ${item.source_excerpt}`).join('\n')
}

function renderRequirementTraceability(requirementBaseline) {
  const items = requirementBaseline || []
  if (!items.length) return '| R-001 | 待补充 | §2 / §7 | 待定义 | P1 |'
  return items.map((item, index) => `| ${item.id} | ${item.normalized_summary} | §${item.type === 'constraint' ? '3' : item.type === 'ux' ? '4' : '2'} | ${item.acceptance_signal || '待定义'} | P${index + 1} |`).join('\n')
}

function renderCriticalConstraintsToPreserve(requirementBaseline) {
  const items = (requirementBaseline || []).filter((item) => item.must_preserve)
  if (!items.length) return '- 无'
  return items.map((item) => `- ${item.id}: ${item.normalized_summary}`).join('\n')
}

function renderRawRequirementNuances(requirementBaseline) {
  const items = (requirementBaseline || []).filter((item) => item.type === 'unresolved' || item.must_preserve)
  if (!items.length) return '- 当前需求已充分结构化，无额外 raw nuance'
  return items.map((item) => `- ${item.id}: ${item.source_excerpt}`).join('\n')
}

function buildRequirementCoverage(requirementBaseline) {
  return (requirementBaseline || []).filter((item) => item.scope_status === 'in_scope').map((item, index) => ({
    id: item.id,
    summary: item.normalized_summary,
    spec_section: item.type === 'constraint' ? '§3' : item.type === 'ux' ? '§4' : item.type === 'logic' ? '§5' : '§2',
    covered_by_tasks: [`T${index + 1}`],
    coverage_status: item.must_preserve ? 'protected' : 'covered',
    protected_details: item.must_preserve ? [item.normalized_summary] : [],
    must_preserve: Boolean(item.must_preserve),
    type: item.type,
    owner: item.owner,
    acceptance_signal: item.acceptance_signal,
  }))
}

function renderRequirementCoverage(requirementCoverage) {
  const rows = requirementCoverage || []
  if (!rows.length) return '| R-001 | 待补充 | §2 | T1 | pending |'
  return rows.map((row) => `| ${row.id} | ${row.summary} | ${row.spec_section} | ${(row.covered_by_tasks || []).join(', ')} | ${row.coverage_status} |`).join('\n')
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

function cmdStart(requirement, force = false, noDiscuss = false, projectId = null, projectRoot = null, specChoice = 'Spec 正确，生成 Plan') {
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
    if (existingState.status !== 'archived' && !force) {
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
  const requirementBaseline = buildRequirementBaseline(requirementText, summary, requirementSource)
  const requirementBaselinePath = path.join(workflowDir, 'requirement-baseline.json')
  const requirementBaselineSummaryRelative = path.join('.claude', 'analysis', `${slug}-requirement-baseline.md`)
  const requirementBaselineSummaryPath = path.join(root, requirementBaselineSummaryRelative)
  const requirementCoverage = buildRequirementCoverage(requirementBaseline.items)

  const analysisPatterns = (((config.tech) || {}).frameworks || []).map((framework) => ({ name: framework }))
  const roleSignals = deriveRoleSignals(requirementText, analysisPatterns, discussionArtifact, { taskName, summary })
  const planProfile = resolveRoleProfile('plan_generation', roleSignals)
  const planReviewProfile = resolveRoleProfile('plan_review', roleSignals)
  const executionReviewProfile = resolveRoleProfile('quality_review_stage2', roleSignals)
  const roleContextPath = path.join(workflowDir, 'role-context.json')
  const planInjectedContext = buildInjectedContext(
    { kind: 'document', ref: specRelative.replace(/\\/g, '/'), requirement_ids: requirementCoverage.map((item) => item.id), critical_constraints: requirementCoverage.flatMap((item) => item.protected_details || []).slice(0, 5) },
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
            { kind: 'diff_window', ref: 'HEAD', requirement_ids: requirementCoverage.map((item) => item.id), critical_constraints: requirementCoverage.flatMap((item) => item.protected_details || []).slice(0, 5) },
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

  const specContent = renderTemplate(specTemplate, {
    requirement_source: requirementSource,
    requirement_baseline_path: requirementBaselineSummaryRelative.replace(/\\/g, '/'),
    created_at: now,
    task_name: taskName,
    context_summary: `- 原始需求来源: ${requirementSource}\n- 需求摘要: ${summary}`,
    preserved_requirement_details: renderPreservedRequirementDetails(requirementBaseline.items),
    scope_summary: requirementBaseline.items.filter((item) => item.scope_status === 'in_scope').map((item) => `- ${item.id}: ${item.normalized_summary}`).join('\n') || '- 无',
    out_of_scope_summary: requirementBaseline.items.filter((item) => item.scope_status === 'out_of_scope').map((item) => `- ${item.id}: ${item.normalized_summary}`).join('\n') || '- 未在原始需求中明确提出的扩展项不纳入本次范围',
    blocked_summary: requirementBaseline.items.filter((item) => item.scope_status === 'blocked').map((item) => `- ${item.id}: ${item.normalized_summary}`).join('\n') || '- 无',
    requirement_traceability: renderRequirementTraceability(requirementBaseline.items),
    critical_constraints: '- 保持现有功能不受影响\n- 优先复用现有模块与状态管理能力',
    critical_constraints_to_preserve: renderCriticalConstraintsToPreserve(requirementBaseline.items),
    user_facing_behavior: `- 按需求实现并交付：${summary}`,
    architecture_summary: `- 以现有代码结构为基线，采用最小必要改动完成需求\n- 优先复用现有模块、状态流转与验证能力\n- Related Requirements: ${(requirementBaseline.items || []).map((item) => item.id).join(', ')}`,
    file_structure: `- ${specRelative.replace(/\\/g, '/')}\n- ${planRelative.replace(/\\/g, '/')}`,
    acceptance_criteria: requirementBaseline.items.map((item) => `- [ ] ${item.id}: ${item.acceptance_signal || item.normalized_summary}`).join('\n'),
    implementation_slices: requirementBaseline.items.map((item, index) => `- Slice ${index + 1}：响应 ${item.id} / ${item.normalized_summary}`).join('\n'),
    raw_requirement_nuances: renderRawRequirementNuances(requirementBaseline.items),
  })

  const planContent = renderTemplate(planTemplate, {
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
    requirement_coverage: renderRequirementCoverage(requirementCoverage),
    tasks: buildPlanTasks(requirementCoverage),
  })

  const parsedTasks = parseTasksV2(planContent)
  if (!parsedTasks.length) return { error: '生成的 Plan 未通过任务解析' }

  const specReview = mapSpecReviewChoice(specChoice)

  fs.mkdirSync(path.dirname(specPath), { recursive: true })
  fs.mkdirSync(path.dirname(planPath), { recursive: true })
  fs.mkdirSync(path.dirname(requirementBaselineSummaryPath), { recursive: true })
  fs.mkdirSync(workflowDir, { recursive: true })
  fs.writeFileSync(specPath, specContent)
  fs.writeFileSync(planPath, planContent)
  fs.writeFileSync(requirementBaselinePath, `${JSON.stringify(requirementBaseline, null, 2)}\n`)
  fs.writeFileSync(requirementBaselineSummaryPath, `${buildRequirementBaselineMarkdown(requirementBaseline)}\n`)
  fs.writeFileSync(discussionPath, `${JSON.stringify(discussionArtifact, null, 2)}\n`)
  fs.writeFileSync(roleContextPath, `${JSON.stringify(roleContextArtifact, null, 2)}\n`)
  if (uxArtifact) fs.writeFileSync(uxPath, `${JSON.stringify(uxArtifact, null, 2)}\n`)

  const finalWorkflowStatus = specReview.status === 'approved' ? 'planned' : specReview.workflow_status
  const state = ensureStateDefaults(buildMinimumState(resolvedProjectId, specRelative.replace(/\\/g, '/'), specRelative.replace(/\\/g, '/'), [parsedTasks[0].id], finalWorkflowStatus))
  state.plan_file = planRelative.replace(/\\/g, '/')
  state.project_root = root
  state.task_name = taskName
  state.requirement_source = requirementSource
  updateDiscussionRecord(state, discussionPath, (discussionArtifact.clarifications || []).length, !discussionRequired)
  updateRequirementBaselineRecord(state, {
    generated: true,
    path: requirementBaselineSummaryRelative.replace(/\\/g, '/'),
    artifact_path: 'requirement-baseline.json',
    summary_path: requirementBaselineSummaryRelative.replace(/\\/g, '/'),
    total_requirements: requirementBaseline.items.length,
    in_scope_count: requirementBaseline.items.filter((item) => item.scope_status === 'in_scope').length,
    out_of_scope_count: requirementBaseline.items.filter((item) => item.scope_status === 'out_of_scope').length,
    blocked_count: requirementBaseline.items.filter((item) => item.scope_status === 'blocked').length,
    must_preserve_count: requirementBaseline.items.filter((item) => item.must_preserve).length,
    uncovered_requirement_ids: requirementCoverage.filter((item) => item.coverage_status === 'pending').map((item) => item.id),
  })
  updateContextInjection(state, {
    schema_version: '1',
    signals: roleSignals,
    planning: {
      plan_generation: { role: planProfile.role, profile: planProfile.profile },
      plan_review: { role: planReviewProfile.role, profile: planReviewProfile.profile },
    },
    execution: {
      quality_review_stage2: { role: executionReviewProfile.role, profile: executionReviewProfile.profile },
    },
    artifact_path: path.relative(root, roleContextPath).replace(/\\/g, '/'),
  })
  updatePlanReviewRecord(state, {
    status: 'pending',
    review_mode: 'machine_loop',
    reviewer: 'subagent',
    role: planReviewProfile.role,
    profile: planReviewProfile.profile,
    signals_snapshot: roleSignals,
    next_action: 'compile_tasks',
  })
  if (uxArtifact) {
    updateUxDesignRecord(state, uxPath, uxValidation.scenario_count, uxValidation.page_count, uxValidation.ok)
  }
  updateUserSpecReview(state, specReview.status, specReview.next_action)
  writeState(statePath, state)

  return {
    started: true,
    project_id: resolvedProjectId,
    config_healed: configHealed,
    workflow_status: state.status,
    spec_file: specRelative.replace(/\\/g, '/'),
    plan_file: planRelative.replace(/\\/g, '/'),
    task_count: parsedTasks.length,
    current_tasks: state.current_tasks || [],
    discussion_required: discussionRequired,
    ux_gate_required: uxRequired,
    spec_review_summary: buildSpecReviewSummary(specContent),
  }
}

function detectDeltaTrigger(source, projectRoot) {
  const raw = String(source || '').trim()
  if (!raw) return { type: 'sync', source: null, description: '执行 API 同步' }
  const absolute = path.isAbsolute(raw) ? raw : path.join(projectRoot, raw)
  if (raw.endsWith('.md') && fs.existsSync(absolute)) return { type: 'prd', source: raw, description: `PRD 更新: ${path.basename(raw)}` }
  if (raw.endsWith('Api.ts') || raw.includes('/autogen/') || raw.endsWith('.api.ts')) return { type: 'api', source: raw, description: `API 变更: ${raw}` }
  return { type: 'requirement', source: raw, description: summarizeText(raw, 120) }
}

function cmdDelta(source = '', projectId = null, projectRoot = null) {
  const [resolvedProjectId, root, workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return { error: '没有活跃的工作流' }

  const normalizedState = ensureStateDefaults(state)
  if (normalizedState.status === 'archived') return { error: '当前工作流已归档，无法追加 delta' }

  const trigger = detectDeltaTrigger(source, root)
  const tracking = normalizedState.delta_tracking || (normalizedState.delta_tracking = {})
  const parentChange = tracking.current_change || null
  const changeId = recordDeltaChange(normalizedState)

  const changeDir = path.join(workflowDir, 'changes', changeId)
  fs.mkdirSync(changeDir, { recursive: true })

  const artifacts = createDeltaArtifacts(changeId, trigger, parentChange)
  let taskDeltas = []
  const [, , tasksContent, tasksPath] = resolveStateAndTasks(resolvedProjectId, root)
  if (tasksContent && tasksPath && trigger.type === 'requirement') {
    const existingTasks = parseTasksV2(tasksContent).map(taskToDict)
    taskDeltas = buildTaskDeltaExamples(changeId, trigger, existingTasks)
    fs.writeFileSync(tasksPath, applyTaskDeltas(tasksContent, taskDeltas))
    artifacts.delta.task_deltas = taskDeltas
    artifacts.delta.impact_analysis.summary = `applied ${taskDeltas.length} task delta(s)`
  }

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
    current_change: tracking.current_change,
    review_status_file: path.join(changeDir, 'review-status.json'),
    task_delta_summary: summarizeTaskDeltas(taskDeltas),
  }
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
  buildRequirementBaseline,
  buildRequirementBaselineMarkdown,
  renderPreservedRequirementDetails,
  renderRequirementTraceability,
  renderCriticalConstraintsToPreserve,
  renderRawRequirementNuances,
  buildRequirementCoverage,
  renderRequirementCoverage,
  cmdStart,
  detectDeltaTrigger,
  cmdDelta,
  cmdArchive,
  cmdUnblock,
}
