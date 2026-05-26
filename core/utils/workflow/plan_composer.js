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
const { triggerCodexReview } = require('./codex_review_runner')
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
  resolveRoleProfile,
} = require('./role_injection')
const {
  detectGitHead,
  extractProjectId,
  isLegacySpecLocation,
  loadProjectConfig,
  resolveSpecDocsRoot,
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
  return `<!-- WF:ANCHOR:task:${taskId}:begin -->
## ${taskId}: 实现 ${entry.id} ${entry.summary}
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
<!-- WF:ANCHOR:task:${taskId}:end -->
`
}

// T4 Task Atomicity Rule lint：扫 plan markdown，找 task 描述里的 "N 个 / N 项 / N 列" 关键字配 sub-task 数。
// 当 N >= 5 且对应 task 的 sub-bullet (`  - A` / `- A` 等) 数 < N 时，emit 一条 warning。
// 不阻断 — plan 上游消费者按需展示给用户。
function lintTaskAtomicity(planMarkdown, thresholdN = 5) {
  if (!planMarkdown || typeof planMarkdown !== 'string') return { warnings: [], checked_tasks: 0 }
  const warnings = []
  const taskBlocks = String(planMarkdown).split(/\n(?=## T\d+:|### T\d+:)/g)
  let checked = 0
  for (const block of taskBlocks) {
    const idMatch = block.match(/^(?:## |### )?(T\d+):/m)
    if (!idMatch) continue
    checked++
    const taskId = idMatch[1]
    // 找数字 + 单位的关键字
    const subItemMatch = block.match(/(\d+)\s*(个|项|列|字段|筛选项|标签|tab|列|sub-?task)/i)
    if (!subItemMatch) continue
    const declared = Number(subItemMatch[1])
    if (declared < thresholdN) continue
    // 统计 sub-bullet 数（A1/A2/... 或 `  - 一句一行`）
    const subSteps = block.match(/^\s*-\s*[A-Z]\d+:|^\s*-\s+\*\*[^*]+\*\*/gm) || []
    const subStepCount = subSteps.length
    if (subStepCount < declared) {
      warnings.push({
        task_id: taskId,
        declared_subitems: declared,
        observed_substeps: subStepCount,
        unit: subItemMatch[2],
        message: `${taskId} 声明含 ${declared} 个 ${subItemMatch[2]} 但 sub-steps 仅 ${subStepCount} 条；按 Task Atomicity Rule 应拆为 ${declared} 个 sub-task 各带独立 acceptance bullet`,
      })
    }
  }
  return { warnings, checked_tasks: checked }
}

// T1 lintPlaceholder：扫 plan markdown 寻找 TBD/TODO/中文占位/模板残留。
// 命中即 push 一条 {line, token, context}。不阻断本函数,由 cmdPlanReview 聚合时 hard-block ready。
const PLACEHOLDER_TOKENS_EN = [
  'TBD',
  'TODO',
  'implement later',
  'fill in details',
  'Add appropriate error handling',
  'add validation',
  'Write tests for the above',
]
const PLACEHOLDER_TOKENS_ZH = [
  '待补充',
  '暂未确定',
  '稍后完善',
  'TODO 后续完善',
  '[填这里]',
  '[待定]',
  '【占位】',
]
// F-16: 裸 `占位` 故意不进 token 列表。前端 plan 里 `占位图` / `占位符` / `占位 icon` / `展示占位` / `英文占位`
// 是高频业务名词,30 个历史 plan 实测 43/43 命中全为误报、0 真·未填残留。真填空标记由
// `【占位】`(显式括号) + TBD/TODO/待补充/待确认/[待定]/{{name}} 兜住,裸 `占位` 纯噪声。

// 元描述 / 指令性短语：含任一 hint 的行 = 在"描述占位符 / 解释扫描规则"而非"使用占位符",
// 跳过整行 placeholder 扫描。修复 plan-template.md 自带 Self-Review Checklist 行被误判的 F-01。
// **匹配范围必须窄**：避免误伤真实 plan 内容中出现 `placeholder` / `占位符` 单词的违规行
// (例 `- TODO placeholder implementation` 应当被捕获,而非整行跳过)。F-06 把宽泛词收窄为多词短语。
// 与 doc_contracts.IGNORED_PLACEHOLDER_LINE_HINTS 的差异：doc_contracts 跑在文档表面,
// 把 `similar to task` / `implement later` 等 **pattern 描述本身**也加入 IGNORE；而 lintPlaceholder
// 跑在 **plan 实体文件**上,这些 pattern 短语出现 = 真违规,**不应**加入豁免。
const PLACEHOLDER_INSTRUCTIONAL_HINTS = [
  // 检查规则描述短语(多词锚定,避免误伤单词)
  '搜索 tbd/todo',
  '禁止 tbd/todo',
  'no tbd',
  'no placeholders',
  'placeholder scan',
  'placeholder rules',
  '禁止占位符',
  '占位符规则',
  '替换为实际内容',
  'plan failure',
  // 引号包裹的 token = 元描述(典型出现在 references / 教程文档)
  '"tbd"',
  '"todo"',
  '“tbd”',
  '“todo”',
  '`tbd`',
  '`todo`',
  '`待补充`',
  '`待确认`',
]

function isInstructionalLine(line) {
  const lowered = String(line || '').toLowerCase()
  return PLACEHOLDER_INSTRUCTIONAL_HINTS.some((hint) => lowered.includes(hint))
}

function lintPlaceholder(planMarkdown) {
  if (!planMarkdown || typeof planMarkdown !== 'string') return { hits: [] }
  const hits = []
  const lines = String(planMarkdown).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isInstructionalLine(line)) continue
    const lineNo = i + 1
    const context = line.trim().slice(0, 80)
    // F-15: 英文 token 大小写不敏感(`tbd` / `todo` 小写写法也应捕获);中文 token 保持原样。
    const lineLower = line.toLowerCase()
    for (const token of PLACEHOLDER_TOKENS_EN) {
      if (lineLower.includes(token.toLowerCase())) {
        hits.push({ line: lineNo, token, context })
      }
    }
    for (const token of PLACEHOLDER_TOKENS_ZH) {
      if (line.includes(token)) {
        hits.push({ line: lineNo, token, context })
      }
    }
    // Similar to Task N
    const similarMatch = line.match(/Similar to Task \d+/i)
    if (similarMatch) {
      hits.push({ line: lineNo, token: similarMatch[0], context })
    }
    // 模板未渲染残留 {{name}}
    const unrenderedMatch = line.match(/\{\{\w+\}\}/g)
    if (unrenderedMatch) {
      for (const m of unrenderedMatch) {
        hits.push({ line: lineNo, token: 'unrendered_template', context: m })
      }
    }
  }
  return { hits }
}

// T11 lintAnchorIntegrity：校验 plan.md 内 <!-- WF:ANCHOR:<id>:(begin|end) --> 配对完整性。
// orphans = 无配对的锚点(only begin / only end / 不平衡)；
// missing = 期望集合缺失的 ID(file_structure / tasks / verification_summary + 每个 task:Tn)。
// expected 列表只在 v2 plan 上有意义；v1 plan 调用方可忽略此 lint。
const REQUIRED_TOP_LEVEL_ANCHORS = ['file_structure', 'tasks', 'verification_summary']

function lintAnchorIntegrity(planMarkdown) {
  const planMd = typeof planMarkdown === 'string' ? planMarkdown : ''
  const ANCHOR_RE = /<!--\s*WF:ANCHOR:([\w:\-]+?):(begin|end)\s*-->/g
  const seen = {}
  let m
  while ((m = ANCHOR_RE.exec(planMd)) !== null) {
    const id = m[1]
    const side = m[2]
    seen[id] = seen[id] || { begin: 0, end: 0 }
    seen[id][side]++
  }
  const orphans = []
  for (const id of Object.keys(seen)) {
    const { begin, end } = seen[id]
    if (begin !== 1 || end !== 1) {
      orphans.push({ id, begin, end })
    }
  }
  // 期望集合:顶层 3 个 + 每个 `## Tn:` / `### Tn:` 标题都必须有对应的 task:Tn 锚点对。
  // 与 extractTaskRequirementRefs / derivePlanSummary / lintCommandSyntax 等共用 heading 形态(`##` 或 `###`)。
  const taskIds = (planMd.match(/^(?:##|###)\s+(T\d+):/gm) || []).map((s) => s.match(/T\d+/)[0])
  const expectedTaskAnchors = taskIds.map((tid) => `task:${tid}`)
  const expected = [...REQUIRED_TOP_LEVEL_ANCHORS, ...expectedTaskAnchors]
  const missing = []
  for (const id of expected) {
    if (!seen[id]) missing.push(id)
  }
  // F-12: stale task anchors — observed task:* 没有对应 `## Tn:` heading,
  // 通常是 plan-edit 替换 heading 但没清理旧 anchor 的残留。会让 state.current_tasks[0]
  // 指向已不存在的 task。
  const expectedSet = new Set(expected)
  const stale = []
  for (const id of Object.keys(seen)) {
    if (!id.startsWith('task:')) continue
    if (!expectedSet.has(id)) stale.push(id)
  }
  return { orphans, missing, stale, expected, observed_ids: Object.keys(seen) }
}

// T2 checkRequirementCoverage：对比 spec 中的 R-ID 与 plan 内 task 引用的 R-ID。
// covered = 交集；uncovered = spec 有 plan 无（hard-block ready）；
// partial = spec 多处提及但 plan 仅 1 个 task 触及（soft warning，扣 PRD 1 分）。
function extractTaskRequirementRefs(planMarkdown) {
  // 每个 task 块抽 `- **需求 ID**: <ids>` 字段，split 逗号/空格/中文逗号。
  // F-08：先 strip backticks(与 task_parser.extractField L80 行为一致),否则 `R-001` 形式漏检。
  const refs = []
  const taskBlocks = String(planMarkdown).split(/\n(?=## T\d+:|### T\d+:)/g)
  for (const block of taskBlocks) {
    const idHeaderMatch = block.match(/^(?:## |### )?(T\d+):/m)
    if (!idHeaderMatch) continue
    const taskId = idHeaderMatch[1]
    const fieldMatch = block.match(/-\s*\*\*需求\s*ID\*\*\s*[:：]\s*([^\n]+)/)
    if (!fieldMatch) continue
    const tokens = fieldMatch[1]
      .replace(/`/g, '')
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter((t) => /^R-\d{3,}$/.test(t))
    for (const r of tokens) {
      refs.push({ task: taskId, requirement_id: r })
    }
  }
  return refs
}

// F-07：仅从 spec §2.1 In Scope 提取 R-IDs。§2.2 Out of Scope / §2.3 Blocked / §3 Constraints
// 等其它章节可能 reference R-ID,但按 traceability rule 不进入 plan 覆盖判定。
// 找不到 In Scope 章节时退化为全文扫描(向后兼容,避免新规则误杀老 spec)。
function extractInScopeRequirementIds(specMarkdown) {
  const specMd = String(specMarkdown || '')
  // 章节定位:### 2.1 In Scope ... 直到下一个 ## / ### / --- / EOF
  const headingMatch = specMd.match(/^###\s+2\.1\s+In Scope.*$/m)
  if (!headingMatch) {
    // fallback：老 spec 没有标准 §2.1 → 全文扫描(保留向后兼容)
    return Array.from(new Set(specMd.match(/\bR-\d{3,}\b/g) || []))
  }
  const startIdx = specMd.indexOf(headingMatch[0]) + headingMatch[0].length
  const tail = specMd.slice(startIdx)
  const stopMatch = tail.match(/\n(##\s|###\s|---)/)
  const section = stopMatch ? tail.slice(0, stopMatch.index) : tail
  return Array.from(new Set(section.match(/\bR-\d{3,}\b/g) || []))
}

function checkRequirementCoverage(planMarkdown, specMarkdown) {
  const safe = (s) => (typeof s === 'string' ? s : '')
  const planMd = safe(planMarkdown)
  const specMd = safe(specMarkdown)
  if (!specMd) {
    return { uncovered_ids: [], partial_ids: [], covered_ids: [], note: 'spec_missing' }
  }
  const specIds = extractInScopeRequirementIds(specMd)
  const planRefs = extractTaskRequirementRefs(planMd)
  const planIds = Array.from(new Set(planRefs.map((r) => r.requirement_id)))
  const covered = specIds.filter((id) => planIds.includes(id))
  const uncovered = specIds.filter((id) => !planIds.includes(id))
  const partial = []
  for (const id of covered) {
    const escaped = id.replace(/[-]/g, '\\-')
    const specMentions = (specMd.match(new RegExp(`\\b${escaped}\\b`, 'g')) || []).length
    const planTaskRefs = planRefs.filter((r) => r.requirement_id === id).length
    if (specMentions >= 2 && planTaskRefs === 1) partial.push(id)
  }
  return { uncovered_ids: uncovered, partial_ids: partial, covered_ids: covered }
}

// T3 derivePlanSummary：解析 plan body 抽 Step 3 输出摘要字段。
// state 用于注入 spec_file / plan_file 路径（plan body 内不强求出现）。
const INTERACTION_LEGEND = 'AFK = 不需人介入 / HITL = 需人工介入(QA、文案、PM 确认)'

function parseTaskMetaBlock(block) {
  const get = (label) => {
    const re = new RegExp(`-\\s*\\*\\*${label}\\*\\*\\s*[:：]\\s*([^\\n]+)`)
    const m = block.match(re)
    return m ? m[1].trim() : ''
  }
  const idMatch = block.match(/^(?:## |### )?(T\d+):\s*(.+)$/m)
  return {
    id: idMatch ? idMatch[1] : '',
    title: idMatch ? idMatch[2].trim() : '',
    phase: get('阶段'),
    deliverable: get('创建文件') || get('修改文件'),
    deps: get('依赖'),
    interaction: get('Interaction') || 'AFK',
  }
}

function derivePlanSummary(planMarkdown, state = {}) {
  const planMd = typeof planMarkdown === 'string' ? planMarkdown : ''
  const blocks = planMd.split(/\n(?=## T\d+:|### T\d+:)/g).filter((b) => /^(?:## |### )?T\d+:/m.test(b))
  const task_table = blocks.map(parseTaskMetaBlock)
  const planRefs = extractTaskRequirementRefs(planMd)
  const coveredIdsInPlan = Array.from(new Set(planRefs.map((r) => r.requirement_id)))
  return {
    paths: {
      spec: state.spec_file || '',
      plan: state.plan_file || '',
    },
    req_stats: {
      total_referenced: coveredIdsInPlan.length,
      tasks_with_refs: planRefs.length,
    },
    task_count: task_table.length,
    task_table,
    interaction_legend: INTERACTION_LEGEND,
  }
}

// T4 scoreConfidence：按 rubric 算 0-10 分。
// PRD +3 / Patterns +2 / Verification +3 / Test Task +2；partial 命中 PRD -1。
// F-10: command_syntax issues 非空 → verification 维度封顶为 0(命令本身坏不算合格验证);
//       pattern_fidelity unresolved 非空 → patterns 维度封顶为 0(引用不真实的 pattern 不算可复用)。
function scoreConfidence(planMarkdown, { coverage, atomicity, commandSyntax, patternFidelity } = {}) {
  const planMd = typeof planMarkdown === 'string' ? planMarkdown : ''
  const breakdown = { prd_coverage: 0, patterns: 0, verification: 0, test_task: 0 }
  // hints：每个未达标/被封顶维度给一行可执行提升项，让调用方拿到 why 而不必读本文件源码逆向 rubric。
  const hints = []

  // PRD 覆盖率
  const partialIds = (coverage && coverage.partial_ids) || []
  const uncoveredIds = (coverage && coverage.uncovered_ids) || []
  if (coverage && (coverage.covered_ids || coverage.uncovered_ids)) {
    const covered = (coverage.covered_ids || []).length
    const uncovered = uncoveredIds.length
    const total = covered + uncovered
    if (total > 0) {
      const rate = covered / total
      if (rate >= 0.9) {
        breakdown.prd_coverage = partialIds.length > 0 ? 2 : 3
      }
    }
  }
  if (breakdown.prd_coverage === 0 && uncoveredIds.length) {
    hints.push(`prd_coverage=0：spec 需求未被任何 task 覆盖 → ${uncoveredIds.join(', ')}`)
  } else if (breakdown.prd_coverage === 0) {
    hints.push('prd_coverage=0：无 spec 需求覆盖数据（coverage 为空或 spec 未提取出需求）')
  } else if (breakdown.prd_coverage === 2 && partialIds.length) {
    hints.push(`prd_coverage=2（封顶 3）：${partialIds.join(', ')} spec 多处提及仅单 task 覆盖；拆分或确认单 task 已覆盖全部提及点`)
  }

  // Patterns to Mirror（要求至少 3 个 ### 头紧跟 `// SOURCE:`）
  // F-10: pattern_fidelity 有 unresolved 引用 → 不给分(引用文件不存在,pattern 不可复用)
  const patternMatches = planMd.match(/^### .+\n+\/\/ SOURCE:/gm) || []
  const patternUnresolvedCount = (patternFidelity && patternFidelity.unresolved) ? patternFidelity.unresolved.length : 0
  if (patternMatches.length >= 3 && patternUnresolvedCount === 0) breakdown.patterns = 2
  else if (patternUnresolvedCount > 0) {
    hints.push(`patterns=0：Patterns to Mirror 有 ${patternUnresolvedCount} 处 // SOURCE 引用文件不存在，修正引用后给分`)
  } else {
    hints.push(`patterns=0：需 ≥3 个 \`### 标题\` 各紧跟一行 \`// SOURCE: <file>\`（当前 ${patternMatches.length} 个达标块）`)
  }

  // Verification 维度：每 task 必须 验证命令 + 验证期望 同时非空
  // F-10: command_syntax 有 issues → 不给分(命令本身语法坏,验证不可信)
  const taskBlocks = planMd.split(/\n(?=## T\d+:|### T\d+:)/g).filter((b) => /^(?:## |### )?T\d+:/m.test(b))
  const commandIssuesCount = (commandSyntax && commandSyntax.issues) ? commandSyntax.issues.length : 0
  const unqualifiedTasks = taskBlocks
    .filter((b) => {
      const cmd = b.match(/-\s*\*\*验证命令\*\*\s*[:：]\s*([^\n]+)/)
      const exp = b.match(/-\s*\*\*验证期望\*\*\s*[:：]\s*([^\n]+)/)
      return !(cmd && cmd[1].trim() && exp && exp[1].trim())
    })
    // 锚定 heading 取 task id（与 split/filter 同形态），避免抓到块内首个 T\d+（如正文里引用的别的 task）
    .map((b) => {
      const h = b.match(/^(?:## |### )?(T\d+):/m)
      return h ? h[1] : (b.match(/T\d+/) || ['?'])[0]
    })
  if (taskBlocks.length > 0 && commandIssuesCount === 0 && unqualifiedTasks.length === 0) {
    breakdown.verification = 3
  } else if (commandIssuesCount > 0) {
    hints.push(`verification=0：${commandIssuesCount} 处验证命令语法有问题（见 lints.command_syntax）`)
  } else if (unqualifiedTasks.length > 0) {
    hints.push(`verification=0：${unqualifiedTasks.join(', ')} 缺 \`验证命令\` 或 \`验证期望\`（每 task 两者须非空）`)
  } else if (taskBlocks.length === 0) {
    hints.push('verification=0：plan 中无可识别的 `## T<n>:` / `### T<n>:` task 块，无法评估验证维度')
  }

  // Test task 存在
  if (/-\s*\*\*阶段\*\*\s*[:：]\s*test\b/m.test(planMd)) breakdown.test_task = 2
  else hints.push('test_task=0：无 `阶段: test` 任务；纯手动验证 plan 可忽略此项，不必为凑分造测试任务')

  const score = breakdown.prd_coverage + breakdown.patterns + breakdown.verification + breakdown.test_task
  const level = score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low'
  // atomicity 仅记录，不进 rubric（与 ready 矩阵一致）
  return { score, level, breakdown, hints, atomicity_warnings_count: (atomicity && atomicity.warnings) ? atomicity.warnings.length : 0 }
}

function buildPlanTasks(requirementCoverage = [], pkg = '', specRef = '') {
  if (!requirementCoverage.length) {
    const packageLine = pkg ? `- **Package**: ${pkg}\n` : ''
    const specLine = specRef ? String(specRef).replace(/\\/g, '/') : 'src/shared/r-001.md'
    return `<!-- WF:ANCHOR:task:T1:begin -->
## T1: 实现核心需求
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
<!-- WF:ANCHOR:task:T1:end -->
`
  }
  return requirementCoverage.map((entry, index, allEntries) => buildTaskBlock(entry, index, allEntries, pkg, specRef)).join('\n')
}

function inferPlanRelativeFromSpec(specRelative, taskName, workflowDir = null) {
  const normalizedSpec = String(specRelative || '').replace(/\\/g, '/')
  // plan.md 始终落到 workflowDir/plans/（user 级），与 spec 落点无关。
  // 优先取已知 base name 沿用同 slug-MMDD，避免规划期重新派生不一致。
  const baseName = normalizedSpec ? path.basename(normalizedSpec) : null
  if (workflowDir && baseName) {
    return path.join(workflowDir, 'plans', baseName)
  }
  // 旧的 user 级 spec 在 workflowDir/specs/ 时按目录平移（向后兼容）
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

// specStored/planStored 是 forward-slash 标准化后的存储路径（写入 state.spec_file/plan_file 用）。
// 返回的 bundle 喂给 applyReviewRecords 同步到 state.context_injection——signals/planning/execution 即真理，无独立工件。
// existingSignals: cmdSpecReview 透传 cmdPlan 已落盘到 state.context_injection.signals 的 signals
// 跳过 deriveRoleSignals——避免 summary 来源不同（requirementText vs spec.md In Scope）导致跨阶段漂移。
function buildRoleContextBundle({ requirementText, summary, taskName, analysisPatterns, discussionArtifact, specStored, planStored, existingSignals = null }) {
  const signals = existingSignals && typeof existingSignals === 'object'
    ? existingSignals
    : deriveRoleSignals(requirementText, analysisPatterns, discussionArtifact, { taskName, summary })
  const planProfile = resolveRoleProfile('plan_generation', signals)
  const planReviewProfile = resolveRoleProfile('plan_review', signals)
  const executionReviewProfile = resolveRoleProfile('quality_review_stage2', signals)
  return { signals, planProfile, planReviewProfile, executionReviewProfile }
}

// Plan-template 15-key 渲染输入。cmdPlan 和 cmdSpecReview 都用这套字段渲染 plan.md。
function buildPlanRenderValues({ requirementSource, createdAt, specStored, planStored, taskName, summary, config, roleSignals, planProfile, requirementCoverage, planPackage }) {
  return {
    requirement_source: requirementSource,
    created_at: createdAt,
    spec_file: specStored,
    task_name: taskName,
    goal: summary,
    architecture_summary: '基于现有实现做最小必要改动，并复用已有模块与状态流转能力。',
    tech_stack: buildTechStackSummary(config),
    role_profile: planProfile.profile || planProfile.role || 'planner',
    context_profile: JSON.stringify({ signals: roleSignals, phase: planProfile.phase }),
    injected_context_summary: `- role: ${planProfile.role || 'planner'}\n- profile: ${planProfile.profile || 'default'}\n- signals: ${Object.entries(roleSignals).filter(([, value]) => Boolean(value)).map(([key]) => key).join(', ') || 'default'}`,
    files_create: `- ${specStored}\n- ${planStored}`,
    files_modify: '- 无',
    files_test: '- 无',
    requirement_coverage: renderRequirementCoverage(requirementCoverage),
    tasks: buildPlanTasks(requirementCoverage, planPackage, specStored),
  }
}

// planGenerated=false 时只更新 spec 阶段的 codex 钩子（plan.md 未生成阶段）。
function applyReviewRecords(state, { roleContext, specContent, planContent, planGenerated }) {
  const { signals, planProfile, planReviewProfile, executionReviewProfile } = roleContext
  const codexSpec = shouldRunCodexSpecReview(specContent, signals)
  const codexPlan = shouldRunCodexPlanReview(planContent || '', specContent, signals)
  updateContextInjection(state, {
    schema_version: '1',
    signals,
    planning: {
      plan_generation: { role: planProfile.role, profile: planProfile.profile },
      plan_review: { role: planReviewProfile.role, profile: planReviewProfile.profile },
      codex_spec_review: { triggered: codexSpec.run, reason: codexSpec.reason },
      codex_plan_review: { triggered: codexPlan.run, reason: codexPlan.reason },
    },
    execution: {
      quality_review_stage2: { role: executionReviewProfile.role, profile: executionReviewProfile.profile },
    },
  })
  const existingSpec = (state.review_status || {}).codex_spec_review || {}
  if (!existingSpec.status || existingSpec.status === 'pending' || existingSpec.status === 'skipped') {
    updateCodexSpecReview(state, { status: codexSpec.run ? 'pending' : 'skipped', trigger_reason: codexSpec.reason })
  }
  if (planGenerated) {
    updateCodexPlanReview(state, { status: codexPlan.run ? 'pending' : 'skipped', trigger_reason: codexPlan.reason })
    updatePlanReviewRecord(state, {
      status: 'pending',
      review_mode: 'machine_loop',
      reviewer: 'subagent',
      role: planReviewProfile.role,
      profile: planReviewProfile.profile,
      signals_snapshot: signals,
      next_action: 'compile_tasks',
    })
  }
}

function cmdPlan(requirement, force = false, noDiscuss = false, projectId = null, projectRoot = null, specChoice = 'Spec 正确，生成 Plan', taskNameOverride = null) {
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
  const taskName = (taskNameOverride && String(taskNameOverride).trim()) || deriveTaskName(requirementText, sourcePath)
  const summary = summarizeText(requirementText, 120)
  const slug = slugifyFilename(taskName) || `workflow-${crypto.createHash('md5').update(requirementText).digest('hex').slice(0, 12)}`
  const dateSuffix = getDateSuffix()

  // spec → 项目内（team 可见，可入 git）；plan/state 仍在 user 级（过程性 + 高频变动）。
  // legacySpecLocation=true 回退 user 级旧路径。
  const specPath = isLegacySpecLocation(config)
    ? path.join(workflowDir, 'specs', `${slug}-${dateSuffix}.md`)
    : path.join(root, resolveSpecDocsRoot(config), `${slug}-${dateSuffix}.md`)
  const planPath = path.join(workflowDir, 'plans', `${slug}-${dateSuffix}.md`)
  // 存绝对路径；下游 `path.isAbsolute ? specStored : path.join(root, specStored)` 兼容旧相对路径 state。
  const specStored = specPath.replace(/\\/g, '/')
  const planStored = planPath.replace(/\\/g, '/')

  if (!force) {
    if (fs.existsSync(specPath)) return { error: `Spec 已存在: ${specPath}` }
    if (fs.existsSync(planPath)) return { error: `Plan 已存在: ${planPath}` }
  }

  const trimmed = String(requirementText || '').trim()
  const gapCount = (requirementSource === 'inline' && trimmed.length <= 100) ? 0 : (trimmed ? 1 : 0)
  const discussionRequired = shouldRunDiscussion(requirementText, requirementSource, noDiscuss, gapCount)
  const discussionArtifact = { requirementSource, clarifications: [], selectedApproach: null, unresolvedDependencies: [] }

  const analysisPatterns = (((config.tech) || {}).frameworks || []).map((framework) => ({ name: framework }))
  const roleContext = buildRoleContextBundle({
    requirementText, summary, taskName, analysisPatterns, discussionArtifact, specStored, planStored,
  })
  const { signals: roleSignals, planProfile } = roleContext
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
    file_structure: `- ${specStored}\n- ${planStored}`,
    acceptance_criteria: requirementItems.map((item) => `- [ ] ${item.id}: ${item.acceptance_signal || item.normalized_summary}`).join('\n') || `- [ ] ${summary}`,
    implementation_slices: requirementItems.map((item, index) => `- Slice ${index + 1}：响应 ${item.id} / ${item.normalized_summary}`).join('\n') || `- Slice 1：响应 ${summary}`,
    code_specs_constraints: codeSpecsConstraints,
  })
  const specContent = codeSpecsConstraints ? renderedSpecContent : stripProjectCodeSpecsSection(renderedSpecContent)

  const specReview = mapSpecReviewChoice(specChoice)
  const shouldGeneratePlan = specReview.status === 'approved'
  const planRequirementCoverage = buildRequirementCoverageFromSpec(specContent)
  const planContent = shouldGeneratePlan
    ? renderTemplate(planTemplate, buildPlanRenderValues({
      requirementSource, createdAt: now, specStored, planStored, taskName, summary,
      config, roleSignals, planProfile,
      requirementCoverage: planRequirementCoverage,
      planPackage,
    }))
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

  const finalWorkflowStatus = shouldGeneratePlan ? 'planned' : specReview.workflow_status
  const state = ensureStateDefaults(buildMinimumState(
    resolvedProjectId,
    shouldGeneratePlan ? planStored : null,
    specStored,
    shouldGeneratePlan && parsedTasks.length ? [parsedTasks[0].id] : [],
    finalWorkflowStatus
  ))
  state.initial_head_commit = detectGitHead(root)
  state.plan_file = shouldGeneratePlan ? planStored : null
  state.project_root = root
  state.task_name = taskName
  state.requirement_source = requirementSource
  state.requirement_text = requirementText
  updateDiscussionRecord(state, (discussionArtifact.clarifications || []).length, !discussionRequired)

  applyReviewRecords(state, {
    roleContext, specContent, planContent,
    planGenerated: shouldGeneratePlan,
  })
  updateUxDesignRecord(state, 0, 0, false, uxRequired)
  updateUserSpecReview(state, specReview.status, specReview.next_action)
  if (!shouldGeneratePlan) state.current_tasks = []
  writeState(statePath, state)

  // T2 codex_*_review consumer：spec/plan 阶段闸门触发。trigger_reason 非空且 status=pending 时
  // fire-and-forget 调 codex-bridge --background，立即拿 jobId 回写 state。失败不阻塞主线（state 保持 pending 由后续重试）。
  const codexTriggers = []
  const specTrigger = triggerCodexReview(state, 'spec', { projectRoot: root })
  if (specTrigger.triggered) codexTriggers.push({ phase: 'spec', ...specTrigger })
  if (shouldGeneratePlan) {
    const planTrigger = triggerCodexReview(state, 'plan', { projectRoot: root })
    if (planTrigger.triggered) codexTriggers.push({ phase: 'plan', ...planTrigger })
  }
  if (codexTriggers.length > 0) writeState(statePath, state)

  // T4 Task Atomicity Rule lint：扫生成的 plan，把多子项 task 未拆分的警告返回给上游展示。
  const atomicityLint = shouldGeneratePlan ? lintTaskAtomicity(planContent || '') : { warnings: [], checked_tasks: 0 }

  return {
    started: true,
    project_id: resolvedProjectId,
    config_healed: false,
    workflow_status: state.status,
    spec_file: specStored,
    plan_file: shouldGeneratePlan ? planStored : null,
    task_count: parsedTasks.length,
    current_tasks: state.current_tasks || [],
    discussion_required: discussionRequired,
    ux_gate_required: uxRequired,
    awaiting_user_spec_review: !shouldGeneratePlan,
    spec_review_summary: buildSpecReviewSummary(specContent),
    codex_review_triggers: codexTriggers,
    plan_atomicity_lint: atomicityLint,
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
    // split 分支把 state 推到 idle（语义=放弃当前 workflow）。state.status='idle' 时下一次 `plan`
    // 不带 --force 也允许覆盖（cmdPlan 通过 status !== 'idle' && !force 才拒绝）。提示上游 skill
    // 让用户重新发起 plan 或手动清理旧 spec.md。
    const isSplitScope = specReview.next_action === 'split_scope'
    return {
      review_recorded: true,
      project_id: resolvedProjectId,
      workflow_status: normalizedState.status,
      plan_file: normalizedState.plan_file || null,
      awaiting_user_spec_review: normalizedState.status === 'spec_review',
      spec_review_status: normalizedState.review_status.user_spec_review.status,
      next_action: specReview.next_action,
      next_step_hint: isSplitScope
        ? '当前工作流已放弃。请将范围拆分为更小的需求后重新执行 /workflow-spec 启动新流程；旧 spec.md 保留在 specs/ 目录可参考。'
        : '请在反馈中说明需要修改的章节，AI 将基于现有 spec.md 增量调整后再次提交 /workflow-spec spec-review。',
    }
  }

  const config = loadProjectConfig(root)
  if (!config) return { error: '缺少项目配置，无法继续生成 Plan' }

  const specStored = String(normalizedState.spec_file || '').replace(/\\/g, '/')
  if (!specStored) return { error: '缺少 spec_file，无法继续生成 Plan', project_id: resolvedProjectId }
  // 支持绝对路径（新格式）和相对路径（旧格式兼容）
  const specPath = path.isAbsolute(specStored) ? specStored : path.join(root, specStored)
  if (!fs.existsSync(specPath)) return { error: 'spec 文件不存在，无法继续生成 Plan', project_id: resolvedProjectId }
  const specContent = fs.readFileSync(specPath, 'utf8')

  const requirementText = String(normalizedState.requirement_text || specContent).trim()
  const requirementSource = normalizedState.requirement_source || 'inline'
  const taskName = normalizedState.task_name || deriveTaskName(requirementText, null)
  const summary = summarizeText(extractSubsection(extractNamedSection(specContent, 'Scope'), 'In Scope') || requirementText, 120)

  const planStored = String(inferPlanRelativeFromSpec(normalizedState.plan_file || specStored, taskName, workflowDir)).replace(/\\/g, '/')
  const planPath = path.isAbsolute(planStored) ? planStored : path.join(root, planStored)
  const discussionState = normalizedState.discussion || {}
  const discussionForSignals = { requirementSource, clarifications: [], selectedApproach: null, unresolvedDependencies: discussionState.unresolved_dependencies || [] }
  const analysisPatterns = (((config.tech) || {}).frameworks || []).map((framework) => ({ name: framework }))
  // 复用 cmdPlan 已落盘的 signals 避免跨阶段漂移（参见 buildRoleContextBundle existingSignals 注释）。
  const persistedSignals = ((normalizedState.context_injection || {}).signals) || null
  const roleContext = buildRoleContextBundle({
    requirementText, summary, taskName, analysisPatterns,
    discussionArtifact: discussionForSignals,
    specStored, planStored,
    existingSignals: persistedSignals,
  })
  const { signals: roleSignals, planProfile } = roleContext

  const templateRoot = path.resolve(__dirname, '..', '..', 'specs', 'workflow-templates')
  const planTemplate = fs.readFileSync(path.join(templateRoot, 'plan-template.md'), 'utf8')
  const requirementCoverage = buildRequirementCoverageFromSpec(specContent)
  const resumePlanPackage = inferTaskPackage(root, config)
  const planContent = renderTemplate(planTemplate, buildPlanRenderValues({
    requirementSource, createdAt: new Date().toISOString(), specStored, planStored, taskName, summary,
    config, roleSignals, planProfile,
    requirementCoverage,
    planPackage: resumePlanPackage,
  }))
  const parsedTasks = parseTasksV2(planContent)
  if (!parsedTasks.length) return { error: '生成的 Plan 未通过任务解析', project_id: resolvedProjectId }

  fs.mkdirSync(path.dirname(planPath), { recursive: true })
  fs.writeFileSync(planPath, planContent)

  normalizedState.status = 'planned'
  normalizedState.plan_file = planStored
  normalizedState.project_root = root
  if (!normalizedState.initial_head_commit) normalizedState.initial_head_commit = detectGitHead(root)
  normalizedState.task_name = taskName
  normalizedState.requirement_source = requirementSource
  normalizedState.requirement_text = requirementText
  normalizedState.current_tasks = [parsedTasks[0].id]
  applyReviewRecords(normalizedState, {
    roleContext, specContent, planContent,
    planGenerated: true,
  })
  writeState(statePath, normalizedState)

  return {
    review_recorded: true,
    project_id: resolvedProjectId,
    workflow_status: normalizedState.status,
    spec_file: specStored,
    plan_file: planStored,
    task_count: parsedTasks.length,
    current_tasks: normalizedState.current_tasks,
    awaiting_user_spec_review: false,
    spec_review_status: normalizedState.review_status.user_spec_review.status,
  }
}

// T5 cmdPlanReview：读 active workflow state → 读 spec.md / plan.md → 跑全部 lint → 汇总成统一 JSON。
// ready 判定矩阵见 workflow-plan plan §T20:
//   - placeholder.hits / coverage.uncovered_ids → hard block
//   - 其他 lint 由 Phase B/C 任务陆续接入
function cmdPlanReview(projectId = null, projectRoot = null) {
  const [resolvedProjectId, root, workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return { error: '没有活跃的工作流' }
  if (!state.plan_file) return { error: 'plan_file 未生成', project_id: resolvedProjectId }
  const planAbs = path.isAbsolute(state.plan_file) ? state.plan_file : path.join(root, state.plan_file)
  if (!fs.existsSync(planAbs)) return { error: `plan_file 不存在: ${planAbs}`, project_id: resolvedProjectId }
  const planMd = fs.readFileSync(planAbs, 'utf8')
  // F-13: spec 不可加载就不能放行 ready —— traceability 需要 spec 作为 R-ID 基准。
  let specMd = ''
  let specStatus = 'ok'
  if (!state.spec_file) {
    specStatus = 'spec_file_not_configured'
  } else {
    const specAbs = path.isAbsolute(state.spec_file) ? state.spec_file : path.join(root, state.spec_file)
    if (!fs.existsSync(specAbs)) {
      specStatus = 'spec_file_missing'
    } else {
      try {
        specMd = fs.readFileSync(specAbs, 'utf8')
      } catch (e) {
        specStatus = 'spec_read_error'
      }
    }
  }
  const planVersion = detectPlanVersion(planMd)
  const isV2Plan = planVersion === 2
  const anchorIntegrity = lintAnchorIntegrity(planMd)
  const lints = {
    placeholder: lintPlaceholder(planMd),
    atomicity: lintTaskAtomicity(planMd),
    anchor_integrity: { ...anchorIntegrity, plan_version: planVersion, enforced: isV2Plan },
    mandatory_reading: lintMandatoryReading(planMd),
    command_syntax: lintCommandSyntax(planMd),
    pattern_fidelity: lintPatternFidelity(planMd, root),
    type_consistency: lintTypeConsistency(planMd),
  }
  const coverage = checkRequirementCoverage(planMd, specMd)
  const confidence = scoreConfidence(planMd, {
    coverage,
    atomicity: lints.atomicity,
    commandSyntax: lints.command_syntax,
    patternFidelity: lints.pattern_fidelity,
  })
  const summary = derivePlanSummary(planMd, state)
  const anchorOk = isV2Plan
    ? (anchorIntegrity.orphans.length === 0
       && anchorIntegrity.missing.length === 0
       && (anchorIntegrity.stale || []).length === 0)
    : true
  const mandatoryOk = !(lints.mandatory_reading.declared && lints.mandatory_reading.violations.length > 0)
  const specOk = specStatus === 'ok'
  const ready =
    lints.placeholder.hits.length === 0 &&
    coverage.uncovered_ids.length === 0 &&
    anchorOk &&
    mandatoryOk &&
    specOk
  return {
    ready,
    project_id: resolvedProjectId,
    plan_file: state.plan_file,
    spec_file: state.spec_file || null,
    spec_status: specStatus,
    lints,
    coverage,
    confidence,
    summary,
  }
}

// T16 lintMandatoryReading：抽 Mandatory Reading 表行,校验 lines 字段格式。
// 行号可选(superpowers 式：controller/planner 不读源码补行号,implementer 自读定位);
// 仅当 lines 列填了非空值且格式错时才算违规。区分 declared=false(无该区块,不挡)/declared=true 且有违规(hard block)。
function lintMandatoryReading(planMarkdown) {
  const planMd = typeof planMarkdown === 'string' ? planMarkdown : ''
  // 截取 Mandatory Reading section：从 heading 起,直到下一个 ## heading / --- 分隔 / 文件末尾。
  const headingMatch = planMd.match(/^##\s*Mandatory Reading.*$/m)
  if (!headingMatch) return { violations: [], declared: false }
  const startIdx = planMd.indexOf(headingMatch[0])
  const tail = planMd.slice(startIdx + headingMatch[0].length)
  const stopMatch = tail.match(/\n(##\s|---)/)
  const section = stopMatch ? tail.slice(0, stopMatch.index) : tail
  const violations = []
  const ROW_RE = /^\|\s*P\d+\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm
  let row
  while ((row = ROW_RE.exec(section)) !== null) {
    const file = row[1].trim()
    const lines = row[2].trim()
    // 行号可选：留空 = 合规(implementer 自读定位)。填了才校验格式: `123` 或 `123-456` 或反引号包裹版本
    const cleanedLines = lines.replace(/^`|`$/g, '').trim()
    if (cleanedLines && !/^\d+(-\d+)?$/.test(cleanedLines)) {
      violations.push({ file, lines, reason: 'lines 若填须形如 N 或 N-M(可留空,implementer 自读定位)' })
    }
  }
  return { violations, declared: true }
}

// T17 lintCommandSyntax：抽 task 块的 `验证命令` 字段,做轻量语法校验。
// 不依赖第三方 shell parser(避免引入 npm 依赖),仅做括号 / 引号 / 管道闭合校验。
function lintCommandSyntax(planMarkdown) {
  const planMd = typeof planMarkdown === 'string' ? planMarkdown : ''
  const issues = []
  const taskBlocks = planMd.split(/\n(?=## T\d+:|### T\d+:)/g).filter((b) => /^(?:## |### )?T\d+:/m.test(b))
  for (const block of taskBlocks) {
    const idMatch = block.match(/^(?:## |### )?(T\d+):/m)
    if (!idMatch) continue
    const taskId = idMatch[1]
    const cmdMatch = block.match(/-\s*\*\*验证命令\*\*\s*[:：]\s*([^\n]+)/)
    if (!cmdMatch) continue
    const cmd = cmdMatch[1].trim()
    const issuesForCmd = []
    // 括号配对
    const open = (cmd.match(/[([{]/g) || []).length
    const close = (cmd.match(/[)\]}]/g) || []).length
    if (open !== close) issuesForCmd.push('bracket_mismatch')
    // 引号闭合(单/双)
    if (((cmd.match(/'/g) || []).length) % 2 !== 0) issuesForCmd.push('single_quote_unclosed')
    if (((cmd.match(/"/g) || []).length) % 2 !== 0) issuesForCmd.push('double_quote_unclosed')
    // 管道末尾不应裸悬空
    if (/\|\s*$/.test(cmd)) issuesForCmd.push('trailing_pipe')
    if (issuesForCmd.length > 0) {
      issues.push({ task: taskId, command: cmd, kinds: issuesForCmd })
    }
  }
  return { issues }
}

// T18 lintPatternFidelity：检查 Patterns to Mirror 区块的 `// SOURCE: file:lines` 引用真实存在。
function lintPatternFidelity(planMarkdown, projectRoot = process.cwd()) {
  const planMd = typeof planMarkdown === 'string' ? planMarkdown : ''
  const unresolved = []
  const SRC_RE = /\/\/\s*SOURCE:\s*(\S+?)(?::(\d+)(?:-(\d+))?)?$/gm
  let m
  while ((m = SRC_RE.exec(planMd)) !== null) {
    const file = m[1]
    const startLine = m[2] ? Number(m[2]) : null
    const endLine = m[3] ? Number(m[3]) : startLine
    const abs = path.isAbsolute(file) ? file : path.join(projectRoot, file)
    if (!fs.existsSync(abs)) {
      unresolved.push({ file, reason: 'file_not_found' })
      continue
    }
    if (startLine !== null) {
      try {
        const totalLines = fs.readFileSync(abs, 'utf8').split('\n').length
        if (startLine > totalLines || (endLine && endLine > totalLines)) {
          unresolved.push({ file, lines: `${startLine}-${endLine || ''}`, reason: 'line_out_of_range', total_lines: totalLines })
        }
      } catch {
        unresolved.push({ file, reason: 'read_error' })
      }
    }
  }
  return { unresolved }
}

// T19 lintTypeConsistency：跨 task 找命名相似但不等的符号。
// 预过滤降噪：长度 ≥ 5 / case-insensitive 等价跳过 / 词序重排跳过 / 数字结尾跳过。
function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

function camelToTokens(name) {
  return String(name).replace(/[A-Z]/g, (c) => ` ${c}`).trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function endsWithDigit(name) {
  return /\d$/.test(String(name))
}

function lintTypeConsistency(planMarkdown) {
  const planMd = typeof planMarkdown === 'string' ? planMarkdown : ''
  const symbolMap = new Map() // symbol → Set<taskId>
  const taskBlocks = planMd.split(/\n(?=## T\d+:|### T\d+:)/g).filter((b) => /^(?:## |### )?T\d+:/m.test(b))
  for (const block of taskBlocks) {
    const idMatch = block.match(/^(?:## |### )?(T\d+):/m)
    if (!idMatch) continue
    const taskId = idMatch[1]
    // 抽取符号：function/class/interface/type 声明 + 函数调用 foo(
    const declRe = /\b(?:function|class|interface|type)\s+([A-Za-z_][\w]+)/g
    const callRe = /\b([a-z][\w]+)\s*\(/g
    let dm
    while ((dm = declRe.exec(block)) !== null) {
      const sym = dm[1]
      if (!symbolMap.has(sym)) symbolMap.set(sym, new Set())
      symbolMap.get(sym).add(taskId)
    }
    while ((dm = callRe.exec(block)) !== null) {
      const sym = dm[1]
      if (!symbolMap.has(sym)) symbolMap.set(sym, new Set())
      symbolMap.get(sym).add(taskId)
    }
  }
  // 预过滤
  const symbols = [...symbolMap.keys()].filter((s) => s.length >= 5 && !endsWithDigit(s))
  const pairs = []
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = symbols[i]
      const b = symbols[j]
      if (a.toLowerCase() === b.toLowerCase()) continue // case-insensitive 等价
      const ta = camelToTokens(a).slice().sort().join(' ')
      const tb = camelToTokens(b).slice().sort().join(' ')
      if (ta === tb) continue // 词序重排
      const d = levenshtein(a, b)
      if (d > 0 && d <= 2) {
        pairs.push({
          name: a,
          variants: [b],
          locations: [...new Set([...(symbolMap.get(a) || []), ...(symbolMap.get(b) || [])])],
          distance: d,
        })
      }
    }
  }
  return { pairs }
}

// T12 + T12.5 cmdPlanEdit：锚点 section 级替换 + v1 plan 检测降级。
// 读 front matter `version` 字段：v2 走锚点路径,其他默认拒绝（除非 --allow-legacy）。
function detectPlanVersion(planMd) {
  // F-09: 行尾 `\r?\n` 兼容 CRLF / LF;否则 Windows 保存的 plan 永远走 legacy 路径。
  const fmMatch = String(planMd || '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) return null
  const versionMatch = fmMatch[1].match(/^version\s*:\s*(\d+)\s*$/m)
  return versionMatch ? Number(versionMatch[1]) : null
}

function cmdPlanEdit({ anchor, mode = 'replace_between', contentFile, allowLegacy = false, allowAnchorChange = false, projectId = null, projectRoot = null } = {}) {
  if (!anchor) return { error: '缺少 --anchor 参数' }
  if (!contentFile) return { error: '缺少 --content-file 参数' }
  if (!fs.existsSync(contentFile)) return { error: `--content-file 不存在: ${contentFile}` }
  if (mode !== 'replace_between' && mode !== 'replace_full') {
    return { error: `非法 --mode: ${mode},仅支持 replace_between / replace_full` }
  }
  if (mode === 'replace_full' && !allowAnchorChange) {
    return { error: 'replace_full 模式会替换锚点行本身,需 --allow-anchor-change 显式确认' }
  }
  const [resolvedProjectId, root, workflowDir, statePath, state] = resolveWorkflowRuntime(projectId, projectRoot)
  if (!resolvedProjectId || !workflowDir || !statePath || !state) return { error: '没有活跃的工作流' }
  if (!state.plan_file) return { error: 'plan_file 未生成' }
  const planAbs = path.isAbsolute(state.plan_file) ? state.plan_file : path.join(root, state.plan_file)
  if (!fs.existsSync(planAbs)) return { error: `plan_file 不存在: ${planAbs}` }
  const planMd = fs.readFileSync(planAbs, 'utf8')

  const version = detectPlanVersion(planMd)
  const isV2 = version === 2
  if (!isV2 && !allowLegacy) {
    return {
      error: 'legacy_plan_no_anchors',
      detected_version: version,
      suggestion: '本 plan 为旧格式(无 version:2 标记),plan-edit 默认拒绝。请用 Edit 工具直接修改,或加 --allow-legacy 强制(将整文件替换,失去锚点保护)。',
    }
  }

  const newContent = fs.readFileSync(contentFile, 'utf8')
  const bytesBefore = Buffer.byteLength(planMd, 'utf8')

  if (!isV2 && allowLegacy) {
    // 降级路径：整文件替换,stderr 警告
    process.stderr.write(`[plan-edit] WARNING: legacy plan v${version} 整文件覆盖（--allow-legacy 已确认）\n`)
    fs.writeFileSync(planAbs, newContent)
    return {
      written: true,
      legacy_overwrite: true,
      plan_file: state.plan_file,
      bytes_before: bytesBefore,
      bytes_after: Buffer.byteLength(newContent, 'utf8'),
      anchors_intact: false,
    }
  }

  // v2 锚点路径
  const anchorBegin = `<!-- WF:ANCHOR:${anchor}:begin -->`
  const anchorEnd = `<!-- WF:ANCHOR:${anchor}:end -->`
  if (!planMd.includes(anchorBegin) || !planMd.includes(anchorEnd)) {
    return { error: `锚点未找到: ${anchor}`, anchor_begin: anchorBegin, anchor_end: anchorEnd }
  }
  const escId = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 行尾用 `\r?\n` 兼容 CRLF / LF;否则 Windows / Notepad 编辑过的 plan 会无声 no-op(F-09)。
  const reBetween = new RegExp(`(<!--\\s*WF:ANCHOR:${escId}:begin\\s*-->\\r?\\n)([\\s\\S]*?)(\\r?\\n<!--\\s*WF:ANCHOR:${escId}:end\\s*-->)`)
  const reFull = new RegExp(`<!--\\s*WF:ANCHOR:${escId}:begin\\s*-->[\\s\\S]*?<!--\\s*WF:ANCHOR:${escId}:end\\s*-->`)
  // 用 callback 而非 replacement string 避免 newContent 中的 `$&` / `$1` / `$$` 等 metachar
  // 被 JS String.replace 当成 backreference 展开(F-05)。callback 返回值按字面插入。
  // F-09:无声 no-op 防御 —— 先 .test 确认正则会匹配,匹配失败 → error 而非"silent succeed"。
  const targetRe = mode === 'replace_between' ? reBetween : reFull
  if (!targetRe.test(planMd)) {
    return {
      error: 'anchor_pattern_mismatch',
      anchor,
      mode,
      note: '锚点 begin/end 都存在但 pattern 未匹配(可能 CRLF 行尾或锚点形状异常),拒绝写入避免静默 no-op。',
    }
  }
  let newMd
  if (mode === 'replace_between') {
    newMd = planMd.replace(reBetween, (_match, begin, _existing, end) => `${begin}${newContent}${end}`)
  } else {
    newMd = planMd.replace(reFull, () => newContent)
  }
  // 写回前校验锚点完整性。
  // v2 plan 同时挡 orphans + missing —— replace_full --allow-anchor-change 可能整段删掉必需锚点对,
  // 此时 orphans=[] 但 missing 非空,旧逻辑会放行写盘致 plan 损坏。修复 F-02。
  const integrity = lintAnchorIntegrity(newMd)
  const integrityBroken =
    integrity.orphans.length > 0
    || (isV2 && integrity.missing.length > 0)
    || (isV2 && (integrity.stale || []).length > 0)
  if (integrityBroken) {
    return {
      error: 'anchor_integrity_broken_after_edit',
      orphans: integrity.orphans,
      missing: isV2 ? integrity.missing : [],
      stale: isV2 ? (integrity.stale || []) : [],
      note: '写入会破坏锚点配对 / 删除必需锚点 / 残留无对应 heading 的 task anchor,已拒绝。',
    }
  }
  // 防止编辑后 plan 不再包含 state.current_tasks 引用的 task heading,
  // 让 workflow-execute 失锚。`##` / `###` 两种 heading 都视作 task。
  const currentTasks = Array.isArray(state.current_tasks) ? state.current_tasks : []
  if (currentTasks.length > 0) {
    const newTaskIds = new Set((newMd.match(/^(?:##|###)\s+(T\d+):/gm) || []).map((s) => s.match(/T\d+/)[0]))
    const orphaned = currentTasks.filter((tid) => !newTaskIds.has(tid))
    if (orphaned.length > 0) {
      return {
        error: 'current_tasks_orphaned_by_edit',
        orphaned_task_ids: orphaned,
        current_tasks: currentTasks,
        note: `编辑后 plan 不再包含 state.current_tasks 中的任务 ${orphaned.join(', ')},workflow-execute 会失锚。请先调整 state.current_tasks 或保留这些 task。`,
      }
    }
  }
  fs.writeFileSync(planAbs, newMd)
  return {
    written: true,
    plan_file: state.plan_file,
    anchor,
    mode,
    bytes_before: bytesBefore,
    bytes_after: Buffer.byteLength(newMd, 'utf8'),
    anchors_intact: true,
  }
}

module.exports = {
  renderTemplate,
  extractRequirementItems,
  buildRequirementCoverage,
  renderRequirementCoverage,
  buildPRDCoverageReport,
  buildPlanTasks,
  lintTaskAtomicity,
  lintPlaceholder,
  checkRequirementCoverage,
  derivePlanSummary,
  scoreConfidence,
  cmdPlan,
  cmdSpecReview,
  cmdPlanReview,
  cmdPlanEdit,
  lintAnchorIntegrity,
  detectPlanVersion,
  lintMandatoryReading,
  lintCommandSyntax,
  lintPatternFidelity,
  lintTypeConsistency,
}
