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
const taskStore = require('./task_store')
const { TaskDirSource, createTaskSource } = require('./task_source')
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
const { buildMinimumState, ensureStateDefaults, findOrphanedAnchors, finishedTaskIds } = require('./workflow_types')
const {
  deriveRoleSignals,
  isMachineReviewEnabled,
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

// T4 Task Atomicity Rule lint：扫 task-dir 记录，找 task 描述（name/task_text）里的 "N 个 / N 项 / N 列"
// 关键字配 acceptance 条数。当 N >= 5 且该 task 的 acceptance 条数 < N 时，emit 一条 warning
// （规则要求 N 个并列子项各带独立 acceptance bullet）。不阻断 — plan 上游消费者按需展示给用户。
// v2：narrative plan.md 无 `## Tn:` 块，本 lint 与其余 task lint 同源读 task 记录。
function lintTaskAtomicity(tasks, thresholdN = 5) {
  const taskList = Array.isArray(tasks) ? tasks : []
  const warnings = []
  let checked = 0
  for (const task of taskList) {
    if (!task || !task.id) continue
    checked++
    const text = `${task.name || ''}\n${task.task_text || ''}`
    // 找数字 + 单位的关键字
    const subItemMatch = text.match(/(\d+)\s*(个|项|列|字段|筛选项|标签|tab|sub-?task)/i)
    if (!subItemMatch) continue
    const declared = Number(subItemMatch[1])
    if (declared < thresholdN) continue
    const acceptanceCount = Array.isArray(task.acceptance) ? task.acceptance.length : 0
    if (acceptanceCount < declared) {
      warnings.push({
        task_id: task.id,
        declared_subitems: declared,
        observed_acceptance: acceptanceCount,
        unit: subItemMatch[2],
        message: `${task.id} 声明含 ${declared} 个 ${subItemMatch[2]} 但 acceptance 仅 ${acceptanceCount} 条；按 Task Atomicity Rule 应拆为 ${declared} 个 sub-task 各带独立 acceptance bullet`,
      })
    }
  }
  return { warnings, checked_tasks: checked }
}

// T-SF Shared File Analysis lint：扫 task 源的 files[]×depends[] 图，产出两类 advisory 信号。
//   merge_candidates：同 file ∩ 直接 depends 边 ∩ 同 phase ∩ 同 quality_gate 的 task 对 → 建议合并
//     （④同功能域=语义判断，机器判不了，故只报候选、人确认后合，引擎绝不自动合并）。
//   fan_out：同一 file 被 ≥fanOutThreshold 个 task 触及 → 提示无序写入 / 生成物收敛单一物化 task。
// 纯 advisory：不进 ready 门、不进 scoreConfidence rubric（与 lintTaskAtomicity 同层，仅记录供消费者展示）。
// 入参防御：LegacyPlanMdSource 的 legacyTaskToRecord 不产出 files 字段（task.files=undefined），
// 字段一律 Array.isArray 兜底——缺 files 的 legacy 工作流信号恒空（不抛、不误报）。
function lintSharedFiles(tasks, { fanOutThreshold = 3 } = {}) {
  const taskList = Array.isArray(tasks) ? tasks : []
  const records = []
  for (const task of taskList) {
    if (!task || !task.id) continue
    records.push({
      id: String(task.id),
      files: Array.isArray(task.files) ? task.files.filter((f) => typeof f === 'string' && f) : [],
      depends: Array.isArray(task.depends) ? task.depends.map(String) : [],
      phase: task.phase || 'implement',
      quality_gate: Boolean(task.quality_gate),
    })
  }
  const checked = records.length
  const byId = new Map(records.map((r) => [r.id, r]))
  // file → 有序去重 taskId 列表（保插入序，稳定输出）
  const fileMap = new Map()
  for (const r of records) {
    for (const f of new Set(r.files)) {
      if (!fileMap.has(f)) fileMap.set(f, [])
      fileMap.get(f).push(r.id)
    }
  }
  // pair(sorted key) → 共享 file 集合；fan_out 同遍累计
  const pairFiles = new Map()
  const fan_out = []
  for (const [file, ids] of fileMap) {
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join('|')
        if (!pairFiles.has(key)) pairFiles.set(key, new Set())
        pairFiles.get(key).add(file)
      }
    }
    if (ids.length >= fanOutThreshold) {
      fan_out.push({
        shared_file: file,
        task_ids: [...ids],
        task_count: ids.length,
        message: `${file} 被 ${ids.length} 个 task 触及（${ids.join(', ')}）；确认写入顺序/归属，若为生成物（如下游 i18n locale / autogen）应收敛到单一物化 task、feature task 只碰源`,
      })
    }
  }
  const hasDirectEdge = (a, b) => a.depends.includes(b.id) || b.depends.includes(a.id)
  const merge_candidates = []
  for (const [key, files] of pairFiles) {
    const [idA, idB] = key.split('|')
    const a = byId.get(idA)
    const b = byId.get(idB)
    if (!a || !b) continue
    if (!hasDirectEdge(a, b)) continue // ① 直接依赖边（双向任一）—— 挡住并列兄弟，不吃 atomicity
    if (a.phase !== b.phase) continue // ③ 同 phase
    if (a.quality_gate !== b.quality_gate) continue // ⑤ 不跨 quality_gate/commit 边界
    const sharedFiles = [...files].sort()
    merge_candidates.push({
      task_ids: [idA, idB],
      shared_files: sharedFiles,
      phase: a.phase,
      message: `${idA} + ${idB} 有直接依赖边且同改 ${sharedFiles.join(', ')}、同 phase/quality_gate；考虑合并为一个 task（④同功能域需人确认；合并时逐半 acceptance 挂回原 R-id/CHG-id 留可追溯）`,
    })
  }
  merge_candidates.sort((x, y) => x.task_ids.join().localeCompare(y.task_ids.join()))
  fan_out.sort((x, y) => x.shared_file.localeCompare(y.shared_file))
  return { merge_candidates, fan_out, checked_tasks: checked }
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
// `【占位】`(显式括号) + TBD/TODO/待补充/[待定]/{{name}} 兜住,裸 `占位` 纯噪声。
// 注意:`待确认` 故意不进本 token 集——spec §9(澄清记录/未解决依赖)合法使用它标记 open question
// (见下方 §9 分类逻辑对 `待确认` 的 unresolved 判定),硬 block 会误杀含 open question 的合法 spec。
// doc_contracts.PLACEHOLDER_REGEX 含 `待确认` 是另一套面向仓库文档的校验面,两者集合差异是刻意的。

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
// missing = 期望集合缺失的 ID(file_structure / tasks + 每个 task:Tn)。
// expected 列表只在 v2 plan 上有意义；v1 plan 调用方可忽略此 lint。
// verification_summary 锚点已退役：验证数据 canonical 落 task.json verification 字段，plan.md 不复写空表。
const REQUIRED_TOP_LEVEL_ANCHORS = ['file_structure', 'tasks']

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

// T2 checkRequirementCoverage：对比 spec 中的 R-ID 与 task 源（task-dir 记录）引用的 R-ID。
// covered = 交集；uncovered = spec 有 task 无（advisory，T8/FR-7 不卡 ready）；
// partial = spec 多处提及但仅 1 个 task 触及（soft warning，扣 PRD 1 分）。
// v2：task 引用读 task.json 的 requirement_ids[] 结构化字段（legacy plan.md 经
// legacyTaskToRecord 透传 parseTasksV2 的同名字段），不再解析 plan.md `需求 ID` 文本。
function extractTaskRequirementRefs(tasks) {
  const refs = []
  for (const task of (Array.isArray(tasks) ? tasks : [])) {
    const ids = Array.isArray(task && task.requirement_ids) ? task.requirement_ids : []
    for (const raw of ids) {
      const rid = String(raw || '').trim()
      if (/^R-\d{3,}$/.test(rid)) refs.push({ task: task.id || '', requirement_id: rid })
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

function checkRequirementCoverage(tasks, specMarkdown) {
  const specMd = typeof specMarkdown === 'string' ? specMarkdown : ''
  if (!specMd) {
    return { uncovered_ids: [], partial_ids: [], covered_ids: [], note: 'spec_missing' }
  }
  const specIds = extractInScopeRequirementIds(specMd)
  const planRefs = extractTaskRequirementRefs(tasks)
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

// T3 derivePlanSummary：从 task 源（task-dir 记录）派生 Step 3 输出摘要字段。
// state 用于注入 spec_file / plan_file 路径。v2 后不再解析 plan.md task block（narrative plan 无 `## Tn:`）。
const INTERACTION_LEGEND = 'AFK = 不需人介入 / HITL = 需人工介入(QA、文案、PM 确认)'

function derivePlanSummary(tasks, state = {}) {
  const taskList = Array.isArray(tasks) ? tasks : []
  const task_table = taskList.map((t) => ({
    id: (t && t.id) || '',
    title: (t && t.name) || '',
    phase: (t && t.phase) || '',
    deliverable: (t && Array.isArray(t.files) && t.files.length) ? t.files.join(', ') : '',
    deps: (t && Array.isArray(t.depends)) ? t.depends.join(', ') : '',
    interaction: (t && t.interaction) || 'AFK',
  }))
  const planRefs = extractTaskRequirementRefs(taskList)
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
// v2：从 task-dir 记录（非 plan.md 解析）算 confidence。patterns/verification/test_task 三维改读
// task.json 结构化字段（patterns[] / verification{commands,expected_output} / phase），与 plan-review lint 同源。
function scoreConfidence(tasks, { coverage, atomicity, commandSyntax, patternFidelity } = {}) {
  const taskList = Array.isArray(tasks) ? tasks : []
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

  // Patterns to Mirror（task.json patterns[] 总数 ≥ 3）
  // F-10: pattern_fidelity 有 unresolved 引用 → 不给分(引用文件不存在,pattern 不可复用)
  const patternCount = taskList.reduce((n, t) => n + (Array.isArray(t.patterns) ? t.patterns.length : 0), 0)
  const patternUnresolvedCount = (patternFidelity && patternFidelity.unresolved) ? patternFidelity.unresolved.length : 0
  if (patternCount >= 3 && patternUnresolvedCount === 0) breakdown.patterns = 2
  else if (patternUnresolvedCount > 0) {
    hints.push(`patterns=0：patterns[] 有 ${patternUnresolvedCount} 处 file 引用不存在，修正引用后给分`)
  } else {
    hints.push(`patterns=0：需 ≥3 条 task.json \`patterns[]\`（当前 ${patternCount} 条）`)
  }

  // Verification 维度：每 task verification.commands 与 expected_output 同时非空
  // F-10: command_syntax 有 issues → 不给分(命令本身语法坏,验证不可信)
  const commandIssuesCount = (commandSyntax && commandSyntax.issues) ? commandSyntax.issues.length : 0
  const unqualifiedTasks = taskList
    .filter((t) => {
      const v = t && t.verification
      return !(v && Array.isArray(v.commands) && v.commands.length && Array.isArray(v.expected_output) && v.expected_output.length)
    })
    .map((t) => t.id || '?')
  if (taskList.length > 0 && commandIssuesCount === 0 && unqualifiedTasks.length === 0) {
    breakdown.verification = 3
  } else if (commandIssuesCount > 0) {
    hints.push(`verification=0：${commandIssuesCount} 处验证命令语法有问题（见 lints.command_syntax）`)
  } else if (unqualifiedTasks.length > 0) {
    hints.push(`verification=0：${unqualifiedTasks.join(', ')} 缺 \`verification.commands\` 或 \`expected_output\`（每 task 两者须非空）`)
  } else if (taskList.length === 0) {
    hints.push('verification=0：task 源为空，无法评估验证维度')
  }

  // Test task 存在
  if (taskList.some((t) => t && t.phase === 'test')) breakdown.test_task = 2
  else hints.push('test_task=0：无 `phase: test` 任务；纯手动验证 plan 可忽略此项，不必为凑分造测试任务')

  const score = breakdown.prd_coverage + breakdown.patterns + breakdown.verification + breakdown.test_task
  const level = score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low'
  // atomicity 仅记录，不进 rubric（与 ready 矩阵一致）
  return { score, level, breakdown, hints, atomicity_warnings_count: (atomicity && atomicity.warnings) ? atomicity.warnings.length : 0 }
}


// S2 去骨架：把 spec 派生的 requirementCoverage 落成 N 个 task-dir 壳（仅元数据 task.json，无占位 body）。
// task.json 字段对齐 task_store.normalizeTaskRecord（{id,phase,package,target_layer,depends,status,acceptance,interaction}）。
// 不写 A1-A3 步骤 / src/ui/r-xxx.ts 文件桶 / `npm test -- r-xxx` 伪命令——这些占位由 workflow-plan 现写阶段定。
// acceptance 取 requirement 的 acceptance_signal（spec 派生的真实验收信号，非机械模板）；
// target_layer 由 owner 映射（frontend/backend → 同名层；shared → 留空走 package 级注入）。
// status 一律 pending。返回写入的 task id 列表（数字序，与 TaskDirSource.firstTaskId 一致）。
function createTaskShellsFromCoverage(projectId, requirementCoverage = [], pkg = '') {
  const rows = Array.isArray(requirementCoverage) ? requirementCoverage : []
  // coverage 为空时仍落 ≥1 个壳（默认单壳 T1「实现核心需求」），避免 status=planned 却无 task 源
  // 打穿 assertTaskSourcePresent / current_tasks[0] resume 起点（B-full invariant）。
  const effectiveRows = rows.length ? rows : [{ id: 'R-001', summary: '实现核心需求' }]
  // F-03：原子整体替换——先在临时目录写齐 N 个壳，再 rename 换入；旧 task-dir 保留至换入成功。
  // 既保留「重新落壳清理孤儿壳」语义（整目录替换），又避免「先删后逐个写」中途崩溃留空/残缺机器 task 源。
  const records = effectiveRows.map((entry, index) => {
    const owner = entry && entry.owner
    const targetLayer = owner === 'frontend' ? 'frontend' : owner === 'backend' ? 'backend' : ''
    const acceptanceSignal = (entry && (entry.acceptance_signal || entry.summary)) || ''
    return {
      id: `T${index + 1}`,
      name: (entry && entry.summary) ? String(entry.summary).trim() : '',
      phase: 'implement',
      package: pkg || '',
      target_layer: targetLayer,
      depends: index > 0 ? [`T${index}`] : [],
      status: 'pending',
      acceptance: acceptanceSignal ? [acceptanceSignal] : [],
      interaction: 'AFK',
      // R-ID 链：壳带 spec 派生需求 ID + must_preserve→quality_gate（workflow-plan task-write 重切时须承接 requirement_ids）。
      requirement_ids: (entry && entry.id) ? [String(entry.id)] : [],
      quality_gate: Boolean(entry && entry.must_preserve),
    }
  })
  return taskStore.replaceAllTasks(projectId, records)
}

// plan.md 退化后的 {{tasks}} 渲染体：只留人类可读叙述 + tasks 锚点内提示，不 emit 结构化 task block。
// 机器 task 源 = task-dir；plan.md 不再被 parseTasksV2 当 task 来源（spec §4.1 / §5）。
function buildNarrativeTasksBody(requirementCoverage = []) {
  const rows = Array.isArray(requirementCoverage) ? requirementCoverage : []
  const lines = [
    '> 机器 task 源为 task-dir（`~/.claude/workflows/{pid}/tasks/{Tn}/task.json`），由 spec 审批落壳、workflow-plan 现写定粒度。',
    '> 本节为人类可读叙述，不再承载结构化 task block；执行引擎从 task-dir 读取 task 序列。',
  ]
  if (rows.length) {
    lines.push('')
    lines.push('审批时落壳的需求覆盖（task 粒度由 workflow-plan 现写阶段细化）：')
    lines.push('')
    rows.forEach((entry, index) => {
      const id = entry && entry.id ? entry.id : `R-${String(index + 1).padStart(3, '0')}`
      const summary = (entry && entry.summary) || ''
      lines.push(`- T${index + 1} ← ${id}: ${summary}`)
    })
  }
  return lines.join('\n')
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

// Plan-template 渲染输入（仅 cmdSpecReview approve 调用）。
// approve 渲染瘦身：plan.md 是可选人类叙述骨架（front matter + 锚点 + 指针），不再编造
// architecture/files 样板正文——真实扩写由 /workflow-plan 在锚点上 Edit，机器作用域在 task.json。
function buildPlanRenderValues({ requirementSource, createdAt, specStored, taskName, summary, config, roleSignals, planProfile, requirementCoverage }) {
  return {
    requirement_source: requirementSource,
    created_at: createdAt,
    spec_file: specStored,
    task_name: taskName,
    goal: summary,
    architecture_summary: '（由 /workflow-plan 扩写）',
    tech_stack: buildTechStackSummary(config),
    role_profile: planProfile.profile || planProfile.role || 'planner',
    context_profile: JSON.stringify({ signals: roleSignals, phase: planProfile.phase }),
    injected_context_summary: `- role: ${planProfile.role || 'planner'}\n- profile: ${planProfile.profile || 'default'}\n- signals: ${Object.entries(roleSignals).filter(([, value]) => Boolean(value)).map(([key]) => key).join(', ') || 'default'}`,
    files_create: '（由 /workflow-plan 扩写；机器写作用域见 task.json `files` 字段）',
    files_modify: '（同上）',
    files_test: '（同上）',
    // S2 去骨架：plan.md 不再 emit 结构化 task block——机器 task 源 = task-dir 壳；
    // {{tasks}} 仅渲染人类可读叙述。coverage 数据经 task.json requirement_ids + plan-review 查询，不回灌 plan.md。
    tasks: buildNarrativeTasksBody(requirementCoverage),
  }
}

// planGenerated=false 时只更新 spec 阶段的 codex 钩子（plan.md 未生成阶段）。
// FR-6（T7）：reviewEnabled=false（默认）时不实例化 codex_*_review / plan_review 子对象，
// 只写 context_injection 的 advisory triggered 标记（恒为 false）。
function applyReviewRecords(state, { roleContext, specContent, planContent, planGenerated, reviewEnabled = false }) {
  const { signals, planProfile, planReviewProfile, executionReviewProfile } = roleContext
  const codexSpec = shouldRunCodexSpecReview(specContent, signals, { reviewEnabled })
  const codexPlan = shouldRunCodexPlanReview(planContent || '', specContent, signals, { reviewEnabled })
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
  // 机器 review 未显式开启 → 不实例化 review_status 子结构（保 user_spec_review 由 ensureStateDefaults 维护）。
  if (!reviewEnabled) return
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

function cmdPlan(requirement, force = false, noDiscuss = false, projectId = null, projectRoot = null, taskNameOverride = null) {
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
  const uxRequired = shouldRunUxDesignGate(requirementText, analysisPatterns, discussionArtifact)

  const now = new Date().toISOString()
  const templateRoot = path.resolve(__dirname, '..', '..', 'specs', 'workflow-templates')
  const specTemplate = fs.readFileSync(path.join(templateRoot, 'spec-template.md'), 'utf8')

  const requirementItems = extractRequirementItems(requirementText, summary)
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

  // 单一路径：cmdPlan 只产 spec 骨架（status=spec_review），plan.md / task 壳一律由
  // cmdSpecReview approve 时落（原 --spec-choice 一步式分支无任何 skill 可达，已删）。
  fs.mkdirSync(path.dirname(specPath), { recursive: true })
  fs.mkdirSync(workflowDir, { recursive: true })
  fs.writeFileSync(specPath, specContent)

  const specReview = mapSpecReviewChoice(null) // {status:'pending', workflow_status:'spec_review'}
  const state = ensureStateDefaults(buildMinimumState(
    resolvedProjectId,
    null,
    specStored,
    [],
    specReview.workflow_status
  ))
  state.initial_head_commit = detectGitHead(root)
  state.plan_file = null
  state.project_root = root
  state.task_name = taskName
  state.requirement_source = requirementSource
  state.requirement_text = requirementText
  updateDiscussionRecord(state, (discussionArtifact.clarifications || []).length, !discussionRequired)

  // FR-6（T7）：机器 review 自动触发默认关闭，仅 project-config.json workflow.review 显式开启时恢复。
  const reviewEnabled = isMachineReviewEnabled(config)
  applyReviewRecords(state, {
    roleContext, specContent, planContent: null,
    planGenerated: false,
    reviewEnabled,
  })
  updateUxDesignRecord(state, uxRequired)
  updateUserSpecReview(state, specReview.status, specReview.next_action)
  state.current_tasks = []
  writeState(statePath, state)

  // T2 codex_*_review consumer：spec 阶段闸门触发。trigger_reason 非空且 status=pending 时
  // fire-and-forget 调 codex-bridge --background，立即拿 jobId 回写 state。失败不阻塞主线（state 保持 pending 由后续重试）。
  // FR-6（T7）：reviewEnabled=false 时 triggerCodexReview 短路返回，不派 codex job。
  const codexTriggers = []
  const specTrigger = triggerCodexReview(state, 'spec', { projectRoot: root, enabled: reviewEnabled })
  if (specTrigger.triggered) codexTriggers.push({ phase: 'spec', ...specTrigger })
  if (codexTriggers.length > 0) writeState(statePath, state)

  return {
    started: true,
    project_id: resolvedProjectId,
    config_healed: false,
    workflow_status: state.status,
    spec_file: specStored,
    plan_file: null,
    task_count: 0,
    current_tasks: state.current_tasks || [],
    discussion_required: discussionRequired,
    ux_gate_required: uxRequired,
    awaiting_user_spec_review: true,
    codex_review_triggers: codexTriggers,
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

  // approve 占位门（CLI 化）：spec 正文仍含模板占位/未渲染 token 时拒绝 approve。
  // 原先该防线散在 workflow-spec Step 5 / workflow-plan Step 1 两处 prose（已漂移），收敛到此单点。
  const specPlaceholders = lintPlaceholder(specContent)
  if (specPlaceholders.hits.length > 0) {
    return {
      error: 'spec.md 仍含模板占位/未填写内容，请先回 /workflow-spec Step 4 补全后再 approve',
      reason: 'spec_placeholder',
      project_id: resolvedProjectId,
      placeholder_hits: specPlaceholders.hits,
    }
  }

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
    requirementSource, createdAt: new Date().toISOString(), specStored, taskName, summary,
    config, roleSignals, planProfile,
    requirementCoverage,
  }))
  fs.mkdirSync(path.dirname(planPath), { recursive: true })
  fs.writeFileSync(planPath, planContent)

  // S2 去骨架（FR-1）：approve 落 N 个 task-dir 壳作机器 task 源（无占位 task body），
  // current_tasks[0] 来源改由 task-dir 持久（C-1）；不再 parseTasksV2(plan.md) 当 task 源。
  const shellTaskIds = createTaskShellsFromCoverage(resolvedProjectId, requirementCoverage, resumePlanPackage)
  const firstTaskId = new TaskDirSource(resolvedProjectId).firstTaskId()
  // 壳保证 ≥1 条（coverage 空也落默认 T1），firstTaskId 为 null ⟺ 整目录替换中途失败（F-03 rename
  // 部分成功 / 磁盘满）。不能带空锚点推进 planned——current_tasks=[] 会打穿 resume 起点（C-1），
  // 在此 fail-fast：状态未写、停留 spec_review，用户重跑 approve 即可。
  if (!firstTaskId) {
    return {
      error: 'task-dir 壳写入后读不到首 task（task 源整目录替换可能中途失败），状态未推进，请重跑 spec-review approve',
      reason: 'task_shell_write_failed',
      project_id: resolvedProjectId,
      shell_task_ids: shellTaskIds,
    }
  }

  normalizedState.status = 'planned'
  normalizedState.plan_file = planStored
  normalizedState.project_root = root
  if (!normalizedState.initial_head_commit) normalizedState.initial_head_commit = detectGitHead(root)
  normalizedState.task_name = taskName
  normalizedState.requirement_source = requirementSource
  normalizedState.requirement_text = requirementText
  normalizedState.current_tasks = [firstTaskId]
  // FR-6（T7）：machine review 自动触发默认关闭。approve 路径与 cmdPlan 对称——
  // 显式开启（workflow.review）时 review_status 子对象实例化 + 派 codex job（C-5 端到端可恢复）。
  const reviewEnabled = isMachineReviewEnabled(config)
  applyReviewRecords(normalizedState, {
    roleContext, specContent, planContent,
    planGenerated: true,
    reviewEnabled,
  })
  writeState(statePath, normalizedState)

  // FR-6（T7）：镜像 cmdPlan dispatch block。reviewEnabled=false 时 triggerCodexReview 短路不派 job。
  const codexTriggers = []
  const specTrigger = triggerCodexReview(normalizedState, 'spec', { projectRoot: root, enabled: reviewEnabled })
  if (specTrigger.triggered) codexTriggers.push({ phase: 'spec', ...specTrigger })
  const planTrigger = triggerCodexReview(normalizedState, 'plan', { projectRoot: root, enabled: reviewEnabled })
  if (planTrigger.triggered) codexTriggers.push({ phase: 'plan', ...planTrigger })
  if (codexTriggers.length > 0) writeState(statePath, normalizedState)

  const result = {
    review_recorded: true,
    project_id: resolvedProjectId,
    workflow_status: normalizedState.status,
    spec_file: specStored,
    plan_file: planStored,
    task_count: shellTaskIds.length,
    current_tasks: normalizedState.current_tasks,
    awaiting_user_spec_review: false,
    spec_review_status: normalizedState.review_status.user_spec_review.status,
    codex_review_triggers: codexTriggers,
    // signals 来源可见化：正常 approve 流程 cmdPlan 已落盘 signals（persisted）；rederived = state 缺
    // context_injection.signals，buildRoleContextBundle 按 requirementText 重派生。重派生输入分两档：
    // requirement_text 在场 → 与 cmdPlan 同源，画像应一致；requirement_text 也缺 → 回退 spec 正文，
    // 派生输入与规划阶段不同，画像可能漂移。两档都显式回报供用户核对。
    role_signals_source: persistedSignals ? 'persisted' : 'rederived',
  }
  if (!persistedSignals) {
    const rederiveBasis = normalizedState.requirement_text ? 'requirement_text' : 'spec_content'
    result.role_signals_rederive_basis = rederiveBasis
    result.role_signals_warning = rederiveBasis === 'requirement_text'
      ? 'state.context_injection.signals 缺失，signals 已由同源 requirement_text 重派生（画像应与规划阶段一致；正常 approve 流程不应缺 signals，请检查 state 是否被手动改动）'
      : 'state.context_injection.signals 与 requirement_text 均缺失，signals 由 spec 正文回退重派生，画像可能与规划阶段漂移（请检查 state 是否被手动改动）'
  }
  return result
}

// T5 cmdPlanReview：读 active workflow state → 读 spec.md / plan.md → 跑全部 lint → 汇总成统一 JSON。
// ready 判定矩阵见 workflow-plan plan §T20:
//   - placeholder.hits（plan.md）/ spec_placeholder.hits（spec.md approve 后复检） → hard block
//   - coverage.uncovered_ids → advisory only（T8/FR-7：不卡 ready，仅返回供人参考）
//   - 其他 lint 由 Phase B/C 任务陆续接入
// 校验 task-dir 机器 task 源的 task.json schema（B2：planner 经 task-write 直写后的完整性门控）。
// listTasks 经 normalizeTaskRecord 读，故数组/缺省字段已归一；本 lint 抓 normalize 兜不住的：
//   hard（挡 ready）：非法 id 目录 / task.json 缺失或解析失败 / status 越界枚举。
//   warning（不挡）：name 空 / acceptance 空——提示 planner 补全，但不阻断（兼容 spec-approve 落壳未填态）。
const TASK_STATUS_ENUM = new Set(['pending', 'blocked', 'in_progress', 'completed', 'failed', 'skipped'])
function lintTaskSchema(projectId) {
  const issues = []
  const warnings = []
  let dirNames = []
  try {
    const root = taskStore.getTasksRoot(projectId)
    if (root && fs.existsSync(root)) {
      dirNames = fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
    }
  } catch { /* 缺 task-dir → checked:0，由 anchor lint 兜整体缺失 */ }
  const tasks = taskStore.listTasks(projectId)
  const parsedIds = new Set(tasks.map((t) => t.id))
  for (const name of dirNames) {
    if (!taskStore.isValidTaskId(name)) issues.push({ dir: name, problem: 'invalid_task_id_dir' })
    else if (!parsedIds.has(name)) issues.push({ dir: name, problem: 'task_json_missing_or_unparseable' })
  }
  for (const task of tasks) {
    if (task.status && !TASK_STATUS_ENUM.has(task.status)) {
      issues.push({ id: task.id, problem: `invalid_status:${task.status}` })
    }
    if (!task.name || !String(task.name).trim()) warnings.push({ id: task.id, problem: 'empty_name' })
    if (!Array.isArray(task.acceptance) || task.acceptance.length === 0) warnings.push({ id: task.id, problem: 'empty_acceptance' })
  }
  return { issues, warnings, checked: tasks.length }
}

// 机器 task 源完整性的「存在性」门：lintTaskSchema 只抓 corruption（非法 id 目录 / 坏 task.json /
// status 越界），抓不住「task 源整体为空」。task-dir 已是 canonical 机器源（execute 期
// assertTaskSourcePresent 也会兜底），plan-review 作为 handoff 前的权威门必须对称地挡空源，
// 否则会放行一个 execute 立刻 halt(task_source_missing) 的 plan。
// legacy 兼容：createTaskSource 命中有 task 的 LegacyPlanMdSource 时 count>0，不误挡存量 plan.md workflow。
function taskSourceEmptyIssue(state, projectId, projectRoot) {
  let count = 0
  try {
    const source = createTaskSource(state, { projectId, projectRoot, quiet: true })
    count = source ? source.listTasks().length : 0
  } catch {
    count = taskStore.listTasks(projectId).length
  }
  return count === 0 ? { problem: 'empty_task_source' } : null
}

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
  // v2：rich 维度（mandatory_reading / command_syntax / pattern_fidelity / confidence）改读 task-dir 记录，
  // 不再解析 plan.md task block（plan.md 已降为叙述）。task-dir → TaskDirSource；legacy plan.md → LegacyPlanMdSource。
  const { createTaskSource } = require('./task_source')
  const taskSource = createTaskSource(state, { projectId: resolvedProjectId, projectRoot: root, quiet: true })
  const reviewTasks = taskSource ? taskSource.listTasks() : []
  const lints = {
    placeholder: lintPlaceholder(planMd),
    // approve 后 spec 复检：占位门在 cmdSpecReview approve 单点拦截过一次，但 approve 与 plan-review
    // 之间 spec.md 可被人工编辑——此处用同一 lint 复检，防带占位 spec 流入 execute。
    // specStatus ≠ ok 时 specOk 已挡 ready，无内容可扫，hits 置空。
    spec_placeholder: specStatus === 'ok' ? lintPlaceholder(specMd) : { hits: [] },
    atomicity: lintTaskAtomicity(reviewTasks),
    shared_file: lintSharedFiles(reviewTasks),
    anchor_integrity: { ...anchorIntegrity, plan_version: planVersion, enforced: isV2Plan },
    mandatory_reading: lintMandatoryReading(reviewTasks),
    command_syntax: lintCommandSyntax(reviewTasks),
    pattern_fidelity: lintPatternFidelity(reviewTasks, root),
    task_schema: lintTaskSchema(resolvedProjectId),
  }
  // 存在性门：非 legacy 工作流 task 源为空 → 追加 hard issue（与 corruption issues 一并挡 ready）。
  const emptySourceIssue = taskSourceEmptyIssue(state, resolvedProjectId, root)
  if (emptySourceIssue) lints.task_schema.issues.push(emptySourceIssue)
  // resume 锚点门（C-1）：current_tasks 必须全部解析到 task 源中存在的 task。task-write 已自动重导，
  // 此处兜底（与 cmdPlanEdit 的 current_tasks_orphaned_by_edit 同语义）——孤儿锚点会让 execute
  // 首派发与 /clear resume 失锚，作为 hard issue 挡 ready。判定走 workflow_types 共享谓词。
  const anchorTasks = Array.isArray(state.current_tasks) ? state.current_tasks : []
  if (anchorTasks.length > 0 && reviewTasks.length > 0) {
    const orphanedAnchors = findOrphanedAnchors(anchorTasks, reviewTasks)
    if (orphanedAnchors.length > 0) {
      lints.task_schema.issues.push({
        problem: 'current_tasks_orphaned',
        orphaned_task_ids: orphanedAnchors,
        note: `state.current_tasks 中的 ${orphanedAnchors.join(', ')} 不存在于 task 源,execute 首派发会失锚。跑 repair-anchor（reseed-only 修锚）或重跑 task-write（会自动重导锚点）。`,
      })
    }
  }
  // 空锚点门（C-1 对称）：task 源仍有未终结 task 而 current_tasks 为空——task-dir 流程下 task-write
  // 自动落锚后不该出现；主要兜 legacy 未 seed 的存量 state。全部 completed/skipped 时空锚点合法,不报。
  // failed/blocked 算未终结（锚点应回退停在 retry/unblock 目标上）——repair-anchor/task-write 的
  // selectAnchorId 回退保证此态可修（不再出现「lint 挡 ready 而重导选不出锚点」的死循环）。
  if (anchorTasks.length === 0 && reviewTasks.length > 0) {
    const finishedIds = finishedTaskIds(state.progress || {})
    const unfinished = reviewTasks.filter((task) => !finishedIds.has(task.id))
    if (unfinished.length > 0) {
      lints.task_schema.issues.push({
        problem: 'current_tasks_empty',
        unfinished_count: unfinished.length,
        note: `task 源仍有 ${unfinished.length} 个未终结 task 但 state.current_tasks 为空,resume 锚点缺失。跑 repair-anchor（会自动落锚,failed/blocked 残留时锚到 retry/unblock 目标）或重跑 task-write。`,
      })
    }
  }
  const coverage = checkRequirementCoverage(reviewTasks, specMd)
  const confidence = scoreConfidence(reviewTasks, {
    coverage,
    atomicity: lints.atomicity,
    commandSyntax: lints.command_syntax,
    patternFidelity: lints.pattern_fidelity,
  })
  const summary = derivePlanSummary(reviewTasks, state)
  const anchorOk = isV2Plan
    ? (anchorIntegrity.orphans.length === 0
       && anchorIntegrity.missing.length === 0
       && (anchorIntegrity.stale || []).length === 0)
    : true
  const mandatoryOk = !(lints.mandatory_reading.declared && lints.mandatory_reading.violations.length > 0)
  const specOk = specStatus === 'ok'
  // T8/FR-7: coverage 降为 advisory —— uncovered_ids 不再卡 ready，仅作为返回字段供人参考。
  const ready =
    lints.placeholder.hits.length === 0 &&
    lints.spec_placeholder.hits.length === 0 &&
    anchorOk &&
    mandatoryOk &&
    specOk &&
    lints.task_schema.issues.length === 0
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
// 行号可选(controller/planner 不读源码补行号,implementer 自读定位);
// 仅当 lines 列填了非空值且格式错时才算违规。区分 declared=false(无该区块,不挡)/declared=true 且有违规(hard block)。
function lintMandatoryReading(tasks) {
  const taskList = Array.isArray(tasks) ? tasks : []
  // v2：从 task.json mandatory_reading[]（每项 {path,reason,symbols,line_hint}）校验 line_hint 格式。
  // declared = 任一 task 声明了 mandatory_reading；行号可选（留空 = 合规，implementer 自读定位）。
  const declared = taskList.some((t) => Array.isArray(t.mandatory_reading) && t.mandatory_reading.length > 0)
  if (!declared) return { violations: [], declared: false }
  const violations = []
  for (const task of taskList) {
    for (const entry of (task.mandatory_reading || [])) {
      if (!entry || !entry.path) continue
      const cleaned = String(entry.line_hint || '').replace(/^`|`$/g, '').trim()
      if (cleaned && !/^\d+(-\d+)?$/.test(cleaned)) {
        violations.push({ file: entry.path, lines: entry.line_hint, reason: 'line_hint 若填须形如 N 或 N-M(可留空,implementer 自读定位)' })
      }
    }
  }
  return { violations, declared: true }
}

// T17 lintCommandSyntax：校验 task.json verification.commands 的轻量语法。
// 不依赖第三方 shell parser(避免引入 npm 依赖),仅做括号 / 引号 / 管道闭合校验。
function lintCommandSyntax(tasks) {
  const taskList = Array.isArray(tasks) ? tasks : []
  const issues = []
  for (const task of taskList) {
    const commands = (task.verification && Array.isArray(task.verification.commands)) ? task.verification.commands : []
    for (const raw of commands) {
      const cmd = String(raw).trim()
      if (!cmd) continue
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
        issues.push({ task: task.id || '?', command: cmd, kinds: issuesForCmd })
      }
    }
  }
  return { issues }
}

// T18 lintPatternFidelity：检查 task.json patterns[]（{file,line?,note}）的 file 引用真实存在、行号在范围内。
function lintPatternFidelity(tasks, projectRoot = process.cwd()) {
  const taskList = Array.isArray(tasks) ? tasks : []
  const unresolved = []
  for (const task of taskList) {
    for (const pattern of (task.patterns || [])) {
      if (!pattern || !pattern.file) continue
      const file = pattern.file
      const abs = path.isAbsolute(file) ? file : path.join(projectRoot, file)
      if (!fs.existsSync(abs)) {
        unresolved.push({ file, reason: 'file_not_found' })
        continue
      }
      // line 可选：形如 "42" 或 "1-10"。填了才校验范围。
      const lineStr = pattern.line != null ? String(pattern.line).trim() : ''
      const mm = lineStr.match(/^(\d+)(?:-(\d+))?$/)
      if (mm) {
        const startLine = Number(mm[1])
        const endLine = mm[2] ? Number(mm[2]) : startLine
        try {
          const totalLines = fs.readFileSync(abs, 'utf8').split('\n').length
          if (startLine > totalLines || (endLine && endLine > totalLines)) {
            unresolved.push({ file, lines: lineStr, reason: 'line_out_of_range', total_lines: totalLines })
          }
        } catch {
          unresolved.push({ file, reason: 'read_error' })
        }
      }
    }
  }
  return { unresolved }
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
  // S3 重基（FR-2）：orphan guard 从「校验 current_tasks 命中 plan.md heading」迁为
  // 「校验 current_tasks 仍存在于 task 源（TaskDirSource）」—— task 源已切到 task-dir,
  // plan.md 不再承载结构化 task block,按 heading 校验会对 task-dir 流程恒误报失锚。
  const currentTasks = Array.isArray(state.current_tasks) ? state.current_tasks : []
  if (currentTasks.length > 0) {
    // 内联 orphan 判定收敛到 findOrphanedAnchors（共享谓词，别处 cmdPlanReview 兜底已用同实现）。
    const sourceTasks = resolvedProjectId ? new TaskDirSource(resolvedProjectId).listTasks() : []
    const orphaned = findOrphanedAnchors(currentTasks, sourceTasks)
    if (orphaned.length > 0) {
      return {
        error: 'current_tasks_orphaned_by_edit',
        orphaned_task_ids: orphaned,
        current_tasks: currentTasks,
        note: `state.current_tasks 中的任务 ${orphaned.join(', ')} 不存在于 task 源(task-dir),workflow-execute 会失锚。请先调整 state.current_tasks 或恢复对应 task 目录。`,
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
  createTaskShellsFromCoverage,
  buildNarrativeTasksBody,
  lintTaskAtomicity,
  lintSharedFiles,
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
  lintTaskSchema,
  taskSourceEmptyIssue,
}
