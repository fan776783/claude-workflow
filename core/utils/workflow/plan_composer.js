#!/usr/bin/env node
/** @file plan composer - 从 lifecycle_cmds.js 拆出的 Plan / Spec Review 命令与 requirement 覆盖率计算 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// 生成当前日期后缀，格式 MMDD（如 0506）
function getDateSuffix() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${mm}${dd}`
}

const { getWorkflowsDir, validateProjectId } = require('./path_utils')
const { parseTasksV2 } = require('./task_parser')
const {
  readState,
  updateCodexPlanReview,
  updateCodexSpecReview,
  updateContextInjection,
  updateDiscussionRecord,
  updatePlanReviewRecord,
  updateUserSpecReview,
  updateUxDesignRecord,
  writeState,
} = require('./state_manager')
const { detectProjectRoot } = require('./task_manager')
const { getCodeSpecsContext, getCodeSpecsContextScoped } = require('./task_runtime')
const { buildMinimumState, ensureStateDefaults } = require('./workflow_types')
const {
  buildSpecReviewSummary,
  deriveRoleSignals,
  mapSpecReviewChoice,
  shouldRunCodexPlanReview,
  shouldRunCodexSpecReview,
  shouldRunDiscussion,
  shouldRunUxDesignGate,
} = require('./planning_gates')
const {
  buildInjectedContext,
  buildAgentPrompt,
  resolveRoleProfile,
} = require('./role_injection')
const {
  detectGitHead,
  extractProjectId,
  loadProjectConfig,
  slugifyFilename,
  summarizeText,
} = require('./project_setup')
const {
  buildTechStackSummary,
  deriveTaskName,
  resolveRequirementInput,
  resolveWorkflowRuntime,
} = require('./runtime_locator')

function renderTemplate(template, values) {
  let rendered = String(template || '')
  for (const [key, value] of Object.entries(values || {})) {
    rendered = rendered.split(`{{${key}}}`).join(value)
  }
  return rendered
}

function stripProjectCodeSpecsSection(content) {
  return String(content || '').replace(/\n### 3\.x Project Code Specs Constraints[\s\S]*?\n---\n/, '\n---\n')
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

// 推断 plan 任务块应挂的 package。
// 单包项目回退链：project.name → package.json#name → 仓库目录名（与 spec_bootstrap.resolvePackages 对齐）。
// Monorepo 回退链：config.monorepo.defaultPackage → config.monorepo.packages[0]。
// 两条链都是"给 plan 生成器一个**可落地**的默认值，避免生成出无 Package 的任务块"；
// 与 runtime resolver 的"monorepo 不推断默认包"契约区别是：plan 阶段是一次性编译，无 active task，
// 选错了的代价是 hook 注入的 code-specs scope 偏到错误 subtree（soft-fail 到全树），不是破坏状态机。
function inferTaskPackage(projectRoot, config) {
  const type = ((config || {}).project || {}).type
  if (type === 'monorepo') {
    const mono = (config || {}).monorepo || {}
    const def = mono.defaultPackage
    if (def && String(def).trim()) return String(def).trim()
    const list = Array.isArray(mono.packages) ? mono.packages : []
    const first = list.find((item) => item && String(item).trim())
    return first ? String(first).trim() : ''
  }
  const configName = ((config || {}).project || {}).name
  if (configName && String(configName).trim()) return String(configName).trim()
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
    if (pkgJson && pkgJson.name) return String(pkgJson.name).replace(/^@[^/]+\//, '')
  } catch { /* ignore */ }
  return path.basename(path.resolve(projectRoot))
}

function buildTaskBlock(entry, index, allEntries = [], pkg = '', specRef = '') {
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
  const packageLine = pkg ? `- **Package**: ${pkg}\n` : ''
  const specLine = specRef ? String(specRef).replace(/\\/g, '/') : `${fileBucket}/${fileSlug}.md`
  return `## ${taskId}: 实现 ${entry.id} ${entry.summary}
- **阶段**: implement
${packageLine}- **Spec 参考**: ${entry.spec_section}, §7
- **Plan 参考**: P${index + 1}
- **需求 ID**: ${entry.id}
- **创建文件**: ${fileBucket}/${fileSlug}.ts
- **修改文件**: ${specLine}
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

function buildPlanTasks(requirementCoverage = [], pkg = '', specRef = '') {
  if (!requirementCoverage.length) {
    const packageLine = pkg ? `- **Package**: ${pkg}\n` : ''
    const specLine = specRef ? String(specRef).replace(/\\/g, '/') : 'src/shared/r-001.md'
    return `## T1: 实现核心需求
- **阶段**: implement
${packageLine}- **Spec 参考**: §2, §5, §7
- **Plan 参考**: P1
- **需求 ID**: R-001
- **创建文件**: src/shared/r-001.ts
- **修改文件**: ${specLine}
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
  return requirementCoverage.map((entry, index, allEntries) => buildTaskBlock(entry, index, allEntries, pkg, specRef)).join('\n')
}

function inferPlanRelativeFromSpec(specRelative, taskName, workflowDir = null) {
  const normalizedSpec = String(specRelative || '').replace(/\\/g, '/')
  // 新路径格式：绝对路径指向 workflowDir/specs/
  if (path.isAbsolute(normalizedSpec) && normalizedSpec.includes('/specs/')) {
    const dir = path.dirname(normalizedSpec)
    const base = path.basename(normalizedSpec)
    return path.join(dir.replace(/\/specs$/, '/plans'), base)
  }
  // 兼容旧路径格式
  if (normalizedSpec.startsWith('.claude/specs/')) {
    return normalizedSpec.replace('.claude/specs/', '.claude/plans/')
  }
  const slug = slugifyFilename(taskName) || 'workflow-task'
  const dateSuffix = getDateSuffix()
  if (workflowDir) {
    return path.join(workflowDir, 'plans', `${slug}-${dateSuffix}.md`)
  }
  return path.join('.claude', 'plans', `${slug}.md`).replace(/\\/g, '/')
}

function cmdPlan(requirement, force = false, noDiscuss = false, projectId = null, projectRoot = null, specChoice = 'Spec 正确，生成 Plan') {
  const root = detectProjectRoot(projectRoot)
  if (projectId && !validateProjectId(projectId)) return { error: `非法项目 ID: ${projectId}` }

  const config = loadProjectConfig(root)
  if (!config) {
    return { error: '缺少 project-config.json，请先执行 /scan（空项目使用 /scan --init）。', reason: 'missing_project_config' }
  }
  const configProjectId = extractProjectId(config)
  if (!configProjectId) {
    return { error: 'project-config.json 未提供合法 project.id，请执行 /scan --force 重新生成。', reason: 'invalid_project_config' }
  }
  if (projectId && projectId !== configProjectId) {
    return { error: `--project-id 与 project-config.json 中的 project.id 不一致（CLI: ${projectId} vs config: ${configProjectId}）`, reason: 'project_id_mismatch' }
  }
  const resolvedProjectId = configProjectId

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
  const dateSuffix = getDateSuffix()

  // 产物存放到 ~/.claude/workflows/{pid}/ 下，文件名带日期后缀
  const specPath = path.join(workflowDir, 'specs', `${slug}-${dateSuffix}.md`)
  const planPath = path.join(workflowDir, 'plans', `${slug}-${dateSuffix}.md`)
  // specRelative/planRelative 名义保留（state.spec_file/plan_file 字段历史叫法），
  // 但在新路径方案下其值是 OS 展开后的绝对路径；下游通过 path.isAbsolute 区分新旧格式
  const specRelative = specPath
  const planRelative = planPath

  if (!force) {
    if (fs.existsSync(specPath)) return { error: `Spec 已存在: ${specPath}` }
    if (fs.existsSync(planPath)) return { error: `Plan 已存在: ${planPath}` }
  }

  const trimmed = String(requirementText || '').trim()
  const gapCount = (requirementSource === 'inline' && trimmed.length <= 100) ? 0 : (trimmed ? 1 : 0)
  const discussionRequired = shouldRunDiscussion(requirementText, requirementSource, noDiscuss, gapCount)
  const discussionArtifact = { requirementSource, clarifications: [], selectedApproach: null, unresolvedDependencies: [] }

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

  const now = new Date().toISOString()
  const templateRoot = path.resolve(__dirname, '..', '..', 'specs', 'workflow-templates')
  const specTemplate = fs.readFileSync(path.join(templateRoot, 'spec-template.md'), 'utf8')
  const planTemplate = fs.readFileSync(path.join(templateRoot, 'plan-template.md'), 'utf8')

  const requirementItems = extractRequirementItems(requirementText, summary)
  const requirementCoverage = buildRequirementCoverage(requirementItems)
  const planPackage = inferTaskPackage(root, config)
  const codeSpecsConstraints = (planPackage
    ? getCodeSpecsContextScoped(root, { activePackage: planPackage, source: 'config' }, 1500)
    : getCodeSpecsContext(root, 1500)) || ''

  const renderedSpecContent = renderTemplate(specTemplate, {
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
    code_specs_constraints: codeSpecsConstraints,
  })
  const specContent = codeSpecsConstraints ? renderedSpecContent : stripProjectCodeSpecsSection(renderedSpecContent)

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
      tasks: buildPlanTasks(planRequirementCoverage, planPackage, specRelative.replace(/\\/g, '/')),
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
  fs.writeFileSync(roleContextPath, `${JSON.stringify(roleContextArtifact, null, 2)}\n`)

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
  updateDiscussionRecord(state, (discussionArtifact.clarifications || []).length, !discussionRequired)

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
  updateUxDesignRecord(state, 0, 0, false, uxRequired)
  updateUserSpecReview(state, specReview.status, specReview.next_action)
  if (!shouldGeneratePlan) state.current_tasks = []
  writeState(statePath, state)

  return {
    started: true,
    project_id: resolvedProjectId,
    config_healed: false,
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
  // 支持绝对路径（新格式）和相对路径（旧格式兼容）
  const specPath = path.isAbsolute(specRelative) ? specRelative : path.join(root, specRelative)
  if (!fs.existsSync(specPath)) return { error: 'spec 文件不存在，无法继续生成 Plan', project_id: resolvedProjectId }
  const specContent = fs.readFileSync(specPath, 'utf8')

  const requirementText = String(normalizedState.requirement_text || specContent).trim()
  const requirementSource = normalizedState.requirement_source || 'inline'
  const taskName = normalizedState.task_name || deriveTaskName(requirementText, null)
  const summary = summarizeText(extractSubsection(extractNamedSection(specContent, 'Scope'), 'In Scope') || requirementText, 120)

  const planRelative = inferPlanRelativeFromSpec(normalizedState.plan_file || specRelative, taskName, workflowDir)
  const planPath = path.isAbsolute(planRelative) ? planRelative : path.join(root, planRelative)
  const discussionState = normalizedState.discussion || {}
  const discussionForSignals = { requirementSource, clarifications: [], selectedApproach: null, unresolvedDependencies: discussionState.unresolved_dependencies || [] }
  const analysisPatterns = (((config.tech) || {}).frameworks || []).map((framework) => ({ name: framework }))
  const roleSignals = deriveRoleSignals(requirementText, analysisPatterns, discussionForSignals, { taskName, summary })
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
  const resumePlanPackage = inferTaskPackage(root, config)
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
    tasks: buildPlanTasks(requirementCoverage, resumePlanPackage, specRelative),
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

module.exports = {
  renderTemplate,
  extractRequirementItems,
  buildRequirementCoverage,
  renderRequirementCoverage,
  buildPRDCoverageReport,
  buildPlanTasks,
  cmdPlan,
  cmdSpecReview,
}
