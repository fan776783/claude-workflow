#!/usr/bin/env node

// Task Store —— B-full 重基的 per-task 目录 CRUD（Trellis `task.py` 类比）。
// 布局（user 级，复用 path_utils.getWorkflowsDir）：
//   ~/.claude/workflows/{pid}/tasks/{taskId}/
//     ├── task.json      task 元数据 + v2 rich 字段
//     ├── task.md        从 task.json 渲染的人读执行正文（可重生，不回解析）
//     └── context.jsonl  JSONL 背包，每行 {file,reason}（仅 spec/research 路径，禁 code）
//
// 路径解析一律走 workflowDir(pid)，不硬编码 home。原子写、目录自建、缺失容错。

const fs = require('fs')
const path = require('path')
const { getWorkflowsDir, validateProjectId, safeReadJson } = require('./path_utils')

// taskId 白名单：与 status_utils.validateTaskId 同形（T + 数字），防目录穿越。
const TASK_ID_PATTERN = /^T\d+$/
function isValidTaskId(taskId) {
  return typeof taskId === 'string' && TASK_ID_PATTERN.test(taskId)
}

const TARGET_LAYER_WHITELIST = new Set(['frontend', 'backend', 'guides'])
function normalizeTargetLayer(value) {
  if (!value) return ''
  const normalized = String(value).trim().toLowerCase()
  return TARGET_LAYER_WHITELIST.has(normalized) ? normalized : ''
}

const INTERACTION_WHITELIST = new Set(['AFK', 'HITL'])
function normalizeInteraction(value) {
  if (!value) return 'AFK'
  const normalized = String(value).trim().toUpperCase()
  return INTERACTION_WHITELIST.has(normalized) ? normalized : 'AFK'
}

// verification 子结构（对齐 task_parser.createTaskVerification）：{commands,expected_output,notes}。
// 缺失/全空 → null（pre-execute-inject getTaskVerification 读 task.verification?.commands）。
function normalizeVerification(value) {
  if (!value || typeof value !== 'object') return null
  const commands = Array.isArray(value.commands) ? value.commands.map(String).filter(Boolean) : []
  const expected = Array.isArray(value.expected_output) ? value.expected_output.map(String).filter(Boolean) : []
  const notes = Array.isArray(value.notes) ? value.notes.map(String).filter(Boolean) : []
  if (!commands.length && !expected.length && !notes.length) return null
  return { commands, expected_output: expected, notes }
}

// task-dir schema 版本。v1（schema_version 缺省/<2）= 仅 metadata 壳，无 rich 正文字段；
// v2 = 含 files/patterns/mandatory_reading/constraints/task_text + 配套 task.md 渲染产物。
// 读侧 normalizeTaskRecord 忠实回 schema_version（缺省 1，供 execute 入口 v1 探测）；
// 写侧 createTask/replaceAllTasks 恒盖章 CURRENT_SCHEMA_VERSION。
const CURRENT_SCHEMA_VERSION = 2

function hasExecutableTaskText(task) {
  return Boolean(task && typeof task.task_text === 'string' && task.task_text.trim())
}

// task-dir 可被 execute/Task 派发的最小门：schema v2 只是结构版本，非最终可执行态。
// spec-approve 会先落 metadata shell 保障 resume 起点；/workflow-plan 的 task-write 才写入 task_text。
function getTaskDirExecutionIssue(projectId) {
  const tasks = listTasks(projectId)
  if (!tasks.length) return null
  const legacyIds = tasks
    .filter((task) => Number(task.schema_version) < CURRENT_SCHEMA_VERSION)
    .map((task) => task.id)
  if (legacyIds.length) {
    return {
      code: 'task_dir_schema_v1',
      task_ids: legacyIds,
      message: '检测到 v1 task-dir（缺 schema_version / rich 正文字段），本版本不兼容。请用 `workflow_cli plan --force` 全量重 plan（会重置已完成 task 的 progress），或 /workflow-archive 归档。',
    }
  }
  const shellIds = tasks
    .filter((task) => Number(task.schema_version) >= CURRENT_SCHEMA_VERSION && !hasExecutableTaskText(task))
    .map((task) => task.id)
  if (shellIds.length) {
    return {
      code: 'task_dir_not_executable',
      task_ids: shellIds,
      message: `检测到 v2 task-dir 仍是 metadata 壳（缺 task_text）：${shellIds.join(', ')}。请先通过 /workflow-plan 用 task-write 写入最终 task-dir，再执行。`,
    }
  }
  return null
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
}

// patterns[]（对齐 task_bundle.parsePatternBullet 形状）：{file, line?, note}。无 file 的条目丢弃。
function normalizePatterns(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const file = item.file ? String(item.file).trim() : ''
    if (!file) continue
    const entry = { file, note: item.note ? String(item.note).trim() : '' }
    const line = item.line != null ? String(item.line).trim() : ''
    if (line) entry.line = line
    out.push(entry)
  }
  return out
}

// mandatory_reading[]（对齐 task_bundle.parseMandatoryReadingBullet 形状）：{path, reason, symbols[], line_hint}。无 path 丢弃。
function normalizeMandatoryReading(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const p = item.path ? String(item.path).trim() : ''
    if (!p) continue
    out.push({
      path: p,
      reason: item.reason ? String(item.reason).trim() : '',
      symbols: normalizeStringArray(item.symbols),
      line_hint: item.line_hint != null ? String(item.line_hint).trim() : '',
    })
  }
  return out
}

// task.json schema 归一化。字段集对齐 spec §5.2 + createWorkflowTaskV2 输出。
// name / verification / blocked_by 为 workflow-plan 现写阶段细化字段：name 供 status 展示，
// verification 供 pre-execute-inject 注入 <verification-commands>，blocked_by 供 reconcileBlockedTasks
// 解依赖。缺省时分别退化为 ''/null/[]，不破坏 shell 形态。
// v2 rich 字段（files/constraints/patterns/mandatory_reading/task_text）供 execute 期 implementer 护栏
// 与 plan-review lint 直读；v1 task.json 缺这些字段时全退化为空，schema_version 忠实回 1。
function normalizeTaskRecord(data = {}) {
  return {
    ...data,
    schema_version: Number(data.schema_version) >= 1 ? Number(data.schema_version) : 1,
    id: String(data.id || ''),
    name: data.name ? String(data.name).trim() : '',
    phase: data.phase || 'implement',
    package: data.package ? String(data.package).trim() : '',
    target_layer: normalizeTargetLayer(data.target_layer),
    depends: Array.isArray(data.depends) ? data.depends.map((d) => String(d).trim()).filter(Boolean) : [],
    blocked_by: Array.isArray(data.blocked_by) ? data.blocked_by.map((d) => String(d).trim()).filter(Boolean) : [],
    status: data.status || 'pending',
    acceptance: Array.isArray(data.acceptance) ? [...data.acceptance] : [],
    verification: normalizeVerification(data.verification),
    interaction: normalizeInteraction(data.interaction),
    files: normalizeStringArray(data.files),
    constraints: normalizeStringArray(data.constraints),
    patterns: normalizePatterns(data.patterns),
    mandatory_reading: normalizeMandatoryReading(data.mandatory_reading),
    task_text: data.task_text != null ? String(data.task_text) : '',
  }
}

// tasks 根目录：<workflowDir(pid)>/tasks
function getTasksRoot(projectId) {
  const workflowDir = getWorkflowsDir(projectId)
  return workflowDir ? path.join(workflowDir, 'tasks') : null
}

// 单 task 目录：<tasks 根>/{taskId}
function getTaskDir(projectId, taskId) {
  const root = getTasksRoot(projectId)
  if (!root || !isValidTaskId(taskId)) return null
  return path.join(root, taskId)
}

function getTaskJsonPath(projectId, taskId) {
  const dir = getTaskDir(projectId, taskId)
  return dir ? path.join(dir, 'task.json') : null
}

function getContextJsonlPath(projectId, taskId) {
  const dir = getTaskDir(projectId, taskId)
  return dir ? path.join(dir, 'context.jsonl') : null
}

function getTaskMdPath(projectId, taskId) {
  const dir = getTaskDir(projectId, taskId)
  return dir ? path.join(dir, 'task.md') : null
}

// 原子写：写 tmp 再 rename，避免半截文件。
function atomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, targetPath)
}

// 建 task：写 task.json + 建目录。已存在则覆盖 task.json（context.jsonl 不动）。
function createTask(projectId, data = {}) {
  const taskId = data.id
  if (!isValidTaskId(taskId)) throw new Error(`invalid task id: ${taskId}`)
  const jsonPath = getTaskJsonPath(projectId, taskId)
  if (!jsonPath) throw new Error(`cannot resolve task dir for project ${projectId}/${taskId}`)
  // 写侧恒盖章当前 schema 版本；读侧 normalizeTaskRecord 保持忠实。
  const record = normalizeTaskRecord({ ...data, schema_version: CURRENT_SCHEMA_VERSION })
  atomicWrite(jsonPath, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

// 清空 tasks 根目录下所有 task 子目录（含 context.jsonl）。缺失容错。
// 用于重新落壳（spec re-approve / delta）前清理存量壳，避免遗留孤儿 task 目录被 listTasks 计入。
function removeAllTasks(projectId) {
  const root = getTasksRoot(projectId)
  if (!root || !fs.existsSync(root)) return 0
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return 0
  }
  let removed = 0
  for (const entry of entries) {
    if (entry.isDirectory() && isValidTaskId(entry.name)) {
      try {
        fs.rmSync(path.join(root, entry.name), { recursive: true, force: true })
        removed += 1
      } catch { /* 单目录删除失败不致命 */ }
    }
  }
  return removed
}

// 原子整体替换 task-dir 全部 task 壳（F-03）：先在临时目录写齐 + 校验，再 rename 换入，
// 旧 tasks/ 保留至换入成功。解决「removeAllTasks 后逐个 createTask」中途崩溃留空/残缺机器 task 源
// （叙述 plan.md 无法被 cmdInit 解析恢复）。records = createTask 入参对象数组，逐条 normalize + 校验 id。
// 任一步失败 → 清理临时目录、保留既有 tasks/ 不动并抛错（绝不在替代就绪前删除持久源）。
function replaceAllTasks(projectId, records = []) {
  const root = getTasksRoot(projectId)
  if (!root) throw new Error(`cannot resolve tasks root for project ${projectId}`)
  const parent = path.dirname(root)
  fs.mkdirSync(parent, { recursive: true })
  const stamp = `${process.pid}.${Date.now()}`
  const tmpRoot = path.join(parent, `.tasks.tmp.${stamp}`)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  fs.mkdirSync(tmpRoot, { recursive: true })
  const written = []
  try {
    for (const data of records || []) {
      const record = normalizeTaskRecord({ ...data, schema_version: CURRENT_SCHEMA_VERSION })
      if (!isValidTaskId(record.id)) throw new Error(`invalid task id: ${data && data.id}`)
      const dir = path.join(tmpRoot, record.id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'task.json'), `${JSON.stringify(record, null, 2)}\n`)
      // 保留存活 id 的 context.jsonl 背包：对齐 createTask「已存在则 context.jsonl 不动」语义。
      // task.md 是 task.json 的渲染产物，不能保留旧正文；task-write 会在替换后按新 task.json 重渲染。
      // 被移除 id 的随旧 root 一并清掉，符合孤儿清理预期。
      const prevCtx = path.join(root, record.id, 'context.jsonl')
      try {
        if (fs.existsSync(prevCtx)) fs.copyFileSync(prevCtx, path.join(dir, 'context.jsonl'))
      } catch { /* 背包保留失败不阻断整集替换（execute 期 readContext 容错） */ }
      written.push(record.id)
    }
  } catch (err) {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    throw err
  }
  // 换入：旧 tasks/ 先挪到 backup，新目录就位后删 backup。rename 失败尽力回滚旧目录。
  const backup = path.join(parent, `.tasks.old.${stamp}`)
  let movedExisting = false
  try {
    if (fs.existsSync(root)) {
      fs.renameSync(root, backup)
      movedExisting = true
    }
    fs.renameSync(tmpRoot, root)
  } catch (err) {
    try { if (movedExisting && !fs.existsSync(root)) fs.renameSync(backup, root) } catch { /* best effort */ }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    throw err
  }
  fs.rmSync(backup, { recursive: true, force: true })
  return written
}

// 读 task.json。缺失 → null（容错）。
function readTask(projectId, taskId) {
  const jsonPath = getTaskJsonPath(projectId, taskId)
  if (!jsonPath) return null
  const raw = safeReadJson(jsonPath, null)
  if (!raw) return null
  return normalizeTaskRecord(raw)
}

// 列 tasks：扫 tasks 根目录下的合法 taskId 子目录，按 taskId 数字序稳定排序。
// 排序确定性是 C-1 resume 三元组等价的前提（current_tasks[0] 可复现）。
function listTasks(projectId) {
  const root = getTasksRoot(projectId)
  if (!root || !fs.existsSync(root)) return []
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const ids = entries
    .filter((e) => e.isDirectory() && isValidTaskId(e.name))
    .map((e) => e.name)
    .sort(compareTaskId)
  const tasks = []
  for (const id of ids) {
    const task = readTask(projectId, id)
    if (task) tasks.push(task)
  }
  return tasks
}

// T<n> 数字序比较；数字相等回退字典序。
function compareTaskId(a, b) {
  const na = Number((a.match(/\d+/) || [])[0])
  const nb = Number((b.match(/\d+/) || [])[0])
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.localeCompare(b)
}

// 更新 task.status，其余字段保留。task 不存在 → 抛错（状态机推进不应静默吞）。
function updateTaskStatus(projectId, taskId, newStatus) {
  const existing = readTask(projectId, taskId)
  if (!existing) throw new Error(`task not found: ${projectId}/${taskId}`)
  existing.status = String(newStatus || existing.status)
  const jsonPath = getTaskJsonPath(projectId, taskId)
  atomicWrite(jsonPath, `${JSON.stringify(existing, null, 2)}\n`)
  return existing
}

// curate JSONL 背包：写 context.jsonl，每行 {file,reason}。
// 仅 spec/research 路径——禁 code 路径（启发式：丢明显代码扩展名）。覆盖式写。
const CODE_EXT_PATTERN = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|rb|php|c|h|cpp|hpp|cs|swift|kt|sh)$/i
function curateContext(projectId, taskId, entries = []) {
  if (!isValidTaskId(taskId)) throw new Error(`invalid task id: ${taskId}`)
  const jsonlPath = getContextJsonlPath(projectId, taskId)
  if (!jsonlPath) throw new Error(`cannot resolve context path for ${projectId}/${taskId}`)
  const lines = []
  for (const entry of entries || []) {
    if (!entry || typeof entry.file !== 'string') continue
    const file = entry.file.trim()
    if (!file) continue
    // 禁 code 路径：背包仅承载 spec/research 文件。
    if (CODE_EXT_PATTERN.test(file)) continue
    lines.push(JSON.stringify({ file, reason: String(entry.reason || '') }))
  }
  const content = lines.length ? `${lines.join('\n')}\n` : ''
  atomicWrite(jsonlPath, content)
  return lines.length
}

// 读 context.jsonl → {file,reason}[]。缺失 / 空 → []。坏行跳过（容错）。
function readContext(projectId, taskId) {
  const jsonlPath = getContextJsonlPath(projectId, taskId)
  if (!jsonlPath || !fs.existsSync(jsonlPath)) return []
  let raw
  try {
    raw = fs.readFileSync(jsonlPath, 'utf8')
  } catch {
    return []
  }
  const result = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed.file === 'string') {
        result.push({ file: parsed.file, reason: String(parsed.reason || '') })
      }
    } catch { /* skip malformed line */ }
  }
  return result
}

// task.md：workflow-plan 从 task.json 渲染的人读执行切片，execute 期逐字注入 implementer prompt（不回解析）。
// 独立于 task.json，不进 normalizeTaskRecord。缺失返回 ''（可由 task.json 重渲染，非致命）。
function writeTaskMd(projectId, taskId, content) {
  if (!isValidTaskId(taskId)) throw new Error(`invalid task id: ${taskId}`)
  const mdPath = getTaskMdPath(projectId, taskId)
  if (!mdPath) throw new Error(`cannot resolve task.md path for ${projectId}/${taskId}`)
  atomicWrite(mdPath, String(content == null ? '' : content))
  return mdPath
}

function readTaskMd(projectId, taskId) {
  const mdPath = getTaskMdPath(projectId, taskId)
  if (!mdPath || !fs.existsSync(mdPath)) return ''
  try {
    return fs.readFileSync(mdPath, 'utf8')
  } catch {
    return ''
  }
}

module.exports = {
  TASK_ID_PATTERN,
  CURRENT_SCHEMA_VERSION,
  getTaskDirExecutionIssue,
  hasExecutableTaskText,
  isValidTaskId,
  normalizeTaskRecord,
  getTasksRoot,
  getTaskDir,
  getTaskJsonPath,
  getContextJsonlPath,
  getTaskMdPath,
  createTask,
  readTask,
  listTasks,
  removeAllTasks,
  replaceAllTasks,
  updateTaskStatus,
  curateContext,
  readContext,
  writeTaskMd,
  readTaskMd,
}
